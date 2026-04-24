# Crawler Reliability — Abort, Resume, Retry

## Task 1 — SIGINT/SIGTERM handler (all 4 crawlers)

**Problem:** Ctrl+C or a process kill flushes nothing. Any work since the last saved checkpoint batch is lost.

**What to do:** In each crawler's `start()`, register signal handlers before starting work. On signal, set a flag that tells the running batch to stop accepting new tasks, wait for in-flight tasks to complete, save checkpoint, then exit cleanly.

**Pattern to implement (identical in all 4):**
```js
async start() {
  this._stopping = false;

  const onSignal = async (signal) => {
    this.logger.warn(`${signal} received — saving checkpoint and shutting down...`);
    this._stopping = true;
    this.saveCheckpoint();
    await this.shutdown();
    process.exit(0);
  };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));

  // ... rest of start()
}
```

**Where to add the `_stopping` check:**
- In `scrapeProductDetails` — check `this._stopping` at the top of each batch loop iteration and `break` if true
- In `scrapeProductLinks` — same, break the page loop

**Files:** All 4 crawlers — `amazonElectronicsCrawler.js`, `flipkartMobileCrawler.js`, `cromaCrawler.js`, `relianceCrawler.js`

---

## Task 2 — Fix rate-limit retry-budget bug (Flipkart, Croma, Reliance)

**Problem:** The rate-limit check sits inside the retry `for` loop. On each `continue`, the loop increments `attempt`. So 3 consecutive rate-limit waits exhaust all 3 retries without ever making a single scrape attempt. The product gets marked as failed having never been tried.

**Current (broken) pattern in all 3:**
```js
for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
  const rl = await this.rateLimiter.checkLimit(...);
  if (!rl.allowed) {
    await wait(delay);
    continue;  // ← attempt++ fires here — burns a retry slot
  }
  try { return await scrape(); }
  catch { backoff; }
}
```

**Fixed pattern:**
```js
// Rate-limit is scheduling, not failure — resolve it before the retry loop
while (true) {
  const rl = await this.rateLimiter.checkLimit(...);
  if (rl.allowed) { this._currentRateResult = rl; break; }
  this.logger.rateLimit(this.rateLimiter.calculateDelay(rl));
  await new Promise(r => setTimeout(r, this.rateLimiter.calculateDelay(rl)));
}

for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
  try {
    const productData = await scrape();
    await new Promise(r => setTimeout(r, adaptiveDelay));
    return productData;
  } catch (error) {
    if (attempt < this.maxRetries) await backoff(attempt);
  }
}
throw lastError;
```

**Files:** `flipkartMobileCrawler.js`, `cromaCrawler.js`, `relianceCrawler.js` — `processProductWithRetry()` in each.

---

## Task 3 — Add `retryFailedProducts()` to Flipkart and Reliance

**Problem:** Both crawlers accumulate failures in `checkpoint.failedProducts` but never act on them. They grow indefinitely run after run.

**What to do:** Add a `retryFailedProducts()` method to each and call it from `start()` after the main pass, mirroring what Croma does (which is the correct implementation — it calls `processProductWithRetry` so each failed product still gets full backoff).

**Pattern to add to both:**
```js
async retryFailedProducts() {
  const failed = [...this.checkpoint.failedProducts];
  this.checkpoint.failedProducts = [];

  const batchSize = this.maxConcurrent;
  const results = [];

  for (let i = 0; i < failed.length; i += batchSize) {
    const batch = failed.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map((fp, k) => this.processProductWithRetry(fp.url, fp.index, false))
    );

    settled.forEach((res, k) => {
      if (res.status === 'fulfilled' && res.value) {
        results.push(res.value);
      } else {
        const fp = batch[k];
        const attempts = (fp.retryAttempts || 0) + 1;
        this.checkpoint.failedProducts.push({
          ...fp,
          retryAttempts: attempts,
          giveUp: attempts >= this.maxRetries * 2
        });
      }
    });

    if (results.length > 0) {
      this.saveData([...results]);
      results.length = 0;
    }
    this.saveCheckpoint();
  }
}
```

**Call site in `start()` for both** — add after detail scraping, before `completeScraper`:
```js
if (this.checkpoint.failedProducts.filter(f => !f.giveUp).length > 0) {
  this.logger.info(`Retrying ${this.checkpoint.failedProducts.length} failed products`);
  await this.retryFailedProducts();
}
```

**Files:** `flipkartMobileCrawler.js`, `relianceCrawler.js`

---

## Task 4 — Make retry passes concurrent (Amazon, Croma)

