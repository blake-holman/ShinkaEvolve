// Resizable panel dividers.
import { renderGraph } from './tree.js';
import { savePreferences } from './state.js';

// Function to initialize the panel resizer
export function initializeResizer() {
    const divider = document.getElementById('divider');
    const treePanel = document.getElementById('tree-panel');
    const container = document.getElementById('container');
    let isDragging = false;
    
    // Store original width percentages
    let initialTreePanelWidth;
    let initialClientX;
    
    // Flag to prevent other updates during resize
    window.isResizing = false;
    
    // Mouse down event on the divider
    divider.addEventListener('mousedown', function(e) {
        // Prevent default selection behavior
        e.preventDefault();
        
        // Set dragging flag
        isDragging = true;
        window.isResizing = true;
        divider.classList.add('dragging');
        
        // Store initial positions
        initialTreePanelWidth = treePanel.offsetWidth;
        initialClientX = e.clientX;
    });
    
    // Mouse move event (only active when dragging)
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        
        // Calculate the new width
        const containerWidth = container.offsetWidth;
        const delta = e.clientX - initialClientX;
        let newWidth = initialTreePanelWidth + delta;
        
        // Enforce min and max constraints
        const minWidth = 200; // Minimum width in pixels
        const maxWidth = containerWidth * 0.8; // Maximum width at 80% of container
        
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
        
        // Calculate the percentage width
        const newWidthPercent = (newWidth / containerWidth) * 100;
        
        // Update the tree panel width
        treePanel.style.width = `${newWidthPercent}%`;
        
        // Save panel width preference
        savePreferences();
        
        // Update the tree without complete redraw
        if (window.treeData) {
            // Use requestAnimationFrame for smoother updates
            if (window.treeUpdateRAF) {
                cancelAnimationFrame(window.treeUpdateRAF);
            }
            window.treeUpdateRAF = requestAnimationFrame(function() {
                renderGraph(window.treeData, true);
            });
        }
    });
    
    // Mouse up event to stop dragging (listen on entire document)
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            divider.classList.remove('dragging');
            
            // Final update with reuse to ensure everything is correctly positioned
            if (window.treeData) {
                renderGraph(window.treeData, true);
            }
            
            // Delay resetting the resize flag to prevent immediate refreshes
            setTimeout(() => {
                window.isResizing = false;
            }, 300);
        }
    });
    
    // Prevent cursor changes when dragging extends outside the divider
    document.addEventListener('mouseleave', function() {
        if (isDragging) {
            isDragging = false;
            divider.classList.remove('dragging');
            window.isResizing = false;
        }
    });
    
    // Add a visual indicator when hovering over divider
    divider.addEventListener('mouseenter', function() {
        divider.classList.add('hover');
    });
    
    divider.addEventListener('mouseleave', function() {
        if (!isDragging) {
            divider.classList.remove('hover');
        }
    });
}

// Setup meta-prompt panel divider for resizing
function setupMetaPromptDivider() {
    const metaPromptDivider = document.getElementById('meta-prompt-divider');
    const metaPromptContainer = document.getElementById('meta-prompt-container');
    const metaPromptRight = document.getElementById('meta-prompt-right');
    const metaPromptTree = document.getElementById('meta-prompt-tree');
    
    if (!metaPromptDivider || !metaPromptContainer || !metaPromptRight) {
        console.warn('Meta-prompt divider elements not found');
        return;
    }
    
    let isMetaDragging = false;
    let initialRightWidth;
    let initialMetaClientX;
    
    // Mouse down event on the meta-prompt divider
    metaPromptDivider.addEventListener('mousedown', function(e) {
        e.preventDefault();
        isMetaDragging = true;
        metaPromptDivider.classList.add('dragging');
        
        initialRightWidth = metaPromptRight.offsetWidth;
        initialMetaClientX = e.clientX;
    });
    
    // Mouse move event for meta-prompt divider
    document.addEventListener('mousemove', function(e) {
        if (!isMetaDragging) return;
        
        const containerWidth = metaPromptContainer.offsetWidth;
        const delta = initialMetaClientX - e.clientX; // Reversed because we're resizing from the left edge
        let newWidth = initialRightWidth + delta;
        
        // Enforce min and max constraints
        const minWidth = 200;
        const maxWidth = containerWidth * 0.6;
        
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
        
        // Update the right panel width
        metaPromptRight.style.width = `${newWidth}px`;
        
        // The tree will auto-adjust because the left panel uses flex: 1
    });
    
    // Mouse up event to stop dragging
    document.addEventListener('mouseup', function() {
        if (isMetaDragging) {
            isMetaDragging = false;
            metaPromptDivider.classList.remove('dragging');
        }
    });
    
    // Visual hover feedback
    metaPromptDivider.addEventListener('mouseenter', function() {
        metaPromptDivider.classList.add('hover');
    });
    
    metaPromptDivider.addEventListener('mouseleave', function() {
        if (!isMetaDragging) {
            metaPromptDivider.classList.remove('hover');
        }
    });
}

// Initialize meta-prompt divider when DOM is ready
document.addEventListener('DOMContentLoaded', setupMetaPromptDivider);
