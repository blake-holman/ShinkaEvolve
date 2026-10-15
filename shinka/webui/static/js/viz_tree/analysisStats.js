// Analysis tab: statistics computed from program metadata.
import { debug } from '../log.js';

// ========== ANALYSIS TAB FUNCTIONS ==========

// Data processing functions
export function computeLLMStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const modelStats = {};
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    data.forEach(node => {
        // Skip nodes without a parent (they're root nodes)
        if (!node.parent_id) return;
        
        const parent = nodeMap.get(node.parent_id);
        if (!parent) return;
        
        // Try multiple possible locations for model name (matching LLM Posterior logic)
        const modelName = node.metadata?.model_name || 
                         node.metadata?.llm_result?.model || 
                         node.metadata?.model ||
                         node.model_name ||
                         node.model ||
                         'unknown';
        const patchType = node.metadata?.patch_type || 'unknown';
        
        if (!modelStats[modelName]) {
            modelStats[modelName] = {
                totalAttempts: 0,
                successes: 0,
                improvements: 0,
                totalDelta: 0,
                totalCost: 0,
                patchTypes: {}
            };
        }
        
        const stats = modelStats[modelName];
        
        // patch_attempt indicates which attempt succeeded (1-indexed)
        // If patch_attempt = 2, then attempt 1 failed and attempt 2 succeeded
        // So total attempts = patch_attempt (or 1 if not set)
        const patchAttempt = node.metadata?.patch_attempt || 1;
        
        stats.totalAttempts += patchAttempt;
        stats.successes++; // This node exists, so it's a success
        
        // Use the actual 'correct' field from program data
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        const parentIsCorrect = parent.correct === true || parent.correct === 'true' || parent.correct === 1;
        
        if (node.combined_score > parent.combined_score) {
            stats.improvements++;
            stats.totalDelta += (node.combined_score - parent.combined_score);
        }
        
        const cost = (node.metadata?.api_costs || 0) + 
                    (node.metadata?.embed_cost || 0) + 
                    (node.metadata?.novelty_cost || 0) + 
                    (node.metadata?.meta_cost || 0);
        stats.totalCost += cost;
        
        if (!stats.patchTypes[patchType]) {
            stats.patchTypes[patchType] = { totalAttempts: 0, successes: 0, improvements: 0, correctPrograms: 0, improvementsFromCorrect: 0 };
        }
        stats.patchTypes[patchType].totalAttempts += patchAttempt;
        stats.patchTypes[patchType].successes++;
        
        // Track correct programs and improvements from correct programs
        if (isCorrect) {
            stats.patchTypes[patchType].correctPrograms++;
            if (node.combined_score > parent.combined_score) {
                stats.patchTypes[patchType].improvementsFromCorrect++;
            }
        }
        
        if (node.combined_score > parent.combined_score) {
            stats.patchTypes[patchType].improvements++;
        }
    });
    
    return { modelStats, selectedNode };
}

export function computeMutationStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const patchTypeStats = {};
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    data.forEach(node => {
        if (!node.parent_id) return;
        
        const patchType = node.metadata?.patch_type || 'unknown';
        if (!patchTypeStats[patchType]) {
            patchTypeStats[patchType] = {
                totalAttempts: 0,
                successes: 0,
                failures: 0,
                improvements: 0,
                correctPrograms: 0,
                improvementsFromCorrect: 0,
                numApplied: [],
                retryAttempts: []
            };
        }
        
        const stats = patchTypeStats[patchType];
        
        // patch_attempt indicates which attempt succeeded (1-indexed)
        // If patch_attempt = 2, then attempt 1 failed and attempt 2 succeeded
        const patchAttempt = node.metadata?.patch_attempt || 1;
        
        stats.totalAttempts += patchAttempt;
        stats.successes++; // This node exists, so it's a success
        stats.failures += (patchAttempt - 1); // Number of failed attempts before success
        
        const parent = nodeMap.get(node.parent_id);
        if (parent && node.combined_score > parent.combined_score) {
            stats.improvements++;
        }
        
        // Track correct programs and improvements from correct programs
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        if (isCorrect) {
            stats.correctPrograms++;
            if (parent && node.combined_score > parent.combined_score) {
                stats.improvementsFromCorrect++;
            }
        }
        
        if (node.metadata?.num_applied !== undefined) {
            stats.numApplied.push(node.metadata.num_applied);
        }
        
        const resampleAttempt = node.metadata?.resample_attempt || 0;
        stats.retryAttempts.push(patchAttempt + resampleAttempt);
    });
    
    return { patchTypeStats, selectedNode };
}