**Problem:** Both `retryFailedProducts()` implementations loop one product at a time. With `maxConcurrent = 10` you're using 1 worker for the retry pass.

**Current (Amazon):**
```js
for (const failedProduct of failedProducts) {
  // sequential — one at a time
  await this.cluster.execute(...);
}
```

**Fixed (Amazon specifically — needs manual cluster.execute batching since it doesn't have processProductWithRetry):**
```js
async retryFailedProducts() {
  const failed = [...this.checkpoint.failedProducts].filter(f => !f.giveUp);
  this.checkpoint.failedProducts = [...this.checkpoint.failedProducts.filter(f => f.giveUp)];

  const batchSize = this.maxConcurrent;
  const results = [];

  for (let i = 0; i < failed.length; i += batchSize) {
    const batch = failed.slice(i, i + batchSize);
    const settled = await Promise.allSettled(batch.map(fp =>
      this.cluster.execute({ url: fp.url }, async ({ page, data }) => {
        await this.configurePage(page);
        await page.goto(data.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return await this.extractProductData(page);
      }).then(data => ({ url: fp.url, ...data }))
    ));

    settled.forEach((res, k) => {
      if (res.status === 'fulfilled' && res.value) {
        results.push(res.value);
      } else {
        const fp = batch[k];
        const attempts = (fp.retryAttempts || 0) + 1;
        this.checkpoint.failedProducts.push({
          ...fp,
          retryAttempts: attempts,
          giveUp: attempts >= 3
        });
      }
    });

    if (results.length > 0) { this.saveData([...results]); results.length = 0; }
    this.saveCheckpoint();
  }
}
```

**Croma** — replace its sequential `for...of` with the same batch pattern, calling `processProductWithRetry` as it already does.

**Files:** `amazonElectronicsCrawler.js`, `cromaCrawler.js`

---

## Task 5 — Add `giveUp` classification (all 4 crawlers)

**Problem:** A product that permanently 404s gets retried on every single run forever. At scale this is a meaningful tax.

**What to do:**
- Add `giveUp: boolean` field to every entry pushed into `checkpoint.failedProducts`
- A product is given up when `retryAttempts >= maxRetries * 2` (exhausted both the in-loop pass and the end-of-run pass)
- In `retryFailedProducts()`, filter out `giveUp: true` entries before retrying
- Log given-up products at warn level so they're visible

**Where to add the giveUp flag:** Every place a product is pushed into `checkpoint.failedProducts`:

In `scrapeProductDetails` (all crawlers):
```js
// No change here — retryAttempts starts at 0, giveUp is set in retryFailedProducts
this.checkpoint.failedProducts.push({ index, url, error: errMsg, timestamp: new Date().toISOString() });
```

In `retryFailedProducts` (all crawlers):
```js
const attempts = (fp.retryAttempts || 0) + 1;
this.checkpoint.failedProducts.push({
  ...fp,
  retryAttempts: attempts,
  giveUp: attempts >= this.maxRetries * 2
});
// Log given-up entries
if (attempts >= this.maxRetries * 2) {
  this.logger.warn(`Giving up on ${fp.url} after ${attempts} total attempts`);
}
```

In `retryFailedProducts`, filter before the loop:
```js
const toRetry = failed.filter(fp => !fp.giveUp);
// re-add giveUp entries untouched so they stay in checkpoint as a record
this.checkpoint.failedProducts.push(...failed.filter(fp => fp.giveUp));
```

**Files:** All 4 crawlers.

---

## Implementation order

1. Task 5 (giveUp) — touches the fewest lines, pure addition, no logic change. Do this first so the giveUp field is in place before wiring up the retry pass changes.
2. Task 2 (rate-limit fix) — fixes a correctness bug, isolated to `processProductWithRetry` in 3 files.
3. Task 3 (add `retryFailedProducts` to Flipkart and Reliance) — medium scope, copy pattern from Croma.
4. Task 4 (make retry passes concurrent) — refactor Amazon and Croma's existing retry pass.
5. Task 1 (SIGINT/SIGTERM) — last because it touches `start()` in all 4 files and is the most structural change.

## Files affected

| File | Task 1 | Task 2 | Task 3 | Task 4 | Task 5 |
|---|---|---|---|---|---|
| amazonElectronicsCrawler.js | ✅ | — | — | ✅ | ✅ |
| flipkartMobileCrawler.js | ✅ | ✅ | ✅ | — | ✅ |
| cromaCrawler.js | ✅ | ✅ | — | ✅ | ✅ |
| relianceCrawler.js | ✅ | ✅ | ✅ | — | ✅ |
