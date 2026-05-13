/**
 * Scraping Health Monitor — two-tier bot/error detection.
 *
 * Soft threshold (3 consecutive nulls):  sends a warning, keeps scraping.
 * Hard threshold (7 consecutive nulls):  sends "stopped abruptly", scraper halts.
 *
 * A single successful scrape resets both counters.
 */
class ScrapingHealthMonitor {
  constructor({ platform, logger, softThreshold = 3, hardThreshold = 7 }) {
    this.platform = platform;
    this.logger = logger;
    this.softThreshold = softThreshold;
    this.hardThreshold = hardThreshold;

    this.consecutiveNulls = 0;
    this.totalAttempts = 0;
    this.totalNulls = 0;
    this.softTriggered = false;
    this.hardTriggered = false;
  }

  /**
   * Evaluate a scraped product result.
   * @returns {'ok'|'soft'|'hard'}
   *   - 'ok':   healthy, continue
   *   - 'soft': warning threshold hit — keep scraping, notification sent
   *   - 'hard': persistent failure — caller MUST halt the scraper
   */
  evaluate(product) {
    if (this.hardTriggered) return 'hard';

    this.totalAttempts++;

    const keyFieldsNull = !product?.title && !product?.price?.current;

    if (keyFieldsNull) {
      this.consecutiveNulls++;
      this.totalNulls++;
    } else {
      this.consecutiveNulls = 0;
      this.softTriggered = false;
      return 'ok';
    }

    if (this.consecutiveNulls >= this.hardThreshold) {
      this.hardTriggered = true;
      this._signalAbruptStop();
      return 'hard';
    }

    if (!this.softTriggered && this.consecutiveNulls >= this.softThreshold) {
      this.softTriggered = true;
      this._signalWarning();
      return 'soft';
    }

    return 'ok';
  }

  _signalWarning() {
    const payload = {
      type: 'bot-warning',
      platform: this.platform,
      consecutiveNulls: this.consecutiveNulls,
      totalAttempts: this.totalAttempts,
      totalNulls: this.totalNulls,
      softThreshold: this.softThreshold,
      hardThreshold: this.hardThreshold,
      timestamp: new Date().toISOString()
    };

    if (typeof process.send === 'function') {
      try { process.send(payload); } catch (e) { /* parent may have closed IPC */ }
    }

    this.logger.warn(
      `BOT_WARNING [${this.platform.toUpperCase()}]: ` +
      `${this.consecutiveNulls} consecutive nulls — will retry up to ${this.hardThreshold} before stopping abruptly`
    );
  }

  _signalAbruptStop() {
    const payload = {
      type: 'bot-detected',
      platform: this.platform,
      consecutiveNulls: this.consecutiveNulls,
      totalAttempts: this.totalAttempts,
      totalNulls: this.totalNulls,
      threshold: this.hardThreshold,
      stoppedAbruptly: true,
      timestamp: new Date().toISOString()
    };

    if (typeof process.send === 'function') {
      try { process.send(payload); } catch (e) { /* parent may have closed IPC */ }
    }

    this.logger.error(
      `STOPPED_ABRUPTLY [${this.platform.toUpperCase()}]: ` +
      `${this.consecutiveNulls} consecutive null products ` +
      `(${this.totalNulls}/${this.totalAttempts} total nulls). Halting scraper.`
    );
  }

  reset() {
    this.consecutiveNulls = 0;
    this.totalAttempts = 0;
    this.totalNulls = 0;
    this.softTriggered = false;
    this.hardTriggered = false;
  }
}

module.exports = ScrapingHealthMonitor;
