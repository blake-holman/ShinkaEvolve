// Compare page: score and cost charts for the runs selected on the landing page.

// Chart.js instances
let chartGen = null;
let chartCost = null;

// Store fetched data
let resultsData = {};
let selection = [];

// Color palette (distinct colors)
const COLORS = [
    '#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#f39c12',
    '#1abc9c', '#e91e63', '#00bcd4', '#ff5722', '#607d8b',
    '#8bc34a', '#673ab7', '#795548', '#ff9800', '#009688'
];

async function init() {
    // Get selection from sessionStorage
    const stored = sessionStorage.getItem('compareSelection');
    if (!stored) {
        showError();
        return;
    }

    try {
        selection = JSON.parse(stored);
    } catch (e) {
        showError();
        return;
    }

    if (!selection || selection.length < 2) {
        showError();
        return;
    }

    document.getElementById('subtitle').textContent = `Comparing ${selection.length} results`;

    // Fetch data for all selected databases in parallel
    try {
        await Promise.all(selection.map(s => fetchResultData(s)));
        showContent();
        updateChart();
    } catch (error) {
        console.error('Error fetching data:', error);
        document.getElementById('error-state').querySelector('.error-title').textContent = 'Error Loading Data';
        document.getElementById('error-state').querySelector('.error-text').textContent = error.message;
        showError();
    }
}

async function fetchResultData(item) {
    const response = await fetch(`/get_programs_summary?db_path=${encodeURIComponent(item.path)}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch data for ${item.label}`);
    }
    const programs = await response.json();
    resultsData[item.path] = {
        label: item.label,
        programs: programs
    };
}

function showError() {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('error-state').style.display = 'block';
    document.getElementById('content').style.display = 'none';
}

function showContent() {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('error-state').style.display = 'none';
    document.getElementById('content').style.display = 'block';
    populateLegend();
}

