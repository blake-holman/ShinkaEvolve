// Usage tab: runtime timeline and worker occupancy.

function formatRuntimeSeconds(seconds) {
    if (!Number.isFinite(seconds)) return 'N/A';
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
}

function formatRuntimeTimestamp(epochSeconds) {
    if (!Number.isFinite(epochSeconds)) return 'N/A';
    return new Date(epochSeconds * 1000).toLocaleString();
}

function getMinVisibleRuntimeBarMs(rangeMs) {
    if (!Number.isFinite(rangeMs) || rangeMs <= 0) return 250;
    return Math.max(250, rangeMs * 0.003);
}

function getDisplayRuntimeBarMs(durationSeconds, minVisibleBarMs) {
    const durationMs = Math.max(0, (durationSeconds || 0) * 1000);
    if (durationMs <= 0) return minVisibleBarMs;
    return Math.max(durationMs, minVisibleBarMs);
}

function parseRuntimeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getRuntimeTimelineRowPriority(row) {
    let priority = 0;
    if (!row.isIslandCopy) priority += 10;
    if (row.correct) priority += 2;
    if (Number.isFinite(row.combinedScore)) priority += 1;
    return priority;
}

function getBaseRuntimeTimelineRows(data) {
    if (!Array.isArray(data) || data.length === 0) return [];

    const rows = data.map(program => {
        const meta = program.metadata || {};
        const pipelineStartedAt = parseRuntimeNumber(meta.pipeline_started_at);
        const samplingStartedAt = parseRuntimeNumber(meta.sampling_started_at);
        const samplingFinishedAt = parseRuntimeNumber(meta.sampling_finished_at);
        const evaluationStartedAt = parseRuntimeNumber(meta.evaluation_started_at);
        const evaluationFinishedAt = parseRuntimeNumber(meta.evaluation_finished_at);
        const postprocessStartedAt = parseRuntimeNumber(meta.postprocess_started_at);
        const postprocessFinishedAt = parseRuntimeNumber(meta.postprocess_finished_at);

        if (
            pipelineStartedAt === null ||
            samplingStartedAt === null ||
            samplingFinishedAt === null ||
            evaluationStartedAt === null ||
            evaluationFinishedAt === null ||
            postprocessStartedAt === null ||
            postprocessFinishedAt === null
        ) {
            return null;
        }

        return {
            id: program.id,
            sourceJobId: meta.source_job_id || null,
            isIslandCopy: Boolean(meta._spawned_island || meta._is_island_copy),
            generation: program.generation ?? 0,
            timestamp: typeof program.timestamp === 'number' ? program.timestamp : 0,
            correct: Boolean(program.correct),
            combinedScore: typeof program.combined_score === 'number' ? program.combined_score : null,
            patchName: meta.patch_name || 'unnamed',
            modelName: meta.model_name || meta.llm_result?.model || meta.model || 'N/A',
            noveltyAttempt: parseRuntimeNumber(meta.novelty_attempt),
            resampleAttempt: parseRuntimeNumber(meta.resample_attempt),
            patchAttempt: parseRuntimeNumber(meta.patch_attempt),
            timelineLaneMode: meta.timeline_lane_mode || null,
            samplingWorkerId: parseRuntimeNumber(meta.sampling_worker_id),
            evaluationWorkerId: parseRuntimeNumber(meta.evaluation_worker_id),
            postprocessWorkerId: parseRuntimeNumber(meta.postprocess_worker_id),
            samplingWorkerCapacity: parseRuntimeNumber(meta.sampling_worker_capacity),
            evaluationWorkerCapacity: parseRuntimeNumber(meta.evaluation_worker_capacity),
            postprocessWorkerCapacity: parseRuntimeNumber(meta.postprocess_worker_capacity),
            pipelineStartedAt,
            samplingStartedAt,
            samplingFinishedAt,
            evaluationStartedAt,
            evaluationFinishedAt,
            postprocessStartedAt,
            postprocessFinishedAt,
            samplingSeconds: Math.max(0, samplingFinishedAt - samplingStartedAt),
            evaluationSeconds: Math.max(0, evaluationFinishedAt - evaluationStartedAt),
            postprocessSeconds: Math.max(0, postprocessFinishedAt - postprocessStartedAt)
        };
    }).filter(row => row !== null);

    const dedupedRows = new Map();
    rows.forEach(row => {
        const dedupeKey = row.sourceJobId || row.id;
        const existing = dedupedRows.get(dedupeKey);
        if (!existing) {
            dedupedRows.set(dedupeKey, row);
            return;
        }

        const existingPriority = getRuntimeTimelineRowPriority(existing);
        const rowPriority = getRuntimeTimelineRowPriority(row);
        if (rowPriority > existingPriority) {
            dedupedRows.set(dedupeKey, row);
            return;
        }

        if (rowPriority === existingPriority && row.timestamp < existing.timestamp) {
            dedupedRows.set(dedupeKey, row);
        }
    });

    return Array.from(dedupedRows.values());
}

