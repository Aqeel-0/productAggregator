/**
 * Shared utilities for crawler signal handling, memory tracking, and shutdown.
 * Composable functions — no base class required.
 */

/**
 * Register SIGTERM/SIGINT handlers that call shutdownFn.
 * Returns a cleanup() function that removes both listeners.
 */
function setupSignalHandlers(shutdownFn, logger) {
  let called = false;

  const handler = (signal) => {
    if (called) return;
    called = true;
    if (logger) logger.info(`Received ${signal}, shutting down gracefully...`);
    Promise.resolve(shutdownFn()).finally(() => {
      if (logger) logger.info('Shutdown complete');
      process.exit(0);
    });
  };

  // SIGTERM may not be available on Windows; wrap in try/catch
  try { process.on('SIGTERM', handler); } catch (e) { /* ignore */ }
  process.on('SIGINT', handler);

  return () => {
    try { process.removeListener('SIGTERM', handler); } catch (e) { /* ignore */ }
    process.removeListener('SIGINT', handler);
  };
}

/**
 * Creates a memory tracker that periodically samples process.memoryUsage().
 * Sends samples to parent process via IPC when available.
 */
function createMemoryTracker(platform) {
  let interval = null;
  const samples = [];
  let started = false;

  function sample() {
    const mem = process.memoryUsage();
    const stats = {
      type: 'memory',
      platform,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      timestamp: Date.now()
    };
    samples.push(stats);

    if (samples.length > 120) samples.shift();

    if (typeof process.send === 'function') {
      try { process.send(stats); } catch (e) { /* parent may have closed IPC */ }
    }
  }

  function start(intervalMs = 5000) {
    if (started) return;
    started = true;
    sample(); // immediate first sample
    interval = setInterval(sample, intervalMs);
    interval.unref(); // don't prevent process exit
  }

  function stop() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    started = false;
    // send final stats
    const mem = process.memoryUsage();
    if (typeof process.send === 'function') {
      try {
        process.send({
          type: 'final-memory',
          platform,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          rss: mem.rss,
          external: mem.external,
          sampleCount: samples.length
        });
      } catch (e) { /* ignore */ }
    }
    return getStats();
  }

  function getStats() {
    const mem = process.memoryUsage();
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
      timestamp: Date.now(),
      sampleCount: samples.length
    };
  }

  function getSamples() {
    return [...samples];
  }

  return { start, stop, getStats, getSamples };
}

module.exports = { setupSignalHandlers, createMemoryTracker };
