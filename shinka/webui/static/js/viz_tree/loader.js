// Fetching a database and preparing tree data.
import { loadAvailableMetaFiles } from './scratchpad.js';
import { lastDataTimestamp, setLastDataTimestamp, startAutoRefresh, stopAutoRefresh } from './autoRefresh.js';
import { renderGraph } from './tree.js';
import { updateMetaInfoTab, updateScoreHeatbar } from './metaInfo.js';
import { populateProgramsTable } from './programTable.js';
import { getSelectedNodeId, selectNodeById } from './selection.js';
import { ensureEmbeddingsHeatmap } from './embeddings.js';
import { createIslandsVisualization } from './islands.js';
import { createBestPathVisualization } from './bestPath.js';
import { createMAPsVisualization } from './maps.js';
import { createModelPosteriorsVisualization } from './ensembling.js';
import { createClusterPlots } from './clusters.js';
import { paretoListenersAdded, setParetoListenersAdded, updateParetoView } from './pareto.js';
import { createMetricsVisualization } from './metrics.js';
import { updateAnalysisTab } from './analysisPlots.js';
import { updateThroughputTab } from './throughput.js';
import { renderMetaPromptTree, selectPromptNode } from './promptEvo.js';

// Silent version of loadDatabase that doesn't show loading states
export async function loadDatabaseSilent(dbPath) {
    try {
        // Fetch lightweight summaries and prompts in parallel
        const [programResponse, promptResponse] = await Promise.all([
            fetch(`/get_programs_summary?db_path=${encodeURIComponent(dbPath)}`),
            fetch(`/get_system_prompts?db_path=${encodeURIComponent(dbPath)}`).catch(() => null)
        ]);
        
        if (!programResponse.ok) {
            throw new Error(`Failed to load data (HTTP ${programResponse.status})`);
        }
        
        const data = await programResponse.json();
        let prompts = [];
        if (promptResponse && promptResponse.ok) {
            try {
                prompts = await promptResponse.json();
            } catch (e) {
                console.log("[DEBUG] Silent refresh: Failed to parse prompts JSON:", e);
            }
        }
        
        if (!data || data.length === 0) {
            console.log("[DEBUG] Auto-refresh: No new data received");
            return;
        }
        
        console.log("[DEBUG] Auto-refresh: Processing", data.length, "programs,", prompts.length, "prompts");
        window.rawDbData = data;
        if (prompts.length > 0) {
            window.metaPromptData = prompts;
        }
        
        // Update the scan status with new program count and timestamp
        const scanStatus = document.getElementById("scan-status");
        if (scanStatus) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
            const baseText = `Loaded ${data.length} programs [${timeStr}]`;
            scanStatus.textContent = baseText;
        }
        
        // Store the current selected node and active right tab to restore after refresh
        const selectedNodeId = getSelectedNodeId();
        const currentRightTab = document.querySelector('.tab.active');
        const currentRightTabId = currentRightTab ? currentRightTab.getAttribute('data-tab') : null;
        
        processData(data);
        
        // Try to restore the selected node if it still exists
        if (selectedNodeId && window.treeData) {
            const nodeStillExists = window.treeData.find(d => d.id === selectedNodeId);
            if (nodeStillExists) {
                // Use a timeout to ensure the DOM has been updated
                setTimeout(() => {
                    selectNodeById(selectedNodeId, false, false); // Don't force right tab switch during re-render
                    
                    // Restore the right tab after node selection
                    if (currentRightTabId && currentRightTabId !== 'agent-code') {
                        setTimeout(() => {
                            const tabElement = document.querySelector(`.tab[data-tab="${currentRightTabId}"]`);
                            if (tabElement) {
                                tabElement.click();
                            }
                        }, 50);
                    }
                }, 100);
            }
        } else {
            // No node was selected, but still restore right tab if it's not the default
            if (currentRightTabId && currentRightTabId !== 'agent-info') {
                setTimeout(() => {
                    const tabElement = document.querySelector(`.tab[data-tab="${currentRightTabId}"]`);
                    if (tabElement) {
                        tabElement.click();
                    }
                }, 150);
            }
        }
        
        // Also refresh the meta-prompt tree if it's visible or has been loaded
        if (window.metaPromptData !== null) {
            console.log("[DEBUG] Auto-refresh: Also refreshing meta-prompt tree");
            await refreshMetaPromptssilent();
        }
        
    } catch (error) {
        console.log("[DEBUG] Auto-refresh: Failed to load data silently:", error);
    } finally {
        window.isReloadingData = false;
    }
}

