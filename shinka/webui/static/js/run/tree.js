// Tree pane: D3 rendering of the program genealogy.
//
// CONTRACT (main.js depends only on this API)
//
//   const tree = createTree(container, { onSelect(id), onToggle(id) });
//   tree.render(model, { selectedId, expanded, hoveredId })   // idempotent; call on every state change
//   tree.focus(id)      // pan so the node is visible (no selection change)
//   tree.fit()          // fit the visible nodes into the pane, never below a readable scale
//   tree.fit({ whole: true })  // fit the whole visible tree, at any scale
//   tree.isUntouched()  // true while the view still shows the last readable fit(): neither
//                       // the user, a focus() pan nor a whole-tree fit has moved it since
//   tree.handleKey(event, selectedId)  // arrows, Enter and W; returns true when it used the key
//   tree.destroy()
//
// Layout rules:
//   - x position = generation (uniform spacing, generation 0 at the left);
//     y positions come from a tree layout so children sit near their parent.
//     Each node shows its generation number inside the dot; the numbers hide
//     when the zoom makes the dots too small to read them.
//   - Only ids in visibleIds(model, expanded) are drawn. A node with hidden
//     descendants shows a "+N" pill counting all of them; its title names the
//     programs and the failed proposals separately. An expanded node off
//     the best lineage shows a "−" pill while hovered. Clicking a pill calls
//     onToggle(id). Clicking a node calls onSelect(id).
//   - Node fill: viridis over the score range of correct, scored programs; a
//     correct program without a score gets a neutral fill. Incorrect programs
//     and failed proposals match the two legend swatches in run.html. The best
//     program gets a --best ring, the selected node a --select ring, and edges
//     on the best lineage use --lineage.
//   - Pan and zoom with d3.zoom; the wheel zooms, drag pans. Double click fits.
//     Dots, rings and pills keep a readable size on screen when zoomed out:
//     updateGlyphs() sets their scale per zoom level through CSS variables.
//     A fit of a wide, short tree spreads its rows (up to MAX_ROW_SPREAD).
//   - Keys (main.js forwards document keydown): Left = parent, Right = first
//     child, Up/Down = previous/next sibling of the selected program (or the
//     best), Enter = select the hovered node, W = fit the whole tree.
//   - Colours come from the CSS tokens in run.css (tree.css applies them to the
//     SVG), so a theme switch applies at once; only the score fill is computed here.
//   - Re-rendering after an auto-refresh keeps the current pan/zoom.
import {
    descendantsOf, isFailedProposal, isCorrect, displayName, modelName, patchWords, parentOf, scoreRange,
    failureText, scoreOf, scoreDelta, deltaClass, formatScore, formatDelta, escapeHtml,
} from "./model.js";

const COL_W = 64;            // horizontal distance between generations
const ROW_H = 28;            // vertical distance between neighbouring rows before fit() spreads them
const MAX_ROW_SPREAD = 2;    // fit() spreads the rows of a short tree up to this multiple of ROW_H
const MAX_ROW_SPREAD_FOR_DOTS = 2.5; // and spaces rows up to this multiple so dots stay full size
const R = 10;                // node radius in screen px at zoom 1 and when zoomed out (fits a 3-digit generation)
const LABEL_MIN_R = 8;       // generation numbers show only while dots are at least this radius on screen
const LONG_LABEL_MIN_R = 9.5; // three- and four-digit numbers (smaller font) need a little more
const MIN_DOT_R = 1.5;       // smallest dot radius on screen, for whole-tree views
const NODE_GAP_PX = 1;       // dots in neighbouring rows keep at least twice this apart on screen
const EDGE_PAD = R + 8;      // screen space kept around the outermost node centres
const GRID_MIN_PX = 6;       // hide the generation grid when its lines would be closer than this
const FIT_PAD = 24;
const LEGEND_H = 30;         // legend overlap used when the legend cannot be measured
const MAX_FIT_SCALE = 1.5;
const MIN_FIT_SCALE = 0.4;   // fit() never goes below this (generations 25.6 px apart)
const DARK_TEXT = "#1f2328";  // generation number on light fills
const LIGHT_TEXT = "#ffffff"; // and on dark fills
const MIN_SCALE = 0.005;     // the wheel can still zoom out to a whole long run
const MAX_SCALE = 4;
const PAN_TOLERANCE_PX = 3;  // a click that jitters less than this is not a pan
const ANIMATE_LIMIT = 800;   // animate position changes only below this many nodes
const PILL_GAP = 5;          // between the selected ring and the pill
const SELECTED_RING_R = R + 5.5;
const PILL_OFFSET = SELECTED_RING_R + 1.5; // pills start outside the selected ring (radius plus half its stroke)
const PILL_H = 14;
const PILL_PAD = 10;         // pill width = PILL_PAD + PILL_CHAR_W per character
const PILL_CHAR_W = 6.5;     // of the 10px bold pill font set in tree.css
const PILL_MIN_SCALE = 0.8;  // pills stay at least 8px text down to MIN_FIT_SCALE
const GLYPH_STEP = 0.01;     // relative change below which updateGlyphs() skips the style write
const REVEAL_MARGIN = 40;    // focus() pans when the node is closer than this to the edge
const TOOLTIP_OFFSET = 14;
const TOOLTIP_EDGE = 8;
const FAIL_TEXT_MAX = 160;
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const LESS_TITLE = "Hide the programs below";
const LINK = d3.linkHorizontal().x((d) => d.x).y((d) => d.y);