export function computeNoveltyLLMStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const modelStats = {};
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    data.forEach(node => {
        // Skip nodes without a parent (they're root nodes)
        if (!node.parent_id) return;
        
        // Only consider novelty attempts (nodes with novelty_attempt field)
        if (!node.metadata?.novelty_attempt || node.metadata.novelty_attempt <= 0) return;
        
        const parent = nodeMap.get(node.parent_id);
        if (!parent) return;
        
        const modelName = node.metadata?.model_name || 
                         node.metadata?.llm_result?.model || 
                         node.metadata?.model ||
                         node.model_name ||
                         node.model ||
                         'unknown';
        const patchType = node.metadata?.patch_type || 'unknown';
        
        if (!modelStats[modelName]) {
            modelStats[modelName] = {
                totalAttempts: 0,
                successes: 0,
                improvements: 0,
                totalDelta: 0,
                totalCost: 0,
                patchTypes: {}
            };
        }
        
        const stats = modelStats[modelName];
        // Use novelty_attempt to count total attempts
        const noveltyAttempt = node.metadata?.novelty_attempt || 1;
        
        stats.totalAttempts += noveltyAttempt;
        stats.successes++;
        
        if (node.combined_score > parent.combined_score) {
            stats.improvements++;
            stats.totalDelta += (node.combined_score - parent.combined_score);
        }
        
        const cost = (node.metadata?.api_costs || 0) + 
                    (node.metadata?.embed_cost || 0) + 
                    (node.metadata?.novelty_cost || 0) + 
                    (node.metadata?.meta_cost || 0);
        stats.totalCost += cost;
        
        if (!stats.patchTypes[patchType]) {
            stats.patchTypes[patchType] = { totalAttempts: 0, successes: 0, improvements: 0, correctPrograms: 0, improvementsFromCorrect: 0 };
        }
        stats.patchTypes[patchType].totalAttempts += noveltyAttempt;
        stats.patchTypes[patchType].successes++;
        
        // Track correct programs and improvements from correct programs
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        if (isCorrect) {
            stats.patchTypes[patchType].correctPrograms++;
            if (node.combined_score > parent.combined_score) {
                stats.patchTypes[patchType].improvementsFromCorrect++;
            }
        }
        
        if (node.combined_score > parent.combined_score) {
            stats.patchTypes[patchType].improvements++;
        }
    });
    
    return { modelStats, selectedNode };
}

export function computeNoveltyMutationStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const patchTypeStats = {};
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    data.forEach(node => {
        if (!node.parent_id) return;
        
        // Only consider novelty attempts (nodes with novelty_attempt field)
        if (!node.metadata?.novelty_attempt || node.metadata.novelty_attempt <= 0) return;
        
        const patchType = node.metadata?.patch_type || 'unknown';
        if (!patchTypeStats[patchType]) {
            patchTypeStats[patchType] = {
                totalAttempts: 0,
                successes: 0,
                failures: 0,
                improvements: 0,
                correctPrograms: 0,
                improvementsFromCorrect: 0,
                numApplied: [],
                retryAttempts: []
            };
        }
        
        const stats = patchTypeStats[patchType];
        // Use novelty_attempt to count total attempts
        const noveltyAttempt = node.metadata?.novelty_attempt || 1;
        
        stats.totalAttempts += noveltyAttempt;
        stats.successes++;
        stats.failures += (noveltyAttempt - 1);
        
        const parent = nodeMap.get(node.parent_id);
        if (parent && node.combined_score > parent.combined_score) {
            stats.improvements++;
        }
        
        // Track correct programs and improvements from correct programs
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        if (isCorrect) {
            stats.correctPrograms++;
            if (parent && node.combined_score > parent.combined_score) {
                stats.improvementsFromCorrect++;
            }
        }
        
        if (node.metadata?.num_applied !== undefined) {
            stats.numApplied.push(node.metadata.num_applied);
        }
        
        const resampleAttempt = node.metadata?.resample_attempt || 0;
        stats.retryAttempts.push(noveltyAttempt + resampleAttempt);
    });
    
    return { patchTypeStats, selectedNode };
}

