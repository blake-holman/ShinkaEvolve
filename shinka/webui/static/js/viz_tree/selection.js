// Node selection shared by the tree and tables.
import { debug } from '../log.js';
import { renderGraph } from './tree.js';
import { displayNodeDetails } from './nodeDetails.js';

export function selectNodeById(nodeId, switchToTreeView = true, forceRightTabSwitch = true) {
    debug(`[DEBUG] Selecting node ID: ${nodeId}, switch to tree: ${switchToTreeView}`);
    window.pendingNodeSelectionId = nodeId;

    if (switchToTreeView) {
        const treeTab = document.querySelector('.left-tab[data-tab="tree-view"]');
        if (treeTab && !treeTab.classList.contains('active')) {
            treeTab.click();
        } else if (window.treeData) {
            renderGraph(window.treeData);
        }
    } else {
        // Don't switch tab, just show details
        const nodeData = window.treeData.find(d => d.id === nodeId);
        if (!nodeData) {
            console.warn("[DEBUG] Could not find node data for ID:", nodeId);
            return;
        };

        displayNodeDetails(nodeData);
        if (forceRightTabSwitch) {
            document.querySelector('.tab[data-tab="agent-code"]').click();
        }
    }
}
export function updateDetailsForNode(nodeId) {
    if (!window.treeData) return;
    const nodeData = window.treeData.find(d => d.id === nodeId);
    if (!nodeData) return;

    // Silently update selection in the main tree view for state persistence
    d3.selectAll('.node.selected').classed('selected', false);
    d3.selectAll('.node').filter(d => d.data.id === nodeId).classed('selected', true);

    // Update details panel on the right
    displayNodeDetails(nodeData);
}

export function getSelectedNodeId() {
    try {
        const selectedNodeElement = d3.select('.node.selected');
        if (selectedNodeElement.empty()) {
            return null;
        }
        
        const selectedNode = selectedNodeElement.datum();
        return selectedNode ? selectedNode.id : null;
    } catch (error) {
        console.warn("[DEBUG] Error getting selected node ID:", error);
        return null;
    }
}
