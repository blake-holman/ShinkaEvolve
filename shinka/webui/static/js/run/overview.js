// Run overview shown in the right pane when no program is selected or when
// "Run overview" is pressed.
//
// CONTRACT (implemented by a separate task; main.js depends only on this API)
//
//   renderOverview(container, { model, dbPath, api, onSelect })
//     - A row of stat cards (.cards > .card.stat): programs (with % correct),
//       best score (with generation; clicking selects the best via onSelect),
//       generations, total cost, runtime, failed proposals.
//     - "Score by generation": Plotly line of bestSoFar per generation plus
//       markers for every correct program's score (model.generations[].scores),
//       hover names the program and shows generation and score; clicking a
//       point selects that program via onSelect. Use plotlyLayout() from
//       theme.js and PLOTLY_CONFIG; re-render on theme change (onThemeChange).
//     - "Cumulative cost": Plotly line of cumulativeCost per generation with
//       bars for per-generation cost on a secondary axis.
//     - "Scratchpad": the newest meta file (api.metaFiles then api.metaContent)
//       rendered with marked.parse, inside a <details class="section" open>.
//       Hidden entirely when there are no meta files. Older meta files
//       selectable from a <select>.
//     - Empty state when the run has no programs yet.
//     - Must be cheap to call again after an auto-refresh (Plotly.react).
//
// The DOM is built once per container and database and then updated in
// place, so a refresh never flickers and never resets the scratchpad choice
// or the open/closed state of the section.
import { correctPercent, displayName, escapeHtml, formatCost, formatDuration, formatScore } from "./model.js";
import { PLOTLY_CONFIG, currentTheme, onThemeChange, plotlyLayout, themeColors, touchSafeAxes } from "./theme.js";

const views = new WeakMap(); // container -> view
const MAX_MARKDOWN_CHARS = 200000;
/** How long the meta-file list is reused while the program count stays the same. */
const META_LIST_INTERVAL_MS = 15000;
/**
 * Marker diameter shared by both score traces. In "closest" hover mode Plotly gives every
 * marker of radius r a distance of at least 1 - 3/r, so 6 px markers (r = 3) all reach 0
 * within 3 px of the cursor and the later trace wins the tie. With equal sizes the
 * best-so-far marker under the cursor wins over a program marker drawn a few pixels away.
 */
const SCORE_MARKER_SIZE = 6;

export async function renderOverview(container, { model, dbPath, api, onSelect }) {
    let view = views.get(container);
    if (!view || view.root.parentNode !== container || view.dbPath !== dbPath) {
        if (view) destroyView(view);
        view = createView(container, dbPath);
        views.set(container, view);
    }
    view.onSelect = onSelect;
    const token = ++view.token;
    const empty = model.programs.size === 0;
    view.el.empty.hidden = !empty;
    view.el.body.hidden = empty;
    if (empty) return;
    renderCards(view, model);
    renderCharts(view, model);
    await renderScratchpad(view, model, api, token);
}

// ---------- skeleton ----------

function overviewHtml(dbPath) {
    const path = escapeHtml(dbPath || "");
    return `
        <div class="overview">
            <div class="overview__header">
                <h2>Run overview</h2>
                <span class="muted mono overview__path" title="${path}">${path}</span>
            </div>
            <div class="empty overview__empty" hidden>Waiting for the first program&hellip;</div>
            <div class="overview__body" hidden>
                <div class="cards overview__cards"></div>
                <div class="card overview__chart-card">
                    <h3>Score by generation</h3>
                    <div class="overview__chart" data-chart="score"></div>
                </div>
                <div class="card overview__chart-card">
                    <h3>Cost</h3>
                    <div class="overview__chart" data-chart="cost"></div>
                </div>
                <div class="card overview__scratch" hidden>
                    <details class="section" open>
                        <summary>Scratchpad</summary>
                        <div class="section__body">
                            <label class="overview__scratch-bar">
                                <span>Written after</span>
                                <select class="overview__select" aria-label="Which scratchpad to show"></select>
                                <span>processed programs</span>
                            </label>
                            <div class="markdown"></div>
                        </div>
                    </details>
                </div>
            </div>
        </div>`;
}

