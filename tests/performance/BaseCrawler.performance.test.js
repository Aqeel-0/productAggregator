const BaseCrawler = require('../../src/scrapers/base-crawler');

// Performance tests - run only when explicitly requested
const describeIf = process.env.RUN_PERFORMANCE_TESTS ? describe : describe.skip;

describeIf('BaseCrawler Performance Tests', () => {
  let baseCrawler;
  
  beforeAll(() => {
    // Set very long timeout for performance tests
    jest.setTimeout(300000); // 5 minutes
  });

  afterEach(async () => {
    if (baseCrawler) {
      await baseCrawler.close();
      baseCrawler = null;
    }
  });

  describe('Page Creation Performance', () => {
    test('should create pages efficiently', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxPages: 10,
          pagePoolSize: 5
        }
      });

      await baseCrawler.initialize();
      
      const iterations = 50;
      const times = [];
      
      console.log(`\n📊 Testing page creation performance (${iterations} iterations)...`);
      
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        
        const page = await baseCrawler.newPage();
        await baseCrawler.returnPageToPool(page);
        
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1000000; // Convert to milliseconds
        times.push(duration);
        
        if (i % 10 === 0) {
          console.log(`  Completed ${i + 1}/${iterations} iterations`);
        }
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      const medianTime = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];
      
      console.log(`\n📈 Page Creation Performance Results:`);
      console.log(`  Average: ${avgTime.toFixed(2)}ms`);
      console.log(`  Median: ${medianTime.toFixed(2)}ms`);
      console.log(`  Min: ${minTime.toFixed(2)}ms`);
      console.log(`  Max: ${maxTime.toFixed(2)}ms`);
      console.log(`  Pool utilization: ${baseCrawler.pagePool.length}/${baseCrawler.config.memoryManagement.pagePoolSize}`);
      
      // Performance assertions
      expect(avgTime).toBeLessThan(500); // Average should be under 500ms
      expect(medianTime).toBeLessThan(300); // Median should be under 300ms
      expect(baseCrawler.pagePool.length).toBeGreaterThan(0); // Pool should be utilized
    });

    test('should handle concurrent page operations efficiently', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxPages: 15,
          pagePoolSize: 8
        }
      });

      await baseCrawler.initialize();
      
      const concurrency = 20;
      const operationsPerWorker = 10;
      
      console.log(`\n🔄 Testing concurrent performance (${concurrency} workers, ${operationsPerWorker} ops each)...`);
      
      const startTime = process.hrtime.bigint();
      
      const workers = Array.from({ length: concurrency }, async (_, workerId) => {
        const workerTimes = [];
        
        for (let i = 0; i < operationsPerWorker; i++) {
          const opStart = process.hrtime.bigint();
          
          const page = await baseCrawler.newPage();
          await page.goto('data:text/html,<html><body><h1>Performance Test</h1></body></html>');
          await baseCrawler.delay(10, 50); // Simulate minimal work
          await baseCrawler.returnPageToPool(page);
          
          const opEnd = process.hrtime.bigint();
          workerTimes.push(Number(opEnd - opStart) / 1000000);
        }
        
        return workerTimes;
      });
      
      const allResults = await Promise.all(workers);
      const endTime = process.hrtime.bigint();
      
      const totalDuration = Number(endTime - startTime) / 1000000;
      const allTimes = allResults.flat();
      const avgOperationTime = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;
      const totalOperations = concurrency * operationsPerWorker;
      const operationsPerSecond = (totalOperations / totalDuration) * 1000;
      
      console.log(`\n⚡ Concurrent Performance Results:`);
      console.log(`  Total duration: ${totalDuration.toFixed(2)}ms`);
      console.log(`  Average operation time: ${avgOperationTime.toFixed(2)}ms`);
      console.log(`  Operations per second: ${operationsPerSecond.toFixed(2)}`);
      console.log(`  Peak active pages: ${baseCrawler.activePagesCount}`);
      console.log(`  Final pool size: ${baseCrawler.pagePool.length}`);
      
      const memStats = baseCrawler.getMemoryStats();
      console.log(`  Memory stats:`, memStats);
      
      // Performance assertions
      expect(operationsPerSecond).toBeGreaterThan(5); // At least 5 ops/sec
      expect(avgOperationTime).toBeLessThan(2000); // Average under 2 seconds
      expect(memStats.activePagesCount).toBeLessThanOrEqual(baseCrawler.config.memoryManagement.maxPages);
    });
  });

  describe('Memory Management Performance', () => {
    test('should efficiently manage memory under sustained load', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxMemoryMB: 1024,
          maxPages: 8,
          pagePoolSize: 4,
          cleanupInterval: 5000,
          memoryCheckInterval: 1000,
          forceGCInterval: 10000
        }
      });

      await baseCrawler.initialize();
      
      const testDuration = 60000; // 1 minute
      const operationInterval = 100; // Every 100ms
      const expectedOperations = testDuration / operationInterval;
      
      console.log(`\n🧠 Testing memory management under sustained load (${testDuration/1000}s)...`);
      
      let operationCount = 0;
      let memorySnapshots = [];
      
      const startTime = Date.now();
      
      const loadTest = setInterval(async () => {
        try {
          const page = await baseCrawler.newPage();
          await page.goto(`data:text/html,<html><body><div>${'x'.repeat(1000)}</div><h1>Load Test ${operationCount}</h1></body></html>`);
          await baseCrawler.returnPageToPool(page);
          operationCount++;
          
          // Take memory snapshot every 10 operations
          if (operationCount % 10 === 0) {
            const memStats = baseCrawler.getMemoryStats();
            memorySnapshots.push({
              operation: operationCount,
              timestamp: Date.now() - startTime,
              ...memStats
            });
          }
          
          if (operationCount % 50 === 0) {
            console.log(`  Completed ${operationCount} operations (${((operationCount / expectedOperations) * 100).toFixed(1)}%)`);
          }
          
        } catch (error) {
          console.error(`Operation ${operationCount} failed:`, error.message);
        }
      }, operationInterval);
      
      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, testDuration));
      clearInterval(loadTest);
      
      const finalMemStats = baseCrawler.getMemoryStats();
      
      console.log(`\n🔍 Memory Management Results:`);
      console.log(`  Total operations: ${operationCount}`);
      console.log(`  Operations per second: ${(operationCount / (testDuration/1000)).toFixed(2)}`);
      console.log(`  Final memory stats:`, finalMemStats);
      console.log(`  Peak memory: ${finalMemStats.peakMemoryMB}MB`);
      console.log(`  Pages created: ${finalMemStats.pagesCreated}`);
      console.log(`  Pages destroyed: ${finalMemStats.pagesDestroyed}`);
      console.log(`  GC forced: ${finalMemStats.gcForced}`);
      
      // Analyze memory trends
      if (memorySnapshots.length > 5) {
        const firstSnapshot = memorySnapshots[0];
        const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
        const memoryGrowth = lastSnapshot.currentMemoryMB - firstSnapshot.currentMemoryMB;
        
        console.log(`  Memory growth: ${memoryGrowth.toFixed(2)}MB over ${memorySnapshots.length} snapshots`);
        
        // Memory should not grow excessively
        expect(memoryGrowth).toBeLessThan(500); // Less than 500MB growth
      }
      
      // Performance assertions
      expect(operationCount).toBeGreaterThan(expectedOperations * 0.8); // At least 80% of expected ops
      expect(finalMemStats.peakMemoryMB).toBeLessThan(2048); // Under 2GB peak
      expect(finalMemStats.activePagesCount).toBeLessThanOrEqual(baseCrawler.config.memoryManagement.maxPages);
      expect(finalMemStats.gcForced).toBeGreaterThan(0); // GC should have been triggered
    });

    test('should handle memory pressure gracefully', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxMemoryMB: 256, // Very low limit to trigger pressure
          maxPages: 3,
          pagePoolSize: 1,
          cleanupInterval: 1000,
          memoryCheckInterval: 500
        }
      });

      await baseCrawler.initialize();
      
      console.log(`\n⚠️  Testing memory pressure handling (low memory limit: 256MB)...`);
      
      let pressureEvents = 0;
      let cleanupEvents = 0;
      let errors = [];
      
      // Override performCleanup to count events
      const originalPerformCleanup = baseCrawler.performCleanup.bind(baseCrawler);
      baseCrawler.performCleanup = async () => {
        cleanupEvents++;
        return originalPerformCleanup();
      };
      
      // Simulate memory-intensive operations
      for (let i = 0; i < 20; i++) {
        try {
          const page = await baseCrawler.newPage();
          
          // Create memory pressure with large content
          await page.goto(`data:text/html,<html><body>${'<div>'.repeat(5000)}Memory pressure test ${i}${'</div>'.repeat(5000)}</body></html>`);
          
          // Simulate memory usage check
          baseCrawler.memoryStats.currentMemoryMB = 200 + (i * 10); // Simulate growing memory
          
          try {
            await baseCrawler.checkMemoryLimits();
          } catch (memoryError) {
            pressureEvents++;
            console.log(`  Memory pressure event ${pressureEvents} at operation ${i}`);
          }
          
          await baseCrawler.returnPageToPool(page);
          
          // Small delay to allow cleanup
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          errors.push({ operation: i, error: error.message });
        }
      }
      
      const finalStats = baseCrawler.getMemoryStats();
      
      console.log(`\n📊 Memory Pressure Results:`);
      console.log(`  Pressure events: ${pressureEvents}`);
      console.log(`  Cleanup events: ${cleanupEvents}`);
      console.log(`  Errors: ${errors.length}`);
      console.log(`  Final stats:`, finalStats);
      
      if (errors.length > 0) {
        console.log(`  Error samples:`, errors.slice(0, 3));
      }
      
      // Should handle pressure gracefully
      expect(pressureEvents).toBeGreaterThan(0); // Should detect pressure
      expect(cleanupEvents).toBeGreaterThan(0); // Should perform cleanup
      expect(errors.length).toBeLessThan(10); // Should handle most operations successfully
      expect(finalStats.activePagesCount).toBeLessThanOrEqual(3); // Should respect limits
    });
  });

  describe('Navigation Performance', () => {
    test('should navigate efficiently across different page types', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxPages: 5,
          pagePoolSize: 3
        }
      });

      await baseCrawler.initialize();
      
      const testUrls = [
        'data:text/html,<html><body><h1>Simple Page</h1></body></html>',
        'data:text/html,<html><body>' + '<div>'.repeat(1000) + 'Large Content' + '</div>'.repeat(1000) + '</body></html>',
        'data:text/html,<html><body><script>for(let i=0;i<1000;i++){document.body.innerHTML += "<p>Dynamic " + i + "</p>";}</script></body></html>',
        'https://httpbin.org/html',
        'https://httpbin.org/json'
      ];
      
      console.log(`\n🌐 Testing navigation performance across ${testUrls.length} different page types...`);
      
      const results = [];
      
      for (let i = 0; i < testUrls.length; i++) {
        const url = testUrls[i];
        const iterations = 5;
        const urlResults = [];
        
        console.log(`  Testing URL ${i + 1}: ${url.substring(0, 50)}...`);
        
        for (let j = 0; j < iterations; j++) {
          const page = await baseCrawler.newPage();
          
          const start = process.hrtime.bigint();
          
          try {
            await baseCrawler.navigate(page, url);
            
            const end = process.hrtime.bigint();
            const duration = Number(end - start) / 1000000;
            urlResults.push(duration);
            
          } catch (error) {
            console.warn(`    Navigation failed for iteration ${j + 1}: ${error.message}`);
            urlResults.push(null); // Mark as failed
          }
          
          await baseCrawler.returnPageToPool(page);
        }
        
        const successfulResults = urlResults.filter(r => r !== null);
        if (successfulResults.length > 0) {
          const avgTime = successfulResults.reduce((a, b) => a + b, 0) / successfulResults.length;
          results.push({
            url: url.substring(0, 50),
            avgTime,
            successRate: (successfulResults.length / iterations) * 100
          });
          
          console.log(`    Average: ${avgTime.toFixed(2)}ms, Success: ${successfulResults.length}/${iterations}`);
        }
      }
      
      console.log(`\n📈 Navigation Performance Summary:`);
      results.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.url}: ${result.avgTime.toFixed(2)}ms (${result.successRate}% success)`);
      });
      
      const avgNavigationTime = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;
      const avgSuccessRate = results.reduce((sum, r) => sum + r.successRate, 0) / results.length;
      
      console.log(`  Overall average: ${avgNavigationTime.toFixed(2)}ms`);
      console.log(`  Overall success rate: ${avgSuccessRate.toFixed(1)}%`);
      
      // Performance assertions
      expect(avgNavigationTime).toBeLessThan(5000); // Average under 5 seconds
      expect(avgSuccessRate).toBeGreaterThan(80); // At least 80% success rate
    });
  });
});