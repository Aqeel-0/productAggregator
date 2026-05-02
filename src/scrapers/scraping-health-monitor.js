/**
 * Scraping Health Monitor — detects bot/bot-block pages by tracking
 * consecutive product scrapes that return null for ALL key fields.
 *
 * Strategy: if N products in a row have null title AND null price, the
 * pages being served are not product pages (bot detection / captcha /
 * block page). A single successful scrape resets the counter.
 *
 * This avoids per-page DOM checks and catches any bot page regardless
 * of how the site implements it.
 */

class ScrapingHealthMonitor {
  constructor({ platform, logger, threshold = 3 }) {
    this.platform = platform;
    this.logger = logger;
    this.threshold = threshold;

    this.consecutiveNulls = 0;
    this.totalAttempts = 0;
    this.totalNulls = 0;
    this.triggered = false;
  }

  /**
   * Evaluate a scraped product result. Returns true if bot detection was
   * triggered (caller should halt). Returns false if healthy.
   */
  evaluate(product) {
    if (this.triggered) return true;

    this.totalAttempts++;

    const keyFieldsNull = !product?.title && !product?.price?.current;

    if (keyFieldsNull) {
      this.consecutiveNulls++;
      this.totalNulls++;
    } else {
      this.consecutiveNulls = 0;
    }

    if (this.consecutiveNulls >= this.threshold) {
      this.triggered = true;
      this._signalDetection();
      return true;
    }

    return false;
  }

  _signalDetection() {
    const payload = {
      type: 'bot-detected',
      platform: this.platform,
      consecutiveNulls: this.consecutiveNulls,
      totalAttempts: this.totalAttempts,
      totalNulls: this.totalNulls,
      threshold: this.threshold,
      timestamp: new Date().toISOString()
    };

    if (typeof process.send === 'function') {
      try {
        process.send(payload);
      } catch (e) { /* parent may have closed IPC */ }
    }

    this.logger.error(
      `BOT_DETECTED [${this.platform.toUpperCase()}]: ` +
      `${this.consecutiveNulls} consecutive products with null key fields ` +
      `(${this.totalNulls}/${this.totalAttempts} total nulls). Halting scraper.`
    );
  }

  reset() {
    this.consecutiveNulls = 0;
    this.totalAttempts = 0;
    this.totalNulls = 0;
    this.triggered = false;
  }
}

module.exports = ScrapingHealthMonitor;
