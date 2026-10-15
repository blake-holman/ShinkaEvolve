// URL and localStorage persistence of the view state.
import { populateResultSelect } from './databases.js';
import { getSelectedNodeId, selectNodeById } from './selection.js';

// State persistence functions
export function saveState() {
    if (window.isReloadingData) {
        console.log("[DEBUG] Skipping saveState during data reload.");
        return;
    }
    try {
        const state = {
            leftTab: document.querySelector('.left-tab.active')?.getAttribute('data-tab'),
            rightTab: document.querySelector('.tab.active')?.getAttribute('data-tab'),
            selectedNodeId: getSelectedNodeId(),
            dbPath: window.currentDbPath
        };
        
        // Update URL without page reload
        const url = new URL(window.location);
        if (state.dbPath) url.searchParams.set('db_path', state.dbPath);
        if (state.leftTab) url.searchParams.set('left_tab', state.leftTab);
        if (state.rightTab) url.searchParams.set('right_tab', state.rightTab);
        if (state.selectedNodeId) url.searchParams.set('selected_node', state.selectedNodeId);
        
        window.history.replaceState(null, '', url);
        console.log("[DEBUG] State saved to URL");
    } catch (error) {
        console.error("[DEBUG] Error saving state:", error);
    }
}

export function savePreferences() {
    try {
        const preferences = {
            embeddingSortMethod: document.getElementById('embedding-sort-method')?.value,
            colorScale: document.getElementById('color-scale')?.value,
            cellSize: document.getElementById('cell-size')?.value,
            heatMin: document.getElementById('heat-min')?.value,
            heatMax: document.getElementById('heat-max')?.value,
            panelWidth: document.getElementById('tree-panel')?.style.width
        };
        
        localStorage.setItem('shinka_preferences', JSON.stringify(preferences));
        console.log("[DEBUG] Preferences saved to localStorage");
    } catch (error) {
        console.error("[DEBUG] Error saving preferences:", error);
    }
}

export function restorePreferences() {
    try {
        const saved = localStorage.getItem('shinka_preferences');
        if (!saved) return;
        
        const preferences = JSON.parse(saved);
        
        // Restore embedding controls
        if (preferences.embeddingSortMethod) {
            const select = document.getElementById('embedding-sort-method');
            if (select) select.value = preferences.embeddingSortMethod;
        }
        
        if (preferences.colorScale) {
            const select = document.getElementById('color-scale');
            if (select) select.value = preferences.colorScale;
        }
        
        if (preferences.cellSize) {
            const slider = document.getElementById('cell-size');
            const display = document.getElementById('cell-size-value');
            if (slider) {
                slider.value = preferences.cellSize;
                if (display) display.textContent = preferences.cellSize + 'px';
            }
        }
        
        if (preferences.heatMin) {
            const input = document.getElementById('heat-min');
            if (input) input.value = preferences.heatMin;
        }
        
        if (preferences.heatMax) {
            const input = document.getElementById('heat-max');
            if (input) input.value = preferences.heatMax;
        }
        
        // Restore panel width
        if (preferences.panelWidth) {
            const panel = document.getElementById('tree-panel');
            if (panel) panel.style.width = preferences.panelWidth;
        }
        
        console.log("[DEBUG] Preferences restored from localStorage");
    } catch (error) {
        console.error("[DEBUG] Error restoring preferences:", error);
    }
}

export function restoreFromURL() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // Restore database selection
        const dbPath = urlParams.get('db_path');
        if (dbPath) {
            // NOTE: Database loading is handled by findDatabases() which also
            // checks URL params. We only set up the select elements here to
            // ensure the UI reflects the loaded database.
            // DO NOT call loadDatabase() here - it would cause duplicate loading.
            const pathParts = dbPath.split('/');
            if (pathParts.length >= 3) {
                const task = pathParts[pathParts.length - 3];
                const taskSelect = document.getElementById('task-select');
                const resultSelect = document.getElementById('result-select');
                
                if (taskSelect && resultSelect) {
                    taskSelect.value = task;
                    populateResultSelect(task);
                    resultSelect.value = dbPath;
                    // loadDatabase() removed - already called by findDatabases()
                }
            }
        }
        
        // Restore left tab
        const leftTab = urlParams.get('left_tab');
        if (leftTab) {
            const tabElement = document.querySelector(`.left-tab[data-tab="${leftTab}"]`);
            if (tabElement) {
                setTimeout(() => tabElement.click(), 100);
            }
        }
        
        // Restore selected node (after data loads) and then restore right tab
        const selectedNodeId = urlParams.get('selected_node');
        const rightTab = urlParams.get('right_tab');
        
        if (selectedNodeId) {
            // Wait for data to load before selecting node
            const checkDataAndSelect = () => {
                if (window.treeData) {
                    setTimeout(() => {
                        selectNodeById(selectedNodeId, true, false); // Don't force right tab switch
                        // Restore right tab AFTER node selection
                        if (rightTab) {
                            setTimeout(() => window.activateRightTab?.(rightTab), 100);
                        }
                    }, 500);
                } else {
                    setTimeout(checkDataAndSelect, 100);
                }
            };
            checkDataAndSelect();
        } else {
            // No node selected, just restore right tab
            if (rightTab) {
                setTimeout(() => window.activateRightTab?.(rightTab), 100);
            }
        }
        
        console.log("[DEBUG] State restored from URL");
    } catch (error) {
        console.error("[DEBUG] Error restoring from URL:", error);
    }
}

export function updateURL() {
    saveState();
}
