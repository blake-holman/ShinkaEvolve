// Path tab: lineage of the best program.
import { formatScore } from './format.js';
import { selectNodeById } from './selection.js';

export function createBestPathVisualization(data) {
    console.log("[DEBUG] Creating best path visualization");
    
    // Check if the best path tab is visible
    const bestPathView = document.getElementById('best-path-view');
    if (!bestPathView || !bestPathView.classList.contains('active')) {
        console.log("[DEBUG] Best path view not active, skipping visualization creation");
        return;
    }

    const container = d3.select("#best-path-container");
    container.html(""); // Clear previous content

    if (!data || data.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("No data to visualize.");
        return;
    }

    const correctNodes = data.filter(d => d.correct && d.combined_score !== null);
    let bestNode;
    if (correctNodes.length > 0) {
        bestNode = correctNodes.reduce((best, current) => (current.combined_score > best.combined_score) ? current : best);
    } else {
        bestNode = data.reduce((best, current) => {
            const currentScore = current.combined_score ? current.combined_score : -Infinity;
            const bestScore = best.combined_score ? best.combined_score : -Infinity;
            return (currentScore > bestScore) ? current : best;
        }, { combined_score: -Infinity });
    }
    
    if (!bestNode || !bestNode.id) {
         container.append("p").style('text-align', 'center').style('margin-top', '50px').text("Could not determine the best node.");
        return;
    }

    const nodeMap = new Map(data.map(node => [node.id, node]));
    const path = [];
    let currentNode = bestNode;

    while (currentNode) {
        path.unshift(currentNode);
        currentNode = nodeMap.get(currentNode.parent_id);
    }

    if (path.length === 0) {
        container.append("p").style('text-align', 'center').style('margin-top', '50px').text("Best path is empty or could not be constructed.");
        return;
    }

    const timeline = container.append("div").attr("class", "best-path-timeline");

    const items = timeline.selectAll(".timeline-item")
        .data(path, d => d.id)
        .enter()
        .append("div")
        .attr("class", "timeline-item")
        .attr("data-node-id", d => d.id)
        .style("cursor", "pointer")
        .on('click', (event, d) => {
            selectNodeById(d.id, false, false);
        });
    
    items.append("div")
        .attr("class", "timeline-content")
        .html(d => {
                const description = d.metadata.patch_description ? `<p><strong>Description:</strong> ${d.metadata.patch_description}</p>` : '';
                return `
                <h4>Gen ${d.generation}: <span style="font-weight: normal;">${d.metadata.patch_name || 'unnamed'}</span></h4>
                <p><strong>ID:</strong> <a href="#" onclick="event.preventDefault(); event.stopPropagation(); selectNodeById('${d.id}', false, false);">${d.id}</a></p>
                <p><strong>Type:</strong> ${d.metadata.patch_type || 'N/A'}</p>
                <p><strong>Score:</strong> ${formatScore(d.combined_score)}</p>
                ${description}
                `;
        });
        

}