function computePeakConcurrency(rows, startKey, endKey) {
    const events = [];
    rows.forEach(row => {
        const start = row[startKey];
        const end = row[endKey];
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
        events.push([start, 1]);
        events.push([end, -1]);
    });

    events.sort((a, b) => {
        if (a[0] !== b[0]) return a[0] - b[0];
        return a[1] - b[1];
    });

    let current = 0;
    let peak = 0;
    events.forEach(([, delta]) => {
        current += delta;
        peak = Math.max(peak, current);
    });
    return peak;
}

function reconcileStageWorkerOverlaps(rows, { workerIdKey, startKey, endKey }) {
    const reconciledRows = rows.map(row => ({ ...row }));
    const validRows = reconciledRows
        .filter(
            row => Number.isFinite(row[workerIdKey]) &&
                Number.isFinite(row[startKey]) &&
                Number.isFinite(row[endKey])
        )
        .sort((a, b) => {
            if (a[workerIdKey] !== b[workerIdKey]) {
                return a[workerIdKey] - b[workerIdKey];
            }
            if (a[startKey] !== b[startKey]) {
                return a[startKey] - b[startKey];
            }
            if (a[endKey] !== b[endKey]) {
                return a[endKey] - b[endKey];
            }
            if (a.generation !== b.generation) {
                return a.generation - b.generation;
            }
            return a.pipelineStartedAt - b.pipelineStartedAt;
        });

    const previousEndByWorker = new Map();
    validRows.forEach(row => {
        const workerId = row[workerIdKey];
        const previousEnd = previousEndByWorker.get(workerId);
        const normalizedStart = previousEnd === undefined
            ? row[startKey]
            : Math.max(row[startKey], previousEnd);
        const normalizedEnd = Math.max(normalizedStart, row[endKey]);
        row[startKey] = normalizedStart;
        row[endKey] = normalizedEnd;
        previousEndByWorker.set(workerId, normalizedEnd);
    });

    return reconciledRows;
}

function assignStageTimelineLaneIds(
    rows,
    { workerIdKey, startKey, endKey, fallbackLaneKey, capacity }
) {
    const assignedRows = rows.map(row => ({ ...row }));
    const validRows = assignedRows
        .filter(
            row => Number.isFinite(row[startKey]) && Number.isFinite(row[endKey])
        )
        .sort((a, b) => {
            if (a[startKey] !== b[startKey]) {
                return a[startKey] - b[startKey];
            }
            if (a[endKey] !== b[endKey]) {
                return a[endKey] - b[endKey];
            }
            if (a.generation !== b.generation) {
                return a.generation - b.generation;
            }
            return a.pipelineStartedAt - b.pipelineStartedAt;
        });

    const laneCount = Math.max(0, Math.floor(capacity || 0));
    const laneEndTimes = Array.from(
        { length: laneCount },
        () => Number.NEGATIVE_INFINITY
    );
    const laneEpsilon = 1e-6;

    validRows.forEach(row => {
        const workerId = row[workerIdKey];
        if (Number.isFinite(workerId) && workerId > 0) {
            const laneIndex = Math.floor(workerId) - 1;
            while (laneEndTimes.length <= laneIndex) {
                laneEndTimes.push(Number.NEGATIVE_INFINITY);
            }
            laneEndTimes[laneIndex] = row[endKey];
            row[fallbackLaneKey] = Math.floor(workerId);
            return;
        }

        let laneIndex = laneEndTimes.findIndex(
            laneEndTime => row[startKey] >= laneEndTime - laneEpsilon
        );
        if (laneIndex === -1) {
            laneIndex = laneEndTimes.length;
            laneEndTimes.push(row[endKey]);
        } else {
            laneEndTimes[laneIndex] = row[endKey];
        }
        row[fallbackLaneKey] = laneIndex + 1;
    });

    return assignedRows;
}

function getLegacyRuntimeTimelineRows(data) {
    const rows = getBaseRuntimeTimelineRows(data);
    if (rows.length === 0) return { rows: [], laneCount: 0 };

    rows.sort((a, b) => {
        if (a.evaluationStartedAt !== b.evaluationStartedAt) {
            return a.evaluationStartedAt - b.evaluationStartedAt;
        }
        if (a.generation !== b.generation) return a.generation - b.generation;
        return a.pipelineStartedAt - b.pipelineStartedAt;
    });

    const laneEndTimes = [];
    const laneEpsilon = 1e-6;
    rows.forEach(row => {
        let laneIndex = laneEndTimes.findIndex(
            laneEndTime => row.evaluationStartedAt >= laneEndTime - laneEpsilon
        );
        if (laneIndex === -1) {
            laneIndex = laneEndTimes.length;
            laneEndTimes.push(row.evaluationFinishedAt);
        } else {
            laneEndTimes[laneIndex] = row.evaluationFinishedAt;
        }
        row.workerLabel = `Worker ${laneIndex + 1}`;
    });

    return { rows, laneCount: laneEndTimes.length };
}

