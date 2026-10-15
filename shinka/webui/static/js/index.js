// Landing page: a plain list of runs grouped by task. Clicking a row opens run.html.
//
// Stats are fetched lazily per visible row from /get_database_stats and cached;
// the list is re-read every REFRESH_SECONDS and stale stats are refetched in place.
// Formatting and theme helpers are shared with the run page so both pages read the same.

import { escapeHtml, formatAgo, formatCost, formatDuration, formatScore, formatTimestamp, runStatus } from "./run/model.js";
import { initTheme, toggleTheme } from "./run/theme.js";

const REFRESH_SECONDS = 30;
const STATS_BATCH = 5;

const state = {
    runs: [], // {task, name, path, label}
    stats: new Map(), // path -> {stats, fetchedAt}
    pending: new Set(),
    sortKey: "updated", // "run" | "updated"
    sortDir: "desc",
};

const el = {
    search: document.getElementById("search-input"),
    loading: document.getElementById("loading-state"),
    empty: document.getElementById("empty-state"),
    emptyTitle: document.getElementById("empty-title"),
    emptyText: document.getElementById("empty-text"),
    wrapper: document.getElementById("table-wrapper"),
    body: document.getElementById("results-body"),
    btnTheme: document.getElementById("btn-theme"),
};

// ---------- cells ----------

const LOADING = `<span class="faint">…</span>`;

function statusCell(stats) {
    if (stats.error) return `<span class="pill pill--bad" title="${escapeHtml(stats.error)}">error</span>`;
    if (!stats.program_count) return `<span class="pill pill--warn" title="The database has no programs">empty</span>`;
    return runStatus(stats.last_update, Date.now() / 1000) === "active"
        ? `<span class="pill pill--ok" title="A program was added in the last five minutes">active</span>`
        : `<span class="pill" title="No new program in the last five minutes">idle</span>`;
}

const DASH = `<span class="muted">–</span>`;

function bestCell(stats) {
    if (stats.best_score === null || stats.best_score === undefined) return `<span class="muted">none</span>`;
    const gen = stats.best_generation;
    const genText = gen === null || gen === undefined ? "" : ` <span class="muted">gen ${escapeHtml(gen)}</span>`;
    return formatScore(stats.best_score) + genText;
}

/** Same total as the run page: programs and failed proposals (server total_cost) plus prompt evolution. */
function costCell(stats) {
    const programs = Number(stats.total_cost) || 0;
    const extra = Number(stats.prompt_evo_cost) || 0;
    const title = extra
        ? `Programs ${formatCost(programs)} + prompt evolution ${formatCost(extra)}`
        : "LLM, embedding, novelty, and meta cost of every program";
    return `<span title="${escapeHtml(title)}">${formatCost(programs + extra)}</span>`;
}

function updatedCell(stats) {
    const last = Number(stats.last_update);
    if (stats.last_update === null || stats.last_update === undefined || !Number.isFinite(last)) return DASH;
    return `<span title="${escapeHtml(formatTimestamp(last))}">${escapeHtml(formatAgo(Date.now() / 1000 - last))}</span>`;
}

function statsCells(stats) {
    const status = statusCell(stats);
    if (stats.error) return { status, best_score: DASH, generations: DASH, programs: DASH, cost: DASH, runtime: DASH, updated: DASH };
    const lastGeneration = Number(stats.max_generation);
    return {
        status,
        best_score: stats.program_count ? bestCell(stats) : DASH,
        // Generations are numbered from 0, so the count is the last number plus one.
        generations: stats.program_count && Number.isFinite(lastGeneration) ? String(lastGeneration + 1) : DASH,
        programs: stats.program_count
            ? `${escapeHtml(stats.program_count)} <span class="muted">${Number(stats.correct_count) || 0} correct</span>`
            : "0",
        cost: costCell(stats),
        runtime: formatDuration(stats.total_runtime_seconds),
        updated: updatedCell(stats),
    };
}

