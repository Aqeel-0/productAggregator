// AggreMart Control Center - Main Application
const socket = io();

// ─── Platform registry (single source of truth) ────────────────────────
const PLATFORMS = {
  amazon: { label: 'Amazon', logo: 'https://logo.clearbit.com/amazon.in' },
  flipkart: { label: 'Flipkart', logo: 'https://logo.clearbit.com/flipkart.com' },
  croma: { label: 'Croma', logo: 'https://logo.clearbit.com/croma.com' },
  reliance: { label: 'Reliance Digital', logo: 'https://logo.clearbit.com/reliancedigital.in' }
};

// ─── State ──────────────────────────────────────────────────────────────
const state = {
  platforms: {},
  currentFilter: 'all',
  startTimes: {}
};
Object.keys(PLATFORMS).forEach(p => {
  state.platforms[p] = { status: 'ready', products: 0, progress: 0, rawAvailable: false, normalizedAvailable: false, rawCount: 0, normalizedCount: 0, dbCount: 0 };
});

// ─── Config templates ───────────────────────────────────────────────────
const configTemplates = {
  amazon: { maxProducts: 500, maxPages: 100, maxConcurrent: 15, delayBetweenPages: 2000, headless: true },
  flipkart: { maxProducts: 450, totalMaxProducts: 600, maxPages: 50, maxConcurrent: 10, delayBetweenPages: 2000, headless: true, relatedProducts: { enabled: true, maxPerProduct: 2 } },
  croma: { maxProducts: 200, maxConcurrent: 6, delayBetweenPages: 3000, headless: true },
  reliance: { maxProducts: 300, maxPages: 60, maxConcurrent: 5, delayBetweenPages: 2000, headless: true }
};

// ─── Helpers ────────────────────────────────────────────────────────────
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
const $ = id => document.getElementById(id);
const statusLabels = { ready: 'Ready', scraping: 'Collecting...', normalizing: 'Processing...', completed: 'Done', error: 'Error', warning: 'Warning' };

// ─── Toast notifications ────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : type === 'warning' ? 'triangle-exclamation' : 'info-circle'}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 250); }, 4000);
}

// ─── Build platform cards dynamically ───────────────────────────────────
function renderPlatformCards() {
  const grid = $('platformsGrid');
  grid.innerHTML = '';
  Object.entries(PLATFORMS).forEach(([key, meta]) => {
    grid.insertAdjacentHTML('beforeend', `
      <div class="platform-card" id="card-${key}">
        <div class="card-head">
          <div class="card-identity">
            <img class="card-logo" src="${meta.logo}" alt="${meta.label}" onerror="this.style.display='none'">
            <span class="card-name">${meta.label}</span>
            <span class="card-badge ready" id="${key}-badge">Ready</span>
          </div>
          <div class="card-actions">
            <button onclick="showConfig('${key}')" title="Settings"><i class="fas fa-sliders"></i></button>
            <button class="btn-start" id="${key}-start-btn" onclick="startScraper('${key}')"><i class="fas fa-play"></i> Collect</button>
            <button class="btn-stop" id="${key}-stop-btn" onclick="stopScraper('${key}')" disabled><i class="fas fa-stop"></i> Stop</button>
            <button id="${key}-process-btn" onclick="processPlatform('${key}')"><i class="fas fa-wand-magic-sparkles"></i> Process</button>
            <button id="${key}-reset-btn" onclick="startFromScratch('${key}')"><i class="fas fa-arrow-rotate-left"></i> Reset</button>
            <button class="btn-delete" id="${key}-delete-btn" onclick="deletePlatformData('${key}')" title="Delete all ${meta.label} data"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="card-body">
          <div class="progress-row">
            <span class="progress-label" id="${key}-progress-text">Idle</span>
            <span class="progress-pct" id="${key}-progress-pct">0%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" id="${key}-progress-bar" style="width:0%"></div>
          </div>
          <div class="data-chips">
            <div class="data-chip" id="${key}-chip-raw"><i class="fas fa-file-lines"></i> Collected: <span class="chip-value" id="${key}-raw-val">--</span></div>
            <div class="data-chip" id="${key}-chip-norm"><i class="fas fa-check-double"></i> Processed: <span class="chip-value" id="${key}-norm-val">--</span></div>
            <div class="data-chip" id="${key}-chip-db"><i class="fas fa-database"></i> In DB: <span class="chip-value" id="${key}-db-val">0</span></div>
            <div class="duration-badge" id="${key}-duration"><i class="fas fa-stopwatch"></i> <span id="${key}-dur-text">--:--</span></div>
          </div>
          <div class="card-stats" id="${key}-stats" style="display:none">
            <div class="stats-header"><span class="stats-title">Last Run Stats</span><button class="stats-clear" onclick="clearStats('${key}')" title="Dismiss stats"><i class="fas fa-xmark"></i></button></div>
            <div class="stats-items" id="${key}-stats-items"></div>
          </div>
        </div>
      </div>
    `);
  });
}

