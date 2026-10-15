// Islands tab.
import { debug } from '../log.js';
import { displayNodeDetails } from './nodeDetails.js';
import { escapeHtml, formatScore, isFailedProposalNode } from './format.js';

function createIslandProgressionCurves(container, programs, islands, yMinOverride = null, yMaxOverride = null) {
    debug("[DEBUG] Creating island progression curves for", islands.length, "islands");
    
    // Clean up any existing tooltips
    d3.selectAll(".island-curve-tooltip").remove();
    
    const containerWidth = container.node().getBoundingClientRect().width;
    const containerHeight = container.node().getBoundingClientRect().height;
    
    // Create SVG for curves
    const curvesSvg = container.append("svg")
        .attr("width", containerWidth)
        .attr("height", containerHeight)
        .style("background", "white");

    // Create tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "island-curve-tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("background", "rgba(0, 0, 0, 0.8)")
        .style("color", "white")
        .style("padding", "8px")
        .style("border-radius", "4px")
        .style("font-size", "12px")
        .style("pointer-events", "none")
        .style("z-index", "1000");

    const margin = { top: 45, right: 20, bottom: 30, left: 50 };
    const plotWidth = containerWidth - margin.left - margin.right;
    const plotHeight = containerHeight - margin.top - margin.bottom;

    const g = curvesSvg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Add title
    curvesSvg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 35)
        .attr("text-anchor", "middle")
        .style("font-size", "16px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .text("Performance Progression by Island");

    // Group programs by island and generation
    const islandData = {};
    islands.forEach(islandId => {
        islandData[islandId] = {};
    });

    programs.forEach(program => {
        const islandId = program.island_idx;
        const generation = program.generation || 0;
        const score = program.combined_score;
        
        if (islandId != null && score != null && !isNaN(score)) {
            if (!islandData[islandId][generation]) {
                islandData[islandId][generation] = [];
            }
            islandData[islandId][generation].push({
                score: score,
                program: program  // Keep reference to full program data
            });
        }
    });

    // Find all unique generations across all islands
    const allUniqueGenerations = new Set();
    programs.forEach(program => {
        const generation = program.generation || 0;
        allUniqueGenerations.add(generation);
    });
    const sortedGenerations = Array.from(allUniqueGenerations).sort((a,b) => a-b);

    // Calculate cumulative maximum score per generation for each island
    const islandCurves = {};
    const allScores = [];
    
    islands.forEach(islandId => {
        islandCurves[islandId] = [];
        let cumulativeMaxScore = -Infinity;
        let cumulativeMaxProgram = null;
        
        sortedGenerations.forEach(gen => {
            const programData = islandData[islandId][gen];
            let generationBestData = null;
            let isNewMax = false;
            
            // Find the best program in this generation
            if (programData && programData.length > 0) {
                generationBestData = programData.reduce((best, current) => 
                    current.score > best.score ? current : best
                );
                
                // Check if this generation's best beats the cumulative max
                if (generationBestData.score > cumulativeMaxScore) {
                    cumulativeMaxScore = generationBestData.score;
                    cumulativeMaxProgram = generationBestData.program;
                    isNewMax = true;
                }
            }
            
            // Always add a point for this generation using cumulative max
            if (cumulativeMaxScore > -Infinity) {
                islandCurves[islandId].push({ 
                    generation: gen, 
                    bestScore: cumulativeMaxScore,
                    bestProgram: cumulativeMaxProgram,
                    isCarryForward: !isNewMax && islandCurves[islandId].length > 0,
                    isNewMax: isNewMax
                });
                allScores.push(cumulativeMaxScore);
            }
        });
    });

    if (allScores.length === 0) {
        g.append("text")
            .attr("x", plotWidth / 2)
            .attr("y", plotHeight / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .style("fill", "#666")
            .text("No progression data available");
        return;
    }

    const xDomain = d3.extent(sortedGenerations);
    let yDomain = d3.extent(allScores);
    
    // Add some padding to y domain
    const yPadding = (yDomain[1] - yDomain[0]) * 0.1;
    yDomain[0] -= yPadding;
    yDomain[1] += yPadding;
    
    // Apply user-defined overrides if provided
    if (yMinOverride !== null && !isNaN(yMinOverride)) {
        yDomain[0] = yMinOverride;
    }
    if (yMaxOverride !== null && !isNaN(yMaxOverride)) {
        yDomain[1] = yMaxOverride;
    }

    const xScale = d3.scaleLinear()
        .domain(xDomain)
        .range([0, plotWidth]);

    const yScale = d3.scaleLinear()
        .domain(yDomain)
        .range([plotHeight, 0]);

    // Create line generator
    const line = d3.line()
        .x(d => xScale(d.generation))
        .y(d => yScale(d.bestScore))
        .curve(d3.curveMonotoneX);

    // Use the same color scheme as the main tree plot
    const islandColors = [
        "#1f77b4", // blue
        "#2ca02c", // green  
        "#9467bd", // purple
        "#8c564b", // brown
        "#e377c2", // pink
        "#7f7f7f", // gray
        "#bcbd22", // olive
        "#17becf", // cyan
        "#aec7e8"  // light blue
    ];
    const color = d3.scaleOrdinal(islandColors);

    // Draw axes
    // Limit number of ticks to prevent overlap when there are many generations
    let tickValues = sortedGenerations;
    if (sortedGenerations.length > 15) {
        // Show every nth generation to avoid overlap
        const step = Math.ceil(sortedGenerations.length / 15);
        tickValues = sortedGenerations.filter((_, i) => i % step === 0);
        // Always include the last generation
        if (tickValues[tickValues.length - 1] !== sortedGenerations[sortedGenerations.length - 1]) {
            tickValues.push(sortedGenerations[sortedGenerations.length - 1]);
        }
    }
    
    const xAxis = d3.axisBottom(xScale)
        .tickValues(tickValues)
        .tickFormat(d3.format("d"));
    const yAxis = d3.axisLeft(yScale)
        .ticks(4)
        .tickFormat(d3.format(".2f"));

    g.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(xAxis)
        .append("text")
        .attr("x", plotWidth / 2)
        .attr("y", 25)
        .attr("text-anchor", "middle")
        .style("fill", "black")
        .style("font-size", "12px")
        .text("Generation");

    g.append("g")
        .attr("class", "y-axis")
        .call(yAxis)
        .append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -35)
        .attr("x", -plotHeight / 2)
        .attr("text-anchor", "middle")
        .style("fill", "black")
        .style("font-size", "12px")
        .text("Best Score");

    // Draw curves and points for each island
    islands.forEach((islandId, index) => {
        const curveData = islandCurves[islandId];
        if (curveData.length === 0) return;

        const islandColor = color(islandId);

        // Draw the max progression line
        g.append("path")
            .datum(curveData)
            .attr("fill", "none")
            .attr("stroke", islandColor)
            .attr("stroke-width", 3)
            .attr("stroke-opacity", 1)
            .attr("d", line);
    });

    // Add legend (positioned at bottom-right) with collapsible arrow
    const legend = g.append("g")
        .attr("class", "curves-legend")
        .attr("transform", `translate(${plotWidth - 140}, ${plotHeight - islands.length * 22 - 50})`);

    // Add legend header with arrow
    const legendHeader = legend.append("g")
        .attr("transform", "translate(0, 0)")
        .style("cursor", "pointer");

    // Add clickable background for better interaction
    legendHeader.append("rect")
        .attr("x", -2)
        .attr("y", -8)
        .attr("width", 80)
        .attr("height", 16)
        .attr("fill", "transparent");

    // Add arrow indicator (collapsible)
    const arrow = legendHeader.append("text")
        .attr("class", "legend-arrow")
        .attr("x", 0)
        .attr("y", 0)
        .attr("dy", "0.35em")
        .style("font-size", "10px")
        .style("fill", "#666")
        .style("transition", "transform 0.2s")
        .text("▼");

    // Add legend title
    legendHeader.append("text")
        .attr("x", 12)
        .attr("y", 0)
        .attr("dy", "0.35em")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .text("Islands");

    // Create a group for legend items
    const legendItems = legend.append("g")
        .attr("class", "legend-items");

    islands.forEach((islandId, index) => {
        const legendItem = legendItems.append("g")
            .attr("transform", `translate(0, ${(index + 1) * 22 + 8})`);

        // Color square instead of line/dots
        legendItem.append("rect")
            .attr("x", 0)
            .attr("y", -6)
            .attr("width", 12)
            .attr("height", 12)
            .attr("fill", color(islandId))
            .attr("stroke", "white")
            .attr("stroke-width", 1);

        legendItem.append("text")
            .attr("x", 18)
            .attr("y", 0)
            .attr("dy", "0.35em")
            .style("font-size", "11px")
            .style("fill", "#333")
            .text(`Island ${islandId}`);
    });

    // Add toggle functionality - start collapsed by default
    let legendExpanded = false;
    legendItems.style("display", "none");
    arrow.text("▶");
    
    legendHeader.on("click", function() {
        legendExpanded = !legendExpanded;
        if (legendExpanded) {
            legendItems.style("display", null);
            arrow.text("▼");
        } else {
            legendItems.style("display", "none");
            arrow.text("▶");
        }
    });

    // Remove legend explanation about lines/dots since we simplified the legend
}

