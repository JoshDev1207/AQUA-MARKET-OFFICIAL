# AquaMarket 2.1 verification

## Completed in this update

- JavaScript syntax check and browser build passed.
- **27 automated tests passed, 0 failed, 0 skipped**, with an isolated real Redis 7.2 server supplied through `TEST_REDIS_URL`.
- Actual Socket.IO clients on two different Express instances exchanged messages through Redis, including typing, read receipts, cross-instance HTTP fallback and reconnecting to another instance. Shared HTTP/socket rate limits, Redis readiness failure, AI cache and ownership-checked analysis locks were exercised.
- Signup code verification delegates to Supabase Auth and validates the resulting account before returning a session. Invalid codes, suspended accounts, generic resend responses and server-enforced resend cooldown were checked using a mocked Auth provider.
- Analytics migration 002 ran twice successfully on an isolated PostgreSQL engine. Tests checked administrator permissions, ordinary-role denial, empty figures, completed/paid calculations, cancellation/unpaid exclusion, category totals and preceding-period comparisons.
- AI tests verified aggregate-only prompt projection, validated output, caching, empty-data handling, non-admin denial, provider rate-limit errors and incomplete/invalid response handling. Groq network responses were mocked; no API key was supplied.
- Vercel configuration validation, private-file protection, WebSocket-only transport, cache headers, the upload limit and served asset sizes were checked.
- Chromium browser checks passed for registration → verification code → profile, invalid-code messaging, resend cooldown, the analytics page, escaped AI text, period selection and both new pages at desktop/mobile sizes. No uncaught browser errors or page-width overflow were found. The new views were visually inspected.
- The aquarium video retains its original 1440 × 810 dimensions and 12.1121-second duration, compressed from 5,945,947 to 2,827,093 bytes for Vercel responses.

## Existing behavior retained

The suite also covers the original authentication trigger, role permissions, listing/image ownership, transactional checkout and stock checks, multi-seller orders, retry idempotency, payment/refund permissions, trades, private conversations, forged tokens, disguised uploads and setup states without demo records.

The previous release had 16 guest and 25 member/admin browser page checks. This update focused browser verification on the changed email and analytics flows; those previous counts are not presented as a new full browser sweep.

## How to reproduce tests

```sh
npm ci
npm run check
npm run build
npm test
```

Without `TEST_REDIS_URL`, the Redis integration test is explicitly skipped. To include it, point that variable to a **disposable test Redis database**, then run `npm test` or `npm run test:redis`. Do not use production Redis. Test data exists only inside tests and is never seeded into the running marketplace.

Database tests use PGlite's PostgreSQL engine with isolated roles and a test `auth.users` scaffold. They do not reproduce hosted Supabase network behavior or load capacity. The two-instance Redis test uses real transport with a test database/Auth adapter; the separate Socket.IO test executes the real message SQL. Browser checks use API fixtures.

## Live setup still required

Vercel deployment, Docker image build, live Supabase Auth/PostgREST, Resend email delivery, Google OAuth, successful Cloudinary uploads and live Groq generation were not exercised against the owner's accounts. No provider secrets were supplied and this ZIP does not claim the site is already deployed.

Follow VERCEL.md, run the required migration, configure the email template/SMTP and environment variables, then use two real accounts to verify signup codes, password/Google login, uploads, chat/reconnects, admin insights, checkout and trade handovers. Payments remain manually arranged and recorded; no payment gateway is included.
