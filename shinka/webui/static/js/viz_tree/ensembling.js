// Ensembling tab: model posteriors.

export function createModelPosteriorsVisualization(data) {
    console.log("[DEBUG] ==> createModelPosteriorsVisualization called with data length:", data ? data.length : 'null');
    
    // Check if the model posteriors tab is visible
    const modelPosteriorsView = document.getElementById('model-posteriors-view');
    console.log("[DEBUG] Model posteriors view element:", modelPosteriorsView);
    console.log("[DEBUG] Model posteriors view active:", modelPosteriorsView ? modelPosteriorsView.classList.contains('active') : 'element not found');
    
    if (!modelPosteriorsView || !modelPosteriorsView.classList.contains('active')) {
        console.log("[DEBUG] Model posteriors view not active, skipping visualization creation");
        return;
    }
    
    console.log("[DEBUG] Model posteriors view is active, proceeding with visualization");

    const container = d3.select("#model-posteriors-container");
    
    // Show a loading message immediately
    console.log("[DEBUG] Container found:", container.node());
    
    // Ensure the HTML structure exists - FORCE RECREATION
    console.log("[DEBUG] FORCING HTML structure recreation");
    container.html(`
        <h4 style="margin: 0 0 20px 0; text-align: center;">Number of Programs Proposed by Each Model</h4>
        <div id="model-program-counts-chart" style="width: 100%; height: 340px; margin-bottom: 30px;"></div>
        <h4 style="margin: 0 0 20px 0; text-align: center;">Model Posterior Probabilities Over Generations</h4>
        <div id="model-posteriors-chart" style="width: 100%; height: 340px;"></div>
        <div id="model-posteriors-summary" style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
            <h5 style="margin: 0 0 10px 0;">Summary Statistics</h5>
            <div id="model-posteriors-stats"></div>
        </div>
    `);
    console.log("[DEBUG] HTML structure FORCED. Checking if program counts chart exists now:", !container.select("#model-program-counts-chart").empty());
    console.log("[DEBUG] Program counts container after forced creation:", container.select("#model-program-counts-chart").node());
    
    container.select("#model-posteriors-chart").html("<p style='text-align: center; margin-top: 50px; color: blue;'>Loading model posteriors visualization...</p>");
    container.select("#model-program-counts-chart").html("<p style='text-align: center; margin-top: 50px; color: blue;'>Loading program counts visualization...</p>");
    
    // Debug: Check if the second chart container exists
    console.log("[DEBUG] Program counts chart container found:", !container.select("#model-program-counts-chart").empty());
    console.log("[DEBUG] Program counts chart container node:", container.select("#model-program-counts-chart").node());
    console.log("[DEBUG] Main container HTML:", container.node().innerHTML.substring(0, 500) + "...");
    console.log("[DEBUG] Looking for #model-program-counts-chart in document:", document.getElementById("model-program-counts-chart"));
    console.log("[DEBUG] All elements with id containing 'program':", document.querySelectorAll('[id*="program"]'));
    
    if (!data || data.length === 0) {
        container.select("#model-posteriors-chart").html("<p style='text-align: center; margin-top: 50px;'>No data to visualize.</p>");
        container.select("#model-program-counts-chart").html("<p style='text-align: center; margin-top: 50px;'>No data to visualize.</p>");
        container.select("#model-posteriors-stats").html("No data available.");
        return;
    }

    // Extract model_posteriors data from metadata - try multiple possible locations
    let programsWithPosteriors = data.filter(d => 
        d.metadata && d.metadata.llm_result && d.metadata.llm_result.model_posteriors && 
        typeof d.metadata.llm_result.model_posteriors === 'object' &&
        Object.keys(d.metadata.llm_result.model_posteriors).length > 0
    );
    
    // If no programs found with llm_result structure, try direct metadata structure
    if (programsWithPosteriors.length === 0) {
        programsWithPosteriors = data.filter(d => 
            d.metadata && d.metadata.model_posteriors && 
            typeof d.metadata.model_posteriors === 'object' &&
            Object.keys(d.metadata.model_posteriors).length > 0
        );
        console.log("[DEBUG] Using direct metadata.model_posteriors structure");
    } else {
        console.log("[DEBUG] Using metadata.llm_result.model_posteriors structure");
    }

    if (programsWithPosteriors.length === 0) {
        const programsWithLlmResult = data.filter(d => d.metadata && d.metadata.llm_result);
        const debugInfo = `
            <p style='text-align: center; margin-top: 20px;'>No model posteriors data found in metadata.</p>
            <div style='background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 20px;'>
                <h5>Debug Information:</h5>
                <ul style='text-align: left;'>
                    <li>Total programs: ${data.length}</li>
                    <li>Programs with llm_result: ${programsWithLlmResult.length}</li>
                    <li>Programs with direct model_posteriors: ${data.filter(d => d.metadata && d.metadata.model_posteriors).length}</li>
                </ul>
                <p><small>Check the browser console for more detailed debugging information.</small></p>
            </div>
        `;
        container.select("#model-posteriors-chart").html(debugInfo);
        container.select("#model-program-counts-chart").html("<p style='text-align: center; margin-top: 50px;'>No model posteriors data available for program counts chart.</p>");
        container.select("#model-posteriors-stats").html("No model posteriors data available.");
        console.log("[DEBUG] *** EARLY RETURN - NO POSTERIORS DATA ***");
        return;
    }

    console.log(`[DEBUG] Found ${programsWithPosteriors.length} programs with model posteriors data`);
    
    // Debug: Log first few programs to understand data structure
    if (data.length > 0) {
        console.log("[DEBUG] Total programs:", data.length);
        console.log("[DEBUG] Sample program metadata structure:", data[0].metadata);
        
        const programsWithLlmResult = data.filter(d => d.metadata && d.metadata.llm_result);
        console.log(`[DEBUG] Programs with llm_result: ${programsWithLlmResult.length}`);
        
        if (programsWithLlmResult.length > 0) {
            console.log("[DEBUG] Sample llm_result:", programsWithLlmResult[0].metadata.llm_result);
            console.log("[DEBUG] Sample llm_result keys:", Object.keys(programsWithLlmResult[0].metadata.llm_result));
            
            if (programsWithLlmResult[0].metadata.llm_result.model_posteriors) {
                console.log("[DEBUG] Sample model_posteriors:", programsWithLlmResult[0].metadata.llm_result.model_posteriors);
                console.log("[DEBUG] Model_posteriors type:", typeof programsWithLlmResult[0].metadata.llm_result.model_posteriors);
                console.log("[DEBUG] Model_posteriors keys:", Object.keys(programsWithLlmResult[0].metadata.llm_result.model_posteriors));
            } else {
                console.log("[DEBUG] No model_posteriors in llm_result");
            }
        }
        
        // Check if any programs have the exact structure we're looking for
        const exactMatch = data.filter(d => 
            d.metadata && 
            d.metadata.llm_result && 
            d.metadata.llm_result.model_posteriors && 
            typeof d.metadata.llm_result.model_posteriors === 'object'
        );
        console.log(`[DEBUG] Programs with exact model_posteriors structure: ${exactMatch.length}`);
        
        // Also check for alternative structures
        const altStructure1 = data.filter(d => d.metadata && d.metadata.model_posteriors);
        console.log(`[DEBUG] Programs with direct metadata.model_posteriors: ${altStructure1.length}`);
    }

    // Helper function to get model_posteriors from program data
    const getModelPosteriors = (program) => {
        if (program.metadata.llm_result && program.metadata.llm_result.model_posteriors) {
            return program.metadata.llm_result.model_posteriors;
        } else if (program.metadata.model_posteriors) {
            return program.metadata.model_posteriors;
        }
        return {};
    };

    // Get all unique models across all programs
    const allModels = new Set();
    programsWithPosteriors.forEach(d => {
        Object.keys(getModelPosteriors(d)).forEach(model => {
            allModels.add(model);
        });
    });
    const models = Array.from(allModels).sort();
    
    console.log("[DEBUG] Found models:", models);
    console.log("[DEBUG] Sample model posteriors from first program:", getModelPosteriors(programsWithPosteriors[0]));

    // Group data by generation
    const generationData = {};
    programsWithPosteriors.forEach(d => {
        const gen = d.generation;
        if (!generationData[gen]) {
            generationData[gen] = [];
        }
        generationData[gen].push(d);
    });

    const generations = Object.keys(generationData).map(Number).sort((a, b) => a - b);

    // Calculate average posteriors per generation per model
    const chartData = [];
    generations.forEach(gen => {
        const genPrograms = generationData[gen];
        
        models.forEach(model => {
            const programsWithThisModel = genPrograms.filter(p => {
                const posteriors = getModelPosteriors(p);
                return posteriors[model] !== undefined && posteriors[model] !== null;
            });
            const modelPosteriors = programsWithThisModel.map(p => getModelPosteriors(p)[model]);
            
            if (modelPosteriors.length > 0) {
                const avgPosterior = modelPosteriors.reduce((sum, val) => sum + val, 0) / modelPosteriors.length;
                
                // Count programs that were actually generated by this model
                const programsGeneratedByModel = genPrograms.filter(p => {
                    // Try multiple possible locations for model name
                    const modelName = p.metadata?.model_name || 
                                    p.metadata?.llm_result?.model || 
                                    p.metadata?.model ||
                                    p.model_name ||
                                    p.model;
                    return modelName === model;
                });
                
                // Debug logging for first generation
                if (gen === generations[0] && model === models[0]) {
                    console.log("[DEBUG] Sample program metadata for count calculation:", genPrograms[0]?.metadata);
                    console.log("[DEBUG] Looking for model:", model);
                    console.log("[DEBUG] Found programs for", model, ":", programsGeneratedByModel.length);
                    console.log("[DEBUG] Sample model names found:", genPrograms.slice(0, 3).map(p => ({
                        model_name: p.metadata?.model_name,
                        llm_model: p.metadata?.llm_result?.model,
                        metadata_model: p.metadata?.model,
                        direct_model: p.model
                    })));
                }
                
                // Fallback: if no programs found by model_name, use programs with posteriors for this model
                const finalCount = programsGeneratedByModel.length > 0 ? 
                                 programsGeneratedByModel.length : 
                                 programsWithThisModel.length;
                
                chartData.push({
                    generation: gen,
                    model: model,
                    posterior: avgPosterior,
                    count: finalCount,
                    actualCount: programsGeneratedByModel.length,
                    posteriorCount: programsWithThisModel.length
                });
            }
        });
    });

    console.log("[DEBUG] Total chart data points:", chartData.length);
    console.log("[DEBUG] Chart data sample:", chartData.slice(0, 5));
    console.log("[DEBUG] Chart data count analysis:");
    
    // Helper function to reduce number of ticks to prevent overlap when there are many generations
    const getReducedTicks = (generations, maxTicks = 10) => {
        if (generations.length <= maxTicks) return generations;
        const step = Math.ceil(generations.length / maxTicks);
        return generations.filter((_, i) => i % step === 0 || i === generations.length - 1);
    };
    models.forEach(model => {
        const modelData = chartData.filter(d => d.model === model);
        console.log(`[DEBUG] Model ${model}: ${modelData.length} generations, counts: ${modelData.map(d => d.count).join(', ')}`);
        console.log(`[DEBUG] Model ${model}: total programs generated = ${modelData.reduce((sum, d) => sum + d.count, 0)}`);
    });
    
    // Also debug the model_name distribution in the first generation
    if (generations.length > 0) {
        const firstGen = generationData[generations[0]];
        console.log(`[DEBUG] First generation (${generations[0]}) model distribution:`);
        const modelCounts = {};
        firstGen.forEach(p => {
            const modelName = p.metadata && p.metadata.model_name;
            if (modelName) {
                modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;
            } else {
                modelCounts['NO_MODEL_NAME'] = (modelCounts['NO_MODEL_NAME'] || 0) + 1;
            }
        });
        Object.entries(modelCounts).forEach(([model, count]) => {
            console.log(`[DEBUG] ${model}: ${count} programs`);
        });
    }

    // Clear previous chart
    container.select("#model-posteriors-chart").html("");

    // Set up dimensions with more horizontal space (reduced top margin since legend moved to counts chart)
    const margin = {top: 20, right: 20, bottom: 40, left: 60};
    const chartHeight = 340;
    const width = 800 - margin.left - margin.right;
    const height = chartHeight - margin.top - margin.bottom;

    // Create SVG
    const svg = container.select("#model-posteriors-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", chartHeight);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Set up scales
    const xScale = d3.scaleLinear()
        .domain(d3.extent(generations))
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([0, 1])
        .range([height, 0]);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10)
        .domain(models);

    // Add axes with custom tick values for generations
    const uniqueGenerations = [...new Set(generations)].sort((a, b) => a - b);
    const reducedGenerations = getReducedTicks(uniqueGenerations);
    
    g.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale)
            .tickValues(reducedGenerations)
            .tickFormat(d3.format("d")));

    g.append("g")
        .call(d3.axisLeft(yScale));

    // Add axis labels
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - (height / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .text("Average Model Posterior");

    g.append("text")
        .attr("transform", `translate(${width / 2}, ${height + margin.bottom})`)
        .style("text-anchor", "middle")
        .text("Generation");

    // Create line generator
    const line = d3.line()
        .x(d => xScale(d.generation))
        .y(d => yScale(d.posterior))
        .curve(d3.curveMonotoneX);

    // Group data by model
    const modelData = {};
    chartData.forEach(d => {
        if (!modelData[d.model]) {
            modelData[d.model] = [];
        }
        modelData[d.model].push(d);
    });

    // Draw lines for each model
    models.forEach(model => {
        const data = modelData[model] || [];
        if (data.length > 0) {
            data.sort((a, b) => a.generation - b.generation);
            
            g.append("path")
                .datum(data)
                .attr("fill", "none")
                .attr("stroke", colorScale(model))
                .attr("stroke-width", 2)
                .attr("d", line);

            g.append("g")
                .selectAll(".posterior-point")
                .data(data)
                .enter()
                .append("circle")
                .attr("class", "posterior-point")
                .attr("cx", d => xScale(d.generation))
                .attr("cy", d => yScale(d.posterior))
                .attr("r", 4)
                .attr("fill", colorScale(model));
        }
    });

    // Legend will be added to the counts chart instead (which appears first now)

    console.log("[DEBUG] *** REACHED END OF FIRST CHART CREATION ***");

    // Create second chart: Program counts by model
    console.log("[DEBUG] *** STARTING PROGRAM COUNTS CHART CREATION ***");
    console.log("[DEBUG] Creating program counts chart");
    console.log("[DEBUG] Chart data for counts:", chartData);
    console.log("[DEBUG] Models for counts:", models);
    
    // Test: Add a simple test message to the container
    console.log("[DEBUG] Setting test message in program counts chart");
    const testResult = container.select("#model-program-counts-chart").html("<p style='color: red; font-size: 20px; text-align: center; margin-top: 50px;'>PROGRAM COUNTS CHART SECTION - DEBUGGING</p>");
    console.log("[DEBUG] Test message set result:", testResult);
    console.log("[DEBUG] Program counts container after test:", container.select("#model-program-counts-chart").node());
    
    // Check if we have any count data
    const totalCounts = chartData.reduce((sum, d) => sum + d.count, 0);
    console.log("[DEBUG] Total program counts across all data:", totalCounts);
    
    // Clear previous chart and create cumulative program counts plot
    console.log("[DEBUG] Creating cumulative program counts chart");
    container.select("#model-program-counts-chart").html("");
    
    // DEBUG: Let's look at the actual program data instead of chartData
    console.log("[DEBUG] Sample programs from original data:", programsWithPosteriors.slice(0, 3).map(p => ({
        generation: p.generation,
        model_name: p.metadata?.model_name,
        llm_model: p.metadata?.llm_result?.model,
        metadata_model: p.metadata?.model,
        id: p.id
    })));
    
    // Calculate ACTUAL program counts by generation and model from raw data
    const actualGenerationCounts = {};
    programsWithPosteriors.forEach(program => {
        const gen = program.generation;
        if (!actualGenerationCounts[gen]) actualGenerationCounts[gen] = {};
        
        // Try to find the actual model that generated this program
        const actualModel = program.metadata?.model_name || 
                          program.metadata?.llm_result?.model || 
                          program.metadata?.model ||
                          program.model_name ||
                          program.model;
        
        if (actualModel) {
            if (!actualGenerationCounts[gen][actualModel]) actualGenerationCounts[gen][actualModel] = 0;
            actualGenerationCounts[gen][actualModel]++;
        } else {
            console.log("[DEBUG] No model found for program:", program.id);
        }
    });
    
    console.log("[DEBUG] Actual generation counts:", actualGenerationCounts);
    
    // Get all generations that have actual program data
    const actualSortedGens = Object.keys(actualGenerationCounts).map(Number).sort((a, b) => a - b);
    console.log("[DEBUG] Actual sorted generations:", actualSortedGens);
    
    // Get all models that actually generated programs
    const actualModels = new Set();
    Object.values(actualGenerationCounts).forEach(genData => {
        Object.keys(genData).forEach(model => actualModels.add(model));
    });
    const actualModelsArray = Array.from(actualModels).sort();
    console.log("[DEBUG] Models that actually generated programs:", actualModelsArray);
    
    // Calculate cumulative counts for each ACTUAL model
    const cumulativeData = {};
    actualModelsArray.forEach(model => {
        cumulativeData[model] = [];
        let cumulativeCount = 0;
        
        actualSortedGens.forEach(gen => {
            const genCount = actualGenerationCounts[gen][model] || 0;
            cumulativeCount += genCount;
            cumulativeData[model].push({
                generation: gen,
                cumulativeCount: cumulativeCount,
                genCount: genCount
            });
        });
        
        console.log(`[DEBUG] Model ${model.split('/').pop()}: ${cumulativeData[model].length} data points, final cumulative: ${cumulativeCount}`);
    });
    
    console.log("[DEBUG] Cumulative data summary:", Object.keys(cumulativeData).map(model => ({
        model: model.split('/').pop(), // Short name
        points: cumulativeData[model].length,
        finalCount: cumulativeData[model][cumulativeData[model].length - 1]?.cumulativeCount || 0
    })));
    
    // Create SVG for cumulative counts chart (same width as posteriors chart for alignment)
    const countsSvg = container.select("#model-program-counts-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", chartHeight);

    // Use smaller top margin for counts chart to reduce space between title and plot
    const countsTopMargin = 40;
    const countsG = countsSvg.append("g")
        .attr("transform", `translate(${margin.left},${countsTopMargin})`);

    // Set up scales for cumulative counts chart using actual data
    const countsXScale = d3.scaleLinear()
        .domain(d3.extent(actualSortedGens))
        .range([0, width]);

    // Find maximum cumulative count across all models
    const maxCumulativeCount = d3.max(Object.values(cumulativeData), modelData => 
        d3.max(modelData, d => d.cumulativeCount)
    );
    
    const countsHeight = chartHeight - countsTopMargin - margin.bottom;
    const countsYScale = d3.scaleLinear()
        .domain([0, maxCumulativeCount])
        .range([countsHeight, 0]);
        
    console.log("[DEBUG] Cumulative chart scales - X domain:", d3.extent(actualSortedGens), "Y domain:", [0, maxCumulativeCount]);

    // Add axes for cumulative counts chart (styled like posteriors chart)
    // Use the same tick reduction logic for consistency
    const reducedCountsGenerations = getReducedTicks(actualSortedGens);
    
    countsG.append("g")
        .attr("transform", `translate(0,${countsHeight})`)
        .call(d3.axisBottom(countsXScale)
            .tickValues(reducedCountsGenerations)
            .tickFormat(d3.format("d")))
        .selectAll("line")
        .style("stroke", "#ddd");

    countsG.append("g")
        .call(d3.axisLeft(countsYScale))
        .selectAll("line")
        .style("stroke", "#ddd");

    // Add axis labels for cumulative counts chart (matching posteriors plot style)
    countsG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", 0 - margin.left)
        .attr("x", 0 - (countsHeight / 2))
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .text("Cumulative Number of Programs");

    countsG.append("text")
        .attr("transform", `translate(${width / 2}, ${countsHeight + margin.bottom})`)
        .style("text-anchor", "middle")
        .text("Generation");

    // Add legend at the top with automatic layout (moved from posterior chart)
    const legend = countsSvg.append("g")
        .attr("transform", `translate(0, 0)`);

    // First, create temporary text elements to measure widths
    const tempTexts = actualModelsArray.map(model => {
        const tempText = legend.append("text")
            .style("font-size", "12px")
            .style("font-family", "monospace")
            .style("opacity", 0)
            .text(model);
        const width = tempText.node().getBBox().width;
        tempText.remove();
        return { model, textWidth: width };
    });

    // Calculate layout parameters
    const iconWidth = 15;
    const iconTextGap = 8;
    const itemSpacing = 30;
    const totalSvgWidth = width + margin.left + margin.right;
    
    // Calculate item widths (icon + gap + text + spacing)
    const itemWidths = tempTexts.map(d => iconWidth + iconTextGap + d.textWidth + itemSpacing);
    
    // Arrange items in rows to fit within the available width
    const rows = [];
    let currentRow = [];
    let currentRowWidth = 0;
    
    itemWidths.forEach((itemWidth, i) => {
        if (currentRowWidth + itemWidth > totalSvgWidth - 20 && currentRow.length > 0) {
            // Start new row
            rows.push([...currentRow]);
            currentRow = [i];
            currentRowWidth = itemWidth;
        } else {
            currentRow.push(i);
            currentRowWidth += itemWidth;
        }
    });
    if (currentRow.length > 0) {
        rows.push(currentRow);
    }

    // Draw the legend items
    rows.forEach((rowItems, rowIndex) => {
        const rowWidth = rowItems.reduce((sum, i) => sum + itemWidths[i], 0) - itemSpacing;
        const startX = (totalSvgWidth - rowWidth) / 2; // Center each row
        
        let currentX = startX;
        rowItems.forEach(modelIndex => {
            const model = actualModelsArray[modelIndex];
            const legendItem = legend.append("g")
                .attr("transform", `translate(${currentX}, ${rowIndex * 22})`);

            legendItem.append("rect")
                .attr("width", iconWidth)
                .attr("height", iconWidth)
                .attr("fill", colorScale(model));

            legendItem.append("text")
                .attr("x", iconWidth + iconTextGap)
                .attr("y", 12)
                .style("font-size", "12px")
                .style("font-family", "monospace")
                .text(model);

            currentX += itemWidths[modelIndex];
        });
    });

    // Create line generator for cumulative counts
    const cumulativeLine = d3.line()
        .x(d => countsXScale(d.generation))
        .y(d => countsYScale(d.cumulativeCount))
        .curve(d3.curveMonotoneX);

    // Draw cumulative lines for each ACTUAL model
    actualModelsArray.forEach((model, modelIndex) => {
        const modelData = cumulativeData[model];
        if (!modelData || modelData.length === 0) {
            console.log(`[DEBUG] Skipping ${model}: no data`);
            return;
        }

        console.log(`[DEBUG] Drawing line ${modelIndex + 1}/${models.length} for ${model.split('/').pop()}, data points:`, modelData.length, "color:", colorScale(model));

        // Filter out any invalid data points
        const validData = modelData.filter(d => 
            d.generation != null && d.cumulativeCount != null && 
            !isNaN(d.generation) && !isNaN(d.cumulativeCount)
        );
        
        console.log(`[DEBUG] Valid data points for ${model.split('/').pop()}:`, validData.length);
        
        if (validData.length === 0) return;

        // Add cumulative line (styled like posteriors chart)
        const path = countsG.append("path")
            .datum(validData)
            .attr("fill", "none")
            .attr("stroke", colorScale(model))
            .attr("stroke-width", 2)
            .attr("d", cumulativeLine);

        countsG.append("g")
            .selectAll(".cumulative-count-point")
            .data(validData)
            .enter()
            .append("circle")
            .attr("class", "cumulative-count-point")
            .attr("cx", d => countsXScale(d.generation))
            .attr("cy", d => countsYScale(d.cumulativeCount))
            .attr("r", 4)
            .attr("fill", colorScale(model));
        
        console.log(`[DEBUG] Path created for ${model.split('/').pop()}, path element:`, path.node());
    });
    // No legend for the program counts chart (legend only on posteriors chart)
    console.log("[DEBUG] *** CUMULATIVE PROGRAM COUNTS CHART COMPLETED ***");
    // Update summary statistics
    const statsContainer = container.select("#model-posteriors-stats");
    statsContainer.html("");
    
    // Calculate cost statistics per model from original data
    const modelCostStats = {};
    data.forEach(program => {
        const modelName = program.metadata?.model_name || 
                         program.metadata?.llm_result?.model || 
                         program.metadata?.model ||
                         program.model_name ||
                         program.model;
        if (modelName && models.includes(modelName)) {
            const apiCost = program.metadata?.api_costs ? parseFloat(program.metadata.api_costs) : 0;
            const embedCost = program.metadata?.embed_cost ? parseFloat(program.metadata.embed_cost) : 0;
            const noveltyCost = program.metadata?.novelty_cost ? parseFloat(program.metadata.novelty_cost) : 0;
            const metaCost = program.metadata?.meta_cost ? parseFloat(program.metadata.meta_cost) : 0;
            const totalCost = (isNaN(apiCost) ? 0 : apiCost) + 
                             (isNaN(embedCost) ? 0 : embedCost) + 
                             (isNaN(noveltyCost) ? 0 : noveltyCost) + 
                             (isNaN(metaCost) ? 0 : metaCost);
            
            if (!modelCostStats[modelName]) {
                modelCostStats[modelName] = { costs: [], totalCost: 0 };
            }
            modelCostStats[modelName].costs.push(totalCost);
            modelCostStats[modelName].totalCost += totalCost;
        }
    });
    
    // Collect all model statistics into an array for sorting
    const modelStats = [];
    models.forEach(model => {
        const modelPosteriors = chartData
            .filter(d => d.model === model)
            .map(d => d.posterior);
        
        if (modelPosteriors.length > 0) {
            let actualTotalPrograms = 0;
            if (cumulativeData && cumulativeData[model]) {
                const finalData = cumulativeData[model][cumulativeData[model].length - 1];
                actualTotalPrograms = finalData ? finalData.cumulativeCount : 0;
            }
            
            const avgPosterior = modelPosteriors.reduce((sum, val) => sum + val, 0) / modelPosteriors.length;
            const minPosterior = Math.min(...modelPosteriors);
            const maxPosterior = Math.max(...modelPosteriors);
            
            const costStats = modelCostStats[model];
            let totalCost = 0, avgCost = 0, minCost = 0, maxCost = 0;
            if (costStats && costStats.costs.length > 0) {
                totalCost = costStats.totalCost;
                avgCost = totalCost / costStats.costs.length;
                minCost = Math.min(...costStats.costs);
                maxCost = Math.max(...costStats.costs);
            }
            
            modelStats.push({
                model, actualTotalPrograms, avgPosterior, minPosterior, maxPosterior,
                totalCost, avgCost, minCost, maxCost
            });
        }
    });
    
    const statsTable = statsContainer.append("table")
        .style("width", "100%")
        .style("border-collapse", "collapse");

    // Define columns with sortability
    const columns = [
        { key: 'model', label: 'Model', sortable: false },
        { key: 'actualTotalPrograms', label: '# P', sortable: true },
        { key: 'avgPosterior', label: 'Avg Post.', sortable: false },
        { key: 'minPosterior', label: 'Min Post.', sortable: false },
        { key: 'maxPosterior', label: 'Max Post.', sortable: false },
        { key: 'totalCost', label: 'Total Cost', sortable: true },
        { key: 'avgCost', label: 'Avg Cost', sortable: true },
        { key: 'minCost', label: 'Min Cost', sortable: true },
        { key: 'maxCost', label: 'Max Cost', sortable: true }
    ];
    
    let currentSort = { key: null, ascending: true };
    
    const headerRow = statsTable.append("tr");
    columns.forEach(col => {
        const th = headerRow.append("th")
            .style("border", "1px solid #ddd")
            .style("padding", "8px")
            .style("cursor", col.sortable ? "pointer" : "default")
            .style("user-select", "none")
            .text(col.label);
        
        if (col.sortable) {
            th.style("background-color", "#f0f0f0")
              .on("mouseover", function() { d3.select(this).style("background-color", "#e0e0e0"); })
              .on("mouseout", function() { 
                  d3.select(this).style("background-color", currentSort.key === col.key ? "#d8d8d8" : "#f0f0f0"); 
              })
              .on("click", function() {
                  if (currentSort.key === col.key) {
                      currentSort.ascending = !currentSort.ascending;
                  } else {
                      currentSort.key = col.key;
                      currentSort.ascending = false; // Default to descending for numeric
                  }
                  // Update header styling
                  headerRow.selectAll("th").style("background-color", function(d, i) {
                      return columns[i].sortable ? (columns[i].key === currentSort.key ? "#d8d8d8" : "#f0f0f0") : null;
                  });
                  // Update sort indicators
                  headerRow.selectAll("th").each(function(d, i) {
                      const colDef = columns[i];
                      let text = colDef.label;
                      if (colDef.key === currentSort.key) {
                          text += currentSort.ascending ? " ▲" : " ▼";
                      }
                      d3.select(this).text(text);
                  });
                  renderRows();
              });
        }
    });
    
    const renderRows = () => {
        statsTable.selectAll("tr.data-row").remove();
        
        let sortedStats = [...modelStats];
        if (currentSort.key) {
            sortedStats.sort((a, b) => {
                const valA = a[currentSort.key];
                const valB = b[currentSort.key];
                return currentSort.ascending ? valA - valB : valB - valA;
            });
        }
        
        sortedStats.forEach(stat => {
            const row = statsTable.append("tr").attr("class", "data-row");
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text(stat.model);
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text(stat.actualTotalPrograms);
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text(stat.avgPosterior.toFixed(4));
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text(stat.minPosterior.toFixed(4));
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text(stat.maxPosterior.toFixed(4));
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text('$' + stat.totalCost.toFixed(4));
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text('$' + stat.avgCost.toFixed(4));
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text('$' + stat.minCost.toFixed(4));
            row.append("td").style("border", "1px solid #ddd").style("padding", "8px").text('$' + stat.maxCost.toFixed(4));
        });
    };
    
    renderRows();

    console.log("[DEBUG] Model posteriors visualization created successfully");
}
