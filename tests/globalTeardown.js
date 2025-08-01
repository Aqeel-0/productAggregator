// Global teardown - runs once after all tests
module.exports = async () => {
  console.log('🧹 Cleaning up after test suite...');
  
  // Clean up any global resources
  if (global.testBrowser) {
    try {
      await global.testBrowser.close();
    } catch (error) {
      console.warn('Error closing test browser:', error.message);
    }
  }
  
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }
  
  console.log('✅ Global test teardown completed');
};