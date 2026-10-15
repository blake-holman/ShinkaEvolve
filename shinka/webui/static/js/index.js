// Landing page: lists every run under the search root with live stats and a compare picker.

let allDatabases = [];
let tasksAndResults = {};
const statsCache = {};
const pendingStats = new Set();
let currentSortKey = 'task';
let currentSortDirection = 'asc';

async function loadDatabases() {
    try {
        const response = await fetch('/list_databases');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const dbs = await response.json();
        allDatabases = dbs;

        organizeDatabases(dbs);
        renderTable();

        // Load stats for visible rows after table renders
        setTimeout(() => loadVisibleStats(), 50);

    } catch (error) {
        console.error("Error loading databases:", error);
        document.getElementById('loading-state').style.display = 'none';
        document.getElementById('empty-state').style.display = 'block';
        document.querySelector('.empty-title').textContent = 'Error loading databases';
        document.querySelector('.empty-text').textContent = error.message;
    }
}

function organizeDatabases(dbs) {
    tasksAndResults = {};

    dbs.forEach(db => {
        const task = db.task || 'Unknown';
        const result = db.name || db.path;

        if (!tasksAndResults[task]) {
            tasksAndResults[task] = [];
        }

        tasksAndResults[task].push({
            name: result,
            path: db.path,
            actualPath: db.actual_path || db.path
        });
    });
}

function getResultDisplayParts(result) {
    const nameParts = result.name.split('/');
    return {
        taskName: nameParts.length >= 2 ? nameParts[nameParts.length - 2] : result.name,
        setting: nameParts.length >= 2 ? nameParts[nameParts.length - 1] : '-'
    };
}

function compareResults(a, b) {
    const aParts = getResultDisplayParts(a);
    const bParts = getResultDisplayParts(b);

    let comparison;
    if (currentSortKey === 'setting') {
        comparison = aParts.setting.localeCompare(bParts.setting) || aParts.taskName.localeCompare(bParts.taskName);
    } else {
        comparison = aParts.taskName.localeCompare(bParts.taskName) || aParts.setting.localeCompare(bParts.setting);
    }

    return currentSortDirection === 'desc' ? -comparison : comparison;
}

function updateSortIndicators() {
    const taskIndicator = document.getElementById('sort-indicator-task');
    const settingIndicator = document.getElementById('sort-indicator-setting');

    if (taskIndicator) {
        taskIndicator.textContent = currentSortKey === 'task' ? (currentSortDirection === 'asc' ? '▲' : '▼') : '';
    }
    if (settingIndicator) {
        settingIndicator.textContent = currentSortKey === 'setting' ? (currentSortDirection === 'asc' ? '▲' : '▼') : '';
    }
}

function toggleSort(sortKey) {
    if (currentSortKey === sortKey) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortKey = sortKey;
        currentSortDirection = 'asc';
    }

    renderTable(document.getElementById('search-input').value);
    setTimeout(() => loadVisibleStats(), 50);
}

