// Entry point for run.html.
//
// State lives here: the database path, the selected program, which nodes are
// expanded, and whether the right pane shows a program or the run overview.
// The URL mirrors the state (db_path, program) so links can be shared.
import { api } from "./api.js";
import {
    allExpanded, buildRunModel, collapseSubtree, defaultExpanded, escapeHtml, expandSubtree,
    expandTo, lineageOf, runStatus, visibleIds, visibleProgramCount,
} from "./model.js";
import { renderStatus, runLabel } from "./status.js";
import { createTree } from "./tree.js";
import { renderProgram } from "./program.js";
import { renderOverview } from "./overview.js";
import { initTheme, toggleTheme, onThemeChange } from "./theme.js";

const POLL_MS = 3000;
const TOAST_MS = 2500;
const POLL_FAILURES_BEFORE_ERROR = 3;
const DIVIDER_MIN_PX = 420;
const PANEL_MIN_PX = 420;
const TREE_WIDTH_KEY = "shinkaTreeWidth";

const state = {
    dbPath: null,
    model: null,
    selectedId: null,
    expanded: new Set(),
    view: "overview", // "overview" | "program"
    lastCount: null,
    lastTimestamp: null,
    pollFailures: 0,
    error: null,
    extraCost: 0,
};

const el = {
    statusName: document.getElementById("status-name"),
    statusItems: document.getElementById("status-items"),
    btnRun: document.getElementById("btn-run"),
    linkAdvanced: document.getElementById("link-advanced"),
    btnTheme: document.getElementById("btn-theme"),
    btnBest: document.getElementById("btn-best"),
    btnExpand: document.getElementById("btn-expand"),
    btnCollapse: document.getElementById("btn-collapse"),
    btnFit: document.getElementById("btn-fit"),
    treeSummary: document.getElementById("tree-summary"),
    tree: document.getElementById("tree"),
    treePane: document.getElementById("tree-pane"),
    panel: document.getElementById("panel"),
    divider: document.getElementById("divider"),
    toast: document.getElementById("toast"),
};

let tree = null;

// ---------- URL ----------

function readUrl() {
    const params = new URLSearchParams(window.location.search);
    state.dbPath = params.get("db_path");
    state.selectedId = params.get("program");
    state.view = state.selectedId ? "program" : "overview";
}

function writeUrl(replace = false) {
    const url = new URL(window.location.href);
    url.search = "";
    if (state.dbPath) url.searchParams.set("db_path", state.dbPath);
    if (state.view === "program" && state.selectedId) url.searchParams.set("program", state.selectedId);
    const method = replace ? "replaceState" : "pushState";
    if (url.href !== window.location.href) history[method]({}, "", url);
}

/** If the URL names a program this run does not have, say so once and fall back to the overview. */
function dropUnknownSelection() {
    if (!state.selectedId || state.model.programs.has(state.selectedId)) return;
    toast(`Program ${state.selectedId} is not in this run`);
    state.selectedId = null;
    state.view = "overview";
    writeUrl(true);
}

// ---------- rendering ----------

function nowSeconds() {
    return Date.now() / 1000;
}

function renderStrip() {
    renderStatus(el.statusName, el.statusItems, { dbPath: state.dbPath, model: state.model, nowSeconds: nowSeconds(), error: state.error });
}

function renderAll() {
    renderStrip();
    document.title = state.dbPath ? `${runLabel(state.dbPath)} · ShinkaEvolve` : "ShinkaEvolve run";
    el.linkAdvanced.href = state.dbPath ? `/viz_tree.html?db_path=${encodeURIComponent(state.dbPath)}` : "/viz_tree.html";
    if (!state.model) return;
    const visible = visibleIds(state.model, state.expanded);
    const failed = state.model.totals.failedProposalCount;
    el.treeSummary.textContent = `${visibleProgramCount(state.model, visible)} of ${state.model.totals.programCount} programs shown`
        + (failed ? ` · ${failed} failed proposal${failed === 1 ? "" : "s"}` : "");
    const selectedId = state.view === "program" ? state.selectedId : null;
    tree.render(state.model, { selectedId, expanded: state.expanded });
    renderPanel();
}

