// Entry point for run.html.
//
// State lives here: the database path, the selected program, which nodes are
// expanded, and whether the right pane shows a program or the run overview.
// The URL mirrors the state (db_path, program, view=run) so links can be shared.
import { api } from "./api.js";
import { buildRunModel, defaultExpanded, allExpanded, expandTo, visibleIds } from "./model.js";
import { renderStatus } from "./status.js";
import { createTree } from "./tree.js";
import { renderProgram } from "./program.js";
import { renderOverview } from "./overview.js";
import { initTheme, toggleTheme, onThemeChange } from "./theme.js";

const POLL_SECONDS = 3;

const state = {
    dbPath: null,
    model: null,
    selectedId: null,
    expanded: new Set(),
    view: "overview", // "overview" | "program"
    lastCount: null,
    lastTimestamp: null,
    error: null,
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
let renderToken = 0;

// ---------- URL ----------

function readUrl() {
    const params = new URLSearchParams(window.location.search);
    state.dbPath = params.get("db_path");
    state.selectedId = params.get("program");
    state.view = params.get("view") === "run" || !state.selectedId ? "overview" : "program";
}

function writeUrl(replace = false) {
    const url = new URL(window.location.href);
    url.search = "";
    if (state.dbPath) url.searchParams.set("db_path", state.dbPath);
    if (state.selectedId) url.searchParams.set("program", state.selectedId);
    if (state.view === "overview" && state.selectedId) url.searchParams.set("view", "run");
    const method = replace ? "replaceState" : "pushState";
    if (url.href !== window.location.href) history[method]({}, "", url);
}

// ---------- rendering ----------

function nowSeconds() {
    return Date.now() / 1000;
}

function renderAll() {
    renderStatus(el.statusName, el.statusItems, { dbPath: state.dbPath, model: state.model, nowSeconds: nowSeconds(), error: state.error });
    document.title = state.dbPath ? `${el.statusName.textContent} · ShinkaEvolve` : "ShinkaEvolve run";
    el.linkAdvanced.href = state.dbPath ? `/viz_tree.html?db_path=${encodeURIComponent(state.dbPath)}` : "/viz_tree.html";
    if (!state.model) return;
    const visible = visibleIds(state.model, state.expanded);
    el.treeSummary.textContent = `${visible.size} of ${state.model.programs.size} programs shown`;
    tree.render(state.model, { selectedId: state.selectedId, expanded: state.expanded });
    renderPanel();
}

async function renderPanel() {
    const token = ++renderToken;
    el.btnRun.classList.toggle("is-active", state.view === "overview");
    const program = state.selectedId ? state.model.programs.get(state.selectedId) : null;
    if (state.view === "program" && program) {
        await renderProgram(el.panel, { model: state.model, program, dbPath: state.dbPath, api, onSelect: selectProgram });
    } else {
        if (state.view === "program" && state.selectedId) toast(`Program ${state.selectedId} is not in this run`);
        await renderOverview(el.panel, { model: state.model, dbPath: state.dbPath, api, onSelect: selectProgram });
    }
    if (token !== renderToken) return; // a newer render superseded this one
}

function toast(message, ms = 2500) {
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
    writeUrl();
    renderAll();
}

function toggleNode(id) {
    const next = new Set(state.expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    state.expanded = next;
    renderAll();
}

function expandAll() {
    state.expanded = allExpanded(state.model);
    renderAll();
    tree.fit();
}

function collapseToLineage() {
    state.expanded = defaultExpanded(state.model);
    if (state.selectedId) state.expanded = expandTo(state.model, state.expanded, state.selectedId);
    renderAll();
    tree.fit();
}

// ---------- data ----------

async function loadRun({ initial = false } = {}) {
    if (!state.dbPath) {
        state.error = "No database selected";
        renderAll();
        el.panel.innerHTML = `<div class="empty">Open a run from the <a href="/">run list</a>.</div>`;
        return;
    }
    try {
        const rows = await api.programsSummary(state.dbPath);
        const previous = state.model;
        state.model = buildRunModel(rows, { now: nowSeconds() });
        state.error = null;
        if (initial || !previous) {
            state.expanded = defaultExpanded(state.model);
            if (state.selectedId && state.model.programs.has(state.selectedId)) {
                state.expanded = expandTo(state.model, state.expanded, state.selectedId);
            } else if (state.selectedId) {
                state.selectedId = null;
                state.view = "overview";
                writeUrl(true);
            }
        } else {
            // Keep the user's expansion; newly added children of expanded nodes appear automatically.
            for (const id of state.model.bestLineage) if (!previous.bestLineage.has(id)) state.expanded.add(id);
        }
        renderAll();
        if (initial) tree.fit();
    } catch (error) {
        state.error = error.message || String(error);
        renderAll();
        if (!state.model) el.panel.innerHTML = `<div class="empty">Could not load the run: ${state.error}</div>`;
    }
}

async function poll() {
    if (!state.dbPath || document.hidden) return;
    try {
        const { count, max_timestamp: maxTimestamp } = await api.programCount(state.dbPath);
        const changed = state.lastCount !== null && (count !== state.lastCount || (maxTimestamp || 0) > (state.lastTimestamp || 0));
        state.lastCount = count;
        state.lastTimestamp = maxTimestamp || state.lastTimestamp;
        if (changed) {
            api.forgetDetails();
            await loadRun();
        } else if (state.model) {
            // Just refresh "updated N ago" and the active/idle pill.
            state.model.status = state.model.totals.lastTimestamp !== null && nowSeconds() - state.model.totals.lastTimestamp <= 300 ? "active" : "idle";
            renderStatus(el.statusName, el.statusItems, { dbPath: state.dbPath, model: state.model, nowSeconds: nowSeconds(), error: null });
        }
    } catch (_) {
        // transient; the next poll retries
    }
}

// ---------- divider ----------

function initDivider() {
    let dragging = false;
    const stored = Number(localStorage.getItem("shinkaTreeWidth"));
    if (stored > 200) el.treePane.style.flexBasis = `${stored}px`;
    el.divider.addEventListener("mousedown", (event) => {
        dragging = true;
        el.divider.classList.add("is-dragging");
        document.body.style.userSelect = "none";
        event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => {
        if (!dragging) return;
        const width = Math.min(Math.max(event.clientX, 240), window.innerWidth - 360);
        el.treePane.style.flexBasis = `${width}px`;
    });
    window.addEventListener("mouseup", () => {
        if (!dragging) return;
        dragging = false;
        el.divider.classList.remove("is-dragging");
        document.body.style.userSelect = "";
        localStorage.setItem("shinkaTreeWidth", String(el.treePane.getBoundingClientRect().width));
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
    el.btnBest.addEventListener("click", () => state.model && state.model.best && selectProgram(state.model.best.id));
    el.btnExpand.addEventListener("click", expandAll);
    el.btnCollapse.addEventListener("click", collapseToLineage);
    el.btnFit.addEventListener("click", () => tree.fit());
    onThemeChange(() => renderAll());
    window.addEventListener("popstate", () => { readUrl(); if (state.model) renderAll(); });
    initDivider();

    loadRun({ initial: true }).then(() => {
        poll();
        setInterval(poll, POLL_SECONDS * 1000);
    });
}

document.addEventListener("DOMContentLoaded", init);

// Exposed for browser tests.
window.shinkaRun = { state, selectProgram, showOverview };