function renderTable(filter = '') {
    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('empty-state');
    const tableWrapper = document.getElementById('table-wrapper');
    const tbody = document.getElementById('results-body');

    loadingState.style.display = 'none';

    const tasks = Object.keys(tasksAndResults).sort();

    if (tasks.length === 0) {
        emptyState.style.display = 'block';
        tableWrapper.style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    tableWrapper.style.display = 'block';
    updateSortIndicators();

    tbody.innerHTML = '';

    const filterLower = filter.toLowerCase();
    let visibleCount = 0;

    tasks.forEach(task => {
        const results = tasksAndResults[task];

        // Filter results
        const filteredResults = results.filter(r =>
            !filter ||
            task.toLowerCase().includes(filterLower) ||
            r.name.toLowerCase().includes(filterLower)
        );

        if (filteredResults.length === 0) return;

        filteredResults.sort(compareResults);

        // Add task group header
        const taskId = 'task-' + task.replace(/[^a-zA-Z0-9]/g, '-');
        const headerRow = document.createElement('tr');
        headerRow.className = 'task-group-header';
        headerRow.dataset.taskId = taskId;
        headerRow.innerHTML = `
            <td colspan="13">
                <span class="task-toggle">▼</span>
                📁 ${escapeHtml(task)}
                <span class="task-badge">${filteredResults.length}</span>
            </td>
        `;
        
        // Add click handler for collapse/expand
        headerRow.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTaskGroup(headerRow, taskId);
        });
        
        tbody.appendChild(headerRow);

        // Check if this task should be collapsed (from localStorage)
        const isCollapsed = localStorage.getItem('collapsed-' + taskId) === 'true';
        if (isCollapsed) {
            headerRow.classList.add('collapsed');
        }

        // Add result rows
        let taskVisibleCount = 0;
        filteredResults.forEach(result => {
            const cached = statsCache[result.path];
            
            // Skip only empty databases; initial generation runs have one program.
            if (cached && cached.program_count <= 0) {
                return;
            }

            const row = document.createElement('tr');
            row.dataset.dbPath = result.path;
            row.dataset.taskId = taskId;
            row.classList.add('task-child');
            
            // Hide if parent is collapsed
            if (isCollapsed) {
                row.classList.add('hidden');
            }

            const programsCell = cached ? formatNumber(cached.program_count) : '<span class="stat-loading">...</span>';
            const correctCell = cached ? formatNumber(cached.correct_count) : '<span class="stat-loading">...</span>';
            const gensCell = cached ? formatGenerations(cached) : '<span class="stat-loading">...</span>';
            const bestGenCell = cached ? formatBestGeneration(cached.best_generation) : '<span class="stat-loading">...</span>';
            const scoreCell = cached ? formatScore(cached.best_score) : '<span class="stat-loading">...</span>';
            const peCell = cached ? formatPromptEvo(cached) : '<span class="stat-loading">...</span>';
            const costCell = cached ? formatCost(cached.total_cost + (cached.prompt_evo_cost || 0)) : '<span class="stat-loading">...</span>';
            const lastUpdateCell = cached ? formatTimeAgo(cached.last_update) : '<span class="stat-loading">...</span>';
            const runtimeCell = cached ? formatDuration(cached.total_runtime_seconds) : '<span class="stat-loading">...</span>';

            // Split result name: remove task prefix, then split into taskName and setting
            // e.g., "results_coral/batched_2d_motion/cuda" -> taskName="batched_2d_motion", setting="cuda"
            const { taskName, setting } = getResultDisplayParts(result);

            const resultLabel = `${taskName}/${setting}`;
            row.innerHTML = `
                <td class="checkbox-cell">
                    <input type="checkbox" class="result-checkbox" data-path="${escapeHtml(result.path)}" data-label="${escapeHtml(resultLabel)}" onclick="event.stopPropagation(); updateCompareButton();">
                </td>
                <td>
                    <div class="task-name">${escapeHtml(taskName)}</div>
                </td>
                <td>
                    <div class="setting-name">${escapeHtml(setting)}</div>
                </td>
                <td class="numeric" data-stat="program_count">${programsCell}</td>
                <td class="numeric hide-tablet" data-stat="correct_count">${correctCell}</td>
                <td class="numeric" data-stat="generation_count">${gensCell}</td>
                <td class="numeric hide-tablet" data-stat="best_generation">${bestGenCell}</td>
                <td class="numeric" data-stat="best_score">${scoreCell}</td>
                <td class="numeric hide-tablet" data-stat="prompt_evo">${peCell}</td>
                <td class="numeric hide-mobile" data-stat="total_cost">${costCell}</td>
                <td class="hide-mobile" data-stat="last_update">${lastUpdateCell}</td>
                <td class="numeric" data-stat="total_runtime_seconds">${runtimeCell}</td>
                <td class="arrow-cell">→</td>
            `;

            row.addEventListener('click', () => {
                window.location.href = `/viz_tree.html?db_path=${encodeURIComponent(result.path)}`;
            });

            tbody.appendChild(row);
            visibleCount++;
            taskVisibleCount++;
        });

        // Remove the task header if no visible results
        if (taskVisibleCount === 0) {
            tbody.removeChild(headerRow);
        } else {
            // Update the badge with actual visible count
            const badge = headerRow.querySelector('.task-badge');
            if (badge) {
                badge.textContent = taskVisibleCount;
            }
        }
    });

    // Show empty state if no results match filter
    if (visibleCount === 0 && filter) {
        emptyState.style.display = 'block';
        tableWrapper.style.display = 'none';
        document.querySelector('.empty-title').textContent = 'No matching results';
        document.querySelector('.empty-text').textContent = `No results match "${filter}"`;
    }
}

