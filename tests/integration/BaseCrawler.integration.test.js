const BaseCrawler = require('../../src/scrapers/base-crawler');
const puppeteer = require('puppeteer');

// Integration tests - these test real browser interactions
// Skip these tests in CI if no browser is available
const describeIf = process.env.CI ? describe.skip : describe;

describeIf('BaseCrawler Integration Tests', () => {
  let baseCrawler;
  
  beforeAll(async () => {
    // Set longer timeout for integration tests
    jest.setTimeout(60000);
  });

  afterEach(async () => {
    if (baseCrawler) {
      await baseCrawler.close();
      baseCrawler = null;
    }
  });

  describe('Real Browser Integration', () => {
    test('should launch real browser and create page', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxPages: 2
        }
      });

      await baseCrawler.initialize();
      expect(baseCrawler.browser).toBeDefined();

      const page = await baseCrawler.newPage();
      expect(page).toBeDefined();
      expect(baseCrawler.activePagesCount).toBe(1);

      await baseCrawler.returnPageToPool(page);
      expect(baseCrawler.pagePool.length).toBe(1);
      expect(baseCrawler.activePagesCount).toBe(0);
    });

    test('should navigate to real website', async () => {
      baseCrawler = new BaseCrawler({ headless: true });
      await baseCrawler.initialize();
      
      const page = await baseCrawler.newPage();
      
      // Navigate to a reliable test site
      await baseCrawler.navigate(page, 'https://httpbin.org/html');
      
      // Verify navigation worked
      const title = await page.title();
      expect(title).toContain('Herman Melville');
      
      await baseCrawler.returnPageToPool(page);
    });

    test('should handle page interactions', async () => {
      baseCrawler = new BaseCrawler({ headless: true });
      await baseCrawler.initialize();
      
      const page = await baseCrawler.newPage();
      
      // Navigate to a page with interactive elements
      await page.goto('data:text/html,<html><body><button id="test-btn">Click me</button><script>document.getElementById("test-btn").onclick = () => alert("clicked");</script></body></html>');
      
      // Test safe click functionality
      await baseCrawler.safeClick(page, '#test-btn');
      
      await baseCrawler.returnPageToPool(page);
    });

    test('should manage memory under load', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxPages: 3,
          pagePoolSize: 2
        }
      });

      await baseCrawler.initialize();
      
      const pages = [];
      
      // Create multiple pages
      for (let i = 0; i < 5; i++) {
        const page = await baseCrawler.newPage();
        await page.goto('data:text/html,<html><body><h1>Test Page ' + i + '</h1></body></html>');
        pages.push(page);
      }
      
      expect(baseCrawler.activePagesCount).toBeLessThanOrEqual(3);
      
      // Return pages to pool
      for (const page of pages) {
        if (!page.isClosed()) {
          await baseCrawler.returnPageToPool(page);
        }
      }
      
      expect(baseCrawler.pagePool.length).toBeLessThanOrEqual(2);
    });

    test('should handle proxy configuration', async () => {
      // Skip this test if no proxy is available
      const proxyUrl = process.env.TEST_PROXY_URL;
      if (!proxyUrl) {
        console.log('Skipping proxy test - no TEST_PROXY_URL provided');
        return;
      }

      baseCrawler = new BaseCrawler({
        headless: true,
        proxyConfig: {
          useProxy: true,
          proxyUrl: proxyUrl
        }
      });

      await baseCrawler.initialize();
      const page = await baseCrawler.newPage();
      
      // Test that proxy is working by checking IP
      await page.goto('https://httpbin.org/ip');
      const content = await page.content();
      expect(content).toContain('origin');
      
      await baseCrawler.returnPageToPool(page);
    });
  });

  describe('Error Handling Integration', () => {
    test('should handle browser crashes gracefully', async () => {
      baseCrawler = new BaseCrawler({ headless: true });
      await baseCrawler.initialize();
      
      const page = await baseCrawler.newPage();
      
      // Force browser to crash by killing the process
      if (baseCrawler.browser.process()) {
        baseCrawler.browser.process().kill('SIGKILL');
      }
      
      // Wait a bit for the crash to be detected
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to create a new page - should reinitialize browser
      const newPage = await baseCrawler.newPage();
      expect(newPage).toBeDefined();
      
      await baseCrawler.returnPageToPool(newPage);
    });

    test('should handle network timeouts', async () => {
      baseCrawler = new BaseCrawler({ headless: true });
      await baseCrawler.initialize();
      
      const page = await baseCrawler.newPage();
      
      // Try to navigate to a non-existent domain
      await expect(
        baseCrawler.navigate(page, 'http://this-domain-does-not-exist-12345.com')
      ).rejects.toThrow();
      
      await baseCrawler.returnPageToPool(page);
    });

    test('should recover from page crashes', async () => {
      baseCrawler = new BaseCrawler({ headless: true });
      await baseCrawler.initialize();
      
      const page = await baseCrawler.newPage();
      
      // Navigate to a page that might crash
      await page.goto('data:text/html,<html><body><script>setTimeout(() => { throw new Error("page crash"); }, 100);</script></body></html>');
      
      // Wait for potential crash
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Page should still be functional
      const title = await page.title();
      expect(title).toBeDefined();
      
      await baseCrawler.returnPageToPool(page);
    });
  });

  describe('Performance Integration', () => {
    test('should maintain performance under concurrent load', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxPages: 5,
          pagePoolSize: 3
        }
      });

      await baseCrawler.initialize();
      
      const startTime = Date.now();
      const promises = [];
      
      // Create concurrent navigation tasks
      for (let i = 0; i < 10; i++) {
        promises.push(async () => {
          const page = await baseCrawler.newPage();
          await page.goto(`data:text/html,<html><body><h1>Concurrent Test ${i}</h1></body></html>`);
          await baseCrawler.delay(100, 200); // Simulate work
          await baseCrawler.returnPageToPool(page);
        });
      }
      
      await Promise.all(promises.map(fn => fn()));
      
      const duration = Date.now() - startTime;
      console.log(`Concurrent load test completed in ${duration}ms`);
      
      // Should complete within reasonable time (adjust based on your needs)
      expect(duration).toBeLessThan(30000); // 30 seconds
      
      // Memory should be managed properly
      const stats = baseCrawler.getMemoryStats();
      expect(stats.activePagesCount).toBeLessThanOrEqual(5);
      expect(stats.poolSize).toBeLessThanOrEqual(3);
    });

    test('should handle memory pressure gracefully', async () => {
      baseCrawler = new BaseCrawler({
        headless: true,
        memoryManagement: {
          enabled: true,
          maxMemoryMB: 512, // Low limit to trigger cleanup
          maxPages: 3,
          pagePoolSize: 2,
          cleanupInterval: 1000, // Frequent cleanup
          memoryCheckInterval: 500
        }
      });

      await baseCrawler.initialize();
      
      // Create pages and do memory-intensive operations
      const pages = [];
      for (let i = 0; i < 5; i++) {
        const page = await baseCrawler.newPage();
        
        // Navigate to a page with some content
        await page.goto(`data:text/html,<html><body>${'<div>'.repeat(1000)}Memory test ${i}${'</div>'.repeat(1000)}</body></html>`);
        
        pages.push(page);
        
        // Allow memory management to kick in
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Return pages to pool
      for (const page of pages) {
        if (!page.isClosed()) {
          await baseCrawler.returnPageToPool(page);
        }
      }
      
      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const stats = baseCrawler.getMemoryStats();
      console.log('Memory stats after pressure test:', stats);
      
      // Should have performed some cleanup
      expect(stats.gcForced).toBeGreaterThan(0);
    });
  });
});