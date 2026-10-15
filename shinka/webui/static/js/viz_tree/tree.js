// Tree tab: D3 genealogy rendering.
import { computeDataHash, lastRenderedDataHash, loadDatabase, normalizeTreeRoots, setLastRenderedDataHash } from './loader.js';
import { displayNodeDetails } from './nodeDetails.js';
import { escapeHtml, formatScore, isFailedProposalNode } from './format.js';

export function renderGraph(data, forceRender = false) {
    console.log("[DEBUG] Starting graph rendering with D3 tree layout");

    try {
        // Skip render if data hasn't changed (unless forced)
        const currentHash = computeDataHash(data);
        if (!forceRender && currentHash === lastRenderedDataHash && document.querySelector("#tree svg")) {
            console.log("[DEBUG] Skipping render - data unchanged");
            return;
        }
        setLastRenderedDataHash(currentHash);
        
        d3.select("#tree").html(""); // Clear existing tree

        const margin = {top: 300, right: 120, bottom: 300, left: 120};
        const treeView = document.getElementById('tree-view');
        if (!treeView) {
            console.error("[DEBUG] tree-view element not found");
            return;
        }
        const panelWidth = treeView.offsetWidth;
        const panelHeight = treeView.offsetHeight;

        const svg = d3.select("#tree").append("svg")
            .attr("width", panelWidth)
            .attr("height", panelHeight)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .call(d3.zoom().extent([[0, 0], [panelWidth, panelHeight]]).scaleExtent([0.1, 8]).on("zoom", e => g.attr("transform", e.transform)))
            .append("g");
        
        const g = svg.append("g");

        // Create unified root structure for generation 0 programs
        let processedData = [...data];
        const gen0Programs = data.filter(d => d.generation === 0);
        const unifiedRootId = '___unified_root___';
        
        if (gen0Programs.length > 1) {
            // Create a unified root node representing the common origin
            const firstGen0 = gen0Programs[0];
            const unifiedRoot = {
                id: unifiedRootId,
                parent_id: null,
                code: firstGen0.code,
                language: firstGen0.language,
                generation: 0,
                timestamp: Math.min(...gen0Programs.map(p => p.timestamp)),
                agent_name: 'Initial Program',
                combined_score: firstGen0.combined_score,
                public_metrics: firstGen0.public_metrics,
                private_metrics: firstGen0.private_metrics,
                text_feedback: firstGen0.text_feedback,
                metadata: { ...firstGen0.metadata, patch_name: 'Initial Program' },
                complexity: firstGen0.complexity,
                embedding: firstGen0.embedding,
                embedding_pca_2d: firstGen0.embedding_pca_2d,
                embedding_pca_3d: firstGen0.embedding_pca_3d,
                island_idx: null, // No specific island for the unified root
                isUnifiedRoot: true
            };
            
            // Add the unified root to the data
            processedData.push(unifiedRoot);
            
            // Update all generation 0 programs to point to the unified root
            // Note: We don't increment generations here to preserve original data for other views
            processedData = processedData.map(d => {
                if (d.generation === 0 && d.id !== unifiedRootId) {
                    return {
                        ...d,
                        parent_id: unifiedRootId
                    };
                }
                return d;
            });
            
            console.log(`[DEBUG] Created unified root for ${gen0Programs.length} generation 0 programs`);
        }
        
        const nodes = processedData.map(d => ({...d, agent_name: d.metadata.patch_name || d.agent_name || "unnamed_agent"}));
        const hierarchyData = normalizeTreeRoots(nodes);
        
        const root = d3.stratify()
            .id(d => d.id)
            .parentId(d => d.parent_id)
            (hierarchyData);

        root.sort((a, b) => a.data.generation - b.data.generation || a.data.timestamp - b.data.timestamp);

        // Check if tree should be transposed
        const transposeCheckbox = document.getElementById('transpose-tree-checkbox');
        const isTransposed = transposeCheckbox && transposeCheckbox.checked;

        const nodeWidth = 100;
        const nodeHeight = 200;
        
        // For transposed (horizontal) layout, swap width and height in nodeSize
        const treeLayout = d3.tree().nodeSize(isTransposed ? [nodeHeight, nodeWidth] : [nodeWidth, nodeHeight]);
        treeLayout(root);

        // Calculate dimensions based on orientation
        let treeWidth, treeHeight;
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        root.each(d => {
            if (d.x < minX) minX = d.x;
            if (d.x > maxX) maxX = d.x;
            if (d.y < minY) minY = d.y;
            if (d.y > maxY) maxY = d.y;
        });
        
        if (isTransposed) {
            // In transposed mode, x is vertical (breadth), y is horizontal (depth)
            treeWidth = maxY - minY;
            treeHeight = maxX - minX;
            const calculatedLeftMargin = (panelWidth - treeWidth) / 2;
            margin.left = Math.max(120, calculatedLeftMargin);
            d3.select("#tree svg")
                .attr("viewBox", `0 ${minX - margin.top} ${treeWidth + margin.left + margin.right} ${treeHeight + margin.top + margin.bottom}`);
            g.attr("transform", `translate(${margin.left}, 0)`);
        } else {
            // Standard vertical mode
            treeWidth = maxX - minX;
            treeHeight = root.height * nodeHeight;
            const calculatedTopMargin = (panelHeight - treeHeight) / 2;
            margin.top = Math.max(100, calculatedTopMargin);
            d3.select("#tree svg")
                .attr("viewBox", `${minX - margin.left} 0 ${treeWidth + margin.left + margin.right} ${treeHeight + margin.top + margin.bottom}`);
            g.attr("transform", `translate(0, ${margin.top})`);
        }
        
        // Clear any stale best path data first
        window.bestNodeId = null;
        window.allBestPaths = [];
        window.bestScoreNodes = [];
        
        // Find the actual best score among correct nodes only
        const correctValidNodes = nodes.filter(d => {
            const isCorrect = d.correct === true || d.correct === 'true' || d.correct === 1;
            const hasValidScore = d.combined_score !== null && 
                                 d.combined_score !== undefined && 
                                 !isNaN(d.combined_score);
            if (hasValidScore && !isCorrect) {
                console.log("[DEBUG] Excluding incorrect node:", d.id.substring(0, 8), "correct:", d.correct, "score:", d.combined_score);
            }
            return isCorrect && hasValidScore;
        });
        console.log("[DEBUG] Total correct valid nodes for scoring:", correctValidNodes.length);
        
        // Debug: show some examples of correct vs incorrect nodes
        const allValidNodes = nodes.filter(d => d.combined_score !== null && d.combined_score !== undefined && !isNaN(d.combined_score));
        const incorrectNodes = allValidNodes.filter(d => !(d.correct === true || d.correct === 'true' || d.correct === 1));
        console.log("[DEBUG] Total valid nodes:", allValidNodes.length, "Incorrect nodes:", incorrectNodes.length);
        if (incorrectNodes.length > 0) {
            console.log("[DEBUG] Sample incorrect nodes:", incorrectNodes.slice(0, 3).map(d => ({id: d.id.substring(0, 8), correct: d.correct, score: d.combined_score})));
        }
        if (correctValidNodes.length > 0) {
            console.log("[DEBUG] Sample correct nodes:", correctValidNodes.slice(0, 3).map(d => ({id: d.id.substring(0, 8), correct: d.correct, score: d.combined_score})));
        }
        
        // Fallback to evaluated incorrect nodes before using failed proposals
        let scoringNodes = correctValidNodes;
        if (correctValidNodes.length === 0) {
            console.warn("[DEBUG] No correct nodes found for scoring, falling back to non-failed valid nodes");
            scoringNodes = allValidNodes.filter(d => !isFailedProposalNode(d));
            if (scoringNodes.length === 0) {
                console.warn("[DEBUG] No evaluated nodes found for scoring, falling back to all valid nodes");
                scoringNodes = allValidNodes;
            }
            if (scoringNodes.length === 0) {
                console.warn("[DEBUG] No valid nodes found for scoring");
                window.allBestPaths = [];
                return;
            }
        }
        
        // Find the highest score among the selected nodes
        const actualBestScore = Math.max(...scoringNodes.map(d => d.combined_score));
        console.log("[DEBUG] Actual best score found:", actualBestScore);
        
        // Use a more robust epsilon for floating-point comparison
        const epsilon = Math.max(1e-6, Math.abs(actualBestScore) * 1e-10);
        console.log("[DEBUG] Using epsilon:", epsilon);
        
        // Find all nodes with the best score (from the correct scoring nodes)
        const allNodesWithBestScore = scoringNodes.filter(d => {
            const scoreDiff = Math.abs(d.combined_score - actualBestScore);
            const isEqual = scoreDiff < epsilon;
            if (isEqual) {
                console.log("[DEBUG] Found node with best score:", d.id.substring(0, 8), "score:", d.combined_score, "correct:", d.correct, "diff:", scoreDiff);
            }
            return isEqual;
        });

        // Double-check: ensure only correct nodes are included for path highlighting
        const correctNodesWithBestScore = allNodesWithBestScore.filter(d => {
            const isCorrect = d.correct === true || d.correct === 'true' || d.correct === 1;
            if (!isCorrect) {
                console.log("[DEBUG] EXCLUDING incorrect node from best score paths:", d.id.substring(0, 8), "correct:", d.correct, "score:", d.combined_score);
            }
            return isCorrect;
        });
        
        // FORCE SINGLE PATH: Use best correct node, or fallback to best incorrect node if none exist
        let nodesWithBestScore;
        let usingFallbackNode = false;
        
        if (correctNodesWithBestScore.length > 0) {
            // Use the best correct node
            nodesWithBestScore = [correctNodesWithBestScore[0]];
            console.log("[DEBUG] SINGLE PATH MODE: Using best correct node:", nodesWithBestScore[0].id.substring(0, 8));
        } else if (allNodesWithBestScore.length > 0) {
            // No correct nodes - fallback to best incorrect node for visualization
            nodesWithBestScore = [allNodesWithBestScore[0]];
            usingFallbackNode = true;
            console.warn("[DEBUG] SINGLE PATH MODE: No correct nodes! Using best incorrect node as fallback:", nodesWithBestScore[0].id.substring(0, 8));
        } else {
            // No nodes at all - create empty array and bail out early
            nodesWithBestScore = [];
            console.warn("[DEBUG] SINGLE PATH MODE: No nodes available for best path");
        }
        
        // Handle case where no best node is available
        if (nodesWithBestScore.length === 0) {
            console.warn("[DEBUG] No nodes available for visualization - skipping best path setup");
            window.bestNodeId = null;
            window.bestScoreNodes = [];
            window.currentBestPathIndex = 0;
            window.allBestPaths = [];
            // Continue with rendering but without best path highlighting
        } else {
            // Set the best node
            const bestNode = nodesWithBestScore[0];
            
            if (usingFallbackNode) {
                console.warn("[DEBUG] Using fallback (incorrect) node:", bestNode.id.substring(0, 8), "score:", bestNode.combined_score, "correct:", bestNode.correct);
            } else {
                console.log("[DEBUG] Using best correct node:", bestNode.id.substring(0, 8), "score:", bestNode.combined_score, "correct:", bestNode.correct);
            }
        
            window.bestNodeId = bestNode.id;
        
            // Store information about multiple best paths (only correct nodes)
            window.bestScoreNodes = nodesWithBestScore;
            window.currentBestPathIndex = 0;
        }

        let bestNodeD3 = null;
        if (window.bestNodeId) {
            root.each(d => {
                if (d.data.id === window.bestNodeId) {
                    bestNodeD3 = d;
                }
            });
        }

        const ancestorIds = new Set();
        if (bestNodeD3 && window.bestNodeId) {
            // For correct nodes, populate ancestor path; for incorrect fallback nodes, still show path but with warning
            const bestNodeDataIsCorrect = bestNodeD3.data.correct === true || bestNodeD3.data.correct === 'true' || bestNodeD3.data.correct === 1;
            
            // Always populate ancestors for visualization (even for incorrect fallback nodes)
            bestNodeD3.ancestors().forEach(ancestor => {
                ancestorIds.add(ancestor.data.id);
            });
            
            if (bestNodeDataIsCorrect) {
                console.log("[DEBUG] Populated ancestorIds for correct best node:", window.bestNodeId.substring(0, 8), "path length:", ancestorIds.size);
            } else {
                console.warn("[DEBUG] Populated ancestorIds for FALLBACK (incorrect) node:", window.bestNodeId.substring(0, 8), "path length:", ancestorIds.size);
            }
        } else {
            console.log("[DEBUG] No ancestorIds populated - no valid best node found");
        }
        
        // Store all best paths for highlighting - FORCE SINGLE PATH
        window.allBestPaths = [];
        let foundNodesCount = 0;
        
        // SINGLE PATH MODE: Only process the first (and only) node
        if (nodesWithBestScore.length > 0) {
            const singleBestNode = nodesWithBestScore[0];
            console.log("[DEBUG] SINGLE PATH: Processing only one node:", singleBestNode.id.substring(0, 8));
        
            // Process only the single best node
            [singleBestNode].forEach((node, index) => {
            let nodeD3 = null;
            
            // First try to find the node in the D3 tree
            root.each(d => {
                if (d.data.id === node.id) {
                    nodeD3 = d;
                }
            });
            
            if (nodeD3) {
                foundNodesCount++;
                const pathIds = new Set();
                const pathNodes = nodeD3.ancestors();
                
                // Add the node itself to the path
                pathIds.add(nodeD3.data.id);
                
                // Add all ancestors
                pathNodes.forEach(ancestor => {
                    pathIds.add(ancestor.data.id);
                });
                
                console.log("[DEBUG] Path", index + 1, "- Node:", node.id.substring(0, 8), 
                           "Path length:", pathIds.size, "Score:", node.combined_score, "Generation:", node.generation);
                
                window.allBestPaths.push({
                    nodeId: node.id,
                    pathIds: pathIds,
                    score: node.combined_score,
                    generation: node.generation
                });
            } else {
                console.warn("[DEBUG] Could not find D3 node for best score node:", node.id.substring(0, 8), 
                            "- attempting manual path reconstruction");
                
                // Fallback: try to reconstruct path manually using the original nodes data
                const pathIds = new Set();
                pathIds.add(node.id);
                
                // Try to trace back through parent relationships
                let currentNode = node;
                while (currentNode && currentNode.parent_id) {
                    const parentNode = nodes.find(n => n.id === currentNode.parent_id);
                    if (parentNode) {
                        pathIds.add(parentNode.id);
                        currentNode = parentNode;
                    } else {
                        console.warn("[DEBUG] Could not find parent node:", currentNode.parent_id);
                        break;
                    }
                }
                
                if (pathIds.size > 1) {
                    console.log("[DEBUG] Reconstructed path", index + 1, "- Node:", node.id.substring(0, 8), 
                               "Path length:", pathIds.size, "Score:", node.combined_score);
                    
                    window.allBestPaths.push({
                        nodeId: node.id,
                        pathIds: pathIds,
                        score: node.combined_score,
                        generation: node.generation,
                        reconstructed: true
                    });
                    foundNodesCount++;
                }
            }
            });
        } else {
            console.log("[DEBUG] SINGLE PATH: No valid best node found");
        }
        
        console.log("[DEBUG] SINGLE PATH: Successfully found", foundNodesCount, "path(s)");
        
        // FORCE SINGLE PATH: Truncate to only the first path if multiple exist
        if (window.allBestPaths.length > 1) {
            console.log("[DEBUG] FORCE TRUNCATING to single path from", window.allBestPaths.length, "paths");
            window.allBestPaths = [window.allBestPaths[0]];
        }
        
        // FORCE SINGLE NODE: Ensure bestScoreNodes only has one node
        if (window.bestScoreNodes.length > 1) {
            console.log("[DEBUG] FORCE TRUNCATING bestScoreNodes to single node from", window.bestScoreNodes.length, "nodes");
            window.bestScoreNodes = [window.bestScoreNodes[0]];
        }
        
        // Summary for debugging - SINGLE PATH MODE
        if (window.allBestPaths.length === 1) {
            console.log("[DEBUG] SINGLE PATH MODE: One path found to:", window.allBestPaths[0].nodeId.substring(0, 8), "Score:", window.allBestPaths[0].score);
        } else {
            console.warn("[DEBUG] SINGLE PATH MODE: No paths found");
        }

        const scores = nodes
            .filter(d => d.correct && d.combined_score !== null && !isNaN(d.combined_score))
            .map(d => d.combined_score);

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
        const symbol = d3.symbol().size(2500);

        // Create color scale for islands with distinctive colors (avoiding orange used for best path)
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
        const islandColorScale = d3.scaleOrdinal(islandColors);
        
        const usedPatchTypes = [...new Set(nodes.map(d => d.metadata.patch_type).filter(Boolean))];
        const usedIslands = [...new Set(nodes.map(d => d.island_idx).filter(idx => idx !== null && idx !== undefined))].sort((a, b) => a - b);
        updateShapeLegend(shapeMap, usedPatchTypes, usedIslands, islandColorScale);

        const defs = g.append("defs");
        defs.append("marker")
            .attr("id", "arrowhead-standard")
            .attr("viewBox", "-10 -5 10 10").attr("refX", 20).attr("refY", 0).attr("orient", "auto")
            .attr("markerWidth", 8).attr("markerHeight", 8)
            .append("path").attr("d", "M -10,-5 L 0,0 L -10,5 Z").attr('fill', '#999');

        defs.append("marker")
            .attr("id", "arrowhead-selected")
            .attr("viewBox", "-10 -5 10 10").attr("refX", 20).attr("refY", 0).attr("orient", "auto")
            .attr("markerWidth", 10).attr("markerHeight", 10)
            .append("path").attr("d", "M -10,-5 L 0,0 L -10,5 Z").attr('fill', '#e58e26');
        
        const visibleLinks = root.links().filter(d => !d.source.data.isVirtual);

        const link = g.append("g")
            .attr("class", "links")
            .selectAll("path")
            .data(visibleLinks)
            .enter().append("path")
            .attr("class", "link")
            .attr("fill", "none")
            .style("stroke", d => {
                // Check if this link is on the SINGLE best path
                if (window.allBestPaths && window.allBestPaths.length > 0) {
                    // FORCE SINGLE PATH: Only check the first path
                    const singlePath = window.allBestPaths[0];
                    if (singlePath.pathIds.has(d.source.data.id) && singlePath.pathIds.has(d.target.data.id)) {
                        // Additional safety: ensure both nodes are correct before highlighting
                        const sourceCorrect = d.source.data.correct === true || d.source.data.correct === 'true' || d.source.data.correct === 1;
                        const targetCorrect = d.target.data.correct === true || d.target.data.correct === 'true' || d.target.data.correct === 1;
                        if (sourceCorrect && targetCorrect) {
                            return '#ff8c00'; // Always use orange for the single path
                        } else {
                            console.log("[DEBUG] Blocking orange highlight for link with incorrect node(s):", d.source.data.id.substring(0, 8), "->", d.target.data.id.substring(0, 8));
                            return "#999";
                        }
                    }
                }
                return "#999"; // Default color for non-best paths
            })
            .style("stroke-width", d => {
                // Check if this link is on any best path
                if (window.allBestPaths && window.allBestPaths.length > 0) {
                    for (let path of window.allBestPaths) {
                        if (path.pathIds.has(d.source.data.id) && path.pathIds.has(d.target.data.id)) {
                            return 4;
                        }
                    }
                }
                return 1.5; // Default width
            })
            .style("stroke-opacity", d => {
                // Check if this link is on any best path
                if (window.allBestPaths && window.allBestPaths.length > 0) {
                    for (let path of window.allBestPaths) {
                        if (path.pathIds.has(d.source.data.id) && path.pathIds.has(d.target.data.id)) {
                            return 1;
                        }
                    }
                }
                return 0.8; // Default opacity
            })
            .attr("d", isTransposed 
                ? d3.linkHorizontal()
                    .x(d => d.y)
                    .y(d => d.x)
                : d3.linkVertical()
                    .x(d => d.x)
                    .y(d => d.y)
            );

        const visibleNodes = root.descendants().filter(d => !d.data.isVirtual);
        
        const node = g.append("g").attr("class", "nodes").selectAll("g").data(visibleNodes)
            .enter().append("g")
            .attr("class", d => d.data.id === window.bestNodeId ? "node best-node" : "node")
            .attr("transform", d => isTransposed ? `translate(${d.y},${d.x})` : `translate(${d.x},${d.y})`)
            .on('click', (event, d) => {
                d3.selectAll('.node').classed('selected', false);
                d3.select(event.currentTarget).classed('selected', true);
                
                const selectedNodeId = d.data.id;
                const selectedAncestors = new Set(d.ancestors().map(n => n.data.id));

                // Update link styles - FORCE SINGLE PATH
                link.style("stroke", l => {
                        if (window.allBestPaths && window.allBestPaths.length > 0) {
                            // FORCE SINGLE PATH: Only check the first path
                            const singlePath = window.allBestPaths[0];
                            if (singlePath.pathIds.has(l.source.data.id) && singlePath.pathIds.has(l.target.data.id)) {
                                return '#ff8c00'; // Always orange for single path
                            }
                        }
                        
                        // Check if this link is on the selected path (non-best paths)
                        const onSelectedPath = selectedAncestors.has(l.source.data.id) && selectedAncestors.has(l.target.data.id);
                        if (onSelectedPath) {
                            return "gold";
                        }
                        return "#999";
                    })
                    .style("stroke-width", l => {
                        // Check if this link is on any best path
                        if (window.allBestPaths && window.allBestPaths.length > 0) {
                            for (let path of window.allBestPaths) {
                                if (path.pathIds.has(l.source.data.id) && path.pathIds.has(l.target.data.id)) {
                                    return 4;
                                }
                            }
                        }
                        // Check if this link is on the selected path
                        const onSelectedPath = selectedAncestors.has(l.source.data.id) && selectedAncestors.has(l.target.data.id);
                        return onSelectedPath ? 5 : 1.5;
                    })
                    .style("stroke-opacity", l => {
                        // Check if this link is on any best path or selected path
                        if (window.allBestPaths && window.allBestPaths.length > 0) {
                            for (let path of window.allBestPaths) {
                                if (path.pathIds.has(l.source.data.id) && path.pathIds.has(l.target.data.id)) {
                                    return 1;
                                }
                            }
                        }
                        const onSelectedPath = selectedAncestors.has(l.source.data.id) && selectedAncestors.has(l.target.data.id);
                        return onSelectedPath ? 1 : 0.8;
                    });
                
                // Update node styles - FORCE SINGLE PATH
                node.selectAll('path')
                    .style("stroke", n => {
                        if (window.allBestPaths && window.allBestPaths.length > 0) {
                            // FORCE SINGLE PATH: Only check the first path
                            const singlePath = window.allBestPaths[0];
                            if (singlePath.pathIds.has(n.data.id)) {
                                return '#ff8c00'; // Always orange for single path
                            }
                        }
                        if (isFailedProposalNode(n.data)) {
                            return '#c0392b';
                        }
                        return "#000"; // Default stroke
                    })
                    .style("stroke-width", n => {
                        // Check if this node is on any best path
                        if (window.allBestPaths && window.allBestPaths.length > 0) {
                            for (let path of window.allBestPaths) {
                                if (path.pathIds.has(n.data.id)) {
                                    return 4;
                                }
                            }
                        }
                        return 3; // Default width
                    })
                    .style("filter", n => n.data.id === window.bestNodeId ? "drop-shadow(0px 3px 6px rgba(255, 140, 0, 0.5))" : "drop-shadow(0px 2px 4px rgba(0,0,0,0.2))");
                
                node.filter('.selected')
                    .select('path')
                    .style("stroke", "#e58e26").style("stroke-width", 4)
                    .style("filter", "drop-shadow(0px 3px 8px rgba(229, 130, 38, 0.6))");

                displayNodeDetails(d.data);
                document.querySelector('.tab[data-tab="agent-code"]').click();
            })
            .on('mouseover', (event, d) => {
                const tooltip = d3.select("body").append("div")
                    .attr("class", "node-tooltip")
                    .style("opacity", 0);

                tooltip.transition().duration(200).style("opacity", 1);
                
                const patchName = d.data.metadata.patch_name || 'unnamed';
                const score = formatScore(d.data.combined_score);
                const patchType = d.data.metadata.patch_type || 'N/A';
                const islandIdx = d.data.island_idx !== null && d.data.island_idx !== undefined ? d.data.island_idx : 'N/A';
                const modelName = d.data.metadata?.model_name || 
                                 d.data.metadata?.llm_result?.model || 
                                 d.data.metadata?.model ||
                                 d.data.model_name ||
                                 d.data.model ||
                                 'N/A';
                
                if (d.data.isUnifiedRoot) {
                    tooltip.html(`
                        <strong style="color: #9b59b6; font-size: 13px;">⭐ ${patchName}</strong><br>
                        <strong>Type:</strong> Unified Root<br>
                        <strong>Score:</strong> ${score}<br>
                        <em>Common origin for all islands</em>
                    `);
                } else {
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
                        <strong>Island:</strong> ${islandIdx}<br>
                        <strong>Model:</strong> ${modelName}
                    `);
                    }
                }
                
                tooltip.style("left", (event.pageX + 15) + "px")
                       .style("top", (event.pageY - 10) + "px");
            })
            .on('mousemove', (event, d) => {
                d3.select(".node-tooltip")
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 10) + "px");
            })
            .on('mouseout', (event, d) => {
                d3.selectAll(".node-tooltip").transition().duration(200).style("opacity", 0).remove();
            });

        node.append("path")
            .attr("d", d => {
                // Use a star shape for the unified root
                if (d.data.isUnifiedRoot) {
                    symbol.type(d3.symbolStar).size(750);
                } else {
                    symbol.type(getShape(d.data.metadata.patch_type));
                }
                return symbol();
            })
            .style("fill", d => {
                if (d.data.isUnifiedRoot) return '#9b59b6'; // Purple for unified root
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
                // Check if this node is on the SINGLE best path
                if (window.allBestPaths && window.allBestPaths.length > 0) {
                    // FORCE SINGLE PATH: Only check the first path
                    const singlePath = window.allBestPaths[0];
                    if (singlePath.pathIds.has(d.data.id)) {
                        // Additional safety: ensure node is correct before highlighting
                        const nodeCorrect = d.data.correct === true || d.data.correct === 'true' || d.data.correct === 1;
                        if (nodeCorrect) {
                            return '#ff8c00'; // Always use orange for the single path
                        } else {
                            console.log("[DEBUG] Blocking orange highlight for incorrect node:", d.data.id.substring(0, 8), "correct:", d.data.correct);
                            return "#000";
                        }
                    }
                }
                if (isFailedProposalNode(d.data)) return '#c0392b';
                return "#000"; // Default stroke
            })
            .style("stroke-width", d => {
                // Check if this node is on any best path
                if (window.allBestPaths && window.allBestPaths.length > 0) {
                    for (let path of window.allBestPaths) {
                        if (path.pathIds.has(d.data.id)) {
                            return 4;
                        }
                    }
                }
                return 3; // Default width
            })
            .style("stroke-dasharray", d => isFailedProposalNode(d.data) ? "6,3" : null)
            .style("filter", d => d.data.id === window.bestNodeId ? "drop-shadow(0px 3px 6px rgba(255, 140, 0, 0.5))" : "drop-shadow(0px 2px 4px rgba(0,0,0,0.2))");

        // Add animated rings for the SINGLE best node
        if (window.allBestPaths && window.allBestPaths.length > 0) {
            // FORCE SINGLE PATH: Only process the first path, always use orange
            const singlePath = window.allBestPaths[0];
            [singlePath].forEach((path, index) => {
                const pathColor = '#ff8c00'; // Always orange for single path
                const shadowColor = 'rgba(255, 140, 0, 0.3)'; // Always orange shadow
                
                node.filter(d => d.data.id === path.nodeId)
                    .insert("circle", ":first-child")
                    .attr("r", 24)
                    .style("fill", "none")
                    .style("stroke", pathColor)
                    .style("stroke-width", 3)
                    .style("stroke-dasharray", "5,3")
                    .style("opacity", 0.8)
                    .style("filter", `drop-shadow(0px 2px 4px ${shadowColor})`)
                    .style("animation", "pulse 2s infinite");
            });
        } else {
            // Fallback: add ring for the single best node if no paths detected
            node.filter(d => d.data.id === window.bestNodeId)
                .insert("circle", ":first-child")
                .attr("r", 24).style("fill", "none").style("stroke", "#ff8c00")
                .style("stroke-width", 3).style("stroke-dasharray", "5,3").style("opacity", 0.8)
                .style("filter", "drop-shadow(0px 2px 4px rgba(255, 140, 0, 0.3))")
                .style("animation", "pulse 2s infinite");
        }

        node.append("text")
            .attr("dy", "0.75em")
            .attr("text-anchor", "middle")
            .style("font-size", "24px").style("font-weight", "bold").style("fill", "white")
            .style("pointer-events", "none")
            .text(d => d.data.generation);

        // Add island index indicator with background
        const islandNodes = node.filter(d => d.data.island_idx !== null && d.data.island_idx !== undefined);
        
        // Add background rectangle for island text
        islandNodes.append("rect")
            .attr("x", -15)
            .attr("y", -35)
            .attr("width", 30)
            .attr("height", 20)
            .attr("rx", 4)
            .style("fill", d => islandColorScale(d.data.island_idx))
            .style("stroke", "#2c3e50")
            .style("stroke-width", "1px")
            .style("pointer-events", "none");
        
        // Add island text (centered in the rectangle)
        islandNodes.append("text")
            .attr("x", 0)
            .attr("y", -15)  // Adjusted for larger rectangle
            .attr("text-anchor", "middle")
            .attr("dy", "0.35em")  // Better vertical centering
            .style("font-size", "17px")
            .style("font-weight", "bold")
            .style("fill", "white")
            .style("pointer-events", "none")
            .text(d => `I${d.data.island_idx}`);

        // Handle tree animation if enabled
        const animateCheckbox = document.getElementById('animate-tree-checkbox');
        const shouldAnimate = animateCheckbox && animateCheckbox.checked;
        
        if (shouldAnimate) {
            // Stop any existing animation timers
            if (window.treeAnimationTimers) {
                window.treeAnimationTimers.forEach(t => clearTimeout(t));
            }
            window.treeAnimationTimers = [];
            
            // Get max depth (generation) for animation
            let maxDepth = 0;
            visibleNodes.forEach(d => {
                if (d.depth > maxDepth) maxDepth = d.depth;
            });
            
            console.log("[DEBUG] Starting tree animation, max depth:", maxDepth);
            
            // Animation settings - dynamic delay based on tree depth
            // Target total animation time of ~4-5 seconds for the tree reveal
            const targetTotalTime = 5000; // ms for entire tree reveal
            const minDelay = 100; // minimum ms between depths (for very deep trees)
            const maxDelay = 1000; // maximum ms between depths (for shallow trees)
            const depthDelay = Math.max(minDelay, Math.min(maxDelay, targetTotalTime / Math.max(1, maxDepth)));
            const transitionDuration = Math.min(500, depthDelay * 0.8); // fade-in scales with delay
            const pauseBeforeRestart = 1500; // ms pause before restarting loop
            
            console.log("[DEBUG] Animation timing - depthDelay:", depthDelay.toFixed(0), "ms, transitionDuration:", transitionDuration.toFixed(0), "ms");
            
            // Function to run one animation cycle
            function runAnimationCycle() {
                // Check if animation should still run
                if (!animateCheckbox.checked) {
                    console.log("[DEBUG] Animation stopped (checkbox unchecked)");
                    return;
                }
                
                // Clear any existing timers
                if (window.treeAnimationTimers) {
                    window.treeAnimationTimers.forEach(t => clearTimeout(t));
                }
                window.treeAnimationTimers = [];
                
                // Reset all nodes and links to hidden
                node.style("opacity", 0);
                link.style("opacity", 0);
                
                // Animate each depth sequentially
                for (let depth = 0; depth <= maxDepth; depth++) {
                    const timer = setTimeout(() => {
                        // Check if still animating
                        if (!animateCheckbox.checked) return;
                        
                        // Animate nodes at this depth
                        node.filter(d => d.depth === depth)
                            .transition()
                            .duration(transitionDuration)
                            .ease(d3.easeCubicOut)
                            .style("opacity", 1);
                        
                        // Animate links connecting to this depth (where target is at this depth)
                        link.filter(d => d.target.depth === depth)
                            .transition()
                            .duration(transitionDuration)
                            .ease(d3.easeCubicOut)
                            .style("opacity", d => {
                                // Restore the original opacity logic
                                if (window.allBestPaths && window.allBestPaths.length > 0) {
                                    for (let path of window.allBestPaths) {
                                        if (path.pathIds.has(d.source.data.id) && path.pathIds.has(d.target.data.id)) {
                                            return 1;
                                        }
                                    }
                                }
                                return 0.8;
                            });
                    }, depth * depthDelay);
                    window.treeAnimationTimers.push(timer);
                }
                
                // Schedule next cycle after this one completes
                const restartTimer = setTimeout(() => {
                    if (animateCheckbox.checked) {
                        console.log("[DEBUG] Restarting animation cycle");
                        runAnimationCycle();
                    }
                }, (maxDepth + 1) * depthDelay + transitionDuration + pauseBeforeRestart);
                window.treeAnimationTimers.push(restartTimer);
            }
            
            // Start the first animation cycle
            runAnimationCycle();
        }

        if (window.pendingNodeSelectionId) {
            const nodeIdToSelect = window.pendingNodeSelectionId;
            window.pendingNodeSelectionId = null; // Clear it immediately

            // Use a short timeout to ensure D3 has finished DOM manipulations
            setTimeout(() => {
                const nodeElement = d3.selectAll('.node')
                    .filter(d => d.data.id === nodeIdToSelect)
                    .node();
                
                if (nodeElement) {
                    console.log('[DEBUG] Applying pending node selection:', nodeIdToSelect);
                    nodeElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                } else {
                    console.warn('[DEBUG] Could not find node for pending selection:', nodeIdToSelect);
                }
            }, 100);
        }
        

    } catch (error) {
        console.error("[DEBUG] Error in renderGraph:", error);
    }
}

function updateShapeLegend(shapeMap, usedPatchTypes, usedIslands = [], islandColorScale = null) {
    const legendContainer = d3.select("#shape-legend");
    legendContainer.selectAll(".shape-legend-item").remove(); // Clear previous items

    const legendSymbol = d3.symbol().size(64);

    // Add patch type legend items
    for (const type in shapeMap) {
        if (usedPatchTypes.includes(type)) {
            const legendItem = legendContainer.append("div")
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
                .attr("class", "legend-shape")
                .attr("transform", "translate(8, 8)");

            legendItem.append("span").text(type);
        }
    }

    // Add island legend items to the dedicated islands legend container
    const islandsLegendContainer = d3.select("#islands-legend-items");
    islandsLegendContainer.selectAll(".island-legend-item").remove(); // Clear previous island items
    
    if (usedIslands.length > 0 && islandColorScale) {
        // Show the islands legend section
        d3.select("#islands-legend").style("display", "block");
        
        // Update the header with island count
        const islandTitle = document.getElementById("islands-legend-title");
        islandTitle.textContent = `${usedIslands.length} Island${usedIslands.length !== 1 ? 's' : ''}`;
        
        // Setup toggle functionality
        const header = document.getElementById("islands-legend-header");
        const arrow = document.getElementById("islands-toggle-arrow");
        const items = document.getElementById("islands-legend-items");
        
        // Remove any existing click listeners
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);
        
        newHeader.addEventListener("click", function() {
            const currentDisplay = items.style.display;
            if (currentDisplay === "none" || currentDisplay === "") {
                items.style.display = "flex";
                document.getElementById("islands-toggle-arrow").style.transform = "rotate(90deg)";
            } else {
                items.style.display = "none";
                document.getElementById("islands-toggle-arrow").style.transform = "rotate(0deg)";
            }
        });
        
        usedIslands.forEach(islandIdx => {
            const legendItem = islandsLegendContainer.append("div")
                .attr("class", "island-legend-item")
                .style("display", "flex")
                .style("align-items", "center");

            const svg = legendItem.append("svg")
                .attr("width", 16)
                .attr("height", 16)
                .style("margin-right", "5px");

            // Create a small colored rectangle for island
            svg.append("rect")
                .attr("x", 2)
                .attr("y", 4)
                .attr("width", 12)
                .attr("height", 8)
                .attr("rx", 2)
                .style("fill", islandColorScale(islandIdx))
                .style("stroke", "#2c3e50")
                .style("stroke-width", "1px");

            // Add small text inside the rectangle
            svg.append("text")
                .attr("x", 8)
                .attr("y", 8)
                .attr("text-anchor", "middle")
                .attr("dy", "0.35em")
                .style("font-size", "8px")
                .style("font-weight", "bold")
                .style("fill", "white")
                .text(`I${islandIdx}`);

            legendItem.append("span").text(`Island ${islandIdx}`);
        });
    } else {
        // Hide the islands legend section if no islands
        d3.select("#islands-legend").style("display", "none");
    }
}

// Add window resize event listener to redraw the tree
window.addEventListener('resize', function() {
    console.log("[DEBUG] Window resized");
    
    // Skip reload during manual panel resizing
    if (window.isResizing) {
        console.log("[DEBUG] Skipping window resize handler during panel resize");
        return;
    }
    
    // Debounce resize handler to prevent multiple rapid updates
    if (window.resizeTimeout) {
        clearTimeout(window.resizeTimeout);
    }
    
    window.resizeTimeout = setTimeout(function() {
        if (window.treeData) {
            renderGraph(window.treeData, true);  // Force render on resize
        } else {
            // Full reload only if necessary
                            const resultSelect = document.getElementById('result-select');
        if (resultSelect.value) {
            loadDatabase(resultSelect.value);
            }
        }
    }, 300);
});

// Add specific panel resize handling to redraw the tree when panels are resized
const observer = new ResizeObserver(() => {
    console.log("[DEBUG] Panel resized");

    if (window.isResizing) {
        return;
    }

    if (window.treeResizeTimeout) {
        clearTimeout(window.treeResizeTimeout);
    }

    window.treeResizeTimeout = setTimeout(() => {
        const treeTab = document.querySelector('.left-tab[data-tab="tree-view"]');
        if (window.treeData && treeTab && treeTab.classList.contains('active')) {
            renderGraph(window.treeData, true);
        }
    }, 100);
});

// Observe the tree panel for size changes
observer.observe(document.getElementById('tree-panel'));
