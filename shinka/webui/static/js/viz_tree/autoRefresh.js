// Polling for new programs while a run is active.
import { debug } from '../log.js';
import { loadDatabaseSilent } from './loader.js';

// Auto-refresh variables
let autoRefreshInterval = null;
export let autoRefreshEnabled = false;
export let lastDataTimestamp = null;

// Auto-refresh functionality
export function initializeAutoRefresh() {
    debug("[DEBUG] Initializing auto-refresh functionality");
    
    // Start auto-refresh when a database is loaded
    if (window.currentDbPath) {
        startAutoRefresh();
    }
}

export function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    autoRefreshEnabled = true;
    debug("[DEBUG] Starting auto-refresh with 3 second intervals");
    
    // Update button state
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    if (autoRefreshToggle) {
        autoRefreshToggle.classList.add('active');
        autoRefreshToggle.title = "Disable auto-refresh";
    }
    
    autoRefreshInterval = setInterval(() => {
        if (autoRefreshEnabled && window.currentDbPath && !window.isReloadingData && !window.isResizing) {
            checkForNewData();
        }
    }, 3000); // Check every 3 seconds
}

export function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    autoRefreshEnabled = false;
    
    // Update button state
    const autoRefreshToggle = document.getElementById('auto-refresh-toggle');
    if (autoRefreshToggle) {
        autoRefreshToggle.classList.remove('active');
        autoRefreshToggle.title = "Enable auto-refresh (every 3 seconds)";
    }
    

    
    debug("[DEBUG] Auto-refresh stopped");
}
async function checkForNewData() {
    if (!window.currentDbPath) return;
    
    try {
        // Use lightweight count endpoint to check for changes
        const response = await fetch(`/get_program_count?db_path=${encodeURIComponent(window.currentDbPath)}`);
        if (!response.ok) {
            debug("[DEBUG] Auto-refresh: Failed to check for new data");
            return;
        }
        
        const result = await response.json();
        const currentDataCount = window.treeData ? window.treeData.length : 0;
        
        // Check if count or timestamp changed
        const countChanged = result.count !== currentDataCount;
        const timestampChanged = result.max_timestamp && lastDataTimestamp && 
                                result.max_timestamp > lastDataTimestamp;
        
        if (countChanged || timestampChanged) {
            debug("[DEBUG] Auto-refresh: New data detected", 
                       {countChanged, timestampChanged, 
                        serverCount: result.count, localCount: currentDataCount});
            
            const scanStatus = document.getElementById("scan-status");
            scanStatus.textContent = "Auto-refreshing...";
            
            window.isReloadingData = true;
            await loadDatabaseSilent(window.currentDbPath);
        }
        
        // Update stored timestamp
        if (result.max_timestamp) {
            lastDataTimestamp = result.max_timestamp;
        }
    } catch (error) {
        debug("[DEBUG] Auto-refresh: Error checking for new data:", error);
    }
}

export function setLastDataTimestamp(value) {
    lastDataTimestamp = value;
}