function createView(container, dbPath) {
    container.innerHTML = overviewHtml(dbPath);
    const root = container.firstElementChild;
    const q = (selector) => root.querySelector(selector);
    const view = {
        root, dbPath, token: 0, onSelect: null, api: null, model: null, theme: null,
        cardsHtml: null, chartEventsBound: false,
        scratch: { files: [], selected: null, pinned: false, shown: null, optionsHtml: null, content: new Map(), listedCount: null, listedAt: 0 },
        el: {
            empty: q(".overview__empty"), body: q(".overview__body"), cards: q(".overview__cards"),
            score: q('[data-chart="score"]'), cost: q('[data-chart="cost"]'),
            scratch: q(".overview__scratch"), select: q(".overview__select"), markdown: q(".markdown"),
        },
    };
    bindControls(view);
    observeView(view, container);
    view.unsubscribeTheme = onThemeChange((theme) => {
        // main.js re-renders on a theme change too; skip when that already repainted with this theme.
        if (!view.destroyed && view.model && view.theme !== theme) renderCharts(view, view.model);
    });
    return view;
}

function bindControls(view) {
    view.el.cards.addEventListener("click", (event) => {
        const button = event.target.closest("[data-select]");
        if (button && view.onSelect) view.onSelect(button.dataset.select);
    });
    view.el.select.addEventListener("change", () => {
        view.scratch.selected = Number(view.el.select.value);
        view.scratch.pinned = true;
        showScratchpad(view, view.api, ++view.token);
    });
}

function observeView(view, container) {
    // The divider does not fire a window resize, so watch the chart boxes themselves.
    view.resizeObserver = new ResizeObserver(() => {
        // Crossing the narrow width changes the layout itself (legend, titles, ticks), not just the size.
        const width = view.el.score.clientWidth;
        if (view.model && view.el.score.offsetParent !== null
            && (chartIsNarrow(width) !== view.narrow || maxTicksFor(width) !== view.maxTicks)) {
            renderCharts(view, view.model);
            return;
        }
        for (const gd of [view.el.score, view.el.cost]) {
            // Plotly rejects a resize of a hidden or detached chart; those are resized on the next render.
            if (gd._fullLayout && gd.offsetParent !== null) Plotly.Plots.resize(gd).catch(() => {});
        }
    });
    view.resizeObserver.observe(view.el.score);
    view.resizeObserver.observe(view.el.cost);
    // Another panel (the program view) replaces the container's children; free the charts right away.
    view.mutationObserver = new MutationObserver(() => { if (view.root.parentNode !== container) destroyView(view); });
    view.mutationObserver.observe(container, { childList: true });
}

function destroyView(view) {
    if (view.destroyed) return;
    view.destroyed = true;
    view.token += 1;
    view.resizeObserver.disconnect();
    view.mutationObserver.disconnect();
    view.unsubscribeTheme();
    for (const gd of [view.el.score, view.el.cost]) if (gd._fullLayout) Plotly.purge(gd);
    if (view.root.parentNode) view.root.remove();
}

// ---------- stat cards ----------

function statCard(label, value, sub, { selectId = null, title = "" } = {}) {
    const inner = `<span class="stat__label">${escapeHtml(label)}</span>`
        + `<span class="stat__value">${escapeHtml(value)}</span>`
        + (sub ? `<span class="stat__sub">${escapeHtml(sub)}</span>` : "");
    if (selectId !== null) {
        return `<button type="button" class="card stat overview__best" data-select="${escapeHtml(selectId)}" title="${escapeHtml(title)}">${inner}</button>`;
    }
    return `<div class="card stat">${inner}</div>`;
}

