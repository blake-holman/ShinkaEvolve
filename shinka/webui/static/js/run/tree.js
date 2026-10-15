// Tree pane: D3 rendering of the program genealogy.
//
// CONTRACT (main.js depends only on this API)
//
//   const tree = createTree(container, { onSelect(id), onToggle(id) });
//   tree.render(model, { selectedId, expanded, hoveredId })   // idempotent; call on every state change
//   tree.focus(id)      // pan so the node is visible (no selection change)
//   tree.fit()          // fit all visible nodes into the pane
//   tree.destroy()
//
// Layout rules:
//   - x position = generation (uniform spacing, generation 0 at the left);
//     y positions come from a tree layout so children sit near their parent.
//   - Only ids in visibleIds(model, expanded) are drawn. A node with hidden
//     descendants shows a small "+N" pill (hiddenDescendantCount); clicking the
//     pill calls onToggle(id). Clicking a node calls onSelect(id).
//   - Node fill: viridis over the score range of correct programs
//     (d3.interpolateViridis); failed / incorrect programs use --bad-bg fill with
//     a --bad stroke; failed proposals (isFailedProposal) are drawn as hollow
//     dashed circles. The best program gets a --best ring. The selected node
//     gets a thick --select ring. Edges on the best lineage use --lineage and
//     are thicker; other edges use --border-strong.
//   - Node radius about 7px at zoom 1; labels are not drawn, a tooltip shows
//     displayName, generation, score (and delta from parent), model, patch type.
//   - Pan and zoom with d3.zoom; the wheel zooms, drag pans. Double click fits.
//   - Keyboard when the pane has focus: Left = parent, Right = first child,
//     Up/Down = previous/next sibling, Enter = select hovered. B = best.
//   - Colours come from the CSS tokens in run.css (tree.css applies them to the
//     SVG), so a theme switch applies at once; only the score fill is computed here.
//   - Re-rendering after an auto-refresh must keep the current pan/zoom.
import {
    hiddenDescendantCount, isFailedProposal, isCorrect, displayName, modelName, patchType,
    failureText, scoreDelta, formatScore, formatDelta, escapeHtml,
} from "./model.js";

const COL_W = 64;          // horizontal distance between generations
const ROW_H = 24;          // vertical distance between neighbouring nodes
const R = 7;               // node radius at zoom 1
const AXIS_H = 22;         // height of the generation strip across the top
const LABEL_W = 44;        // room one "gen N" label needs
const FIT_PAD = 36;
const LEGEND_H = 30;       // the legend overlays the bottom-left corner of the pane
const MAX_FIT_SCALE = 1.5;
const MIN_SCALE = 0.005;   // lets fit() show thousands of rows at once
const ANIMATE_LIMIT = 800; // animate position changes only below this many nodes
const PATCH_WORDS = { init: "initial program", diff: "diff patch", full: "full rewrite", cross: "crossover" };

const MARKUP = `
<svg class="tree-svg" role="img" aria-label="Program tree">
    <g class="tree-canvas"><g class="tree-grid"></g><g class="tree-edges"></g><g class="tree-nodes"></g></g>
    <g class="tree-axis"><rect class="tree-axis__bg" width="100%" height="${AXIS_H}"></rect><g class="tree-axis__labels"></g></g>
</svg>
<div class="tree-empty empty" hidden></div>
<div class="tooltip tree-tooltip" hidden></div>`;

export function createTree(container, { onSelect = () => {}, onToggle = () => {} } = {}) {
    container.classList.add("tree--d3");
    container.tabIndex = 0;
    container.innerHTML = MARKUP;
    const view = {
        container, onSelect, onToggle,
        svg: d3.select(container).select("svg"),
        tooltip: container.querySelector(".tree-tooltip"),
        empty: container.querySelector(".tree-empty"),
        model: null, selectedId: null, expanded: new Set(),
        nodes: new Map(), bounds: null, gens: [], hoveredId: null, pendingFocus: null,
    };
    view.canvas = view.svg.select(".tree-canvas");
    view.zoom = d3.zoom().scaleExtent([MIN_SCALE, 4])
        .on("start", () => hideTooltip(view))
        .on("zoom", (event) => {
            view.canvas.attr("transform", event.transform);
            positionAxis(view, event.transform);
        });
    view.svg.call(view.zoom).on("dblclick.zoom", null)
        .on("dblclick", (event) => { if (!event.target.closest(".tree-node")) fit(view); });
    const onKey = (event) => handleKey(view, event);
    container.addEventListener("keydown", onKey);
    return {
        render(model, state = {}) { render(view, model, state); },
        focus(id) { focusNode(view, id); },
        fit() { fit(view); },
        destroy() {
            view.svg.on(".zoom", null).on("dblclick", null);
            container.removeEventListener("keydown", onKey);
            container.innerHTML = "";
            container.removeAttribute("tabindex");
            container.classList.remove("tree--d3");
        },
    };
}


