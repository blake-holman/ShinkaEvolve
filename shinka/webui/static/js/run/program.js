// Program panel: the selected program's header, code and diff, evaluation
// output, and LLM response.
//
// CONTRACT (implemented by a separate task; main.js depends only on this API)
//
//   renderProgram(container, { model, program, dbPath, api, onSelect })
//     - `program` is the summary row (no code). Fetch code with
//       api.programDetails(dbPath, program.id); fetch the parent's code the
//       same way when a parent exists. Show a loading state meanwhile.
//     - Header: displayName, "Generation N", score with delta from parent
//       (formatDelta, classes delta--up / delta--down / delta--flat), model,
//       patch type pill, cost (programCost), island, a pill for correct /
//       incorrect / failed (failureText as the title or text), and a link
//       "parent: <name>" that calls onSelect(parentId).
//     - Code: highlight.js (hljs) with the program language. A toggle
//       "Show diff from parent" switches to a unified diff built with
//       Diff.createTwoFilesPatch / diffLines (diff-5.1.0, global `Diff`),
//       added lines on --diff-add-bg, removed on --diff-del-bg, with a
//       "changes only" option that keeps 3 lines of context. Copy button.
//     - Collapsible <details class="section"> blocks, open by default only for
//       "Evaluation": text_feedback, stdout_log, stderr_log (from
//       program.metadata), plot images from api.plots(dbPath, generation, id)
//       using api.plotUrl(path). Closed by default: "LLM response"
//       (metadata.thought, patch_description, llm_result.content or msg; show
//       tokens and cost from llm_result) and "Details" (a .kv list of
//       island, timestamp, complexity, public and private metrics, inspiration
//       ids as links calling onSelect, attempt counters, timings).
//     - Failed proposals: no diff toggle, show failureText prominently, and
//       the generated code when details.code is present.
//     - Re-render on refresh must not lose an open diff toggle or scroll
//       position when the same program is still selected (compare program.id).
//     - Everything user-visible is passed through escapeHtml except
//       highlighted code and the diff, which are built from escaped text.
import {
    displayName, modelName, patchType, failureText, isFailedProposal, programCost, scoreDelta,
    formatScore, formatDelta, formatCost, formatDuration, formatTimestamp, escapeHtml,
} from "./model.js";

const LOG_CAP = 20000;          // characters rendered per log
const HIGHLIGHT_CAP = 200000;   // characters above which code is shown without highlighting
const CONTEXT_LINES = 3;
const PATCH_WORDS = { init: "Initial program", diff: "Diff patch", full: "Full rewrite", cross: "Crossover" };
const SECTIONS = [["evaluation", "Evaluation", true], ["llm", "LLM response", false], ["details", "Details", false]];

const viewStates = new Map();       // program id -> { mode, changesOnly, open }
const contexts = new WeakMap();     // panel root element -> render context
const lastHtml = new WeakMap();     // section element -> html it was last filled with
const boundContainers = new WeakSet();

export async function renderProgram(container, args) {
    const { program, dbPath, api } = args;
    bindOnce(container);
    const state = viewStateFor(program.id);
    let root = container.querySelector(":scope > .program");
    const previous = root && root.dataset.programId === String(program.id) ? contexts.get(root) : null;
    if (!previous) {
        container.innerHTML = skeletonHtml(program, state);
        container.scrollTop = 0;
        root = container.querySelector(":scope > .program");
    }
    // Keep showing the previous data while the refreshed data loads.
    const ctx = { ...args, state, data: previous ? previous.data : null };
    contexts.set(root, ctx);
    renderAll(root, ctx);

    const hasParent = program.parent_id !== null && program.parent_id !== undefined;
    try {
        const parentPromise = hasParent && !isFailedProposal(program)
            ? api.programDetails(dbPath, program.parent_id).catch((error) => ({ error }))
            : null;
        const details = await api.programDetails(dbPath, program.id);
        // The details cache is cleared on refresh, so a new object means the run changed; refetch plots then.
        const unchanged = previous && previous.data && previous.data.details === details;
        const plots = unchanged ? previous.data.plots : await api.plots(dbPath, program.generation, program.id).catch(() => []);
        ctx.data = { details, parentDetails: await parentPromise, plots };
    } catch (error) {
        ctx.data = { error };
    }
    if (contexts.get(root) !== ctx || !root.isConnected) return; // superseded by a newer render
    renderAll(root, ctx);
}