function renderCards(view, model) {
    const t = model.totals;
    const best = model.best;
    const cards = [
        statCard("Programs", String(t.programCount), `${correctPercent(t)}% correct`),
        best
            ? statCard("Best score", formatScore(best.combined_score), `generation ${best.generation} · ${displayName(best)}`,
                { selectId: best.id, title: `Open ${displayName(best)}` })
            : statCard("Best score", "–", "no correct program yet"),
        statCard("Generations", String(model.maxGeneration + 1), null),
        statCard("Total cost", formatCost(t.totalCost), t.extraCost > 0 ? `includes prompt evolution ${formatCost(t.extraCost)}` : null),
        statCard("Runtime", formatDuration(t.runtimeSeconds), null),
    ];
    if (t.failedProposalCount > 0) cards.push(statCard("Failed proposals", String(t.failedProposalCount), "never reached evaluation"));
    const html = cards.join("");
    if (view.cardsHtml === html) return; // unchanged data: keep hover and focus state
    view.cardsHtml = html;
    view.el.cards.innerHTML = html;
}

// ---------- charts ----------

/** Tick step that keeps at most about twelve integer ticks on the generation axis. */
const NARROW_CHART_PX = 520; // below this chart width, use the compact layout
const TICK_SPACING_PX = 44;   // room per generation tick label
const MAX_MARKED_GENERATIONS = 60;

function maxTicksFor(width) {
    return width ? Math.max(3, Math.min(12, Math.floor(width / TICK_SPACING_PX))) : 12;
}

function generationStep(maxGeneration, maxTicks = 12) {
    for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
        if (maxGeneration / step <= maxTicks) return step;
    }
    return Math.ceil(maxGeneration / maxTicks);
}

function generationAxis(base, maxGeneration, colors, width) {
    const maxTicks = maxTicksFor(width);
    return {
        ...base,
        title: { text: "Generation", font: { color: colors.fgMuted, size: 12 } },
        tickmode: "linear", tick0: 0, dtick: generationStep(maxGeneration, maxTicks), tickangle: 0,
        range: [-0.5, maxGeneration + 0.5],
    };
}

/** Narrow charts: legend under the plot, shorter titles, smaller margins. */
function compact(layout, width) {
    if (!width || width >= NARROW_CHART_PX) return layout;
    return {
        ...layout,
        margin: { l: 44, r: layout.yaxis2 ? 44 : 12, t: 8, b: 72 },
        legend: { ...layout.legend, orientation: "h", x: 0, y: -0.32, yanchor: "top" },
    };
}

// Point customdata is [id, name, score text, generation]. Plotly reads tags such as <b> in
// hover text, so names are escaped; it decodes numeric entities but not &quot;.
function pointData(program, score) {
    const name = escapeHtml(displayName(program)).replace(/&quot;/g, "&#34;");
    return [program.id, name, formatScore(score), program.generation];
}

function programPoints(model) {
    const x = [], y = [], customdata = [];
    for (const gen of model.generations) {
        gen.scores.forEach((score, i) => {
            x.push(gen.generation);
            y.push(score);
            customdata.push(pointData(model.programs.get(gen.scoredIds[i]), score));
        });
    }
    return { x, y, customdata };
}

/** Best-so-far line; each point carries the program that holds that score. */
function bestSoFarPoints(model) {
    let holder = null, holderScore = -Infinity;
    const customdata = model.generations.map((gen) => {
        // Strictly greater, so a tie keeps the earlier program, as model.best does.
        if (gen.bestInGeneration !== null && gen.bestInGeneration > holderScore) {
            holder = model.programs.get(gen.scoredIds[gen.scores.indexOf(gen.bestInGeneration)]);
            holderScore = gen.bestInGeneration;
        }
        return holder ? pointData(holder, gen.bestSoFar) : null;
    });
    return { x: model.generations.map((g) => g.generation), y: model.generations.map((g) => g.bestSoFar), customdata };
}

