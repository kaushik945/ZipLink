# ZipLink implementation plan and initial audit

## Audit (before Phase 1/2 implementation)

- Existing React 19 / Vite frontend: Home, History, reusable monochrome components, BrowserRouter.
- Existing Express 5 backend: one CommonJS file, MySQL pool, POST /api/shorten, GET /api/urls, DELETE /api/urls/:id, public GET /api/short/:shortCode.
- Existing schema documented in README only: urls(id, original_url, short_code UNIQUE, clicks, created_at).
- Creation checks global duplicate destinations, then generates 8 hex characters. Uniqueness collisions become generic 500s. Duplicate checks race.
- Listing/deletion have no authentication or ownership. All URLs are public management data.
- URL constructor permits non-HTTP schemes. SQL is already parameterized. CORS is unrestricted; request limits, security headers, session protections and logging are absent.
- Redirect reads MySQL and updates clicks synchronously. No Redis, queue, analytics events, migrations, API spec, or backend tests.
- Existing test.js is a user-owned k6 load script. Preserve it and existing package edits.
- No MySQL, Redis, Docker executable on PATH at audit; k6 is installed. Infrastructure verification must be reported separately from unit/mock tests.

## Implementation sequence

1. Establish environment configuration, modular app factory, safe migrations, repositories, validation, errors and logging.
2. Add Redis-backed sessions, bcrypt passwords, synchronizer CSRF tokens, owner-scoped link APIs, compatibility routes and bounded Base62 collision retries.
3. Add cache-aside public redirects, bounded miss coalescing, configurable TTLs and invalidation.
4. Add BullMQ event producer/worker, transactional idempotency, authenticated SQL analytics and shared Redis rate limiting.
5. Extend current React pages with sign-in, link editing/options, cursor navigation and real API-driven charts.
6. Add Node test runner unit/API tests, opt-in isolated real MySQL/Redis integration, k6 scenarios, OpenAPI and operational docs.
7. Run build, tests, lint/format, available infrastructure verification; document evidence and limits. Verify private notes are ignored and untracked.

## Compatibility decisions

- Keep /api/short/:shortCode public and add /:shortCode on the API origin.
- Legacy management names remain aliases but now require authentication (intentional security change).
- Existing rows migrate with NULL ownership. No registration or login can claim them automatically.
- Preserve original schema data and click counts. Deleted codes become tombstones and cannot be reused.
- Public redirects are 302 with no-store, unavailable links are 404 and expired/disabled/deleted links are 410.
- New links require sign-in; anonymous creation is intentionally removed.
