# AggreMart – Claude Code Rules

## Project Overview
Node.js product aggregator (AggreMart) that crawls Amazon, Flipkart, Reliance, and Croma, normalises listings, and stores them in PostgreSQL (Sequelize) + Supabase. Key layers: scrapers → normalizers → ingestion services → DB models.

---

## Mandatory Behaviors

### Output & Files
- Never create `.md`, `.txt`, or documentation files unless explicitly asked.
- Never leave scratch files, test scripts, or one-off utilities in the repo after they've served their purpose — delete them before finishing a task.
- Prefer editing existing files over creating new ones. Only create a new file when it genuinely warrants its own module.

### Code Quality
- Always design with **scalability and maintainability** as first-class constraints — prefer extension over modification, thin services over fat controllers, clear boundaries between layers.
- Double-check every change: re-read modified files after edits to confirm correctness and absence of regressions.
- No placeholder code, no TODO comments, no half-finished implementations. Every change must be complete and working.
- Write no comments unless the *why* is non-obvious (hidden constraint, workaround, subtle invariant). Never comment *what* the code does.
- No unnecessary abstractions — three similar lines is better than a premature helper. Build for current requirements only.
- No defensive error handling for scenarios that cannot happen. Validate only at system boundaries (HTTP input, external API responses).
- Delete dead code rather than commenting it out.

### Approach
- If a better architectural approach exists, proactively suggest it with a one-sentence tradeoff before implementing.
- For complex or ambiguous tasks, ask clarifying questions upfront — but batch all questions into one message, not one per prompt.
- For straightforward tasks, execute immediately without asking.
- Always verify that changes don't break existing scrapers, normalizers, or ingestion pipelines before declaring work done.

---

## Architecture Principles (project-specific)

- **Scrapers** (`src/scrapers/`) must extend `base-crawler.js` — never bypass the base class.
- **Normalizers** (`src/services/*_normalizer.js`) must be pure, stateless functions — no side effects, no DB calls.
- **Ingestion** (`src/services/ingestion.js`, `supabaseIngestion.js`) is the only layer allowed to write to the database.
- **Models** (`src/database/models/`) — no business logic inside Sequelize models.
- Rate-limiter configs live in `src/rate-limiter/configs/` — one file per site, never hardcode limits inline.
- Environment-specific values belong in `.env` — never hardcode URLs, credentials, or thresholds in source files.

---

## Coding Standards

- ES modules style consistent with existing codebase (CommonJS `require`/`module.exports`).
- Async/await everywhere — no raw `.then()` chains.
- Winston logger (`src/utils/logger.js`) for all logging — never use `console.log` in production paths.
- Validate external input (HTTP requests, scrape responses) with Joi at the boundary; trust internal data.
- Keep functions small and single-purpose. If a function needs a paragraph to describe, split it.

---

## Testing

- Tests live in `tests/` — never add test files to `src/`.
- Use real DB / real responses in integration tests; do not mock internal services.
- Remove any test helper scripts from the project root immediately after use.
- Run `npm run lint:check` and the relevant Jest suite before marking a task complete.

---

## Proactive Checks

Before finishing any task:
1. Re-read every file touched and confirm the diff is correct.
2. Check no new unnecessary files were created.
3. Confirm no existing functionality was silently broken.
4. If a better pattern is visible (e.g., a normalizer violating purity, a scraper bypassing rate-limiter), flag it.
