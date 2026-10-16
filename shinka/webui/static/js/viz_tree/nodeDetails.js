// Node, Code, Eval, and LLM tabs for the selected program.
import { debug } from '../log.js';
import { formatTimestamp } from './databases.js';
import { createCharts } from './metaInfo.js';
import { displayCurrentDiff } from './diffView.js';
import { buildFailureSummaryHtml, escapeHtml, formatScore, getScoreClass } from './format.js';
import { saveState } from './state.js';
import { updateAnalysisTab } from './analysisPlots.js';
import { updateThroughputTab } from './throughput.js';

// Helper function to display code content in the code wrapper
function displayCodeContent(data, codeWrapper) {
    if (!data.code) {
        document.querySelector('#agent-code .code-controls').style.display = 'none';
        codeWrapper.innerHTML = "<p>No code available for this node.</p>";
        return;
    }
    
    document.querySelector('#agent-code .code-controls').style.display = 'flex';
    
    const sanitizedCode = escapeHtml(data.code);
    const lines = data.code.split('\n');
    const lineNumbers = Array.from({length: lines.length}, (_, i) => `<span>${i + 1}</span>`).join('');

    codeWrapper.innerHTML = `
        <div class="code-container">
            <div class="line-numbers-gutter">${lineNumbers}</div>
            <pre><code class="language-${data.language || 'python'}">${sanitizedCode}</code></pre>
        </div>
    `;

    // Use a slight delay to ensure the DOM has updated
    setTimeout(() => {
        const codeBlock = codeWrapper.querySelector('code');
        if (codeBlock) {
            if (typeof hljs !== 'undefined') {
                hljs.highlightElement(codeBlock);
            } else {
                console.warn('highlight.js not found, skipping syntax highlighting.');
            }
        }
    }, 50);
}

