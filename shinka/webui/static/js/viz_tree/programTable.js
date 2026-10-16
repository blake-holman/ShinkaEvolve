// Programs tab: sortable, paginated table.
import { displayNodeDetails } from './nodeDetails.js';
import { escapeHtml, getFailureStatusLabel, isFailedProposalNode } from './format.js';

 // Structure: { taskName: [{ name: "result_timestamp", path: "full/path" }] }
let sortState = { key: 'rank', dir: 'asc' };
// Pagination state for programs table
let programTablePage = 0;
const programTablePageSize = 100;  // Show 100 programs per page
let programTableSortedData = [];   // Cache sorted data for pagination

export function populateProgramsTable(data) {
    const tableBody = document.querySelector("#program-table tbody");
    if (!tableBody) return;

    tableBody.innerHTML = "";
    programTablePage = 0;  // Reset to first page when data changes

    // Check if we should show incorrect programs
    const showIncorrectCheckbox = document.getElementById('show-incorrect-programs');
    const showIncorrect = showIncorrectCheckbox ? showIncorrectCheckbox.checked : false;

    // Filter data based on checkbox state
    let filteredData = data;
    if (!showIncorrect) {
        filteredData = data.filter(d => d.correct);
    }

    // Separate correct and incorrect programs for ranking
    const correctPrograms = filteredData.filter(d => d.correct && d.combined_score !== null);
    const incorrectPrograms = filteredData.filter(d => !d.correct);
    
    // Rank only correct programs
    const rankedCorrectPrograms = correctPrograms
        .sort((a, b) => b.combined_score - a.combined_score)
        .map((p, i) => ({ ...p, original_rank: i + 1 }));
    
    // Add incorrect programs without ranks (or with special ranking)
    const rankedIncorrectPrograms = incorrectPrograms
        .map((p, i) => ({ ...p, original_rank: '—' }));
    
    // Combine the arrays
    const rankedPrograms = [...rankedCorrectPrograms, ...rankedIncorrectPrograms];

    let sortedPrograms = [...rankedPrograms];

    sortedPrograms.sort((a, b) => {
        let valA, valB;
        const key = sortState.key;
        const dir = sortState.dir;

        switch (key) {
            case 'rank':
                valA = (typeof a.original_rank === 'number') ? a.original_rank : Infinity;
                valB = (typeof b.original_rank === 'number') ? b.original_rank : Infinity;
                break;
            case 'generation':
                valA = a.generation;
                valB = b.generation;
                break;
            case 'archive':
                valA = a.in_archive ? 1 : 0;
                valB = b.in_archive ? 1 : 0;
                break;
            case 'api_cost':
                valA = (a.metadata && a.metadata.api_costs !== null && a.metadata.api_costs !== undefined) ? parseFloat(a.metadata.api_costs) : -Infinity;
                valB = (b.metadata && b.metadata.api_costs !== null && b.metadata.api_costs !== undefined) ? parseFloat(b.metadata.api_costs) : -Infinity;
                break;
            case 'complexity':
                valA = (a.complexity !== null && a.complexity !== undefined) ? a.complexity : -Infinity;
                valB = (b.complexity !== null && b.complexity !== undefined) ? b.complexity : -Infinity;
                break;
            case 'island_idx':
                valA = (a.island_idx !== null && a.island_idx !== undefined) ? a.island_idx : -Infinity;
                valB = (b.island_idx !== null && b.island_idx !== undefined) ? b.island_idx : -Infinity;
                break;
            case 'novelty_attempt':
                valA = (a.metadata && a.metadata.novelty_attempt) ? a.metadata.novelty_attempt : 0;
                valB = (b.metadata && b.metadata.novelty_attempt) ? b.metadata.novelty_attempt : 0;
                break;
            case 'resample_attempt':
                valA = (a.metadata && a.metadata.resample_attempt) ? a.metadata.resample_attempt : 0;
                valB = (b.metadata && b.metadata.resample_attempt) ? b.metadata.resample_attempt : 0;
                break;
            case 'patch_attempt':
                valA = (a.metadata && a.metadata.patch_attempt) ? a.metadata.patch_attempt : 0;
                valB = (b.metadata && b.metadata.patch_attempt) ? b.metadata.patch_attempt : 0;
                break;
            default:
                return 0;
        }

        const aIsInvalid = valA === -Infinity;
        const bIsInvalid = valB === -Infinity;

        if (aIsInvalid && bIsInvalid) return a.original_rank - b.original_rank;
        if (aIsInvalid) return 1;
        if (bIsInvalid) return -1;

        if (valA === valB) {
            return a.original_rank - b.original_rank;
        }

        const dirModifier = dir === 'asc' ? 1 : -1;
        return (valA < valB ? -1 : 1) * dirModifier;
    });

    document.querySelectorAll('#program-table th.sortable .sort-arrow').forEach(arrow => {
        arrow.textContent = '';
    });
    const activeHeader = document.querySelector(`#program-table th[data-sort="${sortState.key}"] .sort-arrow`);
    if (activeHeader) {
        activeHeader.textContent = sortState.dir === 'asc' ? ' ▲' : ' ▼';
    }

    // Store sorted data for pagination
    programTableSortedData = sortedPrograms;
    
    // Render current page
    renderProgramTablePage();
}