function getPoolRuntimeTimelineData(data) {
    let rows = getBaseRuntimeTimelineRows(data).filter(
        row => row.timelineLaneMode === 'pool_slots'
    );
    if (rows.length === 0) return null;

    [
        {
            workerIdKey: 'samplingWorkerId',
            startKey: 'samplingStartedAt',
            endKey: 'samplingFinishedAt'
        },
        {
            workerIdKey: 'evaluationWorkerId',
            startKey: 'evaluationStartedAt',
            endKey: 'evaluationFinishedAt'
        },
        {
            workerIdKey: 'postprocessWorkerId',
            startKey: 'postprocessStartedAt',
            endKey: 'postprocessFinishedAt'
        }
    ].forEach(stage => {
        rows = reconcileStageWorkerOverlaps(rows, stage);
    });

    let capacities = {
        sampling: Math.max(0, ...rows.map(row => row.samplingWorkerCapacity || row.samplingWorkerId || 0)),
        evaluation: Math.max(0, ...rows.map(row => row.evaluationWorkerCapacity || row.evaluationWorkerId || 0)),
        postprocess: Math.max(0, ...rows.map(row => row.postprocessWorkerCapacity || row.postprocessWorkerId || 0))
    };

    [
        {
            workerIdKey: 'samplingWorkerId',
            startKey: 'samplingStartedAt',
            endKey: 'samplingFinishedAt',
            fallbackLaneKey: 'samplingLaneId',
            capacityKey: 'sampling'
        },
        {
            workerIdKey: 'evaluationWorkerId',
            startKey: 'evaluationStartedAt',
            endKey: 'evaluationFinishedAt',
            fallbackLaneKey: 'evaluationLaneId',
            capacityKey: 'evaluation'
        },
        {
            workerIdKey: 'postprocessWorkerId',
            startKey: 'postprocessStartedAt',
            endKey: 'postprocessFinishedAt',
            fallbackLaneKey: 'postprocessLaneId',
            capacityKey: 'postprocess'
        }
    ].forEach(stage => {
        rows = assignStageTimelineLaneIds(rows, {
            workerIdKey: stage.workerIdKey,
            startKey: stage.startKey,
            endKey: stage.endKey,
            fallbackLaneKey: stage.fallbackLaneKey,
            capacity: capacities[stage.capacityKey]
        });
        capacities[stage.capacityKey] = Math.max(
            capacities[stage.capacityKey],
            ...rows.map(row => row[stage.fallbackLaneKey] || 0)
        );
    });

    if (capacities.sampling === 0 && capacities.evaluation === 0 && capacities.postprocess === 0) {
        return null;
    }

    const laneLabels = [];
    const maxLaneCount = Math.max(
        capacities.sampling,
        capacities.evaluation,
        capacities.postprocess
    );

    for (let idx = 1; idx <= maxLaneCount; idx += 1) {
        if (idx <= capacities.sampling) laneLabels.push(`Sampling W${idx}`);
        if (idx <= capacities.evaluation) laneLabels.push(`Evaluation W${idx}`);
        if (idx <= capacities.postprocess) laneLabels.push(`Postprocess W${idx}`);
    }

    return {
        rows,
        capacities,
        laneLabels,
        peaks: {
            sampling: computePeakConcurrency(rows, 'samplingStartedAt', 'samplingFinishedAt'),
            evaluation: computePeakConcurrency(rows, 'evaluationStartedAt', 'evaluationFinishedAt'),
            postprocess: computePeakConcurrency(rows, 'postprocessStartedAt', 'postprocessFinishedAt')
        }
    };
}

window.isThroughputRuntimePlotVisible = true;

const RUNTIME_TIMELINE_ROW_HEIGHT = 34;
const RUNTIME_TIMELINE_MIN_HEIGHT = 220;
const RUNTIME_TIMELINE_BASE_CHROME = 140;
const RUNTIME_TIMELINE_LINE_WIDTH = 12;
const RUNTIME_TIMELINE_BAR_WIDTH = 0.72;

function getRuntimeTimelinePlotHeight(laneCount) {
    const safeLaneCount = Math.max(0, Math.floor(laneCount || 0));
    return Math.max(
        RUNTIME_TIMELINE_MIN_HEIGHT,
        RUNTIME_TIMELINE_BASE_CHROME + (safeLaneCount * RUNTIME_TIMELINE_ROW_HEIGHT)
    );
}

function getRuntimeTimelineLineWidth() {
    return RUNTIME_TIMELINE_LINE_WIDTH;
}

function getRuntimeTimelineBarWidth() {
    return RUNTIME_TIMELINE_BAR_WIDTH;
}

function setThroughputRuntimePlotVisibility(isVisible, rerender = false) {
    window.isThroughputRuntimePlotVisible = isVisible;
    const wrapper = document.getElementById('throughput-runtime-plot-wrapper');
    const button = document.getElementById('throughput-runtime-toggle');
    if (wrapper) {
        wrapper.style.display = isVisible ? 'block' : 'none';
    }
    if (button) {
        button.textContent = isVisible ? 'Hide Plot' : 'Show Plot';
    }
    if (
        isVisible &&
        rerender &&
        window.treeData &&
        window.treeData.length > 0
    ) {
        renderRuntimeTimelinePlot(window.treeData, window.selectedNodeId || null, 'throughput-runtime-summary', 'throughput-runtime-plot');
    }
}

export function toggleThroughputRuntimePlot() {
    setThroughputRuntimePlotVisibility(!window.isThroughputRuntimePlotVisible, window.isThroughputRuntimePlotVisible === false);
}