export function computeResampleLLMStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const modelStats = {};
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    data.forEach(node => {
        // Skip nodes without a parent (they're root nodes)
        if (!node.parent_id) return;
        
        // Only consider resample attempts (nodes with resample_attempt field)
        if (!node.metadata?.resample_attempt || node.metadata.resample_attempt <= 0) return;
        
        const parent = nodeMap.get(node.parent_id);
        if (!parent) return;
        
        const modelName = node.metadata?.model_name || 
                         node.metadata?.llm_result?.model || 
                         node.metadata?.model ||
                         node.model_name ||
                         node.model ||
                         'unknown';
        const patchType = node.metadata?.patch_type || 'unknown';
        
        if (!modelStats[modelName]) {
            modelStats[modelName] = {
                totalAttempts: 0,
                successes: 0,
                improvements: 0,
                totalDelta: 0,
                totalCost: 0,
                patchTypes: {}
            };
        }
        
        const stats = modelStats[modelName];
        // Use resample_attempt to count total attempts
        const resampleAttempt = node.metadata?.resample_attempt || 1;
        
        stats.totalAttempts += resampleAttempt;
        stats.successes++;
        
        if (node.combined_score > parent.combined_score) {
            stats.improvements++;
            stats.totalDelta += (node.combined_score - parent.combined_score);
        }
        
        const cost = (node.metadata?.api_costs || 0) + 
                    (node.metadata?.embed_cost || 0) + 
                    (node.metadata?.novelty_cost || 0) + 
                    (node.metadata?.meta_cost || 0);
        stats.totalCost += cost;
        
        if (!stats.patchTypes[patchType]) {
            stats.patchTypes[patchType] = { totalAttempts: 0, successes: 0, improvements: 0, correctPrograms: 0, improvementsFromCorrect: 0 };
        }
        stats.patchTypes[patchType].totalAttempts += resampleAttempt;
        stats.patchTypes[patchType].successes++;
        
        // Track correct programs and improvements from correct programs
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        if (isCorrect) {
            stats.patchTypes[patchType].correctPrograms++;
            if (node.combined_score > parent.combined_score) {
                stats.patchTypes[patchType].improvementsFromCorrect++;
            }
        }
        
        if (node.combined_score > parent.combined_score) {
            stats.patchTypes[patchType].improvements++;
        }
    });
    
    return { modelStats, selectedNode };
}

export function computeResampleMutationStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const patchTypeStats = {};
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    data.forEach(node => {
        if (!node.parent_id) return;
        
        // Only consider resample attempts (nodes with resample_attempt field)
        if (!node.metadata?.resample_attempt || node.metadata.resample_attempt <= 0) return;
        
        const patchType = node.metadata?.patch_type || 'unknown';
        if (!patchTypeStats[patchType]) {
            patchTypeStats[patchType] = {
                totalAttempts: 0,
                successes: 0,
                failures: 0,
                improvements: 0,
                correctPrograms: 0,
                improvementsFromCorrect: 0,
                numApplied: [],
                retryAttempts: []
            };
        }
        
        const stats = patchTypeStats[patchType];
        // Use resample_attempt to count total attempts
        const resampleAttempt = node.metadata?.resample_attempt || 1;
        
        stats.totalAttempts += resampleAttempt;
        stats.successes++;
        stats.failures += (resampleAttempt - 1);
        
        const parent = nodeMap.get(node.parent_id);
        if (parent && node.combined_score > parent.combined_score) {
            stats.improvements++;
        }
        
        // Track correct programs and improvements from correct programs
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        if (isCorrect) {
            stats.correctPrograms++;
            if (parent && node.combined_score > parent.combined_score) {
                stats.improvementsFromCorrect++;
            }
        }
        
        if (node.metadata?.num_applied !== undefined) {
            stats.numApplied.push(node.metadata.num_applied);
        }
        
        const patchAttempt = node.metadata?.patch_attempt || 0;
        const noveltyAttempt = node.metadata?.novelty_attempt || 0;
        stats.retryAttempts.push(patchAttempt + noveltyAttempt + resampleAttempt);
    });
    
    return { patchTypeStats, selectedNode };
}

