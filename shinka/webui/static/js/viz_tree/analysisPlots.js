// Analysis tab: Plotly renderers.
import { config } from './databases.js';
import { formatScore } from './format.js';
import { computeCodeBloatStats, computeCorrectnessRateStats, computeCostStats, computeImprovementRateStats, computeLLMStats, computeLineageStats, computeMutationSizeStats, computeMutationStats, computeNoveltyLLMStats, computeNoveltyMutationStats, computeResampleLLMStats, computeResampleMutationStats, linearRegression } from './analysisStats.js';

// Visualization rendering functions
function renderLLMPerformancePlot(stats, selectedNodeId) {
    if (!stats || !stats.modelStats) {
        document.getElementById('llm-performance-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No LLM performance data available.</p>';
        return;
    }
    
    const models = Object.keys(stats.modelStats);
    if (models.length === 0) {
        document.getElementById('llm-performance-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No model data available.</p>';
        return;
    }
    
    const patchTypes = new Set();
    models.forEach(model => {
        Object.keys(stats.modelStats[model].patchTypes).forEach(pt => patchTypes.add(pt));
    });
    const patchTypeArray = Array.from(patchTypes);
    
    // Map patch types to symbols
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypeArray.map(pt => patchTypeSymbols[pt] || pt);
    
    // Find common prefix among model names (simple approach)
    let commonPrefix = '';
    if (models.length > 1) {
        const sortedModels = models.slice().sort();
        const first = sortedModels[0];
        const last = sortedModels[sortedModels.length - 1];
        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            commonPrefix += first[i];
            i++;
        }
    }
    
    // Check if prefix removal would create problematic labels for ANY model
    if (commonPrefix) {
        const hasProblematicLabel = models.some(m => {
            const label = m.substring(commonPrefix.length);
            return label.length === 0 || label.length < 3 || /^[^a-zA-Z0-9]/.test(label);
        });
        // If any label would be problematic, don't use prefix at all
        if (hasProblematicLabel) {
            commonPrefix = '';
        }
    }
    
    const modelLabels = models.map(m => {
        const label = commonPrefix ? m.substring(commonPrefix.length) : m;
        // Ensure label is never empty
        const finalLabel = label.length > 0 ? label : m;
        // If still too long, truncate with ellipsis
        return finalLabel.length > 30 ? finalLabel.substring(0, 30) + '...' : finalLabel;
    });
    
    // Create heatmap data
    const z = [];
    const cellText = [];
    const hoverText = [];
    models.forEach(model => {
        const row = [];
        const cellTextRow = [];
        const hoverTextRow = [];
        patchTypeArray.forEach(pt => {
            const ptStats = stats.modelStats[model].patchTypes[pt] || { totalAttempts: 0, successes: 0, improvements: 0 };
            const successRate = ptStats.totalAttempts > 0 ? ptStats.successes / ptStats.totalAttempts : 0;
            const improvementRate = ptStats.successes > 0 ? ptStats.improvements / ptStats.successes : 0;
            row.push(successRate);
            cellTextRow.push(Math.round(successRate * 100) + '%');
            hoverTextRow.push(`<b>${model}</b><br>${ptStats.successes} / ${ptStats.totalAttempts} succeeded<br>${ptStats.improvements} / ${ptStats.successes} improved`);
        });
        z.push(row);
        cellText.push(cellTextRow);
        hoverText.push(hoverTextRow);
    });
    
    const heatmap = {
        z: z,
        x: patchTypeLabels,
        y: modelLabels,
        text: cellText,
        customdata: hoverText,
        type: 'heatmap',
        colorscale: 'RdYlGn',
        showscale: false,
        zmin: 0,
        zmax: 1,
        hovertemplate: '%{customdata}<extra></extra>',
        texttemplate: '%{text}',
        textfont: { 
            size: 8,
            color: 'white'
        }
    };
    
    // Create annotations for text overlay
    const annotations = [];
    models.forEach((model, i) => {
        patchTypeArray.forEach((pt, j) => {
            annotations.push({
                x: patchTypeLabels[j],
                y: modelLabels[i],
                text: cellText[i][j],
                showarrow: false,
                font: {
                    size: 8,
                    color: 'white'
                }
            });
        });
    });
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { tickfont: { size: 10 } },
        height: 320,
        margin: { l: 80, r: 10, t: 10, b: 60 },
        annotations: annotations
    };
    
    Plotly.newPlot('llm-performance-plot', [heatmap], layout, {responsive: true, displayModeBar: false});
}

function renderLLMImprovementPlot(stats, selectedNodeId) {
    if (!stats || !stats.modelStats) {
        document.getElementById('llm-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No LLM improvement data available.</p>';
        return;
    }
    
    const models = Object.keys(stats.modelStats);
    if (models.length === 0) {
        document.getElementById('llm-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No model data available.</p>';
        return;
    }
    
    const patchTypes = new Set();
    models.forEach(model => {
        Object.keys(stats.modelStats[model].patchTypes).forEach(pt => patchTypes.add(pt));
    });
    const patchTypeArray = Array.from(patchTypes);
    
    // Map patch types to symbols
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypeArray.map(pt => patchTypeSymbols[pt] || pt);
    
    // Find common prefix among model names (simple approach)
    let commonPrefix = '';
    if (models.length > 1) {
        const sortedModels = models.slice().sort();
        const first = sortedModels[0];
        const last = sortedModels[sortedModels.length - 1];
        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            commonPrefix += first[i];
            i++;
        }
    }
    
    // Check if prefix removal would create problematic labels for ANY model
    if (commonPrefix) {
        const hasProblematicLabel = models.some(m => {
            const label = m.substring(commonPrefix.length);
            return label.length === 0 || label.length < 3 || /^[^a-zA-Z0-9]/.test(label);
        });
        // If any label would be problematic, don't use prefix at all
        if (hasProblematicLabel) {
            commonPrefix = '';
        }
    }
    
    const modelLabels = models.map(m => {
        const label = commonPrefix ? m.substring(commonPrefix.length) : m;
        // Ensure label is never empty
        const finalLabel = label.length > 0 ? label : m;
        // If still too long, truncate with ellipsis
        return finalLabel.length > 30 ? finalLabel.substring(0, 30) + '...' : finalLabel;
    });
    
    // Create heatmap data for improvement rates
    const z = [];
    const cellText = [];
    const hoverText = [];
    models.forEach(model => {
        const row = [];
        const cellTextRow = [];
        const hoverTextRow = [];
        patchTypeArray.forEach(pt => {
            const ptStats = stats.modelStats[model].patchTypes[pt] || { totalAttempts: 0, successes: 0, improvements: 0, correctPrograms: 0, improvementsFromCorrect: 0 };
            // Calculate improvement rate as correct improved over total attempts
            const improvementRate = ptStats.totalAttempts > 0 ? ptStats.improvementsFromCorrect / ptStats.totalAttempts : 0;
            row.push(improvementRate);
            cellTextRow.push(Math.round(improvementRate * 100) + '%');
            hoverTextRow.push(`<b>${model}</b><br>${ptStats.improvementsFromCorrect} / ${ptStats.totalAttempts} improved<br>${ptStats.successes} / ${ptStats.totalAttempts} succeeded<br>${ptStats.correctPrograms} correct programs`);
        });
        z.push(row);
        cellText.push(cellTextRow);
        hoverText.push(hoverTextRow);
    });
    
    const heatmap = {
        z: z,
        x: patchTypeLabels,
        y: modelLabels,
        text: cellText,
        customdata: hoverText,
        type: 'heatmap',
        colorscale: 'RdYlGn',
        showscale: false,
        zmin: 0,
        zmax: 1,
        hovertemplate: '%{customdata}<extra></extra>',
        texttemplate: '%{text}',
        textfont: { 
            size: 8,
            color: 'white'
        }
    };
    
    // Create annotations for text overlay
    const annotations = [];
    models.forEach((model, i) => {
        patchTypeArray.forEach((pt, j) => {
            annotations.push({
                x: patchTypeLabels[j],
                y: modelLabels[i],
                text: cellText[i][j],
                showarrow: false,
                font: {
                    size: 8,
                    color: 'white'
                }
            });
        });
    });
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { tickfont: { size: 10 } },
        height: 320,
        margin: { l: 80, r: 10, t: 10, b: 60 },
        annotations: annotations
    };
    
    Plotly.newPlot('llm-improvement-plot', [heatmap], layout, {responsive: true, displayModeBar: false});
}