const MARKUP = `
<svg class="tree-svg" role="img" aria-label="Program tree">
    <g class="tree-canvas"><g class="tree-grid"></g><g class="tree-edges"></g><g class="tree-nodes"></g></g>
</svg>
<div class="tree-empty empty" hidden></div>
<div class="tooltip tree-tooltip" hidden></div>`;

export function createTree(container, { onSelect = () => {}, onToggle = () => {} } = {}) {
    container.classList.add("tree--d3");
    container.innerHTML = MARKUP;
    const rect = container.getBoundingClientRect();
    const view = {
        container, onSelect, onToggle,
        svg: d3.select(container).select("svg"),
        tooltip: container.querySelector(".tree-tooltip"),
        empty: container.querySelector(".tree-empty"),
        model: null, selectedId: null, expanded: new Set(),
        nodes: new Map(), bounds: null, gens: [], hoveredId: null, pendingFocus: null,
        width: rect.width, height: rect.height, gridHidden: false,
        touched: false, gestureStart: null, rowH: ROW_H, glyph: null, bridgeX: -(PILL_OFFSET - R) - 1,
    };
    view.canvas = view.svg.select(".tree-canvas");
    view.grid = view.canvas.select(".tree-grid");
    view.nodeLayer = view.canvas.select(".tree-nodes");
    view.lessPill = d3.create("svg:g").attr("class", "tree-pill tree-pill--less").call(buildPill, view);
    view.zoom = d3.zoom().scaleExtent([MIN_SCALE, MAX_SCALE])
        .on("start", (event) => { hideTooltip(view); view.gestureStart = event.transform; })
        .on("zoom", (event) => onZoom(view, event));
    view.svg.call(view.zoom).on("dblclick.zoom", null)
        .on("dblclick", (event) => { if (!event.target.closest(".tree-node")) fit(view); });
    // Cache the pane size so zoom frames never force a layout by reading it.
    view.resize = new ResizeObserver(([entry]) => {
        view.width = entry.contentRect.width;
        view.height = entry.contentRect.height;
    });
    view.resize.observe(container);
    updateGlyphs(view, 1);
    return {
        render(model, state = {}) { render(view, model, state); },
        focus(id) { focusNode(view, id); },
        fit(options) { fit(view, options); },
        isUntouched() { return !view.touched; },
        handleKey(event, selectedId) { return handleKey(view, event, selectedId); },
        destroy() {
            view.resize.disconnect();
            view.svg.on(".zoom", null).on("dblclick", null);
            container.innerHTML = "";
            container.classList.remove("tree--d3");
        },
    };
}

function onZoom(view, event) {
    const t = event.transform;
    updateGrid(view, t.k);
    updateGlyphs(view, t.k);
    view.canvas.attr("transform", t);
    // Programmatic moves (fit, focus) have no sourceEvent; only the user's own pan or zoom counts.
    const start = view.gestureStart;
    if (event.sourceEvent && start && (t.k !== start.k || Math.hypot(t.x - start.x, t.y - start.y) > PAN_TOLERANCE_PX)) {
        view.touched = true;
    }
}


// ---------- rendering ----------

