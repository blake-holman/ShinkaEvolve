// Diff tab: parent and initial-program diffs.
import { escapeHtml } from './format.js';

function formatDiff(diffText) {
    if (!diffText) return '';
    return diffText.split('\n').map(line => {
        const escapedLine = escapeHtml(line);
        if (line.startsWith('+') && !line.startsWith('+++')) {
            return `<span class="diff-line added">${escapedLine}</span>`;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            return `<span class="diff-line removed">${escapedLine}</span>`;
        } else if (line.startsWith('@@')) {
            return `<span class="diff-line hunk-header">${escapedLine}</span>`;
        }
        return `<span class="diff-line unchanged">${escapedLine}</span>`;
    }).join('');
}

// Toggle showing only modified lines in the diff
export function toggleUnchangedLines() {
    const diffContainer = document.getElementById('code-diff');
    const btn = document.getElementById('toggle-unchanged-btn');
    
    if (diffContainer.classList.contains('hide-unchanged')) {
        diffContainer.classList.remove('hide-unchanged');
        btn.classList.remove('active');
        btn.textContent = 'Show Changes Only';
    } else {
        diffContainer.classList.add('hide-unchanged');
        btn.classList.add('active');
        btn.textContent = 'Show All Lines';
    }
}

// Current diff mode: 'parent' or 'initial'
window.currentDiffMode = 'parent';
// Cache for diff data
window.currentDiffData = {
    parentDiff: null,
    initialDiff: null,
    currentCode: null,
    initialCode: null
};

// Set diff comparison mode (parent or initial)
export function setDiffMode(mode) {
    if (mode === window.currentDiffMode) return;
    
    window.currentDiffMode = mode;
    
    // Update button states
    const parentBtn = document.getElementById('diff-vs-parent-btn');
    const initialBtn = document.getElementById('diff-vs-initial-btn');
    
    if (mode === 'parent') {
        parentBtn.classList.add('active');
        initialBtn.classList.remove('active');
        displayCurrentDiff();
    } else if (mode === 'initial') {
        parentBtn.classList.remove('active');
        initialBtn.classList.add('active');
        
        // If we don't have the initial diff cached, compute it
        if (!window.currentDiffData.initialDiff && window.currentDiffData.currentCode) {
            computeInitialDiff();
        } else {
            displayCurrentDiff();
        }
    }
}

// Display the current diff based on mode
export function displayCurrentDiff() {
    const diffContentWrapper = document.getElementById('code-diff-content');
    
    if (window.currentDiffMode === 'parent') {
        if (window.currentDiffData.parentDiff) {
            diffContentWrapper.innerHTML = `<pre class="diff">${formatDiff(window.currentDiffData.parentDiff)}</pre>`;
        } else {
            diffContentWrapper.innerHTML = "<p>No parent diff available for this node.</p>";
        }
    } else {
        if (window.currentDiffData.initialDiff) {
            diffContentWrapper.innerHTML = `<pre class="diff">${formatDiff(window.currentDiffData.initialDiff)}</pre>`;
        } else {
            diffContentWrapper.innerHTML = "<p>No initial diff available for this node.</p>";
        }
    }
}

// Compute diff between current code and initial program
function computeInitialDiff() {
    const diffContentWrapper = document.getElementById('code-diff-content');
    
    // First check if we already have the initial code
    if (window.currentDiffData.initialCode !== null) {
        // Generate the diff
        window.currentDiffData.initialDiff = generateUnifiedDiff(
            window.currentDiffData.initialCode,
            window.currentDiffData.currentCode,
            'initial',
            'current'
        );
        displayCurrentDiff();
        return;
    }
    
    // Need to fetch the initial program's code
    diffContentWrapper.innerHTML = `<p style="color: #666;">Loading initial program code...</p>`;
    
    // Find the initial node (generation 0)
    const initialNode = window.treeData?.find(d => d.generation === 0);
    if (!initialNode) {
        diffContentWrapper.innerHTML = "<p>Could not find initial program.</p>";
        return;
    }
    
    // Fetch the initial program's code
    fetch(`/get_program_details?db_path=${encodeURIComponent(window.currentDbPath)}&id=${encodeURIComponent(initialNode.id)}`)
        .then(r => {
            if (!r.ok) throw new Error('Failed to load initial program');
            return r.json();
        })
        .then(data => {
            window.currentDiffData.initialCode = data.code || '';
            
            // Generate the diff
            window.currentDiffData.initialDiff = generateUnifiedDiff(
                window.currentDiffData.initialCode,
                window.currentDiffData.currentCode,
                'initial',
                'current'
            );
            displayCurrentDiff();
        })
        .catch(err => {
            console.error('[DEBUG] Failed to load initial program:', err);
            diffContentWrapper.innerHTML = `<p style="color: #dc3545;">Failed to load initial program: ${err.message}</p>`;
        });
}

// Generate unified diff format from two strings
function generateUnifiedDiff(oldText, newText, oldName, newName) {
    if (typeof Diff === 'undefined') {
        console.warn('[WARN] Diff library not loaded');
        return null;
    }
    
    if (!oldText && !newText) return null;
    oldText = oldText || '';
    newText = newText || '';
    
    // Use the Diff library to create a unified diff
    const patch = Diff.createPatch('code', oldText, newText, oldName, newName);
    
    // Remove the first 4 lines (diff header) if present, keeping just the hunks
    // Actually, let's keep the full format but make it cleaner
    return patch;
}
