// PromptEvo tab: evolved system prompts.
import { debug } from '../log.js';
import { escapeHtml } from './format.js';
import { selectNodeById } from './selection.js';

// ============== META-PROMPT VISUALIZATION ==============

// Store meta-prompt data globally
window.metaPromptData = null;
window.selectedPromptId = null;

export async function loadAndRenderMetaPrompts() {
    debug("[DEBUG] Loading meta-prompt data...");
    const container = document.getElementById('meta-prompt-tree');
    const statusEl = document.getElementById('meta-prompt-status');
    
    if (!window.currentDbPath) {
        statusEl.textContent = "No database selected";
        container.innerHTML = '<p style="text-align: center; color: #999; margin-top: 50px;">Please select a database first.</p>';
        return;
    }
    
    statusEl.textContent = "Loading prompts...";
    
    try {
        const response = await fetch(`/get_system_prompts?db_path=${encodeURIComponent(window.currentDbPath)}`);
        if (!response.ok) {
            throw new Error(`Failed to load prompts (HTTP ${response.status})`);
        }
        
        const prompts = await response.json();
        window.metaPromptData = prompts;
        
        // Debug: log first prompt to see all available fields
        if (prompts && prompts.length > 0) {
            debug("[DEBUG] First prompt keys:", Object.keys(prompts[0]));
            debug("[DEBUG] First prompt program_generation:", prompts[0].program_generation);
            debug("[DEBUG] All program_generations:", prompts.map(p => p.program_generation));
        }
        
        if (!prompts || prompts.length === 0) {
            statusEl.textContent = "No meta-prompt database found";
            container.innerHTML = '<p style="text-align: center; color: #999; margin-top: 50px;">No meta-prompt evolution data available.<br><br><span style="font-size: 12px;">Meta-prompt evolution requires <code>evolve_prompts: true</code> in the config.</span></p>';
            const legend = document.getElementById('meta-prompt-legend');
            if (legend) legend.style.display = 'none';
            return;
        }
        
        // Find best prompt (highest fitness with minimum program count)
        const minPrograms = 1;  // Any prompt with at least 1 program can be best
        const eligiblePrompts = prompts.filter(p => p.program_count >= minPrograms);
        const bestPrompt = [...eligiblePrompts].sort((a, b) => b.fitness - a.fitness)[0];
        
        // Track best prompt ID for auto-refresh comparison
        window.metaPromptBestId = bestPrompt ? bestPrompt.id : null;
        
        debug("[DEBUG] Best prompt detection:", {
            totalPrompts: prompts.length,
            eligibleCount: eligiblePrompts.length,
            minPrograms,
            bestPrompt: bestPrompt ? { id: bestPrompt.id, fitness: bestPrompt.fitness, program_count: bestPrompt.program_count } : null
        });
        
        statusEl.textContent = `Loaded ${prompts.length} prompts` + 
            (bestPrompt ? ` | Best fitness: ${bestPrompt.fitness.toFixed(4)}` : '');
        
        renderMetaPromptTree(prompts, bestPrompt);
        
    } catch (error) {
        console.error("[DEBUG] Error loading meta-prompts:", error);
        statusEl.textContent = "Could not load prompts";
        // Show a less alarming message for temporary errors
        const isTemporary = error.message.includes('500') || error.message.includes('503');
        const msg = isTemporary 
            ? 'Prompts temporarily unavailable (database may be busy). Try refreshing later.'
            : `Error: ${error.message}`;
        container.innerHTML = `<p style="text-align: center; color: #999; margin-top: 50px;">${msg}</p>`;
        const legend = document.getElementById('meta-prompt-legend');
        if (legend) legend.style.display = 'none';
    }
}

