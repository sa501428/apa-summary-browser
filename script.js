const BASE_URL = 'https://s3.us-central-1.wasabisys.com/aiden-encode-hic-mirror/apa-heatmaps/';
const VERSIONS = ['v27-1','v27-2'];
let currentVersion = 'v27-2';

// Cache for JSON data
const dataCache = {
    'intra.short': null,
    'intra.long': null,
    'inter': null
};

// Color scales - using memoized scales for better performance
const colorScales = {
    red: d3.scaleSequential(d3.interpolateReds),
    blue: d3.scaleSequential(d3.interpolateBlues),
    green: d3.scaleSequential(d3.interpolateGreens)
};

// Create tooltip div
const tooltip = d3.select('body').append('div')
    .attr('class', 'tooltip')
    .style('opacity', 0);

// Configuration for virtual rendering
const CHUNK_SIZE = 50; // Number of rows/columns to render at once
let currentChunk = { x: 0, y: 0 };
let isRendering = false;

let CELL_SIZE = 5; // Default cell size
let panX = 0;
let panY = 0;
let isPanning = false;
let startPan = {x: 0, y: 0};
let minCellSize = 2;
let maxCellSize = 40;

let currentOrder = null; // Array of indices for current row/col order
let originalOrder = null; // Store the original order for 'None'

// Debounce function to limit rapid updates
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Modal and control logic
function showModal(id) {
    document.getElementById(id).style.display = 'block';
}
function hideModal(id) {
    document.getElementById(id).style.display = 'none';
}

// Show/hide controls modal
const openControlsBtn = document.getElementById('open-controls');
const controlsModal = document.getElementById('controls-modal');
const closeControlsBtn = document.getElementById('close-controls');
openControlsBtn.onclick = () => showModal('controls-modal');
closeControlsBtn.onclick = () => hideModal('controls-modal');
window.onclick = function(event) {
    if (event.target === controlsModal) hideModal('controls-modal');
};

// Show/hide loading modal
function showLoading() { showModal('loading-modal'); }
function hideLoading() { hideModal('loading-modal'); }

// Color scale min/max
let colorMin = null;
let colorMax = null;

function updateColorMinMax(values) {
    // If user has not set min/max, use data min/max
    const minInput = document.getElementById('minColor');
    const maxInput = document.getElementById('maxColor');
    if (!minInput.value) minInput.value = d3.min(values);
    if (!maxInput.value) maxInput.value = d3.max(values);
    colorMin = parseFloat(minInput.value);
    colorMax = parseFloat(maxInput.value);
}

function getDataUrl(dist) {
    return `${BASE_URL}${currentVersion}/apa_scores_${dist}_lookup.json`;
}

function createColorScale(values, colorScheme) {
    updateColorMinMax(values);
    const colorScale = colorScales[colorScheme].domain([colorMin, colorMax]);
    // Draw color scale legend in overlay
    const overlay = document.getElementById('color-scale-overlay');
    overlay.innerHTML = '';
    const svg = d3.select(overlay)
        .append('svg')
        .attr('width', 200)
        .attr('height', 40);
    const defs = svg.append('defs');
    const linearGradient = defs.append('linearGradient')
        .attr('id', 'color-gradient')
        .attr('x1', '0%')
        .attr('y1', '0%')
        .attr('x2', '100%')
        .attr('y2', '0%');
    const stops = [0, 0.25, 0.5, 0.75, 1];
    stops.forEach(stop => {
        linearGradient.append('stop')
            .attr('offset', `${stop * 100}%`)
            .attr('stop-color', colorScale(colorMin + stop * (colorMax - colorMin)));
    });
    svg.append('rect')
        .attr('width', 200)
        .attr('height', 20)
        .attr('y', 0)
        .style('fill', 'url(#color-gradient)');
    const scaleValues = [colorMin, colorMin + 0.25 * (colorMax - colorMin), colorMin + 0.5 * (colorMax - colorMin), colorMin + 0.75 * (colorMax - colorMin), colorMax];
    svg.selectAll('.scale-value')
        .data(scaleValues)
        .enter()
        .append('text')
        .attr('class', 'scale-value')
        .attr('x', (d, i) => i * 50)
        .attr('y', 35)
        .attr('text-anchor', 'middle')
        .text(d => d.toFixed(3));
    svg.append('text')
        .attr('class', 'scale-label')
        .attr('x', 0)
        .attr('y', 15)
        .attr('text-anchor', 'start')
        .text('Min');
    svg.append('text')
        .attr('class', 'scale-label')
        .attr('x', 200)
        .attr('y', 15)
        .attr('text-anchor', 'end')
        .text('Max');
    return colorScale;
}