function createIslandPopulationCurves(container, programs, islands) {
    debug("[DEBUG] Creating island population curves for", islands.length, "islands");
    
    // Clean up any existing tooltips
    d3.selectAll(".island-pop-tooltip").remove();
    
    const containerWidth = container.node().getBoundingClientRect().width;
    const containerHeight = container.node().getBoundingClientRect().height;
    
    // Create SVG for curves
    const curvesSvg = container.append("svg")
        .attr("width", containerWidth)
        .attr("height", containerHeight)
        .style("background", "white");

    // Create tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "island-pop-tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("background", "rgba(0, 0, 0, 0.8)")
        .style("color", "white")
        .style("padding", "8px")
        .style("border-radius", "4px")
        .style("font-size", "12px")
        .style("pointer-events", "none")
        .style("z-index", "1000");

    const margin = { top: 45, right: 20, bottom: 30, left: 50 };
    const plotWidth = containerWidth - margin.left - margin.right;
    const plotHeight = containerHeight - margin.top - margin.bottom;

    const g = curvesSvg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Add title
    curvesSvg.append("text")
        .attr("x", containerWidth / 2)
        .attr("y", 35)
        .attr("text-anchor", "middle")
        .style("font-size", "16px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .text("Population Size by Island");

    // Group programs by island and generation
    const islandData = {};
    islands.forEach(islandId => {
        islandData[islandId] = {};
    });

    programs.forEach(program => {
        const islandId = program.island_idx;
        const generation = program.generation || 0;
        
        if (islandId != null) {
            if (!islandData[islandId][generation]) {
                islandData[islandId][generation] = 0;
            }
            islandData[islandId][generation]++;
        }
    });

    // Find all unique generations across all islands
    const allUniqueGenerations = new Set();
    programs.forEach(program => {
        const generation = program.generation || 0;
        allUniqueGenerations.add(generation);
    });
    const sortedGenerations = Array.from(allUniqueGenerations).sort((a,b) => a-b);

    // Calculate cumulative population per generation for each island
    const islandCurves = {};
    const allPopulations = [];
    
    islands.forEach(islandId => {
        islandCurves[islandId] = [];
        let cumulativeCount = 0;
        
        sortedGenerations.forEach(gen => {
            const countAtGen = islandData[islandId][gen] || 0;
            cumulativeCount += countAtGen;
            
            islandCurves[islandId].push({ 
                generation: gen, 
                population: cumulativeCount,
                addedThisGen: countAtGen
            });
            allPopulations.push(cumulativeCount);
        });
    });

    if (allPopulations.length === 0) {
        g.append("text")
            .attr("x", plotWidth / 2)
            .attr("y", plotHeight / 2)
            .attr("text-anchor", "middle")
            .text("No population data available");
        return;
    }

    // Calculate total population for legend
    const totalPopulation = programs.length;

    // Create scales
    const xScale = d3.scaleLinear()
        .domain(d3.extent(sortedGenerations))
        .range([0, plotWidth]);

    const yScale = d3.scaleLinear()
        .domain([0, d3.max(allPopulations) * 1.1])
        .range([plotHeight, 0]);

    // Color scale for islands - same as performance chart (no orange, which is used for best path)
    const islandColors = [
        "#1f77b4", // blue
        "#2ca02c", // green  
        "#9467bd", // purple
        "#8c564b", // brown
        "#e377c2", // pink
        "#7f7f7f", // gray
        "#bcbd22", // olive
        "#17becf", // cyan
        "#aec7e8"  // light blue
    ];
    const color = d3.scaleOrdinal(islandColors);

    // Add X axis
    g.append("g")
        .attr("transform", `translate(0,${plotHeight})`)
        .call(d3.axisBottom(xScale).ticks(10).tickFormat(d3.format("d")))
        .append("text")
        .attr("fill", "black")
        .attr("x", plotWidth / 2)
        .attr("y", 25)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text("Generation");

    // Add Y axis
    g.append("g")
        .call(d3.axisLeft(yScale).ticks(8))
        .append("text")
        .attr("fill", "black")
        .attr("transform", "rotate(-90)")
        .attr("x", -plotHeight / 2)
        .attr("y", -35)
        .attr("text-anchor", "middle")
        .style("font-size", "12px")
        .text("Cumulative Programs");

    // Create line generator
    const line = d3.line()
        .x(d => xScale(d.generation))
        .y(d => yScale(d.population))
        .curve(d3.curveStepAfter);

    // Draw lines for each island
    islands.forEach(islandId => {
        const curveData = islandCurves[islandId];
        if (curveData.length === 0) return;

        // Draw the line
        g.append("path")
            .datum(curveData)
            .attr("fill", "none")
            .attr("stroke", color(islandId))
            .attr("stroke-width", 2)
            .attr("d", line);
    });

    // Add legend (positioned at bottom-right) with collapsible arrow - same style as performance chart
    const legend = g.append("g")
        .attr("class", "pop-curves-legend")
        .attr("transform", `translate(${plotWidth - 140}, ${plotHeight - islands.length * 22 - 50})`);

    // Add legend header with arrow
    const legendHeader = legend.append("g")
        .attr("transform", "translate(0, 0)")
        .style("cursor", "pointer");

    // Add clickable background for better interaction
    legendHeader.append("rect")
        .attr("x", -2)
        .attr("y", -8)
        .attr("width", 80)
        .attr("height", 16)
        .attr("fill", "transparent");

    // Add arrow indicator (collapsible)
    const arrow = legendHeader.append("text")
        .attr("class", "legend-arrow")
        .attr("x", 0)
        .attr("y", 0)
        .attr("dy", "0.35em")
        .style("font-size", "10px")
        .style("fill", "#666")
        .style("transition", "transform 0.2s")
        .text("▼");

    // Add legend title
    legendHeader.append("text")
        .attr("x", 12)
        .attr("y", 0)
        .attr("dy", "0.35em")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .text("Islands");

    // Create a group for legend items
    const legendItems = legend.append("g")
        .attr("class", "legend-items");

    islands.forEach((islandId, index) => {
        const islandPop = islandCurves[islandId].length > 0 ? 
            islandCurves[islandId][islandCurves[islandId].length - 1].population : 0;
        
        const legendItem = legendItems.append("g")
            .attr("transform", `translate(0, ${(index + 1) * 22 + 8})`);

        // Color square instead of line/dots
        legendItem.append("rect")
            .attr("x", 0)
            .attr("y", -6)
            .attr("width", 12)
            .attr("height", 12)
            .attr("fill", color(islandId))
            .attr("stroke", "white")
            .attr("stroke-width", 1);

        legendItem.append("text")
            .attr("x", 18)
            .attr("y", 0)
            .attr("dy", "0.35em")
            .style("font-size", "11px")
            .style("fill", "#333")
            .text(`Island ${islandId}: ${islandPop}`);
    });

    // Add toggle functionality - start collapsed by default
    let legendExpanded = false;
    legendItems.style("display", "none");
    arrow.text("▶");
    
    legendHeader.on("click", function() {
        legendExpanded = !legendExpanded;
        if (legendExpanded) {
            legendItems.style("display", null);
            arrow.text("▼");
        } else {
            legendItems.style("display", "none");
            arrow.text("▶");
        }
    });
}

export function createIslandsVisualization(data) {
    debug("[DEBUG] Creating islands visualization");
    
    // Check if the islands tab is visible
    const islandsView = document.getElementById('islands-view');
    if (!islandsView || !islandsView.classList.contains('active')) {
        debug("[DEBUG] Islands view not active, skipping visualization creation");
        return;
    }

    const container = d3.select("#islands-container");
    container.html(""); // Clear previous content

    if (!data || data.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("No data to visualize.");
        return;
    }

    const programs = data.filter(d => 
        (d.island_idx !== null && d.island_idx !== undefined && d.correct && d.combined_score != null) ||
        (d.metadata && d.metadata.patch_type === 'init')
    );

    if (programs.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("No correct programs with island assignments and scores found.");
        return;
    }

    // Create containers for charts, plot and summary
    const chartsContainer = container.append("div")
        .style("height", "40%")
        .style("display", "flex")
        .style("gap", "5px")
        .style("margin-bottom", "5px");

    // Left chart: Performance Progression
    const performanceContainer = chartsContainer.append("div")
        .style("flex", "1")
        .style("position", "relative")
        .style("background", "white")
        .style("border-radius", "8px 8px 0 0")
        .style("border-bottom", "1px solid #dee2e6");

    // Right chart: Population Size
    const populationContainer = chartsContainer.append("div")
        .style("flex", "1")
        .style("position", "relative")
        .style("background", "white")
        .style("border-radius", "8px 8px 0 0")
        .style("border-bottom", "1px solid #dee2e6");

    const plotContainer = container.append("div")
        .style("height", "40%")
        .style("position", "relative")
        .style("background", "white")
        .style("margin-bottom", "5px")
        .style("overflow-y", "auto")
        .style("overflow-x", "hidden");

    const summaryContainer = container.append("div")
        .style("height", "18%")
        .style("overflow-y", "auto")
        .style("padding", "15px")
        .style("border-top", "2px solid #dee2e6")
        .style("background-color", "#ffffff")
        .style("border-radius", "0 0 8px 8px")
        .style("box-sizing", "border-box");
    
    // --- CHARTS FOR EACH ISLAND ---
    const islands = [...new Set(programs.filter(p => p.island_idx != null).map(p => p.island_idx))].sort((a,b) => a-b);
    const numIslands = islands.length;

    // Get y-axis range values from controls
    const yMinInput = document.getElementById('island-y-min');
    const yMaxInput = document.getElementById('island-y-max');
    const yMinValue = yMinInput && yMinInput.value !== '' ? parseFloat(yMinInput.value) : null;
    const yMaxValue = yMaxInput && yMaxInput.value !== '' ? parseFloat(yMaxInput.value) : null;
    
    // Create progression curves for each island (left chart)
    createIslandProgressionCurves(performanceContainer, programs, islands, yMinValue, yMaxValue);
    
    // Create population curves for each island (right chart)
    createIslandPopulationCurves(populationContainer, programs, islands);

    // --- TREE PLOT LOGIC FOR EACH ISLAND ---

    const width = plotContainer.node().getBoundingClientRect().width;
    const containerHeight = plotContainer.node().getBoundingClientRect().height;
    
    // Calculate required height based on number of rows
    const islandsPerRow = 3;
    const numRows = Math.ceil(numIslands / islandsPerRow);
    const minHeightPerRow = 400; // Minimum height per row
    const calculatedHeight = Math.max(containerHeight, numRows * minHeightPerRow);

    const svg = plotContainer.append("svg")
        .attr("width", width)
        .attr("height", calculatedHeight)
        .attr("viewBox", [0, 0, width, calculatedHeight]);

    const g = svg.append("g");
    
    // Zoom behavior - disable wheel zoom to allow scrolling, keep drag to pan
    const zoom = d3.zoom()
        .on("zoom", (event) => g.attr("transform", event.transform))
        .filter(function(event) {
            // Disable zoom on wheel events, allow drag and double-click
            return event.type !== 'wheel';
        });
    svg.call(zoom);

    // Use the same color scheme as the main tree plot
    const islandColors = [
        "#1f77b4", // blue
        "#2ca02c", // green  
        "#9467bd", // purple
        "#8c564b", // brown
        "#e377c2", // pink
        "#7f7f7f", // gray
        "#bcbd22", // olive
        "#17becf", // cyan
        "#aec7e8"  // light blue
    ];
    const color = d3.scaleOrdinal(islandColors);

    // Performance metrics
    const scores = programs.map(p => p.combined_score).filter(s => s != null && !isNaN(s));
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 1;
    const colorScale = d3.scaleSequential(d3.interpolateViridis).domain([minScore, maxScore]);
    
    const shapeMap = {
        'init': d3.symbolDiamond,
        'full': d3.symbolCircle,
        'diff': d3.symbolSquare,
        'cross': d3.symbolCross,
        'fix': d3.symbolTriangle
    };
    const getShape = (patchType) => shapeMap[patchType] || d3.symbolCircle;
    const symbol = d3.symbol().size(1500); // Smaller size for island trees

    // Calculate island layout with max 3 islands per row
    const margin = { top: 80, right: 20, bottom: 20, left: 20 };
    const plotWidth = width - margin.left - margin.right;
    
    const rowHeight = (calculatedHeight - margin.top - margin.bottom) / numRows;
    
    const islandCenters = islands.map((d, i) => {
        const row = Math.floor(i / islandsPerRow);
        const col = i % islandsPerRow;
        const islandsInThisRow = Math.min(islandsPerRow, numIslands - row * islandsPerRow);
        const rowWidth = plotWidth;
        const itemWidth = rowWidth / islandsInThisRow;
        return {
            x: margin.left + (col + 0.5) * itemWidth,
            y: margin.top + row * rowHeight
        };
    });
    
    const plotHeight = rowHeight * numRows;

    // Create a copy of programs data to avoid modifying the original
    const programsCopy = programs.map(d => ({...d}));

    // Group programs by island using the copy
    const programsByIsland = {};
    islands.forEach(island => {
        programsByIsland[island] = programsCopy.filter(p => p.island_idx === island);
    });

    // Draw island backgrounds
    g.selectAll(".island-bg")
        .data(islands)
        .enter().append("rect")
        .attr("class", "island-bg")
        .attr("x", (d, i) => {
            const col = i % islandsPerRow;
            const row = Math.floor(i / islandsPerRow);
            const islandsInRow = Math.min(islandsPerRow, numIslands - row * islandsPerRow);
            const itemWidth = plotWidth / islandsInRow;
            return margin.left + col * itemWidth + 10;
        })
        .attr("y", (d, i) => {
            const row = Math.floor(i / islandsPerRow);
            return margin.top + row * rowHeight + 10;
        })
        .attr("width", (d, i) => {
            const row = Math.floor(i / islandsPerRow);
            const islandsInRow = Math.min(islandsPerRow, numIslands - row * islandsPerRow);
            const itemWidth = plotWidth / islandsInRow;
            return itemWidth - 20;
        })
        .attr("height", rowHeight - 20)
        .attr("fill", d => color(d))
        .attr("fill-opacity", 0.05)
        .attr("stroke", d => color(d))
        .attr("stroke-width", 2)
        .attr("stroke-opacity", 0.3)
        .attr("rx", 12);

    // Island headers
    const headerGroup = g.selectAll(".island-header")
        .data(islands)
        .enter().append("g")
        .attr("class", "island-header")
        .attr("transform", (d, i) => `translate(${islandCenters[i].x}, ${islandCenters[i].y - 50})`);

    headerGroup.append("rect")
        .attr("x", -50)
        .attr("y", -15)
        .attr("width", 100)
        .attr("height", 25)
        .attr("fill", d => color(d))
        .attr("fill-opacity", 0.15)
        .attr("stroke", d => color(d))
        .attr("stroke-width", 2)
        .attr("rx", 6);

    headerGroup.append("text")
        .attr("text-anchor", "middle")
        .style("font-size", "14px")
        .style("font-weight", "bold")
        .style("fill", d => color(d))
        .text(d => `Island ${d}`);

    // Create tree layout for each island
    islands.forEach((islandId, islandIndex) => {
        const islandPrograms = programsByIsland[islandId];
        if (islandPrograms.length === 0) return;

        // Create a node map for this island
        const nodeMap = new Map(islandPrograms.map(node => [node.id, node]));
        
        // Create completely isolated hierarchical data for this island
        let hierarchyData = JSON.parse(JSON.stringify(islandPrograms));
        
        // Clear parent_id for nodes whose parent is not in the same island
        // This only affects the hierarchyData copy, not the original data
        hierarchyData.forEach(node => {
            if (node.parent_id && !nodeMap.has(node.parent_id)) {
                node.parent_id = null; // Make it a root node in this island's view only
            }
        });
        
        // Find root nodes (nodes with no parent_id)
        const rootNodes = hierarchyData.filter(n => !n.parent_id);

        // If there are multiple root nodes, create a virtual root
        const virtualRootId = `___virtual_root_island_${islandId}___`;
        if (rootNodes.length > 1) {
            // Create virtual root node that won't interfere with original data
            const virtualRoot = { 
                id: virtualRootId, 
                parent_id: '', 
                agent_name: 'VIRTUAL ROOT', 
                isVirtual: true, 
                generation: -1,
                island_idx: islandId,
                metadata: { patch_type: 'virtual', patch_name: 'Virtual Root' }
            };
            
            // Create a completely new hierarchy data array with virtual root connections
            const newHierarchyData = [];
            
            // Add the virtual root first
            newHierarchyData.push(virtualRoot);
            
            // Add all nodes, updating parent_id only for root nodes
            hierarchyData.forEach(node => {
                const isRootNode = rootNodes.some(rn => rn.id === node.id);
                if (isRootNode) {
                    // Create a new object with updated parent_id
                    newHierarchyData.push({
                        ...node,
                        parent_id: virtualRootId
                    });
                } else {
                    // Keep original node unchanged
                    newHierarchyData.push(node);
                }
            });
            
            // Replace hierarchyData with the new structure
            hierarchyData = newHierarchyData;
        }

        // Create tree hierarchy
        const root = d3.stratify()
            .id(d => d.id)
            .parentId(d => d.parent_id)
            (hierarchyData);

        root.sort((a, b) => a.data.generation - b.data.generation || a.data.timestamp - b.data.timestamp);

        // Tree layout settings for this island
        const nodeWidth = 60;
        const nodeHeight = 80;
        const treeLayout = d3.tree().nodeSize([nodeWidth, nodeHeight]);
        treeLayout(root);

        // Calculate bounds for this tree
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        root.each(d => {
            if (d.x < minX) minX = d.x;
            if (d.x > maxX) maxX = d.x;
            if (d.y < minY) minY = d.y;
            if (d.y > maxY) maxY = d.y;
        });

        // Calculate equal padding on all sides
        const padding = 50; // Equal padding on all sides
        const headerStatsHeight = 60; // Space reserved for header and stats at top
        
        // Calculate actual island width for this row
        const row = Math.floor(islandIndex / islandsPerRow);
        const col = islandIndex % islandsPerRow;
        const islandsInRow = Math.min(islandsPerRow, numIslands - row * islandsPerRow);
        const actualIslandWidth = plotWidth / islandsInRow;
        
        const availableWidth = actualIslandWidth - (2 * padding); // Equal left/right padding
        const availableHeight = rowHeight - headerStatsHeight - (2 * padding); // Equal top/bottom padding after header
        
        const treeWidth = maxX - minX || nodeWidth;
        const treeHeight = maxY - minY || nodeHeight;
        
        const scaleX = availableWidth / Math.max(treeWidth, 1);
        const scaleY = availableHeight / Math.max(treeHeight, 1);
        const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

        // Calculate island boundaries for tree area (excluding header/stats)
        const islandLeft = margin.left + col * actualIslandWidth + 10 + padding;
        const islandTop = margin.top + row * rowHeight + 10 + 30; // Start trees much higher, just below headers
        const islandTreeWidth = availableWidth;
        const islandTreeHeight = availableHeight;
        
        // Center the tree within the available tree area
        const treeCenterX = (minX + maxX) / 2;
        const treeCenterY = (minY + maxY) / 2;
        
        const islandTreeCenterX = islandLeft + islandTreeWidth / 2;
        const islandTreeCenterY = islandTop + islandTreeHeight / 2;
        
        // Position the tree so its center aligns with the island tree area center
        const offsetX = islandTreeCenterX - treeCenterX * scale;
        const offsetY = islandTreeCenterY - treeCenterY * scale;

        // Create group for this island's tree
        const islandGroup = g.append("g")
            .attr("class", `island-tree-${islandId}`)
            .attr("transform", `translate(${offsetX}, ${offsetY}) scale(${scale})`);

        // Find best node for this island
        const correctNodes = hierarchyData.filter(d => d.correct && d.combined_score !== null);
        let bestNodeInIsland = null;
        if (correctNodes.length > 0) {
            bestNodeInIsland = correctNodes.reduce((best, current) => 
                (current.combined_score > best.combined_score) ? current : best);
        }

        // Get ancestor path for best node
        const ancestorIds = new Set();
        if (bestNodeInIsland) {
            let bestNodeD3 = null;
            root.each(d => {
                if (d.data.id === bestNodeInIsland.id) {
                    bestNodeD3 = d;
                }
            });
            if (bestNodeD3) {
                bestNodeD3.ancestors().forEach(ancestor => {
                    ancestorIds.add(ancestor.data.id);
                });
            }
        }

        // Draw links
        const visibleLinks = root.links().filter(d => !d.source.data.isVirtual);
        
        islandGroup.append("g")
            .attr("class", "links")
            .selectAll("path")
            .data(visibleLinks)
            .enter().append("path")
            .attr("class", "link")
            .attr("fill", "none")
            .style("stroke", d => {
                const onAncestorPath = ancestorIds.has(d.source.data.id) && ancestorIds.has(d.target.data.id);
                if (onAncestorPath) {
                    // Double-check: ensure both nodes are correct before orange highlighting
                    const sourceCorrect = d.source.data.correct === true || d.source.data.correct === 'true' || d.source.data.correct === 1;
                    const targetCorrect = d.target.data.correct === true || d.target.data.correct === 'true' || d.target.data.correct === 1;
                    if (sourceCorrect && targetCorrect) {
                        return "#ff8c00";
                    } else {
                        debug("[DEBUG] Blocking island view orange highlight for incorrect link:", d.source.data.id.substring(0, 8), "->", d.target.data.id.substring(0, 8));
                        return "#999";
                    }
                }
                return "#999";
            })
            .style("stroke-width", d => (ancestorIds.has(d.source.data.id) && ancestorIds.has(d.target.data.id)) ? 3 : 1)
            .style("stroke-opacity", d => (ancestorIds.has(d.source.data.id) && ancestorIds.has(d.target.data.id)) ? 1 : 0.6)
            .attr("d", d3.linkVertical()
                .x(d => d.x)
                .y(d => d.y)
            );

        // Draw nodes
        const visibleNodes = root.descendants().filter(d => !d.data.isVirtual);
        
        const node = islandGroup.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(visibleNodes)
            .enter().append("g")
            .attr("class", d => d.data.id === window.bestNodeId ? "node best-node" : "node")
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .style("cursor", "pointer")
            .on('click', (event, d) => {
                // Update selection highlighting
                d3.selectAll('.node').classed('selected', false);
                d3.select(event.currentTarget).classed('selected', true);
                
                const selectedNodeId = d.data.id;
                const selectedAncestors = new Set(d.ancestors().map(n => n.data.id));

                // Update link styles for this island
                islandGroup.selectAll('.link')
                    .style("stroke", l => {
                        const onBestPath = ancestorIds.has(l.source.data.id) && ancestorIds.has(l.target.data.id);
                        if (onBestPath) return "#ff8c00";
                        const onSelectedPath = selectedAncestors.has(l.source.data.id) && selectedAncestors.has(l.target.data.id);
                        if (onSelectedPath) return "gold";
                        return "#999";
                    })
                    .style("stroke-width", l => (selectedAncestors.has(l.source.data.id) && selectedAncestors.has(l.target.data.id)) || (ancestorIds.has(l.source.data.id) && ancestorIds.has(l.target.data.id)) ? 3 : 1)
                    .style("stroke-opacity", l => (selectedAncestors.has(l.source.data.id) && selectedAncestors.has(l.target.data.id)) || (ancestorIds.has(l.source.data.id) && ancestorIds.has(l.target.data.id)) ? 1 : 0.6);
                
                // Update node styles
                node.selectAll('path')
                    .style("stroke", n => {
                        if (ancestorIds.has(n.data.id)) {
                            return '#ff8c00';
                        }
                        if (isFailedProposalNode(n.data)) {
                            return '#c0392b';
                        }
                        return "#000";
                    })
                    .style("stroke-width", n => ancestorIds.has(n.data.id) ? 3 : 2)
                    .style("filter", n => n.data.id === window.bestNodeId ? "drop-shadow(0px 2px 4px rgba(255, 140, 0, 0.3))" : "drop-shadow(0px 1px 2px rgba(0,0,0,0.2))");
                
                node.filter('.selected')
                    .select('path')
                    .style("stroke", "#e58e26").style("stroke-width", 3)
                    .style("filter", "drop-shadow(0px 2px 4px rgba(229, 130, 38, 0.4))");

                // Always use the original node data from window.treeData, not the modified hierarchy data
                const originalNodeData = window.treeData.find(node => node.id === d.data.id);
                if (originalNodeData) {
                    displayNodeDetails(originalNodeData);
                } else {
                    console.error("[DEBUG] Could not find original node data for:", d.data.id);
                    displayNodeDetails(d.data);
                }
                document.querySelector('.tab[data-tab="agent-code"]').click();
            });

        // Add hover tooltips
        node.on('mouseover', (event, d) => {
            const tooltip = d3.select("body").append("div")
                .attr("class", "node-tooltip")
                .style("opacity", 0)
                .style("background", "rgba(0,0,0,0.8)")
                .style("color", "white")
                .style("padding", "8px 12px")
                .style("border-radius", "6px")
                .style("font-size", "12px")
                .style("position", "absolute")
                .style("pointer-events", "none")
                .style("z-index", "1000");

            tooltip.transition().duration(200).style("opacity", 1);
            
            const patchName = d.data.metadata.patch_name || 'unnamed';
            const score = formatScore(d.data.combined_score);
            const patchType = d.data.metadata.patch_type || 'N/A';
            const islandIdx = d.data.island_idx;
            
            if (isFailedProposalNode(d.data)) {
                tooltip.html(`
                    <strong style="color: #ffb3b3; font-size: 13px;">${patchName}</strong><br>
                    <strong>Status:</strong> Failed Proposal<br>
                    <strong>Failure:</strong> ${escapeHtml(d.data.metadata.failure_class || d.data.metadata.failure_stage || 'failed_proposal')}<br>
                    <strong>Reason:</strong> ${escapeHtml(d.data.metadata.failure_reason || d.data.text_feedback || 'N/A')}
                `);
            } else {
                tooltip.html(`
                    <strong style="color: #58a6ff; font-size: 13px;">${patchName}</strong><br>
                    <strong>Score:</strong> ${score}<br>
                    <strong>Type:</strong> ${patchType}<br>
                    <strong>Island:</strong> ${islandIdx}
                `);
            }
            tooltip.style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on('mousemove', (event) => {
            d3.select(".node-tooltip")
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on('mouseout', () => {
            d3.selectAll(".node-tooltip").transition().duration(200).style("opacity", 0).remove();
        });

        // Draw node shapes
        node.append("path")
            .attr("d", d => {
                symbol.type(getShape(d.data.metadata.patch_type));
                return symbol();
            })
            .style("fill", d => {
                if (d.data.id === window.bestNodeId) return '#ffd700';
                if (isFailedProposalNode(d.data)) return '#ffb3b3';
                if (!d.data.correct) return '#e74c3c';
                const score = d.data.combined_score;
                if (score !== null && !isNaN(score)) {
                    return colorScale(score);
                }
                return '#3498db';
            })
            .style("stroke", d => {
                const onAncestorPath = ancestorIds.has(d.data.id);
                if (onAncestorPath) {
                    // Double-check: ensure node is correct before orange highlighting
                    const nodeCorrect = d.data.correct === true || d.data.correct === 'true' || d.data.correct === 1;
                    if (nodeCorrect) {
                        return '#ff8c00';
                    } else {
                        debug("[DEBUG] Blocking island view orange highlight for incorrect node:", d.data.id.substring(0, 8), "correct:", d.data.correct);
                        return "#000";
                    }
                }
                if (isFailedProposalNode(d.data)) return '#c0392b';
                return "#000";
            })
            .style("stroke-width", d => ancestorIds.has(d.data.id) ? 3 : 2)
            .style("stroke-dasharray", d => isFailedProposalNode(d.data) ? "6,3" : null)
            .style("filter", d => d.data.id === window.bestNodeId ? "drop-shadow(0px 2px 4px rgba(255, 140, 0, 0.3))" : "drop-shadow(0px 1px 2px rgba(0,0,0,0.2))");

        // Add animated rings for the SINGLE best node (island view)
        if (window.allBestPaths && window.allBestPaths.length > 0) {
            // FORCE SINGLE PATH: Only process the first path, always use orange
            const singlePath = window.allBestPaths[0];
            [singlePath].forEach((path, index) => {
                const pathColor = '#ff8c00'; // Always orange for single path
                const shadowColor = 'rgba(255, 140, 0, 0.2)'; // Always orange shadow
                
                node.filter(d => d.data.id === path.nodeId)
                    .insert("circle", ":first-child")
                    .attr("r", 18)
                    .style("fill", "none")
                    .style("stroke", pathColor)
                    .style("stroke-width", 2)
                    .style("stroke-dasharray", "4,2")
                    .style("opacity", 0.8)
                    .style("filter", `drop-shadow(0px 1px 2px ${shadowColor})`)
                    .style("animation", "pulse 2s infinite");
            });
        } else {
            // Fallback: add ring for the single best node if no paths detected
            node.filter(d => d.data.id === window.bestNodeId)
                .insert("circle", ":first-child")
                .attr("r", 18).style("fill", "none").style("stroke", "#ff8c00")
                .style("stroke-width", 2).style("stroke-dasharray", "4,2").style("opacity", 0.8)
                .style("filter", "drop-shadow(0px 1px 2px rgba(255, 140, 0, 0.2))")
                .style("animation", "pulse 2s infinite");
        }

        // Add generation labels (centered in nodes)
        node.append("text")
            .attr("x", 0)
            .attr("y", 0)
            .attr("dy", "0.35em")
            .attr("text-anchor", "middle")
            .style("font-size", "12px").style("font-weight", "bold").style("fill", "white")
            .style("pointer-events", "none")
            .style("text-shadow", "1px 1px 1px rgba(0,0,0,0.5)")
            .text(d => d.data.generation);
    });

    // Add island statistics using the copy
    const islandStats = islands.map(island_idx => {
        const islandPrograms = programsCopy.filter(p => p.island_idx === island_idx);
        const islandScores = islandPrograms.map(p => p.combined_score).filter(s => s != null);
        return {
            island_idx: island_idx,
            count: islandPrograms.length,
            avgScore: islandScores.length > 0 ? d3.mean(islandScores) : null,
            bestScore: islandScores.length > 0 ? d3.max(islandScores) : null
        };
    });

    const statsGroup = g.selectAll(".island-stats")
        .data(islandStats)
        .enter().append("g")
        .attr("class", "island-stats")
        .attr("transform", (d, i) => `translate(${islandCenters[i].x}, ${islandCenters[i].y - 25})`);
    
    // Stats background
    statsGroup.append("rect")
        .attr("x", -40)
        .attr("y", -2)
        .attr("width", 80)
        .attr("height", 24)
        .attr("fill", "white")
        .attr("fill-opacity", 0.9)
        .attr("stroke", "#dee2e6")
        .attr("stroke-width", 1)
        .attr("rx", 4);

    statsGroup.append("text")
        .attr("y", 6)
        .attr("text-anchor", "middle").style("font-size", "9px").style("font-weight", "600")
        .text(d => `${d.count} programs`);

    statsGroup.append("text")
        .attr("y", 16).attr("text-anchor", "middle").style("font-size", "8px").style("fill", "#666")
        .text(d => `Best: ${d.bestScore ? d.bestScore.toFixed(2) : 'N/A'}`);

    // --- SUMMARY LOGIC ---
    const allProgramMigrations = [];
    data.forEach(p => {
        if (p.migration_history && p.migration_history.length > 0) {
            p.migration_history.forEach(m => {
                allProgramMigrations.push({ 
                    migration_gen: m.generation, 
                    from: m.from,
                    to: m.to,
                    program_id: p.id,
                    program_gen: p.generation,
                    score: p.combined_score
                });
            });
        }
    });
    if (allProgramMigrations.length === 0) {
        summaryContainer.html('<h5 style="margin-top:0;">Migration Summary</h5><p style="color: #666; font-size: 14px;">No migration events have been recorded.</p>');
    } else {
        const migrationsByGen = {};
        allProgramMigrations.forEach(m => {
            if (!migrationsByGen[m.migration_gen]) {
                migrationsByGen[m.migration_gen] = [];
            }
            migrationsByGen[m.migration_gen].push(m);
        });

        const sortedGenerations = Object.keys(migrationsByGen).map(Number).sort((a, b) => a - b);
        
        let summaryHtml = `
            <h5 style="margin-top:0; margin-bottom: 10px;">Migration Summary</h5>
            <table class="llm-result-table" style="font-size: 13px; table-layout: auto;">
                <thead>
                    <tr>
                        <th style="width: 100px;">Generation</th>
                        <th>Migration Details</th>
                        <th style="width: 120px;">Total Migrated</th>
                    </tr>
                </thead>
                <tbody>`;

        sortedGenerations.forEach(gen => {
            const events = migrationsByGen[gen];
            events.sort((a,b) => (a.from - b.from) || (a.to - b.to));
            
            const detailsString = events.map(p => {
                const shortId = p.program_id.substring(0, 8) + '...';
                const score = (p.score !== null && p.score !== undefined) ? p.score.toFixed(2) : 'N/A';
                const link = `<a href="#" onclick="event.preventDefault(); selectNodeById('${p.program_id}');" style="color: #007bff; text-decoration: underline;">${shortId}</a>`;
                return `Gen ${p.program_gen}, Program: ${link}, Score: ${score} (${p.from} → ${p.to})`;
            }).join('<br>');

            const totalCount = events.length;
            
            summaryHtml += `
                <tr>
                    <td>${gen}</td>
                    <td>${detailsString}</td>
                    <td>${totalCount}</td>
                </tr>`;
        });

        summaryHtml += `</tbody></table>`;
        summaryContainer.html(summaryHtml);
    }
}
