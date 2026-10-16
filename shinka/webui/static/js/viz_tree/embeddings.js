// Embed tab: similarity heatmaps.
import { debug } from '../log.js';
import { formatScore } from './format.js';
import { updateDetailsForNode } from './selection.js';
import { savePreferences } from './state.js';

// Embedding Analysis Functions
function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function computeSimilarityMatrix(embeddings) {
    const n = embeddings.length;
    const matrix = new Array(n);
    
    for (let i = 0; i < n; i++) {
        matrix[i] = new Array(n);
        for (let j = 0; j < n; j++) {
            matrix[i][j] = cosineSimilarity(embeddings[i], embeddings[j]);
        }
    }
    
    return matrix;
}

function hierarchicalClustering(similarityMatrix) {
    const n = similarityMatrix.length;
    const clusters = Array.from({length: n}, (_, i) => [i]);
    const distances = [];
    
    // Convert similarity to distance (1 - similarity)
    const distMatrix = similarityMatrix.map(row => 
        row.map(sim => 1 - sim)
    );
    
    while (clusters.length > 1) {
        let minDist = Infinity;
        let mergeI = -1, mergeJ = -1;
        
        // Find closest clusters
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                let dist = 0;
                let count = 0;
                
                // Average linkage
                for (let a of clusters[i]) {
                    for (let b of clusters[j]) {
                        dist += distMatrix[a][b];
                        count++;
                    }
                }
                dist /= count;
                
                if (dist < minDist) {
                    minDist = dist;
                    mergeI = i;
                    mergeJ = j;
                }
            }
        }
        
        // Merge clusters
        const merged = [...clusters[mergeI], ...clusters[mergeJ]];
        clusters.splice(Math.max(mergeI, mergeJ), 1);
        clusters.splice(Math.min(mergeI, mergeJ), 1);
        clusters.push(merged);
    }
    
    return clusters[0]; // Return the final ordering
}

function filterEmbeddingHeatmapData(data) {
    if (!Array.isArray(data)) {
        return [];
    }

    let filteredData = [...data];
    const gen0Programs = filteredData.filter(d => d.generation === 0);

    if (gen0Programs.length > 1) {
        const gen0Groups = {};
        gen0Programs.forEach(prog => {
            const key = prog.code || prog.id || 'no-code';
            if (!gen0Groups[key]) {
                gen0Groups[key] = [];
            }
            gen0Groups[key].push(prog);
        });

        const duplicateIds = new Set();
        Object.values(gen0Groups).forEach(group => {
            if (group.length > 1) {
                group.sort((a, b) => (a.island_idx || 0) - (b.island_idx || 0));
                group.slice(1).forEach(prog => duplicateIds.add(prog.id));
            }
        });

        filteredData = filteredData.filter(d => !duplicateIds.has(d.id));
    }

    return filteredData;
}

function embeddingFieldIsHydrated(program) {
    return (
        program &&
        Object.prototype.hasOwnProperty.call(program, 'embedding') &&
        Array.isArray(program.embedding)
    );
}

function datasetHasHydratedEmbeddingFields(data) {
    const filteredData = filterEmbeddingHeatmapData(data);
    const programsNeedingEmbeddings = filteredData.filter(
        d => d && d.id && !String(d.id).includes('___virtual_root')
    );

    if (programsNeedingEmbeddings.length === 0) {
        return false;
    }

    return programsNeedingEmbeddings.every(
        program => embeddingFieldIsHydrated(program)
    );
}