export function computeLineageStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    
    // Build parent-child relationships
    const childrenMap = new Map();
    data.forEach(node => {
        if (node.parent_id) {
            if (!childrenMap.has(node.parent_id)) {
                childrenMap.set(node.parent_id, []);
            }
            childrenMap.get(node.parent_id).push(node);
        }
    });
    
    // Calculate children_count and improving descendants for each node
    const childrenCounts = [];
    const topFertile = [];
    
    data.forEach(node => {
        const children = childrenMap.get(node.id) || [];
        const count = children.length;
        childrenCounts.push(count);
        
        if (count > 0) {
            // Count children with score improvement
            const improvingChildren = children.filter(child => 
                child.combined_score > node.combined_score
            ).length;
            
            const modelName = node.metadata?.model_name || 
                             node.metadata?.llm_result?.model || 
                             node.metadata?.model ||
                             node.model_name ||
                             node.model ||
                             'N/A';
            
            topFertile.push({
                id: node.id,
                name: node.metadata?.patch_name || 'unnamed',
                generation: node.generation,
                children: count,
                improvingChildren: improvingChildren,
                score: node.combined_score || 0,
                correct: node.correct || false,
                patchType: node.metadata?.patch_type || 'N/A',
                islandIdx: node.island_idx !== null && node.island_idx !== undefined ? node.island_idx : 'N/A',
                modelName: modelName
            });
        }
    });
    
    topFertile.sort((a, b) => b.children - a.children);
    
    const deadEnds = data.filter(node => 
        node.correct && (childrenMap.get(node.id)?.length || 0) === 0
    ).length;
    
    return { childrenCounts, topFertile: topFertile.slice(0, 10), deadEnds, selectedNode };
}

export function computeCodeBloatStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const selectedNode = selectedNodeId ? data.find(d => d.id === selectedNodeId) : null;
    const bloatData = [];
    
    data.forEach(node => {
        const metrics = node.metadata?.code_analysis_metrics;
        if (!metrics || metrics.lines_of_code === undefined) return;
        
        bloatData.push({
            id: node.id,
            generation: node.generation,
            loc: metrics.lines_of_code,
            lloc: metrics.logical_lines_of_code || metrics.lines_of_code,
            complexity: metrics.cyclomatic_complexity || 0,
            maintainability: metrics.maintainability_index || 0
        });
    });
    
    // Group by generation
    const genData = {};
    bloatData.forEach(d => {
        if (!genData[d.generation]) {
            genData[d.generation] = { locs: [], llocs: [], complexities: [] };
        }
        genData[d.generation].locs.push(d.loc);
        genData[d.generation].llocs.push(d.lloc);
        genData[d.generation].complexities.push(d.complexity);
    });
    
    const genStats = Object.keys(genData).sort((a, b) => +a - +b).map(gen => ({
        generation: +gen,
        avgLoc: genData[gen].locs.reduce((a, b) => a + b, 0) / genData[gen].locs.length,
        avgLloc: genData[gen].llocs.reduce((a, b) => a + b, 0) / genData[gen].llocs.length,
        avgComplexity: genData[gen].complexities.reduce((a, b) => a + b, 0) / genData[gen].complexities.length
    }));
    
    return { bloatData, genStats, selectedNode };
}

export function computeMutationSizeStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const nodeMap = new Map(data.map(d => [d.id, d]));
    const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;
    const mutationData = [];
    
    data.forEach(node => {
        // Skip nodes without a parent
        if (!node.parent_id) return;
        
        const parent = nodeMap.get(node.parent_id);
        if (!parent) return;
        
        // Get diff_summary from metadata
        const diffSummary = node.metadata?.diff_summary;
        if (!diffSummary) return;
        
        // Calculate mutation size (total lines changed)
        const added = diffSummary.added || 0;
        const deleted = diffSummary.deleted || 0;
        const modified = diffSummary.modified || 0;
        const mutationSize = added + deleted + modified;
        
        // Skip if scores are null/undefined
        if (node.combined_score === null || node.combined_score === undefined ||
            parent.combined_score === null || parent.combined_score === undefined) {
            return;
        }
        
        // Calculate performance improvement
        const improvement = node.combined_score - parent.combined_score;
        
        mutationData.push({
            id: node.id,
            programName: node.metadata?.patch_name || 'unnamed',
            generation: node.generation,
            score: node.combined_score,
            parentScore: parent.combined_score,
            mutationSize: mutationSize,
            improvement: improvement,
            added: added,
            deleted: deleted,
            modified: modified,
            patchType: node.metadata?.patch_type || 'unknown',
            modelName: node.metadata?.model_name || 'unknown',
            isImprovement: improvement > 0,
            isCorrect: node.correct || false
        });
    });
    
    return { mutationData, selectedNode };
}

