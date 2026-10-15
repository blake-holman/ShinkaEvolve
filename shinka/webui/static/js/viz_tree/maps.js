// MAPs tab: MAP-Elites style grids.
import { formatScore } from './format.js';
import { selectNodeById } from './selection.js';
import { getNestedValue } from './pareto.js';

// --- MAPs (MAP-Elites) Visualization ---
let mapsListenersAdded = false;

// Extended metric discovery for MAPs - includes deeply nested metrics
function getMAPsAvailableMetrics(data) {
    if (!data || data.length === 0) return [];
    const metricsMap = new Map();

    const addMetric = (path, customName = null) => {
        if (metricsMap.has(path)) return;
        
        // Check if at least one data point has this metric
        const hasValue = data.some(p => {
            const val = getNestedValue(p, path);
            return typeof val === 'number' && !isNaN(val);
        });
        if (!hasValue) return;
        
        let name = customName;
        if (!name) {
            name = path.split('.').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            name = name.replace(/_/g, ' ');
            if (path.startsWith('public_metrics')) name = `Public: ${path.split('.')[1]}`;
            if (path.startsWith('private_metrics')) name = `Private: ${path.split('.')[1]}`;
            if (path.startsWith('metadata.code_analysis_metrics')) name = `Code: ${path.split('.').pop().replace(/_/g, ' ')}`;
            if (path.startsWith('metadata.diff_summary')) name = `Diff: ${path.split('.').pop().replace(/_/g, ' ')}`;
        }
        
        let objective = 'max';
        const key = path.split('.').pop();
        if (key.includes('cost') || key.includes('time') || key.includes('complexity') || key.includes('latency') || key.includes('deleted') || key.includes('lines_of_code')) {
            objective = 'min';
        }
        metricsMap.set(path, { name, path, objective });
    };

    const discoverInObject = (subObj, prefix, depth = 0) => {
        if (!subObj || depth > 3) return;
        for (const key in subObj) {
            const fullPath = `${prefix}.${key}`;
            if (typeof subObj[key] === 'number') {
                addMetric(fullPath);
            } else if (typeof subObj[key] === 'object' && subObj[key] !== null && !Array.isArray(subObj[key])) {
                discoverInObject(subObj[key], fullPath, depth + 1);
            }
        }
    };

    // Core metrics
    addMetric('combined_score', 'Combined Score');
    addMetric('complexity', 'Complexity');
    addMetric('generation', 'Generation');
    
    // Discover from data
    data.forEach(p => {
        // Metadata level metrics
        if (p.metadata) {
            addMetric('metadata.compute_time', 'Compute Time');
            addMetric('metadata.api_costs', 'API Costs');
            
            // Code analysis metrics (deeply nested)
            if (p.metadata.code_analysis_metrics) {
                discoverInObject(p.metadata.code_analysis_metrics, 'metadata.code_analysis_metrics');
            }
            
            // Diff summary metrics
            if (p.metadata.diff_summary) {
                discoverInObject(p.metadata.diff_summary, 'metadata.diff_summary');
            }
        }
        
        // Public/Private metrics
        discoverInObject(p.public_metrics, 'public_metrics');
        discoverInObject(p.private_metrics, 'private_metrics');
    });
    
    return Array.from(metricsMap.values());
}