function viewStateFor(id) {
    if (!viewStates.has(id)) {
        viewStates.set(id, { mode: "code", changesOnly: true, open: Object.fromEntries(SECTIONS.map(([key, , open]) => [key, open])) });
    }
    return viewStates.get(id);
}


function skeletonHtml(program, state) {
    const sections = SECTIONS.map(([key, title]) =>
        `<details class="section" data-section="${key}"${state.open[key] ? " open" : ""}><summary>${title}</summary><div class="section__body"></div></details>`).join("");
    return `<div class="program" data-program-id="${escapeHtml(program.id)}">
        <div class="program__top">
            <header class="program__header" data-section="header"></header>
            <div class="program__toolbar" data-section="toolbar"></div>
            <div class="program__code" data-section="code"></div>
        </div>${sections}</div>`;
}

function renderAll(root, ctx) {
    const details = ctx.data && ctx.data.details;
    const row = details ? { ...ctx.program, ...details, children: ctx.program.children } : ctx.program;
    setSection(root, "header", headerHtml(ctx, row));
    setSection(root, "toolbar", toolbarHtml(ctx));
    setSection(root, "code", codeAreaHtml(ctx));
    setSection(root, "evaluation", evaluationHtml(ctx, row));
    setSection(root, "llm", llmHtml(row));
    setSection(root, "details", detailsHtml(ctx, row));
}

/** Replace a section's content only when it changed, so refreshes do not flicker or reset scroll. */
function setSection(root, key, html) {
    const section = root.querySelector(`[data-section="${key}"]`);
    const target = section.classList.contains("section") ? section.querySelector(".section__body") : section;
    if (lastHtml.get(target) === html) return;
    lastHtml.set(target, html);
    target.innerHTML = html;
}

// ---------- events ----------

function bindOnce(container) {
    if (boundContainers.has(container)) return;
    boundContainers.add(container);
    container.addEventListener("click", (event) => {
        const control = event.target.closest("[data-program-action]");
        const root = control && control.closest(".program");
        const ctx = root && contexts.get(root);
        if (ctx) handleAction(root, ctx, control);
    });
    // "toggle" does not bubble, so listen in the capture phase.
    container.addEventListener("toggle", (event) => {
        const details = event.target;
        const root = details.closest ? details.closest(".program") : null;
        const ctx = root && contexts.get(root);
        if (ctx && details.dataset.section) ctx.state.open[details.dataset.section] = details.open;
    }, true);
    // Image "error" events do not bubble either; swap unreadable plots for a link.
    container.addEventListener("error", (event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !img.closest(".plot")) return;
        const link = document.createElement("a");
        link.className = "plot__broken";
        link.href = img.src;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Could not display this image; open it directly";
        img.replaceWith(link);
    }, true);
}

function handleAction(root, ctx, control) {
    const action = control.dataset.programAction;
    if (action === "select") {
        if (ctx.onSelect) ctx.onSelect(control.dataset.id);
    } else if (action === "mode") {
        ctx.state.mode = control.dataset.mode;
        setSection(root, "toolbar", toolbarHtml(ctx));
        setSection(root, "code", codeAreaHtml(ctx));
    } else if (action === "changes-only") {
        ctx.state.changesOnly = control.checked;
        setSection(root, "code", codeAreaHtml(ctx));
    } else if (action === "copy") {
        copyText(control, control.dataset.text !== undefined ? control.dataset.text : currentText(ctx));
    } else if (action === "retry") {
        ctx.data = null; // drop the error so the loading state shows while refetching
        renderProgram(root.parentElement, ctx);
    }
}

async function copyText(button, text) {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const area = document.createElement("textarea");
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }
        flash(button, "Copied");
    } catch (_) {
        flash(button, "Copy failed");
    }
}