function fillRow(row, stats) {
    for (const [key, html] of Object.entries(statsCells(stats))) {
        const cell = row.querySelector(`[data-stat="${key}"]`);
        if (cell) cell.innerHTML = html;
    }
}

// ---------- rendering ----------

function taskIdFor(task) {
    return "task-" + task.replace(/[^a-zA-Z0-9]/g, "-");
}

function compareRuns(a, b) {
    let result;
    if (state.sortKey === "updated") {
        const ta = Number(cachedStats(a.path)?.last_update) || 0;
        const tb = Number(cachedStats(b.path)?.last_update) || 0;
        result = (ta - tb) || a.label.localeCompare(b.label);
    } else {
        result = a.label.localeCompare(b.label);
    }
    return state.sortDir === "desc" ? -result : result;
}

function cachedStats(path) {
    return state.stats.get(path)?.stats || null;
}

function headerRow(task, taskId, count, collapsed) {
    const row = document.createElement("tr");
    row.className = "task-header" + (collapsed ? " is-collapsed" : "");
    row.dataset.taskId = taskId;
    row.title = `${task} (${count} ${count === 1 ? "run" : "runs"})`;
    // Only the name span truncates; the toggle and the run-count pill stay visible.
    row.innerHTML = `<td colspan="8"><div class="task-header__line">
        <span class="task-header__toggle" aria-hidden="true">&#9662;</span>
        <span class="task-header__name">${escapeHtml(task)}</span>
        <span class="pill task-header__count">${count}</span></div></td>`;
    row.addEventListener("click", () => toggleTask(taskId));
    return row;
}

function runRow(run, taskId, collapsed) {
    const row = document.createElement("tr");
    row.className = "run-row" + (collapsed ? " hidden" : "");
    row.dataset.dbPath = run.path;
    row.dataset.taskId = taskId;
    row.title = run.path;
    row.innerHTML = `
        <td class="run-row__name"><a href="/run.html?db_path=${encodeURIComponent(run.path)}">${escapeHtml(run.label)}</a></td>
        <td data-stat="status">${LOADING}</td>
        <td class="numeric" data-stat="best_score">${LOADING}</td>
        <td class="numeric" data-stat="generations">${LOADING}</td>
        <td class="numeric" data-stat="programs">${LOADING}</td>
        <td class="numeric" data-stat="cost">${LOADING}</td>
        <td class="numeric" data-stat="runtime">${LOADING}</td>
        <td class="numeric" data-stat="updated">${LOADING}</td>`;
    row.addEventListener("click", (event) => {
        if (event.target.closest("a")) return; // the link handles itself (and middle-click)
        window.location.href = `/run.html?db_path=${encodeURIComponent(run.path)}`;
    });
    const stats = cachedStats(run.path);
    if (stats) fillRow(row, stats);
    return row;
}

function showEmpty(title, text) {
    el.loading.hidden = true;
    el.wrapper.hidden = true;
    el.empty.hidden = false;
    el.emptyTitle.textContent = title;
    el.emptyText.textContent = text;
}

function renderTable() {
    const filter = el.search.value.trim().toLowerCase();
    const matches = state.runs.filter((run) => !filter || run.task.toLowerCase().includes(filter) || run.name.toLowerCase().includes(filter));
    if (!state.runs.length) return showEmpty("No runs found", "Run an evolution experiment to see its results here.");
    if (!matches.length) return showEmpty("No matching runs", `No run name contains "${el.search.value.trim()}".`);

    const byTask = new Map();
    for (const run of matches) {
        if (!byTask.has(run.task)) byTask.set(run.task, []);
        byTask.get(run.task).push(run);
    }
    const fragment = document.createDocumentFragment();
    for (const task of [...byTask.keys()].sort((a, b) => a.localeCompare(b))) {
        const runs = byTask.get(task).sort(compareRuns);
        const taskId = taskIdFor(task);
        const collapsed = localStorage.getItem("collapsed-" + taskId) === "true";
        fragment.appendChild(headerRow(task, taskId, runs.length, collapsed));
        for (const run of runs) fragment.appendChild(runRow(run, taskId, collapsed));
    }
    el.body.replaceChildren(fragment);
    el.loading.hidden = true;
    el.empty.hidden = true;
    el.wrapper.hidden = false;
    renderSortIndicators();
}