function populateLegend() {
    const tbody = document.getElementById('legend-body');
    tbody.innerHTML = '';

    selection.forEach((item, idx) => {
        const data = resultsData[item.path];
        const color = COLORS[idx % COLORS.length];
        
        // Calculate stats
        const programs = data.programs || [];
        const maxGen = programs.reduce((max, p) => Math.max(max, p.generation || 0), 0);
        const bestScore = getBestCorrectScore(programs);
        const totalCost = programs.reduce((sum, p) => sum + getProgramCost(p), 0);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <span class="color-swatch" style="background: ${color}"></span>
                <span class="result-label">${escapeHtml(item.label)}</span>
            </td>
            <td class="numeric">${bestScore === null ? 'N/A' : bestScore.toFixed(2)}</td>
            <td class="numeric">${maxGen}</td>
            <td class="numeric">${programs.length.toLocaleString()}</td>
            <td class="numeric">${totalCost < 0.01 ? '<0.01' : totalCost.toFixed(2)}</td>
            <td class="arrow-cell">→</td>
        `;
        
        // Make row clickable
        row.addEventListener('click', () => {
            window.location.href = `/viz_tree.html?db_path=${encodeURIComponent(item.path)}`;
        });
        
        tbody.appendChild(row);
    });
}

function getProgramCost(p) {
    // Extract costs from metadata
    const meta = p.metadata || {};
    return (meta.api_costs || 0) + (meta.embed_cost || 0) + (meta.novelty_cost || 0) + (meta.meta_cost || 0);
}

function getBestCorrectScore(programs) {
    let bestScore = Number.NEGATIVE_INFINITY;
    programs.forEach(p => {
        if (!p.correct || p.combined_score === null || p.combined_score === undefined) {
            return;
        }
        bestScore = Math.max(bestScore, p.combined_score);
    });
    return Number.isFinite(bestScore) ? bestScore : null;
}

function updateChart() {
    const metric = document.getElementById('metric-select').value;
    
    const metricLabels = {
        'best_score': 'Best Score',
        'program_count': 'Total Programs',
        'correct_count': 'Correct Programs'
    };
    const metricLabel = metricLabels[metric] || 'Value';
    
    document.getElementById('chart-title-gen').textContent = `${metricLabel} over Generations`;
    document.getElementById('chart-title-cost').textContent = `${metricLabel} over API Cost ($)`;

    // Build datasets for both charts
    const datasetsGen = [];
    const datasetsCost = [];
    
    selection.forEach((item, idx) => {
        const data = resultsData[item.path];
        const color = COLORS[idx % COLORS.length];
        const programs = data.programs || [];
        
        // Sort programs by generation, then by timestamp for cost ordering
        const sortedByGen = [...programs].sort((a, b) => (a.generation || 0) - (b.generation || 0));
        const sortedByTimestamp = [...programs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        // === Chart 1: By Generation ===
        const genData = {};
        sortedByGen.forEach(p => {
            const gen = p.generation || 0;
            if (!genData[gen]) {
                genData[gen] = { programs: [], scores: [] };
            }
            genData[gen].programs.push(p);
            if (p.correct && p.combined_score !== null && p.combined_score !== undefined) {
                genData[gen].scores.push(p.combined_score);
            }
        });

        const generations = Object.keys(genData).map(Number).sort((a, b) => a - b);
        let cumulativeBest = Number.NEGATIVE_INFINITY;
        let cumulativePrograms = 0;
        let cumulativeCorrect = 0;
        
        const pointsGen = generations.map(gen => {
            const genInfo = genData[gen];
            const genBest = genInfo.scores.length > 0 ? Math.max(...genInfo.scores) : null;
            if (genBest !== null) {
                cumulativeBest = Math.max(cumulativeBest, genBest);
            }
            cumulativePrograms += genInfo.programs.length;
            cumulativeCorrect += genInfo.programs.filter(p => p.correct).length;
            
            let value;
            switch (metric) {
                case 'best_score': value = Number.isFinite(cumulativeBest) ? cumulativeBest : null; break;
                case 'program_count': value = cumulativePrograms; break;
                case 'correct_count': value = cumulativeCorrect; break;
                default: value = cumulativeBest;
            }
            return { x: gen, y: value };
        });

        datasetsGen.push({
            label: item.label,
            data: pointsGen,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            pointRadius: 2,
            pointHoverRadius: 4,
            tension: 0.1,
            fill: false
        });

        // === Chart 2: By Cost ===
        let runningCost = 0;
        let runningBest = Number.NEGATIVE_INFINITY;
        let runningPrograms = 0;
        let runningCorrect = 0;
        
        const pointsCost = [];
        sortedByTimestamp.forEach(p => {
            const cost = getProgramCost(p);
            runningCost += cost;
            runningPrograms += 1;
            if (p.correct) runningCorrect += 1;
            if (p.correct && p.combined_score !== null && p.combined_score !== undefined) {
                runningBest = Math.max(runningBest, p.combined_score);
            }
            
            let value;
            switch (metric) {
                case 'best_score': value = Number.isFinite(runningBest) ? runningBest : null; break;
                case 'program_count': value = runningPrograms; break;
                case 'correct_count': value = runningCorrect; break;
                default: value = runningBest;
            }
            pointsCost.push({ x: runningCost, y: value });
        });

        // Downsample if too many points (for performance)
        const maxPoints = 200;
        let sampledPoints = pointsCost;
        if (pointsCost.length > maxPoints) {
            const step = Math.ceil(pointsCost.length / maxPoints);
            sampledPoints = pointsCost.filter((_, i) => i % step === 0 || i === pointsCost.length - 1);
        }

        datasetsCost.push({
            label: item.label,
            data: sampledPoints,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2,
            pointRadius: 1,
            pointHoverRadius: 3,
            tension: 0.1,
            fill: false
        });
    });

    // Create/update Generation chart
    const ctxGen = document.getElementById('chart-generations').getContext('2d');
    if (chartGen) chartGen.destroy();
    
    chartGen = new Chart(ctxGen, {
        type: 'line',
        data: { datasets: datasetsGen },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 15, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            let v = ctx.parsed.y;
                            if (metric === 'best_score') v = v.toFixed(2);
                            return `${ctx.dataset.label}: ${v}`;
                        }
                    }
                }
            },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'Generation' }, grid: { color: '#f0f0f0' } },
                y: { title: { display: true, text: metricLabel }, grid: { color: '#f0f0f0' }, beginAtZero: metric !== 'best_score' }
            }
        }
    });

    // Create/update Cost chart
    const ctxCost = document.getElementById('chart-cost').getContext('2d');
    if (chartCost) chartCost.destroy();
    
    chartCost = new Chart(ctxCost, {
        type: 'line',
        data: { datasets: datasetsCost },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 15, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            let v = ctx.parsed.y;
                            if (metric === 'best_score') v = v.toFixed(2);
                            return `${ctx.dataset.label}: ${v}`;
                        },
                        title: ctx => `Cost: $${ctx[0].parsed.x.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: { type: 'linear', title: { display: true, text: 'API Cost ($)' }, grid: { color: '#f0f0f0' } },
                y: { title: { display: true, text: metricLabel }, grid: { color: '#f0f0f0' }, beginAtZero: metric !== 'best_score' }
            }
        }
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize on page load
init();

// Functions referenced by inline event handlers in the HTML and in generated markup.
Object.assign(window, { updateChart });