function flash(button, label) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = label;
    clearTimeout(button.flashTimer);
    button.flashTimer = setTimeout(() => { button.textContent = button.dataset.label; }, 1500);
}

/** What the toolbar Copy button copies: the code, or the unified diff in diff mode. */
function currentText(ctx) {
    const { data, program, state } = ctx;
    const code = data && data.details && data.details.code;
    if (code === null || code === undefined) return "";
    const parent = data.parentDetails;
    if (state.mode === "diff" && parent && !parent.error && parent.code !== null && parent.code !== undefined) {
        return Diff.createTwoFilesPatch(String(program.parent_id), String(program.id), String(parent.code), String(code));
    }
    return String(code);
}

// ---------- header and toolbar ----------

function headerHtml(ctx, row) {
    const { model, program } = ctx;
    const parent = parentOf(model, program);
    const failed = isFailedProposal(program);
    const pills = [
        `<span class="pill">Generation ${escapeHtml(program.generation ?? "?")}</span>`,
        statusPill(program),
        model.best && model.best.id === program.id ? `<span class="pill pill--accent" title="Highest score in the run">best</span>` : "",
        patchPill(program),
    ].filter(Boolean).join("");
    const island = program.island_idx === null || program.island_idx === undefined ? "" : fact("Island", escapeHtml(program.island_idx));
    const facts = [
        failed ? "" : fact("Score", scoreHtml(program, parent)),
        fact("Model", escapeHtml(modelName(program) || "")),
        fact("Cost", escapeHtml(formatCost(programCost(program)))),
        island,
    ].join("");
    const children = Array.isArray(program.children) ? program.children.length : Number(program.children_count) || 0;
    return `<h2 class="program__name">${escapeHtml(displayName(row))}</h2>
        <div class="program__facts">${pills}${facts}</div>
        <div class="program__links">${parentHtml(model, program)}<span class="program__sep">·</span>Children: ${children}</div>
        ${failed ? failureHtml(program) : ""}`;
}

function fact(label, valueHtml) {
    if (!valueHtml) return "";
    return `<span class="program__fact"><span class="program__fact-label">${label}</span> <strong>${valueHtml}</strong></span>`;
}

function statusPill(program) {
    if (isFailedProposal(program)) return `<span class="pill pill--bad" title="${escapeHtml(failureText(program))}">failed</span>`;
    if (!program.correct) return `<span class="pill pill--bad" title="${escapeHtml(failureText(program))}">incorrect</span>`;
    return `<span class="pill pill--ok">correct</span>`;
}

function patchPill(program) {
    const type = patchType(program);
    if (!type) return "";
    return `<span class="pill" title="Patch type">${escapeHtml(PATCH_WORDS[type] || type)}</span>`;
}

function scoreHtml(program, parent) {
    let html = escapeHtml(formatScore(program.combined_score));
    const delta = scoreDelta(program, parent);
    if (delta !== null) {
        const cls = delta > 0 ? "delta--up" : delta < 0 ? "delta--down" : "delta--flat";
        html += ` <span class="${cls}" title="Change versus the parent">${escapeHtml(formatDelta(delta))}</span>`;
    }
    return html;
}

function parentOf(model, program) {
    if (program.parent_id === null || program.parent_id === undefined) return null;
    return model.programs.get(program.parent_id) || null;
}

function parentHtml(model, program) {
    const parent = parentOf(model, program);
    if (parent) return `Parent: ${selectButton(parent)}`;
    if (program.parent_id !== null && program.parent_id !== undefined) {
        return `Parent: <span class="mono" title="${escapeHtml(program.parent_id)}">${escapeHtml(shortId(program.parent_id))}</span> <span class="faint">(not in this run)</span>`;
    }
    return `Parent: <span class="muted">none</span>`;
}

function selectButton(program) {
    return `<button type="button" class="btn-link" data-program-action="select" data-id="${escapeHtml(program.id)}" title="${escapeHtml(program.id)}">${escapeHtml(displayName(program))}</button>`;
}

function shortId(id) {
    const text = String(id);
    return text.length > 12 ? `${text.slice(0, 8)}…` : text;
}