export function renderMetaPromptTree(prompts, bestPrompt) {
    const container = document.getElementById('meta-prompt-tree');
    container.innerHTML = '';
    
    // Build tree hierarchy first to calculate dimensions
    const promptMap = new Map(prompts.map(p => [p.id, { ...p, children: [] }]));
    
    // Find roots (prompts without parent or with missing parent)
    const roots = [];
    prompts.forEach(p => {
        const node = promptMap.get(p.id);
        if (p.parent_id && promptMap.has(p.parent_id)) {
            promptMap.get(p.parent_id).children.push(node);
        } else {
            roots.push(node);
        }
    });
    
    // If no roots found, show message
    if (roots.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999; margin-top: 50px;">No valid prompt tree structure found.</p>';
        const legend = document.getElementById('meta-prompt-legend');
        if (legend) legend.style.display = 'none';
        return;
    }
    
    // Create a virtual root if multiple roots
    let rootNode;
    if (roots.length === 1) {
        rootNode = roots[0];
    } else {
        rootNode = { id: 'virtual_root', prompt_text: '', children: roots, generation: -1, fitness: 0 };
    }
    
    // Create D3 hierarchy
    const hierarchyRoot = d3.hierarchy(rootNode);
    
    // Use nodeSize for fixed spacing like the program tree
    const nodeWidth = 60;  // Horizontal spacing between sibling nodes
    const nodeHeight = 80; // Vertical spacing between generations
    
    // Create tree layout with nodeSize (top-to-bottom)
    const treeLayout = d3.tree()
        .nodeSize([nodeWidth, nodeHeight])
        .separation((a, b) => a.parent === b.parent ? 1.5 : 2);
    treeLayout(hierarchyRoot);
    
    // Calculate actual tree bounds (account for node labels ~60px wide)
    const labelPadding = 80;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    hierarchyRoot.each(d => {
        if (d.x < minX) minX = d.x;
        if (d.x > maxX) maxX = d.x;
        if (d.y < minY) minY = d.y;
        if (d.y > maxY) maxY = d.y;
    });
    
    // Calculate tree dimensions based on actual bounds
    const treeWidth = maxX - minX + labelPadding * 2;  // Extra for labels
    const treeHeight = maxY - minY + 60;  // Extra for bottom labels
    
    // Add padding around the tree for centering
    const margin = { top: 40, right: 40, bottom: 60, left: 40 };
    const contentWidth = treeWidth + margin.left + margin.right;
    const contentHeight = treeHeight + margin.top + margin.bottom;
    
    // Get container dimensions - use 100% of available space
    const containerRect = container.getBoundingClientRect();
    const panelWidth = containerRect.width || 400;
    const panelHeight = containerRect.height || 400;
    
    // Create SVG that fills container and centers content
    const svg = d3.select(container)
        .append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .style("display", "block");
    
    // Calculate centering offsets with slight adjustment (higher and to the left)
    const centerX = (minX + maxX) / 2;
    
    // Set viewBox - center the tree horizontally and vertically
    const viewBoxX = centerX - contentWidth / 2 + 40;  // Shift right to move tree left
    const viewBoxY = minY - margin.top;  // Center vertically (no extra offset)
    
    svg.attr("viewBox", `${viewBoxX} ${viewBoxY} ${contentWidth} ${contentHeight}`)
       .attr("preserveAspectRatio", "xMidYMid meet");  // Center both horizontally and vertically
    
    // Add zoom support
    const g = svg.append("g");
    svg.call(d3.zoom()
        .scaleExtent([0.3, 4])
        .on("zoom", (event) => g.attr("transform", event.transform)));
    
    // Calculate best path to best prompt
    const bestPath = new Set();
    if (bestPrompt) {
        let current = promptMap.get(bestPrompt.id);
        while (current) {
            bestPath.add(current.id);
            current = current.parent_id ? promptMap.get(current.parent_id) : null;
        }
    }
    
    // Draw links with curved paths
    g.selectAll(".prompt-link")
        .data(hierarchyRoot.links())
        .enter()
        .append("path")
        .attr("class", d => {
            const targetId = d.target.data.id;
            const sourceId = d.source.data.id;
            const isBestPath = bestPath.has(targetId) && bestPath.has(sourceId);
            return "prompt-link" + (isBestPath ? " best-path" : "");
        })
        .attr("d", d3.linkVertical()
            .x(d => d.x)
            .y(d => d.y));
    
    // Draw nodes
    const nodes = g.selectAll(".prompt-node")
        .data(hierarchyRoot.descendants().filter(d => d.data.id !== 'virtual_root'))
        .enter()
        .append("g")
        .attr("class", d => {
            let cls = "prompt-node";
            if (bestPrompt && d.data.id === bestPrompt.id) cls += " best-prompt";
            if (window.selectedPromptId === d.data.id) cls += " selected";
            return cls;
        })
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .style("cursor", "pointer")
        .on("click", function(event, d) {
            selectPromptNode(d.data);
            d3.selectAll(".prompt-node").classed("selected", false);
            d3.select(this).classed("selected", true);
        });
    
    // Shape map - same as program tree
    const shapeMap = {
        'init': d3.symbolDiamond,
        'full': d3.symbolCircle,
        'diff': d3.symbolSquare,
        'cross': d3.symbolCross,
        'fix': d3.symbolTriangle
    };
    const getShape = (patchType) => shapeMap[patchType] || d3.symbolCircle;
    const symbol = d3.symbol();
    
    // Create viridis color scale based on fitness range
    const fitnessValues = prompts.map(p => p.fitness || 0);
    const minFitness = Math.min(...fitnessValues);
    const maxFitness = Math.max(...fitnessValues);
    const fitnessColorScale = d3.scaleSequential(d3.interpolateViridis)
        .domain([minFitness, maxFitness]);
    
    // Node size based on program count (converted to symbol area)
    const nodeSize = d => {
        const baseSizeMin = 8;
        const baseSizeMax = 16;
        const pc = d.data.program_count || 0;
        const radius = baseSizeMin + Math.min(pc, 20) * 
            (baseSizeMax - baseSizeMin) / 20;
        // Convert radius to area for d3.symbol
        return Math.PI * radius * radius;
    };
    
    // Compute effective radius for text positioning
    const nodeRadius = d => {
        const baseSizeMin = 8;
        const baseSizeMax = 16;
        const pc = d.data.program_count || 0;
        return baseSizeMin + Math.min(pc, 20) * 
            (baseSizeMax - baseSizeMin) / 20;
    };
    
    // Debug: log bestPrompt info for node coloring
    if (bestPrompt) {
        debug("[DEBUG] Best prompt for coloring:", bestPrompt.id);
    }
    
    nodes.append("path")
        .attr("d", d => {
            symbol.type(getShape(d.data.patch_type));
            symbol.size(nodeSize(d));
            return symbol();
        })
        .attr("fill", d => {
            const isBest = bestPrompt && d.data.id === bestPrompt.id;
            if (isBest) {
                debug("[DEBUG] Found best node:", d.data.id);
                return "#f1c40f";  // Golden fill
            }
            const fitness = d.data.fitness || 0;
            return fitnessColorScale(fitness);
        })
        .attr("stroke", d => {
            if (bestPrompt && d.data.id === bestPrompt.id) return "#f39c12";
            return "#333";
        })
        .attr("stroke-width", d => bestPrompt && d.data.id === bestPrompt.id ? 3 : 2);
    
    // Program generation number centered inside the node (like program tree)
    nodes.append("text")
        .attr("dy", "0.35em")
        .attr("x", 0)
        .attr("text-anchor", "middle")
        .text(d => d.data.program_generation || 0)
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("fill", "white")
        .style("pointer-events", "none")
        .style("text-shadow", "1px 1px 1px rgba(0,0,0,0.5)");
    
    // Node labels - below the node showing prompt gen and patch type
    nodes.append("text")
        .attr("dy", d => nodeRadius(d) + 12)
        .attr("x", 0)
        .attr("text-anchor", "middle")
        .text(d => {
            const patchType = d.data.patch_type || 'init';
            const gen = d.data.generation;
            return `G${gen} ${patchType}`;
        })
        .style("font-size", "10px")
        .style("fill", "#555");
    
    // Fitness label on second line
    nodes.append("text")
        .attr("dy", d => nodeRadius(d) + 23)
        .attr("x", 0)
        .attr("text-anchor", "middle")
        .text(d => {
            const fitness = d.data.fitness || 0;
            const pc = d.data.program_count || 0;
            return `${fitness >= 0 ? '+' : ''}${fitness.toFixed(3)} (${pc})`;
        })
        .style("font-size", "9px")
        .style("fill", "#666");
    
    // Add zoom and pan behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
        });
    
    svg.call(zoom);
    
    // Set initial transform to center content with margin
    svg.call(zoom.transform, d3.zoomIdentity.translate(margin.left, margin.top));
    
    // Update HTML legend
    updateMetaPromptLegend(prompts, shapeMap);
}