export function computeCorrectnessRateStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const selectedNode = selectedNodeId ? data.find(d => d.id === selectedNodeId) : null;
    
    // Sort programs by generation (and by timestamp if available for stability)
    const sortedData = [...data].sort((a, b) => {
        if (a.generation !== b.generation) {
            return a.generation - b.generation;
        }
        // Secondary sort by timestamp if available
        const timeA = a.metadata?.timestamp || 0;
        const timeB = b.metadata?.timestamp || 0;
        return timeA - timeB;
    });
    
    const patchTypes = ['diff', 'full', 'cross', 'init', 'fix'];
    
    // Calculate rolling correctness rates
    let overallCorrect = 0;
    let overallTotal = 0;
    const generations = [];
    const overallRates = [];
    
    // Track rolling rates by patch type
    const rollingByPatchType = {};
    patchTypes.forEach(pt => {
        rollingByPatchType[pt] = {
            correct: 0,
            total: 0,
            generations: [],
            rates: []
        };
    });
    
    sortedData.forEach((node, idx) => {
        const gen = node.generation;
        const patchType = node.metadata?.patch_type || 'unknown';
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        
        // Update overall rolling rate
        overallTotal++;
        if (isCorrect) overallCorrect++;
        
        generations.push(gen);
        overallRates.push((overallCorrect / overallTotal) * 100);
        
        // Update patch type rolling rates
        if (patchTypes.includes(patchType)) {
            rollingByPatchType[patchType].total++;
            if (isCorrect) rollingByPatchType[patchType].correct++;
            
            rollingByPatchType[patchType].generations.push(gen);
            const ptRate = (rollingByPatchType[patchType].correct / rollingByPatchType[patchType].total) * 100;
            rollingByPatchType[patchType].rates.push(ptRate);
        }
    });
    
    debug('[DEBUG] Rolling Correctness Rate Stats:');
    debug('  Final overall:', overallCorrect, '/', overallTotal, '=', (overallCorrect/overallTotal*100).toFixed(1) + '%');
    patchTypes.forEach(pt => {
        const data = rollingByPatchType[pt];
        if (data.total > 0) {
            debug(`  Final ${pt}:`, data.correct, '/', data.total, '=', (data.correct/data.total*100).toFixed(1) + '%');
        }
    });
    
    return { 
        generations, 
        overallRates, 
        ratesByPatchType: rollingByPatchType,
        selectedNode 
    };
}

