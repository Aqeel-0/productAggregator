# Scraper Functional Test Suite

Comprehensive automated tests for all web scrapers (Amazon, Flipkart, Croma, Reliance).

## 🎯 What These Tests Do

These tests validate all critical scraper functionality:

1. **Link Collection** - Verifies scrapers can collect product links from category pages
2. **Data Extraction** - Verifies scrapers can extract product details (title, price, etc.)
3. **Checkpoint Recovery** - Verifies scrapers can stop and resume from checkpoints
4. **Deduplication** - Verifies no duplicate products are collected
5. **Progress Tracking** - Verifies progress bars and counters are accurate

## 🚀 Quick Start

### Run All Scrapers (Standard Test)
```bash
npm run test:scrapers
```

### Run Specific Scraper
```bash
# Test only Amazon
npm run test:scrapers amazon

# Test only Flipkart
npm run test:scrapers flipkart

# Test only Croma
npm run test:scrapers croma

# Test only Reliance
npm run test:scrapers reliance
```

### Quick Test (Fast, 3 products)
```bash
npm run test:scrapers:quick
# or
node tests/scrapers/run-scraper-tests.js --quick
```

### Full Test (Thorough, 10 products)
```bash
npm run test:scrapers:full
# or
node tests/scrapers/run-scraper-tests.js --full
```

## 📋 Test Details

### Test 1: Link Collection
**Purpose:** Verify the scraper can collect product links from category pages

**What it tests:**
- Scraper can navigate to category page
- Product links are extracted correctly
- Links are saved to checkpoint file
- Page numbers are tracked correctly

**Expected outcome:** Checkpoint file created with 5+ product links

---

### Test 2: Data Extraction
**Purpose:** Verify the scraper can extract product details

**What it tests:**
- Scraper can navigate to product pages
- Product details (title, price, images, etc.) are extracted
- Data is saved to output file
- Failed products are tracked in checkpoint
- Progress tracking is accurate

**Expected outcome:** 
- Output file created with 3-5 products
- All products have required fields (url, title)
- Progress tracking shows accurate counts

---

### Test 3: Checkpoint Recovery
**Purpose:** Verify the scraper can stop and resume

**What it tests:**
- First run: Process 2 products, save checkpoint
- Second run: Resume from checkpoint, process more products
- Verify: Second run continues from where first run stopped
- Verify: No data duplication or inconsistencies

**Expected outcome:**
- Second run processes additional products
- lastProcessedIndex increases
- Previously processed products remain unchanged
- No duplicate data

---

### Test 4: Deduplication
**Purpose:** Verify no duplicate products are collected

**What it tests:**
- No duplicate URLs in productLinks array
- No duplicate products in output data
- URL normalization working correctly

**Expected outcome:** 
- Zero duplicates in checkpoint
- Zero duplicates in output data

---

### Test 5: Progress Tracking
**Purpose:** Verify progress tracking is accurate

**What it tests:**
- lastProcessedIndex matches actual processed count
- Products saved + failed = products processed
- lastPageScraped matches pagesScraped array
- Success rate calculation is correct

**Expected outcome:** All progress counters are accurate

## 📊 Understanding Test Results

### Success Output Example:
```
✓ amazon - Link Collection
   Links collected: 24
   Pages scraped: 1

✓ amazon - Data Extraction  
   Products extracted: 5
   Failed products: 0
   Progress accurate: Yes

✓ amazon - Checkpoint Recovery
   First run products: 2
   Second run products: 5
   Additional products: 3
   Resume successful: Yes
```

### Failure Output Example:
```
✗ flipkart - Link Collection
   Error: No product links collected

✗ flipkart - Checkpoint Recovery
   Error: Scraper did not resume - processed index did not increase
```

## 🔧 Configuration

### Default Settings
- **Max Products:** 5 per test (fast but thorough)
- **Max Pages:** 1 page per scraper
- **Timeout:** 120 seconds per test
- **Headless:** true (no browser window)

### Customizing Tests

Edit `tests/scrapers/scraper-functional.test.js`:

```javascript
const TEST_CONFIG = {
  maxProducts: 10,  // Change to test with more products
  timeout: 180000,  // Increase timeout for slow connections
  scrapers: ['amazon']  // Test only specific scrapers
};
```

## 🧹 Test Cleanup

Tests automatically clean up after themselves:
- Deletes test checkpoint files
- Deletes test output files  
- Closes browser instances

Test files use `test_` prefix to avoid conflicts with real scraper data.

## 🐛 Troubleshooting

### Test Timeout
If tests timeout, increase the timeout value or reduce maxProducts:
```javascript
const TEST_CONFIG = {
  maxProducts: 3,
  timeout: 180000
};
```

### Network Errors
If scrapers can't connect to websites:
- Check internet connection
- Verify website URLs are still valid
- Check if websites are blocking automated access

### Checkpoint Errors
If checkpoint validation fails:
- Check scraper checkpoint structure matches requirements
- Verify all required fields are present
- Check that checkpoint file is valid JSON

### Browser Launch Errors
If browser won't launch:
- Ensure Puppeteer dependencies are installed
- Try with `headless: false` to see browser window
- Check Chrome/Chromium is installed

## 📁 File Structure

```
tests/scrapers/
├── README.md                      # This file
├── test-helpers.js                # Utility functions for validation
├── scraper-functional.test.js     # Main test suite
└── run-scraper-tests.js           # Test runner script
```

## 🔄 Running Tests After Code Changes

### Quick Check (After Minor Changes)
```bash
npm run test:scrapers:quick
```

### Full Validation (After Major Changes)
```bash
npm run test:scrapers:full
```

### Specific Scraper (If Changes Are Isolated)
```bash
npm run test:scrapers amazon
```

## 📝 Adding New Tests

To add a new test to the suite:

1. Open `tests/scrapers/scraper-functional.test.js`
2. Add new test method following the pattern:
```javascript
async testNewFeature(scraperName, config) {
  const testName = `${scraperName} - New Feature`;
  console.log(`\n📝 Test: ${testName}`);
  
  try {
    // Test code here
    
    this.addResult(scraperName, testName, 'PASS', null, {
      'Detail 1': value1,
      'Detail 2': value2
    });
  } catch (error) {
    this.addResult(scraperName, testName, 'FAIL', error.message);
  }
}
```
3. Call the test method in `testScraper()` method

## 🎓 Best Practices

1. **Run tests before committing major changes**
2. **Test all scrapers if you changed BaseCrawler**  
3. **Test specific scraper if you changed scraper-specific code**
4. **Use --quick for rapid iteration**
5. **Use --full before pushing to production**

## ❓ FAQ

**Q: How long do tests take?**
A: Quick (~2-5 minutes), Standard (~5-10 minutes), Full (~10-20 minutes)

**Q: Can I test while scraping?**
A: Yes, tests use separate `test_` prefixed files

**Q: Do tests require internet?**
A: Yes, tests scrape real websites

**Q: Will tests count against rate limits?**
A: Tests use small product counts to minimize impact

**Q: Can I test in CI/CD?**
A: Yes, tests support headless mode and exit with proper codes

## 📞 Support

If you encounter issues with tests:
1. Check this README
2. Review test output for specific error messages
3. Enable debug mode: `DEBUG=true npm run test:scrapers`
4. Check that scraper configurations are up to date