function render(view, model, state) {
    view.model = model;
    view.selectedId = state.selectedId ?? null;
    view.expanded = state.expanded || new Set();
    const { nodes, edges } = layout(model, view.expanded, view.rowH);
    const animate = view.nodes.size > 0 && nodes.length <= ANIMATE_LIMIT;
    view.nodes = new Map(nodes.map((n) => [n.id, n]));
    if (view.hoveredId !== null && !view.nodes.has(view.hoveredId)) leaveNode(view);
    drawEdges(view.canvas.select(".tree-edges"), edges, model.bestLineage, animate);
    drawNodes(view, nodes, scoreColour(model), animate);
    view.bounds = bounds(nodes, view.rowH);
    view.gens = nodes.length ? d3.range(d3.min(nodes, (n) => n.gen), d3.max(nodes, (n) => n.gen) + 1) : [];
    drawGrid(view);
    view.empty.hidden = nodes.length > 0;
    view.empty.textContent = model.programs.size ? "Nothing to show" : "No programs in this run yet";
    if (view.pendingFocus !== null) revealNode(view, view.pendingFocus);
}

/**
 * Lay out the visible subset. Depth in the hierarchy is made equal to the
 * generation by inserting invisible spacer nodes along edges that skip
 * generations, so d3.tree keeps nodes of one generation from overlapping.
 * Spacers to the right of a "+N" pill keep its row free of other nodes.
 */
