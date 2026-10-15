// Status strip: run name, state, generation, best score, cost, last update.
import { formatAgo, formatCost, formatDuration, formatScore, escapeHtml } from "./model.js";

function item(label, value, extraClass = "") {
    return `<div class="status__item ${extraClass}"><span class="status__label">${escapeHtml(label)}</span><span class="status__value">${value}</span></div>`;
}

/**
 * @param nameEl element for the run name
 * @param itemsEl element for the metric items
 * @param model result of buildRunModel (may be null while loading)
 * @param nowSeconds current time in seconds, for "updated N ago"
 */
export function renderStatus(nameEl, itemsEl, { dbPath, model, nowSeconds, error }) {
    const runName = (dbPath || "").split("/").slice(-2, -1)[0] || dbPath || "run";
    nameEl.textContent = runName;
    nameEl.title = dbPath || "";
    if (error) {
        itemsEl.innerHTML = item("Status", `<span class="pill pill--bad">${escapeHtml(error)}</span>`);
        return;
    }
    if (!model) {
        itemsEl.innerHTML = item("Status", `<span class="pill">loading</span>`);
        return;
    }
    const t = model.totals;
    const state = model.status === "active"
        ? `<span class="pill pill--ok" title="A program was added in the last five minutes">active</span>`
        : `<span class="pill" title="No new program in the last five minutes">idle</span>`;
    const best = model.best
        ? `${formatScore(model.best.combined_score)} <span class="muted">gen ${model.best.generation}</span>`
        : `<span class="muted">none yet</span>`;
    const correctPct = t.programCount ? Math.round((100 * t.correctCount) / t.programCount) : 0;
    const updated = t.lastTimestamp !== null && Number.isFinite(nowSeconds) ? formatAgo(nowSeconds - t.lastTimestamp) : "–";
    itemsEl.innerHTML = [
        item("Status", state),
        item("Generation", `${model.maxGeneration}`),
        item("Programs", `${t.programCount} <span class="muted">${correctPct}% correct</span>`),
        item("Best score", best),
        item("Cost", formatCost(t.totalCost)),
        item("Runtime", formatDuration(t.runtimeSeconds)),
        item("Updated", `<span id="status-updated">${updated}</span>`),
    ].join("");
}