// ---------- rendering ----------

function render(view, model, state) {
    view.model = model;
    view.selectedId = state.selectedId ?? null;
    view.expanded = state.expanded || new Set();
    const { nodes, edges } = layout(model, view.expanded);
    const animate = view.nodes.size > 0 && nodes.length <= ANIMATE_LIMIT;
    drawEdges(view.canvas.select(".tree-edges"), edges, model.bestLineage, animate);
    drawNodes(view, nodes, scoreColour(model), animate);
    view.nodes = new Map(nodes.map((n) => [n.id, n]));
    view.bounds = bounds(nodes);
    view.gens = nodes.length ? d3.range(d3.min(nodes, (n) => n.gen), d3.max(nodes, (n) => n.gen) + 1) : [];
    drawGrid(view);
    drawAxis(view);
    view.empty.hidden = nodes.length > 0;
    view.empty.textContent = model.programs.size ? "Nothing to show" : "No programs in this run yet";
    if (view.hoveredId && !view.nodes.has(view.hoveredId)) hideTooltip(view);
    if (view.pendingFocus !== null) revealNode(view, view.pendingFocus);
}

/**
 * Lay out the visible subset. Depth in the hierarchy is made equal to the
 * generation by inserting invisible spacer nodes along edges that skip
 * generations, so d3.tree keeps nodes of one generation from overlapping.
 */
function layout(model, expanded) {
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
    }
    const hierarchy = d3.hierarchy(root);
    d3.tree().nodeSize([ROW_H, COL_W]).separation(() => 1)(hierarchy);
    for (const h of hierarchy.descendants()) {
        if (h.data.id === undefined) continue;
        h.data.x = h.data.gen * COL_W;
        h.data.y = h.x;
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = nodes.filter((n) => byId.has(n.program.parent_id)).map((n) => ({ source: byId.get(n.program.parent_id), target: n }));
    return { nodes, edges };
}

function pillFor(model, program, expanded) {
    const hidden = hiddenDescendantCount(model, program.id, expanded);
    let pill = null;
    if (hidden > 0) pill = { kind: "more", label: `+${hidden}`, id: program.id };
    else if (expanded.has(program.id) && program.children.length && !model.bestLineage.has(program.id)) pill = { kind: "less", label: "−", id: program.id };
    if (pill) pill.width = 10 + pill.label.length * 6.5;
    return pill;
}

function scoreColour(model) {
    const scores = [...model.programs.values()].filter(isCorrect).map((p) => Number(p.combined_score)).filter(Number.isFinite);
    const [min, max] = d3.extent(scores);
    const mid = d3.interpolateViridis(0.5);
    if (!scores.length || min === max) return () => mid;
    const scale = d3.scaleSequential(d3.interpolateViridis).domain([min, max]);
    return (score) => (Number.isFinite(Number(score)) ? scale(Number(score)) : mid);
}

function maybeAnimate(selection, animate) {
    return animate ? selection.transition().duration(200) : selection;
}

function drawEdges(layer, edges, lineage, animate) {
    const link = d3.linkHorizontal().x((d) => d.x).y((d) => d.y);
    const paths = layer.selectAll("path").data(edges, (d) => d.target.id)
        .join((enter) => enter.append("path").attr("d", link));
    paths.attr("class", (d) => {
        const onLineage = lineage.has(d.source.id) && lineage.has(d.target.id);
        return `tree-edge${onLineage ? " is-lineage" : ""}${isFailedProposal(d.target.program) ? " is-failed" : ""}`;
    });
    paths.filter(".is-lineage").raise();
    maybeAnimate(paths, animate).attr("d", link);
}