function getRuntimeTimelineLayout({
    minStartMs,
    maxEndMs,
    runtimePlotHeight,
    yAxisTitle,
    laneLabels = null,
    laneCount = null
}) {
    const layout = {
        barmode: 'overlay',
        height: runtimePlotHeight,
        margin: { l: 150, r: 10, t: 60, b: 105 },
        xaxis: {
            title: {
                text: 'Wall Clock Time',
                standoff: 14
            },
            type: 'date',
            range: [minStartMs, maxEndMs],
            tickformat: '%Y-%m-%d<br>%H:%M:%S',
            tickangle: 0,
            automargin: true,
            tickfont: {
                size: 11
            }
        },
        yaxis: {
            automargin: true,
            autorange: 'reversed',
            title: yAxisTitle,
            ticklabelposition: 'outside'
        },
        hovermode: 'closest',
        legend: {
            orientation: 'h',
            x: 0.01,
            xanchor: 'left',
            y: 1.01,
            yanchor: 'bottom',
            bgcolor: 'rgba(255,255,255,0.9)'
        }
    };

    if (laneLabels) {
        layout.yaxis.categoryorder = 'array';
        layout.yaxis.categoryarray = laneLabels;
    }

    if (Number.isFinite(laneCount) && laneCount > 0) {
        layout.yaxis.range = [laneCount - 0.5, -0.5];
    }

    return layout;
}