function createEmbeddingsHeatmap(data) {
    debug("[DEBUG] Creating embeddings heatmap");
    
    // Add validation checks
    if (!data || !Array.isArray(data) || data.length === 0) {
        console.warn("[DEBUG] No data available for embeddings heatmap");
        const container = document.getElementById('embeddings-heatmap');
        if (container) {
            container.innerHTML = '<div style="text-align: center; color: #666; margin-top: 50px;">No data available for embeddings visualization.</div>';
        }
        return;
    }
    
    // Check if the embeddings tab is visible
    const embeddingsView = document.getElementById('embeddings-view');
    if (!embeddingsView || !embeddingsView.classList.contains('active')) {
        debug("[DEBUG] Embeddings view not active, skipping heatmap creation");
        return;
    }
    
    // Clear existing heatmap
    d3.select("#embeddings-heatmap").selectAll("*").remove();
    
    const filteredData = filterEmbeddingHeatmapData(data);
    if (filteredData.length !== data.length) {
        debug(
            `[DEBUG] Embeddings: Filtered out ${data.length - filteredData.length} duplicate generation 0 programs`
        );
    }

    if (!datasetHasHydratedEmbeddingFields(filteredData)) {
        d3.select("#embeddings-heatmap")
            .append("div")
            .style("text-align", "center")
            .style("color", "#666")
            .style("margin-top", "50px")
            .text("Loading full embedding data...");
        return;
    }

    // Filter data with embeddings
    const dataWithEmbeddings = filteredData.filter(d => d.embedding && Array.isArray(d.embedding) && d.embedding.length > 0);
    
    if (dataWithEmbeddings.length === 0) {
        d3.select("#embeddings-heatmap")
            .append("div")
            .style("text-align", "center")
            .style("color", "#666")
            .style("margin-top", "50px")
            .text("No embedding data available for visualization.");
        return;
    }
    
    // Find best node within the current set of programs with embeddings
    const correctEmbedNodes = dataWithEmbeddings.filter(d => d.correct && d.combined_score !== null && !isNaN(d.combined_score));
    let bestEmbedNodeId = null;
    if (correctEmbedNodes.length > 0) {
        const bestEmbedNode = correctEmbedNodes.reduce((best, current) => (current.combined_score > best.combined_score) ? current : best);
        bestEmbedNodeId = bestEmbedNode.id;
    }
    
    debug(`[DEBUG] Found ${dataWithEmbeddings.length} programs with embeddings`);
    
    // Create main container div
    const mainContainer = d3.select("#embeddings-heatmap")
        .append("div")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("align-items", "stretch")
        .style("width", "100%")
        .style("height", "100%")
        .style("overflow-y", "auto")
        .style("padding", "10px")
        .style("box-sizing", "border-box");

    // Add main heatmap title
    mainContainer.append("h3")
        .style("margin", "0 0 10px 0")
        .style("color", "#2c3e50")
        .style("font-size", "18px")
        .style("text-align", "center")
        .text("All Programs - Embedding Similarity Matrix");

    // Keep the matrix at its true pixel size and scroll when it
    // outgrows the left panel.
    const mainHeatmapScroll = mainContainer.append("div")
        .attr("id", "main-heatmap-scroll")
        .style("width", "100%")
        .style("overflow", "auto")
        .style("padding-bottom", "10px");

    const mainHeatmapContainer = mainHeatmapScroll.append("div")
        .attr("id", "main-heatmap")
        .style("width", "max-content")
        .style("margin", "0 auto");

    createSingleEmbeddingHeatmap(dataWithEmbeddings, mainHeatmapContainer, "All Programs", bestEmbedNodeId);

    // Group data by islands for subplots
    const islands = [...new Set(dataWithEmbeddings.filter(d => d.island_idx !== null && d.island_idx !== undefined).map(d => d.island_idx))].sort((a, b) => a - b);
    
    if (islands.length > 1) {
        // Add section title for island subplots
        mainContainer.append("h3")
            .style("margin", "5px 0 10px 0")
            .style("color", "#2c3e50")
            .style("font-size", "18px")
            .text("Individual Islands - Embedding Similarity Matrices");

        // Create island color scale (same as main visualization)
        const islandColors = [
            "#1f77b4", "#2ca02c", "#9467bd", "#8c564b", "#e377c2",
            "#7f7f7f", "#bcbd22", "#17becf", "#aec7e8"
        ];
        const islandColorScale = d3.scaleOrdinal(islandColors);

        // Create subplots container
        const subplotsContainer = mainContainer.append("div")
            .style("display", "flex")
            .style("flex-wrap", "wrap")
            .style("justify-content", "center")
            .style("gap", "20px")
            .style("width", "100%");

        // Create subplot for each island
        islands.forEach(islandId => {
            const islandData = dataWithEmbeddings.filter(d => d.island_idx === islandId);
            
            if (islandData.length > 1) { // Only create subplot if there are multiple programs
                // Find best node in this island
                const correctIslandNodes = islandData.filter(d => d.correct && d.combined_score !== null && !isNaN(d.combined_score));
                let bestIslandNodeId = null;
                if (correctIslandNodes.length > 0) {
                    const bestIslandNode = correctIslandNodes.reduce((best, current) => (current.combined_score > best.combined_score) ? current : best);
                    bestIslandNodeId = bestIslandNode.id;
                }

                const subplotContainer = subplotsContainer.append("div")
                    .style("border", `2px solid ${islandColorScale(islandId)}`)
                    .style("border-radius", "8px")
                    .style("padding", "15px")
                    .style("background-color", "#fafafa")
                    .style("min-width", "300px")
                    .style("max-width", "500px")
                    .style("display", "flex")
                    .style("flex-direction", "column")
                    .style("align-items", "center");

                // Add island title with color coding
                const titleContainer = subplotContainer.append("div")
                    .style("display", "flex")
                    .style("align-items", "center")
                    .style("margin-bottom", "15px");

                titleContainer.append("div")
                    .style("width", "20px")
                    .style("height", "20px")
                    .style("background-color", islandColorScale(islandId))
                    .style("border-radius", "4px")
                    .style("margin-right", "10px");

                titleContainer.append("h4")
                    .style("margin", "0")
                    .style("color", "#2c3e50")
                    .style("font-size", "16px")
                    .text(`Island ${islandId} (${islandData.length} programs)`);

                createSingleEmbeddingHeatmap(islandData, subplotContainer, `Island ${islandId}`, bestIslandNodeId, true);
            }
        });
    }
}