function scoreTraces(model, colors) {
    return [
        {
            type: "scatter", mode: "markers", name: "Program",
            ...programPoints(model),
            marker: { size: SCORE_MARKER_SIZE, color: colors.fgMuted },
            hovertemplate: "%{customdata[1]}<br>gen %{x} · %{customdata[2]}<extra></extra>",
        },
        {
            type: "scatter", mode: "lines+markers", name: "Best so far",
            ...bestSoFarPoints(model),
            connectgaps: false,
            line: { color: colors.accent, width: 2, shape: "linear" },
            marker: { size: SCORE_MARKER_SIZE, color: colors.accent, line: { color: colors.bgElev, width: 1.5 } },
            hovertemplate: "Best so far: %{customdata[1]}<br>gen %{customdata[3]} · %{customdata[2]}<extra></extra>",
        },
    ];
}

function scoreLayout(model, colors, width) {
    const base = plotlyLayout();
    return compact({
        ...base,
        margin: { l: 56, r: 16, t: 24, b: 44 },
        hovermode: "closest",
        legend: { ...base.legend, y: 1.18 },
        xaxis: generationAxis(base.xaxis, model.maxGeneration, colors, width),
        yaxis: { ...base.yaxis, title: { text: "Score", font: { color: colors.fgMuted, size: 12 } } },
    }, width);
}

function costTraces(model, colors) {
    const x = model.generations.map((g) => g.generation);
    // Markers on hundreds of generations merge into a band; draw the line alone then.
    const markers = model.generations.length <= MAX_MARKED_GENERATIONS;
    return [
        {
            type: "bar", name: "Per generation",
            x, y: model.generations.map((g) => g.cost),
            marker: { color: colors.fgMuted },
            hovertemplate: "gen %{x}: $%{y:.4f}",
        },
        {
            type: "scatter", mode: markers ? "lines+markers" : "lines", name: "Cumulative", yaxis: "y2",
            x, y: model.generations.map((g) => g.cumulativeCost),
            line: { color: colors.accent, width: 2, shape: "linear" },
            marker: { size: 6, color: colors.accent, line: { color: colors.bgElev, width: 1.5 } },
            hovertemplate: "gen %{x}: $%{y:.4f}",
        },
    ];
}

function costLayout(model, colors, width) {
    const base = plotlyLayout();
    const titleFont = { color: colors.fgMuted, size: 12 };
    const narrow = width && width < NARROW_CHART_PX;
    return compact({
        ...base,
        margin: { l: 64, r: 64, t: 24, b: 44 },
        hovermode: "closest",
        bargap: model.maxGeneration > 100 ? 0.15 : 0.4, // hundreds of thin bars with wide gaps shimmer
        legend: { ...base.legend, y: 1.18 },
        xaxis: generationAxis(base.xaxis, model.maxGeneration, colors, width),
        yaxis: { ...base.yaxis, title: { text: narrow ? "" : "Cost per generation", font: titleFont }, tickprefix: "$", rangemode: "tozero" },
        yaxis2: {
            ...base.yaxis, title: { text: narrow ? "" : "Cumulative cost", font: titleFont }, tickprefix: "$", rangemode: "tozero",
            overlaying: "y", side: "right", showgrid: false,
        },
    }, width);
}

function renderCharts(view, model) {
    const colors = themeColors();
    const width = view.el.score.clientWidth;
    view.theme = currentTheme();
    view.model = model;
    view.narrow = chartIsNarrow(width);
    view.maxTicks = maxTicksFor(width);
    Plotly.react(view.el.score, scoreTraces(model, colors), touchSafeAxes(scoreLayout(model, colors, width)), PLOTLY_CONFIG);
    Plotly.react(view.el.cost, costTraces(model, colors), touchSafeAxes(costLayout(model, colors, width)), PLOTLY_CONFIG);
    bindScoreChart(view);
}