function failureHtml(program) {
    const m = program.metadata || {};
    const stage = m.failure_stage ? `<strong>Failed during ${escapeHtml(String(m.failure_stage).replace(/_/g, " "))}.</strong> ` : "";
    return `<p class="program__failure">${stage}${escapeHtml(failureText(program))}</p>`;
}

function toolbarHtml(ctx) {
    const { program, state } = ctx;
    const copy = `<span class="spacer"></span><button type="button" class="btn btn--small" data-program-action="copy" title="Copy to the clipboard">Copy</button>`;
    if (isFailedProposal(program)) return `<span class="muted">Generated code</span>${copy}`;
    const hasParent = program.parent_id !== null && program.parent_id !== undefined;
    const diffMode = state.mode === "diff" && hasParent;
    const diffAttrs = hasParent ? "" : ` disabled title="This program has no parent"`;
    return `<div class="segmented">
            <button type="button" class="btn btn--small${diffMode ? "" : " is-active"}" data-program-action="mode" data-mode="code">Code</button>
            <button type="button" class="btn btn--small${diffMode ? " is-active" : ""}" data-program-action="mode" data-mode="diff"${diffAttrs}>Diff from parent</button>
        </div>
        <label class="program__check${diffMode ? "" : " hidden"}"><input type="checkbox" data-program-action="changes-only"${state.changesOnly ? " checked" : ""}> Changes only</label>${copy}`;
}

// ---------- code and diff ----------

function codeAreaHtml(ctx) {
    const { program, state, data } = ctx;
    if (!data) return `<div class="program__loading muted">Loading code…</div>`;
    if (data.error) {
        return `<div class="program__error">Could not load the code: ${escapeHtml(data.error.message || data.error)}
            <button type="button" class="btn btn--small" data-program-action="retry">Retry</button></div>`;
    }
    const code = data.details.code;
    if (code === null || code === undefined || code === "") {
        return `<div class="empty">${isFailedProposal(program) ? "No generated code was saved for this proposal." : "This program has no code."}</div>`;
    }
    const hasParent = program.parent_id !== null && program.parent_id !== undefined;
    if (state.mode === "diff" && hasParent && !isFailedProposal(program)) return diffViewHtml(ctx, String(code));
    return codeHtml(String(code), data.details.language || program.language);
}

function codeHtml(code, language) {
    let value = null, lang = language;
    if (typeof hljs !== "undefined" && code.length <= HIGHLIGHT_CAP) {
        try {
            const result = language && hljs.getLanguage(language) ? hljs.highlight(code, { language }) : hljs.highlightAuto(code);
            value = result.value;
            lang = result.language || language;
        } catch (_) { value = null; }
    }
    return `<pre class="code"><code class="hljs language-${escapeHtml(lang || "plaintext")}">${value === null ? escapeHtml(code) : value}</code></pre>`;
}

function diffViewHtml(ctx, code) {
    const { model, program, state, data } = ctx;
    const parent = data.parentDetails;
    if (!parent) return `<div class="empty">The parent's code is not available.</div>`;
    if (parent.error) return `<div class="program__error">Could not load the parent's code: ${escapeHtml(parent.error.message || parent.error)}</div>`;
    if (parent.code === null || parent.code === undefined) return `<div class="empty">The parent has no code to compare with.</div>`;
    const inModel = model.programs.get(program.parent_id);
    const parentName = escapeHtml(inModel ? displayName(inModel) : shortId(program.parent_id));
    const rows = diffRows(String(parent.code), code);
    const added = rows.filter((r) => r.type === "add").length;
    const removed = rows.filter((r) => r.type === "del").length;
    const summary = added || removed
        ? `<span class="delta--up">+${added}</span> <span class="delta--down">−${removed}</span> lines compared with ${parentName}`
        : `The code is identical to ${parentName}`;
    const shown = state.changesOnly ? collapseContext(rows) : rows;
    return `<div class="diff__summary muted">${summary}</div>${diffTableHtml(shown)}`;
}