function updateMetaPromptLegend(prompts, shapeMap) {
    // Show the legend
    const legend = document.getElementById('meta-prompt-legend');
    if (legend) {
        legend.style.display = 'block';
    }
    
    // Update shape legend with used patch types
    const shapeLegend = d3.select("#meta-prompt-shape-legend");
    shapeLegend.selectAll(".shape-legend-item").remove();
    
    const usedPatchTypes = [...new Set(
        prompts.map(p => p.patch_type).filter(Boolean)
    )];
    
    const legendSymbol = d3.symbol().size(64);
    
    for (const type in shapeMap) {
        if (usedPatchTypes.includes(type)) {
            const legendItem = shapeLegend.append("div")
                .attr("class", "shape-legend-item")
                .style("display", "flex")
                .style("align-items", "center");
            
            const svg = legendItem.append("svg")
                .attr("width", 16)
                .attr("height", 16)
                .style("margin-right", "5px");
            
            legendSymbol.type(shapeMap[type]);
            
            svg.append("path")
                .attr("d", legendSymbol)
                .attr("transform", "translate(8, 8)")
                .attr("fill", "#fff")
                .attr("stroke", "#333")
                .attr("stroke-width", 1.5);
            
            legendItem.append("span").text(type);
        }
    }
    
    // Update fitness heatbar with viridis colormap
    const heatbar = document.getElementById('meta-prompt-heatbar');
    if (heatbar) {
        // Viridis colormap gradient
        heatbar.style.background = 
            'linear-gradient(to right, #440154, #482878, #3e4a89, ' +
            '#31688e, #26838f, #1f9d8a, #6cce5a, #b6de2b, #fee825)';
    }
    
    // Update min/max fitness labels
    const fitnessValues = prompts.map(p => p.fitness || 0);
    const minFitness = Math.min(...fitnessValues);
    const maxFitness = Math.max(...fitnessValues);
    
    const minLabel = document.getElementById('meta-prompt-min-fitness');
    const maxLabel = document.getElementById('meta-prompt-max-fitness');
    if (minLabel) minLabel.textContent = minFitness.toFixed(3);
    if (maxLabel) maxLabel.textContent = maxFitness.toFixed(3);
}