function layout(model, expanded, rowH) {
    const root = { children: [] };
    const nodes = [];
    const stack = model.roots.slice().reverse().map((id) => [root, -1, id]);
    while (stack.length) {
        const [parentHolder, parentGen, id] = stack.pop();
        const program = model.programs.get(id);
        if (!program) continue;
        const node = { id, program, gen: Number(program.generation) || 0, children: [], pill: pillFor(model, program, expanded) };
        nodes.push(node);
        let holder = parentHolder;
        for (let g = parentGen + 1; g < node.gen; g++) {
            const spacer = { children: [] };
            holder.children.push(spacer);
            holder = spacer;
        }
        holder.children.push(node);
        if (expanded.has(id)) for (let i = program.children.length - 1; i >= 0; i--) stack.push([node, node.gen, program.children[i]]);
        else if (node.pill) reservePillRow(node);
    }
    const hierarchy = d3.hierarchy(root);
    d3.tree().nodeSize([1, COL_W]).separation(() => 1)(hierarchy);
    for (const h of hierarchy.descendants()) {
        if (h.data.id === undefined) continue;
        h.data.x = h.data.gen * COL_W;
        h.data.row = h.x;
        h.data.y = h.x * rowH;
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = nodes.filter((n) => byId.has(n.program.parent_id)).map((n) => ({ source: byId.get(n.program.parent_id), target: n }));
    return { nodes, edges };
}

/**
 * One invisible spacer per column that a "+N" pill reaches into at MIN_FIT_SCALE,
 * where columns are narrowest on screen (below that scale the pill shrinks with the zoom).
 */
function reservePillRow(node) {
    const columns = Math.ceil((R + PILL_OFFSET + PILL_GAP + node.pill.width) / (COL_W * MIN_FIT_SCALE) - 1);
    let holder = node;
    for (let i = 0; i < Math.max(1, columns); i++) {
        const spacer = { children: [] };
        holder.children.push(spacer);
        holder = spacer;
    }
}

function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "4 hidden programs and 1 failed proposal": #tree-summary counts only the programs. */
function hiddenWords(model, hidden) {
    const failed = hidden.filter((id) => isFailedProposal(model.programs.get(id))).length;
    const programs = hidden.length - failed;
    const parts = [];
    if (programs) parts.push(plural(programs, "hidden program"));
    if (failed) parts.push(plural(failed, programs ? "failed proposal" : "hidden failed proposal"));
    return parts.join(" and ");
}

function pillFor(model, program, expanded) {
    const hidden = expanded.has(program.id) ? [] : descendantsOf(model, program.id);
    let pill = null;
    if (hidden.length) {
        const words = hiddenWords(model, hidden);
        pill = { kind: "more", label: `+${hidden.length}`, id: program.id, title: `Show ${words}`, hint: `${words} below` };
    } else if (expanded.has(program.id) && program.children.length && !model.bestLineage.has(program.id)) {
        pill = { kind: "less", label: "−", id: program.id, title: LESS_TITLE };
    }
    if (pill) pill.width = PILL_PAD + pill.label.length * PILL_CHAR_W;
    return pill;
}

/** Fill for a program: viridis over the scores of correct programs, or null (CSS decides) when unscored. */
function scoreColour(model) {
    const range = scoreRange(model.generations.flatMap((g) => g.scores));
    const mid = d3.interpolateViridis(0.5);
    // Clamped: an outlier below the range takes the lowest colour instead of stretching the scale.
    const scale = !range || range.lo === range.hi ? () => mid : d3.scaleSequential(d3.interpolateViridis).domain([range.lo, range.hi]).clamp(true);
    return (program) => {
        const score = scoreOf(program);
        return isCorrect(program) && Number.isFinite(score) ? scale(score) : null;
    };
}

function dotClass(program) {
    if (isFailedProposal(program)) return "tree-dot is-failed";
    if (!isCorrect(program)) return "tree-dot is-incorrect";
    return Number.isFinite(scoreOf(program)) ? "tree-dot" : "tree-dot is-unscored";
}

/** Readable number colour on a computed fill; null leaves it to tree.css (unscored, incorrect, failed). */
function labelColour(fill) {
    if (!fill) return null;
    const { r, g, b } = d3.rgb(fill);
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // Pick the text colour with the higher contrast ratio (DARK_TEXT luminance is about 0.016).
    return (luminance + 0.05) / 0.066 > 1.05 / (luminance + 0.05) ? DARK_TEXT : LIGHT_TEXT;
}

function maybeAnimate(selection, animate) {
    return animate ? selection.transition().duration(200) : selection;
}

function drawEdges(layer, edges, lineage, animate) {
    const paths = layer.selectAll("path").data(edges, (d) => d.target.id)
        .join((enter) => enter.append("path").attr("d", LINK));
    paths.attr("class", (d) => {
        const onLineage = lineage.has(d.source.id) && lineage.has(d.target.id);
        return `tree-edge${onLineage ? " is-lineage" : ""}${isFailedProposal(d.target.program) ? " is-failed" : ""}`;
    });
    paths.filter(".is-lineage").raise();
    maybeAnimate(paths, animate).attr("d", LINK);
}

function drawNodes(view, nodes, colour, animate) {
    const bestId = view.model.best ? view.model.best.id : null;
    const groups = view.nodeLayer.selectAll("g.tree-node").data(nodes, (d) => d.id)
        .join((enter) => {
            const g = enter.append("g").attr("class", "tree-node").attr("transform", (d) => `translate(${d.x},${d.y})`);
            g.append("circle").attr("class", "tree-dot").attr("r", R);
            g.append("text").attr("class", "tree-label");
            // Pointer events with a mouse check: touch taps would otherwise leave a hover
            // (and its "−" pill) stuck on the node, since a tap sends no mouseleave.
            g.on("click", (event, d) => { event.stopPropagation(); if (view.hoveredId !== null && event.pointerType !== "mouse") leaveNode(view); view.onSelect(d.id); })
                .on("pointerenter", (event, d) => { if (event.pointerType === "mouse") enterNode(view, event, d); })
                .on("pointermove", (event) => { if (event.pointerType === "mouse") placeTooltip(view, event); })
                .on("pointerleave", (event) => { if (event.pointerType === "mouse") leaveNode(view); });
            return g;
        });
    groups.each(function (d) { d.el = this; });
    maybeAnimate(groups, animate).attr("transform", (d) => `translate(${d.x},${d.y})`);
    groups.select(".tree-dot")
        .attr("class", (d) => dotClass(d.program))
        .attr("fill", (d) => colour(d.program));
    groups.select(".tree-label")
        .attr("class", (d) => `tree-label tree-label--${Math.min(4, String(d.gen).length)}`)
        // Inline style: a stylesheet fill would override a fill attribute.
        .style("fill", (d) => labelColour(colour(d.program)))
        .text((d) => d.gen);
    groups.selectAll("circle.tree-ring")
        .data((d) => [d.id === bestId && "best", d.id === view.selectedId && "selected"].filter(Boolean), (kind) => kind)
        .join((enter) => enter.append("circle")
            .attr("class", (kind) => `tree-ring tree-ring--${kind}`)
            .attr("r", (kind) => (kind === "best" ? R + 3 : SELECTED_RING_R)));
    drawPills(view, groups);
}

/** "+N" pills are part of the data join; the "−" pill is one shared element moved to the hovered node. */
function drawPills(view, groups) {
    groups.selectAll("g.tree-pill--more").data((d) => (d.pill && d.pill.kind === "more" ? [d.pill] : []), (p) => p.id)
        .join((enter) => enter.append("g").attr("class", "tree-pill tree-pill--more").call(buildPill, view))
        .call(updatePill);
    syncLessPill(view);
}

/** Pill geometry starts at the dot's edge; tree.css moves it there and scales it (see updateGlyphs). */
function buildPill(g, view) {
    g.append("title");
    // Invisible bridge over the gap so the hover survives the move from dot to pill.
    // It starts just inside the dot's edge and reaches the pill box; updateGlyphs() keeps
    // it there as the zoom changes the dot and pill scales.
    g.append("rect").attr("class", "tree-pill__bridge").attr("y", -PILL_H / 2).attr("height", PILL_H).call(placeBridge, view.bridgeX);
    g.append("rect").attr("class", "tree-pill__box").attr("x", PILL_GAP).attr("y", -PILL_H / 2).attr("height", PILL_H).attr("rx", PILL_H / 2);
    g.append("text").attr("y", 0);
    // The pill has its own title, so the node tooltip steps aside while the pointer is on it.
    g.on("pointerenter", (event) => { if (event.pointerType === "mouse") view.tooltip.hidden = true; })
        .on("pointerleave", (event) => { if (event.pointerType === "mouse") showTooltip(view, event); })
        .on("click", (event, p) => {
            event.stopPropagation();
            leaveNode(view);
            // Browsers move inexact taps onto nearby targets; a touch on the bridge was meant for the dot.
            if (event.pointerType !== "mouse" && event.target.classList.contains("tree-pill__bridge")) view.onSelect(p.id);
            else view.onToggle(p.id);
        });
}

function placeBridge(rect, x) {
    rect.attr("x", x).attr("width", PILL_GAP - x);
}

function updatePill(pills) {
    pills.select("title").text((p) => p.title);
    pills.select(".tree-pill__box").attr("width", (p) => p.width);
    pills.select("text").attr("x", (p) => PILL_GAP + p.width / 2).text((p) => p.label);
}

function syncLessPill(view) {
    const node = view.hoveredId === null ? null : view.nodes.get(view.hoveredId);
    if (!node || !node.pill || node.pill.kind !== "less" || !node.el) { view.lessPill.remove(); return; }
    view.lessPill.datum(node.pill).call(updatePill);
    if (view.lessPill.node().parentNode !== node.el) node.el.appendChild(view.lessPill.node());
    // Zoomed out, the pill reaches into the next column; draw this node above its neighbours.
    if (node.el.nextSibling) node.el.parentNode.appendChild(node.el);
}

/**
 * Extent of the node centres, the number of row spacings it spans, and how far
 * (screen px) a "+N" pill in the last column reaches past EDGE_PAD.
 */
function bounds(nodes, rowH) {
    if (!nodes.length) return null;
    const b = { x0: d3.min(nodes, (n) => n.x), x1: d3.max(nodes, (n) => n.x), y0: d3.min(nodes, (n) => n.y), y1: d3.max(nodes, (n) => n.y) };
    b.rows = (b.y1 - b.y0) / rowH;
    const reach = (n) => (n.x === b.x1 && n.pill && n.pill.kind === "more" ? PILL_OFFSET + PILL_GAP + n.pill.width - EDGE_PAD : 0);
    b.rightPx = Math.max(0, d3.max(nodes, reach));
    return b;
}

function drawGrid(view) {
    const b = view.bounds;
    view.grid.selectAll("line").data(b ? view.gens : [], (g) => g).join("line")
        .attr("x1", (g) => g * COL_W).attr("x2", (g) => g * COL_W)
        .attr("y1", b ? b.y0 - view.rowH : 0).attr("y2", b ? b.y1 + view.rowH : 0);
}

/** Move every node to a new row spacing (fit() spreads the rows of a short tree). */
function placeRows(view, rowH) {
    if (rowH === view.rowH) return;
    view.rowH = rowH;
    const nodes = [...view.nodes.values()];
    for (const n of nodes) n.y = n.row * rowH;
    const animate = nodes.length <= ANIMATE_LIMIT;
    maybeAnimate(view.nodeLayer.selectAll("g.tree-node"), animate).attr("transform", (d) => `translate(${d.x},${d.y})`);
    maybeAnimate(view.canvas.select(".tree-edges").selectAll("path"), animate).attr("d", LINK);
    view.bounds = bounds(nodes, rowH);
    drawGrid(view);
    updateGlyphs(view, d3.zoomTransform(view.svg.node()).k);
}

/**
 * Screen size of the glyphs at zoom k. Dots keep their nominal radius R when
 * zoomed out, as long as neighbouring rows leave room, and grow when zoomed in.
 * Pills keep their nominal size up to zoom 1 and at least PILL_MIN_SCALE down
 * to MIN_FIT_SCALE; below that (whole-tree views) both shrink with the zoom.
 * The canvas is scaled by k, so the CSS variables hold screen size / k.
 */
function updateGlyphs(view, k) {
    const rowPx = view.rowH * k;
    const node = Math.max(k, MIN_DOT_R / R, Math.min(1, (rowPx / 2 - NODE_GAP_PX) / R));
    const readable = Math.min(1, Math.max(PILL_MIN_SCALE, (view.rowH * Math.max(k, MIN_FIT_SCALE)) / PILL_H));
    const next = [node / k, (readable * Math.min(1, k / MIN_FIT_SCALE)) / k];
    view.nodeLayer.classed("tree-nodes--no-labels", R * node < LABEL_MIN_R)
        .classed("tree-nodes--no-long-labels", R * node < LONG_LABEL_MIN_R);
    if (view.glyph && next.every((v, i) => Math.abs(v / view.glyph[i] - 1) < GLYPH_STEP)) return;
    view.glyph = next;
    // On the node layer only: a variable change restyles every element below it.
    const style = view.nodeLayer.node().style;
    style.setProperty("--tree-node-scale", String(next[0]));
    style.setProperty("--tree-pill-scale", String(next[1]));
    style.setProperty("--tree-pill-x", `${PILL_OFFSET * next[0]}px`);
    // The dot's edge in the pill's own (translated and scaled) coordinates, less one unit of overlap.
    view.bridgeX = -((PILL_OFFSET - R) * next[0]) / next[1] - 1;
    view.nodeLayer.selectAll(".tree-pill__bridge").call(placeBridge, view.bridgeX);
    if (view.lessPill) view.lessPill.select(".tree-pill__bridge").call(placeBridge, view.bridgeX);
}

/** Hide the generation grid when its lines would crowd together. */
function updateGrid(view, k) {
    const gridHidden = k * COL_W < GRID_MIN_PX;
    if (gridHidden === view.gridHidden) return;
    view.gridHidden = gridHidden;
    view.grid.attr("display", gridHidden ? "none" : null);
}

// ---------- pan and zoom ----------

function applyTransform(view, transform, animate) {
    (animate ? view.svg.transition().duration(250) : view.svg).call(view.zoom.transform, transform);
}

/** Pixels at the bottom of the pane covered by the legend overlay. */
function legendOverlap(view, rect) {
    const legend = view.container.parentElement && view.container.parentElement.querySelector(".legend");
    if (!legend) return LEGEND_H;
    const box = legend.getBoundingClientRect();
    return box.height ? Math.max(0, rect.bottom - box.top) : 0;
}

/**
 * Fit the visible tree into the pane. Below MIN_FIT_SCALE nodes get too small to
 * read, so a tree too wide at that scale shows its newest generations (the right
 * edge), and a tree too tall keeps the selected program, or else the best, in view.
 * { whole: true } drops that limit and shows the whole tree.
 */
function fit(view, { whole = false } = {}) {
    // A refresh refits an untouched view; it must not swap a whole-tree view for the readable one.
    view.touched = whole;
    const rect = view.container.getBoundingClientRect();
    view.width = rect.width;
    view.height = rect.height;
    if (!rect.width || !rect.height) return;
    const b = view.bounds;
    if (!b) { applyTransform(view, d3.zoomIdentity, false); return; }
    // The box the node centres must stay in.
    const box = {
        left: FIT_PAD + EDGE_PAD, right: Math.max(FIT_PAD + EDGE_PAD, rect.width - FIT_PAD - EDGE_PAD - b.rightPx),
        top: FIT_PAD + EDGE_PAD, bottom: Math.max(FIT_PAD + EDGE_PAD, rect.height - legendOverlap(view, rect) - FIT_PAD - EDGE_PAD),
    };
    const w = box.right - box.left, h = box.bottom - box.top;
    const kx = b.x1 > b.x0 ? w / (b.x1 - b.x0) : Infinity;
    const ky = b.rows > 0 ? h / (b.rows * ROW_H) : Infinity;
    const k = Math.max(whole ? MIN_SCALE : MIN_FIT_SCALE, Math.min(MAX_FIT_SCALE, kx, ky));
    const tx = k * (b.x1 - b.x0) <= w ? (box.left + box.right - k * (b.x0 + b.x1)) / 2 : box.right - k * b.x1;
    // Spread the rows in view into the height the zoom leaves free (none when the height sets the zoom).
    const rows = k < MAX_FIT_SCALE ? rowSpan(view, k, tx) : 0;
    // A readable fit also spaces rows far enough apart for full-size, numbered dots.
    const minSpread = whole ? 1 : Math.min(MAX_ROW_SPREAD_FOR_DOTS, Math.max(1, (2 * (R + NODE_GAP_PX)) / (k * ROW_H)));
    const spread = Math.max(minSpread, rows > 0 ? Math.min(MAX_ROW_SPREAD, Math.max(1, h / (k * rows * ROW_H))) : 1);
    placeRows(view, Math.round(ROW_H * spread * 2) / 2);
    applyTransform(view, d3.zoomIdentity.translate(tx, focusTy(view, k, tx, box)).scale(k), true);
}

/** Nodes whose centre is inside the pane horizontally at zoom k and pan tx. */
function nodesInView(view, k, tx) {
    return [...view.nodes.values()].filter((n) => k * n.x + tx >= 0 && k * n.x + tx <= view.width);
}

/** Number of row spacings between the top and bottom node in view. */
function rowSpan(view, k, tx) {
    const shown = nodesInView(view, k, tx);
    return shown.length ? d3.max(shown, (n) => n.row) - d3.min(shown, (n) => n.row) : 0;
}

/**
 * Vertical offset for fit(). Among the nodes in view horizontally: centre them
 * all when they fit; otherwise centre the selected program, else the best, else
 * the newest, without leaving empty space above their first row or below their last.
 */
function focusTy(view, k, tx, box) {
    const { model } = view;
    const shown = nodesInView(view, k, tx);
    const centreOn = (y) => (box.top + box.bottom) / 2 - k * y;
    if (!shown.length) return centreOn((view.bounds.y0 + view.bounds.y1) / 2);
    const y0 = d3.min(shown, (n) => n.y), y1 = d3.max(shown, (n) => n.y);
    if (k * (y1 - y0) <= box.bottom - box.top) return centreOn((y0 + y1) / 2);
    const inView = new Set(shown);
    const focus = [view.selectedId, model.best && model.best.id, model.totals && model.totals.newestId]
        .map((id) => view.nodes.get(id)).find((n) => n && inView.has(n));
    const ty = centreOn(focus ? focus.y : (y0 + y1) / 2);
    return Math.min(box.top - k * y0, Math.max(box.bottom - k * y1, ty));
}

// main.js calls focus(id) before the render that makes the node visible, so the
// pan waits for the next render; a microtask covers a focus with no render after it.
function focusNode(view, id) {
    view.pendingFocus = id;
    queueMicrotask(() => { if (view.pendingFocus === id) revealNode(view, id); });
}

function revealNode(view, id) {
    view.pendingFocus = null;
    const node = view.nodes.get(id);
    const { width, height } = view;
    if (!node || !width || !height) return;
    const t = d3.zoomTransform(view.svg.node());
    const [px, py] = t.apply([node.x, node.y]);
    const m = REVEAL_MARGIN;
    if (px >= m && px <= width - m && py >= m && py <= height - m) return;
    const next = d3.zoomIdentity.translate(width / 2 - t.k * node.x, height / 2 - t.k * node.y).scale(t.k);
    // The view no longer shows the last fit, so a refresh must not refit it away from this node.
    view.touched = true;
    applyTransform(view, next, true);
}

// ---------- keyboard ----------

function handleKey(view, event, selectedId) {
    if (!view.model || event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === "w" || event.key === "W") {
        fit(view, { whole: true });
        return true;
    }
    if (event.key === "Enter") {
        // Leave Enter to a focused button or link.
        const target = event.target;
        if (view.hoveredId === null || (target && target.closest && target.closest("button, a, summary, input, select, textarea"))) return false;
        go(view, view.hoveredId);
        return true;
    }
    if (!ARROW_KEYS.has(event.key)) return false;
    const next = arrowTarget(view, event.key, selectedId);
    if (!next) return true;
    // Only a first child can be hidden: show its parent's subtree before moving there.
    if (!view.nodes.has(next)) view.onToggle(view.model.programs.get(next).parent_id);
    go(view, next);
    return true;
}

function go(view, id) {
    focusNode(view, id);
    view.onSelect(id);
}

/** The program an arrow key moves to from the selected program (or the best), or null. */
function arrowTarget(view, key, selectedId) {
    const { model } = view;
    const id = view.nodes.has(selectedId) ? selectedId : model.best && model.best.id;
    const program = id ? model.programs.get(id) : null;
    if (!program) return null;
    // A program in a parent cycle is drawn as a root, so it moves among the roots.
    const parent = model.roots.includes(id) ? null : parentOf(model, program);
    const siblings = parent ? parent.children : model.roots;
    const index = siblings.indexOf(id);
    if (key === "ArrowLeft") return parent && view.nodes.has(parent.id) ? parent.id : null;
    if (key === "ArrowUp") return index > 0 ? siblings[index - 1] : null;
    if (key === "ArrowDown") return index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
    return program.children.length ? program.children[0] : null;
}

// ---------- hover and tooltip ----------

function enterNode(view, event, node) {
    view.hoveredId = node.id;
    showTooltip(view, event);
    syncLessPill(view);
}

function showTooltip(view, event) {
    const node = view.nodes.get(view.hoveredId);
    if (!node) return;
    view.tooltip.innerHTML = tooltipHtml(view.model, node);
    view.tooltip.hidden = false;
    placeTooltip(view, event);
}

function leaveNode(view) {
    view.hoveredId = null;
    hideTooltip(view);
    syncLessPill(view);
}

function hideTooltip(view) {
    view.tooltip.hidden = true;
}

function placeTooltip(view, event) {
    if (view.tooltip.hidden) return;
    const rect = view.container.getBoundingClientRect();
    const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
    const w = view.tooltip.offsetWidth, h = view.tooltip.offsetHeight;
    let x = cx + TOOLTIP_OFFSET, y = cy + TOOLTIP_OFFSET;
    if (x + w > rect.width - TOOLTIP_EDGE) x = Math.max(TOOLTIP_EDGE, cx - w - TOOLTIP_OFFSET);
    if (y + h > rect.height - TOOLTIP_EDGE) y = Math.max(TOOLTIP_EDGE, cy - h - TOOLTIP_OFFSET);
    view.tooltip.style.left = `${x}px`;
    view.tooltip.style.top = `${y}px`;
}

function tooltipHtml(model, node) {
    const program = node.program;
    const isBest = model.best && model.best.id === program.id;
    const facts = [`Generation ${program.generation ?? "–"}`, patchWords(program), modelName(program)].filter(Boolean).map(escapeHtml);
    const rows = [
        `<div class="tree-tooltip__name">${escapeHtml(displayName(program))}${isBest ? ' <span class="pill pill--best">best</span>' : ""}</div>`,
        `<div class="muted">${facts.join(" · ")}</div>`,
    ];
    if (isCorrect(program)) {
        const delta = scoreDelta(program, parentOf(model, program));
        const text = formatDelta(delta);
        rows.push(`<div>Score ${formatScore(program.combined_score)}${text ? ` <span class="${deltaClass(delta)}">${text} vs parent</span>` : ""}</div>`);
    } else {
        const reason = String(failureText(program) || "");
        rows.push(`<div class="tree-tooltip__fail">${escapeHtml(reason.length > FAIL_TEXT_MAX ? `${reason.slice(0, FAIL_TEXT_MAX)}…` : reason)}</div>`);
    }
    if (node.pill && node.pill.kind === "more") rows.push(`<div class="muted">${escapeHtml(node.pill.hint)}</div>`);
    return rows.join("");
}