function drawNodes(view, nodes, colour, animate) {
    const bestId = view.model.best ? view.model.best.id : null;
    const groups = view.canvas.select(".tree-nodes").selectAll("g.tree-node").data(nodes, (d) => d.id)
        .join((enter) => {
            const g = enter.append("g").attr("class", "tree-node").attr("transform", (d) => `translate(${d.x},${d.y})`);
            g.append("circle").attr("class", "tree-dot").attr("r", R);
            g.on("click", (event, d) => { event.stopPropagation(); view.onSelect(d.id); })
                .on("mouseenter", (event, d) => showTooltip(view, event, d))
                .on("mousemove", (event) => placeTooltip(view, event))
                .on("mouseleave", () => hideTooltip(view));
            return g;
        });
    maybeAnimate(groups, animate).attr("transform", (d) => `translate(${d.x},${d.y})`);
    groups.select(".tree-dot")
        .attr("class", (d) => `tree-dot${isFailedProposal(d.program) ? " is-failed" : isCorrect(d.program) ? "" : " is-incorrect"}`)
        .attr("fill", (d) => (isCorrect(d.program) ? colour(d.program.combined_score) : null));
    groups.selectAll("circle.tree-ring")
        .data((d) => [d.id === bestId && "best", d.id === view.selectedId && "selected"].filter(Boolean), (kind) => kind)
        .join((enter) => enter.append("circle")
            .attr("class", (kind) => `tree-ring tree-ring--${kind}`)
            .attr("r", (kind) => (kind === "best" ? R + 3.5 : R + 7)));
    drawPills(view, groups);
}

function drawPills(view, groups) {
    const pills = groups.selectAll("g.tree-pill").data((d) => (d.pill ? [d.pill] : []), (p) => p.kind)
        .join((enter) => {
            const g = enter.append("g").attr("class", (p) => `tree-pill tree-pill--${p.kind}`);
            // Invisible bridge over the gap so the hover survives the move from dot to pill.
            g.append("rect").attr("class", "tree-pill__bridge").attr("x", R).attr("y", -7).attr("width", 5).attr("height", 14);
            g.append("rect").attr("class", "tree-pill__box").attr("x", R + 5).attr("y", -7).attr("height", 14).attr("rx", 7);
            g.append("text").attr("y", 0);
            g.on("click", (event, p) => { event.stopPropagation(); hideTooltip(view); view.onToggle(p.id); });
            return g;
        });
    pills.select(".tree-pill__box").attr("width", (p) => p.width);
    pills.select("text").attr("x", (p) => R + 5 + p.width / 2).text((p) => p.label);
}

function bounds(nodes) {
    if (!nodes.length) return null;
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (const n of nodes) {
        b.x0 = Math.min(b.x0, n.x - R - 8);
        b.x1 = Math.max(b.x1, n.x + R + (n.pill ? 5 + n.pill.width : 8));
        b.y0 = Math.min(b.y0, n.y - R - 8);
        b.y1 = Math.max(b.y1, n.y + R + 8);
    }
    return b;
}

function drawGrid(view) {
    const b = view.bounds;
    view.canvas.select(".tree-grid").selectAll("line").data(b ? view.gens : [], (g) => g).join("line")
        .attr("x1", (g) => g * COL_W).attr("x2", (g) => g * COL_W)
        .attr("y1", b ? b.y0 - ROW_H : 0).attr("y2", b ? b.y1 + ROW_H : 0);
}

function drawAxis(view) {
    view.svg.select(".tree-axis").style("display", view.gens.length ? null : "none");
    view.svg.select(".tree-axis__labels").selectAll("text").data(view.gens, (g) => g).join("text")
        .attr("y", 15).text((g) => `gen ${g}`);
    positionAxis(view, d3.zoomTransform(view.svg.node()));
}

/** The generation labels stay at the top of the pane and follow the horizontal pan and zoom. */
function positionAxis(view, t) {
    const width = view.container.clientWidth;
    const step = Math.max(1, Math.ceil(LABEL_W / (t.k * COL_W)));
    view.svg.select(".tree-axis__labels").selectAll("text")
        .attr("x", (g) => t.applyX(g * COL_W))
        .attr("display", (g) => {
            const x = t.applyX(g * COL_W);
            return g % step === 0 && x > -LABEL_W && x < width + LABEL_W ? null : "none";
        });
}

// ---------- pan and zoom ----------

function applyTransform(view, transform, animate) {
    (animate ? view.svg.transition().duration(250) : view.svg).call(view.zoom.transform, transform);
}