// Helper function to create a single embedding heatmap
function createSingleEmbeddingHeatmap(dataWithEmbeddings, container, title, bestNodeId, isSubplot = false) {
    
    // Extract embeddings and metadata
    const embeddings = dataWithEmbeddings.map(d => d.embedding);
    const labelsData = dataWithEmbeddings.map(d => ({ gen: d.generation, name: d.metadata.patch_name || 'unnamed' }));
    const nodeIds = dataWithEmbeddings.map(d => d.id);
    
    // Compute similarity matrix
    const similarityMatrix = computeSimilarityMatrix(embeddings);

    // Get scores for performance bar
    const scores = dataWithEmbeddings
        .filter(d => d.correct && d.combined_score !== null && !isNaN(d.combined_score))
        .map(d => d.combined_score);
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 1;
    const scoreColorScale = d3.scaleSequential(d3.interpolatePlasma).domain([minScore, maxScore]);
    
    // Calculate actual min/max similarity values for auto-setting defaults
    let allSimilarities = [];
    for (let i = 0; i < similarityMatrix.length; i++) {
        for (let j = 0; j < similarityMatrix[i].length; j++) {
            if (i !== j) { // Exclude diagonal (self-similarity = 1.0)
                allSimilarities.push(similarityMatrix[i][j]);
            }
        }
    }
    
    const actualMinSim = allSimilarities.length > 0 ? Math.min(...allSimilarities) : 0;
    const actualMaxSim = allSimilarities.length > 0 ? Math.max(...allSimilarities) : 1;
    
    // For subplots, use the same controls as main plot
    // For main plot, auto-set defaults for each database
    let heatMin, heatMax;
    if (isSubplot) {
        // Use the same range as main plot
        heatMin = parseFloat(document.getElementById('heat-min').value);
        heatMax = parseFloat(document.getElementById('heat-max').value);
    } else {
        // Auto-set defaults for main plot
        const heatMinInput = document.getElementById('heat-min');
        const heatMaxInput = document.getElementById('heat-max');
        
        // Check if this is a different database or first time
        const currentDbPath = window.currentDbPath;
        const lastDbPath = window.lastEmbeddingsDbPath;
        
        if (heatMinInput && heatMaxInput && (currentDbPath !== lastDbPath)) {
            // Auto-set for new database
            heatMinInput.value = actualMinSim.toFixed(3);
            heatMaxInput.value = actualMaxSim.toFixed(3);
            window.lastEmbeddingsDbPath = currentDbPath;
            debug(`[DEBUG] Auto-set similarity range for new database: ${actualMinSim.toFixed(3)} - ${actualMaxSim.toFixed(3)}`);
            
            // Save the new preferences
            savePreferences();
        }
        
        heatMin = parseFloat(heatMinInput.value);
        heatMax = parseFloat(heatMaxInput.value);
    }
    
    // Apply sorting method (same for both main plot and subplots)
    let ordering = Array.from({length: dataWithEmbeddings.length}, (_, i) => i);
    
    const sortMethod = document.getElementById('embedding-sort-method').value;
    
    if (sortMethod === 'cluster' && dataWithEmbeddings.length > 1) {
        ordering = hierarchicalClustering(similarityMatrix);
        debug(`[DEBUG] Applied hierarchical clustering ${isSubplot ? 'to subplot' : 'to main plot'}`);
    } else if (sortMethod === 'performance') {
        const indexedPrograms = dataWithEmbeddings.map((p, i) => ({...p, originalIndex: i}));

        indexedPrograms.sort((a, b) => {
            const scoreA = (a.correct && a.combined_score != null) ? a.combined_score : -Infinity;
            const scoreB = (b.correct && b.combined_score != null) ? b.combined_score : -Infinity;
            return scoreB - scoreA;
        });

        ordering = indexedPrograms.map(p => p.originalIndex);
        debug(`[DEBUG] Sorted by performance ${isSubplot ? 'for subplot' : 'for main plot'}`);
    } else if (sortMethod === 'chronological') {
        // The default ordering is chronological because dataWithEmbeddings preserves the order from the original data
        debug(`[DEBUG] Sorted chronologically ${isSubplot ? 'for subplot' : 'for main plot'}`);
    }
    
    // Reorder data according to ordering
    const orderedMatrix = ordering.map(i => ordering.map(j => similarityMatrix[i][j]));
    const orderedLabelsData = ordering.map(i => labelsData[i]);
    const orderedNodeIds = ordering.map(i => nodeIds[i]);
    const orderedScores = ordering.map(i => dataWithEmbeddings[i].combined_score);
    const orderedCorrectness = ordering.map(i => dataWithEmbeddings[i].correct);
    
    // Get visualization parameters
    const cellSize = isSubplot ? Math.max(4, Math.min(parseInt(document.getElementById('cell-size').value), 8)) : parseInt(document.getElementById('cell-size').value);
    const colorScale = document.getElementById('color-scale').value;
    
    // Create color scale
    const colorScales = {
        viridis: d3.scaleSequential(d3.interpolateViridis),
        plasma: d3.scaleSequential(d3.interpolatePlasma),
        inferno: d3.scaleSequential(d3.interpolateInferno),
        magma: d3.scaleSequential(d3.interpolateMagma)
    };
    
    const colorFn = colorScales[colorScale].domain([heatMin, heatMax]);
    
    // Calculate maximum label length for proper margins
    const maxLabelLength = Math.max(...orderedLabelsData.map(label => label.name.length));
    const estimatedLabelWidth = Math.min(maxLabelLength * (isSubplot ? 4 : 6), isSubplot ? 120 : 200);
    
    // Calculate the diagonal length needed for rotated labels
    const diagonalLength = Math.sqrt(estimatedLabelWidth * estimatedLabelWidth + 100);
    
    // Set up dimensions with proper margins (smaller for subplots, no label space needed)
    const margin = {
        top: isSubplot ? 20 : diagonalLength + 10,
        right: isSubplot ? 80 : 130,
        bottom: isSubplot ? 50 : 120,
        left: isSubplot ? 20 : estimatedLabelWidth + 30
    };
    
    const heatmapWidth = orderedMatrix.length * cellSize;
    const heatmapHeight = orderedMatrix.length * cellSize;
    
    // Calculate total SVG dimensions
    const totalWidth = heatmapWidth + margin.left + margin.right;
    const totalHeight = heatmapHeight + margin.top + margin.bottom;

    if (!isSubplot) {
        container
            .style("display", "inline-block")
            .style("width", "max-content")
            .style("min-width", totalWidth + "px");
    }
    
    // Create SVG
    const svg = container
        .append("svg")
        .attr("width", totalWidth)
        .attr("height", totalHeight)
        .style("display", "block");
    
    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Create heatmap cells
    const rows = g.selectAll(".row")
        .data(orderedMatrix)
        .enter().append("g")
        .attr("class", "row")
        .attr("transform", (d, i) => `translate(0,${i * cellSize})`);
    
    const cells = rows.selectAll(".cell")
        .data(d => d)
        .enter().append("rect")
        .attr("class", "cell")
        .attr("x", (d, i) => i * cellSize)
        .attr("width", cellSize)
        .attr("height", cellSize)
        .style("fill", d => colorFn(d))
        .style("stroke", "#fff")
        .style("stroke-width", 0.5)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            const [i, j] = [
                Math.floor(d3.select(this.parentNode).datum().indexOf(d)),
                Math.floor(Array.from(this.parentNode.parentNode.children).indexOf(this.parentNode))
            ];
            
            // Show tooltip
            const tooltip = d3.select("body").append("div")
                .attr("class", "heatmap-tooltip")
                .style("position", "absolute")
                .style("background", "rgba(0,0,0,0.8)")
                .style("color", "white")
                .style("padding", "8px")
                .style("border-radius", "4px")
                .style("font-size", "12px")
                .style("pointer-events", "none")
                .style("z-index", "1000");

            const label1 = orderedLabelsData[j];
            const label2 = orderedLabelsData[i];
            
            tooltip.html(`
                <strong><b>${label1.gen}</b>: ${label1.name}</strong><br>
                <strong><b>${label2.gen}</b>: ${label2.name}</strong><br>
                Similarity: ${d.toFixed(3)}
            `)
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.selectAll(".heatmap-tooltip").remove();
        })
        .on("click", function(event, d) {
            const [i, j] = [
                Math.floor(d3.select(this.parentNode).datum().indexOf(d)),
                Math.floor(Array.from(this.parentNode.parentNode.children).indexOf(this.parentNode))
            ];
            
            // Select the node corresponding to the row
            const nodeId = orderedNodeIds[j];
            updateDetailsForNode(nodeId);

            // Visually update selection in the heatmap view
            d3.selectAll(`#${isSubplot ? container.attr('id') || 'subplot' : 'main-heatmap'} .cell`)
                .style("stroke", "#fff")
                .style("stroke-width", 0.5);
            
            d3.select(this.parentNode)
                .selectAll('.cell')
                .style("stroke", "#e58e26")
                .style("stroke-width", 2);
        });
    
    // Add performance score bar (smaller for subplots)
    const perfBarWidth = isSubplot ? 12 : 20;
    
    const perfBar = g.append("g")
        .attr("transform", `translate(${heatmapWidth + 10}, 0)`);

    perfBar.selectAll(".perf-cell")
        .data(orderedScores)
        .enter().append("rect")
        .attr("class", "perf-cell")
        .attr("y", (d, i) => i * cellSize)
        .attr("width", perfBarWidth)
        .attr("height", cellSize)
        .style("fill", (d, i) => {
            if (!orderedCorrectness[i] || d === null) {
                return "#ccc"; // Grey for incorrect or no score
            }
            return scoreColorScale(d);
        })
        .style("stroke", "#fff")
        .style("stroke-width", 0.5)
        .on("mouseover", function(event, d) {
            const i = Array.from(this.parentNode.childNodes).filter(n => n.nodeName === 'rect').indexOf(this);
            const program = dataWithEmbeddings[ordering[i]];
            
            const tooltip = d3.select("body").append("div")
                .attr("class", "heatmap-tooltip")
                .style("position", "absolute")
                .style("background", "rgba(0,0,0,0.8)")
                .style("color", "white")
                .style("padding", "8px")
                .style("border-radius", "4px")
                .style("font-size", "12px")
                .style("pointer-events", "none")
                .style("z-index", "1000");

            tooltip.html(`
                <strong>${program.metadata.patch_name || 'unnamed'}</strong><br>
                Score: ${formatScore(d)}
            `)
            .style("left", (event.pageX + 10) + "px")
            .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseout", function() {
            d3.selectAll(".heatmap-tooltip").remove();
        });

    // Add a title for the performance bar
    perfBar.append("text")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(${perfBarWidth + (isSubplot ? 45 : 50)}, ${heatmapHeight / 2}) rotate(-90)`)
        .style("font-size", isSubplot ? "11px" : "14px")
        .style("font-weight", "bold")
        .style("fill", "#333")
        .text("Score");

    
    // Add color legend
    const legendWidth = heatmapWidth;
    const legendHeight = isSubplot ? 10 : 15;
    
    const legend = svg.append("g")
        .attr("transform", `translate(${margin.left}, ${heatmapHeight + margin.top + (isSubplot ? 15 : 40)})`);
    
    const legendGradientId = isSubplot ? `legend-gradient-subplot-${Math.random().toString(36).substr(2, 9)}` : "legend-gradient";
    const legendGradient = svg.append("defs")
        .append("linearGradient")
        .attr("id", legendGradientId)
        .attr("x1", "0%")
        .attr("x2", "100%");
    
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        legendGradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", colorFn(t));
    }
    
    legend.append("rect")
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .style("fill", `url(#${legendGradientId})`)
        .style("stroke", "#333")
        .style("stroke-width", 1);
    
    legend.append("text")
        .attr("x", 0)
        .attr("y", legendHeight + (isSubplot ? 15 : 20))
        .style("font-size", isSubplot ? "10px" : "12px")
        .style("text-anchor", "start")
        .text(heatMin.toFixed(2));
    
    legend.append("text")
        .attr("x", legendWidth)
        .attr("y", legendHeight + (isSubplot ? 15 : 20))
        .style("text-anchor", "end")
        .style("font-size", isSubplot ? "10px" : "12px")
        .text(heatMax.toFixed(2));
    
    legend.append("text")
        .attr("x", legendWidth / 2)
        .attr("y", -5)
        .style("text-anchor", "middle")
        .style("font-size", isSubplot ? "12px" : "14px")
        .style("font-weight", "bold")
        .text("Cosine Sim.");

    // Add performance score legend
    if (scores.length > 0) {
        const perfLegendHeight = heatmapHeight;
        const perfLegendWidth = isSubplot ? 10 : 15;
        const perfLegend = svg.append("g")
            .attr("transform", `translate(${margin.left + heatmapWidth + 10 + perfBarWidth + (isSubplot ? 20 : 15)}, ${margin.top})`);

        const perfLegendGradientId = isSubplot ? `perf-legend-gradient-subplot-${Math.random().toString(36).substr(2, 9)}` : "perf-legend-gradient";
        const perfLegendGradient = svg.append("defs")
            .append("linearGradient")
            .attr("id", perfLegendGradientId)
            .attr("x1", "0%").attr("y1", "100%") // bottom to top
            .attr("x2", "0%").attr("y2", "0%");

        const perfSteps = 10;
        d3.range(perfSteps + 1).forEach(i => {
            const t = i / perfSteps;
            const score = minScore + t * (maxScore - minScore);
            perfLegendGradient.append("stop")
                .attr("offset", `${t * 100}%`)
                .attr("stop-color", scoreColorScale(score));
        });

        perfLegend.append("rect")
            .attr("width", perfLegendWidth)
            .attr("height", perfLegendHeight)
            .style("fill", `url(#${perfLegendGradientId})`)
            .style("stroke", "#333")
            .style("stroke-width", 1);

        perfLegend.append("text")
            .attr("x", perfLegendWidth + (isSubplot ? 3 : 5))
            .attr("y", perfLegendHeight)
            .style("font-size", isSubplot ? "9px" : "12px")
            .style("text-anchor", "start")
            .attr("dy", "0.35em")
            .style("fill", "#666")
            .text(minScore.toFixed(2));

        perfLegend.append("text")
            .attr("x", perfLegendWidth + (isSubplot ? 3 : 5))
            .attr("y", 0)
            .style("font-size", isSubplot ? "9px" : "12px")
            .style("text-anchor", "start")
            .attr("dy", "0.35em")
            .style("fill", "#666")
            .text(maxScore.toFixed(2));
    }

    // Calculate font size based on cell size to prevent overlap
    const baseFontSize = isSubplot ? 4 : 6;
    const minFontSize = isSubplot ? 3 : 4;
    const maxFontSize = isSubplot ? 8 : 14;
    // Scale font size proportionally to cell size, with reasonable bounds
    const scaledFontSize = Math.max(minFontSize, Math.min(maxFontSize, (cellSize / 8) * baseFontSize));
    
    // Add row labels (only for main plot)
    if (!isSubplot) {
        g.selectAll(".row-label")
            .data(orderedLabelsData)
            .enter().append("text")
            .attr("class", "row-label")
            .attr("x", -10)
            .attr("y", (d, i) => i * cellSize + cellSize / 2)
            .attr("dy", "0.35em")
            .style("text-anchor", "end")
            .style("font-size", `${scaledFontSize}px`)
            .style("fill", "#333")
            .text(d => `${d.gen}: ${d.name}`);
        
        // Add column labels with better positioning
        g.selectAll(".col-label")
            .data(orderedLabelsData)
            .enter().append("text")
            .attr("class", "col-label")
            .attr("transform", (d, i) => `translate(${i * cellSize + cellSize / 2}, -8) rotate(-45)`)
            .style("text-anchor", "start")
            .style("font-size", `${scaledFontSize}px`)
            .style("fill", "#333")
            .text(d => `${d.gen}: ${d.name}`);
    }
}