async function loadVisibleStats() {
    const rows = document.querySelectorAll('tr[data-db-path]');
    const batchSize = 5; // Load stats in batches

    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = Array.from(rows).slice(i, i + batchSize);
        await Promise.all(batch.map(row => loadStatsForRow(row)));
    }
}

async function loadStatsForRow(row) {
    const dbPath = row.dataset.dbPath;

    // Skip if already cached or pending
    if (statsCache[dbPath] || pendingStats.has(dbPath)) {
        return;
    }

    pendingStats.add(dbPath);

    try {
        const response = await fetch(`/get_database_stats?db_path=${encodeURIComponent(dbPath)}`);
        if (response.ok) {
            const stats = await response.json();
            statsCache[dbPath] = stats;
            updateRowStats(row, stats);
        }
    } catch (error) {
        console.error(`Failed to load stats for ${dbPath}:`, error);
    } finally {
        pendingStats.delete(dbPath);
    }
}

function updateRowStats(row, stats) {
    // Hide empty databases, but keep initial generation runs visible.
    if (stats.program_count <= 0) {
        row.style.display = 'none';
        row.dataset.hidden = 'true';
        updateTaskGroupHeaders();
        return;
    }

    const totalCost = (stats.total_cost || 0) + (stats.prompt_evo_cost || 0);
    const cells = {
        'program_count': formatNumber(stats.program_count),
        'correct_count': formatNumber(stats.correct_count),
        'generation_count': formatGenerations(stats),
        'best_generation': formatBestGeneration(stats.best_generation),
        'best_score': formatScore(stats.best_score),
        'prompt_evo': formatPromptEvo(stats),
        'total_cost': formatCost(totalCost),
        'last_update': formatTimeAgo(stats.last_update),
        'total_runtime_seconds': formatDuration(stats.total_runtime_seconds)
    };

    for (const [stat, value] of Object.entries(cells)) {
        const cell = row.querySelector(`[data-stat="${stat}"]`);
        if (cell) {
            cell.innerHTML = value;
        }
    }
}

function toggleTaskGroup(headerRow, taskId) {
    const isCollapsed = headerRow.classList.toggle('collapsed');
    
    // Save state to localStorage
    localStorage.setItem('collapsed-' + taskId, isCollapsed);
    
    // Toggle visibility of child rows
    const childRows = document.querySelectorAll(`tr.task-child[data-task-id="${taskId}"]`);
    childRows.forEach(row => {
        if (isCollapsed) {
            row.classList.add('hidden');
        } else {
            row.classList.remove('hidden');
        }
    });
}

function updateTaskGroupHeaders() {
    // Update task group headers to hide if all children are hidden
    const headers = document.querySelectorAll('.task-group-header');
    headers.forEach(header => {
        const taskId = header.dataset.taskId;
        let visibleCount = 0;
        
        // Count visible rows for this task
        const childRows = document.querySelectorAll(`tr.task-child[data-task-id="${taskId}"]`);
        childRows.forEach(row => {
            if (row.dataset.hidden !== 'true') {
                visibleCount++;
            }
        });
        
        // Hide header if no visible children
        if (visibleCount === 0) {
            header.style.display = 'none';
        } else {
            header.style.display = '';
            // Update the badge count
            const badge = header.querySelector('.task-badge');
            if (badge) {
                badge.textContent = visibleCount;
            }
        }
    });
}

function formatNumber(n) {
    if (n === null || n === undefined) return '-';
    return n.toLocaleString();
}

function formatScore(score) {
    if (score === null || score === undefined) return '-';
    return score.toFixed(2);
}

function formatCost(cost) {
    if (cost === null || cost === undefined || cost === 0) return '-';
    if (cost < 0.01) return '<0.01';
    return cost.toFixed(2);
}

function formatPromptEvo(stats) {
    if (!stats.has_prompt_evo) return '<span class="pe-none">-</span>';
    const count = stats.prompt_count || 0;
    const cost = stats.prompt_evo_cost || 0;
    const costStr = cost > 0 ? ` ($${cost.toFixed(2)})` : '';
    return `<span class="pe-active" title="${count} prompts, $${cost.toFixed(4)} cost">${count}${costStr}</span>`;
}

