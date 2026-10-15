// Entry point: wires tabs, buttons, and page-level listeners, then loads the selected database.
import { debug } from '../log.js';
import { initializeMetaAnalysis } from './scratchpad.js';
import { initializeResizer } from './layout.js';
import { findDatabases, populateResultSelect, tasksAndResults } from './databases.js';
import { autoRefreshEnabled, initializeAutoRefresh, startAutoRefresh, stopAutoRefresh } from './autoRefresh.js';
import { loadDatabase } from './loader.js';
import { renderGraph } from './tree.js';
import { createCharts, initializeScoreTypeListeners } from './metaInfo.js';
import { setDiffMode, toggleUnchangedLines } from './diffView.js';
import { populateProgramsTable, setupTableSorting } from './programTable.js';
import { getSelectedNodeId, selectNodeById } from './selection.js';
import { ensureEmbeddingsHeatmap, refreshEmbeddingsHeatmap } from './embeddings.js';
import { restoreFromURL, restorePreferences, savePreferences, saveState, updateURL } from './state.js';
import { createIslandsVisualization } from './islands.js';
import { createBestPathVisualization } from './bestPath.js';
import { createMAPsVisualization } from './maps.js';
import { createModelPosteriorsVisualization } from './ensembling.js';
import { createClusterPlots } from './clusters.js';
import { updateParetoView } from './pareto.js';
import { createMetricsVisualization } from './metrics.js';
import { updateAnalysisTab } from './analysisPlots.js';
import { toggleThroughputRuntimePlot, updateThroughputTab } from './throughput.js';
import { loadAndRenderMetaPrompts, selectProgramFromPromptView, showFullPrompt, sortPromptProgramsTable, togglePromptDescription } from './promptEvo.js';
// Load every module once, in the order of the original script, so their page-level
// listeners and window globals are registered before DOMContentLoaded.
import './scratchpad.js';
import './layout.js';
import './databases.js';
import './autoRefresh.js';
import './loader.js';
import './tree.js';
import './metaInfo.js';
import './nodeDetails.js';
import './diffView.js';
import './format.js';
import './programTable.js';
import './selection.js';
import './embeddings.js';
import './state.js';
import './islands.js';
import './bestPath.js';
import './maps.js';
import './ensembling.js';
import './clusters.js';
import './pareto.js';
import './metrics.js';
import './download.js';
import './analysisStats.js';
import './analysisPlots.js';
import './throughput.js';
import './promptEvo.js';

// Basic error handling
window.onerror = function(msg, url, lineNo, columnNo, error) {
    console.error('Error: ' + msg + '\nURL: ' + url + '\nLine: ' + lineNo + '\nColumn: ' + columnNo + '\nError object: ' + JSON.stringify(error));
    return false;
};

debug("Script starting...");

try {
    // ALWAYS use DOMContentLoaded to ensure the full initial DOM is ready
    debug("Adding DOMContentLoaded listener...");
    document.addEventListener('DOMContentLoaded', initialize);
} catch (error) {
    console.error("Error in initial script setup:", error);
}