export function selectPromptNode(promptData) {
    window.selectedPromptId = promptData.id;
    
    const detailsPanel = document.getElementById('meta-prompt-details');
    if (!detailsPanel) return;
    
    // Format timestamp
    const timestamp = promptData.timestamp ? new Date(promptData.timestamp * 1000).toLocaleString() : 'N/A';
    
    // Stored fitness (may be stale - calculated at time of program creation)
    const storedFitness = promptData.fitness || 0;
    
    // Patch type badge color
    const patchTypeColors = {
        'init': '#3498db',
        'diff': '#9b59b6',
        'full': '#e67e22',
        'cross': '#1abc9c'
    };
    const patchColor = patchTypeColors[promptData.patch_type] || '#666';
    
    // Extract LLM metadata if available (parse if string)
    let metadata = promptData.metadata || {};
    if (typeof metadata === 'string') {
        try {
            metadata = JSON.parse(metadata);
        } catch (e) {
            metadata = {};
        }
    }
    // LLM data may be nested under "llm" key
    const llmData = metadata.llm || {};
    const llmCost = llmData.cost || metadata.api_cost || metadata.cost || null;
    const llmModel = llmData.model_name || metadata.model_name || metadata.model || null;
    
    // Get programs generated with this prompt
    const programIds = promptData.program_ids || [];
    let programsTableHtml = '';
    let calculatedCorrectCount = 0;
    let calculatedImprovedCount = 0;
    // Live fitness calculated from current population (not stale)
    let liveFitness = null;
    
    if (programIds.length > 0 && window.rawDbData) {
        // Find matching programs from the loaded data
        const matchingPrograms = window.rawDbData.filter(p => programIds.includes(p.id));
        
        if (matchingPrograms.length > 0) {
            // Build a map of program IDs to scores for parent lookup
            const programScoreMap = new Map();
            window.rawDbData.forEach(p => {
                if (p.combined_score != null) {
                    programScoreMap.set(p.id, p.combined_score);
                }
            });
            
            // Get all scores for "beat" calculation (only correct programs)
            const allCorrectScores = window.rawDbData
                .filter(p => p.correct && p.combined_score != null)
                .map(p => p.combined_score)
                .sort((a, b) => a - b);  // Sort ascending for efficient counting
            const totalCorrectPrograms = allCorrectScores.length;
            
            // Function to calculate what percentage of OTHER programs a score beats
            // Divide by (n-1) to exclude self - best program should beat 100%
            const calculateBeatPercent = (score) => {
                if (score == null || totalCorrectPrograms === 0) return null;
                // Count how many programs have lower scores
                let beatCount = 0;
                for (const s of allCorrectScores) {
                    if (s < score) beatCount++;
                    else break;  // Since sorted, no need to continue
                }
                // Divide by (n-1) to exclude self from comparison
                const numOtherPrograms = totalCorrectPrograms - 1;
                if (numOtherPrograms <= 0) return 100;  // Only program = 100%
                return (beatCount / numOtherPrograms) * 100;
            };
            
            // Pre-calculate improvements and enrich program data
            const enrichedPrograms = matchingPrograms.map(p => {
                let delta = null;
                if (p.parent_id && p.combined_score != null) {
                    const parentScore = programScoreMap.get(p.parent_id);
                    if (parentScore != null) {
                        delta = p.combined_score - parentScore;
                    }
                }
                // Calculate beat percentage for correct programs
                const beatPercent = p.correct ? calculateBeatPercent(p.combined_score) : null;
                return { ...p, delta, beatPercent };
            });
            
            // Calculate counts from actual program data
            calculatedCorrectCount = enrichedPrograms.filter(p => p.correct).length;
            calculatedImprovedCount = enrichedPrograms.filter(p => p.correct && p.delta !== null && p.delta > 0).length;
            
            // Calculate average improvement (only for correct programs)
            const deltas = enrichedPrograms
                .filter(p => p.delta !== null && p.correct)
                .map(p => p.delta);
            const avgImprovement = deltas.length > 0 
                ? deltas.reduce((a, b) => a + b, 0) / deltas.length 
                : null;
            const avgColor = avgImprovement !== null 
                ? (avgImprovement > 0 ? '#27ae60' : (avgImprovement < 0 ? '#e74c3c' : '#888'))
                : '#888';
            
            // Calculate average beat percentage (only for correct programs)
            // This is the LIVE fitness calculated against current population
            const beatPercents = enrichedPrograms
                .filter(p => p.beatPercent !== null)
                .map(p => p.beatPercent);
            const avgBeatPercent = beatPercents.length > 0
                ? beatPercents.reduce((a, b) => a + b, 0) / beatPercents.length
                : null;
            
            // Store live fitness (as 0-1 scale like stored fitness)
            liveFitness = avgBeatPercent !== null ? avgBeatPercent / 100 : null;
            
            // Store for sorting
            window.promptGeneratedPrograms = enrichedPrograms;
            window.promptProgramsSortCol = 'score';
            window.promptProgramsSortAsc = false;
            
            // Sort by combined_score descending initially
            enrichedPrograms.sort((a, b) => (b.combined_score || 0) - (a.combined_score || 0));
            
            programsTableHtml = `
                <div style="margin-top: 12px; margin-bottom: 16px; flex-shrink: 0; max-height: 220px; overflow: hidden; display: flex; flex-direction: column;">
                    <div style="font-size: 11px; font-weight: 600; color: #555; margin-bottom: 6px; flex-shrink: 0;">
                        Generated Programs (${matchingPrograms.length})
                    </div>
                    <div style="flex: 1; min-height: 0; overflow-y: auto; border: 1px solid #ddd; border-radius: 4px;">
                        <table id="prompt-programs-table" style="width: 100%; font-size: 10px; border-collapse: collapse;">
                            <thead style="background: #f5f5f5; position: sticky; top: 0;">
                                <tr>
                                    <th style="padding: 4px 6px; text-align: left; border-bottom: 1px solid #ddd;">Name</th>
                                    <th style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #ddd; cursor: pointer; user-select: none;" onclick="sortPromptProgramsTable('gen')" title="Click to sort">Gen ⇅</th>
                                    <th style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #ddd; cursor: pointer; user-select: none;" onclick="sortPromptProgramsTable('score')" title="Click to sort">Score ⇅</th>
                                    <th style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #ddd; cursor: pointer; user-select: none;" onclick="sortPromptProgramsTable('delta')" title="Click to sort">Δ ⇅</th>
                                    <th style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #ddd; cursor: pointer; user-select: none;" onclick="sortPromptProgramsTable('beat')" title="% of programs outperformed">Beat% ⇅</th>
                                    <th style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #ddd;">✓</th>
                                </tr>
                            </thead>
                            <tbody id="prompt-programs-tbody">
                                ${renderPromptProgramRows(enrichedPrograms)}
                            </tbody>
                        </table>
                    </div>
                    <div style="font-size: 10px; color: #666; margin-top: 4px; text-align: right; flex-shrink: 0;">
                        Avg. Δ: <span style="font-weight: 600; color: ${avgColor};">${avgImprovement !== null ? ((avgImprovement >= 0 ? '+' : '') + avgImprovement.toFixed(4)) : 'N/A'}</span>
                        &nbsp;|&nbsp; Avg. Beat: <span style="font-weight: 600; color: #8e44ad;">${avgBeatPercent !== null ? avgBeatPercent.toFixed(1) + '%' : 'N/A'}</span>
                    </div>
                </div>
            `;
        }
    } else if (programIds.length > 0) {
        programsTableHtml = `
            <div style="margin-top: 12px; margin-bottom: 16px; flex-shrink: 0;">
                <div style="font-size: 11px; font-weight: 600; color: #555; margin-bottom: 6px;">
                    Generated Programs (${programIds.length})
                </div>
                <div style="font-size: 10px; color: #888; padding: 8px; background: #f8f8f8; border-radius: 4px;">
                    ${programIds.slice(0, 10).map(id => id.substring(0, 12) + '...').join(', ')}
                    ${programIds.length > 10 ? ` and ${programIds.length - 10} more...` : ''}
                </div>
            </div>
        `;
    }
    
    // LLM metadata section - show all metadata fields
    let llmMetadataHtml = '';
    // Flatten metadata: combine top-level fields with nested llm fields
    const flatMetadata = { ...metadata };
    if (metadata.llm && typeof metadata.llm === 'object') {
        Object.assign(flatMetadata, metadata.llm);
        delete flatMetadata.llm; // Remove the nested object
    }
    
    if (Object.keys(flatMetadata).length > 0) {
        // Fields to skip (complex objects or not useful)
        const skipFields = ['llm_kwargs', 'model_posteriors', 'source'];
        
        // Format metadata fields for display
        const formatValue = (key, val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'number') {
                if (key.includes('cost') || key.includes('price')) {
                    return '$' + val.toFixed(6);
                }
                if (key.includes('time') || key.includes('duration')) {
                    return val.toFixed(2) + 's';
                }
                if (key.includes('tokens')) {
                    return val.toLocaleString();
                }
                return Number.isInteger(val) ? val.toLocaleString() : val.toFixed(4);
            }
            if (typeof val === 'object') {
                // Skip empty objects
                if (Object.keys(val).length === 0) return null;
                return null; // Skip complex objects
            }
            if (val === '') return null;
            return String(val);
        };
        
        const formatLabel = (key) => {
            // Special label mappings
            const labelMap = {
                'model_name': 'Model',
                'input_tokens': 'Input Tokens',
                'output_tokens': 'Output Tokens',
                'thinking_tokens': 'Thinking Tokens',
                'cost': 'Total Cost',
                'input_cost': 'Input Cost',
                'output_cost': 'Output Cost',
                'num_tool_calls': 'Tool Calls',
                'num_total_queries': 'Total Queries',
                'parent_fitness': 'Parent Fitness',
                'parent_program_count': 'Parent Programs'
            };
            if (labelMap[key]) return labelMap[key];
            return key.replace(/_/g, ' ')
                .replace(/([A-Z])/g, ' $1')
                .replace(/^./, s => s.toUpperCase())
                .trim();
        };
        
        const metadataItems = Object.entries(flatMetadata)
            .filter(([k, v]) => !skipFields.includes(k))
            .map(([k, v]) => {
                const formatted = formatValue(k, v);
                if (formatted === null) return null;
                return `<div><span style="color: #888;">${formatLabel(k)}:</span> <strong>${formatted}</strong></div>`;
            })
            .filter(item => item !== null)
            .join('');
        
        if (metadataItems) {
            llmMetadataHtml = `
                <div style="background: #fff8e6; border-radius: 6px; padding: 10px; margin-bottom: 12px; border: 1px solid #ffe0a6; flex-shrink: 0;">
                    <div style="font-size: 10px; font-weight: 600; color: #b8860b; margin-bottom: 6px;">LLM Metadata</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px;">
                        ${metadataItems}
                    </div>
                </div>
            `;
        }
    }
    
    detailsPanel.innerHTML = `
        <div style="display: flex; flex-direction: column; height: 100%; min-height: 0; padding-bottom: 16px;">
            <div style="margin-bottom: 12px; flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                    <span style="background-color: ${patchColor}; color: white; padding: 2px 8px; border-radius: 3px; font-size: 11px; font-weight: 600;">
                        ${promptData.patch_type.toUpperCase()}
                    </span>
                    <span style="color: #888; font-size: 11px;">Prompt Gen ${promptData.generation}</span>
                    <span style="background-color: #8e44ad; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;">P${promptData.program_generation || 0}</span>
                    ${promptData.in_archive ? '<span style="background-color: #27ae60; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px;">ARCHIVE</span>' : ''}
                </div>
                <div style="font-size: 10px; color: #888; font-family: monospace;">
                    ID: ${promptData.id.substring(0, 24)}...
                </div>
                ${promptData.name ? `<div style="font-size: 13px; font-weight: 600; color: #333; margin-top: 8px;">${promptData.name}</div>` : ''}
                ${promptData.description ? `
                    <div id="prompt-description-box" style="margin-top: 8px; background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 4px; overflow: hidden;">
                        <div id="prompt-description-content" style="font-size: 11px; color: #666; line-height: 1.4; padding: 8px; max-height: 80px; overflow: hidden; transition: max-height 0.3s ease;">
                            ${promptData.description}
                        </div>
                        <div id="prompt-description-toggle" onclick="togglePromptDescription()" style="display: none; font-size: 10px; color: #8e44ad; padding: 4px 8px; cursor: pointer; text-align: center; border-top: 1px solid #e0e0e0; background: #f0f0f0; user-select: none;">
                            ▼ Show more
                        </div>
                    </div>
                ` : ''}
            </div>
            
            <div style="background: white; border-radius: 6px; padding: 10px; margin-bottom: 12px; border: 1px solid #e0e0e0; flex-shrink: 0;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div>
                        <div style="font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px;" title="Live percentile rank calculated against all current programs">Fitness (Live)</div>
                        <div style="font-size: 16px; font-weight: 600; color: ${liveFitness !== null ? (liveFitness >= 0.5 ? '#27ae60' : (liveFitness >= 0.25 ? '#e67e22' : '#e74c3c')) : '#666'};">${liveFitness !== null ? liveFitness.toFixed(4) : 'N/A'}</div>
                        ${(liveFitness !== null && Math.abs(liveFitness - storedFitness) > 0.05) ? `<div style="font-size: 9px; color: #999; margin-top: 2px;" title="Historical fitness from program creation time (may be stale)">stored: ${storedFitness.toFixed(4)}</div>` : ''}
                    </div>
                    <div>
                        <div style="font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px;">Programs</div>
                        <div style="font-size: 16px; font-weight: 600; color: #333;">${promptData.program_count} <span style="font-size: 12px; color: #27ae60;">(${calculatedCorrectCount} ✓)</span></div>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                    <div>
                        <div style="font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px;">Total Improvement</div>
                        <div style="font-size: 13px; color: #555;">${(promptData.total_improvement || 0).toFixed(4)}</div>
                    </div>
                    <div>
                        <div style="font-size: 9px; color: #888; text-transform: uppercase; margin-bottom: 2px;">Improved</div>
                        <div style="font-size: 13px; color: ${calculatedImprovedCount > 0 ? '#27ae60' : '#555'};">${calculatedImprovedCount} / ${calculatedCorrectCount}</div>
                    </div>
                </div>
            </div>
            
            ${llmMetadataHtml}
            
            <div style="margin-bottom: 12px; font-size: 11px; color: #666; flex-shrink: 0;">
                <div style="margin-bottom: 3px;"><strong>Created:</strong> ${timestamp}</div>
                <div><strong>Parent:</strong> ${promptData.parent_id ? promptData.parent_id.substring(0, 20) + '...' : 'None (root)'}</div>
            </div>
            
            <div style="flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; overflow: hidden;">
                <div style="font-size: 11px; font-weight: 600; color: #555; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                    <span>System Prompt Text</span>
                    <button onclick="showFullPrompt()" style="padding: 3px 8px; font-size: 10px; cursor: pointer; border: 1px solid #ddd; border-radius: 3px; background: white;">
                        Expand
                    </button>
                </div>
                <div class="prompt-text-preview" style="flex: 1 1 auto; min-height: 80px; max-height: 180px; overflow-y: auto;">${escapeHtml(promptData.prompt_text)}</div>
            </div>
            
            ${programsTableHtml}
        </div>
    `;
    
    // After rendering, check if description toggle should be shown
    // Use setTimeout to ensure layout has fully settled
    setTimeout(() => {
        const descContent = document.getElementById('prompt-description-content');
        const descToggle = document.getElementById('prompt-description-toggle');
        if (descContent && descToggle) {
            // Show toggle only if content actually overflows
            // scrollHeight is the full content height, clientHeight is the visible area
            const isOverflowing = descContent.scrollHeight > descContent.clientHeight + 1;
            descToggle.style.display = isOverflowing ? 'block' : 'none';
        }
    }, 50);
}