function getVisibleChunk(scrollX, scrollY, cellSize, numRows, numCols) {
    const startX = Math.floor(scrollX / cellSize);
    const startY = Math.floor(scrollY / cellSize);
    return {
        x: Math.max(0, startX),
        y: Math.max(0, startY)
    };
}

function renderChunk(data, colorScale, cellSize, chunk, svg, rowNames, colNames) {
    const startX = chunk.x;
    const startY = chunk.y;
    const endX = Math.min(startX + CHUNK_SIZE, colNames.length);
    const endY = Math.min(startY + CHUNK_SIZE, rowNames.length);

    // Create cells for this chunk
    const cellData = [];
    for (let i = startY; i < endY; i++) {
        for (let j = startX; j < endX; j++) {
            const row = rowNames[i];
            const col = colNames[j];
            cellData.push({
                row,
                col,
                value: data[row][col] || 0,
                x: j * cellSize,
                y: i * cellSize
            });
        }
    }

    // Update cells
    const cellGroup = svg.select('.cells');
    cellGroup.selectAll('rect')
        .data(cellData, d => `${d.row}-${d.col}`)
        .join('rect')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('width', cellSize)
        .attr('height', cellSize)
        .attr('fill', d => colorScale(d.value))
        .style('stroke', '#fff')
        .style('stroke-width', 0.5)
        .on('mouseover', function(event, d) {
            tooltip.transition()
                .duration(50)
                .style('opacity', 1);
            tooltip.html(`${d.row} vs ${d.col}<br/>Value: ${d.value.toFixed(4)}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', function() {
            tooltip.transition()
                .duration(50)
                .style('opacity', 0);
        });
}

function resizeCanvasToDisplaySize(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
    }
}

function getDistanceMatrix(data, order) {
    // Use 1 - normalized value as distance
    const n = order.length;
    const matrix = Array.from({length: n}, () => Array(n).fill(0));
    let maxVal = -Infinity, minVal = Infinity;
    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < n; ++j) {
            const v = data[order[i]][order[j]] || 0;
            if (v > maxVal) maxVal = v;
            if (v < minVal) minVal = v;
        }
    }
    for (let i = 0; i < n; ++i) {
        for (let j = 0; j < n; ++j) {
            const v = data[order[i]][order[j]] || 0;
            matrix[i][j] = 1 - (v - minVal) / (maxVal - minVal + 1e-9);
        }
    }
    return matrix;
}

function hierarchicalClustering(order, data, linkage) {
    // Simple agglomerative clustering (O(n^3), fine for n=700)
    // linkage: 'ward' or 'average'
    const n = order.length;
    let clusters = order.map((idx, i) => [i]);
    const dist = getDistanceMatrix(data, order);
    let active = Array.from({length: n}, (_, i) => i);
    function clusterDist(a, b) {
        if (linkage === 'average') {
            let sum = 0, count = 0;
            for (const i of clusters[a]) for (const j of clusters[b]) {
                sum += dist[i][j]; count++;
            }
            return sum / count;
        } else if (linkage === 'ward') {
            // Use average for simplicity
            let sum = 0, count = 0;
            for (const i of clusters[a]) for (const j of clusters[b]) {
                sum += dist[i][j]; count++;
            }
            return sum / count;
        }
        return 0;
    }
    while (active.length > 1) {
        let minD = Infinity, minA = -1, minB = -1;
        for (let i = 0; i < active.length; ++i) {
            for (let j = i + 1; j < active.length; ++j) {
                const d = clusterDist(active[i], active[j]);
                if (d < minD) {
                    minD = d; minA = i; minB = j;
                }
            }
        }
        // Merge clusters
        clusters[active[minA]] = clusters[active[minA]].concat(clusters[active[minB]]);
        active.splice(minB, 1);
    }
    return clusters[active[0]];
}

function spectralOrder(order, data) {
    // Simple spectral ordering using Laplacian and Fiedler vector
    const n = order.length;
    const matrix = getDistanceMatrix(data, order);
    // Build Laplacian
    const L = Array.from({length: n}, () => Array(n).fill(0));
    for (let i = 0; i < n; ++i) {
        let rowSum = 0;
        for (let j = 0; j < n; ++j) {
            if (i !== j) {
                L[i][j] = -matrix[i][j];
                rowSum += matrix[i][j];
            }
        }
        L[i][i] = rowSum;
    }
    // Power iteration for Fiedler vector
    let v = Array(n).fill(0).map((_, i) => Math.random());
    for (let iter = 0; iter < 100; ++iter) {
        let vNew = Array(n).fill(0);
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < n; ++j) {
                vNew[i] += L[i][j] * v[j];
            }
        }
        const norm = Math.sqrt(vNew.reduce((a, b) => a + b * b, 0));
        v = vNew.map(x => x / (norm + 1e-9));
    }
    // Sort by Fiedler vector
    return order.map((idx, i) => [idx, v[i]]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
}

function randomOrder(order) {
    const arr = order.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function louvainClustering(order, data) {
    // Simple greedy modularity-based community detection (approximate)
    // Assign each node to its own community, then merge for max modularity
    // For demo, just group by sum of row values (not true Louvain)
    const n = order.length;
    const scores = order.map(idx => {
        let sum = 0;
        for (let j = 0; j < n; ++j) sum += data[idx][order[j]] || 0;
        return [idx, sum];
    });
    scores.sort((a, b) => b[1] - a[1]);
    return scores.map(x => x[0]);
}

function labelPropagation(order, data) {
    // Simple label propagation: assign each node to the label of its max neighbor
    // For demo, just sort by max value in row
    const n = order.length;
    const scores = order.map(idx => {
        let max = 0;
        for (let j = 0; j < n; ++j) max = Math.max(max, data[idx][order[j]] || 0);
        return [idx, max];
    });
    scores.sort((a, b) => b[1] - a[1]);
    return scores.map(x => x[0]);
}

function modularityMaximization(order, data) {
    // For demo, sort by sum of row minus sum of col (not true modularity)
    const n = order.length;
    const scores = order.map(idx => {
        let sumRow = 0, sumCol = 0;
        for (let j = 0; j < n; ++j) {
            sumRow += data[idx][order[j]] || 0;
            sumCol += data[order[j]][idx] || 0;
        }
        return [idx, sumRow - sumCol];
    });
    scores.sort((a, b) => b[1] - a[1]);
    return scores.map(x => x[0]);
}

function affinityPropagation(order, data) {
    // Not practical for 700x700 in JS; use a random shuffle as a placeholder
    return randomOrder(order);
}

function nmfClustering(order, data) {
    // Simple NMF: use sum of row as a proxy for factorization
    const n = order.length;
    const scores = order.map(idx => {
        let sum = 0;
        for (let j = 0; j < n; ++j) sum += data[idx][order[j]] || 0;
        return [idx, sum];
    });
    scores.sort((a, b) => b[1] - a[1]);
    return scores.map(x => x[0]);
}

function kmeansSpectral(order, data, k = 5) {
    // Use spectral embedding (top 2 eigenvectors) and k-means
    const n = order.length;
    const matrix = getDistanceMatrix(data, order);
    // Build Laplacian
    const L = Array.from({length: n}, () => Array(n).fill(0));
    for (let i = 0; i < n; ++i) {
        let rowSum = 0;
        for (let j = 0; j < n; ++j) {
            if (i !== j) {
                L[i][j] = -matrix[i][j];
                rowSum += matrix[i][j];
            }
        }
        L[i][i] = rowSum;
    }
    // Power iteration for top 2 eigenvectors
    let v1 = Array(n).fill(0).map(() => Math.random());
    let v2 = Array(n).fill(0).map(() => Math.random());
    for (let iter = 0; iter < 50; ++iter) {
        let v1New = Array(n).fill(0);
        let v2New = Array(n).fill(0);
        for (let i = 0; i < n; ++i) {
            for (let j = 0; j < n; ++j) {
                v1New[i] += L[i][j] * v1[j];
                v2New[i] += L[i][j] * v2[j];
            }
        }
        let norm1 = Math.sqrt(v1New.reduce((a, b) => a + b * b, 0));
        let norm2 = Math.sqrt(v2New.reduce((a, b) => a + b * b, 0));
        v1 = v1New.map(x => x / (norm1 + 1e-9));
        v2 = v2New.map(x => x / (norm2 + 1e-9));
    }
    // k-means on (v1, v2)
    let centroids = [];
    for (let i = 0; i < k; ++i) {
        centroids.push([v1[Math.floor(i * n / k)], v2[Math.floor(i * n / k)]]);
    }
    let labels = Array(n).fill(0);
    for (let iter = 0; iter < 10; ++iter) {
        // Assign
        for (let i = 0; i < n; ++i) {
            let minDist = Infinity, minIdx = 0;
            for (let j = 0; j < k; ++j) {
                let dx = v1[i] - centroids[j][0];
                let dy = v2[i] - centroids[j][1];
                let d = dx * dx + dy * dy;
                if (d < minDist) { minDist = d; minIdx = j; }
            }
            labels[i] = minIdx;
        }
        // Update
        let sums = Array.from({length: k}, () => [0, 0, 0]);
        for (let i = 0; i < n; ++i) {
            sums[labels[i]][0] += v1[i];
            sums[labels[i]][1] += v2[i];
            sums[labels[i]][2] += 1;
        }
        for (let j = 0; j < k; ++j) {
            if (sums[j][2] > 0) {
                centroids[j][0] = sums[j][0] / sums[j][2];
                centroids[j][1] = sums[j][1] / sums[j][2];
            }
        }
    }
    // Order by cluster, then by v1
    return order.map((idx, i) => [idx, labels[i], v1[i]]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(x => x[0]);
}

function applyClustering(method, data, rowNames) {
    if (!originalOrder) originalOrder = rowNames.slice();
    let order = originalOrder.slice();
    if (method === 'none') {
        return order;
    } else if (method === 'random') {
        return randomOrder(order);
    } else if (method === 'ward') {
        return hierarchicalClustering(order, data, 'ward').map(i => order[i]);
    } else if (method === 'average') {
        return hierarchicalClustering(order, data, 'average').map(i => order[i]);
    } else if (method === 'spectral') {
        return spectralOrder(order, data);
    } else if (method === 'louvain') {
        return louvainClustering(order, data);
    } else if (method === 'labelprop') {
        return labelPropagation(order, data);
    } else if (method === 'modularity') {
        return modularityMaximization(order, data);
    } else if (method === 'affinity') {
        return affinityPropagation(order, data);
    } else if (method === 'nmf') {
        return nmfClustering(order, data);
    } else if (method === 'kmeans') {
        return kmeansSpectral(order, data, 5);
    }
    return order;
}

function createHeatmap(data, colorScheme) {
    const canvas = document.getElementById('heatmap_canvas');
    resizeCanvasToDisplaySize(canvas);
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Scale for crispness

    const rowNames = Object.keys(data);
    const numRows = rowNames.length;
    const numCols = numRows; // Always square, use same order for both

    // Clustering order
    if (!currentOrder || currentOrder.length !== numRows) {
        currentOrder = rowNames.slice();
    }

    // Clamp pan to bounds
    const displayWidth = canvas.width / dpr;
    const displayHeight = canvas.height / dpr;
    panX = Math.max(0, Math.min(panX, numCols * CELL_SIZE - displayWidth));
    panY = Math.max(0, Math.min(panY, numRows * CELL_SIZE - displayHeight));

    // Color scale
    const values = rowNames.flatMap(row => rowNames.map(col => data[row][col] || 0));
    const colorScale = colorScales[colorScheme].domain([colorMin, colorMax]);

    // Draw only visible cells
    const startCol = Math.floor(panX / CELL_SIZE);
    const startRow = Math.floor(panY / CELL_SIZE);
    const endCol = Math.min(numCols, Math.ceil((panX + displayWidth) / CELL_SIZE));
    const endRow = Math.min(numRows, Math.ceil((panY + displayHeight) / CELL_SIZE));

    for (let i = startRow; i < endRow; i++) {
        for (let j = startCol; j < endCol; j++) {
            const rowIdx = currentOrder[i];
            const colIdx = currentOrder[j];
            const value = data[rowIdx][colIdx] || 0;
            ctx.fillStyle = colorScale(value);
            ctx.fillRect(j * CELL_SIZE - panX, i * CELL_SIZE - panY, CELL_SIZE, CELL_SIZE);
        }
    }

    // Mouse hover for tooltips (only for visible cells)
    canvas.onmousemove = function(event) {
        const rect = canvas.getBoundingClientRect();
        // Use display (CSS) pixels for hover logic
        const x = (event.clientX - rect.left) + panX;
        const y = (event.clientY - rect.top) + panY;
        const col = Math.floor(x / CELL_SIZE);
        const row = Math.floor(y / CELL_SIZE);
        if (row >= 0 && row < numRows && col >= 0 && col < numCols) {
            const rowIdx = currentOrder[row];
            const colIdx = currentOrder[col];
            const value = data[rowIdx][colIdx] || 0;
            tooltip.transition().duration(50).style('opacity', 1);
            tooltip.html(`${rowIdx} vs ${colIdx}<br/>Value: ${value.toFixed(4)}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px');
        } else {
            tooltip.transition().duration(50).style('opacity', 0);
        }
    };
    canvas.onmouseleave = function() {
        tooltip.transition().duration(50).style('opacity', 0);
    };

    // Panning events
    canvas.onmousedown = function(event) {
        isPanning = true;
        startPan = {x: event.clientX, y: event.clientY, panX, panY};
        canvas.style.cursor = 'grabbing';
    };
    window.onmouseup = function() {
        isPanning = false;
        canvas.style.cursor = 'default';
    };
    window.onmousemove = function(event) {
        if (isPanning) {
            const dpr = window.devicePixelRatio || 1;
            panX = startPan.panX - (event.clientX - startPan.x);
            panY = startPan.panY - (event.clientY - startPan.y);
            // Clamp pan
            panX = Math.max(0, Math.min(panX, numCols * CELL_SIZE - displayWidth));
            panY = Math.max(0, Math.min(panY, numRows * CELL_SIZE - displayHeight));
            createHeatmap(data, colorScheme);
        }
    };

    // Mouse wheel zoom
    canvas.onwheel = function(event) {
        event.preventDefault();
        let oldCellSize = CELL_SIZE;
        if (event.deltaY < 0) {
            CELL_SIZE = Math.min(maxCellSize, CELL_SIZE + 1);
        } else {
            CELL_SIZE = Math.max(minCellSize, CELL_SIZE - 1);
        }
        // Adjust pan to zoom to mouse position
        const rect = canvas.getBoundingClientRect();
        const mouseX = (event.clientX - rect.left) * (canvas.width / rect.width);
        const mouseY = (event.clientY - rect.top) * (canvas.height / rect.height);
        const zoomFactor = CELL_SIZE / oldCellSize;
        panX = (panX + mouseX / dpr) * zoomFactor - mouseX / dpr;
        panY = (panY + mouseY / dpr) * zoomFactor - mouseY / dpr;
        // Clamp pan
        panX = Math.max(0, Math.min(panX, numCols * CELL_SIZE - displayWidth));
        panY = Math.max(0, Math.min(panY, numRows * CELL_SIZE - displayHeight));
        createHeatmap(data, colorScheme);
    };

    // Color scale legend (keep as SVG)
    createColorScale(values, colorScheme);
}

async function loadAllData() {
    showLoading();
    try {
        const distances = ['intra.short', 'intra.long', 'inter'];
        await Promise.all(distances.map(async (dist) => {
            const response = await fetch(getDataUrl(dist));
            if (!response.ok) throw new Error(`Failed to load ${dist} data`);
            const json = await response.json();
            dataCache[dist] = json.scores;
        }));
        hideLoading();
        updateHeatmap(); // Initial display
    } catch (error) {
        console.error('Error loading data:', error);
        hideLoading();
        alert('Error loading data. Please refresh the page.');
    }
}

// Debounced update function to prevent rapid re-renders
const updateHeatmap = debounce(() => {
    const dist = document.getElementById('distance').value;
    const colorScheme = document.getElementById('colorScheme').value;
    const clustering = document.getElementById('clustering').value;
    if (dataCache[dist]) {
        const data = dataCache[dist];
        const rowNames = Object.keys(data);
        if (!currentOrder || currentOrder.length !== rowNames.length) {
            currentOrder = applyClustering(clustering, data, rowNames);
        }
        createHeatmap(data, colorScheme);
    }
}, 100);

function switchVersion() {
    const versionSelect = document.getElementById('version');
    currentVersion = versionSelect.value;
    loadAllData(); // Reload all data for new version
}

// Redraw heatmap on control changes
function setupControlListeners() {
    document.getElementById('colorScheme').addEventListener('change', updateHeatmap);
    document.getElementById('distance').addEventListener('change', updateHeatmap);
    document.getElementById('version').addEventListener('change', switchVersion);
    document.getElementById('minColor').addEventListener('input', updateHeatmap);
    document.getElementById('maxColor').addEventListener('input', updateHeatmap);
    document.getElementById('clustering').addEventListener('change', () => {
        const dist = document.getElementById('distance').value;
        const clustering = document.getElementById('clustering').value;
        if (dataCache[dist]) {
            const data = dataCache[dist];
            const rowNames = Object.keys(data);
            currentOrder = applyClustering(clustering, data, rowNames);
            updateHeatmap();
        }
    });
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
    setupControlListeners();
    loadAllData();
    // Add zoom controls
    const zoomOverlay = document.createElement('div');
    zoomOverlay.id = 'zoom-controls-overlay';
    zoomOverlay.innerHTML = `
      <button id="zoom-in" title="Zoom In">+</button>
      <button id="zoom-out" title="Zoom Out">-</button>
    `;
    document.body.appendChild(zoomOverlay);
    document.getElementById('zoom-in').onclick = () => {
        CELL_SIZE = Math.min(maxCellSize, CELL_SIZE + 1);
        updateHeatmap();
    };
    document.getElementById('zoom-out').onclick = () => {
        CELL_SIZE = Math.max(minCellSize, CELL_SIZE - 1);
        updateHeatmap();
    };
});

// Redraw on resize
window.addEventListener('resize', () => {
    updateHeatmap();
}); 