function renderProgramTablePage() {
    const tableBody = document.querySelector("#program-table tbody");
    if (!tableBody) return;
    
    tableBody.innerHTML = "";
    
    const startIdx = programTablePage * programTablePageSize;
    const endIdx = Math.min(startIdx + programTablePageSize, programTableSortedData.length);
    const pageData = programTableSortedData.slice(startIdx, endIdx);
    
    pageData.forEach(prog => {
        const row = document.createElement("tr");
        row.setAttribute("data-node-id", prog.id);
        const isFailedProposal = isFailedProposalNode(prog);
        const statusLabel = getFailureStatusLabel(prog);
        
        // Style incorrect programs differently
        if (isFailedProposal) {
            row.style.backgroundColor = '#fff1f0';
            row.style.color = '#7a1c1c';
        } else if (!prog.correct) {
            row.style.backgroundColor = '#fff5f5';
            row.style.color = '#721c24';
        }
        
        const apiCost = (prog.metadata && prog.metadata.api_costs) ? '$' + parseFloat(prog.metadata.api_costs).toFixed(4) : 'N/A';
        const complexity = prog.complexity ? prog.complexity.toFixed(3) : 'N/A';
        const model = (prog.metadata && prog.metadata.model_name) || 'N/A';

        const islandIdx = prog.island_idx !== null && prog.island_idx !== undefined ? prog.island_idx : 'N/A';
        const archiveStatus = prog.in_archive ? '✓' : '';
        const scoreDisplay = prog.combined_score !== null ? prog.combined_score.toFixed(6) : 'N/A';
        
        const noveltyAttempt = (prog.metadata && prog.metadata.novelty_attempt) || 0;
        const resampleAttempt = (prog.metadata && prog.metadata.resample_attempt) || 0;
        const patchAttempt = (prog.metadata && prog.metadata.patch_attempt) || 0;
        
        const patchName = (prog.metadata?.patch_name || 'unnamed').substring(0, 15);
        
        row.innerHTML = `
            <td>${prog.original_rank}</td>
            <td>${prog.generation}</td>
            <td style="text-align: center; color: ${prog.in_archive ? '#28a745' : '#6c757d'}; font-weight: bold;">${archiveStatus}</td>
            <td>${escapeHtml(statusLabel)}</td>
            <td>${patchName}</td>
            <td>${prog.metadata?.patch_type || 'N/A'}</td>
            <td>${islandIdx}</td>
            <td>${scoreDisplay}</td>
            <td>${apiCost}</td>
            <td>${complexity}</td>
            <td>${noveltyAttempt}</td>
            <td>${resampleAttempt}</td>
            <td>${patchAttempt}</td>
            <td>${model}</td>
        `;
        tableBody.appendChild(row);
    });
    
    // Update pagination controls
    updateProgramTablePagination();

    tableBody.querySelectorAll('tr').forEach(row => {
        row.addEventListener('click', function() {
            const nodeId = this.getAttribute('data-node-id');
            if (!nodeId) return;

            const nodeElement = d3.selectAll('.node')
                .filter(d => d.id === nodeId)
                .node();
            
            if (nodeElement) {
                nodeElement.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window, cancelable: true }));
            } else {
                const nodeData = window.treeData.find(d => d.id === nodeId);
                if (nodeData) {
                    displayNodeDetails(nodeData);
                    document.querySelector('.tab[data-tab="agent-code"]').click();
                }
            }
        });
    });
}

function updateProgramTablePagination() {
    const totalPages = Math.ceil(programTableSortedData.length / programTablePageSize);
    const paginationContainer = document.getElementById('program-table-pagination');
    
    if (!paginationContainer) {
        // Create pagination container if it doesn't exist
        const tableContainer = document.querySelector('#program-table')?.parentElement;
        if (tableContainer) {
            const paginationDiv = document.createElement('div');
            paginationDiv.id = 'program-table-pagination';
            paginationDiv.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 10px; padding: 10px; font-size: 12px;';
            tableContainer.insertBefore(paginationDiv, tableContainer.querySelector('#program-table'));
            return updateProgramTablePagination();  // Retry after creating
        }
        return;
    }
    
    if (programTableSortedData.length <= programTablePageSize) {
        // Hide pagination if all data fits on one page
        paginationContainer.style.display = 'none';
        return;
    }
    
    paginationContainer.style.display = 'flex';
    
    const startIdx = programTablePage * programTablePageSize + 1;
    const endIdx = Math.min((programTablePage + 1) * programTablePageSize, programTableSortedData.length);
    
    paginationContainer.innerHTML = `
        <button id="prev-page-btn" ${programTablePage === 0 ? 'disabled' : ''} 
                style="padding: 4px 8px; cursor: ${programTablePage === 0 ? 'not-allowed' : 'pointer'}; opacity: ${programTablePage === 0 ? '0.5' : '1'};">
            ◀ Prev
        </button>
        <span style="color: #666;">
            Showing ${startIdx}-${endIdx} of ${programTableSortedData.length} programs
        </span>
        <button id="next-page-btn" ${programTablePage >= totalPages - 1 ? 'disabled' : ''} 
                style="padding: 4px 8px; cursor: ${programTablePage >= totalPages - 1 ? 'not-allowed' : 'pointer'}; opacity: ${programTablePage >= totalPages - 1 ? '0.5' : '1'};">
            Next ▶
        </button>
    `;
    
    document.getElementById('prev-page-btn')?.addEventListener('click', () => {
        if (programTablePage > 0) {
            programTablePage--;
            renderProgramTablePage();
        }
    });
    
    document.getElementById('next-page-btn')?.addEventListener('click', () => {
        if (programTablePage < totalPages - 1) {
            programTablePage++;
            renderProgramTablePage();
        }
    });
}

export function setupTableSorting() {
    const headers = document.querySelectorAll('#program-table th.sortable');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.dataset.sort;
            if (sortState.key === sortKey) {
                sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.key = sortKey;
                sortState.dir = (sortKey === 'rank' || sortKey === 'generation') ? 'asc' : 'desc';
            }
            if (window.treeData) {
                populateProgramsTable(window.treeData);
            }
        });
    });
}