/** Line rows ({type: add|del|ctx, oldNo, newNo, text}) from jsdiff's line parts. */
function diffRows(parentCode, code) {
    const rows = [];
    let oldNo = 1, newNo = 1;
    for (const part of Diff.diffLines(parentCode, code)) {
        for (const text of part.value.replace(/\n$/, "").split("\n")) {
            if (part.added) rows.push({ type: "add", oldNo: null, newNo: newNo++, text });
            else if (part.removed) rows.push({ type: "del", oldNo: oldNo++, newNo: null, text });
            else rows.push({ type: "ctx", oldNo: oldNo++, newNo: newNo++, text });
        }
    }
    return rows;
}

/** Keep CONTEXT_LINES unchanged lines around each change; fold the rest into gap rows. */
function collapseContext(rows) {
    const out = [];
    let run = [];
    const flush = (keepHead, keepTail) => {
        if (run.length <= keepHead + keepTail) {
            out.push(...run);
        } else {
            out.push(...run.slice(0, keepHead), { type: "gap", count: run.length - keepHead - keepTail });
            if (keepTail) out.push(...run.slice(run.length - keepTail));
        }
        run = [];
    };
    for (const row of rows) {
        if (row.type === "ctx") { run.push(row); continue; }
        flush(out.length ? CONTEXT_LINES : 0, CONTEXT_LINES);
        out.push(row);
    }
    flush(out.length ? CONTEXT_LINES : 0, 0);
    return out;
}

function diffTableHtml(rows) {
    if (!rows.length) return `<div class="empty">Both programs are empty.</div>`;
    const body = rows.map((row) => {
        if (row.type === "gap") return `<tr class="diff__gap"><td colspan="3">… ${row.count} unchanged line${row.count === 1 ? "" : "s"}</td></tr>`;
        return `<tr class="diff__${row.type}"><td class="diff__no">${row.oldNo ?? ""}</td><td class="diff__no">${row.newNo ?? ""}</td><td class="diff__text">${escapeHtml(row.text)}</td></tr>`;
    }).join("");
    return `<div class="diff"><table>${body}</table></div>`;
}

// ---------- sections ----------

function evaluationHtml(ctx, row) {
    const m = row.metadata || {};
    const blocks = [
        logBlock("Feedback", row.text_feedback),
        logBlock("Standard output", m.stdout_log),
        logBlock("Standard error", m.stderr_log),
    ].filter(Boolean);
    const plots = ctx.data && Array.isArray(ctx.data.plots) ? ctx.data.plots : [];
    if (plots.length) blocks.push(plotsHtml(ctx.api, plots));
    return blocks.length ? blocks.join("") : `<p class="muted">No evaluation output was recorded.</p>`;
}

function logBlock(label, text) {
    if (text === null || text === undefined) return "";
    let body = typeof text === "object" ? JSON.stringify(text, null, 2) : String(text);
    if (body.trim() === "") return "";
    let note = "";
    if (body.length > LOG_CAP) {
        note = `<span class="log__note">showing the last ${LOG_CAP.toLocaleString()} characters of ${body.length.toLocaleString()}</span>`;
        body = body.slice(-LOG_CAP);
    }
    return `<div class="log-block"><div class="log__label">${escapeHtml(label)}${note}</div><pre class="log">${escapeHtml(body)}</pre></div>`;
}