// ─── Init ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderPlatformCards();
  updateSystemTime();
  setInterval(updateSystemTime, 1000);
  setInterval(updateDurations, 1000);
  checkDataAvailability();
  setInterval(checkDataAvailability, 5000);
  loadTheme();
});

// ─── Theme Toggle ─────────────────────────────────────────────────────────
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
}

function loadTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
  const icon = document.querySelector('.theme-toggle i');
  if (icon) {
    icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }
}

// ─── Socket connection ──────────────────────────────────────────────────
socket.on('connect', () => {
  updateConnectionStatus(true);
  addLog('info', 'Connected to server');
  restoreRunningState();
});

socket.on('disconnect', () => {
  updateConnectionStatus(false);
  addLog('error', 'Disconnected from server');
});

async function restoreRunningState() {
  try {
    const res = await fetch('/api/running');
    const running = await res.json();
    Object.entries(running).forEach(([platform, status]) => {
      if (platform !== '_database' && state.platforms[platform]) {
        setPlatformStatus(platform, status);
        state.startTimes[platform] = state.startTimes[platform] || Date.now();
      }
    });
  } catch (e) { /* ignore */ }
}

// ─── Socket events: scraper ─────────────────────────────────────────────
socket.on('scraper:start', ({ platform }) => {
  setPlatformStatus(platform, 'scraping');
  state.startTimes[platform] = Date.now();
  setProgressText(platform, 'Starting data collection...');
  addLog('info', `${PLATFORMS[platform].label} data collection started`);
});

socket.on('scraper:link-progress', ({ platform, links }) => {
  setProgressText(platform, `Finding products... (${links} found)`);
});

socket.on('scraper:product-progress', ({ platform, current, total, products }) => {
  const pct = Math.round((current / total) * 100);
  setProgressText(platform, `Collecting products (${current}/${total})`);
  updateProgress(platform, pct, products);
});

socket.on('scraper:stopped', ({ platform }) => {
  setPlatformStatus(platform, 'ready');
  setProgressText(platform, 'Stopped by user');
  addLog('warning', `${PLATFORMS[platform].label} collection stopped`);
  showToast(`${PLATFORMS[platform].label} collection stopped`, 'warning');
});

socket.on('scraper:cleaned', ({ platform }) => {
  const s = state.platforms[platform];
  s.rawAvailable = false; s.normalizedAvailable = false; s.products = 0; s.progress = 0;
  setPlatformStatus(platform, 'ready');
  updateProgress(platform, 0, 0);
  setProgressText(platform, 'Data cleared - ready to collect');
  addLog('info', `${PLATFORMS[platform].label} data cleared`);
  checkDataAvailability();
});

socket.on('scraper:complete', ({ platform, products, duration, fileSizeMb, memory }) => {
  setPlatformStatus(platform, 'completed');
  state.platforms[platform].products = products;
  state.platforms[platform].progress = 100;
  state.platforms[platform].rawAvailable = true;
  updateProgress(platform, 100, products);
  setProgressText(platform, `Collection complete \u2014 ${products} products`);
  addLog('success', `${PLATFORMS[platform].label} collected ${products} products`);
  showToast(`${PLATFORMS[platform].label}: ${products} products collected`, 'success');
  setStats(platform, { type: 'collect', products, duration, fileSizeMb, memory });
  checkDataAvailability();
});

socket.on('scraper:bot-warning', ({ platform, consecutiveNulls, hardThreshold }) => {
  setProgressText(platform, `⚠️ ${consecutiveNulls} consecutive nulls — retrying...`);
  addLog('warning', `${PLATFORMS[platform].label}: ${consecutiveNulls} consecutive null products detected. Retrying up to ${hardThreshold} before stopping abruptly.`);
});