function renderRuntimeTimelinePlot(
    data,
    selectedNodeId,
    summaryId = 'runtime-timeline-summary',
    plotId = 'runtime-timeline-plot'
) {
    const container = document.getElementById(plotId);
    if (!container) return;
    const summary = document.getElementById(summaryId);

    const poolData = getPoolRuntimeTimelineData(data);
    if (poolData && poolData.rows.length) {
        const { rows, capacities, laneLabels, peaks } = poolData;
        const runtimePlotHeight = getRuntimeTimelinePlotHeight(laneLabels.length);
        const poolLineWidth = getRuntimeTimelineLineWidth();
        if (summary) {
            summary.innerHTML = `
                <span><strong>Sampling:</strong> peak ${peaks.sampling}/${capacities.sampling || 0}</span>
                <span><strong>Evaluation:</strong> peak ${peaks.evaluation}/${capacities.evaluation || 0}</span>
                <span><strong>Postprocess:</strong> peak ${peaks.postprocess}/${capacities.postprocess || 0}</span>
            `;
        }

        const stageConfigs = [
            {
                key: 'sampling',
                label: 'Sampling',
                color: '#3b82f6',
                startKey: 'samplingStartedAt',
                endKey: 'samplingFinishedAt',
                durationKey: 'samplingSeconds',
                laneLabel: row => (row.samplingWorkerId || row.samplingLaneId) ? `Sampling W${row.samplingWorkerId || row.samplingLaneId}` : null
            },
            {
                key: 'evaluation',
                label: 'Evaluation',
                color: '#f59e0b',
                startKey: 'evaluationStartedAt',
                endKey: 'evaluationFinishedAt',
                durationKey: 'evaluationSeconds',
                laneLabel: row => (row.evaluationWorkerId || row.evaluationLaneId) ? `Evaluation W${row.evaluationWorkerId || row.evaluationLaneId}` : null
            },
            {
                key: 'postprocess',
                label: 'Postprocess',
                color: '#10b981',
                startKey: 'postprocessStartedAt',
                endKey: 'postprocessFinishedAt',
                durationKey: 'postprocessSeconds',
                laneLabel: row => (row.postprocessWorkerId || row.postprocessLaneId) ? `Postprocess W${row.postprocessWorkerId || row.postprocessLaneId}` : null
            }
        ];

        const traces = stageConfigs.map(stage => {
            const stageRows = rows.filter(row => stage.laneLabel(row));
            const minStartMs = Math.min(...rows.map(row => row.pipelineStartedAt * 1000));
            const maxEndMs = Math.max(...rows.map(row => row.postprocessFinishedAt * 1000));
            const minVisibleBarMs = getMinVisibleRuntimeBarMs(maxEndMs - minStartMs);
            const x = [];
            const y = [];
            const customdata = [];

            stageRows.forEach(row => {
                const startMs = row[stage.startKey] * 1000;
                const displayDurationMs = getDisplayRuntimeBarMs(row[stage.durationKey], minVisibleBarMs);
                const endMs = startMs + displayDurationMs;
                const laneLabel = stage.laneLabel(row);
                const details = [
                    laneLabel,
                    row.generation,
                    row.patchName,
                    row.modelName,
                    formatRuntimeSeconds(row[stage.durationKey]),
                    formatRuntimeTimestamp(row[stage.startKey]),
                    formatRuntimeTimestamp(row[stage.endKey]),
                    row.noveltyAttempt ?? 'N/A',
                    row.resampleAttempt ?? 'N/A',
                    row.patchAttempt ?? 'N/A',
                ];

                x.push(startMs, endMs, null);
                y.push(laneLabel, laneLabel, null);
                customdata.push(details, details, null);
            });

            return {
                type: 'scatter',
                mode: 'lines',
                name: stage.label,
                x,
                y,
                line: {
                    color: stage.color,
                    width: poolLineWidth
                },
                opacity: 0.92,
                connectgaps: false,
                customdata,
                hovertemplate:
                    '<b>%{customdata[0]}</b><br>' +
                    'Gen %{customdata[1]}<br>' +
                    '%{fullData.name}: %{customdata[4]}<br>' +
                    'Patch: %{customdata[2]}<br>' +
                    'Model: %{customdata[3]}<br>' +
                    'Start: %{customdata[5]}<br>' +
                    'End: %{customdata[6]}<br>' +
                    'Novelty Attempt: %{customdata[7]}<br>' +
                    'Resample Attempt: %{customdata[8]}<br>' +
                    'Patch Attempt: %{customdata[9]}<extra></extra>',
            };
        });

        const minStartMs = Math.min(...rows.map(row => row.pipelineStartedAt * 1000));
        const maxEndMs = Math.max(...rows.map(row => row.postprocessFinishedAt * 1000));
        const layout = getRuntimeTimelineLayout({
            minStartMs,
            maxEndMs,
            runtimePlotHeight,
            yAxisTitle: 'Resource Pool',
            laneLabels,
            laneCount: laneLabels.length
        });

        Plotly.newPlot(plotId, traces, layout, {
            responsive: true,
            displayModeBar: false
        });
        return;
    }

    const { rows, laneCount } = getLegacyRuntimeTimelineRows(data);
    if (!rows.length) {
        if (summary) summary.textContent = '';
        container.innerHTML = '<p style="text-align: center; color: #999;">No runtime timeline data available.</p>';
        return;
    }
    if (summary) {
        summary.textContent = 'Legacy mode: inferred worker lanes from timestamps only.';
    }

    const runtimePlotHeight = getRuntimeTimelinePlotHeight(laneCount);
    const legacyBarWidth = getRuntimeTimelineBarWidth();
    const stageConfigs = [
        {
            key: 'sampling',
            label: 'Sampling',
            color: '#3b82f6',
            startKey: 'samplingStartedAt',
            endKey: 'samplingFinishedAt',
            durationKey: 'samplingSeconds'
        },
        {
            key: 'evaluation',
            label: 'Evaluation',
            color: '#f59e0b',
            startKey: 'evaluationStartedAt',
            endKey: 'evaluationFinishedAt',
            durationKey: 'evaluationSeconds'
        },
        {
            key: 'postprocess',
            label: 'Postprocess',
            color: '#10b981',
            startKey: 'postprocessStartedAt',
            endKey: 'postprocessFinishedAt',
            durationKey: 'postprocessSeconds'
        }
    ];

    const minStartMs = Math.min(...rows.map(row => row.pipelineStartedAt * 1000));
    const maxEndMs = Math.max(...rows.map(row => row.postprocessFinishedAt * 1000));
    const minVisibleBarMs = getMinVisibleRuntimeBarMs(maxEndMs - minStartMs);
    const yLabels = rows.map(row => row.workerLabel);
    const traces = stageConfigs.map(stage => ({
        type: 'bar',
        orientation: 'h',
        name: stage.label,
        y: yLabels,
        x: rows.map(row => getDisplayRuntimeBarMs(row[stage.durationKey], minVisibleBarMs)),
        base: rows.map(row => row[stage.startKey] * 1000),
        width: rows.map(() => legacyBarWidth),
        marker: {
            color: rows.map(row => row.id === selectedNodeId ? stage.color : stage.color),
            line: {
                color: rows.map(row => row.id === selectedNodeId ? '#111827' : '#ffffff'),
                width: rows.map(row => row.id === selectedNodeId ? 1.5 : 0.5)
            }
        },
        opacity: 0.92,
        customdata: rows.map(row => ([
            row.workerLabel,
            row.generation,
            row.patchName,
            row.modelName,
            formatRuntimeSeconds(row[stage.durationKey]),
            formatRuntimeTimestamp(row[stage.startKey]),
            formatRuntimeTimestamp(row[stage.endKey]),
            row.noveltyAttempt ?? 'N/A',
            row.resampleAttempt ?? 'N/A',
            row.patchAttempt ?? 'N/A',
        ])),
        hovertemplate:
            '<b>%{customdata[0]}</b><br>' +
            'Gen %{customdata[1]}<br>' +
            '%{fullData.name}: %{customdata[4]}<br>' +
            'Patch: %{customdata[2]}<br>' +
            'Model: %{customdata[3]}<br>' +
            'Start: %{customdata[5]}<br>' +
            'End: %{customdata[6]}<br>' +
            'Novelty Attempt: %{customdata[7]}<br>' +
            'Resample Attempt: %{customdata[8]}<br>' +
            'Patch Attempt: %{customdata[9]}<extra></extra>',
    }));

    const layout = getRuntimeTimelineLayout({
        minStartMs,
        maxEndMs,
        runtimePlotHeight,
        yAxisTitle: 'Worker Lane',
        laneCount
    });

    Plotly.newPlot(plotId, traces, layout, {
        responsive: true,
        displayModeBar: false
    });
}