function plotsHtml(api, plots) {
    const figures = plots.map((plot) => {
        const name = plot.filename || String(plot.path || "").split("/").pop() || "plot";
        const url = escapeHtml(api.plotUrl(String(plot.path || "")));
        const media = /\.(png|jpe?g|gif|svg|webp)$/i.test(name)
            ? `<img src="${url}" alt="${escapeHtml(name)}" loading="lazy">`
            : `<a href="${url}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
        return `<figure class="plot">${media}<figcaption>${escapeHtml(name)}</figcaption></figure>`;
    }).join("");
    return `<div class="log-block"><div class="log__label">Plots</div><div class="plots">${figures}</div></div>`;
}

function llmHtml(row) {
    const m = row.metadata || {};
    const result = m.llm_result && typeof m.llm_result === "object" ? m.llm_result : {};
    const blocks = [
        logBlock("Patch description", m.patch_description),
        logBlock("Reasoning", m.thought || result.thought),
        logBlock("Response", result.content || result.msg),
    ].filter(Boolean);
    const pairs = [
        ["Model", escapeHtml(result.model_name || modelName(row) || "")],
        ["Input tokens", formatInt(result.input_tokens)],
        ["Output tokens", formatInt(result.output_tokens)],
        ["Thinking tokens", formatInt(result.thinking_tokens)],
        ["Cost", result.cost === null || result.cost === undefined ? "" : escapeHtml(formatCost(result.cost))],
    ].filter(([, value]) => value);
    if (pairs.length) blocks.push(kvHtml(pairs));
    return blocks.length ? blocks.join("") : `<p class="muted">No LLM response was recorded.</p>`;
}

function detailsHtml(ctx, row) {
    const m = row.metadata || {};
    const attempts = m.attempts && typeof m.attempts === "object" ? m.attempts : m;
    const analysis = m.code_analysis_metrics || {};
    const pairs = [
        ["Id", idHtml(row.id)],
        ["Parent id", row.parent_id === null || row.parent_id === undefined ? `<span class="muted">none</span>` : idHtml(row.parent_id)],
        ["Island", row.island_idx === null || row.island_idx === undefined ? "" : escapeHtml(row.island_idx)],
        ["Evaluated", escapeHtml(formatTimestamp(row.timestamp))],
        ["Complexity", row.complexity === null || row.complexity === undefined ? "" : escapeHtml(formatScore(row.complexity))],
        ["Lines of code", formatInt(analysis.lines_of_code)],
        ["Public metrics", metricsHtml(row.public_metrics)],
        ["Private metrics", metricsHtml(row.private_metrics)],
        ["Attempts", joinFacts([["novelty", formatInt(attempts.novelty_attempt)], ["resample", formatInt(attempts.resample_attempt)], ["patch", formatInt(attempts.patch_attempt)]])],
        ["Timings", joinFacts([["sampling", formatSeconds(m.sampling_seconds)], ["evaluation", formatSeconds(m.evaluation_seconds)], ["postprocess", formatSeconds(m.postprocess_seconds)]])],
        ["Inspirations", inspirationsHtml(ctx.model, row.top_k_inspiration_ids)],
        ["Archive inspirations", inspirationsHtml(ctx.model, row.archive_inspiration_ids)],
    ].filter(([, value]) => value);
    return kvHtml(pairs);
}

function idHtml(id) {
    return `<span class="mono">${escapeHtml(id)}</span> <button type="button" class="btn btn--small" data-program-action="copy" data-text="${escapeHtml(id)}" title="Copy the id">Copy</button>`;
}

function kvHtml(pairs) {
    return `<dl class="kv">${pairs.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`).join("")}</dl>`;
}

function metricsHtml(metrics) {
    if (!metrics || typeof metrics !== "object") return "";
    const entries = Object.entries(metrics);
    if (!entries.length) return "";
    return entries.map(([key, value]) => `<div><span class="muted">${escapeHtml(key)}</span> ${escapeHtml(formatValue(value))}</div>`).join("");
}

function inspirationsHtml(model, ids) {
    if (!Array.isArray(ids) || !ids.length) return "";
    return ids.map((id) => {
        const program = model.programs.get(id);
        return program ? selectButton(program) : `<span class="mono" title="${escapeHtml(id)} (not in this run)">${escapeHtml(shortId(id))}</span>`;
    }).join(", ");
}

/** "label value · label value" from [label, formatted] pairs, skipping empty values. */
function joinFacts(pairs) {
    return pairs.filter(([, value]) => value).map(([label, value]) => `${escapeHtml(label)} ${value}`).join(` <span class="faint">·</span> `);
}

function formatValue(value) {
    if (typeof value === "number") return formatScore(value);
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "–");
}

function formatInt(value) {
    const n = Number(value);
    return value === null || value === undefined || !Number.isFinite(n) ? "" : escapeHtml(n.toLocaleString());
}

function formatSeconds(value) {
    const s = Number(value);
    if (value === null || value === undefined || !Number.isFinite(s)) return "";
    return escapeHtml(s < 60 ? `${s.toFixed(1)} s` : formatDuration(s));
}