function chartIsNarrow(width) {
    return width > 0 && width < NARROW_CHART_PX;
}

/** Clicking a score point opens its program. Plotly adds gd.on during the first render. */
function bindScoreChart(view) {
    const gd = view.el.score;
    if (view.chartEventsBound || typeof gd.on !== "function") return;
    view.chartEventsBound = true;
    const pointId = (event) => {
        const point = event && event.points && event.points[0];
        return point && Array.isArray(point.customdata) ? point.customdata[0] : null;
    };
    gd.on("plotly_click", (event) => {
        const id = pointId(event);
        if (id !== null && view.onSelect) view.onSelect(id);
    });
    // Plotly's drag layer sets the cursor; show a pointer while a program point is under it.
    const setCursor = (cursor) => {
        const layer = gd.querySelector(".nsewdrag");
        if (layer) layer.style.cursor = cursor;
    };
    gd.on("plotly_hover", (event) => setCursor(pointId(event) !== null ? "pointer" : ""));
    gd.on("plotly_unhover", () => setCursor(""));
}

// ---------- scratchpad ----------

/**
 * The list is refetched when the program count changed or after an interval, so the
 * frequent re-renders (clicks, polls) do not hammer the server. A run without meta
 * files gets an empty list.
 */
function shouldListMetaFiles(view, model) {
    const s = view.scratch;
    const count = model.totals.programCount + model.totals.failedProposalCount;
    if (s.listedCount === count && Date.now() - s.listedAt < META_LIST_INTERVAL_MS) return false;
    s.listedCount = count;
    s.listedAt = Date.now();
    return true;
}

async function renderScratchpad(view, model, api, token) {
    view.api = api;
    if (!shouldListMetaFiles(view, model)) return;
    let files;
    try {
        files = await api.metaFiles(view.dbPath);
    } catch (_) {
        return; // keep whatever is shown; the next refresh retries
    }
    if (token !== view.token) return;
    const sorted = (Array.isArray(files) ? files : [])
        .filter((f) => Number.isFinite(Number(f.processed_count)))
        .sort((a, b) => Number(b.processed_count) - Number(a.processed_count));
    const s = view.scratch;
    s.files = sorted;
    view.el.scratch.hidden = sorted.length === 0;
    if (!sorted.length) return;
    const counts = sorted.map((f) => Number(f.processed_count));
    if (!s.pinned || !counts.includes(s.selected)) { s.selected = counts[0]; s.pinned = false; }
    const options = sorted.map((f) => `<option value="${Number(f.processed_count)}">${Number(f.processed_count)}</option>`).join("");
    if (s.optionsHtml !== options) { s.optionsHtml = options; view.el.select.innerHTML = options; }
    view.el.select.value = String(s.selected);
    await showScratchpad(view, api, token);
}

async function showScratchpad(view, api, token) {
    const s = view.scratch;
    const count = s.selected;
    if (s.shown === count) return;
    let html;
    try {
        if (!s.content.has(count)) s.content.set(count, api.metaContent(view.dbPath, count).then((r) => String(r.content ?? "")));
        html = renderMarkdown(await s.content.get(count));
    } catch (error) {
        s.content.delete(count);
        html = `<div class="empty">Could not load this scratchpad: ${escapeHtml(error.message || String(error))}</div>`;
    }
    if (token !== view.token || s.selected !== count) return;
    view.el.markdown.innerHTML = html;
    s.shown = count;
}

function renderMarkdown(text) {
    let note = "";
    if (text.length > MAX_MARKDOWN_CHARS) {
        note = `<p class="muted">Showing the first ${MAX_MARKDOWN_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters.</p>`;
        text = text.slice(0, MAX_MARKDOWN_CHARS);
    }
    if (!text.trim()) return `<div class="empty">This scratchpad is empty.</div>`;
    // Meta files are trusted local run output written by the summarizer.
    return note + marked.parse(text, { mangle: false, headerIds: false, gfm: true, async: false });
}
