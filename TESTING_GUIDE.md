# Scraper Testing Guide

## 🎯 Quick Reference

### Smoke Test (RECOMMENDED FIRST) - Fast & No Scraping

```bash
# Validates scraper structure without actual scraping (~10 seconds)
npm run test:scrapers:smoke
```

### After Making Changes

```bash
# Quick check (3 products, ~2-5 min)
npm run test:scrapers:quick

# Standard test (5 products, ~5-10 min)  
npm run test:scrapers

# Full validation (10 products, ~10-20 min)
npm run test:scrapers:full
```

### Test Specific Scraper

```bash
npm run test:scrapers:amazon
npm run test:scrapers:flipkart
npm run test:scrapers:croma
npm run test:scrapers:reliance
```

## 📊 What Gets Tested

Each scraper is tested for:

1. ✅ **Link Collection** - Can collect product links from category pages
2. ✅ **Data Extraction** - Can extract product details (title, price, etc.)
3. ✅ **Checkpoint Recovery** - Can stop and resume from checkpoints
4. ✅ **Deduplication** - No duplicate products collected
5. ✅ **Progress Tracking** - Progress counters are accurate

## 🚦 When to Run Tests

### Before Committing
```bash
npm run test:scrapers:quick
```

### After Major Refactoring
```bash
npm run test:scrapers:full
```

### When Changing BaseCrawler
```bash
npm run test:scrapers  # Test all scrapers
```

### When Changing Specific Scraper
```bash
npm run test:scrapers:amazon  # Only test Amazon
```

## 📋 Understanding Results

### ✅ All Tests Pass
```
📊 FINAL SUMMARY
Total Tests: 20
✓ Passed: 20
✗ Failed: 0
○ Skipped: 0
```
**Action:** You're good to commit!

### ❌ Some Tests Fail
```
✗ amazon - Link Collection
   Error: No product links collected
```
**Action:** Fix the issue before committing

### ○ Some Tests Skip
```
○ reliance - Configuration
   Scraper not configured
```
**Action:** Normal if scraper not yet implemented

## 🔧 Common Issues

### Test Timeout
**Symptom:** Test hangs or times out  
**Solution:** Check internet connection, reduce product count, or increase timeout

### Network Errors  
**Symptom:** "Navigation timeout" or "Failed to fetch"  
**Solution:** Check if websites are accessible, try again later

### Checkpoint Errors
**Symptom:** "Missing required field in checkpoint"  
**Solution:** Check scraper creates proper checkpoint structure

### Browser Errors
**Symptom:** "Failed to launch browser"  
**Solution:** Ensure Puppeteer/Chrome is installed properly

## 📁 Test Files Location

```
tests/scrapers/
├── README.md                 # Detailed documentation
├── test-helpers.js           # Utility functions
├── scraper-functional.test.js  # Main test suite
└── run-scraper-tests.js      # Test runner
```

## 🎓 Best Practices

1. ✅ Run quick tests during development
2. ✅ Run full tests before pushing
3. ✅ Test specific scraper when making isolated changes
4. ✅ Check test output for specific failures
5. ✅ Keep test files separate (use `test_` prefix)

## 📞 Need Help?

See detailed documentation: `tests/scrapers/README.md`

## 💡 Pro Tips

- Use `--quick` for rapid iteration during development
- Use `--full` for thorough validation before production
- Test files won't interfere with real scraping (separate file names)
- Tests automatically clean up after themselves
- You can run tests while other scrapers are running

---

**Remember:** These tests help ensure your changes don't break existing functionality! 🛡️

