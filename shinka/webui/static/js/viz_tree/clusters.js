// Clusters tab: PCA scatter plots.
import { debug } from '../log.js';
import { formatScore } from './format.js';
import { selectNodeById } from './selection.js';

export function createClusterPlots(data) {
    debug("[DEBUG] Creating cluster plots");
    
    // Check if the clusters tab is visible
    const clustersView = document.getElementById('clusters-view');
    if (!clustersView || !clustersView.classList.contains('active')) {
        debug("[DEBUG] Clusters view not active, skipping visualization creation");
        return;
    }
    
    const programsWithEmbeddings = data.filter(p =>
        p.correct &&
        p.embedding_pca_2d && p.embedding_pca_2d.length === 2 &&
        p.embedding_pca_3d && p.embedding_pca_3d.length === 3 &&
        p.embedding_cluster_id !== null && p.combined_score !== null
    );

    if (programsWithEmbeddings.length === 0) {
        document.getElementById('cluster-plot-2d').innerHTML = '<p>No programs with PCA embeddings and cluster IDs found.</p>';
        document.getElementById('cluster-plot-3d').innerHTML = '';
        return;
    }

    const plotContainer2d = document.getElementById('cluster-plot-2d');
    const plotContainer3d = document.getElementById('cluster-plot-3d');
    if (plotContainer2d && plotContainer3d) {
        const containerWidth = plotContainer2d.getBoundingClientRect().width;
        plotContainer2d.style.height = `${containerWidth}px`;
        plotContainer3d.style.height = `${containerWidth}px`;
    }

    const scores = programsWithEmbeddings.map(p => p.combined_score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    
    const bestProgram = programsWithEmbeddings.reduce((best, current) => (current.combined_score > best.combined_score) ? current : best, programsWithEmbeddings[0]);

    const sizeScale = score => {
        if (maxScore === minScore) return 10;
        return 5 + 15 * (score - minScore) / (maxScore - minScore);
    };
    const sizes = programsWithEmbeddings.map(p => sizeScale(p.combined_score));
    const symbols = programsWithEmbeddings.map(p => p.id === bestProgram.id ? 'star' : 'circle');
    const symbols3d = programsWithEmbeddings.map(p => p.id === bestProgram.id ? 'diamond' : 'circle');
    const borderColors = programsWithEmbeddings.map(p => p.id === bestProgram.id ? 'gold' : 'white');
    const borderWidths = programsWithEmbeddings.map(p => p.id === bestProgram.id ? 3 : 1);

    const uniqueClusterIds = [...new Set(programsWithEmbeddings.map(p => p.embedding_cluster_id))].sort((a,b) => a - b);

    // 2D Plot
    const trace2d = {
        x: programsWithEmbeddings.map(p => p.embedding_pca_2d[0]),
        y: programsWithEmbeddings.map(p => p.embedding_pca_2d[1]),
        customdata: programsWithEmbeddings.map(p => p.id),
        mode: 'markers',
        type: 'scatter',
        text: programsWithEmbeddings.map(p => `<b>${p.metadata.patch_name || 'unnamed'}</b><br>Score: ${formatScore(p.combined_score)}<br>Cluster: ${p.embedding_cluster_id}`),
        hoverinfo: 'text',
        marker: {
            color: programsWithEmbeddings.map(p => p.embedding_cluster_id),
            colorscale: 'Portland',
            showscale: false,
            size: sizes,
            symbol: symbols3d,
            line: {
                color: borderColors,
                width: borderWidths
            }
        }
    };

    const layout2d = {
        title: '2D PCA of Program Embeddings',
        xaxis: { title: 'PC1' },
        yaxis: { 
            title: 'PC2',
            scaleanchor: 'x',
            scaleratio: 1
        },
        margin: { t: 40, b: 40, l: 40, r: 10 },
        paper_bgcolor: '#f8f9fa',
        plot_bgcolor: '#f8f9fa'
    };

    Plotly.newPlot('cluster-plot-2d', [trace2d], layout2d, {responsive: true});

    document.getElementById('cluster-plot-2d').on('plotly_click', function(data) {
        if (data.points.length > 0) {
            const nodeId = data.points[0].customdata;
            if (nodeId) {
                selectNodeById(nodeId, false);
            }
        }
    });

    // 3D Plot
    const trace3d = {
        x: programsWithEmbeddings.map(p => p.embedding_pca_3d[0]),
        y: programsWithEmbeddings.map(p => p.embedding_pca_3d[1]),
        z: programsWithEmbeddings.map(p => p.embedding_pca_3d[2]),
        customdata: programsWithEmbeddings.map(p => p.id),
        mode: 'markers',
        type: 'scatter3d',
        text: programsWithEmbeddings.map(p => `<b>${p.metadata.patch_name || 'unnamed'}</b><br>Score: ${formatScore(p.combined_score)}<br>Cluster: ${p.embedding_cluster_id}`),
        hoverinfo: 'text',
        marker: {
            color: programsWithEmbeddings.map(p => p.embedding_cluster_id),
            colorscale: 'Portland',
            showscale: true,
            size: sizes,
            symbol: symbols3d,
            line: {
                color: borderColors,
                width: borderWidths
            },
            colorbar: {
                title: 'C-ID',
                tickvals: uniqueClusterIds,
                ticktext: uniqueClusterIds,
                len: 0.4,
                y: 0.5,
                yanchor: 'middle'
            }
        }
    };

    const layout3d = {
        title: '3D PCA of Program Embeddings',
        scene: {
            xaxis: { title: 'PC1' },
            yaxis: { title: 'PC2' },
            zaxis: { title: 'PC3' },
            camera: { eye: {x: 2., y: 2., z: 2.} }
        },
        margin: { t: 40, b: 0, l: 10, r: 0 },
        paper_bgcolor: '#f8f9fa'
    };

    Plotly.newPlot('cluster-plot-3d', [trace3d], layout3d, {responsive: true});

    document.getElementById('cluster-plot-3d').on('plotly_click', function(data) {
        if (data.points.length > 0) {
            const nodeId = data.points[0].customdata;
            if (nodeId) {
                selectNodeById(nodeId, false);
            }
        }
    });

    const legendContainer = document.getElementById('size-legend-container');
    legendContainer.innerHTML = ''; // Clear previous

    if (maxScore > minScore) {
        const legendTitle = document.createElement('h5');
        legendTitle.style.margin = '0 0 5px 0';
        legendTitle.style.fontSize = '11px';
        legendTitle.textContent = 'Score (size)';
        legendContainer.appendChild(legendTitle);

        const legendItems = document.createElement('div');
        legendItems.style.display = 'flex';
        legendItems.style.justifyContent = 'center';
        legendItems.style.alignItems = 'flex-end';
        legendItems.style.gap = '15px';

        const midScore = (minScore + maxScore) / 2;
        const legendScores = [minScore, midScore, maxScore];
        
        legendScores.forEach(score => {
            const item = document.createElement('div');
            item.style.textAlign = 'center';
            item.style.display = 'flex';
            item.style.flexDirection = 'column';
            item.style.alignItems = 'center';

            const circle = document.createElement('div');
            const diameter = sizeScale(score);
            circle.style.width = `${diameter}px`;
            circle.style.height = `${diameter}px`;
            circle.style.backgroundColor = '#888';
            circle.style.borderRadius = '50%';
            
            const label = document.createElement('span');
            label.style.fontSize = '10px';
            label.style.marginTop = '4px';
            label.textContent = score.toFixed(2);

            item.appendChild(circle);
            item.appendChild(label);
            legendItems.appendChild(item);
        });

        legendContainer.appendChild(legendItems);
    }
}
