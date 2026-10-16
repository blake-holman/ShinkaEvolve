// Pareto tab.
import { formatScore } from './format.js';
import { selectNodeById } from './selection.js';

// --- Pareto Front Visualization ---

export function getNestedValue(obj, path) {
    if (!path) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || typeof current === 'undefined') return undefined;
        current = current[part];
    }
    return current;
}

function getAvailableParetoMetrics(data) {
    if (!data || data.length === 0) return [];
    const metricsMap = new Map();

    const addMetric = (programObj, path) => {
        const value = getNestedValue(programObj, path);
        if (typeof value === 'number' && !metricsMap.has(path)) {
            let name = path.split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            name = name.replace(/_/g, ' ');
            if (path.startsWith('public_metrics')) name = `Public: ${path.split('.')[1]}`;
            if (path.startsWith('private_metrics')) name = `Private: ${path.split('.')[1]}`;
            
            let objective = 'max';
            const key = path.split('.').pop();
            if (key.includes('cost') || key.includes('time') || key.includes('complexity') || key.includes('latency')) {
                objective = 'min';
            }
            metricsMap.set(path, { name, path, objective });
        }
    };

    const discoverInObject = (programObj, subObj, prefix) => {
        if (!subObj) return;
        for (const key in subObj) {
            if (typeof subObj[key] === 'number') {
                addMetric(programObj, `${prefix}.${key}`);
            }
        }
    };

    data.forEach(p => {
        addMetric(p, 'combined_score');
        addMetric(p, 'complexity');
        if (p.metadata) addMetric(p, 'metadata.compute_time');
        discoverInObject(p, p.public_metrics, 'public_metrics');
        discoverInObject(p, p.private_metrics, 'private_metrics');
    });
    return Array.from(metricsMap.values());
}

function calculateParetoFront(data, xMetric, yMetric) {
    const allPoints = data.map(p => {
        const x = getNestedValue(p, xMetric.path);
        const y = getNestedValue(p, yMetric.path);
        if (typeof x === 'number' && typeof y === 'number') {
            return { x, y, point: p };
        }
        return null;
    }).filter(p => p !== null);

    const correctPoints = allPoints.filter(p => p.point.correct);

    const paretoPoints = correctPoints.filter(p1 => {
        return !correctPoints.some(p2 => { // Only check against other correct points
            if (p1 === p2) return false;
            const x_p2_better = xMetric.objective === 'min' ? p2.x < p1.x : p2.x > p1.x;
            const y_p2_better = yMetric.objective === 'min' ? p2.y < p1.y : p2.y > p1.y;
            const x_equal = p2.x === p1.x;
            const y_equal = p2.y === p1.y;

            if ((x_p2_better && (y_p2_better || y_equal)) || (y_p2_better && (x_p2_better || x_equal))) {
                return true; // p2 dominates p1
            }
            return false;
        });
    });

    return { allPoints, paretoPoints };
}

// Helper function to build hover text showing only the active X and Y axis metrics
function buildActiveMetricsHoverText(point, xMetric, yMetric) {
    let hoverText = `<b>${point.metadata.patch_name || 'unnamed'}</b><br>`;
    hoverText += `Combined Score: ${formatScore(point.combined_score)}<br>`;
    
    // Show X-axis metric
    const xValue = getNestedValue(point, xMetric.path);
    if (xValue !== undefined) {
        hoverText += `${xMetric.name}: ${formatScore(xValue)}<br>`;
    }
    
    // Show Y-axis metric
    const yValue = getNestedValue(point, yMetric.path);
    if (yValue !== undefined) {
        hoverText += `${yMetric.name}: ${formatScore(yValue)}<br>`;
    }
    
    return hoverText;
}

