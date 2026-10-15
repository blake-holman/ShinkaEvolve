// Metrics tab.
import { debug } from '../log.js';
import { selectNodeById } from './selection.js';
import { getNestedValue } from './pareto.js';

export function createMetricsVisualization(data) {
    debug("[DEBUG] Creating metrics visualization with", data ? data.length : 0, "data points");
    
    const metricsContainer = document.getElementById('metrics-plots');
    if (!metricsContainer) {
        debug("[DEBUG] Metrics plots container not found");
        return;
    }
    
    metricsContainer.innerHTML = ''; // Clear previous plots
    debug("[DEBUG] Cleared metrics container");

    // Filter data to only include correct programs with scores
    const validData = data.filter(d => d.correct && d.combined_score !== null && !isNaN(d.combined_score));
    
    if (validData.length === 0) {
        metricsContainer.innerHTML = '<p>No valid programs with metrics found.</p>';
        return;
    }

    // Group data by generation
    const generationData = {};
    validData.forEach(d => {
        const gen = d.generation || 0;  // generation is a top-level field, not in metadata
        if (!generationData[gen]) {
            generationData[gen] = [];
        }
        generationData[gen].push(d);
    });

    const generations = Object.keys(generationData).map(Number).sort((a, b) => a - b);

    // Helper function to get nested value from object
    const getNestedValue = (obj, path) => {
        if (!path) return undefined;
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || typeof current === 'undefined') return undefined;
            current = current[part];
        }
        return current;
    };

    // Collect all available metrics
    const allMetrics = new Set();
    allMetrics.add('combined_score');
    
    validData.forEach(d => {
        if (d.public_metrics) {
            Object.keys(d.public_metrics).forEach(key => {
                if (typeof d.public_metrics[key] === 'number') {
                    allMetrics.add(`public_metrics.${key}`);
                }
            });
        }
        if (d.private_metrics) {
            Object.keys(d.private_metrics).forEach(key => {
                if (typeof d.private_metrics[key] === 'number') {
                    allMetrics.add(`private_metrics.${key}`);
                }
            });
        }
    });

    // Create plots in rows of 2
    const metricsArray = Array.from(allMetrics);
    for (let i = 0; i < metricsArray.length; i += 2) {
        // Create a row container
        const rowContainer = document.createElement('div');
        rowContainer.style.display = 'flex';
        rowContainer.style.gap = '15px';
        rowContainer.style.marginBottom = '20px';
        rowContainer.style.width = '100%';
        rowContainer.style.overflowX = 'auto';
        metricsContainer.appendChild(rowContainer);

        // Create up to 2 plots in this row
        const rowMetrics = metricsArray.slice(i, i + 2);
        rowMetrics.forEach((metricPath, rowIndex) => {
            const plotIndex = i + rowIndex;
                
                // Create wrapper container for plot + controls
                const wrapperContainer = document.createElement('div');
                wrapperContainer.style.width = '50%';
                wrapperContainer.style.minWidth = '400px';
                wrapperContainer.style.boxSizing = 'border-box';
                wrapperContainer.style.display = 'flex';
                wrapperContainer.style.flexDirection = 'column';
                rowContainer.appendChild(wrapperContainer);

                // Create controls container
                const controlsContainer = document.createElement('div');
                controlsContainer.style.display = 'flex';
                controlsContainer.style.justifyContent = 'center';
                controlsContainer.style.gap = '10px';
                controlsContainer.style.marginBottom = '10px';
                controlsContainer.style.padding = '5px';
                wrapperContainer.appendChild(controlsContainer);

                // Create toggle button
                const toggleButton = document.createElement('button');
                toggleButton.id = `toggle-btn-${plotIndex}`;
                toggleButton.textContent = 'Switch to Cumulative Max';
                toggleButton.style.padding = '5px 10px';
                toggleButton.style.fontSize = '12px';
                toggleButton.style.border = '1px solid #ddd';
                toggleButton.style.borderRadius = '4px';
                toggleButton.style.backgroundColor = '#f8f9fa';
                toggleButton.style.cursor = 'pointer';
                controlsContainer.appendChild(toggleButton);

                // Create plot container
            const plotContainer = document.createElement('div');
            plotContainer.id = `metric-plot-${plotIndex}`;
                plotContainer.style.height = '280px';
                plotContainer.style.width = '100%';
            plotContainer.style.boxSizing = 'border-box';
                wrapperContainer.appendChild(plotContainer);

            // Prepare individual data points for this metric
            const individualPoints = [];
            generations.forEach(gen => {
                const programs = generationData[gen];
                programs.forEach(p => {
                    const value = getNestedValue(p, metricPath);
                    if (value !== undefined && !isNaN(value)) {
                        individualPoints.push({
                            x: gen,
                            y: value,
                            id: p.id,
                            name: p.metadata?.patch_name || 'unnamed'
                        });
                    }
                });
            });

            if (individualPoints.length === 0) {
                plotContainer.innerHTML = `<p>No data available for metric: ${metricPath}</p>`;
                return;
            }

            // Create scatter trace with individual points
            const scatterTrace = {
                x: individualPoints.map(d => d.x),
                y: individualPoints.map(d => d.y),
                mode: 'markers',
                type: 'scatter',
                name: 'Programs',
                marker: { 
                    color: '#3498db', 
                    size: 8,
                    opacity: 0.7,
                    line: {
                        color: '#2980b9',
                        width: 1
                    }
                },
                customdata: individualPoints.map(d => ({ id: d.id, name: d.name })),
                text: individualPoints.map(d => `${d.name}<br>Gen: ${d.x}<br>Value: ${d.y.toFixed(4)}`),
                hoverinfo: 'text'
            };

            // Calculate generation-wise statistics for trend line
            const genStats = generations.map(gen => {
                const genPoints = individualPoints.filter(p => p.x === gen);
                if (genPoints.length === 0) return null;
                const values = genPoints.map(p => p.y);
                const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
                const max = Math.max(...values);
                const min = Math.min(...values);
                return { x: gen, mean, max, min };
            }).filter(d => d !== null);

            // Calculate cumulative max and min
            let cumulativeMax = -Infinity;
            let cumulativeMin = Infinity;
            const cumulativeStats = genStats.map(stat => {
                cumulativeMax = Math.max(cumulativeMax, stat.max);
                cumulativeMin = Math.min(cumulativeMin, stat.min);
                return {
                    x: stat.x,
                    cumulativeMax,
                    cumulativeMin,
                    max: stat.max,
                    min: stat.min
                };
            });

            // Add trend line for best performance (default: raw max)
            const trendTrace = {
                x: genStats.map(d => d.x),
                y: genStats.map(d => d.max),
                mode: 'lines+markers',
                type: 'scatter',
                name: 'Best',
                line: { color: '#e74c3c', width: 3 },
                marker: { size: 6 },
                hoverinfo: 'skip'
            };

            // Add cumulative min trace (default view)
            const cumulativeTrace = {
                x: cumulativeStats.map(d => d.x),
                y: cumulativeStats.map(d => d.cumulativeMin),
                mode: 'lines+markers',
                type: 'scatter',
                name: 'Cumulative Min',
                line: { color: '#27ae60', width: 2, dash: 'dot' },
                marker: { size: 4 },
                hoverinfo: 'skip'
            };

            // Determine metric name for display
            let metricDisplayName = metricPath;
            if (metricPath === 'combined_score') {
                metricDisplayName = 'Combined Score';
            } else if (metricPath.startsWith('public_metrics.')) {
                metricDisplayName = metricPath.split('.')[1];
            } else if (metricPath.startsWith('private_metrics.')) {
                metricDisplayName = metricPath.split('.')[1];
            }

            const layout = {
                title: {
                    text: metricDisplayName,
                    font: { size: 14 }
                },
                xaxis: { 
                    title: 'Generation',
                    type: 'linear'
                },
                yaxis: { title: 'Value' },
                margin: { t: 40, b: 50, l: 70, r: 20 },
                showlegend: true,
                legend: { 
                    x: 0.02, 
                    y: 0.98, 
                    bgcolor: 'rgba(255,255,255,0.8)',
                    font: { size: 8 }
                },
                paper_bgcolor: '#f8f9fa',
                plot_bgcolor: '#ffffff'
            };

            // Initial traces (raw scores + cumulative min)
            let currentTraces = [scatterTrace, trendTrace, cumulativeTrace];
            Plotly.newPlot(plotContainer.id, currentTraces, layout, { responsive: true });

            // Store data for toggle functionality
            plotContainer.cumulativeStats = cumulativeStats;
            plotContainer.currentMode = 'min'; // 'min' or 'max'

            // Add toggle button functionality
            toggleButton.addEventListener('click', function() {
                const isMin = plotContainer.currentMode === 'min';
                const newMode = isMin ? 'max' : 'min';
                
                // Update cumulative trace
                const newCumulativeTrace = {
                    x: cumulativeStats.map(d => d.x),
                    y: cumulativeStats.map(d => isMin ? d.cumulativeMax : d.cumulativeMin),
                    mode: 'lines+markers',
                    type: 'scatter',
                    name: isMin ? 'Cumulative Max' : 'Cumulative Min',
                    line: { color: isMin ? '#9b59b6' : '#27ae60', width: 2, dash: 'dot' },
                    marker: { size: 4 },
                    hoverinfo: 'skip'
                };

                // Update the plot
                const newTraces = [scatterTrace, trendTrace, newCumulativeTrace];
                Plotly.react(plotContainer.id, newTraces, layout);
                
                // Update button text and mode
                toggleButton.textContent = isMin ? 'Switch to Cumulative Min' : 'Switch to Cumulative Max';
                plotContainer.currentMode = newMode;
            });

            // Add click event listener
            document.getElementById(plotContainer.id).on('plotly_click', function(data) {
                if (data.points.length > 0 && data.points[0].customdata) {
                    const nodeId = data.points[0].customdata.id;
                    if (nodeId) {
                        // Select the node and switch to code view
                        selectNodeById(nodeId, false);
                        // Switch to the Node Code tab
                        const codeTab = document.querySelector('.tab[data-tab="agent-code"]');
                        if (codeTab) {
                            codeTab.click();
                        }
                    }
                }
            });
        });
    }
}