function initialize() {
    debug("[DEBUG] Page loaded, starting initialization");
    try {
        // Add custom styles
                window.pendingNodeSelectionId = null;
        
        // Add arrow marker definition for connection lines
        d3.select("svg").append("defs").append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 4)
            .attr("refY", 0)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("class", "arrow")
            .attr("d", "M0,-5L10,0L0,5");
        
        // Restore user preferences from localStorage
        restorePreferences();
        
        // Initialize database list
        findDatabases();
        
        // Add task and result selection handlers
        const taskSelect = document.getElementById('task-select');
        const resultSelect = document.getElementById('result-select');
        
        taskSelect.addEventListener('change', function() {
            // Stop current auto-refresh before changing tasks
            stopAutoRefresh();
            
            populateResultSelect(this.value);
            
            // Auto-select the first result if available
            if (this.value && tasksAndResults[this.value] && tasksAndResults[this.value].length > 0) {
                const firstResult = tasksAndResults[this.value][0].path;
                resultSelect.value = firstResult;
                loadDatabase(firstResult);
                updateURL();
            } else {
                // Clear result selection if no results available
                resultSelect.value = '';
            }
        });
        
        resultSelect.addEventListener('change', function() {
            if (this.value) {
                // Stop current auto-refresh before loading new database
                stopAutoRefresh();
                loadDatabase(this.value);
                updateURL();
            }
        });
        
        // Add refresh button handler
        const refreshButton = document.getElementById('refresh-files');
        refreshButton.addEventListener('click', function() {
            debug("[DEBUG] Refresh button clicked");
            findDatabases(true); // Force refresh of DB list
        });
        
        // Initialize the reload data button handler
        const reloadButton = document.getElementById('reload-data');
        reloadButton.addEventListener('click', function() {
            debug("[DEBUG] Reload data button clicked");
            if (window.currentDbPath) {
                window.isReloadingData = true; // Prevent state saving during reload
                debug("[DEBUG] Reloading data from:", window.currentDbPath);
                // Show loading state
                reloadButton.classList.add('loading');
                const scanStatus = document.getElementById("scan-status");
                scanStatus.textContent = "Reloading data...";
                
                // Reload the current data file
                loadDatabase(window.currentDbPath);
                
                // Remove loading state after a short delay
                setTimeout(() => {
                    reloadButton.classList.remove('loading');
                }, 1000);
            } else {
                debug("[DEBUG] No file currently loaded to reload");
                alert("Please select a database file first");
            }
        });

        // Initialize auto-refresh functionality
        initializeAutoRefresh();

        // Add auto-refresh toggle button handler
        const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
        autoRefreshToggle.addEventListener('click', function() {
            if (autoRefreshEnabled) {
                stopAutoRefresh();
                autoRefreshToggle.classList.remove('active');
                autoRefreshToggle.title = "Enable auto-refresh (every 3 seconds)";
                debug("[DEBUG] Auto-refresh disabled by user");
            } else {
                if (window.currentDbPath) {
                    startAutoRefresh();
                    autoRefreshToggle.classList.add('active');
                    autoRefreshToggle.title = "Disable auto-refresh";
                    debug("[DEBUG] Auto-refresh enabled by user");
                } else {
                    alert("Please select a database file first");
                }
            }
        });
        
        // Initialize copy and download button handlers
        const copyBtn = document.getElementById('copy-code-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const codeElement = document.querySelector('#agent-code-wrapper pre code');
                if (codeElement) {
                    navigator.clipboard.writeText(codeElement.innerText).then(() => {
                        copyBtn.innerHTML = '✅ Copied!';
                        setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 2000);
                    }).catch(err => {
                        console.error('Failed to copy text: ', err);
                        alert('Failed to copy code.');
                    });
                }
            });
        }

        const downloadBtn = document.getElementById('download-code-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                const codeElement = document.querySelector('#agent-code-wrapper pre code');
                const selectedNodeId = getSelectedNodeId();
                
                if (codeElement && window.treeData && selectedNodeId) {
                    const nodeData = window.treeData.find(d => d.id === selectedNodeId);
                    if (nodeData) {
                        try {
                            const code = codeElement.innerText;
                            const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            const agentName = (nodeData.metadata.patch_name || 'agent').replace(/\s+/g, '_');
                            const gen = nodeData.generation;
                            const language = nodeData.language || 'py';
                            const extension = {
                                'python': 'py',
                                'cpp': 'cpp',
                                'javascript': 'js',
                                'cuda': 'cu',
                                'fortran': 'f90'
                            }[language] || language;

                            a.download = `${agentName}_gen${gen}.${extension}`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                        } catch (e) {
                            console.error('Download failed:', e);
                            alert('Failed to download code.');
                        }
                    }
                } else {
                    alert('Could not get code or node data to download.');
                }
            });
        }

        // Initialize the score type radio buttons
        initializeScoreTypeListeners();

        function activateRightTab(tabId) {
            const tabElement = document.querySelector(`.tab[data-tab="${tabId}"]`);
            const sectionElement = document.getElementById(tabId);
            if (!tabElement || !sectionElement) {
                return;
            }

            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tabElement.classList.add('active');

            document.querySelectorAll('.content-section').forEach(section => {
                section.classList.remove('active');
            });
            sectionElement.classList.add('active');

            saveState();

            if (tabId === 'agent-info' && !window.isResizing) {
                debug("[DEBUG] Switching to Meta Info tab, redrawing charts");
                setTimeout(() => {
                    createCharts(null);
                }, 100);
            }
            if (tabId === 'pareto-front') {
                updateParetoView();
            }
            if (tabId === 'analysis') {
                setTimeout(() => {
                    updateAnalysisTab(window.selectedNodeId || null);
                }, 100);
            }
            if (tabId === 'throughput') {
                setTimeout(() => {
                    updateThroughputTab(window.selectedNodeId || null);
                }, 100);
            }
        }

        window.activateRightTab = activateRightTab;
        
        // Add tab handling with state persistence
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                activateRightTab(this.getAttribute('data-tab'));
            });
        });
        
        // Initialize panel resizing functionality
        initializeResizer();
        setupTableSorting();
        
        // Add left panel tab handling with state persistence
        document.querySelectorAll('.left-tab').forEach(tab => {
            tab.addEventListener('click', function() {
                document.querySelectorAll('.left-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.left-content-section').forEach(s => {
                    s.classList.remove('active');
                    // Reset display for meta-prompt-view
                    if (s.id === 'meta-prompt-view') {
                        s.style.display = 'none';
                    }
                });
                
                this.classList.add('active');
                const tabId = this.getAttribute('data-tab');
                const tabElement = document.getElementById(tabId);
                tabElement.classList.add('active');
                
                // Set display: flex for meta-prompt-view
                if (tabId === 'meta-prompt-view') {
                    tabElement.style.display = 'flex';
                }
                
                // Save state and update URL
                saveState();
                
                const legend = document.getElementById('tree-legend');
                const treeControls = document.getElementById('tree-controls');
                if (tabId === 'tree-view') {
                    if (window.treeData) {
                        legend.style.display = 'block';
                        treeControls.style.display = 'block';
                        renderGraph(window.treeData);
                    }
                } else {
                    legend.style.display = 'none';
                    treeControls.style.display = 'none';
                }
                
                // Initialize embeddings view when tab is clicked
                if (tabId === 'embeddings-view') {
                    // Use the helper function to ensure heatmap is created
                    setTimeout(() => {
                        ensureEmbeddingsHeatmap();
                    }, 100);
                } else if (tabId === 'islands-view') {
                    setTimeout(() => {
                        if (window.treeData) {
                            createIslandsVisualization(window.treeData);
                        }
                    }, 100);
                } else if (tabId === 'best-path-view') {
                    setTimeout(() => {
                        if (window.treeData) {
                            createBestPathVisualization(window.treeData);
                        }
                    }, 100);
                } else if (tabId === 'maps-view') {
                    setTimeout(() => {
                        if (window.treeData) {
                            createMAPsVisualization(window.treeData);
                        }
                    }, 100);
                } else if (tabId === 'model-posteriors-view') {
                    setTimeout(() => {
                        if (window.treeData) {
                            createModelPosteriorsVisualization(window.treeData);
                        }
                    }, 100);
                } else if (tabId === 'clusters-view') {
                    setTimeout(() => {
                        if (window.treeData) {
                            createClusterPlots(window.treeData);
                        }
                    }, 100);
                } else if (tabId === 'metrics-view') {
                    setTimeout(() => {
                        if (window.treeData) {
                            // Force clear the metrics container before recreating
                            const metricsContainer = document.getElementById('metrics-plots');
                            if (metricsContainer) {
                                metricsContainer.innerHTML = '';
                            }
                            createMetricsVisualization(window.treeData);
                        }
                    }, 100);
                } else if (tabId === 'meta-prompt-view') {
                    setTimeout(() => {
                        loadAndRenderMetaPrompts();
                    }, 100);
                }
            });
        });

        // Add embedding controls event handlers with state persistence
        const initializeEmbeddingControls = () => {
            const sortMethodSelect = document.getElementById('embedding-sort-method');
            const colorScale = document.getElementById('color-scale');
            const cellSize = document.getElementById('cell-size');
            const cellSizeValue = document.getElementById('cell-size-value');
            const heatMin = document.getElementById('heat-min');
            const heatMax = document.getElementById('heat-max');
            
            if (sortMethodSelect) {
                sortMethodSelect.addEventListener('change', () => {
                    savePreferences();
                    if (window.treeData) refreshEmbeddingsHeatmap();
                });
            }
            
            if (colorScale) {
                colorScale.addEventListener('change', () => {
                    savePreferences();
                    if (window.treeData) refreshEmbeddingsHeatmap();
                });
            }
            
            if (cellSize && cellSizeValue) {
                cellSize.addEventListener('input', () => {
                    cellSizeValue.textContent = cellSize.value + 'px';
                    savePreferences();
                    if (window.treeData) refreshEmbeddingsHeatmap();
                });
            }
            
            if (heatMin) {
                heatMin.addEventListener('input', () => {
                    savePreferences();
                    if (window.treeData) refreshEmbeddingsHeatmap();
                });
            }
            
            if (heatMax) {
                heatMax.addEventListener('input', () => {
                    savePreferences();
                    if (window.treeData) refreshEmbeddingsHeatmap();
                });
            }
        };
        
        // Initialize embedding controls after DOM is ready
        initializeEmbeddingControls();
        
        // Initialize table controls
        const showIncorrectCheckbox = document.getElementById('show-incorrect-programs');
        if (showIncorrectCheckbox) {
            showIncorrectCheckbox.addEventListener('change', function() {
                if (window.treeData) {
                    populateProgramsTable(window.treeData);
                }
            });
        }
        
        // Initialize transpose tree checkbox
        const transposeTreeCheckbox = document.getElementById('transpose-tree-checkbox');
        if (transposeTreeCheckbox) {
            transposeTreeCheckbox.addEventListener('change', function() {
                if (window.treeData) {
                    renderGraph(window.treeData, true);  // Force render on layout change
                }
            });
        }
        
        // Initialize animate tree checkbox
        const animateTreeCheckbox = document.getElementById('animate-tree-checkbox');
        if (animateTreeCheckbox) {
            animateTreeCheckbox.addEventListener('change', function() {
                if (this.checked && window.treeData) {
                    // Stop any existing animation timers
                    if (window.treeAnimationTimers) {
                        window.treeAnimationTimers.forEach(t => clearTimeout(t));
                        window.treeAnimationTimers = [];
                    }
                    // Trigger animation by re-rendering
                    renderGraph(window.treeData, true);  // Force render for animation
                } else {
                    // Stop animation and restore full visibility
                    if (window.treeAnimationTimers) {
                        window.treeAnimationTimers.forEach(t => clearTimeout(t));
                        window.treeAnimationTimers = [];
                    }
                    // Make all nodes and links visible
                    d3.selectAll('#tree .node').style("opacity", 1);
                    d3.selectAll('#tree .link').style("opacity", d => {
                        if (window.allBestPaths && window.allBestPaths.length > 0) {
                            for (let path of window.allBestPaths) {
                                if (path.pathIds.has(d.source.data.id) && path.pathIds.has(d.target.data.id)) {
                                    return 1;
                                }
                            }
                        }
                        return 0.8;
                    });
                }
            });
        }
        
        // Initialize meta analysis controls
        initializeMetaAnalysis();

        // Restore state from URL after everything is initialized
        restoreFromURL();
        
        // Add cleanup on page unload
        window.addEventListener('beforeunload', function() {
            stopAutoRefresh();
        });
        
        debug("[DEBUG] Initialization complete");
    } catch (error) {
        console.error("[DEBUG] Fatal error during initialization:", error);
    }
}

// Functions referenced by inline event handlers in the HTML and in generated markup.
Object.assign(window, { loadDatabase, selectNodeById, selectProgramFromPromptView, setDiffMode, showFullPrompt, sortPromptProgramsTable, togglePromptDescription, toggleThroughputRuntimePlot, toggleUnchangedLines });