function computeOccupancySeries(rows, startKey, endKey, capacity) {
    if (!rows.length || !Number.isFinite(capacity) || capacity <= 0) {
        return null;
    }

    const intervals = rows
        .map(row => [row[startKey], row[endKey]])
        .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start);
    if (!intervals.length) return null;

    const minStart = Math.min(...intervals.map(([start]) => start));
    const maxEnd = Math.max(...intervals.map(([, end]) => end));
    const events = [];
    intervals.forEach(([start, end]) => {
        events.push([start, 1]);
        events.push([end, -1]);
    });
    events.sort((a, b) => {
        if (a[0] !== b[0]) return a[0] - b[0];
        return a[1] - b[1];
    });

    const x = [minStart * 1000];
    const y = [0];
    const durationByCount = new Map();
    let current = 0;
    let previous = minStart;

    events.forEach(([time, delta]) => {
        if (time > previous) {
            durationByCount.set(
                current,
                (durationByCount.get(current) || 0) + (time - previous)
            );
        }
        x.push(time * 1000);
        y.push(current);
        current += delta;
        x.push(time * 1000);
        y.push(current);
        previous = time;
    });

    if (maxEnd > previous) {
        durationByCount.set(
            current,
            (durationByCount.get(current) || 0) + (maxEnd - previous)
        );
    }

    const totalDuration = maxEnd - minStart;
    const occupiedTime = Array.from(durationByCount.entries()).reduce(
        (sum, [count, duration]) => sum + count * duration,
        0
    );

    return {
        x,
        y,
        minStart,
        maxEnd,
        capacity,
        totalDuration,
        durationByCount,
        avgOccupied: totalDuration > 0 ? occupiedTime / totalDuration : 0,
        utilizationPct: totalDuration > 0 ? (occupiedTime / (capacity * totalDuration)) * 100 : 0,
        fullOccupancyPct: totalDuration > 0 ? ((durationByCount.get(capacity) || 0) / totalDuration) * 100 : 0,
        idlePct: totalDuration > 0 ? ((durationByCount.get(0) || 0) / totalDuration) * 100 : 0,
    };
}

function percentile(values, pct) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1)
    );
    return sorted[index];
}

function formatThroughputPercent(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)}%` : 'N/A';
}

function formatThroughputValue(value) {
    return Number.isFinite(value) ? value.toFixed(2) : 'N/A';
}

function renderThroughputSummary(rows, capacities) {
    const container = document.getElementById('throughput-summary');
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No throughput data available.</p>';
        return;
    }

    const evalSeries = computeOccupancySeries(rows, 'evaluationStartedAt', 'evaluationFinishedAt', capacities.evaluation);
    const minStart = Math.min(...rows.map(row => row.pipelineStartedAt));
    const maxEnd = Math.max(...rows.map(row => row.postprocessFinishedAt));
    const wallClockMinutes = (maxEnd - minStart) / 60;
    const throughputPerMinute = wallClockMinutes > 0 ? rows.length / wallClockMinutes : 0;

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px;">
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px;">
                <div style="font-size: 12px; color: #666;">Wall-Clock Span</div>
                <div style="font-size: 20px; font-weight: 600;">${formatRuntimeSeconds(maxEnd - minStart)}</div>
            </div>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px;">
                <div style="font-size: 12px; color: #666;">Completed Jobs</div>
                <div style="font-size: 20px; font-weight: 600;">${rows.length}</div>
            </div>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px;">
                <div style="font-size: 12px; color: #666;">Eval Full Occupancy</div>
                <div style="font-size: 20px; font-weight: 600;">${evalSeries ? formatThroughputPercent(evalSeries.fullOccupancyPct) : 'N/A'}</div>
            </div>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px;">
                <div style="font-size: 12px; color: #666;">Eval Utilization</div>
                <div style="font-size: 20px; font-weight: 600;">${evalSeries ? formatThroughputPercent(evalSeries.utilizationPct) : 'N/A'}</div>
            </div>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px;">
                <div style="font-size: 12px; color: #666;">Eval Idle</div>
                <div style="font-size: 20px; font-weight: 600;">${evalSeries ? formatThroughputPercent(evalSeries.idlePct) : 'N/A'}</div>
            </div>
            <div style="background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px;">
                <div style="font-size: 12px; color: #666;">Completions / Min</div>
                <div style="font-size: 20px; font-weight: 600;">${formatThroughputValue(throughputPerMinute)}</div>
            </div>
        </div>
    `;
}

function renderThroughputOccupancyPlot(rows, capacities) {
    const container = document.getElementById('throughput-occupancy-plot');
    if (!container) return;

    const stages = [
        {
            key: 'sampling',
            label: 'Sampling',
            color: '#3b82f6',
            startKey: 'samplingStartedAt',
            endKey: 'samplingFinishedAt',
            capacity: capacities.sampling,
        },
        {
            key: 'evaluation',
            label: 'Evaluation',
            color: '#f59e0b',
            startKey: 'evaluationStartedAt',
            endKey: 'evaluationFinishedAt',
            capacity: capacities.evaluation,
        },
        {
            key: 'postprocess',
            label: 'Postprocess',
            color: '#10b981',
            startKey: 'postprocessStartedAt',
            endKey: 'postprocessFinishedAt',
            capacity: capacities.postprocess,
        }
    ];

    const activeTraces = [];
    const capacityTraces = [];
    let minStart = Infinity;
    let maxEnd = -Infinity;

    stages.forEach(stage => {
        const series = computeOccupancySeries(rows, stage.startKey, stage.endKey, stage.capacity);
        if (!series) return;
        minStart = Math.min(minStart, series.minStart);
        maxEnd = Math.max(maxEnd, series.maxEnd);
        activeTraces.push({
            x: series.x,
            y: series.y,
            name: `${stage.label} Active`,
            type: 'scatter',
            mode: 'lines',
            line: { color: stage.color, width: 2 },
        });
        capacityTraces.push({
            x: [series.minStart * 1000, series.maxEnd * 1000],
            y: [stage.capacity, stage.capacity],
            name: `${stage.label} Capacity`,
            type: 'scatter',
            mode: 'lines',
            line: { color: stage.color, width: 1, dash: 'dash' },
            opacity: 0.45,
        });
    });

    const traces = [...activeTraces, ...capacityTraces];

    if (!traces.length) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No occupancy data available.</p>';
        return;
    }

    Plotly.newPlot('throughput-occupancy-plot', traces, {
        xaxis: { title: 'Wall Clock Time', type: 'date' },
        yaxis: { title: 'Active Workers', rangemode: 'tozero' },
        height: 360,
        margin: { l: 60, r: 20, t: 50, b: 50 },
        legend: { orientation: 'h', x: 0.01, y: 1.18 },
        hovermode: 'x unified',
    }, { responsive: true, displayModeBar: false });
}

