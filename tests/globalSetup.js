// Global setup - runs once before all tests
module.exports = async () => {
  console.log('🚀 Starting test suite...');
  
  // Set up test database if needed
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/aggregatorDB_test';
  
  // Disable memory management intervals during tests to avoid interference
  process.env.DISABLE_MEMORY_MANAGEMENT = 'true';
  
  // Set up test-specific configurations
  process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
  process.env.PUPPETEER_EXECUTABLE_PATH = process.env.CHROME_BIN || '/usr/bin/google-chrome';
  
  // Increase memory limit for tests
  process.env.NODE_OPTIONS = '--max-old-space-size=4096';
  
  console.log('✅ Global test setup completed');
};