function createParetoPlot(plotData, xMetric, yMetric) {
    const { allPoints, paretoPoints } = plotData;

    const incorrectPoints = allPoints.filter(p => !p.point.correct);
    const correctDominatedPoints = allPoints.filter(p => p.point.correct && !paretoPoints.includes(p));

    const traceDominated = {
        x: correctDominatedPoints.map(p => p.x),
        y: correctDominatedPoints.map(p => p.y),
        mode: 'markers',
        type: 'scatter',
        name: 'Dominated',
        text: correctDominatedPoints.map(p => buildActiveMetricsHoverText(p.point, xMetric, yMetric)),
        hoverinfo: 'text',
        marker: { color: 'rgba(150, 150, 150, 0.5)', size: 8 },
        customdata: correctDominatedPoints.map(p => p.point.id)
    };

    const traceIncorrect = {
        x: incorrectPoints.map(p => p.x),
        y: incorrectPoints.map(p => p.y),
        mode: 'markers',
        type: 'scatter',
        name: 'Incorrect',
        text: incorrectPoints.map(p => buildActiveMetricsHoverText(p.point, xMetric, yMetric)),
        hoverinfo: 'text',
        marker: { color: '#e74c3c', size: 8, symbol: 'x' },
        customdata: incorrectPoints.map(p => p.point.id)
    };
    
    const tracePareto = {
        x: paretoPoints.map(p => p.x),
        y: paretoPoints.map(p => p.y),
        mode: 'markers',
        type: 'scatter',
        name: 'Pareto Optimal',
        text: paretoPoints.map(p => buildActiveMetricsHoverText(p.point, xMetric, yMetric)),
        hoverinfo: 'text',
        marker: { color: '#e58e26', size: 12, symbol: 'diamond' },
        customdata: paretoPoints.map(p => p.point.id)
    };

    const sortedPareto = [...paretoPoints].sort((a,b) => a.x - b.x);

    // Calculate bounds based only on correct programs (for both fill area and axis ranges)
    const correctPointsForBounds = [...paretoPoints, ...correctDominatedPoints];
    const correctX = correctPointsForBounds.map(p => p.x);
    const correctY = correctPointsForBounds.map(p => p.y);
    const xRange = Math.max(...correctX) - Math.min(...correctX);
    const yRange = Math.max(...correctY) - Math.min(...correctY);

    const hullTrace = {
        x: sortedPareto.map(p => p.x),
        y: sortedPareto.map(p => p.y),
        mode: 'lines',
        type: 'scatter',
        name: 'Pareto Boundary',
        line: {
            color: '#e58e26',
            width: 2,
            shape: 'linear'
        },
        marker: {
            size: 0  // Ensure no markers are shown for the line
        },
        hoverinfo: 'none',
        showlegend: false  // Hide from legend since we already have Pareto Optimal points
    };

    let fillTrace = null;
    if (sortedPareto.length > 0) {
        const boundaryX = [];
        const boundaryY = [];

        if (xMetric.objective === 'min') { // Reversed x-axis means points are sorted descending visually
            sortedPareto.forEach((p, i) => {
                if (i > 0) {
                    const prevP = sortedPareto[i-1];
                    boundaryX.push(prevP.x);
                    boundaryY.push(p.y);
                }
                boundaryX.push(p.x);
                boundaryY.push(p.y);
            });
        } else { // Normal x-axis
            sortedPareto.forEach((p, i) => {
                if (i > 0) {
                    const prevP = sortedPareto[i-1];
                    boundaryX.push(p.x);
                    boundaryY.push(prevP.y);
                }
                boundaryX.push(p.x);
                boundaryY.push(p.y);
            });
        }
        
        // Determine the dominated region boundary based on both axis objectives
        // The dominated region is always "worse" than the Pareto front
        let edgeY, edgeX;
        
        if (yMetric.objective === 'max') {
            // Y-axis: higher is better, so dominated region is below
            edgeY = Math.min(...correctY) - 0.05 * yRange;
        } else {
            // Y-axis: lower is better, so dominated region is above
            edgeY = Math.max(...correctY) + 0.05 * yRange;
        }
        
        if (xMetric.objective === 'max') {
            // X-axis: higher is better, so dominated region is to the left
            edgeX = Math.min(...correctX) - 0.05 * xRange;
        } else {
            // X-axis: lower is better, so dominated region is to the right
            edgeX = Math.max(...correctX) + 0.05 * xRange;
        }
        
        // Create fill area below the Pareto line (connecting Pareto points directly)
        const x_fill = [];
        const y_fill = [];
        
        // Use the sorted Pareto points directly (not the step-wise boundary)
        const paretoX = sortedPareto.map(p => p.x);
        const paretoY = sortedPareto.map(p => p.y);
        
        // Determine which direction extends into the dominated region
        const extendRight = xMetric.objective === 'min';  // min x means worse is to the right
        const extendUp = yMetric.objective === 'min';     // min y means worse is above
        
        if (extendRight && !extendUp) {
            // Dominated region is bottom-right (higher x, lower y)
            // Start from left edge at the y-level of the first Pareto point
            x_fill.push(Math.min(...correctX) );
            y_fill.push(paretoY[0]);
            
            // Follow the Pareto points (straight line connections)
            for (let i = 0; i < paretoX.length; i++) {
                x_fill.push(paretoX[i]);
                y_fill.push(paretoY[i]);
            }
            
            // Extend to the bottom-right corner
            x_fill.push(Math.max(...correctX));
            y_fill.push(paretoY[paretoY.length - 1]);
            
            // Go to bottom edge
            x_fill.push(Math.max(...correctX));
            y_fill.push(Math.min(...correctY));
            
            // Go to left edge at bottom
            x_fill.push(Math.min(...correctX));
            y_fill.push(Math.min(...correctY));
            
        } else if (!extendRight && !extendUp) {
            // Dominated region is bottom-left (lower x, lower y)
            // Start from right edge at the y-level of the last Pareto point
            x_fill.push(Math.max(...correctX) + 0.05 * xRange);
            y_fill.push(paretoY[paretoY.length - 1]);
            
            // Follow the Pareto points in reverse (straight line connections)
            for (let i = paretoX.length - 1; i >= 0; i--) {
                x_fill.push(paretoX[i]);
                y_fill.push(paretoY[i]);
            }
            
            // Extend to the bottom-left corner
            x_fill.push(Math.min(...correctX) - 0.05 * xRange);
            y_fill.push(paretoY[0]);
            
            // Go to bottom edge
            x_fill.push(Math.min(...correctX) - 0.05 * xRange);
            y_fill.push(Math.min(...correctY) - 0.05 * yRange);
            
            // Go to right edge at bottom
            x_fill.push(Math.max(...correctX) + 0.05 * xRange);
            y_fill.push(Math.min(...correctY) - 0.05 * yRange);
            
        } else if (extendRight && extendUp) {
            // Dominated region is top-right (higher x, higher y)
            // Start from left edge at the y-level of the first Pareto point
            x_fill.push(Math.min(...correctX) - 0.05 * xRange);
            y_fill.push(paretoY[0]);
            
            // Follow the Pareto points (straight line connections)
            for (let i = 0; i < paretoX.length; i++) {
                x_fill.push(paretoX[i]);
                y_fill.push(paretoY[i]);
            }
            
            // Extend to the top-right corner
            x_fill.push(Math.max(...correctX) + 0.05 * xRange);
            y_fill.push(paretoY[paretoY.length - 1]);
            
            // Go to top edge
            x_fill.push(Math.max(...correctX) + 0.05 * xRange);
            y_fill.push(Math.max(...correctY) + 0.05 * yRange);
            
            // Go to left edge at top
            x_fill.push(Math.min(...correctX) - 0.05 * xRange);
            y_fill.push(Math.max(...correctY) + 0.05 * yRange);
            
        } else {
            // Dominated region is top-left (lower x, higher y)
            // Start from right edge at the y-level of the last Pareto point
            x_fill.push(Math.max(...correctX) + 0.05 * xRange);
            y_fill.push(paretoY[paretoY.length - 1]);
            
            // Follow the Pareto points in reverse (straight line connections)
            for (let i = paretoX.length - 1; i >= 0; i--) {
                x_fill.push(paretoX[i]);
                y_fill.push(paretoY[i]);
            }
            
            // Extend to the top-left corner
            x_fill.push(Math.min(...correctX) - 0.05 * xRange);
            y_fill.push(paretoY[0]);
            
            // Go to top edge
            x_fill.push(Math.min(...correctX) - 0.05 * xRange);
            y_fill.push(Math.max(...correctY) + 0.05 * yRange);
            
            // Go to right edge at top
            x_fill.push(Math.max(...correctX) + 0.05 * xRange);
            y_fill.push(Math.max(...correctY) + 0.05 * yRange);
        }

        fillTrace = {
            x: x_fill,
            y: y_fill,
            fill: 'toself',
            fillcolor: 'rgba(231, 76, 60, 0.15)',
            line: { width: 0 },
            mode: 'none',
            type: 'scatter',
            hoverinfo: 'none',
            showlegend: false,
            name: 'Dominated Region'
        };
    }

    const plotTraces = [];
    if (fillTrace) {
        plotTraces.push(fillTrace);
    }
    plotTraces.push(traceDominated, traceIncorrect, tracePareto, hullTrace);

    // Calculate axis ranges based on correct programs (variables already calculated above)
    const xPadding = xRange * 0.1; // 10% padding
    const yPadding = yRange * 0.1; // 10% padding
    
    const layout = {
        title: 'Pareto Front of ShinkaEvolve Programs',
        xaxis: { 
            title: `${xMetric.name} (${xMetric.objective === 'min' ? 'Lower' : 'Higher'} is better →)`,
            range: [Math.min(...correctX) - xPadding, Math.max(...correctX) + xPadding],
            autorange: false
        },
        yaxis: { 
            title: `${yMetric.name} (${yMetric.objective === 'min' ? 'Lower' : 'Higher'} is better ↑)`,
            range: [Math.min(...correctY) - yPadding, Math.max(...correctY) + yPadding],
            autorange: false
        },
        hovermode: 'closest',
        showlegend: true
    };
    
    // Apply axis direction after setting ranges
    if (xMetric.objective === 'min') {
        layout.xaxis.autorange = 'reversed';
        delete layout.xaxis.range;
    }
    if (yMetric.objective === 'min') {
        layout.yaxis.autorange = 'reversed';
        delete layout.yaxis.range;
    }

    Plotly.newPlot('pareto-plot', plotTraces, layout, {responsive: true});

    document.getElementById('pareto-plot').on('plotly_click', function(data) {
        if (data.points.length > 0) {
            selectNodeById(data.points[0].customdata);
        }
    });
}