export function createMAPsVisualization(data) {
    console.log("[DEBUG] Creating MAPs visualization");
    
    // Check if the MAPs tab is visible
    const mapsView = document.getElementById('maps-view');
    if (!mapsView || !mapsView.classList.contains('active')) {
        console.log("[DEBUG] MAPs view not active, skipping visualization creation");
        return;
    }

    const container = d3.select("#maps-container");
    container.html(""); // Clear previous content

    if (!data || data.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("No data to visualize.");
        return;
    }

    // Setup controls and listeners (only once)
    if (!mapsListenersAdded) {
        // Get base metrics from Pareto and add additional nested metrics for MAPs
        const availableMetrics = getMAPsAvailableMetrics(data);
        const xSelect = document.getElementById('maps-x-axis');
        const ySelect = document.getElementById('maps-y-axis');
        const binsSlider = document.getElementById('maps-bins-slider');
        const binsValue = document.getElementById('maps-bins-value');
        
        // Populate dropdowns
        xSelect.innerHTML = '';
        ySelect.innerHTML = '';
        availableMetrics.forEach(metric => {
            const optionX = document.createElement('option');
            optionX.value = metric.path;
            optionX.textContent = metric.name;
            xSelect.appendChild(optionX);
            
            const optionY = document.createElement('option');
            optionY.value = metric.path;
            optionY.textContent = metric.name;
            ySelect.appendChild(optionY);
        });

        // Set defaults
        const locMetric = availableMetrics.find(m => m.path === 'metadata.code_analysis_metrics.lines_of_code');
        const computeTimeMetric = availableMetrics.find(m => m.path === 'metadata.compute_time');
        
        if (locMetric) {
            xSelect.value = 'metadata.code_analysis_metrics.lines_of_code';
        } else if (availableMetrics.length > 0) {
            xSelect.value = availableMetrics[0].path;
        }
        
        if (computeTimeMetric) {
            ySelect.value = 'metadata.compute_time';
        } else if (availableMetrics.length > 1) {
            ySelect.value = availableMetrics[1].path;
        } else if (availableMetrics.length > 0) {
            ySelect.value = availableMetrics[0].path;
        }

        // Add event listeners
        xSelect.addEventListener('change', () => createMAPsVisualization(window.treeData));
        ySelect.addEventListener('change', () => createMAPsVisualization(window.treeData));
        binsSlider.addEventListener('input', () => {
            binsValue.textContent = binsSlider.value;
            createMAPsVisualization(window.treeData);
        });
        
        // Color range listeners
        const vminInput = document.getElementById('maps-vmin');
        const vmaxInput = document.getElementById('maps-vmax');
        vminInput.addEventListener('change', () => createMAPsVisualization(window.treeData));
        vmaxInput.addEventListener('change', () => createMAPsVisualization(window.treeData));
        
        // Generation slider listener
        const genSlider = document.getElementById('maps-gen-slider');
        const genValue = document.getElementById('maps-gen-value');
        genSlider.addEventListener('input', () => {
            const maxGen = parseInt(genSlider.max, 10);
            const currentGen = parseInt(genSlider.value, 10);
            genValue.textContent = currentGen >= maxGen ? 'All' : `≤${currentGen}`;
            createMAPsVisualization(window.treeData);
        });
        
        mapsListenersAdded = true;
        
        // Set generation slider to max on first load
        window.mapsGenSliderInitialized = false;
    }
    
    // Update generation slider max based on data
    const maxGeneration = d3.max(data, d => d.generation) || 0;
    const genSlider = document.getElementById('maps-gen-slider');
    const genValue = document.getElementById('maps-gen-value');
    genSlider.max = maxGeneration;
    
    // On first initialization or if slider is at/beyond max, set to max
    if (!window.mapsGenSliderInitialized || parseInt(genSlider.value, 10) >= maxGeneration) {
        genSlider.value = maxGeneration;
        genValue.textContent = 'All';
        window.mapsGenSliderInitialized = true;
    }

    // Get current settings
    const xPath = document.getElementById('maps-x-axis').value;
    const yPath = document.getElementById('maps-y-axis').value;
    const numBins = parseInt(document.getElementById('maps-bins-slider').value, 10);
    const selectedGen = parseInt(genSlider.value, 10);
    const filterByGen = selectedGen < maxGeneration;

    if (!xPath || !yPath) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("Please select axes.");
        return;
    }

    // Filter to correct programs only (and optionally by generation)
    let correctPrograms = data.filter(d => d.correct);
    if (filterByGen) {
        correctPrograms = correctPrograms.filter(d => d.generation <= selectedGen);
    }
    if (correctPrograms.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("No correct programs found.");
        return;
    }

    // Extract valid programs with both X and Y values
    const validPrograms = correctPrograms.filter(d => {
        const xVal = getNestedValue(d, xPath);
        const yVal = getNestedValue(d, yPath);
        return typeof xVal === 'number' && !isNaN(xVal) && typeof yVal === 'number' && !isNaN(yVal);
    }).map(d => ({
        ...d,
        xVal: getNestedValue(d, xPath),
        yVal: getNestedValue(d, yPath)
    }));

    if (validPrograms.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("No programs with valid values for selected axes.");
        return;
    }

    // Compute min/max for each axis
    const xMin = d3.min(validPrograms, d => d.xVal);
    const xMax = d3.max(validPrograms, d => d.xVal);
    const yMin = d3.min(validPrograms, d => d.yVal);
    const yMax = d3.max(validPrograms, d => d.yVal);

    // Create bins
    const xBinSize = (xMax - xMin) / numBins || 1;
    const yBinSize = (yMax - yMin) / numBins || 1;

    // Assign each program to a cell and keep best per cell
    const cellMap = new Map(); // key: "xBin,yBin", value: best program
    
    validPrograms.forEach(prog => {
        let xBin = Math.floor((prog.xVal - xMin) / xBinSize);
        let yBin = Math.floor((prog.yVal - yMin) / yBinSize);
        
        // Clamp to valid range
        xBin = Math.min(xBin, numBins - 1);
        yBin = Math.min(yBin, numBins - 1);
        
        const key = `${xBin},${yBin}`;
        const existing = cellMap.get(key);
        
        if (!existing || (prog.combined_score !== null && prog.combined_score > (existing.combined_score || -Infinity))) {
            cellMap.set(key, { ...prog, xBin, yBin });
        }
    });

    // Get score range for color scale
    const scores = Array.from(cellMap.values()).map(d => d.combined_score).filter(s => s !== null && !isNaN(s));
    const autoScoreMin = d3.min(scores) || 0;
    const autoScoreMax = d3.max(scores) || 1;
    
    // Check for user-specified vmin/vmax
    const vminInput = document.getElementById('maps-vmin');
    const vmaxInput = document.getElementById('maps-vmax');
    const vminVal = vminInput.value !== '' ? parseFloat(vminInput.value) : null;
    const vmaxVal = vmaxInput.value !== '' ? parseFloat(vmaxInput.value) : null;
    
    const scoreMin = (vminVal !== null && !isNaN(vminVal)) ? vminVal : autoScoreMin;
    const scoreMax = (vmaxVal !== null && !isNaN(vmaxVal)) ? vmaxVal : autoScoreMax;

    // Create color scale (viridis)
    const colorScale = d3.scaleSequential(d3.interpolateViridis)
        .domain([scoreMin, scoreMax]);

    // Setup SVG dimensions
    const margin = { top: 40, right: 120, bottom: 80, left: 80 };
    const containerNode = container.node();
    const containerWidth = containerNode.clientWidth || 600;
    const containerHeight = containerNode.clientHeight || 500;
    const width = Math.max(300, containerWidth - margin.left - margin.right - 40);
    const height = Math.max(300, containerHeight - margin.top - margin.bottom - 40);
    const cellWidth = width / numBins;
    const cellHeight = height / numBins;

    // Create SVG
    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Create tooltip
    const tooltip = container.append("div")
        .attr("class", "maps-tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("background-color", "rgba(0,0,0,0.8)")
        .style("color", "white")
        .style("padding", "10px")
        .style("border-radius", "5px")
        .style("font-size", "12px")
        .style("max-width", "300px")
        .style("z-index", "1000")
        .style("pointer-events", "none");

    // Draw grid cells
    for (let xi = 0; xi < numBins; xi++) {
        for (let yi = 0; yi < numBins; yi++) {
            const key = `${xi},${yi}`;
            const cellData = cellMap.get(key);
            
            const xStart = xMin + xi * xBinSize;
            const xEnd = xMin + (xi + 1) * xBinSize;
            const yStart = yMin + yi * yBinSize;
            const yEnd = yMin + (yi + 1) * yBinSize;
            
            const rect = svg.append("rect")
                .attr("class", cellData ? "maps-cell" : "maps-cell empty")
                .attr("x", xi * cellWidth)
                .attr("y", height - (yi + 1) * cellHeight) // Flip Y axis
                .attr("width", cellWidth)
                .attr("height", cellHeight)
                .attr("fill", cellData ? colorScale(cellData.combined_score) : "#f0f0f0")
                .attr("stroke", "#fff")
                .attr("stroke-width", 1);
            
            if (cellData) {
                rect.style("cursor", "pointer")
                    .on("mouseover", function(event) {
                        d3.select(this).attr("stroke", "#333").attr("stroke-width", 2);
                        const xLabel = xPath.split('.').pop().replace(/_/g, ' ');
                        const yLabel = yPath.split('.').pop().replace(/_/g, ' ');
                        tooltip.html(`
                            <strong>${cellData.metadata?.patch_name || 'Unnamed'}</strong><br>
                            <strong>Score:</strong> ${formatScore(cellData.combined_score)}<br>
                            <strong>${xLabel}:</strong> ${xStart.toFixed(2)} - ${xEnd.toFixed(2)}<br>
                            <strong>${yLabel}:</strong> ${yStart.toFixed(2)} - ${yEnd.toFixed(2)}<br>
                            <strong>Generation:</strong> ${cellData.generation}
                        `)
                        .style("visibility", "visible");
                    })
                    .on("mousemove", function(event) {
                        tooltip.style("top", (event.pageY - containerNode.getBoundingClientRect().top - window.scrollY + 10) + "px")
                               .style("left", (event.pageX - containerNode.getBoundingClientRect().left - window.scrollX + 10) + "px");
                    })
                    .on("mouseout", function() {
                        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 1);
                        tooltip.style("visibility", "hidden");
                    })
                    .on("click", function() {
                        selectNodeById(cellData.id, false, false);
                    });
            }
        }
    }

    // Create X axis
    const xScale = d3.scaleLinear().domain([xMin, xMax]).range([0, width]);
    const xAxis = d3.axisBottom(xScale).ticks(5);
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(xAxis);
    
    // X axis label
    const xLabel = xPath.split('.').pop().replace(/_/g, ' ');
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", height + 45)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text(xLabel);

    // Create Y axis
    const yScale = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]);
    const yAxis = d3.axisLeft(yScale).ticks(5);
    svg.append("g")
        .call(yAxis);
    
    // Y axis label
    const yLabel = yPath.split('.').pop().replace(/_/g, ' ');
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -55)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text(yLabel);

    // Add title
    svg.append("text")
        .attr("x", width / 2)
        .attr("y", -15)
        .attr("text-anchor", "middle")
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .text(`MAP-Elites Grid (${cellMap.size} elite${cellMap.size !== 1 ? 's' : ''} from ${validPrograms.length} correct programs${filterByGen ? `, gen ≤${selectedGen}` : ''})`);

    // Add color legend
    const legendWidth = 20;
    const legendHeight = height;
    const legendX = width + 20;
    
    // Create gradient
    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "maps-color-gradient")
        .attr("x1", "0%")
        .attr("y1", "100%")
        .attr("x2", "0%")
        .attr("y2", "0%");
    
    const numStops = 10;
    for (let i = 0; i <= numStops; i++) {
        const t = i / numStops;
        gradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", colorScale(scoreMin + t * (scoreMax - scoreMin)));
    }
    
    // Draw legend rectangle
    svg.append("rect")
        .attr("x", legendX)
        .attr("y", 0)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", "url(#maps-color-gradient)");
    
    // Legend axis
    const legendScale = d3.scaleLinear().domain([scoreMin, scoreMax]).range([legendHeight, 0]);
    const legendAxis = d3.axisRight(legendScale).ticks(5);
    svg.append("g")
        .attr("transform", `translate(${legendX + legendWidth}, 0)`)
        .call(legendAxis);
    
    // Legend label
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -legendHeight / 2)
        .attr("y", legendX + legendWidth + 45)
        .attr("text-anchor", "middle")
        .style("font-size", "11px")
        .text("Combined Score");

    console.log(`[DEBUG] MAPs visualization created with ${cellMap.size} cells`);
}
