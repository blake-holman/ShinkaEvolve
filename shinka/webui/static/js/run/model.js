// Pure functions over the rows returned by /get_programs_summary.
// No DOM access, so this module is unit-tested with node (tests/webui/test_run_model.py).

export const ACTIVE_WINDOW_SECONDS = 300;
export const FAILED_PREFIX = "failed:proposal:";

export function isFailedProposal(program) {
    return typeof program.id === "string" && program.id.startsWith(FAILED_PREFIX);
}

export function isCorrect(program) {
    return Boolean(program.correct) && !isFailedProposal(program);
}

/** Numeric score, or NaN when the score is missing (null is not zero). */
export function scoreOf(program) {
    const raw = program.combined_score;
    if (raw === null || raw === undefined || raw === "") return NaN;
    return Number(raw);
}

export function programCost(program) {
    const m = program.metadata || {};
    return ["api_costs", "embed_cost", "novelty_cost", "meta_cost"]
        .map((key) => Number(m[key]) || 0)
        .reduce((a, b) => a + b, 0);
}

export function displayName(program) {
    const m = program.metadata || {};
    if (isFailedProposal(program)) return m.patch_name ? `${m.patch_name} (failed)` : `Failed proposal, generation ${program.generation}`;
    if (program.generation === 0 || m.patch_type === "init") return m.patch_name && m.patch_name !== "initial_program" ? m.patch_name : "Initial program";
    return m.patch_name || `Program ${String(program.id).slice(0, 8)}`;
}

export function modelName(program) {
    const m = program.metadata || {};
    return m.model_name || m.model || (m.llm_result && m.llm_result.model_name) || null;
}

export function patchType(program) {
    const m = program.metadata || {};
    return m.patch_type || (program.generation === 0 ? "init" : null);
}

const PATCH_WORDS = { init: "Initial program", diff: "Diff patch", full: "Full rewrite", cross: "Crossover" };

/** Patch type in plain words ("Diff patch"), or null. */
export function patchWords(program) {
    const type = patchType(program);
    return type ? PATCH_WORDS[type] || type : null;
}

/** CSS class for a score delta. */
export function deltaClass(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return "delta--flat";
    return delta > 0 ? "delta--up" : delta < 0 ? "delta--down" : "delta--flat";
}

/** Integer percentage of programs that are correct. */
export function correctPercent(totals) {
    return totals.programCount ? Math.round((100 * totals.correctCount) / totals.programCount) : 0;
}

/** The program's parent when it is in the model, else null. */
export function parentOf(model, program) {
    if (!program || isMissing(program.parent_id)) return null;
    return model.programs.get(program.parent_id) || null;
}

export function failureText(program) {
    const m = program.metadata || {};
    if (isFailedProposal(program)) return m.failure_reason || program.text_feedback || "Proposal failed before evaluation";
    if (!program.correct) return m.failure_reason || (typeof program.text_feedback === "string" && program.text_feedback) || "Evaluation marked the program incorrect";
    return null;
}

/** Score difference versus the parent, or null when either side has no valid score. */
export function scoreDelta(program, parent) {
    if (!parent || !isCorrect(program) || !isCorrect(parent)) return null;
    const a = scoreOf(program), b = scoreOf(parent);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a - b;
}

function isMissing(value) {
    return value === null || value === undefined || value === "";
}

function compareBest(a, b) {
    // Higher score wins; ties go to the earlier generation, then the earlier timestamp.
    if (scoreOf(b) !== scoreOf(a)) return scoreOf(b) - scoreOf(a);
    if (a.generation !== b.generation) return a.generation - b.generation;
    return (a.timestamp || 0) - (b.timestamp || 0);
}

function sortByAge(programs, ids) {
    return ids.sort((x, y) => {
        const a = programs.get(x), b = programs.get(y);
        return (a.generation - b.generation) || ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id));
    });
}

/**
 * Index rows by id and link children. A program is a root when its parent is
 * missing, or when following parents never reaches a parentless program (a
 * cycle); in the cycle case the link to the parent is dropped so every
 * program is reachable from exactly one root.
 */
function indexPrograms(rows) {
    const programs = new Map();
    for (const row of rows || []) {
        if (!row || isMissing(row.id)) continue;
        programs.set(row.id, { ...row, children: [] });
    }
    const roots = [];
    for (const program of programs.values()) {
        const parent = isMissing(program.parent_id) ? null : programs.get(program.parent_id);
        if (!parent || inCycle(programs, program)) roots.push(program.id);
        else parent.children.push(program.id);
    }
    sortByAge(programs, roots);
    for (const program of programs.values()) sortByAge(programs, program.children);
    return { programs, roots };
}