function renderPanel() {
    el.btnRun.classList.toggle("is-active", state.view === "overview");
    const program = state.selectedId ? state.model.programs.get(state.selectedId) : null;
    const context = { model: state.model, dbPath: state.dbPath, api, onSelect: selectProgram };
    if (state.view === "program" && program) renderProgram(el.panel, { ...context, program });
    else renderOverview(el.panel, context);
}

function toast(message, ms = TOAST_MS) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

// ---------- actions ----------

function selectProgram(id, { reveal = true } = {}) {
    if (!state.model || !state.model.programs.has(id)) return;
    state.selectedId = id;
    state.view = "program";
    if (reveal) {
        state.expanded = expandTo(state.model, state.expanded, id);
        tree.focus(id);
    }
    writeUrl();
    renderAll();
}

function showOverview() {
    state.view = "overview";
    state.selectedId = null;
    writeUrl();
    renderAll();
}

/** "+N" pill: show the whole hidden subtree. "−" pill: hide it again. */
function toggleNode(id) {
    state.expanded = state.expanded.has(id)
        ? collapseSubtree(state.model, state.expanded, id)
        : expandSubtree(state.model, state.expanded, id);
    renderAll();
}

function expandAll() {
    state.expanded = allExpanded(state.model);
    renderAll();
    tree.fit();
}

function collapseToDefault() {
    state.expanded = defaultExpanded(state.model);
    if (state.selectedId) state.expanded = expandTo(state.model, state.expanded, state.selectedId);
    renderAll();
    tree.fit();
}

function selectBest() {
    if (state.model && state.model.best) selectProgram(state.model.best.id);
}

// ---------- data ----------

/** Prompt-evolution spend is not attached to programs; read it from the stats endpoint. */
async function loadExtraCost() {
    try {
        const stats = await api.stats(state.dbPath);
        state.extraCost = Number(stats.prompt_evo_cost) || 0;
    } catch (_) {
        state.extraCost = 0;
    }
}

function applyFreshModel(rows) {
    const previous = state.model;
    state.model = buildRunModel(rows, { now: nowSeconds(), extraCost: state.extraCost });
    state.lastCount = rows.length;
    state.lastTimestamp = state.model.totals.lastTimestamp;
    if (!previous) {
        state.expanded = defaultExpanded(state.model);
        dropUnknownSelection();
        if (state.selectedId) state.expanded = expandTo(state.model, state.expanded, state.selectedId);
        return { grew: true };
    }
    forgetChangedDetails(previous, state.model);
    // Keep the user's expansion, and keep following the best and the newest lineage.
    const follow = [...state.model.bestLineage, ...lineageOf(state.model, state.model.totals.newestId)];
    for (const id of follow) state.expanded.add(id);
    dropUnknownSelection();
    return { grew: state.model.maxGeneration > previous.maxGeneration || state.model.programs.size > previous.programs.size };
}

/** Details are cached; drop only programs whose summary row changed. */
function forgetChangedDetails(previous, next) {
    const changed = [];
    for (const [id, old] of previous.programs) {
        const fresh = next.programs.get(id);
        if (!fresh || fresh.timestamp !== old.timestamp || fresh.correct !== old.correct) changed.push(id);
    }
    if (changed.length) api.forgetDetails(state.dbPath, changed);
}