socket.on('scraper:bot-detected', ({ platform, consecutiveNulls, totalNulls, totalAttempts }) => {
  setPlatformStatus(platform, 'error');
  setProgressText(platform, '⛔ Stopped abruptly');
  const msg = `${PLATFORMS[platform].label}: Stopped abruptly — persistent failure (${consecutiveNulls} consecutive nulls out of ${totalAttempts} attempted). Scraper halted.`;
  addLog('error', msg);
  showToast(msg, 'error');
  setErrorStats(platform, `Stopped abruptly after ${totalNulls}/${totalAttempts} null products`);
});

socket.on('scraper:error', ({ platform, error, memory }) => {
  setPlatformStatus(platform, 'error');
  setProgressText(platform, 'Collection failed');
  addLog('error', `${PLATFORMS[platform].label} collection failed: ${error}`);
  showToast(`${PLATFORMS[platform].label} collection failed`, 'error');
  setErrorStats(platform, error, memory);
});

// ─── Socket events: normalizer ──────────────────────────────────────────
socket.on('normalizer:start', ({ platform }) => {
  setPlatformStatus(platform, 'normalizing');
  setProgressText(platform, 'Processing data...');
  addLog('info', `${PLATFORMS[platform].label} data processing started`);
});

socket.on('normalizer:progress', ({ platform, current, total, label }) => {
  const pct = Math.round((current / total) * 100);
  const displayLabel = label || 'Processing data';
  setProgressText(platform, `${displayLabel} (${current}/${total})`);
  updateProgress(platform, pct, current);
});

socket.on('normalizer:complete', ({ platform, products, duration, fileSizeMb, normStats, validationResult }) => {
  const hasWarning = validationResult && !validationResult.success;
  setPlatformStatus(platform, hasWarning ? 'warning' : 'completed');
  state.platforms[platform].normalizedAvailable = true;
  state.platforms[platform].progress = 100;
  updateProgress(platform, 100, products);
  setProgressText(platform, `Processing complete \u2014 ${products} products`);
  
  if (hasWarning) {
    addLog('warning', `${PLATFORMS[platform].label} processed ${products} products, but validation failed! Check selectors.`);
    showToast(`${PLATFORMS[platform].label}: Validation warnings detected!`, 'warning');
    validationResult.warnings.forEach(w => addLog('warning', `[${PLATFORMS[platform].label}] ${w}`));
  } else {
    addLog('success', `${PLATFORMS[platform].label} processed ${products} products`);
    showToast(`${PLATFORMS[platform].label}: ${products} products processed`, 'success');
  }
  
  setStats(platform, { type: 'process', products, duration, fileSizeMb, normStats, validationResult });
  checkDataAvailability();
});

socket.on('normalizer:error', ({ platform, error }) => {
  setPlatformStatus(platform, 'error');
  setProgressText(platform, 'Processing failed');
  addLog('error', `${PLATFORMS[platform].label} processing failed: ${error}`);
  showToast(`${PLATFORMS[platform].label} processing failed`, 'error');
  setErrorStats(platform, error);
});

// ─── Socket events: database ────────────────────────────────────────────
socket.on('database:start', () => { addLog('info', 'Saving data to database...'); });
socket.on('database:progress', ({ current, total }) => { addLog('info', `Database: ${current}/${total} products saved`); });
socket.on('database:complete', ({ stats }) => {
  addLog('success', `Database save completed: ${stats.products?.created || 0} products added`);
  showToast('Data saved to database', 'success');
  checkDataAvailability();
});
socket.on('database:error', ({ error }) => {
  addLog('error', `Database save failed: ${error}`);
  showToast('Database save failed', 'error');
});

socket.on('data:cleared-platform', ({ platform, deleted }) => {
  const s = state.platforms[platform];
  s.rawAvailable = false; s.normalizedAvailable = false;
  s.rawCount = 0; s.normalizedCount = 0; s.products = 0; s.progress = 0;
  setPlatformStatus(platform, 'ready');
  updateProgress(platform, 0, 0);
  setProgressText(platform, 'Data cleared — ready to collect');
  checkDataAvailability();
  addLog('success', `${PLATFORMS[platform].label} data deleted (${deleted} files)`);
  showToast(`${PLATFORMS[platform].label} data cleared`, 'success');
});

