// Formatting helpers shared by several tabs.

// Get CSS class for score display
export function getScoreClass(score) {
    if (score === null || score === undefined) {
        return "metric-bad";
    }
    return "metric-good";
}

// Format score for display
export function formatScore(score) {
    if (score === null || score === undefined) {
        return "N/A";
    }
    
    // Convert to number if it's a string
    const numScore = typeof score === 'string' ? parseFloat(score) : score;
    
    // Check if it's a valid number
    if (typeof numScore === 'number' && !isNaN(numScore)) {
        return numScore.toFixed(6);
    } else {
        // Return the original value as string if it's not a valid number
        return String(score);
    }
}

export function isFailedProposalNode(program) {
    return Boolean(
        program &&
        program.metadata &&
        program.metadata.node_kind === 'failed_proposal'
    );
}

export function getFailureStatusLabel(program) {
    if (isFailedProposalNode(program)) {
        const failureClass = program.metadata.failure_class || program.metadata.failure_stage || 'failed_proposal';
        return failureClass.replace(/_/g, ' ');
    }
    return program.correct ? 'correct' : 'incorrect';
}

export function buildFailureSummaryHtml(data) {
    if (!isFailedProposalNode(data)) {
        return '';
    }

    const failureStage = data.metadata?.failure_stage || 'proposal';
    const failureClass = data.metadata?.failure_class || 'failed_proposal';
    const failureReason = data.metadata?.failure_reason || data.text_feedback || 'Failed before downstream evaluation.';
    const failureJsonPath = data.metadata?.failure_json_path || 'N/A';

    return `
        <div class="details-section">
            <h5>Failure Summary</h5>
            <p><strong>Stage:</strong> ${escapeHtml(String(failureStage))}</p>
            <p><strong>Class:</strong> ${escapeHtml(String(failureClass))}</p>
            <p><strong>Reason:</strong> ${escapeHtml(String(failureReason))}</p>
            <p><strong>failure.json:</strong> <span class="metadata-value">${escapeHtml(String(failureJsonPath))}</span></p>
        </div>
    `;
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