async function loadRun({ initial = false } = {}) {
    if (!state.dbPath) {
        state.error = "No database selected";
        renderAll();
        el.panel.innerHTML = `<div class="empty">Open a run from the <a href="/">run list</a>.</div>`;
        return;
    }
    try {
        const [rows] = await Promise.all([api.programsSummary(state.dbPath), loadExtraCost()]);
        const previousMax = state.model ? state.model.maxGeneration : null;
        const { grew } = applyFreshModel(rows);
        state.error = null;
        renderAll();
        if (initial || (grew && tree.isUntouched())) tree.fit();
        else if (previousMax !== null && state.model.maxGeneration > previousMax) {
            toast(`Generation ${state.model.maxGeneration} arrived. Press F to follow the newest programs.`, 4000);
        }
    } catch (error) {
        state.error = error.message || String(error);
        renderAll();
        if (!state.model) el.panel.innerHTML = `<div class="empty">Could not load the run: ${escapeHtml(state.error)}</div>`;
    }
}

async function poll() {
    if (!state.dbPath || document.hidden) return;
    try {
        const { count, max_timestamp: maxTimestamp } = await api.programCount(state.dbPath);
        state.pollFailures = 0;
        if (state.error && state.model) state.error = null;
        const changed = count !== state.lastCount || (maxTimestamp || 0) > (state.lastTimestamp || 0);
        if (changed) {
            await loadRun();
        } else if (state.model) {
            state.model.status = runStatus(state.model.totals.lastTimestamp, nowSeconds());
            renderStrip();
        }
    } catch (error) {
        state.pollFailures += 1;
        if (state.pollFailures >= POLL_FAILURES_BEFORE_ERROR) {
            state.error = `Lost contact with the run: ${error.message || error}`;
            renderStrip();
        }
    }
}

// ---------- keyboard ----------

function onKeyDown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (target.closest("input, textarea, select, [contenteditable]") || target.closest("#panel"))) return;
    const key = event.key.toLowerCase();
    if (key === "b") { selectBest(); event.preventDefault(); return; }
    if (key === "f") { tree.fit(); event.preventDefault(); return; }
    if (key === "escape" && state.view === "program") { showOverview(); event.preventDefault(); return; }
    if (tree.handleKey(event, state.selectedId)) event.preventDefault();
}

// ---------- divider ----------

function clampTreeWidth(width) {
    return Math.min(Math.max(width, DIVIDER_MIN_PX), window.innerWidth - PANEL_MIN_PX);
}

function initDivider() {
    let dragging = false;
    const stored = Number(localStorage.getItem(TREE_WIDTH_KEY));
    if (stored > 0) el.treePane.style.flexBasis = `${clampTreeWidth(stored)}px`;
    el.divider.addEventListener("mousedown", (event) => {
        dragging = true;
        el.divider.classList.add("is-dragging");
        document.body.style.userSelect = "none";
        event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => {
        if (dragging) el.treePane.style.flexBasis = `${clampTreeWidth(event.clientX)}px`;
    });
    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        el.divider.classList.remove("is-dragging");
        document.body.style.userSelect = "";
        localStorage.setItem(TREE_WIDTH_KEY, String(el.treePane.getBoundingClientRect().width));
        tree.fit();
    });
}

// ---------- boot ----------

function init() {
    initTheme();
    readUrl();
    tree = createTree(el.tree, { onSelect: (id) => selectProgram(id, { reveal: false }), onToggle: toggleNode });

    el.btnRun.addEventListener("click", showOverview);
    el.btnTheme.addEventListener("click", toggleTheme);
    el.btnBest.addEventListener("click", selectBest);
    el.btnExpand.addEventListener("click", expandAll);
    el.btnCollapse.addEventListener("click", collapseToDefault);
    el.btnFit.addEventListener("click", () => tree.fit());
    document.addEventListener("keydown", onKeyDown);
    onThemeChange(() => renderAll());
    window.addEventListener("popstate", () => {
        readUrl();
        if (!state.model) return;
        dropUnknownSelection();
        if (state.selectedId) state.expanded = expandTo(state.model, state.expanded, state.selectedId);
        renderAll();
    });
    initDivider();

    loadRun({ initial: true }).then(() => setInterval(poll, POLL_MS));
}

document.addEventListener("DOMContentLoaded", init);

// Exposed for browser tests.
window.shinkaRun = { state, selectProgram, showOverview };