function renderThroughputOccupancyPercentPlot(rows, capacities) {
    const container = document.getElementById('throughput-occupancy-percent-plot');
    if (!container) return;

    const stages = [
        {
            label: 'Sampling',
            color: '#3b82f6',
            startKey: 'samplingStartedAt',
            endKey: 'samplingFinishedAt',
            capacity: capacities.sampling,
        },
        {
            label: 'Evaluation',
            color: '#f59e0b',
            startKey: 'evaluationStartedAt',
            endKey: 'evaluationFinishedAt',
            capacity: capacities.evaluation,
        },
        {
            label: 'Postprocess',
            color: '#10b981',
            startKey: 'postprocessStartedAt',
            endKey: 'postprocessFinishedAt',
            capacity: capacities.postprocess,
        }
    ];

    const traces = [];
    let minStart = Infinity;
    let maxEnd = -Infinity;

    stages.forEach(stage => {
        const series = computeOccupancySeries(rows, stage.startKey, stage.endKey, stage.capacity);
        if (!series || !Number.isFinite(stage.capacity) || stage.capacity <= 0) return;
        minStart = Math.min(minStart, series.minStart);
        maxEnd = Math.max(maxEnd, series.maxEnd);
        traces.push({
            x: series.x,
            y: series.y.map(value => (value / stage.capacity) * 100),
            name: `${stage.label} Util.`,
            type: 'scatter',
            mode: 'lines',
            line: { color: stage.color, width: 2 },
        });
    });

    if (!traces.length) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No normalized occupancy data available.</p>';
        return;
    }

    traces.push({
        x: [minStart * 1000, maxEnd * 1000],
        y: [100, 100],
        name: '100% Cap.',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#6b7280', width: 1, dash: 'dot' },
        opacity: 0.6,
    });

    Plotly.newPlot('throughput-occupancy-percent-plot', traces, {
        xaxis: { title: 'Wall Clock Time', type: 'date' },
        yaxis: {
            title: 'Occupancy (%)',
            range: [0, 105],
            ticksuffix: '%',
        },
        height: 320,
        margin: { l: 60, r: 20, t: 50, b: 50 },
        legend: { orientation: 'h', x: 0.01, y: 1.12, font: { size: 11 } },
        hovermode: 'x unified',
    }, { responsive: true, displayModeBar: false });
}

function renderThroughputEvalDistributionPlot(rows, capacities) {
    const container = document.getElementById('throughput-eval-distribution-plot');
    if (!container) return;

    const series = computeOccupancySeries(rows, 'evaluationStartedAt', 'evaluationFinishedAt', capacities.evaluation);
    if (!series) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No evaluation occupancy data available.</p>';
        return;
    }

    const x = Array.from({ length: capacities.evaluation + 1 }, (_, idx) => idx);
    const y = x.map(count => {
        const duration = series.durationByCount.get(count) || 0;
        return series.totalDuration > 0 ? (duration / series.totalDuration) * 100 : 0;
    });

    Plotly.newPlot('throughput-eval-distribution-plot', [{
        x,
        y,
        type: 'bar',
        marker: {
            color: x.map(count => count === capacities.evaluation ? '#f59e0b' : '#60a5fa'),
        },
    }], {
        xaxis: {
            title: 'Occupied Evaluation Workers',
            tickfont: { size: 10 },
            titlefont: { size: 11 },
        },
        yaxis: {
            title: 'Wall-Clock Share (%)',
            rangemode: 'tozero',
            tickfont: { size: 10 },
            titlefont: { size: 11 },
        },
        height: 240,
        margin: { l: 50, r: 10, t: 30, b: 38 },
    }, { responsive: true, displayModeBar: false });
}