// Toggle prompt description expand/collapse
export function togglePromptDescription() {
    const content = document.getElementById('prompt-description-content');
    const toggle = document.getElementById('prompt-description-toggle');
    if (!content || !toggle) return;
    
    const collapsedHeight = '80px';
    const isExpanded = content.style.maxHeight !== collapsedHeight && content.style.maxHeight !== '';
    if (isExpanded) {
        content.style.maxHeight = collapsedHeight;
        toggle.innerHTML = '▼ Show more';
    } else {
        content.style.maxHeight = content.scrollHeight + 'px';
        toggle.innerHTML = '▲ Show less';
    }
}

// Helper function to select a program from the prompt view
export function selectProgramFromPromptView(programId) {
    // Switch to the Tree tab and select the program
    const treeTab = document.querySelector('.left-tab[data-tab="tree-view"]');
    if (treeTab) {
        treeTab.click();
        setTimeout(() => {
            selectNodeById(programId, true, true);
        }, 200);
    }
}

// Render program rows for the prompt details table
function renderPromptProgramRows(programs) {
    return programs.map(p => {
        const name = (p.metadata?.patch_name || p.id.substring(0, 8));
        const score = p.combined_score != null ? p.combined_score.toFixed(4) : 'N/A';
        const correct = p.correct ? '✓' : '✗';
        const correctColor = p.correct ? '#27ae60' : '#e74c3c';
        
        let improvement = '';
        let improvementColor = '#888';
        if (p.delta !== null) {
            improvement = (p.delta >= 0 ? '+' : '') + p.delta.toFixed(4);
            improvementColor = p.delta > 0 ? '#27ae60' : (p.delta < 0 ? '#e74c3c' : '#888');
        }
        
        // Beat percentage display
        let beatDisplay = '';
        let beatColor = '#888';
        if (p.beatPercent !== null) {
            beatDisplay = p.beatPercent.toFixed(1) + '%';
            // Color gradient: low = red, high = green
            if (p.beatPercent >= 75) beatColor = '#27ae60';
            else if (p.beatPercent >= 50) beatColor = '#8e44ad';
            else if (p.beatPercent >= 25) beatColor = '#e67e22';
            else beatColor = '#e74c3c';
        }
        
        return `<tr style="cursor: pointer;" onclick="selectProgramFromPromptView('${p.id}')" onmouseover="this.style.backgroundColor='#f0f0f0'" onmouseout="this.style.backgroundColor=''">
            <td style="padding: 4px 6px; border-bottom: 1px solid #eee; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${name}">${name}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #eee;">${p.generation}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #eee;">${score}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #eee; color: ${improvementColor};">${improvement}</td>
            <td style="padding: 4px 6px; text-align: right; border-bottom: 1px solid #eee; color: ${beatColor};">${beatDisplay}</td>
            <td style="padding: 4px 6px; text-align: center; border-bottom: 1px solid #eee; color: ${correctColor};">${correct}</td>
        </tr>`;
    }).join('');
}