function renderMutationEffectivenessPlot(stats, selectedNodeId) {
    if (!stats || !stats.patchTypeStats) {
        document.getElementById('mutation-effectiveness-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No mutation data available.</p>';
        return;
    }
    
    const patchTypes = Object.keys(stats.patchTypeStats);
    if (patchTypes.length === 0) {
        document.getElementById('mutation-effectiveness-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No patch type data available.</p>';
        return;
    }
    
    // Map patch types to symbols
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypes.map(pt => patchTypeSymbols[pt] || pt);
    
    const successData = patchTypes.map(pt => stats.patchTypeStats[pt].successes);
    const failureData = patchTypes.map(pt => stats.patchTypeStats[pt].failures);
    
    const trace1 = {
        x: patchTypeLabels,
        y: successData,
        name: '✔',
        type: 'bar',
        marker: { color: '#2ecc71' }
    };
    
    const trace2 = {
        x: patchTypeLabels,
        y: failureData,
        name: '✘',
        type: 'bar',
        marker: { color: '#e74c3c' }
    };
    
    const layout = {
        barmode: 'stack',
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { title: 'Count' },
        height: 320,
        margin: { l: 50, r: 20, t: 10, b: 60 },
        legend: { x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.8)' }
    };
    
    Plotly.newPlot('mutation-effectiveness-plot', [trace1, trace2], layout, {responsive: true, displayModeBar: false});
}

function renderMutationImprovementPlot(stats, selectedNodeId) {
    if (!stats || !stats.patchTypeStats) {
        document.getElementById('mutation-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No mutation improvement data available.</p>';
        return;
    }
    
    const patchTypes = Object.keys(stats.patchTypeStats);
    if (patchTypes.length === 0) {
        document.getElementById('mutation-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No patch type data available.</p>';
        return;
    }
    
    // Map patch types to symbols
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypes.map(pt => patchTypeSymbols[pt] || pt);
    
    const improvementData = patchTypes.map(pt => {
        const s = stats.patchTypeStats[pt];
        // Calculate improvement rate as correct improved over total attempts
        return s.totalAttempts > 0 ? (s.improvementsFromCorrect / s.totalAttempts) * 100 : 0;
    });
    
    const trace = {
        x: patchTypeLabels,
        y: improvementData,
        type: 'bar',
        marker: { color: '#3498db' },
        text: improvementData.map((v, i) => {
            const s = stats.patchTypeStats[patchTypes[i]];
            const patchTypeName = patchTypes[i];
            return `<b>Patch Type: ${patchTypeName}</b><br>` +
                   `Improvement Rate: ${v.toFixed(1)}%<br>` +
                   `Improved (correct): ${s.improvementsFromCorrect}<br>` +
                   `Total Attempts: ${s.totalAttempts}`;
        }),
        hoverinfo: 'text'
    };
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { title: 'Improvement Rate (%)', range: [0, 100] },
        height: 320,
        margin: { l: 50, r: 20, t: 10, b: 60 }
    };
    
    Plotly.newPlot('mutation-improvement-plot', [trace], layout, {responsive: true, displayModeBar: false});
}

function renderNoveltyLLMPerformancePlot(stats, selectedNodeId) {
    if (!stats || !stats.modelStats) {
        document.getElementById('novelty-llm-performance-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty LLM performance data available.</p>';
        return;
    }
    
    const models = Object.keys(stats.modelStats);
    if (models.length === 0) {
        document.getElementById('novelty-llm-performance-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty model data available.</p>';
        return;
    }
    
    const patchTypes = new Set();
    models.forEach(model => {
        Object.keys(stats.modelStats[model].patchTypes).forEach(pt => patchTypes.add(pt));
    });
    const patchTypeArray = Array.from(patchTypes);
    
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypeArray.map(pt => patchTypeSymbols[pt] || pt);
    
    // Find common prefix among model names (simple approach)
    let commonPrefix = '';
    if (models.length > 1) {
        const sortedModels = models.slice().sort();
        const first = sortedModels[0];
        const last = sortedModels[sortedModels.length - 1];
        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            commonPrefix += first[i];
            i++;
        }
    }
    
    // Check if prefix removal would create problematic labels for ANY model
    if (commonPrefix) {
        const hasProblematicLabel = models.some(m => {
            const label = m.substring(commonPrefix.length);
            return label.length === 0 || label.length < 3 || /^[^a-zA-Z0-9]/.test(label);
        });
        // If any label would be problematic, don't use prefix at all
        if (hasProblematicLabel) {
            commonPrefix = '';
        }
    }
    
    const modelLabels = models.map(m => {
        const label = commonPrefix ? m.substring(commonPrefix.length) : m;
        // Ensure label is never empty
        const finalLabel = label.length > 0 ? label : m;
        return finalLabel.length > 30 ? finalLabel.substring(0, 30) + '...' : finalLabel;
    });
    
    const z = [];
    const cellText = [];
    const hoverText = [];
    models.forEach(model => {
        const row = [];
        const cellTextRow = [];
        const hoverTextRow = [];
        patchTypeArray.forEach(pt => {
            const ptStats = stats.modelStats[model].patchTypes[pt] || { totalAttempts: 0, successes: 0, improvements: 0 };
            const successRate = ptStats.totalAttempts > 0 ? ptStats.successes / ptStats.totalAttempts : 0;
            row.push(successRate);
            cellTextRow.push(Math.round(successRate * 100) + '%');
            hoverTextRow.push(`<b>${model}</b><br>${ptStats.successes} / ${ptStats.totalAttempts} succeeded<br>${ptStats.improvements} / ${ptStats.successes} improved`);
        });
        z.push(row);
        cellText.push(cellTextRow);
        hoverText.push(hoverTextRow);
    });
    
    const heatmap = {
        z: z,
        x: patchTypeLabels,
        y: modelLabels,
        text: cellText,
        customdata: hoverText,
        type: 'heatmap',
        colorscale: 'RdYlGn',
        showscale: false,
        zmin: 0,
        zmax: 1,
        hovertemplate: '%{customdata}<extra></extra>',
        texttemplate: '%{text}',
        textfont: { 
            size: 8,
            color: 'white'
        }
    };
    
    const annotations = [];
    models.forEach((model, i) => {
        patchTypeArray.forEach((pt, j) => {
            annotations.push({
                x: patchTypeLabels[j],
                y: modelLabels[i],
                text: cellText[i][j],
                showarrow: false,
                font: {
                    size: 8,
                    color: 'white'
                }
            });
        });
    });
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { tickfont: { size: 10 } },
        height: 310,
        margin: { l: 80, r: 10, t: 10, b: 60 },
        annotations: annotations
    };
    
    Plotly.newPlot('novelty-llm-performance-plot', [heatmap], layout, {responsive: true, displayModeBar: false});
}

function renderNoveltyLLMImprovementPlot(stats, selectedNodeId) {
    if (!stats || !stats.modelStats) {
        document.getElementById('novelty-llm-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty LLM improvement data available.</p>';
        return;
    }
    
    const models = Object.keys(stats.modelStats);
    if (models.length === 0) {
        document.getElementById('novelty-llm-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty model data available.</p>';
        return;
    }
    
    const patchTypes = new Set();
    models.forEach(model => {
        Object.keys(stats.modelStats[model].patchTypes).forEach(pt => patchTypes.add(pt));
    });
    const patchTypeArray = Array.from(patchTypes);
    
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypeArray.map(pt => patchTypeSymbols[pt] || pt);
    
    // Find common prefix among model names (simple approach)
    let commonPrefix = '';
    if (models.length > 1) {
        const sortedModels = models.slice().sort();
        const first = sortedModels[0];
        const last = sortedModels[sortedModels.length - 1];
        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            commonPrefix += first[i];
            i++;
        }
    }
    
    // Check if prefix removal would create problematic labels for ANY model
    if (commonPrefix) {
        const hasProblematicLabel = models.some(m => {
            const label = m.substring(commonPrefix.length);
            return label.length === 0 || label.length < 3 || /^[^a-zA-Z0-9]/.test(label);
        });
        // If any label would be problematic, don't use prefix at all
        if (hasProblematicLabel) {
            commonPrefix = '';
        }
    }
    
    const modelLabels = models.map(m => {
        const label = commonPrefix ? m.substring(commonPrefix.length) : m;
        // Ensure label is never empty
        const finalLabel = label.length > 0 ? label : m;
        return finalLabel.length > 30 ? finalLabel.substring(0, 30) + '...' : finalLabel;
    });
    
    const z = [];
    const cellText = [];
    const hoverText = [];
    models.forEach(model => {
        const row = [];
        const cellTextRow = [];
        const hoverTextRow = [];
        patchTypeArray.forEach(pt => {
            const ptStats = stats.modelStats[model].patchTypes[pt] || { totalAttempts: 0, successes: 0, improvements: 0, correctPrograms: 0, improvementsFromCorrect: 0 };
            // Calculate improvement rate as correct improved over total attempts
            const improvementRate = ptStats.totalAttempts > 0 ? ptStats.improvementsFromCorrect / ptStats.totalAttempts : 0;
            row.push(improvementRate);
            cellTextRow.push(Math.round(improvementRate * 100) + '%');
            hoverTextRow.push(`<b>${model}</b><br>${ptStats.improvementsFromCorrect} / ${ptStats.totalAttempts} improved<br>${ptStats.correctPrograms} correct programs`);
        });
        z.push(row);
        cellText.push(cellTextRow);
        hoverText.push(hoverTextRow);
    });
    
    const heatmap = {
        z: z,
        x: patchTypeLabels,
        y: modelLabels,
        text: cellText,
        customdata: hoverText,
        type: 'heatmap',
        colorscale: 'RdYlGn',
        showscale: false,
        zmin: 0,
        zmax: 1,
        hovertemplate: '%{customdata}<extra></extra>',
        texttemplate: '%{text}',
        textfont: { 
            size: 8,
            color: 'white'
        }
    };
    
    const annotations = [];
    models.forEach((model, i) => {
        patchTypeArray.forEach((pt, j) => {
            annotations.push({
                x: patchTypeLabels[j],
                y: modelLabels[i],
                text: cellText[i][j],
                showarrow: false,
                font: {
                    size: 8,
                    color: 'white'
                }
            });
        });
    });
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { tickfont: { size: 10 } },
        height: 320,
        margin: { l: 80, r: 10, t: 10, b: 60 },
        annotations: annotations
    };
    
    Plotly.newPlot('novelty-llm-improvement-plot', [heatmap], layout, {responsive: true, displayModeBar: false});
}

function renderNoveltyEffectivenessPlot(stats, selectedNodeId) {
    if (!stats || !stats.patchTypeStats) {
        document.getElementById('novelty-effectiveness-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty effectiveness data available.</p>';
        return;
    }
    
    const patchTypes = Object.keys(stats.patchTypeStats);
    if (patchTypes.length === 0) {
        document.getElementById('novelty-effectiveness-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty patch type data available.</p>';
        return;
    }
    
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypes.map(pt => patchTypeSymbols[pt] || pt);
    
    const successCounts = patchTypes.map(pt => stats.patchTypeStats[pt].successes);
    const failureCounts = patchTypes.map(pt => stats.patchTypeStats[pt].failures);
    
    const trace1 = {
        x: patchTypeLabels,
        y: successCounts,
        name: '✔',
        type: 'bar',
        marker: { color: '#2ecc71' },
        text: successCounts.map(String),
        hoverinfo: 'text'
    };
    
    const trace2 = {
        x: patchTypeLabels,
        y: failureCounts,
        name: '✘',
        type: 'bar',
        marker: { color: '#e74c3c' },
        text: failureCounts.map(String),
        hoverinfo: 'text'
    };
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { title: 'Count' },
        barmode: 'stack',
        height: 310,
        margin: { l: 50, r: 20, t: 10, b: 60 },
        legend: { x: 1, y: 1, xanchor: 'right', yanchor: 'top' }
    };
    
    Plotly.newPlot('novelty-effectiveness-plot', [trace1, trace2], layout, {responsive: true, displayModeBar: false});
}

function renderNoveltyImprovementPlot(stats, selectedNodeId) {
    if (!stats || !stats.patchTypeStats) {
        document.getElementById('novelty-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty improvement data available.</p>';
        return;
    }
    
    const patchTypes = Object.keys(stats.patchTypeStats);
    if (patchTypes.length === 0) {
        document.getElementById('novelty-improvement-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No novelty patch type data available.</p>';
        return;
    }
    
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypes.map(pt => patchTypeSymbols[pt] || pt);
    
    const improvementData = patchTypes.map(pt => {
        const s = stats.patchTypeStats[pt];
        // Calculate improvement rate as correct improved over total attempts
        return s.totalAttempts > 0 ? (s.improvementsFromCorrect / s.totalAttempts) * 100 : 0;
    });
    
    const trace = {
        x: patchTypeLabels,
        y: improvementData,
        type: 'bar',
        marker: { color: '#9b59b6' },
        text: improvementData.map((v, i) => {
            const s = stats.patchTypeStats[patchTypes[i]];
            const patchTypeName = patchTypes[i];
            return `<b>Patch Type: ${patchTypeName}</b><br>` +
                   `Improvement Rate: ${v.toFixed(1)}%<br>` +
                   `<br>` +
                   `Improved (correct): ${s.improvementsFromCorrect}<br>` +
                   `Total Attempts: ${s.totalAttempts}<br>` +
                   `<br>` +
                   `Correct Programs: ${s.correctPrograms}<br>` +
                   `Total Successes: ${s.successes}<br>` +
                   `Success Rate: ${s.totalAttempts > 0 ? ((s.successes / s.totalAttempts) * 100).toFixed(1) : 0}%`;
        }),
        hoverinfo: 'text'
    };
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { title: 'Improvement Rate (%)', range: [0, 100] },
        height: 320,
        margin: { l: 50, r: 20, t: 10, b: 60 }
    };
    
    Plotly.newPlot('novelty-improvement-plot', [trace], layout, {responsive: true, displayModeBar: false});
}

function renderResampleLLMPerformancePlot(stats, selectedNodeId) {
    if (!stats || !stats.modelStats) {
        document.getElementById('resample-llm-performance-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No resample LLM performance data available.</p>';
        return;
    }
    
    const models = Object.keys(stats.modelStats);
    if (models.length === 0) {
        document.getElementById('resample-llm-performance-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No resample model data available.</p>';
        return;
    }
    
    const patchTypes = new Set();
    models.forEach(model => {
        Object.keys(stats.modelStats[model].patchTypes).forEach(pt => patchTypes.add(pt));
    });
    const patchTypeArray = Array.from(patchTypes);
    
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypeArray.map(pt => patchTypeSymbols[pt] || pt);
    
    // Find common prefix among model names
    let commonPrefix = '';
    if (models.length > 1) {
        const sortedModels = models.slice().sort();
        const first = sortedModels[0];
        const last = sortedModels[sortedModels.length - 1];
        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            commonPrefix += first[i];
            i++;
        }
    }
    
    // Check if prefix removal would create problematic labels for ANY model
    if (commonPrefix) {
        const hasProblematicLabel = models.some(m => {
            const label = m.substring(commonPrefix.length);
            return label.length === 0 || label.length < 3 || /^[^a-zA-Z0-9]/.test(label);
        });
        // If any label would be problematic, don't use prefix at all
        if (hasProblematicLabel) {
            commonPrefix = '';
        }
    }
    
    const modelLabels = models.map(m => {
        const label = commonPrefix ? m.substring(commonPrefix.length) : m;
        // Ensure label is never empty
        const finalLabel = label.length > 0 ? label : m;
        return finalLabel.length > 30 ? finalLabel.substring(0, 30) + '...' : finalLabel;
    });
    
    const z = [];
    const cellText = [];
    const hoverText = [];
    models.forEach(model => {
        const row = [];
        const cellTextRow = [];
        const hoverTextRow = [];
        patchTypeArray.forEach(pt => {
            const ptStats = stats.modelStats[model].patchTypes[pt] || { totalAttempts: 0, successes: 0, improvements: 0 };
            const successRate = ptStats.totalAttempts > 0 ? ptStats.successes / ptStats.totalAttempts : 0;
            row.push(successRate);
            cellTextRow.push(Math.round(successRate * 100) + '%');
            hoverTextRow.push(`<b>${model}</b><br>${ptStats.successes} / ${ptStats.totalAttempts} succeeded<br>${ptStats.improvements} / ${ptStats.successes} improved`);
        });
        z.push(row);
        cellText.push(cellTextRow);
        hoverText.push(hoverTextRow);
    });
    
    const heatmap = {
        z: z,
        x: patchTypeLabels,
        y: modelLabels,
        text: cellText,
        customdata: hoverText,
        type: 'heatmap',
        colorscale: 'RdYlGn',
        showscale: false,
        zmin: 0,
        zmax: 1,
        hovertemplate: '%{customdata}<extra></extra>',
        texttemplate: '%{text}',
        textfont: { 
            size: 8,
            color: 'white'
        }
    };
    
    const annotations = [];
    models.forEach((model, i) => {
        patchTypeArray.forEach((pt, j) => {
            annotations.push({
                x: patchTypeLabels[j],
                y: modelLabels[i],
                text: cellText[i][j],
                showarrow: false,
                font: {
                    size: 8,
                    color: 'white'
                }
            });
        });
    });
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { tickfont: { size: 10 } },
        height: 310,
        margin: { l: 80, r: 10, t: 10, b: 60 },
        annotations: annotations
    };
    
    Plotly.newPlot('resample-llm-performance-plot', [heatmap], layout, {responsive: true, displayModeBar: false});
}

function renderResampleEffectivenessPlot(stats, selectedNodeId) {
    if (!stats || !stats.patchTypeStats) {
        document.getElementById('resample-effectiveness-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No resample effectiveness data available.</p>';
        return;
    }
    
    const patchTypes = Object.keys(stats.patchTypeStats);
    if (patchTypes.length === 0) {
        document.getElementById('resample-effectiveness-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No resample patch type data available.</p>';
        return;
    }
    
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const patchTypeLabels = patchTypes.map(pt => patchTypeSymbols[pt] || pt);
    
    const successCounts = patchTypes.map(pt => stats.patchTypeStats[pt].successes);
    const failureCounts = patchTypes.map(pt => stats.patchTypeStats[pt].failures);
    
    const trace1 = {
        x: patchTypeLabels,
        y: successCounts,
        name: '✔',
        type: 'bar',
        marker: { color: '#2ecc71' },
        text: successCounts.map(String),
        hoverinfo: 'text'
    };
    
    const trace2 = {
        x: patchTypeLabels,
        y: failureCounts,
        name: '✘',
        type: 'bar',
        marker: { color: '#e74c3c' },
        text: failureCounts.map(String),
        hoverinfo: 'text'
    };
    
    const layout = {
        xaxis: { title: { text: 'Patch Type', font: { size: 12 } }, tickfont: { size: 20 } },
        yaxis: { title: 'Count' },
        barmode: 'stack',
        height: 310,
        margin: { l: 50, r: 20, t: 10, b: 60 },
        legend: { x: 1, y: 1, xanchor: 'right', yanchor: 'top' }
    };
    
    Plotly.newPlot('resample-effectiveness-plot', [trace1, trace2], layout, {responsive: true, displayModeBar: false});
}

function renderLineageFertilityPlot(stats, selectedNodeId) {
    if (!stats || !stats.childrenCounts) {
        document.getElementById('lineage-fertility-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No lineage data available.</p>';
        return;
    }
    
    if (stats.topFertile.length === 0) {
        document.getElementById('lineage-fertility-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No fertile programs found.</p>';
        return;
    }
    
    // Format x-axis labels: Gen X + first 10 chars of name
    const xLabels = stats.topFertile.map(p => 
        `${p.generation}: ${p.name.substring(0, 10)}${p.name.length > 10 ? '...' : ''}`
    );
    const totalChildren = stats.topFertile.map(p => p.children);
    const improvingChildren = stats.topFertile.map(p => p.improvingChildren);
    const hoverTexts = stats.topFertile.map(p => {
        const improvementRate = p.children > 0 ? (p.improvingChildren / p.children) * 100 : 0;
        const islandLabel = (p.islandIdx !== null && p.islandIdx !== undefined) ? p.islandIdx : 'N/A';
        
        return `<b>${p.name}</b> (Gen ${p.generation})<br>` +
               `Fitness: ${formatScore(p.score)} ${p.correct ? '✅' : '❌'}<br>` +
               `Patch: ${p.patchType || 'N/A'} | Island: ${islandLabel}<br>` +
               `Model: ${p.modelName || 'N/A'}<br>` +
               `Total children: ${p.children}<br>` +
               `Improving children: ${p.improvingChildren} (${improvementRate.toFixed(1)}%)`;
    });
    const hoverTextsTotal = hoverTexts.map(text => `${text}<br><b>Metric:</b> Total children`);
    
    const trace1 = {
        x: xLabels,
        y: totalChildren,
        name: 'Total Children',
        type: 'bar',
        marker: { color: '#3498db' },
        text: hoverTextsTotal,
        hoverinfo: 'text'
    };
    
    const trace2 = {
        x: xLabels,
        y: improvingChildren,
        name: 'Improving Children',
        type: 'bar',
        marker: { color: '#2ecc71' },
        hoverinfo: 'none'
    };
    
    const layout = {
        xaxis: { title: 'Generation & Program Name', tickangle: -45 },
        yaxis: { title: 'Number of Descendants' },
        barmode: 'group',
        height: 360,
        margin: { l: 60, r: 50, t: 10, b: 120 },
        legend: { x: 1, y: 1, xanchor: 'right', yanchor: 'top' }
    };
    
    Plotly.newPlot('lineage-fertility-plot', [trace1, trace2], layout, {responsive: true, displayModeBar: false});
}

function renderCodeBloatPlot(stats, selectedNodeId) {
    if (!stats || !stats.genStats || stats.genStats.length === 0) {
        document.getElementById('code-bloat-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No code bloat data available.</p>';
        return;
    }
    
    const generations = stats.genStats.map(d => d.generation);
    const avgLocs = stats.genStats.map(d => d.avgLoc);
    const avgLlocs = stats.genStats.map(d => d.avgLloc);
    
    // Calculate alpha values based on generation (0.2 to 1.0)
    const minGen = Math.min(...generations);
    const maxGen = Math.max(...generations);
    const genRange = maxGen - minGen || 1; // Avoid division by zero
    const alphaValues = generations.map(gen => 
        0.2 + 0.8 * ((gen - minGen) / genRange)
    );
    
    // Calculate linear regression for LOC
    const locRegression = linearRegression(generations, avgLocs);
    const locTrend = generations.map(gen => locRegression.slope * gen + locRegression.intercept);
    
    // Calculate linear regression for LLOC
    const llocRegression = linearRegression(generations, avgLlocs);
    const llocTrend = generations.map(gen => llocRegression.slope * gen + llocRegression.intercept);
    
    const trace1 = {
        x: generations,
        y: avgLocs,
        name: 'LOC',
        type: 'scatter',
        mode: 'markers',
        marker: { 
            color: '#3498db', 
            size: 8,
            opacity: alphaValues
        }
    };
    
    const trace2 = {
        x: generations,
        y: locTrend,
        name: 'LOC Trend',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#3498db', width: 2, dash: 'dash' },
        showlegend: false
    };
    
    const trace3 = {
        x: generations,
        y: avgLlocs,
        name: 'LLOC',
        type: 'scatter',
        mode: 'markers',
        marker: { 
            color: '#2ecc71', 
            size: 8,
            opacity: alphaValues
        }
    };
    
    const trace4 = {
        x: generations,
        y: llocTrend,
        name: 'LLOC Trend',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#2ecc71', width: 2, dash: 'dash' },
        showlegend: false
    };
    
    const layout = {
        xaxis: { title: 'Generation' },
        yaxis: {
            title: 'Lines of Code'
        },
        height: 360,
        margin: { l: 60, r: 50, t: 10, b: 40 },
        legend: { x: 0.05, y: 0.95 }
    };
    
    Plotly.newPlot('code-bloat-plot', [trace1, trace2, trace3, trace4], layout, {responsive: true, displayModeBar: false});
}

function renderMutationSizePlot(stats, selectedNodeId) {
    if (!stats || !stats.mutationData || stats.mutationData.length === 0) {
        document.getElementById('mutation-size-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No mutation size data available.</p>';
        return;
    }
    
    // Map patch types to Plotly symbols (matching tree visualization)
    const symbolMap = {
        'init': 'diamond',
        'full': 'circle',
        'diff': 'square',
        'cross': 'x',
        'fix': 'triangle-up'
    };
    
    const mutationSizes = stats.mutationData.map(d => d.mutationSize);
    const improvements = stats.mutationData.map(d => d.improvement);
    const colors = stats.mutationData.map(d => d.isCorrect ? '#2ecc71' : '#e74c3c');
    const symbols = stats.mutationData.map(d => symbolMap[d.patchType] || 'circle');
    const generations = stats.mutationData.map(d => d.generation);
    
    // Calculate alpha values based on generation (0.1 to 1.0)
    const minGen = Math.min(...generations);
    const maxGen = Math.max(...generations);
    const genRange = maxGen - minGen || 1; // Avoid division by zero
    const alphaValues = generations.map(gen => 
        0.1 + 0.9 * ((gen - minGen) / genRange)
    );
    
    const hoverText = stats.mutationData.map(d => 
        `<b>${d.programName}</b> (Gen ${d.generation})<br>` +
        `Model: ${d.modelName}<br>` +
        `Correct: ${d.isCorrect ? 'Yes' : 'No'}<br>` +
        `Score: ${d.parentScore !== null && d.parentScore !== undefined ? d.parentScore.toFixed(3) : 'N/A'} → ${d.score !== null && d.score !== undefined ? d.score.toFixed(3) : 'N/A'}<br>` +
        `Improvement: ${d.improvement !== null && d.improvement !== undefined ? (d.improvement > 0 ? '+' : '') + d.improvement.toFixed(3) : 'N/A'}<br>` +
        `Mutation Size: ${d.mutationSize} lines<br>` +
        `  Added: ${d.added}, Deleted: ${d.deleted}, Modified: ${d.modified}<br>` +
        `Patch Type: ${d.patchType}`
    );
    
    // Calculate linear regression
    const regression = linearRegression(mutationSizes, improvements);
    const minSize = Math.min(...mutationSizes);
    const maxSize = Math.max(...mutationSizes);
    const trendX = [minSize, maxSize];
    const trendY = trendX.map(x => regression.slope * x + regression.intercept);
    
    // Group data by patch type for separate traces (for legend)
    const patchTypes = ['diff', 'full', 'cross', 'init', 'fix'];
    const traces = [];
    
    patchTypes.forEach(patchType => {
        const indices = stats.mutationData
            .map((d, i) => d.patchType === patchType ? i : -1)
            .filter(i => i >= 0);
        
        if (indices.length > 0) {
            traces.push({
                x: indices.map(i => mutationSizes[i]),
                y: indices.map(i => improvements[i]),
                mode: 'markers',
                type: 'scatter',
                name: patchType.charAt(0).toUpperCase() + patchType.slice(1),
                marker: {
                    color: indices.map(i => colors[i]),
                    symbol: symbolMap[patchType] || 'circle',
                    size: 10,
                    opacity: indices.map(i => alphaValues[i]),
                    line: {
                        color: '#333',
                        width: 1
                    }
                },
                text: indices.map(i => hoverText[i]),
                hoverinfo: 'text'
            });
        }
    });
    
    // Trend line
    traces.push({
        x: trendX,
        y: trendY,
        mode: 'lines',
        type: 'scatter',
        name: `Trend (slope: ${regression.slope.toFixed(4)})`,
        showlegend: false,
        line: {
            color: '#9b59b6',
            width: 2,
            dash: 'dash'
        }
    });
    
    const layout = {
        xaxis: { title: 'Mutation Size (lines changed)' },
        yaxis: { title: 'Performance Improvement (Δ score)' },
        height: 360,
        margin: { l: 60, r: 50, t: 10, b: 40 },
        legend: { x: 0.95, y: 0.95, xanchor: 'right' },
        hovermode: 'closest',
        hoverdistance: 5,
        shapes: [{
            type: 'line',
            x0: minSize,
            y0: 0,
            x1: maxSize,
            y1: 0,
            line: {
                color: '#95a5a6',
                width: 1,
                dash: 'dot'
            }
        }]
    };
    
    Plotly.newPlot('mutation-size-plot', traces, layout, {responsive: true, displayModeBar: false});
}

function renderCorrectnessRatePlot(stats, selectedNodeId) {
    if (!stats || !stats.generations || stats.generations.length === 0) {
        document.getElementById('correctness-rate-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No correctness rate data available.</p>';
        return;
    }
    
    const traces = [];
    
    // Overall correctness rate trace (rolling cumulative)
    traces.push({
        x: stats.generations,
        y: stats.overallRates,
        name: 'Overall',
        type: 'scatter',
        mode: 'lines',
        line: { 
            color: '#34495e', 
            width: 3
        }
    });
    
    // Patch type traces with matching symbols from tree visualization
    const patchTypeConfig = {
        'diff': { color: '#3498db', name: 'Diff' },
        'full': { color: '#e74c3c', name: 'Full' },
        'cross': { color: '#f39c12', name: 'Cross' },
        'init': { color: '#9b59b6', name: 'Init' },
        'fix': { color: '#27ae60', name: 'Fix' }
    };
    
    Object.keys(patchTypeConfig).forEach(patchType => {
        const data = stats.ratesByPatchType[patchType];
        if (data && data.generations.length > 0) {
            const config = patchTypeConfig[patchType];
            traces.push({
                x: data.generations,
                y: data.rates,
                name: config.name,
                type: 'scatter',
                mode: 'lines',
                line: { 
                    color: config.color, 
                    width: 2,
                    dash: 'dot'
                }
            });
        }
    });
    
    const layout = {
        xaxis: { title: 'Generation' },
        yaxis: { 
            title: 'Rolling Correctness Rate (%)',
            range: [0, 100]
        },
        height: 360,
        margin: { l: 60, r: 50, t: 10, b: 40 },
        legend: { x: 0.95, y: 0.05, xanchor: 'right', yanchor: 'bottom' },
        hovermode: 'closest'
    };
    
    Plotly.newPlot('correctness-rate-plot', traces, layout, {responsive: true, displayModeBar: false});
}

function renderImprovementRatePlot(stats, selectedNodeId) {
    if (!stats || !stats.generations || stats.generations.length === 0) {
        document.getElementById('improvement-rate-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No improvement rate data available.</p>';
        return;
    }
    
    const traces = [];
    
    // Overall improvement rate trace (rolling cumulative)
    traces.push({
        x: stats.generations,
        y: stats.overallRates,
        name: 'Overall',
        type: 'scatter',
        mode: 'lines',
        line: { 
            color: '#34495e', 
            width: 3
        }
    });
    
    // Patch type traces with matching symbols from tree visualization
    const patchTypeConfig = {
        'diff': { color: '#3498db', name: 'Diff' },
        'full': { color: '#e74c3c', name: 'Full' },
        'cross': { color: '#f39c12', name: 'Cross' },
        'init': { color: '#9b59b6', name: 'Init' },
        'fix': { color: '#27ae60', name: 'Fix' }
    };
    
    Object.keys(patchTypeConfig).forEach(patchType => {
        const data = stats.ratesByPatchType[patchType];
        if (data && data.generations.length > 0) {
            const config = patchTypeConfig[patchType];
            traces.push({
                x: data.generations,
                y: data.rates,
                name: config.name,
                type: 'scatter',
                mode: 'lines',
                line: { 
                    color: config.color, 
                    width: 2,
                    dash: 'dot'
                }
            });
        }
    });
    
    const layout = {
        xaxis: { title: 'Generation' },
        yaxis: { 
            title: 'Rolling Improvement Rate (%)',
            range: [0, 100]
        },
        height: 360,
        margin: { l: 60, r: 50, t: 10, b: 40 },
        legend: { x: 0.95, y: 0.05, xanchor: 'right', yanchor: 'bottom' },
        hovermode: 'closest'
    };
    
    Plotly.newPlot('improvement-rate-plot', traces, layout, {responsive: true, displayModeBar: false});
}

function renderCostEfficiencyPlot(stats, selectedNodeId) {
    if (!stats || !stats.genCostStats || stats.genCostStats.length === 0) {
        document.getElementById('cost-efficiency-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No cost data available.</p>';
        return;
    }
    
    const generations = stats.genCostStats.map(d => d.generation);
    const apiCosts = stats.genCostStats.map(d => d.apiCost);
    const embedCosts = stats.genCostStats.map(d => d.embedCost);
    const noveltyCosts = stats.genCostStats.map(d => d.noveltyCost);
    const metaCosts = stats.genCostStats.map(d => d.metaCost);
    const cumulativeCosts = stats.genCostStats.map(d => d.cumulativeCost);
    const maxScores = stats.genCostStats.map(d => d.maxScore);
    
    const trace1 = {
        x: generations,
        y: apiCosts,
        name: 'API Costs',
        stackgroup: 'one',
        type: 'scatter',
        mode: 'lines',
        fill: 'tonexty',
        fillcolor: 'rgba(52, 152, 219, 0.5)',
        line: { color: '#3498db' }
    };
    
    const trace2 = {
        x: generations,
        y: embedCosts,
        name: 'Embed Costs',
        stackgroup: 'one',
        type: 'scatter',
        mode: 'lines',
        fill: 'tonexty',
        fillcolor: 'rgba(46, 204, 113, 0.5)',
        line: { color: '#2ecc71' }
    };
    
    const trace3 = {
        x: generations,
        y: noveltyCosts,
        name: 'Novelty Costs',
        stackgroup: 'one',
        type: 'scatter',
        mode: 'lines',
        fill: 'tonexty',
        fillcolor: 'rgba(241, 196, 15, 0.5)',
        line: { color: '#f1c40f' }
    };
    
    const trace4 = {
        x: generations,
        y: metaCosts,
        name: 'Meta Costs',
        stackgroup: 'one',
        type: 'scatter',
        mode: 'lines',
        fill: 'tonexty',
        fillcolor: 'rgba(231, 76, 60, 0.5)',
        line: { color: '#e74c3c' }
    };
    
    const trace5 = {
        x: generations,
        y: cumulativeCosts,
        name: 'Cumulative Cost',
        yaxis: 'y2',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#9b59b6', width: 2, dash: 'dash' }
    };
    
    const layout = {
        title: 'Cost Breakdown and Cumulative Spending Over Generations',
        xaxis: { title: 'Generation' },
        yaxis: {
            title: 'Cost per Generation ($)',
            titlefont: { color: '#3498db' },
            tickfont: { color: '#3498db' }
        },
        yaxis2: {
            title: 'Cumulative Cost ($)',
            titlefont: { color: '#9b59b6' },
            tickfont: { color: '#9b59b6' },
            overlaying: 'y',
            side: 'right'
        },
        height: 350,
        margin: { l: 60, r: 60, t: 50, b: 50 },
        legend: { x: 0.05, y: 0.95 }
    };
    
    Plotly.newPlot('cost-efficiency-plot', [trace1, trace2, trace3, trace4, trace5], layout, {responsive: true});
}

function renderModelPatchCostHeatmap(stats, selectedNodeId) {
    const container = document.getElementById('cost-model-patch-heatmap');
    if (!container) return;
    
    if (!stats || !stats.modelPatchStats || 
        !stats.modelPatchStats.models || stats.modelPatchStats.models.length === 0 ||
        !stats.modelPatchStats.patchTypes || stats.modelPatchStats.patchTypes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No cost data available for model/patch breakdown.</p>';
        return;
    }
    
    const { models, patchTypes, zValues, textValues, countValues } = stats.modelPatchStats;
    
    // Filter out 'init' patch type
    const patchTypeSymbols = {
        'init': '◆',
        'full': '●',
        'diff': '■',
        'cross': '✕',
        'fix': '▲'
    };
    const filteredPatchIndices = patchTypes.map((pt, idx) => pt !== 'init' ? idx : -1).filter(i => i >= 0);
    const filteredPatchTypes = filteredPatchIndices.map(i => patchTypes[i]);
    const patchTypeLabels = filteredPatchTypes.map(pt => patchTypeSymbols[pt] || pt);
    
    // Filter out 'N/A' models
    const filteredModelIndices = models.map((m, idx) => m !== 'N/A' ? idx : -1).filter(i => i >= 0);
    const filteredModels = filteredModelIndices.map(i => models[i]);
    
    // Find common prefix among model names
    let commonPrefix = '';
    if (filteredModels.length > 1) {
        const sortedModels = filteredModels.slice().sort();
        const first = sortedModels[0];
        const last = sortedModels[sortedModels.length - 1];
        let i = 0;
        while (i < first.length && first[i] === last[i]) {
            if (first[i] === '-' || first[i] === '_' || first[i] === '/') {
                commonPrefix = first.substring(0, i + 1);
            }
            i++;
        }
        const modelLabelsTest = filteredModels.map(m => commonPrefix ? m.substring(commonPrefix.length) : m);
        const hasProblematicLabel = modelLabelsTest.some(label => 
            label.length === 0 || label.match(/^[\d.]/)
        );
        if (hasProblematicLabel) {
            commonPrefix = '';
        }
    }
    const modelLabels = filteredModels.map(m => {
        const label = commonPrefix ? m.substring(commonPrefix.length) : m;
        const finalLabel = label.length > 0 ? label : m;
        return finalLabel.length > 30 ? finalLabel.substring(0, 30) + '...' : finalLabel;
    });
    
    // Filter z, text, and count values to exclude init column and N/A model rows
    const filteredZ = filteredModelIndices.map(mi => filteredPatchIndices.map(pi => zValues[mi][pi]));
    const filteredText = filteredModelIndices.map(mi => filteredPatchIndices.map(pi => textValues[mi][pi]));
    const filteredCounts = filteredModelIndices.map(mi => filteredPatchIndices.map(pi => countValues[mi][pi]));
    
    // Create cell text for annotations (dollar amounts with count)
    const cellText = filteredZ.map((row, i) => row.map((val, j) => {
        const count = filteredCounts[i][j];
        return val > 0 ? `$${val.toFixed(3)}<br>(${count} P)` : '-';
    }));
    
    const heatmap = {
        z: filteredZ,
        x: patchTypeLabels,
        y: modelLabels,
        text: cellText,
        customdata: filteredText,
        type: 'heatmap',
        colorscale: [[0, '#ffffff'], [1, '#e74c3c']],
        showscale: true,
        zmin: 0,
        hovertemplate: '%{customdata}<extra></extra>',
        colorbar: { title: 'Avg $', titleside: 'right', len: 0.8 }
    };
    
    // Create annotations for text overlay
    const annotations = [];
    const maxZ = Math.max(...filteredZ.flat().filter(v => v > 0), 0.001);
    filteredModels.forEach((model, i) => {
        filteredPatchTypes.forEach((pt, j) => {
            annotations.push({
                x: patchTypeLabels[j],
                y: modelLabels[i],
                text: cellText[i][j],
                showarrow: false,
                font: {
                    size: 8,
                    color: filteredZ[i][j] > (maxZ * 0.5) ? 'white' : 'black'
                }
            });
        });
    });
    
    const layout = {
        xaxis: { title: '', tickfont: { size: 16 } },
        yaxis: { title: '', tickfont: { size: 10 }, automargin: true },
        height: 340,
        margin: { l: 100, r: 60, t: 30, b: 40 },
        annotations: annotations
    };
    
    Plotly.newPlot('cost-model-patch-heatmap', [heatmap], layout, {responsive: true, displayModeBar: false});
}

function renderGenerationAvgCostPlot(stats, selectedNodeId) {
    const container = document.getElementById('cost-generation-avg-plot');
    if (!container) return;
    
    if (!stats || !stats.generationAvgCosts || stats.generationAvgCosts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No generation-level cost data available.</p>';
        return;
    }
    
    const traces = [];
    
    // Overall running average (cumulative)
    if (stats.generationOverallRunning && stats.generationOverallRunning.generations.length > 0) {
        traces.push({
            x: stats.generationOverallRunning.generations,
            y: stats.generationOverallRunning.runningAvg,
            name: 'Overall',
            type: 'scatter',
            mode: 'lines',
            line: { color: '#9b59b6', width: 3 },
            hovertemplate: 'Overall: %{y:.2f} $<extra></extra>'
        });
    }
    
    // Running average per model+patch combination (exclude init)
    // Filter and sort by final running average (highest cost first)
    const filteredSeries = (stats.generationModelPatchRunning || [])
        .filter(series => {
            if (!series.generations || series.generations.length === 0) return false;
            const [, patch] = series.key.split('||');
            return patch !== 'init';
        })
        .map(series => {
            // Get final non-null running average for sorting
            const nonNullValues = series.runningAvg.filter(v => v !== null);
            const finalAvg = nonNullValues.length > 0 ? nonNullValues[nonNullValues.length - 1] : 0;
            return { ...series, finalAvg };
        })
        .sort((a, b) => b.finalAvg - a.finalAvg); // Sort descending by cost
    
    const comboColors = ['#3498db', '#e67e22', '#16a085', '#f1c40f', '#e74c3c', '#2ecc71', '#34495e', '#8e44ad', '#d35400', '#1abc9c', '#c0392b', '#7f8c8d', '#2980b9', '#27ae60'];
    filteredSeries.forEach((series, idx) => {
        const [model, patch] = series.key.split('||');
        const color = comboColors[idx % comboColors.length];
        const traceName = `${model} / ${patch}`;
        // Create custom hover text that handles null values
        const hoverText = series.runningAvg.map(v => 
            v !== null ? `${traceName}: ${v.toFixed(3)} $` : `${traceName}: N/A`
        );
        traces.push({
            x: series.generations,
            y: series.runningAvg,
            name: traceName,
            type: 'scatter',
            mode: 'lines',
            line: { color, width: 2 },
            connectgaps: false,
            text: hoverText,
            hovertemplate: '%{text}<extra></extra>'
        });
    });
    
    const layout = {
        xaxis: { title: 'Generation' },
        yaxis: { title: 'Avg Cost ($)' },
        height: 340,
        margin: { l: 60, r: 20, t: 10, b: 40 },
        hovermode: 'x unified',
        legend: { 
            orientation: 'v',
            x: 0.99,
            y: 0.99,
            xanchor: 'right',
            yanchor: 'top',
            bgcolor: 'rgba(255,255,255,0.85)',
            bordercolor: '#ccc',
            borderwidth: 1,
            font: { size: 8 },
            itemwidth: 30
        }
    };
    
    Plotly.newPlot('cost-generation-avg-plot', traces, layout, {responsive: true, displayModeBar: false});
}

function renderSearchDynamicsPlot(stats, selectedNodeId) {
    if (!stats || !stats.clusterStats || stats.clusterStats.length === 0) {
        document.getElementById('search-dynamics-plot').innerHTML = 
            '<p style="text-align: center; color: #999;">No search dynamics data available.</p>';
        return;
    }
    
    const generations = stats.clusterStats.map(d => d.generation);
    const uniqueClusters = stats.clusterStats.map(d => d.uniqueClusters);
    
    const trace1 = {
        x: generations,
        y: uniqueClusters,
        name: 'Unique Clusters',
        type: 'scatter',
        mode: 'lines+markers',
        marker: { color: '#3498db' },
        line: { color: '#3498db' }
    };
    
    // Add variance overlay if available
    let traces = [trace1];
    if (stats.varianceStats && stats.varianceStats.length > 0) {
        const varianceGenerations = stats.varianceStats.map(d => d.generation);
        const variances = stats.varianceStats.map(d => d.variance);
        
        const trace2 = {
            x: varianceGenerations,
            y: variances,
            name: 'Score Variance',
            yaxis: 'y2',
            type: 'scatter',
            mode: 'lines+markers',
            marker: { color: '#e74c3c' },
            line: { color: '#e74c3c' }
        };
        
        traces.push(trace2);
    }
    
    const layout = {
        title: 'Search Dynamics: Cluster Diversity and Score Variance',
        xaxis: { title: 'Generation' },
        yaxis: {
            title: 'Number of Unique Clusters',
            titlefont: { color: '#3498db' },
            tickfont: { color: '#3498db' }
        },
        yaxis2: stats.varianceStats && stats.varianceStats.length > 0 ? {
            title: 'Score Variance',
            titlefont: { color: '#e74c3c' },
            tickfont: { color: '#e74c3c' },
            overlaying: 'y',
            side: 'right'
        } : undefined,
        height: 350,
        margin: { l: 60, r: 60, t: 50, b: 50 },
        legend: { x: 0.05, y: 0.95 }
    };
    
    Plotly.newPlot('search-dynamics-plot', traces, layout, {responsive: true});
}

// Main update function
export function updateAnalysisTab(selectedNodeId = null) {
    const analysisTab = document.getElementById('analysis');
    if (!analysisTab || !analysisTab.classList.contains('active')) {
        return; // Tab not visible, skip computation
    }
    
    if (!window.treeData || window.treeData.length === 0) {
        // Don't destroy the HTML structure - just show message in first plot
        const codeBloatPlot = document.getElementById('code-bloat-plot');
        if (codeBloatPlot) {
            codeBloatPlot.innerHTML = '<p style="text-align: center; color: #999; margin-top: 50px;">No data available. Please load a database.</p>';
        }
        return;
    }
    
    try {
        // Compute all statistics
        const llmStats = computeLLMStats(window.treeData, selectedNodeId);
        const mutationStats = computeMutationStats(window.treeData, selectedNodeId);
        const noveltyLLMStats = computeNoveltyLLMStats(window.treeData, selectedNodeId);
        const noveltyMutationStats = computeNoveltyMutationStats(window.treeData, selectedNodeId);
        const resampleLLMStats = computeResampleLLMStats(window.treeData, selectedNodeId);
        const resampleMutationStats = computeResampleMutationStats(window.treeData, selectedNodeId);
        const lineageStats = computeLineageStats(window.treeData, selectedNodeId);
        const bloatStats = computeCodeBloatStats(window.treeData, selectedNodeId);
        const mutationSizeStats = computeMutationSizeStats(window.treeData, selectedNodeId);
        const correctnessRateStats = computeCorrectnessRateStats(window.treeData, selectedNodeId);
        const improvementRateStats = computeImprovementRateStats(window.treeData, selectedNodeId);
        const costStats = computeCostStats(window.treeData, selectedNodeId);
        
        // Render all visualizations with individual error handling
        try { renderCodeBloatPlot(bloatStats, selectedNodeId); } catch (e) { console.error('Error rendering code bloat plot:', e); }
        try { renderMutationSizePlot(mutationSizeStats, selectedNodeId); } catch (e) { console.error('Error rendering mutation size plot:', e); }
        try { renderCorrectnessRatePlot(correctnessRateStats, selectedNodeId); } catch (e) { console.error('Error rendering correctness rate plot:', e); }
        try { renderImprovementRatePlot(improvementRateStats, selectedNodeId); } catch (e) { console.error('Error rendering improvement rate plot:', e); }
        try { renderNoveltyLLMPerformancePlot(noveltyLLMStats, selectedNodeId); } catch (e) { console.error('Error rendering novelty LLM plot:', e); }
        try { renderNoveltyEffectivenessPlot(noveltyMutationStats, selectedNodeId); } catch (e) { console.error('Error rendering novelty effectiveness plot:', e); }
        try { renderResampleLLMPerformancePlot(resampleLLMStats, selectedNodeId); } catch (e) { console.error('Error rendering resample LLM plot:', e); }
        try { renderResampleEffectivenessPlot(resampleMutationStats, selectedNodeId); } catch (e) { console.error('Error rendering resample effectiveness plot:', e); }
        try { renderLLMPerformancePlot(llmStats, selectedNodeId); } catch (e) { console.error('Error rendering LLM performance plot:', e); }
        try { renderLLMImprovementPlot(llmStats, selectedNodeId); } catch (e) { console.error('Error rendering LLM improvement plot:', e); }
        try { renderMutationEffectivenessPlot(mutationStats, selectedNodeId); } catch (e) { console.error('Error rendering mutation effectiveness plot:', e); }
        try { renderMutationImprovementPlot(mutationStats, selectedNodeId); } catch (e) { console.error('Error rendering mutation improvement plot:', e); }
        try { renderModelPatchCostHeatmap(costStats, selectedNodeId); } catch (e) { console.error('Error rendering model/patch cost heatmap:', e); }
        try { renderGenerationAvgCostPlot(costStats, selectedNodeId); } catch (e) { console.error('Error rendering generation avg cost plot:', e); }
        try { renderLineageFertilityPlot(lineageStats, selectedNodeId); } catch (e) { console.error('Error rendering lineage fertility plot:', e); }
    } catch (error) {
        console.error('Error updating analysis tab:', error);
        // Show error but preserve the DOM structure
        const analysisContent = document.getElementById('analysis-content');
        if (analysisContent && analysisContent.children.length > 0) {
            const errorDiv = document.createElement('div');
            errorDiv.style.cssText = 'text-align: center; color: #e74c3c; margin: 20px; padding: 10px; background: #ffe6e6; border-radius: 5px;';
            errorDiv.innerHTML = `<strong>Error computing analysis statistics:</strong> ${error.message}`;
            analysisContent.insertBefore(errorDiv, analysisContent.firstChild);
        }
    }
}