export function computeImprovementRateStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const selectedNode = selectedNodeId ? data.find(d => d.id === selectedNodeId) : null;
    const nodeMap = new Map(data.map(d => [d.id, d]));
    
    // Sort programs by generation (and by timestamp if available for stability)
    const sortedData = [...data].sort((a, b) => {
        if (a.generation !== b.generation) {
            return a.generation - b.generation;
        }
        // Secondary sort by timestamp if available
        const timeA = a.metadata?.timestamp || 0;
        const timeB = b.metadata?.timestamp || 0;
        return timeA - timeB;
    });
    
    const patchTypes = ['diff', 'full', 'cross', 'init', 'fix'];
    
    // Calculate rolling improvement rates
    // Note: To match the bar plot, we count improvements where the result is CORRECT
    // and divide by total attempts (including retries)
    let overallImprovedCorrect = 0;
    let overallTotalAttempts = 0;
    const generations = [];
    const overallRates = [];
    
    // Track rolling rates by patch type
    const rollingByPatchType = {};
    patchTypes.forEach(pt => {
        rollingByPatchType[pt] = {
            improvedCorrect: 0,
            totalAttempts: 0,
            generations: [],
            rates: []
        };
    });
    
    sortedData.forEach((node, idx) => {
        // Skip nodes without a parent
        if (!node.parent_id) return;
        
        const parent = nodeMap.get(node.parent_id);
        if (!parent) return;
        
        // Skip if scores are null/undefined
        if (node.combined_score === null || node.combined_score === undefined ||
            parent.combined_score === null || parent.combined_score === undefined) {
            return;
        }
        
        const gen = node.generation;
        const patchType = node.metadata?.patch_type || 'unknown';
        const isCorrect = node.correct === true || node.correct === 'true' || node.correct === 1;
        const isImprovement = node.combined_score > parent.combined_score;
        
        // patch_attempt indicates which attempt succeeded (1-indexed)
        const patchAttempt = node.metadata?.patch_attempt || 1;
        
        // Only count as improvement if the program is correct AND improved over parent
        const isImprovedCorrect = isCorrect && isImprovement;
        
        // Update overall rolling rate
        overallTotalAttempts += patchAttempt;
        if (isImprovedCorrect) overallImprovedCorrect++;
        
        generations.push(gen);
        overallRates.push((overallImprovedCorrect / overallTotalAttempts) * 100);
        
        // Update patch type rolling rates
        if (patchTypes.includes(patchType)) {
            rollingByPatchType[patchType].totalAttempts += patchAttempt;
            if (isImprovedCorrect) rollingByPatchType[patchType].improvedCorrect++;
            
            rollingByPatchType[patchType].generations.push(gen);
            const ptRate = (rollingByPatchType[patchType].improvedCorrect / rollingByPatchType[patchType].totalAttempts) * 100;
            rollingByPatchType[patchType].rates.push(ptRate);
        }
    });
    
    debug('[DEBUG] Rolling Improvement Rate Stats (correct improvements / total attempts):');
    debug('  Final overall:', overallImprovedCorrect, '/', overallTotalAttempts, '=', (overallImprovedCorrect/overallTotalAttempts*100).toFixed(1) + '%');
    patchTypes.forEach(pt => {
        const data = rollingByPatchType[pt];
        if (data.totalAttempts > 0) {
            debug(`  Final ${pt}:`, data.improvedCorrect, '/', data.totalAttempts, '=', (data.improvedCorrect/data.totalAttempts*100).toFixed(1) + '%');
        }
    });
    
    return { 
        generations, 
        overallRates, 
        ratesByPatchType: rollingByPatchType,
        selectedNode 
    };
}

// Helper function to calculate linear regression
export function linearRegression(x, y) {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
}