// Display node details in the right panel
export function displayNodeDetails(data) {
    debug("[DEBUG] Displaying node details for:", data.agent_name, "Gen:", data.generation, "ID:", data.id);
    
    // Store selected node ID globally
    window.selectedNodeId = data.id;
    
    // Sync selection in the program table
    const tableBody = document.querySelector("#program-table tbody");
    if (tableBody) {
        tableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
        const row = tableBody.querySelector(`tr[data-node-id="${data.id}"]`);
        if (row) {
            row.classList.add('selected');
        }
    }
    
    // Sync selection in the best path timeline
    const bestPathContainer = document.querySelector("#best-path-container");
    if (bestPathContainer) {
        bestPathContainer.querySelectorAll('.timeline-item').forEach(i => i.classList.remove('selected'));
        const item = bestPathContainer.querySelector(`.timeline-item[data-node-id="${data.id}"]`);
        if (item) {
            item.classList.add('selected');
        }
    }
    
    // Save state when node is selected
    saveState();
    
    const agentName = data.metadata.patch_name || data.agent_name || "unnamed_agent";
    const score = data.combined_score;
    
    // Update node summary
    document.getElementById("node-summary").innerHTML = `
        <h3>${agentName} (Gen ${data.generation})</h3>
        <p><strong>ID:</strong> <span style="font-family: monospace;">${data.id}</span></p>
        <p><strong>Parent ID:</strong> <span style="font-family: monospace;">${data.parent_id || 'None'}</span></p>
        <p><strong>Score:</strong> <span class="${getScoreClass(score)}">${formatScore(score)}</span></p>
        ${data.error ? `<p><strong>Error:</strong> <span class="metric-bad">${data.error}</span></p>` : ''}
    `;
    

    // Update charts in Meta Info tab to highlight this generation
    if (document.querySelector('.tab[data-tab="agent-info"]').classList.contains('active') && !window.isResizing) {
        createCharts(data.generation);
    }

    // --- Update Node Details Tab ---
    const nodeDetailsContainer = document.getElementById('node-details');

    let publicMetricsHtml = '';
    if (data.public_metrics && Object.keys(data.public_metrics).length > 0) {
        for (const [key, value] of Object.entries(data.public_metrics)) {
            publicMetricsHtml += `<p><strong>${key}:</strong> ${formatScore(value)}</p>`;
        }
    } else {
        publicMetricsHtml = '<p>No public metrics available.</p>';
    }

    let privateMetricsHtml = '';
    if (data.private_metrics && Object.keys(data.private_metrics).length > 0) {
        for (const [key, value] of Object.entries(data.private_metrics)) {
            privateMetricsHtml += `<p><strong>${key}:</strong> ${formatScore(value)}</p>`;
        }
    } else {
        privateMetricsHtml = '<p>No private metrics available.</p>';
    }

    let metadataHtml = '';
    let privateMetaFieldsHtml = '';
    
    if (data.metadata) {
        for (const [key, value] of Object.entries(data.metadata)) {
            if (key !== 'thought' && key !== 'code_analysis_metrics' && key !== 'patch_description' && key !== 'stdout_log' && key !== 'stderr_log' && key !== 'llm_result') {
                
                let valueHtml;
                if (typeof value === 'object' && value !== null) {
                    valueHtml = `<pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #f6f8fa; padding: 10px; border-radius: 3px; margin-top: 5px;">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
                    metadataHtml += `<div style="margin-bottom: 10px;"><strong>${key}:</strong>${valueHtml}</div>`;
                } else {
                    const valueStr = String(value);
                    
                    // Check if this is one of the fields that should be moved to Private Metrics & Feedback
                    if (key === 'meta_recommendations' || key === 'novelty_explanation' || key === 'meta_summary' || key === 'meta_scratch_pad') {
                        valueHtml = `
                            <details class="metadata-details">
                                <summary class="metadata-summary">Expand to view</summary>
                                <div class="metadata-value-expandable">
                                    <pre><code class="nohighlight">${escapeHtml(valueStr)}</code></pre>
                                </div>
                            </details>
                        `;
                        privateMetaFieldsHtml += `<p><strong>${key}:</strong>${valueHtml}</p>`;
                    } else {
                        const isLongValue = valueStr.length > 50;
                        const valueClass = isLongValue ? 'metadata-value' : '';
                        valueHtml = `<span class="${valueClass}">${escapeHtml(valueStr)}</span>`;
                        metadataHtml += `<p><strong>${key}:</strong> ${valueHtml}</p>`;
                    }
                }
            }
        }
    }
    
    if (!metadataHtml) {
        metadataHtml = '<p>No metadata available.</p>';
    }

    let analysisMetricsHtml = '';
    if (data.metadata && data.metadata.code_analysis_metrics) {
        analysisMetricsHtml = `
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #ddd; padding: 6px; text-align: left; width: 60%;">Metric</th>
                        <th style="border: 1px solid #ddd; padding: 6px; text-align: right; width: 40%;">Value</th>
                    </tr>
                </thead>
                <tbody>`;
        
        for (const [key, value] of Object.entries(data.metadata.code_analysis_metrics)) {
            const formattedValue = typeof value === 'number' ? value.toFixed(2) : value;
            const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            
            analysisMetricsHtml += `
                <tr>
                    <td style="border: 1px solid #ddd; padding: 6px;">${displayKey}</td>
                    <td style="border: 1px solid #ddd; padding: 6px; text-align: right; font-family: monospace;">${formattedValue}</td>
                </tr>`;
        }
        
        analysisMetricsHtml += `
                </tbody>
            </table>`;
    } else {
        analysisMetricsHtml = '<p>No analysis metrics.</p>';
    }

    const failureSummaryHtml = buildFailureSummaryHtml(data);

    let gridItemsHtml = `
            <div class="details-section">
                <h5>General</h5>
                <p><strong>Language:</strong> ${data.language || 'N/A'}</p>
                <p><strong>Island:</strong> ${data.island_idx !== null && data.island_idx !== undefined ? data.island_idx : 'N/A'}</p>
                <p><strong>Timestamp:</strong> ${formatTimestamp(data.timestamp)}</p>
                <p><strong>Correct:</strong> ${data.correct ? 'Yes' : 'No'}</p>
                <p><strong>Children:</strong> ${data.children_count || 0}</p>
                <p><strong>Complexity:</strong> ${data.complexity || 'N/A'}</p>
</div>
            ${failureSummaryHtml}
            <div class="details-section">
                <h5>Performance Score</h5>
                <p><strong>Combined Score:</strong> ${formatScore(data.combined_score)}</p>
            </div>
            <div class="details-section">
                <h5>Public Metrics</h5>
                ${publicMetricsHtml}
            </div>
            <div class="details-section">
                <h5>Private Metrics & Feedback</h5>
                ${privateMetricsHtml}
                ${privateMetaFieldsHtml ? `
                    <div style="margin-top: 15px;">
                        <h6 style="color: #666; margin-bottom: 10px;">Meta Analysis:</h6>
                        ${privateMetaFieldsHtml}
                    </div>
                ` : ''}
                ${data.text_feedback && data.text_feedback.trim() ? `
                    <div style="margin-top: 15px;">
                        <details class="metadata-details">
                            <summary class="metadata-summary" style="cursor: pointer; font-weight: bold; color: #007bff; margin-bottom: 8px;">📝 Text Feedback</summary>
                            <div style="background-color: #f8f9fa; padding: 10px; border-radius: 5px; border-left: 4px solid #007bff; margin-top: 8px; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(data.text_feedback)}</div>
                        </details>
                    </div>
                ` : '<p style="margin-top: 15px; color: #666; font-style: italic;">No text feedback available.</p>'}
            </div>
            <div class="details-section">
                <h5>Metadata</h5>
                ${metadataHtml}
            </div>
            <div class="details-section">
                <h5>Code Analysis</h5>
                ${analysisMetricsHtml}
        </div>
    `;

    if (!(data.metadata && data.metadata.thought)) {
        const patchType = data.metadata.patch_type || 'N/A';
        const patchName = data.metadata.patch_name || 'N/A';
        const patchDescription = data.metadata.patch_description || '';
        
        let patchDescriptionHtml = '';
        if (patchDescription) {
            patchDescriptionHtml = `
                <p><strong>Description:</strong> 
                <span class="tooltip">
                    <span class="truncated-text">${patchDescription}</span>
                    <span class="tooltip-text">${patchDescription}</span>
                </span>
                </p>
            `;
        }
        
        let inspirationHtml = '';
        const topKIds = data.top_k_inspiration_ids || [];
        const archiveIds = data.archive_inspiration_ids || [];
        const parentId = data.parent_id;
        
        if (parentId || topKIds.length > 0 || archiveIds.length > 0) {
            inspirationHtml = `
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px;">
                    <thead>
                        <tr style="background-color: #f0f0f0;">
                            <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">Type</th>
                            <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">Node ID</th>
                            <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">Gen</th>
                            <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">I</th>
                            <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">Score</th>
                        </tr>
                    </thead>
                    <tbody>`;
            
            // Add parent node first if it exists
            if (parentId) {
                // Debug: Check if we're looking for a virtual root
                if (parentId.includes('___virtual_root')) {
                    console.error("[DEBUG] Virtual root found in inspiration data! ParentId:", parentId);
                    console.error("[DEBUG] window.treeData contains virtual roots:", window.treeData.some(n => n.id.includes('___virtual_root')));
                }
                
                const parentNode = window.treeData ? window.treeData.find(n => n.id === parentId) : null;
                const gen = parentNode ? parentNode.generation : 'N/A';
                const island = parentNode && parentNode.island_idx !== null && parentNode.island_idx !== undefined ? parentNode.island_idx : 'N/A';
                const score = parentNode && parentNode.combined_score !== null && parentNode.combined_score !== undefined ? parentNode.combined_score.toFixed(2) : 'N/A';
                const shortId = parentId.length > 8 ? parentId.substring(0, 8) + '...' : parentId;
                
                inspirationHtml += `
                    <tr>
                        <td style="border: 1px solid #ddd; padding: 4px;">Parent</td>
                        <td style="border: 1px solid #ddd; padding: 4px; font-family: monospace; color: #007bff; cursor: pointer; text-decoration: underline;" onclick="selectNodeById('${parentId}')">${shortId}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${gen}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${island}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${score}</td>
                    </tr>`;
            }
            
            topKIds.forEach(id => {
                const node = window.treeData ? window.treeData.find(n => n.id === id) : null;
                const gen = node ? node.generation : 'N/A';
                const island = node && node.island_idx !== null && node.island_idx !== undefined ? node.island_idx : 'N/A';
                const score = node && node.combined_score !== null && node.combined_score !== undefined ? node.combined_score.toFixed(2) : 'N/A';
                const shortId = id.length > 8 ? id.substring(0, 8) + '...' : id;
                
                inspirationHtml += `
                    <tr>
                        <td style="border: 1px solid #ddd; padding: 4px;">Top-K</td>
                        <td style="border: 1px solid #ddd; padding: 4px; font-family: monospace; color: #007bff; cursor: pointer; text-decoration: underline;" onclick="selectNodeById('${id}')">${shortId}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${gen}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${island}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${score}</td>
                    </tr>`;
            });
            
            archiveIds.forEach(id => {
                const node = window.treeData ? window.treeData.find(n => n.id === id) : null;
                const gen = node ? node.generation : 'N/A';
                const island = node && node.island_idx !== null && node.island_idx !== undefined ? node.island_idx : 'N/A';
                const score = node && node.combined_score !== null && node.combined_score !== undefined ? node.combined_score.toFixed(2) : 'N/A';
                const shortId = id.length > 8 ? id.substring(0, 8) + '...' : id;
                
                inspirationHtml += `
                    <tr>
                        <td style="border: 1px solid #ddd; padding: 4px;">Archive</td>
                        <td style="border: 1px solid #ddd; padding: 4px; font-family: monospace; color: #007bff; cursor: pointer; text-decoration: underline;" onclick="selectNodeById('${id}')">${shortId}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${gen}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${island}</td>
                        <td style="border: 1px solid #ddd; padding: 4px;">${score}</td>
                    </tr>`;
            });
            
            inspirationHtml += `
                    </tbody>
                </table>`;
    } else {
            inspirationHtml = '<p>No inspiration nodes available.</p>';
        }

        gridItemsHtml += `
            <div class="details-section">
                <h5>Patch Information</h5>
                <div class="details-section-content">
                <p><strong>Patch Type:</strong> ${patchType}</p>
                <p><strong>Patch Name:</strong> ${patchName}</p>
                    ${patchDescriptionHtml}
                </div>
            </div>
            <div class="details-section">
                <h5>Inspiration</h5>
                <div class="details-section-content">
                    ${inspirationHtml}
            </div>
            </div>
        `;
    }

    let migrationHistoryHtml = '';
    if (data.migration_history && data.migration_history.length > 0) {
        migrationHistoryHtml = `
            <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px;">
                <thead>
                    <tr style="background-color: #f0f0f0;">
                        <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">Gen</th>
                        <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">From</th>
                        <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">To</th>
                        <th style="border: 1px solid #ddd; padding: 4px; text-align: left;">Timestamp</th>
                    </tr>
                </thead>
                <tbody>`;
        
        data.migration_history.forEach(m => {
            migrationHistoryHtml += `
                <tr>
                    <td style="border: 1px solid #ddd; padding: 4px;">${m.generation}</td>
                    <td style="border: 1px solid #ddd; padding: 4px;">${m.from}</td>
                    <td style="border: 1px solid #ddd; padding: 4px;">${m.to}</td>
                    <td style="border: 1px solid #ddd; padding: 4px;">${formatTimestamp(m.timestamp)}</td>
                </tr>`;
        });
        
        migrationHistoryHtml += `</tbody></table>`;
    } else {
        migrationHistoryHtml = '<p>No migration history.</p>';
    }

    gridItemsHtml += `
        <div class="details-section">
            <h5>Migration History</h5>
            <div class="details-section-content">
                ${migrationHistoryHtml}
            </div>
        </div>
    `;

    let longContentHtml = '';
    if (data.metadata && data.metadata.thought) {
        longContentHtml += `
            <div class="details-section" style="margin-top: 15px;">
                <h5>Thought Process</h5>
                <div class="markdown">${marked.parse(data.metadata.thought)}</div>
            </div>
        `;
    }

    const nodeDetailsHtml = `
        <h4>Selected Node Details</h4>
        <div class="details-grid">
            ${gridItemsHtml}
        </div>
        ${longContentHtml}
    `;
    
    nodeDetailsContainer.innerHTML = nodeDetailsHtml;
    
    // Update code tab - lazy load if code not in summary data
    const codeWrapper = document.getElementById("agent-code-wrapper");
    const diffContentWrapper = document.getElementById("code-diff-content");
    const diffControls = document.querySelector('#code-diff .diff-controls');
    
    // Reset diff cache and mode for new node
    window.currentDiffData = {
        parentDiff: null,
        initialDiff: null,
        currentCode: null,
        initialCode: null
    };
    window.currentDiffMode = 'parent';
    document.getElementById('diff-vs-parent-btn').classList.add('active');
    document.getElementById('diff-vs-initial-btn').classList.remove('active');
    
    if (data.code) {
        // Code already loaded, display it
        displayCodeContent(data, codeWrapper);
    } else if (window.currentDbPath && data.id) {
        // Lazy load: fetch full program details
        document.querySelector('#agent-code .code-controls').style.display = 'none';
        codeWrapper.innerHTML = `<p style="color: #666;">Loading code...</p>`;
        diffContentWrapper.innerHTML = `<p style="color: #666;">Loading diff...</p>`;
        diffControls.style.display = 'none';
        
        fetch(`/get_program_details?db_path=${encodeURIComponent(window.currentDbPath)}&id=${encodeURIComponent(data.id)}`)
            .then(r => {
                if (!r.ok) throw new Error(`Failed to load program details`);
                return r.json();
            })
            .then(fullData => {
                // Update the cached data with full details
                Object.assign(data, fullData);
                
                // Also update in treeData for future access
                const treeNode = window.treeData?.find(d => d.id === data.id);
                if (treeNode) {
                    Object.assign(treeNode, fullData);
                }
                
                // Display the loaded code
                displayCodeContent(fullData, codeWrapper);
                
                // Store diff data in cache
                window.currentDiffData.parentDiff = fullData.code_diff || null;
                window.currentDiffData.currentCode = fullData.code || null;
                
                // Update diff tab (shows parent diff by default)
                if (fullData.code_diff || fullData.code) {
                    diffControls.style.display = 'flex';
                    displayCurrentDiff();
                } else {
                    diffContentWrapper.innerHTML = "<p>No code diff available for this node.</p>";
                    diffControls.style.display = 'none';
                }
            })
            .catch(err => {
                console.error("[DEBUG] Failed to load program details:", err);
                codeWrapper.innerHTML = `<p style="color: #dc3545;">Failed to load code: ${err.message}</p>`;
                diffContentWrapper.innerHTML = "<p>Failed to load diff.</p>";
                diffControls.style.display = 'none';
            });
    } else {
        document.querySelector('#agent-code .code-controls').style.display = 'none';
        codeWrapper.innerHTML = "<p>No code available for this node.</p>";
        diffContentWrapper.innerHTML = "<p>No code diff available for this node.</p>";
        diffControls.style.display = 'none';
    }
    
    // Populate Log Output tab
    const logOutputContainer = document.getElementById("log-output");
    const stdoutLog = data.metadata?.stdout_log;
    const stderrLog = data.metadata?.stderr_log;
    let logHtml = '';

    if (stdoutLog) {
        logHtml += `<h5>STDOUT</h5><pre><code class="nohighlight">${escapeHtml(stdoutLog)}</code></pre>`;
    }

    if (stderrLog) {
        logHtml += `<h5>STDERR</h5><pre><code class="nohighlight">${escapeHtml(stderrLog)}</code></pre>`;
    }

    if (!stdoutLog && !stderrLog) {
        logHtml = "<p>No log output available for this node.</p>";
    }
    
    // Add placeholder for plots
    logHtml += `<div id="plots-container" style="margin-top: 20px;"></div>`;
    logOutputContainer.innerHTML = logHtml;
    
    // Fetch and display plots
    if (window.currentDbPath && data.generation !== undefined && data.id) {
        fetchAndDisplayPlots(data.generation, data.id);
    }

    // Populate LLM Result tab
    const llmResultContainer = document.getElementById("llm-result");
    const llmResult = data.metadata?.llm_result;
    let llmResultHtml = renderLlmResultTable(llmResult); // Try to render as a table first

    if (!llmResultHtml) {
        // Fallback to pretty-printing the whole object
        if (llmResult && typeof llmResult === 'object') {
            llmResultHtml = `<pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #f6f8fa; padding: 10px; border-radius: 3px;">${escapeHtml(JSON.stringify(llmResult, null, 2))}</pre>`;
        } else if (llmResult) {
            llmResultHtml = `<pre><code class="nohighlight">${escapeHtml(String(llmResult))}</code></pre>`;
        } else {
            llmResultHtml = "<p>No LLM result available for this node.</p>";
        }
    }
    llmResultContainer.innerHTML = llmResultHtml;

    // Apply syntax highlighting to code blocks
    document.querySelectorAll('pre code:not(.nohighlight)').forEach((block) => {
        hljs.highlightElement(block);
    });
    
    // Update analysis tab if it's active
    if (document.getElementById('analysis') && document.getElementById('analysis').classList.contains('active')) {
        updateAnalysisTab(data.id);
    }
    if (document.getElementById('throughput') && document.getElementById('throughput').classList.contains('active')) {
        updateThroughputTab(data.id);
    }
}

function renderLlmResultTable(llmResult) {
    if (!llmResult || typeof llmResult !== 'object' || Array.isArray(llmResult) || Object.keys(llmResult).length === 0) {
        return null; // Not a non-empty object
    }

    const expandableKeys = ['content', 'msg', 'system_msg', 'new_msg_history', 'thought'];
    let html = '<table class="llm-result-table"><tbody>';

    for (const [key, value] of Object.entries(llmResult)) {
        html += `<tr><th>${escapeHtml(key)}</th><td>`;

        let contentHtml;
        if (typeof value === 'object' && value !== null) {
            // Pretty-print nested objects/arrays as JSON
            contentHtml = `<pre><code class="language-json">${escapeHtml(JSON.stringify(value, null, 2))}</code></pre>`;
        } else {
            const valueStr = String(value);
            // Use <pre> to preserve all formatting of string values
            contentHtml = `<pre><code class="nohighlight">${escapeHtml(valueStr)}</code></pre>`;
        }
        
        if (expandableKeys.includes(key)) {
            html += `
                <details class="llm-result-details">
                    <summary class="llm-result-summary">Expand to view</summary>
                    <div class="llm-result-value">
                        ${contentHtml}
                    </div>
                </details>
            `;
        } else {
            html += contentHtml;
        }

        html += `</td></tr>`;
    }

    html += '</tbody></table>';
    return html;
}

// Function to fetch and display plots for a program
async function fetchAndDisplayPlots(generation, programId) {
    const plotsContainer = document.getElementById('plots-container');
    if (!plotsContainer || !window.currentDbPath) return;
    
    try {
        const url = `/get_plots?db_path=${encodeURIComponent(window.currentDbPath)}&generation=${generation}&program_id=${programId}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            debug('[DEBUG] No plots available for this program');
            return;
        }
        
        const plots = await response.json();
        
        if (!plots || plots.length === 0) {
            return;
        }
        
        let plotsHtml = '<h5 style="margin-top: 20px; border-top: 1px solid #ddd; padding-top: 15px;">📊 Plots & Visualizations</h5>';
        plotsHtml += '<div id="plots-grid" style="display: flex; flex-direction: column; gap: 15px; margin-top: 10px;"></div>';
        
        plotsContainer.innerHTML = plotsHtml;
        const plotsGrid = document.getElementById('plots-grid');
        
        // Load images and arrange based on aspect ratio
        const imagePromises = plots.map(plot => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => resolve({ plot, img, width: img.naturalWidth, height: img.naturalHeight });
                img.onerror = () => resolve({ plot, img: null, width: 400, height: 300 });
                img.src = `/plot_file/${encodeURIComponent(plot.path)}`;
            });
        });
        
        Promise.all(imagePromises).then(results => {
            let currentRow = null;
            let currentRowFraction = 0; // Track how much of the row is filled (0-1)
            
            for (const { plot, width, height } of results) {
                const fileUrl = `/plot_file/${encodeURIComponent(plot.path)}`;
                const aspectRatio = width / height;
                const icon = (plot.type === 'animation' || plot.ext === '.gif') ? '🎬' : '📈';
                
                // Determine layout based on aspect ratio
                // widthFraction: how much of row width this image should take
                let widthFraction, minWidth, maxWidth;
                
                if (aspectRatio >= 2.0) {
                    // Very wide: full row
                    widthFraction = 1.0;
                    minWidth = '100%';
                    maxWidth = '100%';
                } else if (aspectRatio >= 1.5) {
                    // Wide: ~60-80% of row
                    widthFraction = 0.5;
                    minWidth = '400px';
                    maxWidth = '700px';
                } else if (aspectRatio >= 1.0) {
                    // Landscape/square: ~40-50% of row
                    widthFraction = 0.45;
                    minWidth = '300px';
                    maxWidth = '500px';
                } else if (aspectRatio >= 0.7) {
                    // Slightly tall: ~35% of row
                    widthFraction = 0.35;
                    minWidth = '250px';
                    maxWidth = '400px';
                } else {
                    // Very tall/portrait: ~25-30% of row
                    widthFraction = 0.28;
                    minWidth = '200px';
                    maxWidth = '300px';
                }
                
                const plotDiv = document.createElement('div');
                plotDiv.style.cssText = 'border: 1px solid #ddd; border-radius: 8px; padding: 10px; background: #fafafa;';
                plotDiv.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 8px; color: #333;">${icon} ${escapeHtml(plot.filename)}</div>
                    <img src="${fileUrl}" alt="${escapeHtml(plot.filename)}" style="max-width: 100%; height: auto; border-radius: 4px; cursor: pointer;" onclick="window.open('${fileUrl}', '_blank')">
                `;
                
                // Check if we need a new row
                const needsNewRow = !currentRow || 
                    widthFraction >= 1.0 || 
                    (currentRowFraction + widthFraction > 1.05);
                
                if (needsNewRow) {
                    currentRow = document.createElement('div');
                    currentRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 15px; align-items: flex-start;';
                    plotsGrid.appendChild(currentRow);
                    currentRowFraction = 0;
                }
                
                plotDiv.style.flex = `${widthFraction} 1 ${minWidth}`;
                plotDiv.style.maxWidth = maxWidth;
                currentRow.appendChild(plotDiv);
                currentRowFraction += widthFraction;
                
                // If this was a full-width item, reset for next
                if (widthFraction >= 1.0) {
                    currentRow = null;
                    currentRowFraction = 0;
                }
            }
        });
        
        debug(`[DEBUG] Loading ${plots.length} plot(s)`);
        
    } catch (error) {
        debug('[DEBUG] Error fetching plots:', error);
    }
}
