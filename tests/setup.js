// Global test setup file
// This file runs before each test file

// Mock console methods globally to reduce noise in tests
const originalConsole = global.console;

// Store original methods
global.originalConsole = {
  log: originalConsole.log,
  error: originalConsole.error,
  warn: originalConsole.warn,
  info: originalConsole.info,
  debug: originalConsole.debug
};

// Set up global test utilities
global.testUtils = {
  // Mock console for specific tests
  mockConsole: () => {
    global.console = {
      ...originalConsole,
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };
  },
  
  // Restore console
  restoreConsole: () => {
    global.console = originalConsole;
  },
  
  // Create mock page object
  createMockPage: () => ({
    setUserAgent: jest.fn().mockResolvedValue({}),
    setViewport: jest.fn().mockResolvedValue({}),
    setExtraHTTPHeaders: jest.fn().mockResolvedValue({}),
    setRequestInterception: jest.fn().mockResolvedValue({}),
    setDefaultTimeout: jest.fn(),
    setDefaultNavigationTimeout: jest.fn(),
    goto: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue({}),
    isClosed: jest.fn().mockReturnValue(false),
    evaluate: jest.fn().mockResolvedValue({}),
    target: jest.fn().mockReturnValue({
      createCDPSession: jest.fn().mockResolvedValue({
        send: jest.fn().mockResolvedValue({}),
        detach: jest.fn().mockResolvedValue({})
      })
    }),
    on: jest.fn(),
    waitForSelector: jest.fn().mockResolvedValue({}),
    $: jest.fn().mockResolvedValue({
      boundingBox: jest.fn().mockResolvedValue({
        x: 100, y: 100, width: 200, height: 50
      })
    }),
    mouse: {
      move: jest.fn().mockResolvedValue({}),
      down: jest.fn().mockResolvedValue({}),
      up: jest.fn().mockResolvedValue({})
    },
    screenshot: jest.fn().mockResolvedValue({})
  }),
  
  // Create mock browser object
  createMockBrowser: () => ({
    newPage: jest.fn(),
    close: jest.fn().mockResolvedValue({}),
    process: jest.fn().mockReturnValue({
      kill: jest.fn()
    }),
    on: jest.fn()
  }),
  
  // Wait for async operations
  waitFor: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Generate test data
  generateTestProduct: (overrides = {}) => ({
    product_identifiers: {
      brand: 'TestBrand',
      model_name: 'TestModel',
      model_number: 'TM001',
      ...overrides.product_identifiers
    },
    variant_attributes: {
      ram: 8,
      storage: 128,
      color: 'Black',
      ...overrides.variant_attributes
    },
    source_details: {
      source_name: 'test_source',
      url: 'https://test.com/product',
      ...overrides.source_details
    },
    listing_info: {
      price: { current: 25000, original: 30000, discount_percent: 17, currency: 'INR' },
      ...overrides.listing_info
    }
  })
};

// Set up global mocks that are commonly used
global.mockPuppeteer = {
  launch: jest.fn()
};

global.mockUserAgent = jest.fn(() => ({
  toString: () => 'Mozilla/5.0 (Test User Agent)'
}));

// Set up environment variables for testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

// Global error handlers for unhandled rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Jest configuration
jest.setTimeout(30000); // 30 second timeout for all tests

// Mock timers configuration
jest.useFakeTimers({
  doNotFake: ['nextTick', 'setImmediate'],
  advanceTimers: true
});

// Clean up after each test
afterEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Clear all timers
  jest.clearAllTimers();
  
  // Restore console if it was mocked
  if (global.console !== originalConsole) {
    global.console = originalConsole;
  }
  
  // Clean up any global state
  delete global.mockBrowser;
  delete global.mockPage;
});

// Clean up after all tests
afterAll(() => {
  // Restore real timers
  jest.useRealTimers();
  
  // Final cleanup
  jest.restoreAllMocks();
});