const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

/**
 * Real-time Dashboard Server
 * Provides web interface for monitoring and controlling scrapers
 */
class DashboardServer {
  constructor(port = 3001) {
    this.port = port;
    this.runningProcesses = new Map();

    // Setup Express
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupRoutes();
    this.setupSocketHandlers();
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // Serve static files
    this.app.use(express.static(path.join(__dirname, 'dashboard'), {
      setHeaders: (res) => { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate'); }
    }));
    this.app.use(express.json());

    // API endpoints
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Check data availability
    this.app.get('/api/data-status', (req, res) => {
      const platforms = ['amazon', 'flipkart', 'croma', 'reliance'];
      const status = {};

      platforms.forEach(platform => {
        // Check raw data
        const rawPaths = [
          path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_mobile_scraped_data.json`),
          path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_scraped_data.json`),
          path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_raw.json`),
          path.join(__dirname, `../scrapers/${platform}/${platform}_scraped_data.json`)
        ];

        let rawAvailable = false;
        let rawCount = 0;
        for (const p of rawPaths) {
          if (fs.existsSync(p)) {
            rawAvailable = true;
            try {
              const data = JSON.parse(fs.readFileSync(p, 'utf8'));
              rawCount = Array.isArray(data) ? data.length : 0;
            } catch (e) { }
            break;
          }
        }

        // Check normalized data (try multiple naming conventions)
        const normalizedPaths = [
          path.join(__dirname, `../../parsed_data/${platform}_normalized_data.json`),
          path.join(__dirname, `../../parsed_data/${platform}_mobile_normalized_data.json`)
        ];
        let normalizedAvailable = false;
        let normalizedCount = 0;
        for (const normalizedPath of normalizedPaths) {
          if (fs.existsSync(normalizedPath)) {
            normalizedAvailable = true;
            try {
              const data = JSON.parse(fs.readFileSync(normalizedPath, 'utf8'));
              normalizedCount = Array.isArray(data) ? data.length : 0;
            } catch (e) { }
            break;
          }
        }

        status[platform] = {
          rawAvailable,
          rawCount,
          normalizedAvailable,
          normalizedCount,
          dbCount: 0 // TODO: Query database for actual count
        };
      });

      res.json(status);
    });

    // Start individual scraper
    this.app.post('/api/scraper/start', async (req, res) => {
      try {
        const { platform, config } = req.body;

        if (!platform) {
          return res.status(400).json({ error: 'Platform is required' });
        }

        // Emit start event
        this.io.emit('scraper:start', { platform });

        // Run scraper in background
        this.runScraperBackground(platform, config);

        res.json({ success: true, platform });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Stop scraper
    this.app.post('/api/scraper/stop', async (req, res) => {
      try {
        const { platform } = req.body;

        if (!platform) {
          return res.status(400).json({ error: 'Platform is required' });
        }

        const stopped = this.stopScraper(platform);

        if (stopped) {
          res.json({ success: true, platform });
        } else {
          res.status(404).json({ error: 'Scraper not running' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Clean platform data (start from scratch)
    this.app.post('/api/scraper/clean', async (req, res) => {
      try {
        const { platform } = req.body;

        if (!platform) {
          return res.status(400).json({ error: 'Platform is required' });
        }

        const cleaned = this.cleanPlatformData(platform);

        if (cleaned) {
          this.io.emit('scraper:cleaned', { platform });
          res.json({ success: true, platform });
        } else {
          res.status(500).json({ error: 'Failed to clean data' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Start normalizer
    this.app.post('/api/normalizer/start', async (req, res) => {
      try {
        const { platform } = req.body;

        if (!platform) {
          return res.status(400).json({ error: 'Platform is required' });
        }

        // Emit start event
        this.io.emit('normalizer:start', { platform });

        // Run normalizer in background
        this.runNormalizerBackground(platform);

        res.json({ success: true, platform });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Start database insertion
    this.app.post('/api/database/insert', async (req, res) => {
      try {
        // Emit start event
        this.io.emit('database:start', {});

        // Run database insertion in background
        this.runDatabaseInsertionBackground();

        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete data for one platform (raw + checkpoints + normalized)
    this.app.post('/api/data/clear-platform', (req, res) => {
      try {
        const { platform } = req.body;
        if (!platform) return res.status(400).json({ error: 'Platform is required' });
        let deleted = 0;

        const rawDataDir = path.join(__dirname, `../scrapers/${platform}/raw_data`);
        if (fs.existsSync(rawDataDir)) {
          fs.readdirSync(rawDataDir).forEach(f => {
            if (f.endsWith('.json')) { fs.unlinkSync(path.join(rawDataDir, f)); deleted++; }
          });
        }
        const checkpointDir = path.join(__dirname, `../scrapers/${platform}/checkpoints`);
        if (fs.existsSync(checkpointDir)) {
          fs.readdirSync(checkpointDir).forEach(f => {
            if (f.endsWith('.json')) { fs.unlinkSync(path.join(checkpointDir, f)); deleted++; }
          });
        }
        const altRaw = path.join(__dirname, `../scrapers/${platform}/${platform}_scraped_data.json`);
        if (fs.existsSync(altRaw)) { fs.unlinkSync(altRaw); deleted++; }

        const normalizedPaths = [
          path.join(__dirname, `../../parsed_data/${platform}_normalized_data.json`),
          path.join(__dirname, `../../parsed_data/${platform}_mobile_normalized_data.json`)
        ];
        normalizedPaths.forEach(p => { if (fs.existsSync(p)) { fs.unlinkSync(p); deleted++; } });

        this.io.emit('data:cleared-platform', { platform, deleted });
        res.json({ success: true, platform, deleted });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Delete all raw + normalized data files
    this.app.post('/api/data/clear-all', (req, res) => {
      try {
        const platforms = ['amazon', 'flipkart', 'croma', 'reliance'];
        let deleted = 0;

        for (const platform of platforms) {
          // Raw data dir
          const rawDataDir = path.join(__dirname, `../scrapers/${platform}/raw_data`);
          if (fs.existsSync(rawDataDir)) {
            fs.readdirSync(rawDataDir).forEach(f => {
              if (f.endsWith('.json')) { fs.unlinkSync(path.join(rawDataDir, f)); deleted++; }
            });
          }
          // Checkpoints dir
          const checkpointDir = path.join(__dirname, `../scrapers/${platform}/checkpoints`);
          if (fs.existsSync(checkpointDir)) {
            fs.readdirSync(checkpointDir).forEach(f => {
              if (f.endsWith('.json')) { fs.unlinkSync(path.join(checkpointDir, f)); deleted++; }
            });
          }
          // Alternate raw location
          const altRaw = path.join(__dirname, `../scrapers/${platform}/${platform}_scraped_data.json`);
          if (fs.existsSync(altRaw)) { fs.unlinkSync(altRaw); deleted++; }
        }

        // Normalized (parsed_data)
        const parsedDir = path.join(__dirname, '../../parsed_data');
        if (fs.existsSync(parsedDir)) {
          fs.readdirSync(parsedDir).forEach(f => {
            if (f.endsWith('.json')) { fs.unlinkSync(path.join(parsedDir, f)); deleted++; }
          });
        }

        this.io.emit('data:cleared-all', { deleted });
        res.json({ success: true, deleted });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get running processes
    this.app.get('/api/running', (req, res) => {
      const running = {};
      for (const [key] of this.runningProcesses) {
        const parts = key.split('-');
        const type = parts[0]; // scraper, normalizer, database
        const platform = parts.slice(1).join('-');
        if (type === 'scraper') running[platform] = 'scraping';
        else if (type === 'normalizer') running[platform] = 'normalizing';
        else if (type === 'database') running['_database'] = true;
      }
      res.json(running);
    });

    // Serve dashboard HTML
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'index.html'));
    });
  }

  /**
   * Run scraper in background
   */
  runScraperBackground(platform, config) {
    const scraperPath = path.join(__dirname, `../scrapers/${platform}/crawler/run-concurrent-scrapers.js`);

    if (!fs.existsSync(scraperPath)) {
      this.io.emit('scraper:error', { platform, error: 'Scraper not found' });
      return;
    }

    // Apply configuration by modifying the config file temporarily
    if (config) {
      this.applyScraperConfig(platform, config);
    }

    const child = spawn('node', [scraperPath], {
      cwd: path.join(__dirname, `../scrapers/${platform}/crawler`)
    });
    const scraperStartTime = Date.now();

    this.runningProcesses.set(`scraper-${platform}`, child);

    let productCount = 0;
    let totalProducts = 0;
    let isScrapingLinks = true;

    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${platform}] ${output}`);

      // Parse "Starting scraper" message to detect link scraping phase
      if (output.match(/Starting.*scraper/i) || output.match(/Initializing/i)) {
        isScrapingLinks = true;
        this.io.emit('scraper:link-progress', { platform, links: 0 });
      }

      // Parse link scraping messages
      const linkMatch = output.match(/Scraped\s+(\d+)\s+product\s+links/i) ||
        output.match(/Found\s+(\d+)\s+product/i) ||
        output.match(/(\d+)\s+links\s+found/i);
      if (linkMatch) {
        const links = parseInt(linkMatch[1]);
        this.io.emit('scraper:link-progress', { platform, links });
      }

      // Parse progress bar format: "CATEGORY: [████░░░] 45/100 (45%)"
      const progressBarMatch = output.match(/\[.*?\]\s+(\d+)\/(\d+)\s+\((\d+)%\)/);
      if (progressBarMatch) {
        const current = parseInt(progressBarMatch[1]);
        const total = parseInt(progressBarMatch[2]);
        productCount = current;
        totalProducts = total;
        isScrapingLinks = false;
        this.io.emit('scraper:product-progress', { platform, current, total, products: current });
      }

      // Parse other progress formats
      const progressMatch = output.match(/Processing\s+product\s+(\d+)\/(\d+)/i) ||
        output.match(/Product\s+(\d+)\/(\d+)/i) ||
        output.match(/(\d+)\/(\d+)\s+products/i);
      if (progressMatch) {
        const current = parseInt(progressMatch[1]);
        const total = parseInt(progressMatch[2]);
        productCount = current;
        totalProducts = total;
        isScrapingLinks = false;
        this.io.emit('scraper:product-progress', { platform, current, total, products: current });
      }

      // Parse completion message
      if (output.match(/Completed.*products/i) || output.match(/scraper completed/i)) {
        const completedMatch = output.match(/(\d+)\s+products/i);
        if (completedMatch) {
          productCount = parseInt(completedMatch[1]);
        }
      }
    });

    child.stderr.on('data', (data) => {
      console.error(`[${platform}] ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      this.runningProcesses.delete(`scraper-${platform}`);
      const duration = Date.now() - scraperStartTime;

      if (code === 0) {
        if (productCount === 0) {
          productCount = this.getProductCountFromFile(platform);
        }
        const rawPaths = [
          path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_mobile_scraped_data.json`),
          path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_scraped_data.json`),
          path.join(__dirname, `../scrapers/${platform}/${platform}_scraped_data.json`)
        ];
        const fileSizeMb = this.getFileSizeMb(rawPaths);
        this.io.emit('scraper:complete', { platform, products: productCount, duration, fileSizeMb });
      } else {
        this.io.emit('scraper:error', { platform, error: `Process exited with code ${code}` });
      }
    });
  }

  /**
   * Get file size in MB from first matching path
   */
  getFileSizeMb(paths) {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        try { return +(fs.statSync(p).size / 1024 / 1024).toFixed(2); } catch (e) { }
      }
    }
    return 0;
  }

  /**
   * Get product count from scraped data file
   */
  getProductCountFromFile(platform) {
    const rawPaths = [
      path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_mobile_scraped_data.json`),
      path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_scraped_data.json`),
      path.join(__dirname, `../scrapers/${platform}/raw_data/${platform}_raw.json`),
      path.join(__dirname, `../scrapers/${platform}/${platform}_scraped_data.json`)
    ];

    for (const p of rawPaths) {
      if (fs.existsSync(p)) {
        try {
          const data = JSON.parse(fs.readFileSync(p, 'utf8'));
          return Array.isArray(data) ? data.length : 0;
        } catch (e) {
          console.error(`Failed to read product count from ${p}:`, e.message);
        }
      }
    }
    return 0;
  }

  /**
   * Apply scraper configuration
   */
  applyScraperConfig(platform, config) {
    const configPath = path.join(__dirname, `../scrapers/${platform}/crawler/run-concurrent-scrapers.js`);

    try {
      let content = fs.readFileSync(configPath, 'utf8');

      // Update maxProducts
      if (config.maxProducts !== undefined) {
        content = content.replace(/maxProducts:\s*\d+/g, `maxProducts: ${config.maxProducts}`);
      }

      // Update maxPages
      if (config.maxPages !== undefined) {
        content = content.replace(/maxPages:\s*\d+/g, `maxPages: ${config.maxPages}`);
      }

      // Update maxConcurrent
      if (config.maxConcurrent !== undefined) {
        content = content.replace(/maxConcurrent:\s*\d+/g, `maxConcurrent: ${config.maxConcurrent}`);
      }

      // Update delayBetweenPages
      if (config.delayBetweenPages !== undefined) {
        content = content.replace(/delayBetweenPages:\s*\d+/g, `delayBetweenPages: ${config.delayBetweenPages}`);
      }

      // Update headless
      if (config.headless !== undefined) {
        content = content.replace(/headless:\s*(true|false)/g, `headless: ${config.headless}`);
      }

      // Flipkart specific: related products
      if (platform === 'flipkart' && config.relatedProducts !== undefined) {
        if (config.relatedProducts.enabled !== undefined) {
          content = content.replace(/enabled:\s*(true|false)/g, `enabled: ${config.relatedProducts.enabled}`);
        }
        if (config.relatedProducts.maxPerProduct !== undefined) {
          content = content.replace(/relatedProducts:\s*\d+/g, `relatedProducts: ${config.relatedProducts.maxPerProduct}`);
        }
      }

      fs.writeFileSync(configPath, content, 'utf8');
      console.log(`✅ Applied configuration for ${platform}`);
    } catch (error) {
      console.error(`Failed to apply config for ${platform}:`, error.message);
    }
  }

  /**
   * Stop scraper
   */
  stopScraper(platform) {
    const processKey = `scraper-${platform}`;
    const child = this.runningProcesses.get(processKey);

    if (child) {
      child.kill('SIGTERM');
      this.runningProcesses.delete(processKey);
      this.io.emit('scraper:stopped', { platform });
      return true;
    }
    return false;
  }

  /**
   * Clean platform data (checkpoints and raw data)
   */
  cleanPlatformData(platform) {
    try {
      // Delete checkpoints
      const checkpointDir = path.join(__dirname, `../scrapers/${platform}/checkpoints`);
      if (fs.existsSync(checkpointDir)) {
        const files = fs.readdirSync(checkpointDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(checkpointDir, file));
        });
      }

      // Delete raw data
      const rawDataDir = path.join(__dirname, `../scrapers/${platform}/raw_data`);
      if (fs.existsSync(rawDataDir)) {
        const files = fs.readdirSync(rawDataDir);
        files.forEach(file => {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(rawDataDir, file));
          }
        });
      }

      // Also check alternate locations
      const altRawPath = path.join(__dirname, `../scrapers/${platform}/${platform}_scraped_data.json`);
      if (fs.existsSync(altRawPath)) {
        fs.unlinkSync(altRawPath);
      }

      console.log(`✅ Cleaned data for ${platform}`);
      return true;
    } catch (error) {
      console.error(`Failed to clean data for ${platform}:`, error.message);
      return false;
    }
  }

  /**
   * Run normalizer in background
   */
  runNormalizerBackground(platform) {
    const normalizerMap = {
      amazon: 'amazon_normalizer',
      flipkart: 'flipkart_normalizer',
      croma: 'croma_normalizer',
      reliance: 'reliance_normalizer'
    };

    const normalizerPath = path.join(__dirname, `../services/${normalizerMap[platform]}.js`);

    if (!fs.existsSync(normalizerPath)) {
      this.io.emit('normalizer:error', { platform, error: 'Normalizer not found' });
      return;
    }

    const child = spawn('node', [normalizerPath], {
      cwd: path.join(__dirname, '../services')
    });
    const normalizerStartTime = Date.now();

    this.runningProcesses.set(`normalizer-${platform}`, child);

    let productCount = 0;
    let outputTail = '';
    const normStats = {
      nullBrandCount: null, nullBrandPct: null,
      nullModelCount: null, nullModelPct: null,
      manualReviewPct: null,
      brandSuccessRate: null, modelSuccessRate: null,
      processingRate: null
    };

    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${platform} normalizer] ${output}`);
      outputTail = (outputTail + output).slice(-1000);

      // Parse product count
      const countMatch = output.match(/(\d+)\s+products/i) ||
        output.match(/Normalized\s+(\d+)/i) ||
        output.match(/Total products processed:\s*(\d+)/i) ||
        output.match(/Successfully normalized\s+(\d+)/i) ||
        output.match(/Products?:\s*(\d+)/i);
      if (countMatch) productCount = parseInt(countMatch[1]);

      // Reliance: Null brand names: X (X.X%)
      const nb = output.match(/Null brand\s*names?:\s*(\d+)\s*\(([\d.]+)%\)/i);
      if (nb) { normStats.nullBrandCount = parseInt(nb[1]); normStats.nullBrandPct = parseFloat(nb[2]); }

      // Reliance: Null model names: X (X.X%)
      const nm = output.match(/Null model\s*names?:\s*(\d+)\s*\(([\d.]+)%\)/i);
      if (nm) { normStats.nullModelCount = parseInt(nm[1]); normStats.nullModelPct = parseFloat(nm[2]); }

      // Reliance: Products flagged for manual review: X (X.X%)
      const mr = output.match(/flagged for.*?review:\s*\d+\s*\(([\d.]+)%\)/i) ||
        output.match(/manual.*?review.*?:\s*\d+\s*\(([\d.]+)%\)/i);
      if (mr) normStats.manualReviewPct = parseFloat(mr[1]);

      // Reliance: Success rate - Brands: X%, Models: X%
      const sr = output.match(/Success rate.*?Brands?:\s*([\d.]+)%.*?Models?:\s*([\d.]+)%/i);
      if (sr) { normStats.brandSuccessRate = parseFloat(sr[1]); normStats.modelSuccessRate = parseFloat(sr[2]); }

      // Amazon: Complete extractions: X/Y (Z%)
      const ce = output.match(/Complete extractions?:\s*\d+\/\d+\s*\(([\d.]+)%\)/i);
      if (ce) normStats.brandSuccessRate = parseFloat(ce[1]);

      // Amazon: Processing rate: X products/second
      const pr = output.match(/Processing rate:\s*([\d.]+)\s*products?\/second/i);
      if (pr) normStats.processingRate = parseFloat(pr[1]);

      // Croma: missing summary JSON spanning possible multiple chunks
      const brandJson = outputTail.match(/"brand"\s*:\s*(\d+)/i);
      if (brandJson) normStats.nullBrandCount = parseInt(brandJson[1]);
      const modelJson = outputTail.match(/"model"\s*:\s*(\d+)/i);
      if (modelJson) normStats.nullModelCount = parseInt(modelJson[1]);

      // Amazon AI enhancer progress: "AI Progress: 50/250"
      const aiProgressMatch = output.match(/AI Progress:\s*(\d+)\/(\d+)/);
      if (aiProgressMatch) {
        const current = parseInt(aiProgressMatch[1]);
        const total = parseInt(aiProgressMatch[2]);
        this.io.emit('normalizer:progress', { platform, current, total, label: 'AI Enhancing' });
      }

      // Parse progress
      const progressMatch = output.match(/(\d+)\/(\d+)/);
      if (progressMatch) {
        const current = parseInt(progressMatch[1]);
        const total = parseInt(progressMatch[2]);
        if (total > 1 && !aiProgressMatch) this.io.emit('normalizer:progress', { platform, current, total });
      }
    });

    child.stderr.on('data', (data) => {
      console.error(`[${platform} normalizer] ${data.toString().trim()}`);
    });

    child.on('close', (code) => {
      this.runningProcesses.delete(`normalizer-${platform}`);
      const duration = Date.now() - normalizerStartTime;

      if (code === 0) {
        if (productCount === 0) {
          const normalizedPaths = [
            path.join(__dirname, `../../parsed_data/${platform}_normalized_data.json`),
            path.join(__dirname, `../../parsed_data/${platform}_mobile_normalized_data.json`)
          ];
          for (const p of normalizedPaths) {
            if (fs.existsSync(p)) {
              try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); productCount = Array.isArray(d) ? d.length : 0; } catch (e) { }
              break;
            }
          }
        }
        const normalizedPaths = [
          path.join(__dirname, `../../parsed_data/${platform}_normalized_data.json`),
          path.join(__dirname, `../../parsed_data/${platform}_mobile_normalized_data.json`)
        ];
        const fileSizeMb = this.getFileSizeMb(normalizedPaths);
        this.io.emit('normalizer:complete', { platform, products: productCount, duration, fileSizeMb, normStats });
      } else {
        this.io.emit('normalizer:error', { platform, error: `Process exited with code ${code}` });
      }
    });
  }

  /**
   * Run database insertion in background
   */
  runDatabaseInsertionBackground() {
    const dbPath = path.join(__dirname, '../services/dbIngestion.js');

    if (!fs.existsSync(dbPath)) {
      this.io.emit('database:error', { error: 'Database insertion script not found' });
      return;
    }

    const child = spawn('node', [dbPath], {
      cwd: path.join(__dirname, '../services')
    });

    this.runningProcesses.set('database', child);

    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[database] ${output}`);

      // Parse progress
      const progressMatch = output.match(/(\d+)\/(\d+)/);
      if (progressMatch) {
        const current = parseInt(progressMatch[1]);
        const total = parseInt(progressMatch[2]);
        this.io.emit('database:progress', { current, total });
      }
    });

    child.stderr.on('data', (data) => {
      console.error(`[database] ERROR: ${data}`);
    });

    child.on('close', (code) => {
      this.runningProcesses.delete('database');

      if (code === 0) {
        this.io.emit('database:complete', { stats: {} });
      } else {
        this.io.emit('database:error', { error: `Process exited with code ${code}` });
      }
    });
  }

  /**
   * Setup Socket.IO handlers
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Start dashboard server
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, (err) => {
        if (err) {
          console.error(`Failed to start dashboard: ${err.message}`);
          reject(err);
        } else {
          console.log(`✅ Dashboard running at http://localhost:${this.port}`);
          resolve();
        }
      });
    });
  }

  /**
   * Stop dashboard server
   */
  stop() {
    return new Promise((resolve) => {
      // Kill all running processes
      for (const [name, child] of this.runningProcesses) {
        console.log(`Stopping ${name}...`);
        child.kill();
      }

      this.server.close(() => {
        console.log('Dashboard server stopped');
        resolve();
      });
    });
  }
}

module.exports = DashboardServer;
