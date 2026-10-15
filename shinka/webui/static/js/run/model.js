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

function compareBest(a, b) {
    // Higher score wins; ties go to the earlier generation, then the earlier timestamp.
    if (scoreOf(b) !== scoreOf(a)) return scoreOf(b) - scoreOf(a);
    if (a.generation !== b.generation) return a.generation - b.generation;
    return (a.timestamp || 0) - (b.timestamp || 0);
}

/**
 * Build the run model: an index of programs, the best program and its lineage,
 * per-generation statistics, totals, and whether the run looks active.
 * @param rows programs from /get_programs_summary
 * @param options.now current time in seconds (epoch), used for the active check
 */
export function buildRunModel(rows, options = {}) {
    const programs = new Map();
    for (const row of rows || []) {
        if (!row || row.id === undefined || row.id === null) continue;
        programs.set(row.id, { ...row, children: [] });
    }
    const roots = [];
    for (const program of programs.values()) {
        const parent = program.parent_id !== null && program.parent_id !== undefined ? programs.get(program.parent_id) : null;
        if (parent) parent.children.push(program.id);
        else roots.push(program.id);
    }
    const byId = (id) => programs.get(id);
    const sortIds = (ids) => ids.sort((x, y) => {
        const a = byId(x), b = byId(y);
        return (a.generation - b.generation) || ((a.timestamp || 0) - (b.timestamp || 0)) || String(a.id).localeCompare(String(b.id));
    });
    sortIds(roots);
    for (const program of programs.values()) sortIds(program.children);

    const byGeneration = new Map();
    let maxGeneration = 0;
    for (const program of programs.values()) {
        const gen = Number(program.generation) || 0;
        maxGeneration = Math.max(maxGeneration, gen);
        if (!byGeneration.has(gen)) byGeneration.set(gen, []);
        byGeneration.get(gen).push(program.id);
    }
    for (const ids of byGeneration.values()) sortIds(ids);

    const correct = [...programs.values()].filter(isCorrect).filter((p) => Number.isFinite(scoreOf(p)));
    const best = correct.length ? correct.slice().sort(compareBest)[0] : null;
    const bestLineage = new Set(best ? lineageOf({ programs }, best.id) : []);

    const generations = [];
    let bestSoFar = null, cumulativeCost = 0;
    for (let gen = 0; gen <= maxGeneration; gen++) {
        const ids = byGeneration.get(gen) || [];
        const members = ids.map(byId);
        const scored = members.filter(isCorrect).map(scoreOf).filter(Number.isFinite);
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
        });
    }

    const timestamps = [...programs.values()].map((p) => Number(p.timestamp)).filter(Number.isFinite);
    const firstTimestamp = timestamps.length ? Math.min(...timestamps) : null;
    const lastTimestamp = timestamps.length ? Math.max(...timestamps) : null;
    const pipelineStarts = [...programs.values()].map((p) => Number((p.metadata || {}).pipeline_started_at)).filter(Number.isFinite);
    const runStart = pipelineStarts.length ? Math.min(...pipelineStarts) : firstTimestamp;
    const now = Number.isFinite(options.now) ? options.now : null;

    return {
        programs,
        roots,
        byGeneration,
        maxGeneration,
        best,
        bestLineage,
        generations,
        totals: {
            programCount: [...programs.values()].filter((p) => !isFailedProposal(p)).length,
            failedProposalCount: [...programs.values()].filter(isFailedProposal).length,
            correctCount: correct.length,
            totalCost: cumulativeCost,
            firstTimestamp,
            lastTimestamp,
            runtimeSeconds: runStart !== null && lastTimestamp !== null ? Math.max(0, lastTimestamp - runStart) : null,
        },
        status: now !== null && lastTimestamp !== null && now - lastTimestamp <= ACTIVE_WINDOW_SECONDS ? "active" : "idle",
    };
}

/** Ids from the root down to `id` (inclusive). Cycles are cut. */
export function lineageOf(model, id) {
    const path = [];
    const seen = new Set();
    let current = model.programs.get(id);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.push(current.id);
        current = current.parent_id !== null && current.parent_id !== undefined ? model.programs.get(current.parent_id) : null;
    }
    return path.reverse();
}

/** Nodes whose children are shown initially: roots plus every node on the best lineage. */
export function defaultExpanded(model) {
    return new Set([...model.roots, ...model.bestLineage]);
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

/** Number of descendants hidden under `id` for the given expanded set. */
export function hiddenDescendantCount(model, id, expanded) {
    const program = model.programs.get(id);
    if (!program || expanded.has(id)) return 0;
    let count = 0;
    const stack = [...program.children];
    while (stack.length) {
        const next = model.programs.get(stack.pop());
        if (!next) continue;
        count += 1;
        stack.push(...next.children);
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
    const n = Number(value);
    if (!Number.isFinite(n)) return "–";
    if (n === 0) return "$0";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    if (n < 1) return `$${n.toFixed(3)}`;
    return `$${n.toFixed(2)}`;
}

export function formatDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return "–";
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function formatAgo(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s)) return "–";
    if (s < 5) return "just now";
    if (s < 60) return `${Math.round(s)}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
}

export function formatTimestamp(seconds) {
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