function mergeFullProgramData(existingData, fullData) {
    const baseData = Array.isArray(existingData) ? existingData : [];
    const fullPrograms = Array.isArray(fullData) ? fullData : [];
    const fullDataMap = new Map(fullPrograms.map(program => [program.id, program]));

    const merged = baseData.map(program => {
        const fullProgram = fullDataMap.get(program.id);
        return fullProgram ? { ...program, ...fullProgram } : program;
    });

    fullPrograms.forEach(program => {
        if (!baseData.some(existing => existing.id === program.id)) {
            merged.push(program);
        }
    });

    return merged;
}

function fullProgramDataCoversEmbeddingHydration(existingData, fullData) {
    const baseData = filterEmbeddingHeatmapData(Array.isArray(existingData) ? existingData : []);
    const fullPrograms = Array.isArray(fullData) ? fullData : [];
    const fullDataMap = new Map(fullPrograms.map(program => [program.id, program]));
    const programsNeedingEmbeddings = baseData.filter(
        program => program && program.id && !String(program.id).includes('___virtual_root')
    );

    if (programsNeedingEmbeddings.length === 0) {
        return false;
    }

    return programsNeedingEmbeddings.every(program => {
        if (embeddingFieldIsHydrated(program)) {
            return true;
        }

        return embeddingFieldIsHydrated(fullDataMap.get(program.id));
    });
}

