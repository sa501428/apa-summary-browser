const BASE_URL = 'https://s3.us-central-1.wasabisys.com/aiden-encode-hic-mirror/apa-heatmaps/';
const VERSIONS = ['v27-1'];
let currentVersion = 'v27-1';

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

function createHeatmap(data, colorScheme) {
    const canvas = document.getElementById('heatmap_canvas');
    resizeCanvasToDisplaySize(canvas);
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Scale for crispness

    const rowNames = Object.keys(data);
    const colNames = Object.keys(data[rowNames[0]]);
    const numRows = rowNames.length;
    const numCols = colNames.length;

    // Clamp pan to bounds
    const displayWidth = canvas.width / dpr;
    const displayHeight = canvas.height / dpr;
    panX = Math.max(0, Math.min(panX, numCols * CELL_SIZE - displayWidth));
    panY = Math.max(0, Math.min(panY, numRows * CELL_SIZE - displayHeight));

    // Color scale
    const values = rowNames.flatMap(row => colNames.map(col => data[row][col] || 0));
    const colorScale = colorScales[colorScheme].domain([colorMin, colorMax]);

    // Draw only visible cells
    const startCol = Math.floor(panX / CELL_SIZE);
    const startRow = Math.floor(panY / CELL_SIZE);
    const endCol = Math.min(numCols, Math.ceil((panX + displayWidth) / CELL_SIZE));
    const endRow = Math.min(numRows, Math.ceil((panY + displayHeight) / CELL_SIZE));

    for (let i = startRow; i < endRow; i++) {
        for (let j = startCol; j < endCol; j++) {
            const value = data[rowNames[i]][colNames[j]] || 0;
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
            const value = data[rowNames[row]][colNames[col]] || 0;
            tooltip.transition().duration(50).style('opacity', 1);
            tooltip.html(`${rowNames[row]} vs ${colNames[col]}<br/>Value: ${value.toFixed(4)}`)
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
    if (dataCache[dist]) {
        createHeatmap(dataCache[dist], colorScheme);
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