// Silent version of meta-prompt refresh
async function refreshMetaPromptssilent() {
    if (!window.currentDbPath) return;
    
    try {
        const response = await fetch(`/get_system_prompts?db_path=${encodeURIComponent(window.currentDbPath)}`);
        if (!response.ok) {
            console.log("[DEBUG] Auto-refresh: Failed to load prompts");
            return;
        }
        
        const prompts = await response.json();
        
        if (!prompts || prompts.length === 0) {
            return;
        }
        
        // Calculate new best prompt first
        const minPrograms = 1;  // Any prompt with at least 1 program can be best
        const eligiblePrompts = prompts.filter(p => p.program_count >= minPrograms);
        const bestPrompt = [...eligiblePrompts].sort((a, b) => b.fitness - a.fitness)[0];
        
        // Check if data has changed
        const oldCount = window.metaPromptData ? window.metaPromptData.length : 0;
        const oldBestId = window.metaPromptBestId || null;
        const newBestId = bestPrompt ? bestPrompt.id : null;
        
        // Check for changes: count, best prompt, or total fitness
        let hasChanged = false;
        if (prompts.length !== oldCount) {
            hasChanged = true;
            console.log("[DEBUG] Auto-refresh: Prompt count changed:", oldCount, "->", prompts.length);
        } else if (newBestId !== oldBestId) {
            hasChanged = true;
            console.log("[DEBUG] Auto-refresh: Best prompt changed:", oldBestId?.substring(0, 8), "->", newBestId?.substring(0, 8));
        } else {
            // Also check if any fitness values changed significantly
            const oldTotalFitness = window.metaPromptData ? 
                window.metaPromptData.reduce((sum, p) => sum + (p.fitness || 0), 0) : 0;
            const newTotalFitness = prompts.reduce((sum, p) => sum + (p.fitness || 0), 0);
            if (Math.abs(oldTotalFitness - newTotalFitness) > 0.0001) {
                hasChanged = true;
                console.log("[DEBUG] Auto-refresh: Total fitness changed:", oldTotalFitness.toFixed(4), "->", newTotalFitness.toFixed(4));
            }
        }
        
        if (!hasChanged) {
            return; // No significant change
        }
        
        console.log("[DEBUG] Auto-refresh: Meta-prompt data changed, updating tree");
        window.metaPromptData = prompts;
        window.metaPromptBestId = newBestId;  // Track best prompt ID
        
        // Store currently selected prompt
        const selectedPromptId = window.selectedPromptId;
        
        // Update status
        const statusEl = document.getElementById('meta-prompt-status');
        
        if (statusEl) {
            statusEl.textContent = `Loaded ${prompts.length} prompts` + 
                (bestPrompt ? ` | Best fitness: ${bestPrompt.fitness.toFixed(4)}` : '');
        }
        
        // Re-render tree
        renderMetaPromptTree(prompts, bestPrompt);
        
        // Restore selected prompt if it still exists
        if (selectedPromptId) {
            const promptStillExists = prompts.find(p => p.id === selectedPromptId);
            if (promptStillExists) {
                setTimeout(() => {
                    selectPromptNode(promptStillExists);
                    d3.selectAll(".prompt-node").classed("selected", false);
                    d3.selectAll(".prompt-node")
                        .filter(d => d.data.id === selectedPromptId)
                        .classed("selected", true);
                }, 100);
            }
        }
        
    } catch (error) {
        console.log("[DEBUG] Auto-refresh: Error refreshing meta-prompts:", error);
    }
}

