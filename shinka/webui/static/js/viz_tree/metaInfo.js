// Meta tab: run overview, score and cost charts.
import { debug } from '../log.js';
import { renderGraph } from './tree.js';
import { loadDatabase, processData } from './loader.js';
import { escapeHtml } from './format.js';
import { selectNodeById } from './selection.js';
import { createIslandsVisualization } from './islands.js';

// Declared here: the original script assigned these without declaring them.
let cumulativeAgentCosts = [];
let cumulativeSolutionCosts = [];

// Global variables for chart data and instances
let cumulativeMaxScores = [];
let cumulativeMeanScores = [];
let cumulativeTotalCosts = [];
let cumulativeApiCosts = [];
let cumulativeEmbedCosts = [];
let cumulativeNoveltyCosts = [];
let cumulativeMetaCosts = [];
let cumulativePromptCosts = [];
let generationCosts = [];
let generationEmbedCosts = [];
let generationNoveltyCosts = [];
let generationMetaCosts = [];
let generationPromptCosts = [];
let generationRuntimes = [];
let individualScores = []; // Added array to store individual performance scores
let bestPathScores = [];
let cumulativeRuntimes = [];
let scoreChartInstance = null;
let costChartInstance = null;
let scoreBudgetChartInstance = null;
let scoreRuntimeChartInstance = null;
let runtimeChartInstance = null;

function getCurrentResultsDir() {
    if (!window.currentDbPath) {
        return null;
    }

    const normalizedPath = String(window.currentDbPath).replace(/\\/g, '/');
    const lastSlash = normalizedPath.lastIndexOf('/');
    if (lastSlash === -1) {
        return normalizedPath;
    }
    return normalizedPath.slice(0, lastSlash);
}