function inCycle(programs, program) {
    const seen = new Set();
    let current = program;
    while (current && !isMissing(current.parent_id)) {
        if (seen.has(current.id)) return true;
        seen.add(current.id);
        current = programs.get(current.parent_id);
    }
    return false;
}

function groupByGeneration(programs) {
    const byGeneration = new Map();
    let maxGeneration = 0;
    for (const program of programs.values()) {
        const gen = Number(program.generation) || 0;
        maxGeneration = Math.max(maxGeneration, gen);
        if (!byGeneration.has(gen)) byGeneration.set(gen, []);
        byGeneration.get(gen).push(program.id);
    }
    for (const ids of byGeneration.values()) sortByAge(programs, ids);
    return { byGeneration, maxGeneration };
}

function generationStats(programs, byGeneration, maxGeneration) {
    const generations = [];
    let bestSoFar = null, cumulativeCost = 0;
    for (let gen = 0; gen <= maxGeneration; gen++) {
        const members = (byGeneration.get(gen) || []).map((id) => programs.get(id));
        const scoredMembers = members.filter((p) => isCorrect(p) && Number.isFinite(scoreOf(p)));
        const scored = scoredMembers.map(scoreOf);
        const bestInGeneration = scored.length ? Math.max(...scored) : null;
        if (bestInGeneration !== null) bestSoFar = bestSoFar === null ? bestInGeneration : Math.max(bestSoFar, bestInGeneration);
        const cost = members.reduce((sum, p) => sum + programCost(p), 0);
        cumulativeCost += cost;
        generations.push({
            generation: gen,
            count: members.length,
            correctCount: members.filter(isCorrect).length,
            failedCount: members.filter((p) => !isCorrect(p)).length,
            bestInGeneration,
            bestSoFar,
            cost,
            cumulativeCost,
            scores: scored,
            scoredIds: scoredMembers.map((p) => p.id),
        });
    }
    return generations;
}

function runTotals(programs, generations) {
    const all = [...programs.values()];
    const timestamps = all.map((p) => Number(p.timestamp)).filter(Number.isFinite);
    const firstTimestamp = timestamps.length ? Math.min(...timestamps) : null;
    const lastTimestamp = timestamps.length ? Math.max(...timestamps) : null;
    const pipelineStarts = all.map((p) => Number((p.metadata || {}).pipeline_started_at)).filter(Number.isFinite);
    const runStart = pipelineStarts.length ? Math.min(...pipelineStarts) : firstTimestamp;
    const newest = all.filter((p) => Number.isFinite(Number(p.timestamp)))
        .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0] || null;
    return {
        programCount: all.filter((p) => !isFailedProposal(p)).length,
        failedProposalCount: all.filter(isFailedProposal).length,
        correctCount: all.filter(isCorrect).length,
        totalCost: generations.length ? generations[generations.length - 1].cumulativeCost : 0,
        firstTimestamp,
        lastTimestamp,
        newestId: newest ? newest.id : null,
        runtimeSeconds: runStart !== null && lastTimestamp !== null ? Math.max(0, lastTimestamp - runStart) : null,
    };
}

/** "active" when a program arrived within ACTIVE_WINDOW_SECONDS of `now` (epoch seconds). */
export function runStatus(lastTimestamp, now) {
    if (!Number.isFinite(now) || lastTimestamp === null || lastTimestamp === undefined) return "idle";
    return now - lastTimestamp <= ACTIVE_WINDOW_SECONDS ? "active" : "idle";
}

/**
 * Build the run model: an index of programs, the best program and its lineage,
 * per-generation statistics, totals, and whether the run looks active.
 * @param rows programs from /get_programs_summary
 * @param options.now current time in seconds (epoch), used for the active check
 * @param options.extraCost spend not attached to programs (prompt evolution), added to totals.totalCost
 */
export function buildRunModel(rows, options = {}) {
    const { programs, roots } = indexPrograms(rows);
    const { byGeneration, maxGeneration } = groupByGeneration(programs);
    const scored = [...programs.values()].filter((p) => isCorrect(p) && Number.isFinite(scoreOf(p)));
    const best = scored.length ? scored.slice().sort(compareBest)[0] : null;
    const model = { programs, roots, byGeneration, maxGeneration, best };
    model.bestLineage = new Set(best ? lineageOf(model, best.id) : []);
    model.generations = generationStats(programs, byGeneration, maxGeneration);
    model.totals = runTotals(programs, model.generations);
    model.totals.programCost = model.totals.totalCost;
    model.totals.extraCost = Number(options.extraCost) || 0;
    model.totals.totalCost += model.totals.extraCost;
    model.status = runStatus(model.totals.lastTimestamp, options.now);
    return model;
}