socket.on('data:cleared-all', ({ deleted }) => {
  Object.keys(PLATFORMS).forEach(p => {
    const s = state.platforms[p];
    s.rawAvailable = false; s.normalizedAvailable = false;
    s.rawCount = 0; s.normalizedCount = 0; s.products = 0; s.progress = 0;
    setPlatformStatus(p, 'ready');
    updateProgress(p, 0, 0);
    setProgressText(p, 'Idle');
  });
  checkDataAvailability();
  addLog('success', `All data deleted (${deleted} files removed)`);
  showToast(`All data cleared — ${deleted} files deleted`, 'success');
});

// ─── UI helpers ─────────────────────────────────────────────────────────
function updateConnectionStatus(connected) {
  const badge = $('connectionStatus');
  const text = $('connectionText');
  if (connected) { badge.classList.remove('disconnected'); text.textContent = 'Connected'; }
  else { badge.classList.add('disconnected'); text.textContent = 'Disconnected'; }
}

function updateSystemTime() {
  $('systemTime').textContent = new Date().toLocaleTimeString();
}

function updateDurations() {
  Object.keys(state.platforms).forEach(p => {
    const s = state.platforms[p];
    if (state.startTimes[p] && (s.status === 'scraping' || s.status === 'normalizing')) {
      const sec = Math.floor((Date.now() - state.startTimes[p]) / 1000);
      const m = Math.floor(sec / 60), ss = sec % 60;
      const el = $(`${p}-dur-text`);
      if (el) el.textContent = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }
  });
}

function setPlatformStatus(platform, status) {
  state.platforms[platform].status = status;
  const busy = status === 'scraping' || status === 'normalizing';
  // Badge
  const badge = $(`${platform}-badge`);
  if (badge) { badge.className = `card-badge ${status}`; badge.textContent = statusLabels[status] || capitalize(status); }
  // Card border
  const card = $(`card-${platform}`);
  if (card) { card.className = `platform-card status-${status}`; }
  // Progress bar: shimmer on fill + indeterminate sweep on track
  const bar = $(`${platform}-progress-bar`);
  if (bar) { bar.classList.toggle('active', busy); }
  const track = document.querySelector(`#card-${platform} .progress-track`);
  if (track) { track.classList.toggle('running', busy); }
  // Buttons
  syncButtons(platform);
}

function syncButtons(platform) {
  const s = state.platforms[platform];
  const busy = s.status === 'scraping' || s.status === 'normalizing';
  const startBtn = $(`${platform}-start-btn`);
  const stopBtn = $(`${platform}-stop-btn`);
  const procBtn = $(`${platform}-process-btn`);
  const resetBtn = $(`${platform}-reset-btn`);
  const delBtn = $(`${platform}-delete-btn`);
  if (startBtn) startBtn.disabled = busy;
  if (stopBtn) stopBtn.disabled = !busy;
  // Process btn: visually gray but still clickable so normalize() can explain why
  if (procBtn) procBtn.classList.toggle('btn-inactive', busy || !s.rawAvailable);
  if (resetBtn) resetBtn.disabled = busy;
  if (delBtn) delBtn.disabled = busy;
}

function updateProgress(platform, pct, products) {
  state.platforms[platform].progress = pct;
  state.platforms[platform].products = products;
  const bar = $(`${platform}-progress-bar`);
  const pctEl = $(`${platform}-progress-pct`);
  if (bar) bar.style.width = `${pct}%`;
  if (pctEl) pctEl.textContent = `${pct}%`;
  // Once real progress arrives, stop the indeterminate sweep
  if (pct > 3) {
    const track = document.querySelector(`#card-${platform} .progress-track`);
    if (track) track.classList.remove('running');
  }
}

function setProgressText(platform, text) {
  const el = $(`${platform}-progress-text`);
  if (el) el.textContent = text;
}