// Function to load and process data from a database file
export function loadDatabase(dbPath) {
    console.log("[DEBUG] Attempting to load DB from:", dbPath);

    document.getElementById("node-summary").innerHTML = "";
    d3.selectAll('.node').classed('selected', false);
    
    document.getElementById("agent-code-wrapper").innerHTML = "<p>Select a node from the tree to view code.</p>";
    document.querySelector('#agent-code .code-controls').style.display = 'none';
    document.getElementById("node-details").innerHTML = "<p>Select a node to view its details.</p>";
    document.getElementById("code-diff-content").innerHTML = "<p>Select a node to view its code diff.</p>";
    document.querySelector('#code-diff .diff-controls').style.display = 'none';
    document.getElementById("code-diff").classList.remove('hide-unchanged');
    const toggleBtn = document.getElementById('toggle-unchanged-btn');
    if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.textContent = 'Show Changes Only';
    }
    // Reset diff mode
    window.currentDiffMode = 'parent';
    window.currentDiffData = { parentDiff: null, initialDiff: null, currentCode: null, initialCode: null };
    const diffParentBtn = document.getElementById('diff-vs-parent-btn');
    const diffInitialBtn = document.getElementById('diff-vs-initial-btn');
    if (diffParentBtn) diffParentBtn.classList.add('active');
    if (diffInitialBtn) diffInitialBtn.classList.remove('active');
    
    // Clear content of other left-panel tabs to force re-render on click
    document.getElementById("embeddings-heatmap").innerHTML = "";
    document.getElementById("islands-container").innerHTML = "";
    document.getElementById("best-path-container").innerHTML = "";
    // Clear meta-prompt view
    document.getElementById("meta-prompt-tree").innerHTML = "";
    document.getElementById("meta-prompt-status").textContent = "No meta-prompt database found";
    const metaPromptLegend = document.getElementById("meta-prompt-legend");
    if (metaPromptLegend) metaPromptLegend.style.display = "none";
    const metaPromptDetails = document.getElementById("meta-prompt-details");
    if (metaPromptDetails) {
        metaPromptDetails.innerHTML = '<p style="color: #888; font-size: 13px; text-align: center; margin-top: 30px;">Select a prompt node to view details</p>';
    }
    window.metaPromptData = null;
    window.selectedPromptId = null;
    // Don't clear the model-posteriors-container completely, just the chart content
    const modelPosteriorsChart = document.getElementById("model-posteriors-chart");
    if (modelPosteriorsChart) {
        modelPosteriorsChart.innerHTML = "";
    }

    // Reset Pareto plot controls
    setParetoListenersAdded(false);
    const ySelect = document.getElementById('pareto-y-axis');
    const xSelect = document.getElementById('pareto-x-axis');
    if (ySelect) ySelect.innerHTML = '';
    if (xSelect) xSelect.innerHTML = '';

    window.currentDbPath = dbPath;
    
    if (window.isResizing) {
        console.log("[DEBUG] Skipping DB loading during resize");
        return;
    }
    
    const scanStatus = document.getElementById("scan-status");
    scanStatus.textContent = "Loading data...";
    
    // Fetch lightweight program summaries and prompts in parallel
    // Using summary endpoint for faster initial load (excludes code/embeddings)
    Promise.all([
        fetch(`/get_programs_summary?db_path=${encodeURIComponent(dbPath)}`).then(r => {
            if (!r.ok) throw new Error(`Failed to load data (HTTP ${r.status})`);
            return r.json();
        }),
        fetch(`/get_system_prompts?db_path=${encodeURIComponent(dbPath)}`).then(r => {
            if (!r.ok) {
                console.log("[DEBUG] Prompts request failed (HTTP " + r.status + "), continuing without prompts");
                return [];
            }
            return r.json().catch(e => {
                console.log("[DEBUG] Failed to parse prompts JSON:", e);
                return [];
            });
        }).catch(e => {
            console.log("[DEBUG] Prompts fetch failed:", e);
            return [];
        }) // If prompts fail, continue with empty array
    ])
        .then(([data, prompts]) => {
            console.log("[DEBUG] Summary data received:", data.length, "programs,", prompts.length, "prompts");
            
            if (!data || data.length === 0) {
                throw new Error("Database contains no programs.");
            }
            
            window.rawDbData = data;
            window.metaPromptData = prompts.length > 0 ? prompts : null;
            
            // Update status with timestamp
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
            scanStatus.textContent = `Loaded ${data.length} programs [${timeStr}]`;
            scanStatus.style.color = '#666'; // Reset to default color on success
            
            // Clear any previous error messages from file-list
            const fileList = document.getElementById("file-list");
            if (fileList) fileList.innerHTML = '';
            
            // Set initial timestamp for auto-refresh comparison
            setLastDataTimestamp(Date.now());
            
            processData(data);
            
            // Start auto-refresh for this database
            startAutoRefresh();
        })
        .catch(error => {
            console.error(`[DEBUG] Failed to load database: ${error.message}`);
            
            // Check if this is a concurrent access issue (503 = Service Unavailable)
            const isConcurrentAccess = error.message.includes('503') || 
                                     error.message.includes('temporarily unavailable');
            
            if (isConcurrentAccess) {
                scanStatus.textContent = "Database busy - evolution may be running";
                scanStatus.style.color = '#ffc107'; // Warning yellow
                
                // Show concurrent access warning in the file list area
                const fileList = document.getElementById("file-list");
                fileList.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #ffc107; background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 5px; margin: 10px 0;">
                        <h3>⚠️ Database Temporarily Unavailable</h3>
                        <p>The database appears to be in use by a running evolution process.</p>
                        <p><strong>With WAL mode enabled:</strong> This should resolve shortly.</p>
                        <p>Try refreshing in a few seconds, or wait for the evolution to complete.</p>
                        <button onclick="loadDatabase('${dbPath}')" style="margin-top: 10px; padding: 8px 16px; background-color: #ffc107; border: none; border-radius: 3px; cursor: pointer;">
                            🔄 Retry Now
                        </button>
                    </div>
                `;
                
                // Don't stop auto-refresh for concurrent access - it might resolve
                console.log("[DEBUG] Database busy, keeping auto-refresh active");
            } else {
                scanStatus.textContent = "Error loading data.";
                scanStatus.style.color = '#dc3545'; // Error red
                
                // Show general error message
                const fileList = document.getElementById("file-list");
                fileList.innerHTML = `
                    <div style="padding: 20px; text-align: center; color: #dc3545; background-color: #f8d7da; border: 1px solid #dc3545; border-radius: 5px; margin: 10px 0;">
                        <h3>❌ Failed to Load Database</h3>
                        <p>Error: ${error.message}</p>
                        <p>Please check the database file and try again.</p>
                    </div>
                `;
                
                // Stop auto-refresh on general errors
                stopAutoRefresh();
            }
        })
        .finally(() => {
            window.isReloadingData = false; // Re-enable state saving
            console.log("[DEBUG] Data reloading finished.");
        });
}

// Process the data and generate the tree
export function processData(data) {
    if (!data || data.length === 0) {
        console.error("[DEBUG] No data to process!");
        document.getElementById("tree-legend").style.display = "none"; // Hide the legend when no data
        return;
    }
    
    console.log("[DEBUG] Processing data:", data.length, "rows");
    try {
        // Determine the active tabs *before* doing anything else
        const activeLeftTab = document.querySelector('.left-tab.active');
        const activeLeftTabId = activeLeftTab ? activeLeftTab.getAttribute('data-tab') : 'tree-view';
        const activeRightTab = document.querySelector('.tab.active');
        const activeRightTabId = activeRightTab ? activeRightTab.getAttribute('data-tab') : 'agent-info';

        // Sort and process data
        data.sort((a, b) => {
            if (a.generation !== b.generation) return a.generation - b.generation;
            return a.timestamp - b.timestamp;
        });
        const genCounters = {};
        data.forEach(row => {
            if (!genCounters[row.generation]) genCounters[row.generation] = 0;
            row.iter_id = genCounters[row.generation]++;
        });
        // Ensure no virtual root nodes ever get into the global data
        window.treeData = data.filter(d => !d.id || !d.id.includes('___virtual_root'));
        
        // Update views that are always visible or independent of the left tab
        populateProgramsTable(data);
        updateMetaInfoTab(data);
        updateParetoView();
        
        // Prefer the URL-selected right tab on initial hydration.
        const urlRightTabId = new URLSearchParams(window.location.search).get('right_tab');
        const rightTabIdToActivate = urlRightTabId || activeRightTabId || 'agent-info';
        if (rightTabIdToActivate && document.querySelector(`.tab[data-tab="${rightTabIdToActivate}"]`)) {
            window.activateRightTab?.(rightTabIdToActivate);
        } else {
            window.activateRightTab?.('agent-info');
        }
        
        updateScoreHeatbar();
        
        // Clear any cached view data to force refreshes when new data is loaded
        window.embeddingsCreated = false;
        
        // Clear all visualization containers to force complete refresh
        const clearContainer = (id) => {
            const container = document.getElementById(id);
            if (container) container.innerHTML = '';
        };
        
        clearContainer('embeddings-heatmap');
        clearContainer('islands-container');
        clearContainer('best-path-container');
        clearContainer('maps-container');

        clearContainer('cluster-plot-2d');
        clearContainer('cluster-plot-3d');
        clearContainer('metrics-plots');
        
        // Now, render the correct left-hand view based on the stored activeLeftTabId
        if (activeLeftTabId === 'tree-view') {
            document.getElementById("tree-legend").style.display = "block";
            renderGraph(data);
        } else {
            document.getElementById("tree-legend").style.display = "none";
            // Process the active view to improve performance
            setTimeout(() => {
                if (activeLeftTabId === 'embeddings-view') {
                    ensureEmbeddingsHeatmap();
                } else if (activeLeftTabId === 'islands-view') {
                    createIslandsVisualization(data);
                } else if (activeLeftTabId === 'best-path-view') {
                    createBestPathVisualization(data);
                } else if (activeLeftTabId === 'maps-view') {
                    createMAPsVisualization(data);
                } else if (activeLeftTabId === 'model-posteriors-view') {
                    createModelPosteriorsVisualization(data);
                } else if (activeLeftTabId === 'clusters-view') {
                    createClusterPlots(data);
                } else if (activeLeftTabId === 'metrics-view') {
                    createMetricsVisualization(data);
                }
                
                // Also always refresh metrics in background for quick tab switching
                setTimeout(() => {
                    createMetricsVisualization(data);
                }, 200);
            }, 100);
        }
        
        // Store data refresh flag to ensure views update when switching tabs
        window.dataRefreshed = true;
        
        // Load available meta files for the current database
        if (window.currentDbPath) {
            loadAvailableMetaFiles(window.currentDbPath);
        }
        
        // Update analysis tab if it's active
        if (document.getElementById('analysis') && document.getElementById('analysis').classList.contains('active')) {
            setTimeout(() => {
                updateAnalysisTab(window.selectedNodeId || null);
            }, 200);
        }
        setTimeout(() => {
            updateThroughputTab(window.selectedNodeId || null);
        }, 200);
    } catch (error) {
console.error("[DEBUG] Error in processData:", error);
    }
}
// Cache for D3 tree rendering to avoid unnecessary rebuilds
export let lastRenderedDataHash = null;

export function computeDataHash(data) {
    // Simple hash based on program count, max generation, and max timestamp
    if (!data || data.length === 0) return null;
    const count = data.length;
    const maxGen = Math.max(...data.map(d => d.generation || 0));
    const maxTs = Math.max(...data.map(d => d.timestamp || 0));
    return `${count}-${maxGen}-${maxTs}`;
}

export function normalizeTreeRoots(nodes) {
    const hierarchyData = JSON.parse(JSON.stringify(nodes));
    const nodeMap = new Map(nodes.map(node => [node.id, node]));
    const rootNodes = hierarchyData.filter(node => !node.parent_id || !nodeMap.has(node.parent_id));

    if (rootNodes.length <= 1) {
        return hierarchyData;
    }

    const virtualRootId = '___virtual_root___';
    hierarchyData.push({
        id: virtualRootId,
        parent_id: null,
        agent_name: 'VIRTUAL ROOT',
        isVirtual: true,
        generation: -1,
    });
    rootNodes.forEach(rootNode => {
        rootNode.parent_id = virtualRootId;
    });

    return hierarchyData;
}

export function setLastRenderedDataHash(value) {
    lastRenderedDataHash = value;
}
