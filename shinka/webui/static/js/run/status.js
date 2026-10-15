// Status strip: run name, state, best score, last update, cost, programs.
//
// Items are listed in priority order. The strip is one row high and hides
// whatever wraps past it (see .status__items in run.css), so on narrow
// windows the least important items disappear whole instead of being cut.
import { correctPercent, escapeHtml, formatAgo, formatCost, formatDuration, formatScore } from "./model.js";

function item(label, value, title = "") {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<div class="status__item"${titleAttr}><span class="status__label">${escapeHtml(label)}</span><span class="status__value">${value}</span></div>`;
}

/** "task / run" from a database path like "task/run/evolution_db.sqlite". */
export function runLabel(dbPath) {
    const parts = (dbPath || "").split("/").filter(Boolean);
    if (parts.length >= 3) return `${parts[parts.length - 3]} / ${parts[parts.length - 2]}`;
    if (parts.length === 2) return parts[0];
    return parts[0] || "run";
}

function stateItem(model) {
    return model.status === "active"
        ? item("Status", `<span class="pill pill--ok">active</span>`, "A program arrived in the last five minutes")
        : item("Status", `<span class="pill">idle</span>`, "No new program in the last five minutes");
}

/**
 * @param nameEl element for the run name
 * @param itemsEl element for the metric items
 * @param model result of buildRunModel (may be null while loading)
 * @param nowSeconds current time in seconds, for "updated N ago"
 */
export function renderStatus(nameEl, itemsEl, { dbPath, model, nowSeconds, error }) {
    nameEl.textContent = runLabel(dbPath);
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
    const best = model.best
        ? `${formatScore(model.best.combined_score)} <span class="muted">gen ${model.best.generation}</span>`
        : `<span class="muted">none yet</span>`;
    const updated = t.lastTimestamp !== null && Number.isFinite(nowSeconds) ? formatAgo(nowSeconds - t.lastTimestamp) : "–";
    const costTitle = t.extraCost ? `Programs ${formatCost(t.programCost)} + prompt evolution ${formatCost(t.extraCost)}` : "LLM, embedding, novelty, and meta cost of every program";
    itemsEl.innerHTML = [
        stateItem(model),
        item("Best score", best),
        item("Updated", updated, t.lastTimestamp !== null ? new Date(t.lastTimestamp * 1000).toLocaleString() : ""),
        item("Cost", formatCost(t.totalCost), costTitle),
        item("Programs", `${t.programCount} <span class="muted">${correctPercent(t)}% correct</span>`),
        item("Generation", `${model.maxGeneration}`, "Latest generation"),
        item("Runtime", formatDuration(t.runtimeSeconds)),
    ].join("");
}
