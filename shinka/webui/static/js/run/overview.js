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
//       hover shows generation and score. Use plotlyLayout() from theme.js and
//       PLOTLY_CONFIG; re-render on theme change (onThemeChange).
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
import { displayName, escapeHtml, formatCost, formatDuration, formatScore } from "./model.js";
import { PLOTLY_CONFIG, currentTheme, onThemeChange, plotlyLayout, themeColors } from "./theme.js";

const views = new WeakMap(); // container -> view
const MAX_MARKDOWN_CHARS = 200000;
let themeSubscription = null; // { view, unsubscribe } for the overview that is on screen

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
    subscribeTheme(view);
    await renderScratchpad(view, model, api, token);
}

// ---------- skeleton ----------

function createView(container, dbPath) {
    container.innerHTML = `
        <div class="overview">
            <div class="overview__header">
                <h2>Run overview</h2>
                <span class="muted mono overview__path" title="${escapeHtml(dbPath || "")}">${escapeHtml(dbPath || "")}</span>
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
    const root = container.firstElementChild;
    const q = (selector) => root.querySelector(selector);
    const view = {
        root, dbPath, token: 0, onSelect: null, theme: null,
        cardsHtml: null,
        scratch: { files: [], selected: null, pinned: false, shown: null, optionsHtml: null, content: new Map(), listedCount: null, listedAt: 0 },
        el: {
            empty: q(".overview__empty"), body: q(".overview__body"), cards: q(".overview__cards"),
            score: q('[data-chart="score"]'), cost: q('[data-chart="cost"]'),
            scratch: q(".overview__scratch"), select: q(".overview__select"), markdown: q(".markdown"),
        },
    };
    view.el.cards.addEventListener("click", (event) => {
        const button = event.target.closest("[data-select]");
        if (button && view.onSelect) view.onSelect(button.dataset.select);
    });
    view.el.select.addEventListener("change", () => {
        view.scratch.selected = Number(view.el.select.value);
        view.scratch.pinned = true;
        showScratchpad(view, view.api, ++view.token);
    });
    // The divider does not fire a window resize, so watch the chart boxes themselves.
    view.resizeObserver = new ResizeObserver(() => {
        for (const gd of [view.el.score, view.el.cost]) {
            // Plotly rejects a resize of a hidden or detached chart; those are resized on the next render.
            if (gd._fullLayout && gd.offsetParent !== null) Plotly.Plots.resize(gd).catch(() => {});
        }
    });
    view.resizeObserver.observe(view.el.score);
    view.resizeObserver.observe(view.el.cost);
    // Another panel (the program view) replaces the container's children; free the charts right away.
    view.mutationObserver = new MutationObserver(() => { if (root.parentNode !== container) destroyView(view); });
    view.mutationObserver.observe(container, { childList: true });
    return view;
}

function destroyView(view) {
    if (view.destroyed) return;
    view.destroyed = true;
    view.token += 1;
    view.resizeObserver.disconnect();
    view.mutationObserver.disconnect();
    if (themeSubscription && themeSubscription.view === view) { themeSubscription.unsubscribe(); themeSubscription = null; }
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
    const correctPct = t.programCount ? Math.round((100 * t.correctCount) / t.programCount) : 0;
    const cards = [
        statCard("Programs", String(t.programCount), `${correctPct}% correct`),
        best
            ? statCard("Best score", formatScore(best.combined_score), `generation ${best.generation} · ${displayName(best)}`,
                { selectId: best.id, title: `Open ${displayName(best)}` })
            : statCard("Best score", "–", "no correct program yet"),
        statCard("Generations", String(model.maxGeneration), null),
        statCard("Total cost", formatCost(t.totalCost), null),
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
function generationStep(maxGeneration) {
    for (const step of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) {
        if (maxGeneration / step <= 12) return step;
    }
    return Math.ceil(maxGeneration / 12);
}

function generationAxis(base, maxGeneration, colors) {
    return {
        ...base,
        title: { text: "Generation", font: { color: colors.fgMuted, size: 12 } },
        tickmode: "linear", tick0: 0, dtick: generationStep(maxGeneration),
        range: [-0.5, maxGeneration + 0.5],
    };
}

function scoreTraces(model, colors) {
    const programX = [], programY = [];
    for (const gen of model.generations) {
        for (const score of gen.scores) { programX.push(gen.generation); programY.push(score); }
    }
    return [
        {
            type: "scatter", mode: "markers", name: "Program",
            x: programX, y: programY,
            marker: { size: 6, color: colors.fgFaint, opacity: 0.75 },
            hovertemplate: "gen %{x}: %{y:.4f}",
        },
        {
            type: "scatter", mode: "lines+markers", name: "Best so far",
            x: model.generations.map((g) => g.generation),
            y: model.generations.map((g) => g.bestSoFar),
            connectgaps: false,
            line: { color: colors.accent, width: 2, shape: "linear" },
            marker: { size: 7, color: colors.accent, line: { color: colors.bgElev, width: 1.5 } },
            hovertemplate: "gen %{x}: %{y:.4f}",
        },
    ];
}

function scoreLayout(model, colors) {
    const base = plotlyLayout();
    return {
        ...base,
        margin: { l: 56, r: 16, t: 24, b: 44 },
        hovermode: "closest",
        legend: { ...base.legend, y: 1.18 },
        xaxis: generationAxis(base.xaxis, model.maxGeneration, colors),
        yaxis: { ...base.yaxis, title: { text: "Score", font: { color: colors.fgMuted, size: 12 } } },
    };
}

function costTraces(model, colors) {
    const x = model.generations.map((g) => g.generation);
    return [
        {
            type: "bar", name: "Per generation",
            x, y: model.generations.map((g) => g.cost),
            marker: { color: colors.fgFaint, opacity: 0.6 },
            hovertemplate: "gen %{x}: $%{y:.4f}",
        },
        {
            type: "scatter", mode: "lines+markers", name: "Cumulative", yaxis: "y2",
            x, y: model.generations.map((g) => g.cumulativeCost),
            line: { color: colors.accent, width: 2, shape: "linear" },
            marker: { size: 6, color: colors.accent, line: { color: colors.bgElev, width: 1.5 } },
            hovertemplate: "gen %{x}: $%{y:.4f}",
        },
    ];
}

function costLayout(model, colors) {
    const base = plotlyLayout();
    const titleFont = { color: colors.fgMuted, size: 12 };
    return {
        ...base,
        margin: { l: 64, r: 64, t: 24, b: 44 },
        hovermode: "closest",
        bargap: model.maxGeneration > 100 ? 0.15 : 0.4, // hundreds of thin bars with wide gaps shimmer
        legend: { ...base.legend, y: 1.18 },
        xaxis: generationAxis(base.xaxis, model.maxGeneration, colors),
        yaxis: { ...base.yaxis, title: { text: "Cost per generation", font: titleFont }, tickprefix: "$", rangemode: "tozero" },
        yaxis2: {
            ...base.yaxis, title: { text: "Cumulative cost", font: titleFont }, tickprefix: "$", rangemode: "tozero",
            overlaying: "y", side: "right", showgrid: false,
        },
    };
}

function renderCharts(view, model) {
    const colors = themeColors();
    view.theme = currentTheme();
    view.model = model;
    Plotly.react(view.el.score, scoreTraces(model, colors), scoreLayout(model, colors), PLOTLY_CONFIG);
    Plotly.react(view.el.cost, costTraces(model, colors), costLayout(model, colors), PLOTLY_CONFIG);
}

function subscribeTheme(view) {
    if (themeSubscription) themeSubscription.unsubscribe();
    const unsubscribe = onThemeChange((theme) => {
        // main.js re-renders on a theme change too; skip when that already repainted with this theme.
        if (view.destroyed || !view.model || view.theme === theme) return;
        renderCharts(view, view.model);
    });
    themeSubscription = { view, unsubscribe };
}

// ---------- scratchpad ----------

/**
 * The list is refetched when the program count changed or after an interval, so the
 * frequent re-renders (clicks, polls) do not hammer the server; a run without a
 * meta directory answers 404, which the browser logs, so that case backs off further.
 */
function shouldListMetaFiles(view, model) {
    const s = view.scratch;
    const interval = s.files.length ? 15000 : 60000;
    const count = model.totals.programCount + model.totals.failedProposalCount;
    if (s.listedCount === count && Date.now() - s.listedAt < interval) return false;
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