function renderSortIndicators() {
    for (const th of document.querySelectorAll("th.sortable")) {
        const active = th.dataset.sort === state.sortKey;
        th.classList.toggle("is-sorted", active);
        th.querySelector(".sort-indicator").textContent = active ? (state.sortDir === "asc" ? "▲" : "▼") : "";
    }
}

function toggleTask(taskId) {
    const header = el.body.querySelector(`tr.task-header[data-task-id="${taskId}"]`);
    const collapsed = header.classList.toggle("is-collapsed");
    localStorage.setItem("collapsed-" + taskId, String(collapsed));
    for (const row of el.body.querySelectorAll(`tr.run-row[data-task-id="${taskId}"]`)) row.classList.toggle("hidden", collapsed);
}

function toggleSort(key) {
    if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else { state.sortKey = key; state.sortDir = key === "updated" ? "desc" : "asc"; }
    renderTable();
    loadVisibleStats();
}

// ---------- data ----------

async function loadDatabases() {
    try {
        const response = await fetch("/list_databases");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const dbs = await response.json();
        state.runs = dbs.map((db) => {
            const task = db.task || "Unknown";
            const name = db.name || db.path;
            return { task, name, path: db.path, label: name.startsWith(task + "/") ? name.slice(task.length + 1) : name };
        });
        renderTable();
        await loadVisibleStats();
    } catch (error) {
        console.error("Could not list runs:", error);
        showEmpty("Could not list runs", error.message || String(error));
    }
}

function needsStats(path) {
    const entry = state.stats.get(path);
    return !state.pending.has(path) && (!entry || Date.now() - entry.fetchedAt > REFRESH_SECONDS * 1000);
}

/** Fetch stats for rows on screen, a few at a time; re-sort once when sorting by update time. */
async function loadVisibleStats() {
    const paths = [...el.body.querySelectorAll("tr.run-row")].map((row) => row.dataset.dbPath).filter(needsStats);
    for (let i = 0; i < paths.length; i += STATS_BATCH) {
        await Promise.all(paths.slice(i, i + STATS_BATCH).map(loadStats));
    }
    if (paths.length && state.sortKey === "updated") renderTable();
}

async function loadStats(path) {
    state.pending.add(path);
    try {
        const response = await fetch(`/get_database_stats?db_path=${encodeURIComponent(path)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const stats = await response.json();
        state.stats.set(path, { stats, fetchedAt: Date.now() });
        const row = el.body.querySelector(`tr.run-row[data-db-path="${CSS.escape(path)}"]`);
        if (row) fillRow(row, stats);
    } catch (error) {
        console.error(`Could not load stats for ${path}:`, error);
    } finally {
        state.pending.delete(path);
    }
}

// ---------- boot ----------

function init() {
    initTheme();
    el.btnTheme.addEventListener("click", toggleTheme);
    for (const th of document.querySelectorAll("th.sortable")) th.addEventListener("click", () => toggleSort(th.dataset.sort));
    el.search.addEventListener("input", () => { renderTable(); loadVisibleStats(); });
    document.addEventListener("keydown", (event) => {
        if (event.key === "/" && document.activeElement !== el.search) {
            event.preventDefault();
            el.search.focus();
        } else if (event.key === "Escape" && document.activeElement === el.search) {
            if (el.search.value) { el.search.value = ""; renderTable(); loadVisibleStats(); }
            el.search.blur();
        }
    });
    loadDatabases();
    setInterval(() => { if (!document.hidden) loadDatabases(); }, REFRESH_SECONDS * 1000);
}

init();

// Exposed for browser tests.
window.shinkaIndex = { state, toggleSort };