export function computeCostStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const selectedNode = selectedNodeId ? data.find(d => d.id === selectedNodeId) : null;
    const costData = [];
    const modelSet = new Set();
    const patchTypeSet = new Set();
    const modelPatchAgg = new Map(); // key: `${model}||${patch}`
    const modelGenMap = new Map();   // model -> gen -> { total, count }
    const patchGenMap = new Map();   // patch -> gen -> { total, count }
    const modelPatchGenMap = new Map(); // model||patch -> gen -> { total, count }
    
    data.forEach(node => {
        const apiCost = node.metadata?.api_costs || 0;
        const embedCost = node.metadata?.embed_cost || 0;
        const noveltyCost = node.metadata?.novelty_cost || 0;
        const metaCost = node.metadata?.meta_cost || 0;
        const totalCost = apiCost + embedCost + noveltyCost + metaCost;
        const modelName = node.metadata?.model_name || 
                          node.metadata?.llm_result?.model || 
                          node.metadata?.model ||
                          node.model_name ||
                          node.model ||
                          'N/A';
        const patchType = node.metadata?.patch_type || 'N/A';
        
        if (totalCost > 0) {
            costData.push({
                id: node.id,
                generation: node.generation,
                apiCost,
                embedCost,
                noveltyCost,
                metaCost,
                totalCost,
                score: node.combined_score || 0,
                modelName,
                patchType
            });
            
            modelSet.add(modelName);
            patchTypeSet.add(patchType);
            
            // Aggregate by model/patch combo
            const key = `${modelName}||${patchType}`;
            if (!modelPatchAgg.has(key)) {
                modelPatchAgg.set(key, { total: 0, count: 0 });
            }
            const entry = modelPatchAgg.get(key);
            entry.total += totalCost;
            entry.count += 1;
            
            // Aggregate by model per generation
            if (!modelGenMap.has(modelName)) {
                modelGenMap.set(modelName, new Map());
            }
            if (!modelGenMap.get(modelName).has(node.generation)) {
                modelGenMap.get(modelName).set(node.generation, { total: 0, count: 0 });
            }
            const mg = modelGenMap.get(modelName).get(node.generation);
            mg.total += totalCost;
            mg.count += 1;
            
            // Aggregate by patch type per generation
            if (!patchGenMap.has(patchType)) {
                patchGenMap.set(patchType, new Map());
            }
            if (!patchGenMap.get(patchType).has(node.generation)) {
                patchGenMap.get(patchType).set(node.generation, { total: 0, count: 0 });
            }
            const pg = patchGenMap.get(patchType).get(node.generation);
            pg.total += totalCost;
            pg.count += 1;
            
            // Aggregate by model+patch per generation
            if (!modelPatchGenMap.has(key)) {
                modelPatchGenMap.set(key, new Map());
            }
            if (!modelPatchGenMap.get(key).has(node.generation)) {
                modelPatchGenMap.get(key).set(node.generation, { total: 0, count: 0 });
            }
            const mpg = modelPatchGenMap.get(key).get(node.generation);
            mpg.total += totalCost;
            mpg.count += 1;
        }
    });
    
    // Group by generation
    const genCosts = {};
    costData.forEach(d => {
        if (!genCosts[d.generation]) {
            genCosts[d.generation] = {
                apiCost: 0, embedCost: 0, noveltyCost: 0, metaCost: 0,
                totalCost: 0, maxScore: -Infinity, count: 0
            };
        }
        genCosts[d.generation].apiCost += d.apiCost;
        genCosts[d.generation].embedCost += d.embedCost;
        genCosts[d.generation].noveltyCost += d.noveltyCost;
        genCosts[d.generation].metaCost += d.metaCost;
        genCosts[d.generation].totalCost += d.totalCost;
        genCosts[d.generation].maxScore = Math.max(genCosts[d.generation].maxScore, d.score);
        genCosts[d.generation].count += 1;
    });
    
    const genCostStats = Object.keys(genCosts).sort((a, b) => +a - +b).map(gen => ({
        generation: +gen,
        ...genCosts[gen],
        avgCost: genCosts[gen].count > 0 ? genCosts[gen].totalCost / genCosts[gen].count : 0
    }));
    
    // Calculate cumulative costs
    let cumulative = 0;
    genCostStats.forEach(d => {
        cumulative += d.totalCost;
        d.cumulativeCost = cumulative;
    });
    
    // Build model vs patch type average cost matrix
    const models = Array.from(modelSet).sort();
    const patchTypes = Array.from(patchTypeSet).sort();
    
    const zValues = models.map(model => 
        patchTypes.map(patch => {
            const key = `${model}||${patch}`;
            const entry = modelPatchAgg.get(key);
            return entry && entry.count > 0 ? entry.total / entry.count : 0;
        })
    );
    
    const countValues = models.map(model => 
        patchTypes.map(patch => {
            const key = `${model}||${patch}`;
            const entry = modelPatchAgg.get(key);
            return entry ? entry.count : 0;
        })
    );
    
    const textValues = models.map(model => 
        patchTypes.map(patch => {
            const key = `${model}||${patch}`;
            const entry = modelPatchAgg.get(key);
            return entry && entry.count > 0 
                ? `${model} / ${patch}<br>Avg cost: $${(entry.total / entry.count).toFixed(4)}<br>n=${entry.count}`
                : `${model} / ${patch}<br>No data`;
        })
    );
    
    const generationAvgCosts = genCostStats.map(d => ({
        generation: d.generation,
        avgCost: d.avgCost
    }));
    
    // Overall running average across generations
    const generationOverallRunning = (() => {
        let cumTotal = 0;
        let cumCount = 0;
        const gens = [];
        const avg = [];
        genCostStats.forEach(d => {
            cumTotal += d.totalCost;
            cumCount += d.count;
            gens.push(d.generation);
            avg.push(cumCount > 0 ? cumTotal / cumCount : 0);
        });
        return { generations: gens, runningAvg: avg };
    })();
    
    // Running average by model across generations
    const generationModelRunning = Array.from(modelGenMap.entries()).map(([model, genMap]) => {
        const gens = Array.from(genMap.keys()).map(Number).sort((a, b) => a - b);
        let cumTotal = 0;
        let cumCount = 0;
        const avg = [];
        gens.forEach(g => {
            const stats = genMap.get(g);
            cumTotal += stats.total;
            cumCount += stats.count;
            avg.push(cumCount > 0 ? cumTotal / cumCount : 0);
        });
        return { key: model, generations: gens, runningAvg: avg };
    }).sort((a, b) => a.key.localeCompare(b.key));
    
    // Running average by patch type across generations
    const generationPatchRunning = Array.from(patchGenMap.entries()).map(([patch, genMap]) => {
        const gens = Array.from(genMap.keys()).map(Number).sort((a, b) => a - b);
        let cumTotal = 0;
        let cumCount = 0;
        const avg = [];
        gens.forEach(g => {
            const stats = genMap.get(g);
            cumTotal += stats.total;
            cumCount += stats.count;
            avg.push(cumCount > 0 ? cumTotal / cumCount : 0);
        });
        return { key: patch, generations: gens, runningAvg: avg };
    }).sort((a, b) => a.key.localeCompare(b.key));
    
    // Get all unique generations for alignment
    const allGenerations = genCostStats.map(d => d.generation);
    
    // Running average by model+patch combo across generations (aligned to all generations)
    const generationModelPatchRunning = Array.from(modelPatchGenMap.entries()).map(([comboKey, genMap]) => {
        let cumTotal = 0;
        let cumCount = 0;
        const avg = [];
        allGenerations.forEach(g => {
            const stats = genMap.get(g);
            if (stats) {
                cumTotal += stats.total;
                cumCount += stats.count;
            }
            // Use current running average (or null if no data yet)
            avg.push(cumCount > 0 ? cumTotal / cumCount : null);
        });
        return { key: comboKey, generations: allGenerations, runningAvg: avg };
    }).sort((a, b) => a.key.localeCompare(b.key));
    
    return { 
        costData, 
        genCostStats, 
        selectedNode,
        modelPatchStats: { models, patchTypes, zValues, textValues, countValues },
        generationAvgCosts,
        generationOverallRunning,
        generationModelRunning,
        generationPatchRunning,
        generationModelPatchRunning
    };
}