export function refreshEmbeddingsHeatmap() {
    if (!window.treeData || window.treeData.length === 0) {
        return;
    }

    if (datasetHasHydratedEmbeddingFields(window.treeData)) {
        createEmbeddingsHeatmap(window.treeData);
        return;
    }

    ensureEmbeddingsHeatmap();
}

// Helper function to ensure embeddings heatmap is loaded
export function ensureEmbeddingsHeatmap() {
    const embeddingsView = document.getElementById('embeddings-view');
    if (!embeddingsView || !embeddingsView.classList.contains('active')) {
        return;
    }
    
    const heatmapContainer = document.getElementById('embeddings-heatmap');
    if (!heatmapContainer) {
        return;
    }
    
    const existingHeatmap = heatmapContainer.querySelector('svg');
    if (existingHeatmap && datasetHasHydratedEmbeddingFields(window.treeData)) {
        debug("[DEBUG] Embeddings heatmap already exists");
        return;
    }
    
    // If we have data but no heatmap, create it
    if (window.treeData && window.treeData.length > 0) {
        if (datasetHasHydratedEmbeddingFields(window.treeData)) {
            debug("[DEBUG] Creating embeddings heatmap with existing data");
            createEmbeddingsHeatmap(window.treeData);
        } else if (window.currentDbPath) {
            window.fullProgramDataByDb = window.fullProgramDataByDb || {};
            const cachedFullData = window.fullProgramDataByDb[window.currentDbPath];

            if (cachedFullData && fullProgramDataCoversEmbeddingHydration(window.treeData, cachedFullData)) {
                window.treeData = mergeFullProgramData(
                    window.treeData,
                    cachedFullData
                );
                window.rawDbData = mergeFullProgramData(
                    window.rawDbData,
                    cachedFullData
                );
                createEmbeddingsHeatmap(window.treeData);
                return;
            }

            if (cachedFullData) {
                debug("[DEBUG] Cached full embedding data is stale, refetching");
            }

            if (window.loadingFullEmbeddings) {
                heatmapContainer.innerHTML = '<div style="text-align: center; color: #666; margin-top: 50px;">Loading embedding data...</div>';
                return;
            }

            debug("[DEBUG] Fetching full data with embeddings for heatmap");
            heatmapContainer.innerHTML = '<div style="text-align: center; color: #666; margin-top: 50px;">Loading embedding data...</div>';
            window.loadingFullEmbeddings = true;
            
            fetch(`/get_programs?db_path=${encodeURIComponent(window.currentDbPath)}`)
                .then(r => {
                    if (!r.ok) throw new Error('Failed to load full program data');
                    return r.json();
                })
                .then(fullData => {
                    window.fullProgramDataByDb[window.currentDbPath] = fullData;
                    window.treeData = mergeFullProgramData(window.treeData, fullData);
                    window.rawDbData = mergeFullProgramData(window.rawDbData, fullData);
                    window.loadingFullEmbeddings = false;
                    debug("[DEBUG] Embeddings loaded, creating heatmap");
                    createEmbeddingsHeatmap(window.treeData);
                })
                .catch(err => {
                    console.error("[DEBUG] Failed to load embeddings:", err);
                    window.loadingFullEmbeddings = false;
                    heatmapContainer.innerHTML = '<div style="text-align: center; color: #dc3545; margin-top: 50px;">Failed to load embedding data.</div>';
                });
        }
    } else {
        // Show loading message
        heatmapContainer.innerHTML = '<div style="text-align: center; color: #666; margin-top: 50px;">Waiting for data to load...</div>';
    }
}