// Sort the prompt programs table
export function sortPromptProgramsTable(column) {
    if (!window.promptGeneratedPrograms) return;
    
    // Toggle direction if same column
    if (window.promptProgramsSortCol === column) {
        window.promptProgramsSortAsc = !window.promptProgramsSortAsc;
    } else {
        window.promptProgramsSortCol = column;
        window.promptProgramsSortAsc = column === 'gen'; // Default asc for gen, desc for others
    }
    
    const asc = window.promptProgramsSortAsc;
    const programs = window.promptGeneratedPrograms;
    
    programs.sort((a, b) => {
        let valA, valB;
        switch (column) {
            case 'gen':
                valA = a.generation || 0;
                valB = b.generation || 0;
                break;
            case 'score':
                valA = a.combined_score ?? -Infinity;
                valB = b.combined_score ?? -Infinity;
                break;
            case 'delta':
                valA = a.delta ?? -Infinity;
                valB = b.delta ?? -Infinity;
                break;
            case 'beat':
                valA = a.beatPercent ?? -Infinity;
                valB = b.beatPercent ?? -Infinity;
                break;
            default:
                return 0;
        }
        return asc ? (valA - valB) : (valB - valA);
    });
    
    // Re-render tbody
    const tbody = document.getElementById('prompt-programs-tbody');
    if (tbody) {
        tbody.innerHTML = renderPromptProgramRows(programs);
    }
}

