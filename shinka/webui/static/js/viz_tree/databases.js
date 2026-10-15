// Database discovery and the task/result selectors.
import { loadDatabase } from './loader.js';

// Data store for available databases and organized data
let availableDatabases = [];
export let tasksAndResults = {};

// Function to find all .db files in the results directory
export async function findDatabases(force = false) {
    const taskSelect = document.getElementById("task-select");
    const resultSelect = document.getElementById("result-select");
    const scanStatus = document.getElementById("scan-status");

    // Use cached list unless forcing a refresh
    if (availableDatabases.length > 0 && !force) {
        organizeDatabases(availableDatabases);
        return;
    }

    scanStatus.textContent = "Loading available databases...";

    try {
        const response = await fetch('/list_databases');
        if (!response.ok) {
            throw new Error(`Failed to load database list (HTTP ${response.status})`);
        }
        const dbs = await response.json();
        console.log("[DEBUG] Server returned databases:", dbs);

        availableDatabases = dbs;
        organizeDatabases(dbs);

        // Auto-load a DB if one is specified in the URL
        const urlParams = new URLSearchParams(window.location.search);
        const dbPathFromUrl = urlParams.get('db_path');
        if (dbPathFromUrl) {
            const matchingDb = availableDatabases.find(db => db.path === dbPathFromUrl);
            if (matchingDb) {
                // Use task from the matchingDb object (provided by server)
                const task = matchingDb.task;
                if (task) {
                    taskSelect.value = task;
                    populateResultSelect(task);
                    resultSelect.value = dbPathFromUrl;
                }
                loadDatabase(dbPathFromUrl);
            } else {
                // Database not in available list but try to load directly anyway
                console.log("[DEBUG] DB path from URL not found in available databases, loading directly:", dbPathFromUrl);
                loadDatabase(dbPathFromUrl);
            }
        } else if (dbs.length > 0 && !force) {
            // Auto-select the first task and result
            const firstTask = Object.keys(tasksAndResults)[0];
            if (firstTask && tasksAndResults[firstTask].length > 0) {
                taskSelect.value = firstTask;
                populateResultSelect(firstTask);
                const firstResult = tasksAndResults[firstTask][0].path;
                resultSelect.value = firstResult;
                loadDatabase(firstResult);
            }
        }

    } catch (error) {
        console.error("[DEBUG] Error fetching database list:", error);
        scanStatus.textContent = "Error loading database list.";
        taskSelect.innerHTML = '<option value="">Error loading databases</option>';
        resultSelect.innerHTML = '<option value="">Select a result...</option>';
    }
}

function organizeDatabases(dbs) {
    const scanStatus = document.getElementById("scan-status");
    
    // Clear existing data
    tasksAndResults = {};
    
    if (dbs.length === 0) {
        scanStatus.textContent = "No databases found.";
        return;
    }

    // Organize databases by task
    dbs.forEach(db => {
        const pathParts = db.path.split('/');
        // Use db.task if provided, otherwise fall back to path-based extraction
        const task = db.task || (pathParts.length >= 3 ? pathParts.slice(0, -2).join('/') : pathParts[0]);
        // Use db.name if available, otherwise fall back to path-based extraction
        const result = db.name || pathParts[pathParts.length - 2];
        
        if (!tasksAndResults[task]) {
            tasksAndResults[task] = [];
        }
        
        tasksAndResults[task].push({
            name: result,
            path: db.path,
            sortKey: db.sort_key || '0'
        });
    });

    // Sort results within each task by date (newest first)
    Object.keys(tasksAndResults).forEach(task => {
        tasksAndResults[task].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    });

    populateTaskSelect();
    scanStatus.textContent = `Found ${dbs.length} database(s) across ${Object.keys(tasksAndResults).length} task(s).`;
}

function populateTaskSelect() {
    const taskSelect = document.getElementById("task-select");
    
    // Clear existing options
    taskSelect.innerHTML = '<option value="">Select a task...</option>';
    
    const tasks = Object.keys(tasksAndResults).sort();
    tasks.forEach(task => {
        const option = document.createElement("option");
        option.value = task;
        option.textContent = task;
        taskSelect.appendChild(option);
    });
}

export function populateResultSelect(selectedTask) {
    const resultSelect = document.getElementById("result-select");
    
    // Clear existing options
    resultSelect.innerHTML = '<option value="">Select a result...</option>';
    
    if (!selectedTask || !tasksAndResults[selectedTask]) {
        return;
    }

    tasksAndResults[selectedTask].forEach(result => {
        const option = document.createElement("option");
        option.value = result.path;
        option.textContent = result.name;
        resultSelect.appendChild(option);
    });
}

// Configuration
export const config = {
    // This section is now managed by fetching from the server
};

// Helper function to format timestamps from YYYYMMDD_HHMMSS format to readable format
export function formatTimestamp(timestamp) {
    if (!timestamp) return 'unknown';
    
    const tsString = String(timestamp);
    
    // If it's already formatted or isn't in the expected format, return as is
    if (tsString === 'latest' || tsString === 'unknown') {
        return tsString;
    }

    // Check if it's a Unix timestamp (number, potentially with decimals)
    if (!isNaN(parseFloat(tsString)) && isFinite(tsString)) {
        const date = new Date(parseFloat(tsString) * 1000); // from seconds to ms
        const pad = (num) => String(num).padStart(2, '0');
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hour = pad(date.getHours());
        const minute = pad(date.getMinutes());
        const second = pad(date.getSeconds());
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
    
    // Check if the timestamp matches our expected format
    const tsRegex = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;
    const match = tsString.match(tsRegex);
    
    if (match) {
        const [_, year, month, day, hour, minute, second] = match;
        // Format as YYYY-MM-DD HH:MM
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }
    
    return tsString;
}