function renderThroughputCompletionRatePlot(rows) {
    const container = document.getElementById('throughput-completion-rate-plot');
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No completion data available.</p>';
        return;
    }

    const bucketSeconds = 60;
    const minStart = Math.min(...rows.map(row => row.evaluationFinishedAt));
    const buckets = new Map();
    rows.forEach(row => {
        const bucketStart = Math.floor((row.evaluationFinishedAt - minStart) / bucketSeconds) * bucketSeconds + minStart;
        buckets.set(bucketStart, (buckets.get(bucketStart) || 0) + 1);
    });

    const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    Plotly.newPlot('throughput-completion-rate-plot', [{
        x: sorted.map(([bucketStart]) => bucketStart * 1000),
        y: sorted.map(([, count]) => count),
        type: 'bar',
        marker: { color: '#34d399' },
        name: 'Evaluations / Minute',
    }], {
        xaxis: {
            title: 'Wall Clock Time',
            type: 'date',
            tickfont: { size: 10 },
            titlefont: { size: 11 },
        },
        yaxis: {
            title: 'Completed Evaluations',
            rangemode: 'tozero',
            tickfont: { size: 10 },
            titlefont: { size: 11 },
        },
        height: 240,
        margin: { l: 50, r: 10, t: 30, b: 38 },
    }, { responsive: true, displayModeBar: false });
}

function renderThroughputDurationTable(rows) {
    const container = document.getElementById('throughput-duration-table');
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = '<p style="text-align: center; color: #999;">No duration data available.</p>';
        return;
    }

    const stages = [
        ['Sampling', rows.map(row => row.samplingSeconds)],
        ['Evaluation', rows.map(row => row.evaluationSeconds)],
        ['Postprocess', rows.map(row => row.postprocessSeconds)],
    ];

    const rowsHtml = stages.map(([label, values]) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${label}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatRuntimeSeconds(percentile(values, 50))}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatRuntimeSeconds(percentile(values, 95))}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${formatRuntimeSeconds(Math.max(...values))}</td>
        </tr>
    `).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 8px; text-align: left;">Stage</th>
                    <th style="padding: 8px; text-align: right;">p50</th>
                    <th style="padding: 8px; text-align: right;">p95</th>
                    <th style="padding: 8px; text-align: right;">max</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
}

function renderThroughputUtilizationTable(rows, capacities) {
    const container = document.getElementById('throughput-utilization-table');
    if (!container) return;

    const stageConfigs = [
        ['Sampling', computeOccupancySeries(rows, 'samplingStartedAt', 'samplingFinishedAt', capacities.sampling), capacities.sampling],
        ['Evaluation', computeOccupancySeries(rows, 'evaluationStartedAt', 'evaluationFinishedAt', capacities.evaluation), capacities.evaluation],
        ['Postprocess', computeOccupancySeries(rows, 'postprocessStartedAt', 'postprocessFinishedAt', capacities.postprocess), capacities.postprocess],
    ];

    const rowsHtml = stageConfigs.map(([label, series, capacity]) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${label}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${capacity}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${series ? formatThroughputValue(series.avgOccupied) : 'N/A'}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${series ? formatThroughputPercent(series.utilizationPct) : 'N/A'}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${series ? formatThroughputPercent(series.fullOccupancyPct) : 'N/A'}</td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${series ? formatThroughputPercent(series.idlePct) : 'N/A'}</td>
        </tr>
    `).join('');

    container.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 8px; text-align: left;">Pool</th>
                    <th style="padding: 8px; text-align: right;">Cap.</th>
                    <th style="padding: 8px; text-align: right;">Avg Occupied</th>
                    <th style="padding: 8px; text-align: right;">Util.</th>
                    <th style="padding: 8px; text-align: right;">Full</th>
                    <th style="padding: 8px; text-align: right;">Idle</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
}

export function updateThroughputTab(selectedNodeId = null) {
    const throughputTab = document.getElementById('throughput');
    if (!throughputTab) {
        return;
    }

    if (!window.treeData || window.treeData.length === 0) {
        const summary = document.getElementById('throughput-summary');
        if (summary) {
            summary.innerHTML = '<p style="text-align: center; color: #999;">No throughput data available. Please load a database.</p>';
        }
        return;
    }

    const poolData = getPoolRuntimeTimelineData(window.treeData);
    if (!poolData || !poolData.rows.length) {
        const summary = document.getElementById('throughput-summary');
        if (summary) {
            summary.innerHTML = '<p style="text-align: center; color: #999;">No pool-based runtime data available.</p>';
        }
        ['throughput-runtime-plot', 'throughput-occupancy-plot', 'throughput-occupancy-percent-plot', 'throughput-eval-distribution-plot', 'throughput-completion-rate-plot', 'throughput-duration-table', 'throughput-utilization-table'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<p style="text-align: center; color: #999;">No throughput data available.</p>';
        });
        return;
    }

    renderThroughputSummary(poolData.rows, poolData.capacities);
    renderRuntimeTimelinePlot(window.treeData, selectedNodeId, 'throughput-runtime-summary', 'throughput-runtime-plot');
    setThroughputRuntimePlotVisibility(window.isThroughputRuntimePlotVisible);
    renderThroughputOccupancyPlot(poolData.rows, poolData.capacities);
    renderThroughputOccupancyPercentPlot(poolData.rows, poolData.capacities);
    renderThroughputEvalDistributionPlot(poolData.rows, poolData.capacities);
    renderThroughputCompletionRatePlot(poolData.rows);
    renderThroughputDurationTable(poolData.rows);
    renderThroughputUtilizationTable(poolData.rows, poolData.capacities);
}