function setStats(platform, { type, products, duration, fileSizeMb, normStats, validationResult, memory }) {
  const panel = $(`${platform}-stats`);
  const items = $(`${platform}-stats-items`);
  if (!panel || !items) return;
  const durStr = duration ? formatDuration(duration) : '--';
  const sizeStr = fileSizeMb ? `${fileSizeMb} MB` : '--';
  let html = `<div class="stat-item"><i class="fas fa-boxes-stacked"></i> <b>${products}</b> <span>products</span></div>`
    + `<div class="stat-item"><i class="fas fa-clock"></i> <b>${durStr}</b></div>`
    + `<div class="stat-item"><i class="fas fa-file-zipper"></i> <b>${sizeStr}</b></div>`;
  if (memory && memory.heapUsed) {
    const heapMb = (memory.heapUsed / 1024 / 1024).toFixed(1);
    const rssMb = (memory.rss / 1024 / 1024).toFixed(1);
    html += `<div class="stat-separator"></div>`;
    html += `<div class="stat-item"><i class="fas fa-microchip"></i> <b>${heapMb} MB</b> <span>heap</span></div>`;
    html += `<div class="stat-item"><i class="fas fa-memory"></i> <b>${rssMb} MB</b> <span>RSS</span></div>`;
  }
  if (type === 'process' && normStats) {
    const ns = normStats;
    if (ns.brandSuccessRate != null) {
      const c = ns.brandSuccessRate >= 85 ? 'var(--green)' : ns.brandSuccessRate >= 65 ? 'var(--orange)' : 'var(--red)';
      html += `<div class="stat-item"><i class="fas fa-tag" style="color:${c}"></i> <b style="color:${c}">${ns.brandSuccessRate}%</b> <span>brands</span></div>`;
    }
    if (ns.modelSuccessRate != null) {
      const c = ns.modelSuccessRate >= 85 ? 'var(--green)' : ns.modelSuccessRate >= 65 ? 'var(--orange)' : 'var(--red)';
      html += `<div class="stat-item"><i class="fas fa-mobile-screen" style="color:${c}"></i> <b style="color:${c}">${ns.modelSuccessRate}%</b> <span>models</span></div>`;
    }
    if (ns.manualReviewPct != null) {
      html += `<div class="stat-item"><i class="fas fa-magnifying-glass" style="color:var(--orange)"></i> <b>${ns.manualReviewPct}%</b> <span>flagged</span></div>`;
    }
    if (ns.nullBrandCount != null && ns.nullBrandCount > 0) {
      html += `<div class="stat-item"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i> <b>${ns.nullBrandCount}</b> <span>null brands</span></div>`;
    }
    if (ns.nullModelCount != null && ns.nullModelCount > 0) {
      html += `<div class="stat-item"><i class="fas fa-triangle-exclamation" style="color:var(--red)"></i> <b>${ns.nullModelCount}</b> <span>null models</span></div>`;
    }
    if (ns.processingRate != null) {
      html += `<div class="stat-item"><i class="fas fa-gauge-high"></i> <b>${ns.processingRate}/s</b></div>`;
    }
  }
  if (validationResult && !validationResult.success) {
    html += `<div class="stat-item stat-error stat-wide">`
      + `<i class="fas fa-exclamation-triangle" style="color:var(--orange)"></i> <b style="color:var(--orange)">Validation warnings:</b>`;
    validationResult.warnings.forEach(w => {
      html += `<span>- ${w}</span>`;
    });
    html += `</div>`;
  }
  panel.dataset.label = type;
  panel.style.display = 'block';
  items.innerHTML = html;
}

function setErrorStats(platform, error, memory) {
  const panel = $(`${platform}-stats`);
  const items = $(`${platform}-stats-items`);
  if (!panel || !items) return;
  let html = `<div class="stat-item stat-error stat-wide"><i class="fas fa-circle-exclamation"></i> <span>${error.substring(0, 160)}</span></div>`;
  if (memory && memory.heapUsed) {
    const heapMb = (memory.heapUsed / 1024 / 1024).toFixed(1);
    const rssMb = (memory.rss / 1024 / 1024).toFixed(1);
    html += `<div class="stat-separator"></div>`;
    html += `<div class="stat-item"><i class="fas fa-microchip"></i> <b>${heapMb} MB</b> <span>heap</span></div>`;
    html += `<div class="stat-item"><i class="fas fa-memory"></i> <b>${rssMb} MB</b> <span>RSS</span></div>`;
  }
  items.innerHTML = html;
  panel.dataset.label = 'error';
  panel.style.display = 'block';
}