let availableParetoMetrics = [];
export let paretoListenersAdded = false;
export function updateParetoView() {
    if (!window.treeData) return;

    if (!paretoListenersAdded) {
        availableParetoMetrics = getAvailableParetoMetrics(window.treeData);
        const ySelect = document.getElementById('pareto-y-axis');
        const xSelect = document.getElementById('pareto-x-axis');
        
        availableParetoMetrics.forEach(metric => {
            const option = document.createElement('option');
            option.value = metric.path;
            option.textContent = metric.name;
            ySelect.appendChild(option.cloneNode(true));
            xSelect.appendChild(option.cloneNode(true));
        });

        // Set defaults
        ySelect.value = 'combined_score';
        const computeTimeMetric = availableParetoMetrics.find(m => m.path === 'metadata.compute_time');
        if (computeTimeMetric) {
            xSelect.value = 'metadata.compute_time';
        } else {
            const complexityMetric = availableParetoMetrics.find(m => m.path === 'complexity');
            if (complexityMetric) xSelect.value = 'complexity';
        }

        const updateObjectiveSelect = (axisSelectId) => {
            const objectiveSelectId = axisSelectId.replace('-axis', '-objective');
            const objectiveSelect = document.getElementById(objectiveSelectId);
            const axisSelect = document.getElementById(axisSelectId);
            const metric = availableParetoMetrics.find(m => m.path === axisSelect.value);
            if (metric) {
                objectiveSelect.value = metric.objective;
            }
        };

        updateObjectiveSelect('pareto-y-axis');
        updateObjectiveSelect('pareto-x-axis');

        document.querySelectorAll('.pareto-axis-select').forEach(sel => sel.addEventListener('change', () => {
            updateObjectiveSelect(sel.id);
            updateParetoView();
        }));
        document.querySelectorAll('.pareto-objective-select').forEach(sel => sel.addEventListener('change', updateParetoView));
        paretoListenersAdded = true;
    }
    
    const yPath = document.getElementById('pareto-y-axis').value;
    const xPath = document.getElementById('pareto-x-axis').value;
    const yObjective = document.getElementById('pareto-y-objective').value;
    const xObjective = document.getElementById('pareto-x-objective').value;

    const yMetric = { ...availableParetoMetrics.find(m => m.path === yPath), objective: yObjective };
    const xMetric = { ...availableParetoMetrics.find(m => m.path === xPath), objective: xObjective };

    if (!yMetric || !xMetric) return;

    const paretoData = calculateParetoFront(window.treeData, xMetric, yMetric);
    createParetoPlot(paretoData, xMetric, yMetric);
}

export function setParetoListenersAdded(value) {
    paretoListenersAdded = value;
}