function fit(view) {
    const { width, height } = view.container.getBoundingClientRect();
    const b = view.bounds;
    if (!width || !height) return;
    if (!b) { applyTransform(view, d3.zoomIdentity, false); return; }
    const availW = width - 2 * FIT_PAD, availH = height - AXIS_H - 2 * FIT_PAD - LEGEND_H;
    const k = Math.max(MIN_SCALE, Math.min(MAX_FIT_SCALE, availW / (b.x1 - b.x0), availH / (b.y1 - b.y0)));
    const tx = (width - k * (b.x0 + b.x1)) / 2;
    const ty = AXIS_H + (height - AXIS_H - LEGEND_H - k * (b.y0 + b.y1)) / 2;
    applyTransform(view, d3.zoomIdentity.translate(tx, ty).scale(k), view.nodes.size > 0);
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
    const { width, height } = view.container.getBoundingClientRect();
    if (!node || !width || !height) return;
    const t = d3.zoomTransform(view.svg.node());
    const [px, py] = t.apply([node.x, node.y]);
    const margin = 40;
    if (px >= margin && px <= width - margin && py >= AXIS_H + margin && py <= height - margin) return;
    const next = d3.zoomIdentity.translate(width / 2 - t.k * node.x, (height + AXIS_H) / 2 - t.k * node.y).scale(t.k);
    applyTransform(view, next, true);
}

// ---------- keyboard ----------

function handleKey(view, event) {
    const { model } = view;
    if (!model || event.altKey || event.ctrlKey || event.metaKey) return;
    const go = (id) => { focusNode(view, id); view.onSelect(id); };
    if (event.key === "b" || event.key === "B") { if (model.best) go(model.best.id); return; }
    if (event.key === "Enter") { if (view.hoveredId) go(view.hoveredId); return; }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const id = view.nodes.has(view.selectedId) ? view.selectedId : model.best && model.best.id;
    const program = model.programs.get(id);
    if (!program) return;
    const parent = model.programs.get(program.parent_id);
    const siblings = parent ? parent.children : model.roots;
    const index = siblings.indexOf(id);
    if (event.key === "ArrowLeft" && parent) go(parent.id);
    else if (event.key === "ArrowRight" && program.children.length) {
        if (view.expanded.has(id)) go(program.children[0]); else view.onToggle(id);
    } else if (event.key === "ArrowUp" && index > 0) go(siblings[index - 1]);
    else if (event.key === "ArrowDown" && index >= 0 && index < siblings.length - 1) go(siblings[index + 1]);
}

// ---------- tooltip ----------

function showTooltip(view, event, node) {
    view.hoveredId = node.id;
    view.tooltip.innerHTML = tooltipHtml(view.model, node);
    view.tooltip.hidden = false;
    placeTooltip(view, event);
}

function hideTooltip(view) {
    view.hoveredId = null;
    view.tooltip.hidden = true;
}

function placeTooltip(view, event) {
    if (view.tooltip.hidden) return;
    const rect = view.container.getBoundingClientRect();
    const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
    const w = view.tooltip.offsetWidth, h = view.tooltip.offsetHeight;
    let x = cx + 14, y = cy + 14;
    if (x + w > rect.width - 8) x = Math.max(8, cx - w - 14);
    if (y + h > rect.height - 8) y = Math.max(8, cy - h - 14);
    view.tooltip.style.left = `${x}px`;
    view.tooltip.style.top = `${y}px`;
}

function tooltipHtml(model, node) {
    const program = node.program;
    const parent = model.programs.get(program.parent_id);
    const isBest = model.best && model.best.id === program.id;
    const kind = patchType(program);
    const facts = [`Generation ${escapeHtml(program.generation ?? "–")}`];
    if (kind) facts.push(escapeHtml(PATCH_WORDS[kind] || kind));
    if (modelName(program)) facts.push(escapeHtml(modelName(program)));
    const rows = [
        `<div class="tree-tooltip__name">${escapeHtml(displayName(program))}${isBest ? ' <span class="pill pill--warn">best</span>' : ""}</div>`,
        `<div class="muted">${facts.join(" · ")}</div>`,
    ];
    if (isCorrect(program)) {
        const delta = scoreDelta(program, parent);
        const text = formatDelta(delta);
        const cls = delta > 0 ? "delta--up" : delta < 0 ? "delta--down" : "delta--flat";
        rows.push(`<div>Score ${formatScore(program.combined_score)}${text ? ` <span class="${cls}">${text} vs parent</span>` : ""}</div>`);
    } else {
        const reason = String(failureText(program) || "");
        rows.push(`<div class="tree-tooltip__fail">${escapeHtml(reason.length > 160 ? `${reason.slice(0, 160)}…` : reason)}</div>`);
    }
    if (node.pill && node.pill.kind === "more") rows.push(`<div class="muted">${node.pill.label.slice(1)} hidden below · click the pill to show them</div>`);
    return rows.join("");
}
