/**
 * Clean Logger Utility for Scrapers
 * Provides minimal, essential logging with progress tracking
 */

class Logger {
  constructor(category = 'SCRAPER') {
    this.category = category;
    this.startTime = Date.now();
    this.processedCount = 0;
    this.totalCount = 0;
    this.lastProgressUpdate = 0;
    this.progressInterval = 1000; // Update progress every 1 second
  }

  /**
   * Set total count for progress tracking
   */
  setTotalCount(total) {
    this.totalCount = total;
    this.processedCount = 0;
  }

  /**
   * Update processed count and show progress
   */
  updateProgress(increment = 1) {
    this.processedCount += increment;
    const now = Date.now();
    
    // Only update progress display every progressInterval ms
    if (now - this.lastProgressUpdate >= this.progressInterval || this.processedCount === this.totalCount) {
      this.showProgress();
      this.lastProgressUpdate = now;
    }
  }

  /**
   * Show progress bar
   */
  showProgress() {
    if (this.totalCount === 0) return;
    
    const percentage = Math.round((this.processedCount / this.totalCount) * 100);
    const progressBar = this.createProgressBar(percentage);
    const elapsed = this.formatTime(Date.now() - this.startTime);
    
    process.stdout.write(`\r${this.category}: ${progressBar} ${this.processedCount}/${this.totalCount} (${percentage}%) - ${elapsed}`);
    
    if (this.processedCount === this.totalCount) {
      console.log(''); // New line when complete
    }
  }

  /**
   * Create visual progress bar
   */
  createProgressBar(percentage, length = 30) {
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * Format time duration
   */
  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Essential logs only
   */
  info(message) {
    console.log(`[${this.category}] ${message}`);
  }

  success(message) {
    console.log(`[${this.category}] ✅ ${message}`);
  }

  error(message) {
    console.error(`[${this.category}] ❌ ${message}`);
  }

  warning(message) {
    console.warn(`[${this.category}] ⚠️  ${message}`);
  }

  debug(message) {
    // Debug messages are only shown in development or when explicitly enabled
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
      console.log(`[${this.category}] 🔧 ${message}`);
    }
  }

  warn(message) {
    console.warn(`[${this.category}] ⚠️  ${message}`);
  }

  /**
   * Start scraper
   */
  startScraper(category, totalProducts) {
    this.category = category.toUpperCase();
    this.setTotalCount(totalProducts);
    this.startTime = Date.now();
    this.info(`Starting ${category} scraper - Target: ${totalProducts} products`);
  }

  /**
   * Complete scraper
   */
  completeScraper() {
    const elapsed = this.formatTime(Date.now() - this.startTime);
    this.success(`Completed - ${this.processedCount} products in ${elapsed}`);
  }

  /**
   * Rate limit warning (minimal)
   */
  rateLimit(delay) {
    // Only show rate limit warnings occasionally to avoid spam
    if (Math.random() < 0.1) { // 10% chance
      process.stdout.write(`\r${this.category}: Rate limited, waiting ${delay}ms...`);
    }
  }

  /**
   * Checkpoint saved (minimal)
   */
  checkpointSaved() {
    // Only show checkpoint saves occasionally
    if (Math.random() < 0.2) { // 20% chance
      process.stdout.write(`\r${this.category}: Checkpoint saved...`);
    }
  }

  /**
   * Product processing error (minimal)
   */
  productError(index, error) {
    // Only show errors occasionally to avoid spam
    if (Math.random() < 0.05) { // 5% chance
      process.stdout.write(`\r${this.category}: Error at product ${index}: ${error}`);
    }
  }

  /**
   * Memory management (minimal)
   */
  memoryCleanup() {
    // Only show memory cleanup occasionally
    if (Math.random() < 0.1) { // 10% chance
      process.stdout.write(`\r${this.category}: Memory cleanup...`);
    }
  }
}

module.exports = Logger;