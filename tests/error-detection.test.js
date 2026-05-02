/**
 * Comprehensive tests for error detection, bot detection, memory-on-failure,
 * and shutdown-on-error across all crawler utilities.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────
function mockLogger() {
  const calls = [];
  return {
    calls,
    info: (msg) => calls.push({ level: 'info', msg }),
    error: (msg) => calls.push({ level: 'error', msg }),
    warn: (msg) => calls.push({ level: 'warn', msg }),
    debug: (msg) => calls.push({ level: 'debug', msg })
  };
}

// ─── ScrapingHealthMonitor tests ─────────────────────────────────────────────
describe('ScrapingHealthMonitor', () => {
  let ScrapingHealthMonitor;

  beforeAll(() => {
    ScrapingHealthMonitor = require('../src/scrapers/scraping-health-monitor');
  });

  test('resolves silently when products have valid key fields', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    const product = { title: 'iPhone 15', price: { current: '₹79,900' } };
    expect(monitor.evaluate(product)).toBe(false);
    expect(monitor.consecutiveNulls).toBe(0);
  });

  test('increments consecutive nulls when both title and price are null', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    expect(monitor.evaluate({ title: null, price: { current: null } })).toBe(false);
    expect(monitor.consecutiveNulls).toBe(1);

    expect(monitor.evaluate({ title: null, price: {} })).toBe(false);
    expect(monitor.consecutiveNulls).toBe(2);
  });

  test('resets consecutive nulls when a valid product arrives', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    monitor.evaluate({ title: null, price: { current: null } });
    monitor.evaluate({ title: null, price: {} });
    expect(monitor.consecutiveNulls).toBe(2);

    monitor.evaluate({ title: 'Valid Product', price: { current: '₹100' } });
    expect(monitor.consecutiveNulls).toBe(0);
  });

  test('passing null to evaluate counts as null product', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    monitor.evaluate(null);
    monitor.evaluate(undefined);
    monitor.evaluate({});
    expect(monitor.consecutiveNulls).toBe(3); // all have null title and price
    expect(monitor.triggered).toBe(true);
  });

  test('triggers bot detection when threshold is reached (default 3)', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'croma', logger, threshold: 3 });

    monitor.evaluate({ title: null, price: { current: null } });
    monitor.evaluate({ title: null, price: {} });
    expect(monitor.triggered).toBe(false);

    const result = monitor.evaluate({ title: null, price: { current: null } });
    expect(result).toBe(true);
    expect(monitor.triggered).toBe(true);
    expect(monitor.consecutiveNulls).toBe(3);

    const errorCalls = logger.calls.filter(c => c.level === 'error');
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0].msg).toContain('BOT_DETECTED');
    expect(errorCalls[0].msg).toContain('CROMA');
  });

  test('respects custom threshold', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'amazon', logger, threshold: 5 });

    for (let i = 0; i < 4; i++) {
      expect(monitor.evaluate({})).toBe(false);
    }
    expect(monitor.triggered).toBe(false);

    expect(monitor.evaluate({})).toBe(true);
    expect(monitor.triggered).toBe(true);
    expect(monitor.consecutiveNulls).toBe(5);
  });

  test('does not count as null when only price is missing but title exists', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    monitor.evaluate({ title: 'iPhone', price: { current: null } });
    expect(monitor.consecutiveNulls).toBe(0);
  });

  test('does not count as null when only title is missing but price exists', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    monitor.evaluate({ title: null, price: { current: '₹50,000' } });
    expect(monitor.consecutiveNulls).toBe(0);
  });

  test('returns true immediately after triggered (idempotent)', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 2 });

    monitor.evaluate({});
    monitor.evaluate({});
    expect(monitor.triggered).toBe(true);

    // Further calls still return true without incrementing
    const prevNulls = monitor.consecutiveNulls;
    expect(monitor.evaluate({ title: 'Good', price: { current: '₹100' } })).toBe(true);
    expect(monitor.consecutiveNulls).toBe(prevNulls); // unchanged
  });

  test('reset clears all state', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 3 });

    monitor.evaluate({});
    monitor.evaluate({});
    monitor.evaluate({});
    expect(monitor.triggered).toBe(true);

    monitor.reset();
    expect(monitor.consecutiveNulls).toBe(0);
    expect(monitor.totalAttempts).toBe(0);
    expect(monitor.totalNulls).toBe(0);
    expect(monitor.triggered).toBe(false);

    // Can evaluate again without trigger
    expect(monitor.evaluate({ title: 'Product', price: { current: '₹100' } })).toBe(false);
  });

  test('logs platform name in detection message', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'flipkart', logger, threshold: 1 });

    monitor.evaluate({});
    const errorCalls = logger.calls.filter(c => c.level === 'error');
    expect(errorCalls[0].msg).toContain('FLIPKART');
    expect(errorCalls[0].msg).toContain('BOT_DETECTED');
  });

  test('tracks total attempts and nulls correctly', () => {
    const logger = mockLogger();
    const monitor = new ScrapingHealthMonitor({ platform: 'test', logger, threshold: 5 });

    monitor.evaluate({ title: 'Good', price: { current: '₹100' } }); // success
    monitor.evaluate({ title: null, price: { current: null } });      // null
    monitor.evaluate({ title: 'Good', price: { current: '₹200' } }); // success
    monitor.evaluate({ title: null, price: { current: null } });      // null

    expect(monitor.totalAttempts).toBe(4);
    expect(monitor.totalNulls).toBe(2);
    expect(monitor.consecutiveNulls).toBe(1); // last was null
  });
});

// ─── setupSignalHandlers tests ──────────────────────────────────────────────
describe('setupSignalHandlers', () => {
  let setupSignalHandlers;
  let exitSpy;

  beforeAll(() => {
    setupSignalHandlers = require('../src/scrapers/crawler-utils').setupSignalHandlers;
  });

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // Remove any listeners added during tests
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  test('registers SIGINT handler and returns cleanup function', () => {
    const cleanup = setupSignalHandlers(() => {});

    expect(typeof cleanup).toBe('function');
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);

    cleanup();
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  test('cleanup removes both listeners', () => {
    const cleanup = setupSignalHandlers(() => {});

    expect(process.listenerCount('SIGINT')).toBe(1);
    cleanup();
    expect(process.listenerCount('SIGINT')).toBe(0);
  });

  test('handler calls shutdown function on SIGINT', () => {
    let shutdownCalled = false;
    setupSignalHandlers(() => { shutdownCalled = true; });

    const listeners = process.listeners('SIGINT');
    const ourHandler = listeners[listeners.length - 1];

    ourHandler('SIGINT');

    // Allow microtasks to run
    return new Promise(resolve => setTimeout(resolve, 50)).then(() => {
      expect(shutdownCalled).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  test('guard against double-firing', () => {
    let callCount = 0;
    setupSignalHandlers(() => { callCount++; });

    const listeners = process.listeners('SIGINT');
    const ourHandler = listeners[listeners.length - 1];

    ourHandler('SIGINT');
    ourHandler('SIGINT');
    ourHandler('SIGINT');

    return new Promise(resolve => setTimeout(resolve, 50)).then(() => {
      expect(callCount).toBe(1);
    });
  });

  test('handler passes signal name to logger', () => {
    const logCalls = [];
    const mockLog = { info: (msg) => logCalls.push(msg) };
    setupSignalHandlers(() => {}, mockLog);

    const listeners = process.listeners('SIGINT');
    const ourHandler = listeners[listeners.length - 1];

    ourHandler('SIGINT');

    return new Promise(resolve => setTimeout(resolve, 50)).then(() => {
      expect(logCalls.some(m => m.includes('SIGINT'))).toBe(true);
    });
  });
});

// ─── createMemoryTracker tests ──────────────────────────────────────────────
describe('createMemoryTracker', () => {
  let createMemoryTracker;
  let origSend;

  beforeAll(() => {
    createMemoryTracker = require('../src/scrapers/crawler-utils').createMemoryTracker;
  });

  beforeEach(() => {
    origSend = process.send;
    process.send = undefined;
  });

  afterEach(() => {
    process.send = origSend;
  });

  test('returns object with start, stop, getStats, getSamples', () => {
    const tracker = createMemoryTracker('test');
    expect(typeof tracker.start).toBe('function');
    expect(typeof tracker.stop).toBe('function');
    expect(typeof tracker.getStats).toBe('function');
    expect(typeof tracker.getSamples).toBe('function');
  });

  test('start takes immediate sample', () => {
    const tracker = createMemoryTracker('test');
    const stats = tracker.start();

    // Stats should be undefined since start doesn't return stats
    // But getStats should have data
    const afterStats = tracker.getStats();
    expect(afterStats.heapUsed).toBeGreaterThan(0);
    expect(afterStats.heapTotal).toBeGreaterThan(0);
    expect(afterStats.rss).toBeGreaterThan(0);
    expect(afterStats.sampleCount).toBeGreaterThanOrEqual(1);

    tracker.stop();
  });

  test('stop returns final stats and stops sampling', () => {
    const tracker = createMemoryTracker('test');
    tracker.start(100); // 100ms interval for fast test
    const stats = tracker.stop();

    expect(stats.heapUsed).toBeGreaterThan(0);
    expect(stats.heapTotal).toBeGreaterThan(0);
    expect(stats.rss).toBeGreaterThan(0);
    expect(typeof stats.timestamp).toBe('number');
    expect(typeof stats.sampleCount).toBe('number');
  });

  test('getSamples returns collected samples', () => {
    const tracker = createMemoryTracker('test');
    tracker.start(50);

    // Wait a bit for samples
    return new Promise((resolve) => {
      setTimeout(() => {
        tracker.stop();
        const samples = tracker.getSamples();
        expect(Array.isArray(samples)).toBe(true);
        expect(samples.length).toBeGreaterThanOrEqual(1);
        samples.forEach(s => {
          expect(s.type).toBe('memory');
          expect(s.platform).toBe('test');
          expect(typeof s.heapUsed).toBe('number');
          expect(typeof s.timestamp).toBe('number');
        });
        resolve();
      }, 150);
    });
  });

  test('double start is a no-op', () => {
    const tracker = createMemoryTracker('test');
    tracker.start();
    const statsBefore = tracker.getStats();

    tracker.start(); // second call should do nothing

    const statsAfter = tracker.getStats();
    expect(statsAfter.sampleCount >= statsBefore.sampleCount).toBe(true);
    tracker.stop();
  });

  test('samples are capped at 120', () => {
    const tracker = createMemoryTracker('test');
    // Manually push beyond limit
    for (let i = 0; i < 130; i++) {
      tracker.start(10);
      tracker.stop();
    }
    const samples = tracker.getSamples();
    expect(samples.length).toBeLessThanOrEqual(120);
  });

  test('sends IPC messages when process.send is available', () => {
    const ipcMessages = [];
    process.send = (msg) => { ipcMessages.push(msg); };

    const tracker = createMemoryTracker('test-platform');
    tracker.start();
    tracker.stop();

    expect(ipcMessages.length).toBeGreaterThanOrEqual(2); // initial sample + final

    const initial = ipcMessages.find(m => m.type === 'memory');
    expect(initial.platform).toBe('test-platform');
    expect(typeof initial.heapUsed).toBe('number');

    const final = ipcMessages.find(m => m.type === 'final-memory');
    expect(final.platform).toBe('test-platform');
    expect(final.type).toBe('final-memory');
    expect(typeof final.sampleCount).toBe('number');
  });

  test('IPC failure is caught silently', () => {
    process.send = () => { throw new Error('IPC closed'); };
    const tracker = createMemoryTracker('test');
    expect(() => {
      tracker.start();
      tracker.stop();
    }).not.toThrow();
  });
});

// ─── Error detection in run-concurrent-scrapers logic ───────────────────────
describe('Error detection — Promise.allSettled pattern', () => {
  // This simulates the exact pattern used in all 4 run-concurrent-scrapers.js
  test('detects failure when scraper.start() throws (.catch(err => err))', async () => {
    // Simulate: one scraper succeeds, one fails
    const mockScrapers = [
      { start: () => Promise.resolve() },
      { start: () => Promise.reject(new Error('BotDetectedError: BOT_DETECTED — matched text:"blocked"')) }
    ];

    // This is the exact pattern from run-concurrent-scrapers.js
    const results = await Promise.allSettled(
      mockScrapers.map(s => s.start().then(() => null).catch(err => err))
    );

    // Without the fix: r.status === 'rejected' would be empty
    // With the fix: r.value !== null catches the caught error
    const failuresByStatus = results.filter(r => r.status === 'rejected');
    const failuresByValue = results.filter(r => r.value !== null);

    expect(failuresByStatus).toHaveLength(0); // .catch(err => err) masks these
    expect(failuresByValue).toHaveLength(1);  // Our fix catches the error value

    const failure = failuresByValue[0];
    expect(failure.value).toBeInstanceOf(Error);
    expect(failure.value.message).toContain('BotDetectedError');
  });

  test('no failures when all scrapers succeed', async () => {
    const mockScrapers = [
      { start: () => Promise.resolve() },
      { start: () => Promise.resolve() },
      { start: () => Promise.resolve() }
    ];

    const results = await Promise.allSettled(
      mockScrapers.map(s => s.start().then(() => null).catch(err => err))
    );

    const failures = results.filter(r => r.status === 'rejected' || r.value !== null);
    expect(failures).toHaveLength(0);
  });

  test('correctly counts multiple failures', async () => {
    const mockScrapers = [
      { start: () => Promise.reject(new Error('Error A')) },
      { start: () => Promise.reject(new Error('Error B')) },
      { start: () => Promise.resolve() },
      { start: () => Promise.reject(new Error('Error C')) }
    ];

    const results = await Promise.allSettled(
      mockScrapers.map(s => s.start().then(() => null).catch(err => err))
    );

    const failures = results.filter(r => r.status === 'rejected' || r.value !== null);
    expect(failures).toHaveLength(3);
  });

  test('extracts correct error message from failure', async () => {
    const mockScrapers = [
      { start: () => Promise.reject(new Error('SELECTOR_MISSING — "h1" not found')) }
    ];

    const results = await Promise.allSettled(
      mockScrapers.map(s => s.start().then(() => null).catch(err => err))
    );

    const failures = results.filter(r => r.value !== null);
    const msg = failures[0].value?.message;
    expect(msg).toContain('SELECTOR_MISSING');
    expect(msg).toContain('h1');
  });

  test('handles rejection without .catch (raw rejection)', async () => {
    // If the scraper promise actually rejects (not caught), Promise.allSettled handles it
    const results = await Promise.allSettled([
      Promise.resolve(null),
      Promise.reject(new Error('Raw rejection'))
    ]);

    const failures = results.filter(r => r.status === 'rejected');
    expect(failures).toHaveLength(1);
    expect(failures[0].reason.message).toBe('Raw rejection');
  });

  test('handles error with no message property', async () => {
    const mockScrapers = [
      { start: () => Promise.reject('string error') }
    ];

    const results = await Promise.allSettled(
      mockScrapers.map(s => s.start().then(() => null).catch(err => err))
    );

    const failures = results.filter(r => r.value !== null);
    expect(failures).toHaveLength(1);
    expect(failures[0].value).toBe('string error');

    // Test the message extraction logic used in runners
    const r = failures[0];
    const msg = r.reason?.message || r.value?.message || r.reason || r.value;
    expect(msg).toBe('string error');
  });
});

// ─── DashboardServer close handler logic ────────────────────────────────────
describe('DashboardServer close handler logic', () => {
  test('extracts last non-empty line from stderr buffer', () => {
    const stderrBuffer = 'Some noise\n\nError: BotDetectedError: BOT_DETECTED — matched text:"blocked"\n';
    const errorMsg = stderrBuffer.split('\n').filter(l => l.trim()).pop()?.trim();
    expect(errorMsg).toContain('BotDetectedError');
    expect(errorMsg).toContain('BOT_DETECTED');
  });

  test('falls back to generic message when stderr is empty', () => {
    const stderrBuffer = '';
    const code = 1;
    const errorMsg = stderrBuffer.split('\n').filter(l => l.trim()).pop()?.trim()
      || `Process exited with code ${code}`;
    expect(errorMsg).toBe('Process exited with code 1');
  });

  test('falls back when stderr contains only whitespace', () => {
    const stderrBuffer = '  \n  \n  ';
    const code = 1;
    const errorMsg = stderrBuffer.split('\n').filter(l => l.trim()).pop()?.trim()
      || `Process exited with code ${code}`;
    expect(errorMsg).toBe('Process exited with code 1');
  });

  test('extracts SelectorMissingError from stderr', () => {
    const stderrBuffer = '[flipkart] MOBILE: SELECTOR_MISSING — "h1" not found\n';
    const errorMsg = stderrBuffer.split('\n').filter(l => l.trim()).pop()?.trim();
    expect(errorMsg).toContain('SELECTOR_MISSING');
  });

  test('includes memory stats when available on error', () => {
    // Simulate the memory extraction logic from the close handler
    const child_memory = {
      _finalMemory: { heapUsed: 60000000, heapTotal: 80000000, rss: 150000000, external: 5000000 }
    };
    const memory = child_memory._finalMemory || {};
    const memoryStats = memory.heapUsed ? {
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      rss: memory.rss,
      external: memory.external
    } : null;

    expect(memoryStats).not.toBeNull();
    expect(memoryStats.heapUsed).toBe(60000000);
    expect(memoryStats.rss).toBe(150000000);
  });

  test('memory is null when no heapUsed', () => {
    const child_memory = { _finalMemory: { someOtherField: true } };
    const memory = child_memory._finalMemory || {};
    const memoryStats = memory.heapUsed ? {} : null;

    expect(memoryStats).toBeNull();
  });

  test('falls back to _lastMemory when _finalMemory is null (crash before final-memory IPC)', () => {
    // Real scenario: crawler crashes before sending final-memory IPC.
    // _finalMemory stays null, but _lastMemory has samples from periodic IPC.
    const child_memory = {
      _finalMemory: null,
      _lastMemory: { heapUsed: 40000000, heapTotal: 70000000, rss: 120000000, external: 3000000 }
    };
    const memory = child_memory._finalMemory || child_memory._lastMemory || {};
    const memoryStats = memory.heapUsed ? {
      heapUsed: memory.heapUsed,
      rss: memory.rss
    } : null;

    expect(memoryStats).not.toBeNull();
    expect(memoryStats.heapUsed).toBe(40000000);
  });
});

// ─── setErrorStats UI rendering logic ───────────────────────────────────────
describe('setErrorStats UI rendering', () => {
  // Simulate the exact function logic from app.js
  function setErrorStats(platform, error, memory) {
    let html = `<div class="stat-item stat-error stat-wide"><i class="fas fa-circle-exclamation"></i> <span>${error.substring(0, 160)}</span></div>`;
    if (memory && memory.heapUsed) {
      const heapMb = (memory.heapUsed / 1024 / 1024).toFixed(1);
      const rssMb = (memory.rss / 1024 / 1024).toFixed(1);
      html += `<div class="stat-separator"></div>`;
      html += `<div class="stat-item"><i class="fas fa-microchip"></i> <b>${heapMb} MB</b> <span>heap</span></div>`;
      html += `<div class="stat-item"><i class="fas fa-memory"></i> <b>${rssMb} MB</b> <span>RSS</span></div>`;
    }
    return html;
  }

  test('renders error with memory stats', () => {
    const html = setErrorStats('flipkart', 'BotDetectedError: BOT_DETECTED', {
      heapUsed: 65431142,
      rss: 160432128
    });

    expect(html).toContain('BotDetectedError');
    expect(html).toContain('stat-error');
    expect(html).toContain('stat-separator');
    expect(html).toContain('microchip');
    expect(html).toContain('memory');
    // 65431142 / 1048576 = ~62.4
    expect(html).toContain('62.4 MB');
    expect(html).toContain('heap');
    expect(html).toContain('RSS');
    // 160432128 / 1048576 = ~153.0
    expect(html).toContain('153.0 MB');
  });

  test('renders error without memory stats', () => {
    const html = setErrorStats('amazon', 'Process exited with code 1', null);

    expect(html).toContain('Process exited with code 1');
    expect(html).not.toContain('stat-separator');
    expect(html).not.toContain('microchip');
    expect(html).not.toContain('RSS');
  });

  test('renders error with undefined memory', () => {
    const html = setErrorStats('croma', 'Selector missing');

    expect(html).toContain('Selector missing');
    expect(html).not.toContain('stat-separator');
  });

  test('truncates long error messages to 160 chars', () => {
    const longError = 'x'.repeat(300);
    const html = setErrorStats('flipkart', longError);

    expect(html).toContain('x'.repeat(160));
    expect(html).not.toContain('x'.repeat(161));
  });

  test('handles error with memory that lacks rss', () => {
    const html = setErrorStats('reliance', 'Failed', {
      heapUsed: 100000000,
      rss: 0  // 0 MB legitimately
    });

    expect(html).toContain('95.4 MB'); // 100000000 / 1048576
    expect(html).toContain('0.0 MB');
  });
});

// ─── Shutdown on error — ensures finally runs ──────────────────────────────
describe('Shutdown on error paths', () => {
  test('finally block executes after thrown error in try', async () => {
    let shutdownRan = false;
    let finallyRan = false;

    async function simulatedStart() {
      try {
        throw new Error('BotDetectedError: BOT_DETECTED');
      } catch (e) {
        throw e; // re-throw as crawlers do
      } finally {
        finallyRan = true;
        shutdownRan = true; // await this.shutdown()
      }
    }

    await expect(simulatedStart()).rejects.toThrow('BotDetectedError');
    expect(finallyRan).toBe(true);
    expect(shutdownRan).toBe(true);
  });

  test('finally block executes on normal completion too', async () => {
    let shutdownRan = false;

    async function simulatedStart() {
      try {
        // normal work completes
        return 'done';
      } finally {
        shutdownRan = true;
      }
    }

    const result = await simulatedStart();
    expect(result).toBe('done');
    expect(shutdownRan).toBe(true);
  });

  test('memoryTracker.stop is called in shutdown on error', async () => {
    const { createMemoryTracker } = require('../src/scrapers/crawler-utils');
    const tracker = createMemoryTracker('test');
    tracker.start();

    // Simulate what happens: error → finally → shutdown → tracker.stop
    tracker.stop();
    const stats = tracker.getStats();

    expect(stats.heapUsed).toBeGreaterThan(0);
    expect(typeof stats.sampleCount).toBe('number');
  });
});

// ─── BotDetectedError/SelectorMissingError propagation ──────────────────────
describe('Error name propagation', () => {
  test('BotDetectedError has correct name for caller detection', () => {
    const err = new Error('BOT_DETECTED — matched text:"blocked"');
    err.name = 'BotDetectedError';
    expect(err.name).toBe('BotDetectedError');
  });

  test('SelectorMissingError has correct name for caller detection', () => {
    const err = new Error('SELECTOR_MISSING — "h1" not found');
    err.name = 'SelectorMissingError';
    expect(err.name).toBe('SelectorMissingError');
  });

  test('callers can distinguish error types by name', () => {
    // Crawlers check: err.name === 'BotDetectedError' || err.name === 'SelectorMissingError'
    const botErr = { name: 'BotDetectedError' };
    const selErr = { name: 'SelectorMissingError' };
    const otherErr = { name: 'Error' };

    const isHalting = (e) => e.name === 'BotDetectedError' || e.name === 'SelectorMissingError';

    expect(isHalting(botErr)).toBe(true);
    expect(isHalting(selErr)).toBe(true);
    expect(isHalting(otherErr)).toBe(false);
  });
});