function clearStats(platform) {
  const panel = $(`${platform}-stats`);
  if (panel) panel.style.display = 'none';
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// ─── Data availability polling ──────────────────────────────────────────
async function checkDataAvailability() {
  try {
    const res = await fetch('/api/data-status');
    const data = await res.json();
    let totalRaw = 0, totalNorm = 0, totalDb = 0;

    Object.keys(PLATFORMS).forEach(p => {
      const d = data[p] || {};
      const s = state.platforms[p];
      s.rawAvailable = !!d.rawAvailable;
      s.normalizedAvailable = !!d.normalizedAvailable;
      s.rawCount = d.rawCount || 0;
      s.normalizedCount = d.normalizedCount || 0;
      s.dbCount = d.dbCount || 0;
      totalRaw += s.rawCount; totalNorm += s.normalizedCount; totalDb += s.dbCount;

      // Chips
      const rawChip = $(`${p}-chip-raw`);
      const normChip = $(`${p}-chip-norm`);
      if (rawChip) { rawChip.classList.toggle('has-data', s.rawAvailable); }
      if (normChip) { normChip.classList.toggle('has-data', s.normalizedAvailable); }
      const rawVal = $(`${p}-raw-val`);
      const normVal = $(`${p}-norm-val`);
      const dbVal = $(`${p}-db-val`);
      if (rawVal) rawVal.textContent = s.rawAvailable ? s.rawCount : '--';
      if (normVal) normVal.textContent = s.normalizedAvailable ? s.normalizedCount : '--';
      if (dbVal) dbVal.textContent = s.dbCount;

      // Re-sync process button
      syncButtons(p);
    });

    // Pipeline overview
    const rawEl = $('pipelineRawCount');
    const normEl = $('pipelineNormCount');
    const dbEl = $('pipelineDbCount');
    if (rawEl) rawEl.textContent = `${totalRaw} products`;
    if (normEl) normEl.textContent = `${totalNorm} products`;
    if (dbEl) dbEl.textContent = `${totalDb} products`;
  } catch (e) {
    console.error('Data status check failed:', e);
  }
}

// ─── Activity log ───────────────────────────────────────────────────────
function addLog(type, message) {
  const log = $('activityLog');
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.innerHTML = `<span class="log-time">[${time}]</span><span class="log-message">${message}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 150) log.removeChild(log.firstChild);
  // Apply current filter
  if (state.currentFilter !== 'all' && !entry.classList.contains(`log-${state.currentFilter}`)) {
    entry.style.display = 'none';
  }
}

function filterLogs(type, btnEl) {
  state.currentFilter = type;
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  document.querySelectorAll('.log-entry').forEach(e => {
    e.style.display = (type === 'all' || e.classList.contains(`log-${type}`)) ? 'flex' : 'none';
  });
}

function clearLogs() {
  $('activityLog').innerHTML = '';
  addLog('info', 'Logs cleared');
}

// ─── Actions ────────────────────────────────────────────────────────────
async function startScraper(platform) {
  try {
    addLog('info', `Starting ${PLATFORMS[platform].label} data collection...`);
    const res = await fetch('/api/scraper/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, config: configTemplates[platform] })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to start');
  } catch (e) {
    addLog('error', `Failed to start ${PLATFORMS[platform].label}: ${e.message}`);
    showToast(`Failed to start ${PLATFORMS[platform].label}`, 'error');
  }
}

async function stopScraper(platform) {
  if (!confirm(`Stop ${PLATFORMS[platform].label} data collection?`)) return;
  try {
    addLog('info', `Stopping ${PLATFORMS[platform].label}...`);
    const res = await fetch('/api/scraper/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to stop');
  } catch (e) {
    addLog('error', `Failed to stop ${PLATFORMS[platform].label}: ${e.message}`);
  }
}

async function startFromScratch(platform) {
  if (!confirm(`This will delete all existing ${PLATFORMS[platform].label} data and re-collect from scratch. Continue?`)) return;
  try {
    addLog('info', `Resetting ${PLATFORMS[platform].label} data...`);
    const res = await fetch('/api/scraper/clean', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to reset');
    addLog('success', `${PLATFORMS[platform].label} data cleared`);
    setTimeout(() => startScraper(platform), 1000);
  } catch (e) {
    addLog('error', `Failed to reset ${PLATFORMS[platform].label}: ${e.message}`);
  }
}

async function processPlatform(platform) {
  const s = state.platforms[platform];
  if (!s.rawAvailable) {
    showToast(`No collected data for ${PLATFORMS[platform].label} — run Collect first.`, 'warning');
    addLog('warning', `Cannot process ${PLATFORMS[platform].label} — no collected data`);
    return;
  }
  if (s.status === 'normalizing') {
    showToast(`${PLATFORMS[platform].label} is already being processed.`, 'info');
    return;
  }
  if (s.status === 'scraping') {
    showToast(`${PLATFORMS[platform].label} is still collecting data. Wait for it to finish.`, 'warning');
    return;
  }
  try {
    addLog('info', `Starting ${PLATFORMS[platform].label} data processing...`);
    const res = await fetch('/api/normalizer/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to start processing');
  } catch (e) {
    addLog('error', `Failed to process ${PLATFORMS[platform].label}: ${e.message}`);
    showToast(`Failed to process ${PLATFORMS[platform].label}`, 'error');
  }
}

async function startAllScrapers() {
  addLog('info', 'Starting data collection for all platforms...');
  showToast('Starting collection for all platforms', 'info');
  for (const p of Object.keys(PLATFORMS)) {
    await startScraper(p);
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function normalizeAll() {
  const eligible = Object.keys(PLATFORMS).filter(p => state.platforms[p].rawAvailable && state.platforms[p].status !== 'normalizing' && state.platforms[p].status !== 'scraping');
  if (eligible.length === 0) {
    showToast('No platforms have collected data ready to process.', 'warning');
    addLog('warning', 'Process All: no platforms ready — collect data first');
    return;
  }
  addLog('info', `Processing data for: ${eligible.map(p => PLATFORMS[p].label).join(', ')}`);
  showToast(`Starting processing for ${eligible.length} platform(s)`, 'info');
  for (const p of eligible) {
    await processPlatform(p);
    await new Promise(r => setTimeout(r, 500));
  }
}

async function deletePlatformData(platform) {
  if (!confirm(`Delete all ${PLATFORMS[platform].label} data?\n\nThis removes collected and processed files for this platform only. Cannot be undone.`)) return;
  try {
    addLog('warning', `Deleting all ${PLATFORMS[platform].label} data...`);
    const res = await fetch('/api/data/clear-platform', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to clear data');
  } catch (e) {
    addLog('error', `Failed to delete ${PLATFORMS[platform].label} data: ${e.message}`);
    showToast(`Failed to delete ${PLATFORMS[platform].label} data`, 'error');
  }
}

async function clearAllData() {
  if (!confirm('This will permanently delete ALL collected and processed data for every platform, including normalized files.\n\nThis cannot be undone. Continue?')) return;
  try {
    addLog('warning', 'Deleting all data files...');
    const res = await fetch('/api/data/clear-all', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to clear data');
  } catch (e) {
    addLog('error', `Failed to clear all data: ${e.message}`);
    showToast('Failed to clear all data', 'error');
  }
}

async function insertToDatabase() {
  try {
    addLog('info', 'Saving all processed data to database...');
    showToast('Saving data to database...', 'info');
    const res = await fetch('/api/database/insert', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to start database save');
  } catch (e) {
    addLog('error', `Database save failed: ${e.message}`);
    showToast('Database save failed', 'error');
  }
}

async function runCompletePipeline() {
  if (!confirm('This will run the full pipeline: Collect → Process → Store.\nThis may take 1-2 hours. Continue?')) return;
  addLog('info', 'Starting full pipeline...');
  showToast('Full pipeline started', 'info');
  await startAllScrapers();

  const waitForScrapers = setInterval(() => {
    const allDone = Object.values(state.platforms).every(p => p.status === 'completed' || p.status === 'error');
    if (allDone) {
      clearInterval(waitForScrapers);
      addLog('info', 'Collection phase done. Starting processing...');
      setTimeout(async () => {
        await normalizeAll();
        const waitForNorm = setInterval(() => {
          const allNorm = Object.values(state.platforms).every(p => p.normalizedAvailable || p.status === 'error');
          if (allNorm) {
            clearInterval(waitForNorm);
            addLog('info', 'Processing phase done. Saving to database...');
            setTimeout(() => insertToDatabase(), 2000);
          }
        }, 10000);
      }, 5000);
    }
  }, 10000);
}

// ─── Config modal ───────────────────────────────────────────────────────
function showConfig(platform) {
  const modal = $('configModal');
  const body = $('modalBody');
  $('modalPlatformName').textContent = PLATFORMS[platform].label;
  const c = configTemplates[platform];

  let html = `
    <div class="cfg-group">
      <label>Maximum Products (Main List)</label>
      <input type="number" id="cfg-maxProducts" value="${c.maxProducts}" min="1" max="10000">
      <div class="cfg-hint">How many products to collect from the main listing</div>
    </div>`;
  if (c.totalMaxProducts !== undefined) {
    html += `
    <div class="cfg-group">
      <label>Total Maximum Products</label>
      <input type="number" id="cfg-totalMaxProducts" value="${c.totalMaxProducts}" min="1" max="10000">
      <div class="cfg-hint">Overall cap including related/recommended products</div>
    </div>`;
  }
  if (c.maxPages !== undefined) {
    html += `
    <div class="cfg-group">
      <label>Maximum Pages</label>
      <input type="number" id="cfg-maxPages" value="${c.maxPages}" min="1" max="1000">
      <div class="cfg-hint">Max listing pages to scan</div>
    </div>`;
  }
  html += `
    <div class="cfg-group">
      <label>Speed (parallel browsers)</label>
      <input type="number" id="cfg-maxConcurrent" value="${c.maxConcurrent}" min="1" max="50">
      <div class="cfg-hint">More = faster but uses more memory. 5-15 is recommended.</div>
    </div>
    <div class="cfg-group">
      <label>Delay Between Pages (ms)</label>
      <input type="number" id="cfg-delay" value="${c.delayBetweenPages}" min="500" max="10000" step="500">
      <div class="cfg-hint">Wait time between requests. Higher = less likely to get blocked.</div>
    </div>
    <div class="cfg-group">
      <label>Background Mode</label>
      <select id="cfg-headless">
        <option value="true" ${c.headless ? 'selected' : ''}>Yes (faster, no browser windows)</option>
        <option value="false" ${!c.headless ? 'selected' : ''}>No (shows browser windows)</option>
      </select>
      <div class="cfg-hint">Background mode hides browser windows for faster collection.</div>
    </div>`;
  if (platform === 'flipkart' && c.relatedProducts) {
    html += `
    <div class="cfg-group">
      <label>Collect Related Products</label>
      <select id="cfg-related">
        <option value="true" ${c.relatedProducts.enabled ? 'selected' : ''}>Yes</option>
        <option value="false" ${!c.relatedProducts.enabled ? 'selected' : ''}>No</option>
      </select>
      <div class="cfg-hint">Also collect similar/related products for each item</div>
    </div>
    <div class="cfg-group">
      <label>Related Products Per Item</label>
      <input type="number" id="cfg-relatedMax" value="${c.relatedProducts.maxPerProduct}" min="0" max="10">
    </div>`;
  }
  body.innerHTML = html;
  modal.classList.add('active');
  modal.dataset.platform = platform;
}

function closeModal() { $('configModal').classList.remove('active'); }

function saveConfig() {
  const modal = $('configModal');
  const p = modal.dataset.platform;
  const cfg = {
    maxProducts: parseInt($('cfg-maxProducts').value),
    maxConcurrent: parseInt($('cfg-maxConcurrent').value),
    delayBetweenPages: parseInt($('cfg-delay').value),
    headless: $('cfg-headless').value === 'true'
  };
  const mp = $('cfg-maxPages');
  if (mp) cfg.maxPages = parseInt(mp.value);
  const tmp = $('cfg-totalMaxProducts');
  if (tmp) cfg.totalMaxProducts = parseInt(tmp.value);
  if (p === 'flipkart') {
    const re = $('cfg-related'), rm = $('cfg-relatedMax');
    if (re && rm) cfg.relatedProducts = { enabled: re.value === 'true', maxPerProduct: parseInt(rm.value) };
  }
  configTemplates[p] = cfg;
  addLog('success', `${PLATFORMS[p].label} settings saved`);
  showToast(`${PLATFORMS[p].label} settings saved`, 'success');
  closeModal();
}

// Close modal on overlay click or Escape
document.addEventListener('click', e => { if (e.target.id === 'configModal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