export function showFullPrompt() {
    if (!window.selectedPromptId || !window.metaPromptData) return;
    
    const prompt = window.metaPromptData.find(p => p.id === window.selectedPromptId);
    if (!prompt) return;
    
    // Find parent prompt if exists
    const parentPrompt = prompt.parent_id ? 
        window.metaPromptData.find(p => p.id === prompt.parent_id) : null;
    
    // Create modal to show full prompt with two panels
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 1000; display: flex;
        justify-content: center; align-items: center;
    `;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: white; padding: 20px; border-radius: 8px; width: 95%;
        height: 85%; display: flex; flex-direction: column; position: relative;
    `;
    
    // Generate diff HTML
    const diffHtml = parentPrompt ? 
        generatePromptDiff(parentPrompt.prompt_text, prompt.prompt_text) :
        '<div style="color: #888; text-align: center; padding: 40px;">No parent prompt (this is a root prompt)</div>';
    
    content.innerHTML = `
        <button onclick="this.parentElement.parentElement.remove()" 
            style="position: absolute; top: 10px; right: 15px; border: none; 
            background: none; font-size: 24px; cursor: pointer; z-index: 10;">×</button>
        <div style="display: flex; gap: 16px; flex: 1; min-height: 0; margin-top: 10px;">
            <!-- Left Panel: Raw Prompt -->
            <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                <h3 style="margin: 0 0 10px 0; color: #8e44ad; font-size: 14px; flex-shrink: 0;">
                    System Prompt Text
                    ${prompt.name ? `<span style="font-weight: normal; color: #666;"> — ${prompt.name}</span>` : ''}
                </h3>
                <pre style="white-space: pre-wrap; word-wrap: break-word; background: #1e1e1e; color: #d4d4d4;
                    padding: 15px; border-radius: 5px; font-size: 12px; flex: 1; overflow: auto; margin: 0;
                    font-family: 'Monaco', 'Menlo', 'Consolas', monospace; line-height: 1.5;">${escapeHtml(prompt.prompt_text)}</pre>
            </div>
            <!-- Right Panel: Diff with Parent -->
            <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                <h3 style="margin: 0 0 10px 0; color: #e67e22; font-size: 14px; flex-shrink: 0;">
                    Diff with Parent
                    ${parentPrompt ? `<span style="font-weight: normal; color: #666;"> — ${parentPrompt.name || parentPrompt.id.substring(0, 12) + '...'}</span>` : ''}
                </h3>
                <div style="background: #1e1e1e; border-radius: 5px; flex: 1; overflow: auto; font-family: 'Monaco', 'Menlo', 'Consolas', monospace; font-size: 12px; line-height: 1.5;">
                    ${diffHtml}
                </div>
            </div>
        </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
}

// Generate a visual diff between two prompt texts
function generatePromptDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    
    // Simple LCS-based diff
    const diff = computeLineDiff(oldLines, newLines);
    
    let html = '<div style="padding: 10px;">';
    
    diff.forEach(item => {
        const escapedLine = escapeHtml(item.line || '');
        const lineContent = escapedLine || '&nbsp;';
        
        if (item.type === 'unchanged') {
            html += `<div style="color: #888; padding: 1px 8px; border-left: 3px solid transparent;">
                <span style="color: #666; user-select: none; display: inline-block; width: 50px; text-align: right; margin-right: 12px;">${item.oldNum || ''} ${item.newNum || ''}</span>${lineContent}</div>`;
        } else if (item.type === 'removed') {
            html += `<div style="background: rgba(248, 81, 73, 0.15); color: #f85149; padding: 1px 8px; border-left: 3px solid #f85149;">
                <span style="color: #f85149; user-select: none; display: inline-block; width: 50px; text-align: right; margin-right: 12px;">-${item.oldNum || ''}</span>${lineContent}</div>`;
        } else if (item.type === 'added') {
            html += `<div style="background: rgba(63, 185, 80, 0.15); color: #3fb950; padding: 1px 8px; border-left: 3px solid #3fb950;">
                <span style="color: #3fb950; user-select: none; display: inline-block; width: 50px; text-align: right; margin-right: 12px;">+${item.newNum || ''}</span>${lineContent}</div>`;
        }
    });
    
    html += '</div>';
    return html;
}

// Compute line-by-line diff using a simple algorithm
function computeLineDiff(oldLines, newLines) {
    const result = [];
    
    // Build a map of line content to indices for new lines
    const newLineMap = new Map();
    newLines.forEach((line, idx) => {
        if (!newLineMap.has(line)) newLineMap.set(line, []);
        newLineMap.get(line).push(idx);
    });
    
    // Use longest common subsequence approach
    const lcs = computeLCS(oldLines, newLines);
    
    let oldIdx = 0, newIdx = 0, lcsIdx = 0;
    let oldLineNum = 1, newLineNum = 1;
    
    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (lcsIdx < lcs.length && oldIdx === lcs[lcsIdx].oldIdx && newIdx === lcs[lcsIdx].newIdx) {
            // Line is in both - unchanged
            result.push({ type: 'unchanged', line: oldLines[oldIdx], oldNum: oldLineNum, newNum: newLineNum });
            oldIdx++; newIdx++; lcsIdx++;
            oldLineNum++; newLineNum++;
        } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldIdx < lcs[lcsIdx].oldIdx)) {
            // Line was removed
            result.push({ type: 'removed', line: oldLines[oldIdx], oldNum: oldLineNum });
            oldIdx++; oldLineNum++;
        } else if (newIdx < newLines.length && (lcsIdx >= lcs.length || newIdx < lcs[lcsIdx].newIdx)) {
            // Line was added
            result.push({ type: 'added', line: newLines[newIdx], newNum: newLineNum });
            newIdx++; newLineNum++;
        }
    }
    
    return result;
}

// Compute longest common subsequence indices
function computeLCS(oldLines, newLines) {
    const m = oldLines.length;
    const n = newLines.length;
    
    // DP table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }
    
    // Backtrack to find LCS
    const lcs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (oldLines[i - 1] === newLines[j - 1]) {
            lcs.unshift({ oldIdx: i - 1, newIdx: j - 1, line: oldLines[i - 1] });
            i--; j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    
    return lcs;
}