function computeSearchDynamicsStats(data, selectedNodeId) {
    if (!data || data.length === 0) return null;
    
    const selectedNode = selectedNodeId ? data.find(d => d.id === selectedNodeId) : null;
    const nodeMap = new Map(data.map(d => [d.id, d]));
    
    // Track cluster transitions
    const clusterTransitions = [];
    const uniqueClustersPerGen = {};
    const scoreVariancePerGen = {};
    
    data.forEach(node => {
        const gen = node.generation;
        const clusterId = node.embedding_cluster_id;
        
        if (clusterId !== null && clusterId !== undefined) {
            if (!uniqueClustersPerGen[gen]) {
                uniqueClustersPerGen[gen] = new Set();
            }
            uniqueClustersPerGen[gen].add(clusterId);
            
            if (node.parent_id) {
                const parent = nodeMap.get(node.parent_id);
                if (parent && parent.embedding_cluster_id !== null && 
                    parent.embedding_cluster_id !== clusterId) {
                    clusterTransitions.push({
                        generation: gen,
                        fromCluster: parent.embedding_cluster_id,
                        toCluster: clusterId
                    });
                }
            }
        }
        
        if (!scoreVariancePerGen[gen]) {
            scoreVariancePerGen[gen] = [];
        }
        if (node.combined_score !== null && node.combined_score !== undefined) {
            scoreVariancePerGen[gen].push(node.combined_score);
        }
    });
    
    const clusterStats = Object.keys(uniqueClustersPerGen).sort((a, b) => +a - +b).map(gen => ({
        generation: +gen,
        uniqueClusters: uniqueClustersPerGen[gen].size
    }));
    
    const varianceStats = Object.keys(scoreVariancePerGen).sort((a, b) => +a - +b).map(gen => {
        const scores = scoreVariancePerGen[gen];
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
        return {
            generation: +gen,
            variance: variance,
            stdDev: Math.sqrt(variance),
            scores: scores
        };
    });
    
    return { clusterTransitions, clusterStats, varianceStats, selectedNode };
}