/** Ids from the root down to `id` (inclusive), following the links the tree draws. */
export function lineageOf(model, id) {
    const path = [];
    const seen = new Set();
    const roots = model.roots ? new Set(model.roots) : null;
    let current = model.programs.get(id);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.push(current.id);
        if (roots && roots.has(current.id)) break;
        current = isMissing(current.parent_id) ? null : model.programs.get(current.parent_id);
    }
    return path.reverse();
}

/**
 * Nodes whose children are shown initially: the roots, the best lineage, and
 * the lineage of the newest program, so the tree always reaches the
 * generation the run is working on.
 */
export function defaultExpanded(model) {
    const expanded = new Set([...model.roots, ...model.bestLineage]);
    if (model.totals && model.totals.newestId !== null) {
        for (const id of lineageOf(model, model.totals.newestId)) expanded.add(id);
    }
    return expanded;
}

export function allExpanded(model) {
    return new Set(model.programs.keys());
}

/** Ids visible given an expanded set: every root, plus the children of every visible expanded node. */
export function visibleIds(model, expanded) {
    const visible = new Set();
    const queue = [...model.roots];
    while (queue.length) {
        const id = queue.shift();
        if (visible.has(id)) continue;
        visible.add(id);
        if (expanded.has(id)) {
            const program = model.programs.get(id);
            if (program) queue.push(...program.children);
        }
    }
    return visible;
}

/** Every descendant of `id` (not including it). */
export function descendantsOf(model, id) {
    const program = model.programs.get(id);
    const found = [];
    if (!program) return found;
    const seen = new Set([id]);
    const stack = [...program.children];
    while (stack.length) {
        const nextId = stack.pop();
        if (seen.has(nextId)) continue;
        seen.add(nextId);
        const next = model.programs.get(nextId);
        if (!next) continue;
        found.push(nextId);
        stack.push(...next.children);
    }
    return found;
}

/** Number of descendants hidden under `id` for the given expanded set. */
export function hiddenDescendantCount(model, id, expanded) {
    if (expanded.has(id)) return 0;
    return descendantsOf(model, id).length;
}

/** Expand `id` and its whole subtree. Returns a new Set. */
export function expandSubtree(model, expanded, id) {
    return new Set([...expanded, id, ...descendantsOf(model, id)]);
}

/** Collapse `id` and its whole subtree. Returns a new Set. */
export function collapseSubtree(model, expanded, id) {
    const next = new Set(expanded);
    next.delete(id);
    for (const descendant of descendantsOf(model, id)) next.delete(descendant);
    return next;
}

/** Visible programs that are not failed proposals, for "N of M programs shown". */
export function visibleProgramCount(model, visible) {
    let count = 0;
    for (const id of visible) {
        const program = model.programs.get(id);
        if (program && !isFailedProposal(program)) count += 1;
    }
    return count;
}

/** Expand every ancestor of `id` so it becomes visible. Returns a new Set. */
export function expandTo(model, expanded, id) {
    const next = new Set(expanded);
    for (const ancestor of lineageOf(model, id)) if (ancestor !== id) next.add(ancestor);
    return next;
}

// ---------- formatting ----------

export function formatScore(value) {
    if (isMissing(value)) return "–";
    const n = Number(value);
    if (!Number.isFinite(n)) return "–";
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (Math.abs(n) >= 10) return n.toFixed(2);
    return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".0");
}

export function formatDelta(delta) {
    if (delta === null || delta === undefined || !Number.isFinite(delta)) return null;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
    return `${sign}${formatScore(Math.abs(delta))}`;
}

export function formatCost(value) {
    if (isMissing(value)) return "–";
    const n = Number(value);
    if (!Number.isFinite(n)) return "–";
    if (n === 0) return "$0";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    if (n < 1) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(2)}`;
}

export function formatDuration(seconds) {
    if (isMissing(seconds)) return "–";
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return "–";
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function formatAgo(seconds) {
    if (isMissing(seconds)) return "–";
    const s = Number(seconds);
    if (!Number.isFinite(s)) return "–";
    if (s < 5) return "just now";
    if (s < 60) return `${Math.round(s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
}

export function formatTimestamp(seconds) {
    if (isMissing(seconds)) return "–";
    const n = Number(seconds);
    if (!Number.isFinite(n)) return "–";
    return new Date(n * 1000).toLocaleString();
}

export function escapeHtml(text) {
    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