function formatGenerations(stats) {
    if (!stats) return '-';
    const count = stats.generation_count ?? stats.max_generation ?? null;
    if (count === null || count === undefined) return '-';
    const totalCost = (stats.total_cost || 0) + (stats.prompt_evo_cost || 0);
    const costStr = totalCost > 0 ? ` ($${totalCost.toFixed(2)})` : '';
    const titleCount = stats.generation_count ?? count;
    const maxGen = stats.max_generation ?? '-';
    return `<span title="${titleCount} generations, max generation ${maxGen}, $${totalCost.toFixed(4)} total cost">${titleCount}${costStr}</span>`;
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-';
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
    return `${(seconds / 86400).toFixed(1)}d`;
}

function formatStall(gens) {
    if (gens === null || gens === undefined) return '-';
    if (gens === 0) return '<span class="stall-ok">✓</span>';
    if (gens <= 10) return `<span class="stall-ok">${gens}</span>`;
    if (gens <= 50) return `<span class="stall-warn">${gens}</span>`;
    return `<span class="stall-bad">${gens}</span>`;
}

function formatBestGeneration(generation) {
    if (generation === null || generation === undefined) return '-';
    return formatNumber(generation);
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '-';
    
    const now = Date.now() / 1000; // Current time in seconds
    const diff = now - timestamp;
    
    let text;
    if (diff < 60) text = 'just now';
    else if (diff < 3600) {
        const mins = Math.floor(diff / 60);
        text = `${mins}m ago`;
    }
    else if (diff < 86400) {
        const hours = Math.floor(diff / 3600);
        text = `${hours}h ago`;
    }
    else if (diff < 604800) {
        const days = Math.floor(diff / 86400);
        text = `${days}d ago`;
    }
    else {
        // Format as date
        const date = new Date(timestamp * 1000);
        text = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    return `<span class="time-ago">${text}</span>`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Selection and comparison functionality
function updateCompareButton() {
    const checkboxes = document.querySelectorAll('.result-checkbox:checked');
    const count = checkboxes.length;
    const compareBtn = document.getElementById('compare-btn');
    const countBadge = document.getElementById('compare-count');
    
    if (count >= 2) {
        compareBtn.classList.add('visible');
        countBadge.textContent = count;
    } else {
        compareBtn.classList.remove('visible');
    }
    
    // Update select-all checkbox state
    const allCheckboxes = document.querySelectorAll('.result-checkbox');
    const selectAll = document.getElementById('select-all');
    if (allCheckboxes.length > 0) {
        selectAll.checked = checkboxes.length === allCheckboxes.length;
        selectAll.indeterminate = checkboxes.length > 0 && checkboxes.length < allCheckboxes.length;
    }
}

function toggleSelectAll(checkbox) {
    const allCheckboxes = document.querySelectorAll('.result-checkbox');
    allCheckboxes.forEach(cb => {
        cb.checked = checkbox.checked;
    });
    updateCompareButton();
}

function openCompare() {
    const checkboxes = document.querySelectorAll('.result-checkbox:checked');
    const selected = [];
    checkboxes.forEach(cb => {
        selected.push({
            path: cb.dataset.path,
            label: cb.dataset.label
        });
    });
    
    if (selected.length < 2) {
        alert('Please select at least 2 results to compare');
        return;
    }
    
    // Store selection in sessionStorage and navigate to compare page
    sessionStorage.setItem('compareSelection', JSON.stringify(selected));
    window.location.href = '/compare.html';
}

// Search functionality
document.getElementById('search-input').addEventListener('input', (e) => {
    renderTable(e.target.value);
    // Load stats for newly visible rows
    setTimeout(() => loadVisibleStats(), 50);
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        document.getElementById('search-input').focus();
    }
    if (e.key === 'Escape') {
        const searchInput = document.getElementById('search-input');
        if (searchInput.value) {
            searchInput.value = '';
            renderTable();
            setTimeout(() => loadVisibleStats(), 50);
        }
        searchInput.blur();
    }
});

// Load databases on page load
loadDatabases();

// Auto-refresh every 30 seconds
setInterval(loadDatabases, 30000);

// Functions referenced by inline event handlers in the HTML and in generated markup.
Object.assign(window, { toggleSort, toggleSelectAll, openCompare, updateCompareButton });