// Initialize the Meta Info tab with default content
function initializeMetaInfoTab() {
    const resultsDir = getCurrentResultsDir();
    const metaTitle = resultsDir ? `Info: <code>${escapeHtml(resultsDir)}</code>` : 'Info';
    document.getElementById("agent-info").innerHTML = `
        <h3 id="meta-info-title">${metaTitle}</h3>
        <p id="meta-placeholder" class="placeholder-text">Loading data... Select a CSV file to visualize metrics.</p>
        
        <div style="display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 20px;">
            <div style="flex: 1; min-width: 200px; background-color: #f8f9fa; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <h4 style="margin-top: 0;">Overview</h4>
                <p><strong>Total Generations:</strong> <span id="meta-total-generations">N/A</span></p>
                <p><strong>Correct:</strong> <span id="meta-correct-programs">N/A</span></p>
                <p><strong>Total Cost:</strong> <span id="meta-total-cost">N/A</span></p>
                <p><strong>Avg Cost/Program:</strong> <span id="meta-cost-avg">N/A</span></p>
            </div>
            
            <div style="flex: 1; min-width: 150px; background-color: #f8f9fa; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <h4 style="margin-top: 0;">Best Solution</h4>
                <p><strong>Best Score:</strong> <span id="meta-best-score" class="metric-good">N/A</span></p>
                <p><strong>Name:</strong> <span id="meta-best-agent-name" class="truncated-name-span">N/A</span></p>
                <p><strong>Generation:</strong> <span id="meta-best-agent-gen">N/A</span></p>
                <p><strong>Island:</strong> <span id="meta-best-agent-island">N/A</span></p>
            </div>
            
            <div style="flex: 1; min-width: 100px; background-color: #f8f9fa; padding: 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                <h4 style="margin-top: 0;">Cost Breakdown</h4>
                <p><strong>API Cost:</strong> <span id="meta-cost-api">N/A</span></p>
                <p><strong>Embed Cost:</strong> <span id="meta-cost-embed">N/A</span></p>
                <p><strong>Novelty Cost:</strong> <span id="meta-cost-novelty">N/A</span></p>
                <p><strong>Meta Cost:</strong> <span id="meta-cost-meta">N/A</span></p>
                <p><strong>PromptEvo Cost:</strong> <span id="meta-cost-prompt">N/A</span></p>
            </div>
    </div>

    <div id="selected-node-details" style="display: none;"></div>

    <div style="display: flex; flex-wrap: wrap; margin-top: 20px;">
        <div style="width: 100%; margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">Performance Score Across Program Evaluations</h4>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <label for="score-y-min">Min:</label>
                        <input type="number" id="score-y-min" style="width: 70px; padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;" placeholder="Auto" oninput="setTimeout(() => createCharts(null), 10)" step="0.1">
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <label for="score-y-max">Max:</label>
                        <input type="number" id="score-y-max" style="width: 70px; padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;" placeholder="Auto" oninput="setTimeout(() => createCharts(null), 10)" step="0.1">
                    </div>
                </div>
            </div>
            <div style="height: 250px; position: relative;">
                <canvas id="scoreChart" width="400" height="250"></canvas>
            </div>
        </div>
        <div style="width: 100%; margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">Performance Score Across API Budget</h4>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <label for="score-budget-y-min">Min:</label>
                        <input type="number" id="score-budget-y-min" style="width: 70px; padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;" placeholder="Auto" oninput="setTimeout(() => createCharts(null), 10)" step="0.1">
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <label for="score-budget-y-max">Max:</label>
                        <input type="number" id="score-budget-y-max" style="width: 70px; padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;" placeholder="Auto" oninput="setTimeout(() => createCharts(null), 10)" step="0.1">
                    </div>
                </div>
            </div>
            <div style="height: 250px; position: relative;">
                <canvas id="scoreBudgetChart" width="400" height="250"></canvas>
            </div>
        </div>
        <div style="width: 100%; margin-bottom: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <h4 style="margin: 0;">Performance Score Across ShinkaEvolve Runtime</h4>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <label for="score-runtime-y-min">Min:</label>
                        <input type="number" id="score-runtime-y-min" style="width: 70px; padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;" placeholder="Auto" oninput="setTimeout(() => createCharts(null), 10)" step="0.1">
                    </div>
                    <div style="display: flex; align-items: center; gap: 5px; font-size: 14px;">
                        <label for="score-runtime-y-max">Max:</label>
                        <input type="number" id="score-runtime-y-max" style="width: 70px; padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;" placeholder="Auto" oninput="setTimeout(() => createCharts(null), 10)" step="0.1">
                    </div>
                </div>
            </div>
            <div style="height: 250px; position: relative;">
                <canvas id="scoreRuntimeChart" width="400" height="250"></canvas>
            </div>
        </div>
        <div style="width: 100%; margin-bottom: 20px;">
            <h4 style="margin-top: 15px;">Cumulative API Cost Breakdown</h4>
            <div style="height: 250px; position: relative;">
                <canvas id="costChart" width="400" height="250"></canvas>
            </div>
        </div>
        <div style="width: 100%; margin-bottom: 20px;">
            <h4 style="margin-top: 15px;">Cumulative Runtime Across Program Evaluations</h4>
            <div style="height: 250px; position: relative;">
                <canvas id="runtimeChart" width="400" height="250"></canvas>
            </div>
        </div>
    </div>
    `;
}
// Update the Meta Info tab with global data
export function updateMetaInfoTab(data) {
    debug("[DEBUG] Updating Meta Info tab with data");

    // First, ensure the tab is set up with the correct HTML structure
    initializeMetaInfoTab();

    const metaTitle = document.getElementById('meta-info-title');
    const resultsDir = getCurrentResultsDir();
    if (metaTitle) {
        metaTitle.innerHTML = resultsDir ? `Info: <code>${escapeHtml(resultsDir)}</code>` : 'Info';
    }

    // Ensure metric arrays are initialized for this update cycle
    cumulativeMaxScores = [];
    cumulativeMeanScores = [];
    cumulativeTotalCosts = [];
    cumulativeApiCosts = [];
    cumulativeEmbedCosts = [];
    cumulativeNoveltyCosts = [];
    cumulativeMetaCosts = [];
    cumulativePromptCosts = [];
    cumulativeRuntimes = [];
    generationCosts = [];
    generationEmbedCosts = [];
    generationNoveltyCosts = [];
    generationMetaCosts = [];
    generationPromptCosts = [];
    generationRuntimes = [];
    individualScores = []; // Reset individual scores array
    bestPathScores = [];
    let allScoresForMeanCalc = [];
    
    // Hide placeholder
    const placeholder = document.getElementById("meta-placeholder");
    if (placeholder) placeholder.style.display = 'none';
    
    // Calculate overall statistics
    const generations = [...new Set(data.map(d => d.generation))].sort((a, b) => a - b);
    const numGenerations = generations.length;
    const numAgents = data.length;
    
    // Filter valid scores
    const validScores = data.filter(d => d.correct)
        .map(d => d.combined_score)
        .filter(s => s !== null && s !== undefined && !isNaN(parseFloat(s)))
        .map(s => parseFloat(s));
    
    // Determine best score based on max selection
    const bestScore = validScores.length > 0 ? 
        Math.max(...validScores) : 'N/A';
    
    // Find the agent with the best score
    let bestAgent = null;
    if (validScores.length > 0 && typeof bestScore === 'number') {
        bestAgent = data.find(d => parseFloat(d.combined_score) === bestScore);
    }
    
    if (bestAgent) {
        const nodeMap = new Map(data.map(node => [node.id, node]));
        const path = [];
        let currentNode = bestAgent;
        while (currentNode) {
            path.unshift(currentNode);
            currentNode = nodeMap.get(currentNode.parent_id);
        }
        bestPathScores = path.map(node => ({
            x: node.generation,
            y: node.combined_score,
            id: node.id,
            agent_name: node.metadata.patch_name || 'unnamed'
        }));
    }

    // Calculate total costs
    let totalApiCostNum = 0;
    let totalEmbedCostNum = 0;
    let totalNoveltyCostNum = 0;
    let totalMetaCostNum = 0;
    let totalPromptCostNum = 0;
    data.forEach(d => {
        const apiCost = d.metadata?.api_costs ? parseFloat(d.metadata.api_costs) : 0;
        const embedCost = d.metadata?.embed_cost ? parseFloat(d.metadata.embed_cost) : 0;
        const noveltyCost = d.metadata?.novelty_cost ? parseFloat(d.metadata.novelty_cost) : 0;
        const metaCost = d.metadata?.meta_cost ? parseFloat(d.metadata.meta_cost) : 0;
        totalApiCostNum += isNaN(apiCost) ? 0 : apiCost;
        totalEmbedCostNum += isNaN(embedCost) ? 0 : embedCost;
        totalNoveltyCostNum += isNaN(noveltyCost) ? 0 : noveltyCost;
        totalMetaCostNum += isNaN(metaCost) ? 0 : metaCost;
    });
    // Calculate total prompt evolution cost from metaPromptData
    if (window.metaPromptData && Array.isArray(window.metaPromptData)) {
        window.metaPromptData.forEach(prompt => {
            if (prompt.metadata && prompt.metadata.llm && typeof prompt.metadata.llm.cost === 'number') {
                totalPromptCostNum += prompt.metadata.llm.cost;
            }
        });
    }
    const totalCombinedCost = totalApiCostNum + totalEmbedCostNum + totalNoveltyCostNum + totalMetaCostNum + totalPromptCostNum;

    // Calculate cumulative minimum and maximum scores for each generation
    let currentMax = -Infinity;
    
    generations.forEach(genId => {
        const genData = data.filter(d => d.generation === genId);
        const genScores = genData.filter(d => d.correct).map(d => {
            const score = d.combined_score;
            if (score === null || score === undefined) {
                return null;
            }
            const numScore = typeof score === 'string' ? parseFloat(score) : score;
            return isNaN(numScore) ? null : numScore;
        })
        .filter(s => s !== null);
        
        // Add individual data points for each valid score in this generation
        genData.forEach(d => {
            const score = d.combined_score;
            if (score !== null && score !== undefined && d.correct) {
                const numScore = typeof score === 'string' ? parseFloat(score) : score;
                if (!isNaN(numScore)) {
                    individualScores.push({
                        x: genId,
                        y: numScore,
                        id: d.id,
                        agent_name: d.metadata?.patch_name || 'unnamed',
                        iter_id: d.iter_id
                    });
                }
            }
        });
        
        if (genScores.length > 0) {
            const maxScore = Math.max(...genScores);
            currentMax = Math.max(currentMax, maxScore);
            allScoresForMeanCalc.push(...genScores);
        }
        
        if (currentMax !== -Infinity) {
            cumulativeMaxScores.push({ 
                x: genId, 
                y: currentMax
            });
        }

        if (allScoresForMeanCalc.length > 0) {
            const meanScore = allScoresForMeanCalc.reduce((a, b) => a + b, 0) / allScoresForMeanCalc.length;
            cumulativeMeanScores.push({
                x: genId,
                y: meanScore
            });
        }
    });
    
    // Calculate cumulative costs using api_costs, embed_cost, novelty_cost, and meta_cost from metadata
    let cumulativeCost = 0;
    let cumulativeApiCost = 0;
    let cumulativeEmbedCost = 0;
    let cumulativeNoveltyCost = 0;
    let cumulativeMetaCost = 0;
    let cumulativePromptCost = 0;
    let cumulativeRuntime = 0;
    
    // Pre-calculate prompt costs per program generation from window.metaPromptData
    const promptCostsByGen = {};
    if (window.metaPromptData && Array.isArray(window.metaPromptData)) {
        window.metaPromptData.forEach(prompt => {
            const progGen = prompt.program_generation || 0;
            // Extract cost from metadata.llm.cost
            let promptCost = 0;
            if (prompt.metadata && prompt.metadata.llm && typeof prompt.metadata.llm.cost === 'number') {
                promptCost = prompt.metadata.llm.cost;
            }
            if (!promptCostsByGen[progGen]) {
                promptCostsByGen[progGen] = 0;
            }
            promptCostsByGen[progGen] += promptCost;
        });
        debug("[DEBUG] Prompt costs by generation:", promptCostsByGen);
    }
    
    generations.forEach(genId => {
        const genData = data.filter(d => d.generation === genId);
        let genCost = 0;
        let genEmbedCost = 0;
        let genNoveltyCost = 0;
        let genMetaCost = 0;
        let genPromptCost = promptCostsByGen[genId] || 0;
        let genRuntime = 0;
        
        genData.forEach(d => {
            const cost = d.metadata && d.metadata.api_costs ? parseFloat(d.metadata.api_costs) : 0;
            const embedCost = d.metadata && d.metadata.embed_cost ? parseFloat(d.metadata.embed_cost) : 0;
            const noveltyCost = d.metadata && d.metadata.novelty_cost ? parseFloat(d.metadata.novelty_cost) : 0;
            const metaCost = d.metadata && d.metadata.meta_cost ? parseFloat(d.metadata.meta_cost) : 0;
            const computeTime = d.metadata && d.metadata.compute_time ? parseFloat(d.metadata.compute_time) : 0;
            genCost += isNaN(cost) ? 0 : cost;
            genEmbedCost += isNaN(embedCost) ? 0 : embedCost;
            genNoveltyCost += isNaN(noveltyCost) ? 0 : noveltyCost;
            genMetaCost += isNaN(metaCost) ? 0 : metaCost;
            genRuntime += isNaN(computeTime) ? 0 : computeTime;
            
            // Debug logging for first few items
            if (genData.indexOf(d) < 2) {
                debug("[DEBUG] Gen", genId, "Program:", d.id.substring(0, 8), 
                          "API Cost:", cost, "Embed Cost:", embedCost, "Novelty Cost:", noveltyCost, "Meta Cost:", metaCost,
                          "Metadata keys:", d.metadata ? Object.keys(d.metadata) : 'no metadata');
            }
        });
        
        debug("[DEBUG] Generation", genId, "Total API Cost:", genCost, "Total Embed Cost:", genEmbedCost, "Total Novelty Cost:", genNoveltyCost, "Total Meta Cost:", genMetaCost, "Prompt Cost:", genPromptCost);
        
        generationCosts.push({
            x: genId,
            y: genCost
        });

        generationEmbedCosts.push({
            x: genId,
            y: genEmbedCost
        });

        generationNoveltyCosts.push({
            x: genId,
            y: genNoveltyCost
        });

        generationMetaCosts.push({
            x: genId,
            y: genMetaCost
        });

        generationPromptCosts.push({
            x: genId,
            y: genPromptCost
        });

        generationRuntimes.push({
            x: genId,
            y: genRuntime
        });

        cumulativeApiCost += genCost;
        cumulativeEmbedCost += genEmbedCost;
        cumulativeNoveltyCost += genNoveltyCost;
        cumulativeMetaCost += genMetaCost;
        cumulativePromptCost += genPromptCost;
        cumulativeRuntime += genRuntime;
        cumulativeCost += (genCost + genEmbedCost + genNoveltyCost + genMetaCost + genPromptCost);
        
        cumulativeApiCosts.push({
            x: genId,
            y: cumulativeApiCost
        });
        
        cumulativeEmbedCosts.push({
            x: genId,
            y: cumulativeEmbedCost
        });

        cumulativeNoveltyCosts.push({
            x: genId,
            y: cumulativeNoveltyCost
        });

        cumulativeMetaCosts.push({
            x: genId,
            y: cumulativeMetaCost
        });

        cumulativePromptCosts.push({
            x: genId,
            y: cumulativePromptCost
        });
        
        cumulativeTotalCosts.push({
            x: genId,
            y: cumulativeCost
        });
        
        cumulativeRuntimes.push({
            x: genId,
            y: cumulativeRuntime
        });
    });
    
    // Clear other cost arrays as they are no longer used
    cumulativeAgentCosts = [];
    cumulativeSolutionCosts = [];
    
    // Add detailed logging before updating DOM
    debug("[DEBUG] Calculated Stats:", {
        numGenerations,
        numAgents,
        totalCost: totalApiCostNum.toFixed(2),
        bestScore: typeof bestScore === 'number' ? bestScore.toFixed(6) : bestScore,
        bestAgentName: bestAgent ? bestAgent.agent_name : 'N/A',
        bestAgentGen: bestAgent ? bestAgent.gen_id : 'N/A',
        bestAgentIter: bestAgent ? bestAgent.iter_id : 'N/A',
    });

    // Update Overview section
    document.getElementById('meta-total-generations').textContent = numGenerations;
    
    // Calculate and update success rate (correct programs / total agents)
    const correctAgents = data.filter(d => d.correct).length;
    const correctRate = numAgents > 0 ? (correctAgents / numAgents) * 100 : 0;
    document.getElementById('meta-correct-programs').textContent = 
        `${correctRate.toFixed(1)}% (${correctAgents}/${numAgents})`;
    
    document.getElementById('meta-total-cost').textContent = '$' + totalCombinedCost.toFixed(4);

    // Update Best Solution section
    const bestScoreEl = document.getElementById('meta-best-score');
    bestScoreEl.textContent = typeof bestScore === 'number' ? bestScore.toFixed(6) : bestScore;
    bestScoreEl.className = typeof bestScore === 'number' ? 'metric-good' : '';
    
    const bestAgentName = bestAgent ? (bestAgent.metadata.patch_name || 'unnamed') : 'N/A';
    document.getElementById('meta-best-agent-name').textContent = bestAgentName;
    document.getElementById('meta-best-agent-gen').textContent = bestAgent ? bestAgent.generation : 'N/A';
    document.getElementById('meta-best-agent-island').textContent = bestAgent ? bestAgent.island_idx : 'N/A';

    // Update Cost Breakdown section
    document.getElementById('meta-cost-api').textContent = '$' + totalApiCostNum.toFixed(4);
    document.getElementById('meta-cost-embed').textContent = '$' + totalEmbedCostNum.toFixed(4);
    document.getElementById('meta-cost-novelty').textContent = '$' + totalNoveltyCostNum.toFixed(4);
    document.getElementById('meta-cost-meta').textContent = '$' + totalMetaCostNum.toFixed(4);
    document.getElementById('meta-cost-prompt').textContent = '$' + totalPromptCostNum.toFixed(4);
    document.getElementById('meta-cost-avg').textContent = numAgents > 0 ? '$' + (totalCombinedCost / numAgents).toFixed(4) : 'N/A';
    
    debug("[DEBUG] Meta Info tab text content updated");
}
// Create charts for the Meta Info tab
export function createCharts(currentGenId) {
    debug("[DEBUG] Creating charts, currentGenId:", currentGenId);
    
    // Skip chart creation during panel resizing
    if (window.isResizing) {
        debug("[DEBUG] Skipping chart creation during resize");
        return;
    }
    
    try {
        // Check if Chart.js is loaded
        if (typeof Chart === 'undefined') {
            console.error("[DEBUG] Chart.js is not loaded!");
            return;
        }
        
        // Also update the best solution panel when chart type changes
        if (!currentGenId) {
            // Get all available data
            const allData = window.treeData || [];
            if (allData.length > 0) {
                updateBestSolutionPanel(allData);
            }
        }
        
        // Get canvas elements
        const scoreCanvas = document.getElementById('scoreChart');
        const scoreBudgetCanvas = document.getElementById('scoreBudgetChart');
        const scoreRuntimeCanvas = document.getElementById('scoreRuntimeChart');
        const costCanvas = document.getElementById('costChart');
        const runtimeCanvas = document.getElementById('runtimeChart');
        
        if (!scoreCanvas || !scoreBudgetCanvas || !scoreRuntimeCanvas || !costCanvas || !runtimeCanvas) {
            console.error("[DEBUG] Canvas elements not found!");
            return;
        }
        
        // Ensure canvas is visible and properly sized before attempting to draw
        if (scoreCanvas.offsetWidth === 0 || scoreBudgetCanvas.offsetWidth === 0 || costCanvas.offsetWidth === 0 || runtimeCanvas.offsetWidth === 0) {
            console.error("[DEBUG] Canvas has zero width, tab may not be visible");
            // Force redraw after a short delay to allow DOM to update
            setTimeout(() => createCharts(currentGenId), 500);
            return;
        }
        
        debug("[DEBUG] Canvas dimensions - scoreChart:", 
                  scoreCanvas.offsetWidth, "x", scoreCanvas.offsetHeight,
                  "scoreBudgetChart:", scoreBudgetCanvas.offsetWidth, "x", scoreBudgetCanvas.offsetHeight,
                  "scoreRuntimeChart:", scoreRuntimeCanvas.offsetWidth, "x", scoreRuntimeCanvas.offsetHeight,
                  "costChart:", costCanvas.offsetWidth, "x", costCanvas.offsetHeight,
                  "runtimeChart:", runtimeCanvas.offsetWidth, "x", runtimeCanvas.offsetHeight);
        
        // Clear existing canvases to force redraw
        const clearCanvas = (canvas) => {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        };
        
        clearCanvas(scoreCanvas);
        clearCanvas(scoreBudgetCanvas);
        clearCanvas(costCanvas);
        clearCanvas(runtimeCanvas);
        
        // Filter data to ensure it's valid for Chart.js
        const validScoreData = (cumulativeMaxScores || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
        
        const validCumulativeMeanScoreData = (cumulativeMeanScores || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
        
        const validIndividualScoreData = (individualScores || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({
                x: item.x, 
                y: parseFloat(item.y),
                id: item.id,
                agent_name: item.agent_name,
                iter_id: item.iter_id
            }));
        
        const validBestPathScoreData = (bestPathScores || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y), id: item.id, agent_name: item.agent_name}));

        const validAgentCostData = (cumulativeAgentCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
            
        const validSolutionCostData = (cumulativeSolutionCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
            
        const validTotalCostData = (cumulativeTotalCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
        
        const validGenerationCostData = (generationCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validEmbedCostData = (generationEmbedCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validNoveltyCostData = (generationNoveltyCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validCumulativeApiCostData = (cumulativeApiCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validCumulativeEmbedCostData = (cumulativeEmbedCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validCumulativeNoveltyCostData = (cumulativeNoveltyCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validMetaCostData = (generationMetaCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validCumulativeMetaCostData = (cumulativeMetaCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validPromptCostData = (generationPromptCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        const validCumulativePromptCostData = (cumulativePromptCosts || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));

        debug("[DEBUG] Valid score data points:", validScoreData.length);
        debug("[DEBUG] Valid agent cost data points:", validAgentCostData.length);
        debug("[DEBUG] Valid solution cost data points:", validSolutionCostData.length);
        debug("[DEBUG] Valid total cost data points:", validTotalCostData.length);
        debug("[DEBUG] Valid generation cost data points:", validGenerationCostData.length);
        debug("[DEBUG] Valid embed cost data points:", validEmbedCostData.length);
        debug("[DEBUG] Valid novelty cost data points:", validNoveltyCostData.length);
        debug("[DEBUG] Valid meta cost data points:", validMetaCostData.length);
        debug("[DEBUG] Valid prompt cost data points:", validPromptCostData.length);
        
        if (validScoreData.length === 0 && validTotalCostData.length === 0) {
            console.error("[DEBUG] No valid data for charts!");
            // Display a message on the canvas
            const displayNoDataMessage = (canvas, message) => {
                const ctx = canvas.getContext('2d');
                ctx.font = '14px Arial';
                ctx.fillStyle = '#666';
                ctx.textAlign = 'center';
                ctx.fillText(message, canvas.width / 2, canvas.height / 2);
            };
            
            displayNoDataMessage(scoreCanvas, 'No valid score data available');
            displayNoDataMessage(costCanvas, 'No valid cost data available');
            return;
        }
        
        // Create score chart if we have valid data
        if (validScoreData.length > 0) {
            debug("[DEBUG] Creating score chart with", validScoreData.length, "points");
            debug("[DEBUG] Adding", validIndividualScoreData.length, "individual score points");
            
            // Read Y-axis min/max values first, for cleaner debugging
            const yMinValue = document.getElementById('score-y-min').value;
            const yMaxValue = document.getElementById('score-y-max').value;
            const yMin = yMinValue !== '' ? parseFloat(yMinValue) : undefined;
            const yMax = yMaxValue !== '' ? parseFloat(yMaxValue) : undefined;
            
            debug("[DEBUG] Y-axis settings - Min:", yMin, "Max:", yMax);
            
            // Destroy existing chart instance if it exists
            if (scoreChartInstance) {
                scoreChartInstance.destroy();
                scoreChartInstance = null;
            }
            
            // Create a new chart with the updated Y-axis settings
            scoreChartInstance = new Chart(scoreCanvas, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Cumulative Max',
                            data: validScoreData,
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            borderWidth: 2,
                            pointBackgroundColor: validScoreData.map(p => p.x === currentGenId ? '#e74c3c' : '#3498db'),
                            pointRadius: validScoreData.map(p => p.x === currentGenId ? 6 : 4),
                            pointHoverRadius: 8,
                            fill: false,
                            tension: 0.2
                        },
                        {
                            label: 'Best Path',
                            data: validBestPathScoreData,
                            borderColor: '#ff8c00',
                            backgroundColor: 'rgba(255, 140, 0, 0.1)',
                            borderWidth: 3,
                            pointRadius: 5,
                            pointHoverRadius: 7,
                            fill: false,
                            tension: 0.2,
                            type: 'line'
                        },
                        {
                            label: 'Cumulative Mean',
                            data: validCumulativeMeanScoreData,
                            borderColor: '#2ecc71',
                            borderWidth: 2,
                            pointRadius: 0,
                            fill: false,
                            tension: 0.2
                        },
                        {
                            label: 'Individual Solutions',
                            data: validIndividualScoreData,
                            type: 'scatter',
                            backgroundColor: 'rgba(231, 76, 60, 0.5)',
                            borderColor: 'rgba(231, 76, 60, 0.8)',
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            borderWidth: 1,
                            showLine: false
                        }
                    ]
                },
                options: {
                    onClick: (evt, elements, chart) => {
                        if (elements.length === 0) return;
                        const firstPoint = elements[0];
                        const datasetIndex = firstPoint.datasetIndex;
                        const index = firstPoint.index;

                        if (datasetIndex === 2) { // Individual Solution Scores
                            const dataPoint = validIndividualScoreData[index];
                            if (dataPoint && dataPoint.id) {
                                selectNodeById(dataPoint.id);
                            }
                        } else if (datasetIndex === 0) { // Cumulative Max Score
                            const generation = chart.data.datasets[datasetIndex].data[index].x;
                            if (generation !== undefined && window.treeData) {
                                const programsInGen = window.treeData.filter(p => p.generation === generation && p.correct);
                                if (programsInGen.length > 0) {
                                    const bestProgramInGen = programsInGen.reduce((best, current) => {
                                        const bestScore = best.combined_score ?? -Infinity;
                                        const currentScore = current.combined_score ?? -Infinity;
                                        return currentScore > bestScore ? current : best;
                                    });
                                    if (bestProgramInGen && bestProgramInGen.id) {
                                        selectNodeById(bestProgramInGen.id);
                                    }
                                }
                            }
                        } else if (datasetIndex === 1) { // Best Path Score
                            const dataPoint = validBestPathScoreData[index];
                            if (dataPoint && dataPoint.id) {
                                selectNodeById(dataPoint.id);
                            }
                        }
                    },
                    onHover: (event, elements, chart) => {
                        const canvas = chart.canvas;
                        // Set cursor to pointer for any point on the chart
                        canvas.style.cursor = (elements.length > 0) ? 'pointer' : 'default';
                    },
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Number of LLM Proposals/Program Evaluations'
                            },
                            ticks: {
                                stepSize: 1
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Combined Score (⬆ is better)'
                            },
                            min: yMin,
                            max: yMax
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    if (items.length === 0) return '';
                                    const item = items[0];
                                    if (item.datasetIndex === 2) { // Individual score dataset
                                        const dataPoint = validIndividualScoreData[item.dataIndex];
                                        if (dataPoint && dataPoint.agent_name) {
                                            return `Generation ${item.parsed.x}, Agent: ${dataPoint.agent_name}`;
                                        }
                                    }
                                    if (item.datasetIndex === 1) { // Best path score dataset
                                        const dataPoint = validBestPathScoreData[item.dataIndex];
                                        if (dataPoint && dataPoint.agent_name) {
                                            return `Best Path: ${dataPoint.agent_name} (Gen ${item.parsed.x})`;
                                        }
                                        return `Best Path at Generation ${item.parsed.x}`;
                                    }
                                    return `Generation ${item.parsed.x}`;
                                },
                                label: (item) => {
                                    if (item.datasetIndex === 2) { // Individual score dataset
                                        return `Score: ${item.parsed.y?.toFixed(6) || 'N/A'}`;
                                    }
                                    if (item.datasetIndex === 1) { // Best path score dataset
                                        const dataPoint = validBestPathScoreData[item.dataIndex];
                                        if (dataPoint && dataPoint.y !== undefined && dataPoint.y !== null) {
                                            return `Best Path Score: ${dataPoint.y.toFixed(6)}`;
                                        }
                                        return 'Best Path Score: N/A';
                                    }
                                    return `Score: ${item.parsed.y?.toFixed(6) || 'N/A'}`;
                                }
                            }
                        }
                    }
                }
            });
            
            debug("[DEBUG] Score chart created");
        }
        
        // Create score budget chart (scores vs cumulative cost)
        try {
        if (validScoreData.length > 0 && validTotalCostData.length > 0) {
            debug("[DEBUG] Creating score budget chart");
            
            // Map score data to cumulative total cost (including prompt costs) instead of generation
            // For each score point, find the cumulative total cost at that generation
            const scoreBudgetMaxData = validScoreData.map(point => {
                const costPoint = validTotalCostData.find(c => c.x === point.x);
                if (costPoint) {
                    return {x: costPoint.y, y: point.y};
                }
                return null;
            }).filter(p => p !== null);
            
            const scoreBudgetMeanData = validCumulativeMeanScoreData.map(point => {
                const costPoint = validTotalCostData.find(c => c.x === point.x);
                if (costPoint) {
                    return {x: costPoint.y, y: point.y};
                }
                return null;
            }).filter(p => p !== null);
            
            const scoreBudgetIndividualData = validIndividualScoreData.map(point => {
                const costPoint = validTotalCostData.find(c => c.x === point.x);
                if (costPoint) {
                    return {
                        x: costPoint.y, 
                        y: point.y,
                        id: point.id,
                        agent_name: point.agent_name,
                        iter_id: point.iter_id,
                        generation: point.x
                    };
                }
                return null;
            }).filter(p => p !== null);
            
            const scoreBudgetBestPathData = validBestPathScoreData.map(point => {
                const costPoint = validTotalCostData.find(c => c.x === point.x);
                if (costPoint) {
                    return {
                        x: costPoint.y, 
                        y: point.y, 
                        id: point.id, 
                        agent_name: point.agent_name,
                        generation: point.x
                    };
                }
                return null;
            }).filter(p => p !== null);
            
            // Read Y-axis min/max values
            const yMinBudgetValue = document.getElementById('score-budget-y-min').value;
            const yMaxBudgetValue = document.getElementById('score-budget-y-max').value;
            const yMinBudget = yMinBudgetValue !== '' ? parseFloat(yMinBudgetValue) : undefined;
            const yMaxBudget = yMaxBudgetValue !== '' ? parseFloat(yMaxBudgetValue) : undefined;
            
            debug("[DEBUG] Score Budget Y-axis settings - Min:", yMinBudget, "Max:", yMaxBudget);
            
            // Calculate tight x-axis bounds based on cumulative API cost data
            const allCostValues = [
                ...scoreBudgetMaxData.map(p => p.x),
                ...scoreBudgetMeanData.map(p => p.x),
                ...scoreBudgetIndividualData.map(p => p.x),
                ...scoreBudgetBestPathData.map(p => p.x)
            ];
            const minCost = Math.max(-0.1, Math.min(...allCostValues) - 0.025); // Add slack but don't go below -0.025
            const maxCost = Math.max(...allCostValues) + 0.025;
            
            debug("[DEBUG] Score Budget X-axis range - Min cost:", minCost, "Max cost:", maxCost);
            
            // Destroy existing chart instance if it exists
            if (scoreBudgetChartInstance) {
                scoreBudgetChartInstance.destroy();
                scoreBudgetChartInstance = null;
            }
            
            // Create the chart
            scoreBudgetChartInstance = new Chart(scoreBudgetCanvas, {
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Cumulative Max',
                            data: scoreBudgetMaxData,
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            borderWidth: 2,
                            pointRadius: 4,
                            pointHoverRadius: 8,
                            fill: false,
                            tension: 0.2
                        },
                        {
                            label: 'Best Path',
                            data: scoreBudgetBestPathData,
                            borderColor: '#ff8c00',
                            backgroundColor: 'rgba(255, 140, 0, 0.1)',
                            borderWidth: 3,
                            pointRadius: 5,
                            pointHoverRadius: 7,
                            fill: false,
                            tension: 0.2,
                            type: 'line'
                        },
                        {
                            label: 'Cumulative Mean',
                            data: scoreBudgetMeanData,
                            borderColor: '#2ecc71',
                            borderWidth: 2,
                            pointRadius: 0,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.2
                        },
                        {
                            label: 'Individual Scores',
                            data: scoreBudgetIndividualData,
                            borderColor: 'transparent',
                            backgroundColor: 'rgba(0, 0, 0, 0.15)',
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            showLine: false
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Cumulative Total Cost ($): Σ Proposal, Embed, Novelty, Meta, Prompt'
                            },
                            min: minCost,
                            max: maxCost
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'Combined Score (⬆ is better)'
                            },
                            min: yMinBudget,
                            max: yMaxBudget
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    if (items.length === 0) return '';
                                    const item = items[0];
                                    if (item.datasetIndex === 3) { // Individual score dataset
                                        const dataPoint = scoreBudgetIndividualData[item.dataIndex];
                                        if (dataPoint && dataPoint.agent_name) {
                                            return `Cost: $${item.parsed.x.toFixed(2)}, Agent: ${dataPoint.agent_name} (Gen ${dataPoint.generation})`;
                                        }
                                    }
                                    if (item.datasetIndex === 1) { // Best path score dataset
                                        const dataPoint = scoreBudgetBestPathData[item.dataIndex];
                                        if (dataPoint && dataPoint.agent_name) {
                                            return `Best Path: ${dataPoint.agent_name} (Gen ${dataPoint.generation}, Cost: $${item.parsed.x.toFixed(2)})`;
                                        }
                                        return `Best Path at Cost $${item.parsed.x.toFixed(2)}`;
                                    }
                                    return `Cumulative Cost: $${item.parsed.x.toFixed(2)}`;
                                },
                                label: (item) => {
                                    if (item.datasetIndex === 3) { // Individual score dataset
                                        return `Score: ${item.parsed.y?.toFixed(6) || 'N/A'}`;
                                    }
                                    if (item.datasetIndex === 1) { // Best path score dataset
                                        const dataPoint = scoreBudgetBestPathData[item.dataIndex];
                                        if (dataPoint && dataPoint.y !== undefined && dataPoint.y !== null) {
                                            return `Best Path Score: ${dataPoint.y.toFixed(6)}`;
                                        }
                                        return 'Best Path Score: N/A';
                                    }
                                    return `Score: ${item.parsed.y?.toFixed(6) || 'N/A'}`;
                                }
                            }
                        }
                    }
                }
            });
            
            debug("[DEBUG] Score budget chart created");
        }
        } catch (error) {
            console.error("[ERROR] Score budget chart creation failed:", error);
        }
        
        // Create score runtime chart (scores vs timestamp)
        try {
        const allData = window.rawDbData || window.treeData || [];
        if (validScoreData.length > 0 && allData.length > 0) {
            debug("[DEBUG] Creating score runtime chart");
            debug("[DEBUG] Sample timestamp from data:", allData[0]?.timestamp);
            
            // Helper function to parse timestamp to numeric value (seconds since epoch)
            const parseTimestamp = (ts) => {
                if (!ts) return 0;
                if (typeof ts === 'number') return ts;
                // Try parsing as Date string
                const date = new Date(ts);
                if (!isNaN(date.getTime())) {
                    return date.getTime() / 1000; // Convert ms to seconds
                }
                return 0;
            };
            
            // Helper function to format seconds as HH:MM:SS
            const formatTime = (seconds) => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            };
            
            debug("[DEBUG] Sample parsed timestamp:", parseTimestamp(allData[0]?.timestamp));
            
            // Sort all data by timestamp to get the time-based progression
            const sortedByTime = [...allData].sort((a, b) => {
                const timeA = parseTimestamp(a.timestamp);
                const timeB = parseTimestamp(b.timestamp);
                return timeA - timeB;
            });
            
            // Get minimum timestamp to normalize times (show elapsed time from start)
            const allTimestamps = sortedByTime.map(d => parseTimestamp(d.timestamp)).filter(t => t > 0);
            
            debug("[DEBUG] Valid timestamps count:", allTimestamps.length);
            if (allTimestamps.length > 0) {
                debug("[DEBUG] Min timestamp:", Math.min(...allTimestamps), "Max timestamp:", Math.max(...allTimestamps));
                const minTimestamp = Math.min(...allTimestamps);
                
                // Build cumulative max and mean over time
                const scoreRuntimeMaxData = [];
                const scoreRuntimeMeanData = [];
                const scoreRuntimeIndividualData = [];
                const scoreRuntimeBestPathData = [];
                
                let currentMaxScore = -Infinity;
                let allScoresSeenSoFar = [];
                
                sortedByTime.forEach((prog, idx) => {
                    const progTimestamp = parseTimestamp(prog.timestamp);
                    if (progTimestamp <= 0) return;
                    
                    const elapsedTime = progTimestamp - minTimestamp; // Time since start
                    
                    // Add individual score point if valid
                    if (prog.correct && prog.combined_score !== null && prog.combined_score !== undefined) {
                        const score = typeof prog.combined_score === 'string' ? parseFloat(prog.combined_score) : prog.combined_score;
                        if (!isNaN(score)) {
                            scoreRuntimeIndividualData.push({
                                x: elapsedTime,
                                y: score,
                                id: prog.id,
                                agent_name: prog.metadata?.patch_name || 'unnamed',
                                iter_id: prog.iter_id,
                                generation: prog.generation
                            });
                            
                            allScoresSeenSoFar.push(score);
                            
                            // Update cumulative max
                            if (score > currentMaxScore) {
                                currentMaxScore = score;
                            }
                            
                            // Record cumulative max at this timestamp
                            scoreRuntimeMaxData.push({
                                x: elapsedTime,
                                y: currentMaxScore
                            });
                            
                            // Record cumulative mean at this timestamp
                            const meanScore = allScoresSeenSoFar.reduce((sum, s) => sum + s, 0) / allScoresSeenSoFar.length;
                            scoreRuntimeMeanData.push({
                                x: elapsedTime,
                                y: meanScore
                            });
                        }
                    }
                });
                
                // Add best path data points sorted by timestamp
                if (validBestPathScoreData && validBestPathScoreData.length > 0) {
                    validBestPathScoreData.forEach(point => {
                        // Find the program data to get its timestamp
                        const prog = allData.find(d => d.generation === point.x);
                        if (prog && prog.timestamp) {
                            const progTimestamp = parseTimestamp(prog.timestamp);
                            if (progTimestamp > 0) {
                                const elapsedTime = progTimestamp - minTimestamp;
                                scoreRuntimeBestPathData.push({
                                    x: elapsedTime,
                                    y: point.y,
                                    id: point.id,
                                    agent_name: point.agent_name,
                                    iter_id: point.iter_id,
                                    generation: point.x
                                });
                            }
                        }
                    });
                    // Sort best path by timestamp
                    scoreRuntimeBestPathData.sort((a, b) => a.x - b.x);
                }
                
                debug("[DEBUG] Runtime data arrays built - Max:", scoreRuntimeMaxData.length, 
                          "Mean:", scoreRuntimeMeanData.length, 
                          "Individual:", scoreRuntimeIndividualData.length, 
                          "BestPath:", scoreRuntimeBestPathData.length);
                
                // Read Y-axis min/max values
                const yMinRuntimeValue = document.getElementById('score-runtime-y-min').value;
                const yMaxRuntimeValue = document.getElementById('score-runtime-y-max').value;
                const yMinRuntime = yMinRuntimeValue !== '' ? parseFloat(yMinRuntimeValue) : undefined;
                const yMaxRuntime = yMaxRuntimeValue !== '' ? parseFloat(yMaxRuntimeValue) : undefined;
                
                debug("[DEBUG] Score Runtime Y-axis settings - Min:", yMinRuntime, "Max:", yMaxRuntime);
                
                // Calculate tight x-axis bounds based on timestamp data
                const allTimeValues = [
                    ...scoreRuntimeMaxData.map(p => p.x),
                    ...scoreRuntimeMeanData.map(p => p.x),
                    ...scoreRuntimeIndividualData.map(p => p.x),
                    ...scoreRuntimeBestPathData.map(p => p.x)
                ].filter(t => t !== undefined && !isNaN(t));
                
                if (allTimeValues.length === 0) {
                    debug("[DEBUG] No valid timestamp data for runtime chart");
                } else {
                const minTime = Math.max(0, Math.min(...allTimeValues) - 60); // Add 60 seconds slack but don't go below 0
                const maxTime = Math.max(...allTimeValues) + 60;
                
                debug("[DEBUG] Score Runtime X-axis range - Min time:", minTime, "Max time:", maxTime);
                
                // Destroy existing chart instance if it exists
                if (scoreRuntimeChartInstance) {
                    scoreRuntimeChartInstance.destroy();
                    scoreRuntimeChartInstance = null;
                }
                
                // Create the chart
                scoreRuntimeChartInstance = new Chart(scoreRuntimeCanvas, {
                    type: 'line',
                    data: {
                        datasets: [
                            {
                                label: 'Cumulative Max',
                                data: scoreRuntimeMaxData,
                                borderColor: '#3498db',
                                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                                borderWidth: 2,
                                pointRadius: 4,
                                pointHoverRadius: 8,
                                fill: false,
                                tension: 0.2
                            },
                            {
                                label: 'Best Path',
                                data: scoreRuntimeBestPathData,
                                borderColor: '#ff8c00',
                                backgroundColor: 'rgba(255, 140, 0, 0.1)',
                                borderWidth: 3,
                                pointRadius: 5,
                                pointHoverRadius: 7,
                                fill: false,
                                tension: 0.2,
                                type: 'line'
                            },
                            {
                                label: 'Cumulative Mean',
                                data: scoreRuntimeMeanData,
                                borderColor: '#2ecc71',
                                borderWidth: 2,
                                pointRadius: 0,
                                pointHoverRadius: 6,
                                fill: false,
                                tension: 0.2
                            },
                            {
                                label: 'Individual Scores',
                                data: scoreRuntimeIndividualData,
                                borderColor: 'transparent',
                                backgroundColor: 'rgba(0, 0, 0, 0.15)',
                                pointRadius: 3,
                                pointHoverRadius: 6,
                                showLine: false
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: {
                            mode: 'nearest',
                            axis: 'x',
                            intersect: false
                        },
                        scales: {
                            x: {
                                type: 'linear',
                                title: {
                                    display: true,
                                    text: 'Elapsed Time (HH:MM:SS)'
                                },
                                min: minTime,
                                max: maxTime,
                                ticks: {
                                    callback: function(value, index, ticks) {
                                        return formatTime(value);
                                    }
                                }
                            },
                            y: {
                                title: {
                                    display: true,
                                    text: 'Combined Score (⬆ is better)'
                                },
                                min: yMinRuntime,
                                max: yMaxRuntime
                            }
                        },
                        plugins: {
                            tooltip: {
                                callbacks: {
                                    title: (items) => {
                                        if (items.length === 0) return '';
                                        const item = items[0];
                                        const timeFormatted = formatTime(item.parsed.x);
                                        if (item.datasetIndex === 3) { // Individual score dataset
                                            const dataPoint = scoreRuntimeIndividualData[item.dataIndex];
                                            if (dataPoint && dataPoint.agent_name) {
                                                return `Time: ${timeFormatted}, Agent: ${dataPoint.agent_name} (Gen ${dataPoint.generation})`;
                                            }
                                        }
                                        if (item.datasetIndex === 1) { // Best path score dataset
                                            const dataPoint = scoreRuntimeBestPathData[item.dataIndex];
                                            if (dataPoint && dataPoint.agent_name) {
                                                return `Best Path: ${dataPoint.agent_name} (Gen ${dataPoint.generation}, Time: ${timeFormatted})`;
                                            }
                                            return `Best Path at Time ${timeFormatted}`;
                                        }
                                        return `Elapsed Time: ${timeFormatted}`;
                                    },
                                    label: (item) => {
                                        if (item.datasetIndex === 3) { // Individual score dataset
                                            return `Score: ${item.parsed.y?.toFixed(6) || 'N/A'}`;
                                        }
                                        if (item.datasetIndex === 1) { // Best path score dataset
                                            const dataPoint = scoreRuntimeBestPathData[item.dataIndex];
                                            if (dataPoint && dataPoint.y !== undefined && dataPoint.y !== null) {
                                                return `Best Path Score: ${dataPoint.y.toFixed(6)}`;
                                            }
                                            return 'Best Path Score: N/A';
                                        }
                                        return `Score: ${item.parsed.y?.toFixed(6) || 'N/A'}`;
                                    }
                                }
                            }
                        }
                    }
                });
                
                debug("[DEBUG] Score runtime chart created");
                }
            } else {
                debug("[DEBUG] No valid timestamps found for runtime chart");
            }
        }
        } catch (error) {
            console.error("[ERROR] Score runtime chart creation failed:", error);
        }
        
        // Create cost chart
        try {
        if (validTotalCostData.length > 0) {
            debug("[DEBUG] Creating cost chart with API, embedding, and novelty costs breakdown");
            
            // Destroy existing chart instance if it exists
            if (costChartInstance) {
                costChartInstance.destroy();
                costChartInstance = null;
            }
            
            // Define a custom mixed chart type with stacked bars and a line
            costChartInstance = new Chart(costCanvas, {
                type: 'bar',
                data: {
                    datasets: [
                        {
                            label: 'Proposal/G.',
                            data: validGenerationCostData,
                            backgroundColor: 'rgba(52, 152, 219, 0.8)',
                            borderColor: 'rgba(52, 152, 219, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        },
                        {
                            label: 'Embed/G.',
                            data: validEmbedCostData,
                            backgroundColor: 'rgba(155, 89, 182, 0.8)',
                            borderColor: 'rgba(155, 89, 182, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        },
                        {
                            label: 'Novelty/G.',
                            data: validNoveltyCostData,
                            backgroundColor: 'rgba(230, 126, 34, 0.8)',
                            borderColor: 'rgba(230, 126, 34, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        },
                        {
                            label: 'Meta/G.',
                            data: validMetaCostData,
                            backgroundColor: 'rgba(142, 68, 173, 0.8)',
                            borderColor: 'rgba(142, 68, 173, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        },
                        {
                            label: 'Prompt/G.',
                            data: validPromptCostData,
                            backgroundColor: 'rgba(46, 204, 113, 0.8)',
                            borderColor: 'rgba(46, 204, 113, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        },
                        {
                            label: '∑ Proposal',
                            data: validCumulativeApiCostData,
                            type: 'line',
                            borderColor: 'rgba(52, 152, 219, 1)',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        },
                        {
                            label: '∑ Embed',
                            data: validCumulativeEmbedCostData,
                            type: 'line',
                            borderColor: 'rgba(155, 89, 182, 1)',
                            backgroundColor: 'rgba(155, 89, 182, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        },
                        {
                            label: '∑ Novelty',
                            data: validCumulativeNoveltyCostData,
                            type: 'line',
                            borderColor: 'rgba(230, 126, 34, 1)',
                            backgroundColor: 'rgba(230, 126, 34, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        },
                        {
                            label: '∑ Meta',
                            data: validCumulativeMetaCostData,
                            type: 'line',
                            borderColor: 'rgba(142, 68, 173, 1)',
                            backgroundColor: 'rgba(142, 68, 173, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        },
                        {
                            label: '∑ Prompt',
                            data: validCumulativePromptCostData,
                            type: 'line',
                            borderColor: 'rgba(46, 204, 113, 1)',
                            backgroundColor: 'rgba(46, 204, 113, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        },
                        {
                            label: '∑ Total',
                            data: validTotalCostData,
                            type: 'line',
                            borderColor: 'rgba(231, 76, 60, 1)',
                            backgroundColor: 'rgba(231, 76, 60, 0.1)',
                            borderWidth: 3,
                            pointBackgroundColor: validTotalCostData.map(p => p.x === currentGenId ? 
                                'rgba(231, 76, 60, 1)' : 'rgba(231, 76, 60, 0.7)'),
                            pointRadius: validTotalCostData.map(p => p.x === currentGenId ? 6 : 4),
                            pointHoverRadius: 8,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        }
                    ]
                },
                options: {
                    barPercentage: 0.8,
                    categoryPercentage: 1.0,
                    onClick: (evt, elements, chart) => {
                        debug('[DEBUG] Cost chart clicked.', { elements });
                        if (elements.length === 0) return;
                        const firstPoint = elements[0];
                        const generation = chart.data.datasets[firstPoint.datasetIndex].data[firstPoint.index].x;
                        
                        if (generation !== undefined && window.treeData) {
                            const programsInGen = window.treeData.filter(p => p.generation === generation && p.correct);
                            if (programsInGen.length > 0) {
                                const bestProgramInGen = programsInGen.reduce((best, current) => {
                                    const bestScore = best.combined_score ?? -Infinity;
                                    const currentScore = current.combined_score ?? -Infinity;
                                    return currentScore > bestScore ? current : best;
                                });
                                if (bestProgramInGen && bestProgramInGen.id) {
                                    selectNodeById(bestProgramInGen.id);
                                }
                            }
                        }
                    },
                    onHover: (event, elements, chart) => {
                        const canvas = chart.canvas;
                        canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    },
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Number of LLM Proposals/Program Evaluations'
                            },
                            ticks: {
                                stepSize: 1
                            }
                        },
                        y: {
                            type: 'linear',
                            position: 'left',
                            title: {
                                display: true,
                                text: 'Cumulative Cost ($)'
                            }
                        },
                        y1: {
                            type: 'linear',
                            position: 'right',
                            title: {
                                display: true,
                                text: 'Per-Generation Cost ($)'
                            },
                            grid: {
                                drawOnChartArea: false
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: (items) => `Generation ${items[0].parsed.x}`,
                                label: (item) => {
                                    const dataset = item.dataset;
                                    const value = item.parsed.y;
                                    return `${dataset.label}: $${value.toFixed(4)}`;
                                }
                            }
                        }
                    }
                }
            });
            
            debug("[DEBUG] Cost chart created");
        }
        } catch (error) {
            console.error("[ERROR] Cost chart creation failed:", error);
        }
        
        // Create runtime chart
        try {
        const validRuntimeData = (cumulativeRuntimes || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
        
        const validGenerationRuntimeData = (generationRuntimes || [])
            .filter(item => item.y !== null && item.y !== undefined && !isNaN(parseFloat(item.y)))
            .map(item => ({x: item.x, y: parseFloat(item.y)}));
        
        if (validRuntimeData.length > 0) {
            debug("[DEBUG] Creating runtime chart with cumulative and per-generation data");
            
            // Destroy existing chart instance if it exists
            if (runtimeChartInstance) {
                runtimeChartInstance.destroy();
                runtimeChartInstance = null;
            }
            
            // Helper function to format seconds to human-readable time
            const formatTime = (seconds) => {
                const days = Math.floor(seconds / 86400);
                const hours = Math.floor((seconds % 86400) / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);
                
                const parts = [];
                if (days > 0) parts.push(`${days}d`);
                if (hours > 0) parts.push(`${hours}h`);
                if (minutes > 0) parts.push(`${minutes}m`);
                if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
                
                return parts.join(' ');
            };
            
            // Create the runtime chart with bars and line
            runtimeChartInstance = new Chart(runtimeCanvas, {
                type: 'bar',
                data: {
                    datasets: [
                        {
                            label: 'Runtime/G.',
                            data: validGenerationRuntimeData,
                            backgroundColor: 'rgba(155, 89, 182, 0.8)',
                            borderColor: 'rgba(155, 89, 182, 1)',
                            borderWidth: 1,
                            yAxisID: 'y1'
                        },
                        {
                            label: '∑ Runtime',
                            data: validRuntimeData,
                            type: 'line',
                            borderColor: 'rgba(155, 89, 182, 1)',
                            backgroundColor: 'rgba(155, 89, 182, 0.1)',
                            borderWidth: 2,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            fill: false,
                            tension: 0.1,
                            yAxisID: 'y'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'linear',
                            title: {
                                display: true,
                                text: 'Number of LLM Proposals/Program Evaluations'
                            },
                            ticks: {
                                stepSize: 1
                            }
                        },
                        y: {
                            type: 'linear',
                            position: 'left',
                            title: {
                                display: true,
                                text: 'Cumulative Runtime'
                            },
                            ticks: {
                                callback: function(value) {
                                    return formatTime(value);
                                }
                            }
                        },
                        y1: {
                            type: 'linear',
                            position: 'right',
                            title: {
                                display: true,
                                text: 'Runtime per Generation'
                            },
                            ticks: {
                                callback: function(value) {
                                    return formatTime(value);
                                }
                            },
                            grid: {
                                drawOnChartArea: false
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                title: (items) => {
                                    if (items.length === 0) return '';
                                    const item = items[0];
                                    return `Generation ${item.parsed.x}`;
                                },
                                label: (item) => {
                                    const datasetLabel = item.dataset.label || '';
                                    return `${datasetLabel}: ${formatTime(item.parsed.y)}`;
                                }
                            }
                        }
                    }
                }
            });
            
            debug("[DEBUG] Runtime chart created");
        }
        } catch (error) {
            console.error("[ERROR] Runtime chart creation failed:", error);
        }
    } catch (error) {
        console.error("[DEBUG] Error in createCharts:", error);
    }
}

// Add this new function
function updateBestSolutionPanel(data) {
    // Filter valid scores
    const validScores = data.filter(d => d.correct).map(d => d.combined_score)
        .filter(s => s !== null && s !== undefined && !isNaN(parseFloat(s)))
        .map(s => parseFloat(s));
    
    // Determine best score based on max selection
    const bestScore = validScores.length > 0 ? 
        Math.max(...validScores) : 'N/A';
    
    // Find the agent with the best score
    let bestAgent = null;
    if (validScores.length > 0 && typeof bestScore === 'number') {
        bestAgent = data.find(d => parseFloat(d.combined_score) === bestScore);
    }
    
    // Update Best Solution section
    const bestScoreEl = document.getElementById('meta-best-score');
    bestScoreEl.textContent = typeof bestScore === 'number' ? bestScore.toFixed(6) : bestScore;
    bestScoreEl.className = typeof bestScore === 'number' ? 'metric-good' : ''; // Adjust class if needed
    
    document.getElementById('meta-best-agent-name').textContent = bestAgent ? (bestAgent.metadata.patch_name || 'unnamed') : 'N/A';
    document.getElementById('meta-best-agent-gen').textContent = bestAgent ? bestAgent.generation : 'N/A';

    debug("[DEBUG] Updated best solution panel with max score:", bestScore);
}

// Initialize the score type radio buttons
export function initializeScoreTypeListeners() {
    debug("[DEBUG] Initializing score type radio button listeners");
    const radioButtons = document.querySelectorAll('input[name="score-type"]');
    
    // Log how many radio buttons we found
    debug("[DEBUG] Found", radioButtons.length, "score type radio buttons");
    
    radioButtons.forEach(radio => {
        radio.addEventListener('change', function() {
            debug("[DEBUG] Radio button change event fired");
            const useMinScore = document.querySelector('input[name="score-type"][value="min"]').checked;
            debug("[DEBUG] Score type changed to:", useMinScore ? "min" : "max");
            
            // Use the window.treeData directly to update the best solution panel
            if (window.treeData && window.treeData.length > 0) {
                debug("[DEBUG] Tree data available, length:", window.treeData.length);
                
                // First update the best solution panel
                updateBestSolutionPanel(window.treeData, useMinScore);
                
                // Rebuild the tree with the new best node
                debug("[DEBUG] Rebuilding tree with useMinScore =", useMinScore);
                renderGraph(window.treeData, true);
                debug("[DEBUG] Tree rerendering complete");
                
                // Then redraw the charts
                createCharts(null);
                
                // Update the score heatbar
                updateScoreHeatbar();
            } else {
                console.error("[DEBUG] No tree data available for rerendering");
            }
        });
    });
    
    // Update y-axis scale controls when inputs change
    const yMinInput = document.getElementById('score-y-min');
    const yMaxInput = document.getElementById('score-y-max');
    
    if (yMinInput && yMaxInput) {
        // Create a function that updates charts with a slight delay
        const updateChartsOnInput = () => {
            debug("[DEBUG] Y axis value changed - Triggering chart update");
            // Use setTimeout to ensure the input value is properly processed
            setTimeout(() => createCharts(null), 10);
        };
        
        // Use input event for real-time updates as user types
        yMinInput.addEventListener('input', updateChartsOnInput);
        yMaxInput.addEventListener('input', updateChartsOnInput);
        
        // Keep change events for completeness
        yMinInput.addEventListener('change', updateChartsOnInput);
        yMaxInput.addEventListener('change', updateChartsOnInput);
    }
    
    // Set up event listeners for island y-axis controls
    const islandYMinInput = document.getElementById('island-y-min');
    const islandYMaxInput = document.getElementById('island-y-max');
    
    if (islandYMinInput && islandYMaxInput) {
        const updateIslandChartsOnInput = () => {
            debug("[DEBUG] Island Y axis value changed - Triggering island visualization update");
            // Use setTimeout to ensure the input value is properly processed
            setTimeout(() => {
                if (window.treeData) {
                    createIslandsVisualization(window.treeData);
                }
            }, 10);
        };
        
        // Use input event for real-time updates as user types
        islandYMinInput.addEventListener('input', updateIslandChartsOnInput);
        islandYMaxInput.addEventListener('input', updateIslandChartsOnInput);
        
        // Keep change events for completeness
        islandYMinInput.addEventListener('change', updateIslandChartsOnInput);
        islandYMaxInput.addEventListener('change', updateIslandChartsOnInput);
    }
}

// Function to handle score type changes
function handleScoreTypeChange(isMinScore) {
    debug("[DEBUG] handleScoreTypeChange called with isMinScore =", isMinScore);
    
    // Make sure the radio button state is synchronized
    document.querySelector('input[name="score-type"][value="min"]').checked = isMinScore;
    document.querySelector('input[name="score-type"][value="max"]').checked = !isMinScore;
    
    // If we have raw data, reprocess it completely
    if (window.rawDbData && window.rawDbData.length > 0) {
        debug("[DEBUG] Reprocessing raw data with", window.rawDbData.length, "rows");
        
        // Simulate a complete data reload by reprocessing the data
        processData(window.rawDbData);
        return;
    }
    
    // Fallback to using the existing tree data
    if (window.treeData && window.treeData.length > 0) {
        debug("[DEBUG] Using existing tree data with", window.treeData.length, "rows");
        
        // First update the best solution panel
        updateBestSolutionPanel(window.treeData, isMinScore);
        
        // Rebuild the tree with the new best node
        debug("[DEBUG] Rebuilding tree with isMinScore =", isMinScore);
        renderGraph(window.treeData, true);
        debug("[DEBUG] Tree rerendering complete");
        
        // Then redraw the charts
        createCharts(null);
        
        // Update the score heatbar
        updateScoreHeatbar();
    } else if (window.currentDbPath) {
        // If all else fails but we have a file path, reload the file
        debug("[DEBUG] Reloading file from path:", window.currentDbPath);
        loadDatabase(window.currentDbPath);
    } else {
        console.error("[DEBUG] No data available for rerendering");
    }
}

// Add this new function before the createCharts function
export function updateScoreHeatbar() {
    const heatbarContainer = document.getElementById("score-heatbar");
    if (!heatbarContainer || !window.treeData) return;
    
    // Get valid scores from the data, excluding non-correct nodes
    const validScores = window.treeData
        .filter(d => d.correct && d.combined_score != null && !isNaN(parseFloat(d.combined_score)))
        .map(d => parseFloat(d.combined_score));

    if (validScores.length === 0) {
        document.getElementById("min-score").textContent = "N/A";
        document.getElementById("max-score").textContent = "N/A";
        heatbarContainer.style.background = 'none';
        return;
    }

    const minScore = Math.min(...validScores);
    const maxScore = Math.max(...validScores);
    
    document.getElementById("min-score").textContent = minScore.toFixed(2);
    document.getElementById("max-score").textContent = maxScore.toFixed(2);
    
    const colorScale = d3.scaleSequential(d3.interpolateViridis).domain([minScore, maxScore]);

    const numStops = 10;
    const colorStops = d3.range(numStops + 1).map(i => {
        const t = i / numStops;
        const score = minScore + t * (maxScore - minScore);
        return `${colorScale(score)} ${t * 100}%`;
    });

    heatbarContainer.style.background = `linear-gradient(to right, ${colorStops.join(', ')})`;
}
