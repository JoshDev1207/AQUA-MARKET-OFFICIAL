# AquaMarket

AquaMarket is a multipage marketplace for ornamental fish, aquatic plants, supplies, and trades. This version replaces the original browser-only prototype with a Node.js API, Supabase Auth and PostgreSQL, Socket.IO messaging, and Cloudinary image uploads. The original visual design, images, and aquarium hero video are retained.

**Deploying on Vercel? Start with [VERCEL.md](VERCEL.md).** For local/provider setup, use [SETUP.md](SETUP.md). No credentials, users, listings, orders, chats, reviews, or announcements are preloaded. Real service accounts and the database migration are required before the marketplace works.

## Quick start

Requires Node.js 22 or newer.

```sh
npm ci
# Copy .env.example to .env and fill it in.
# New Supabase project: run migrations 001, then 002.
# Existing AquaMarket database: run only 002_admin_analytics.sql.
npm run build
npm start
```

Open `http://localhost:3000`. Do not open the HTML files directly or use a static-only server. For development, use `npm run dev` (rerun it after editing browser code).

## Included functionality

- Google sign-in; username/email and password login; six-digit email verification and resend during registration; password recovery; profile and avatar updates.
- Seller application and admin approval. A project owner assigns the first administrator with `npm run admin -- username`.
- Persistent sale and trade listings, 1–6 uploaded listing photos, drafts, edits, archiving, categories, search, price filters, and pagination.
- Saved favorites and carts. Transactional checkout checks the reviewed price and stock, creates one order per seller, and prevents duplicate orders when a checkout request is retried.
- Order confirmation, shipment, buyer receipt confirmation, cancellation, manual payment/refund recording, and reviews restricted to completed purchases.
- Trade offers, acceptance/decline, reservations, cancellation, and handover confirmation by both participants.
- Real Socket.IO chat with Supabase persistence, private membership checks, typing indicators, read receipts, image attachments, reconnect loading, earlier-message pagination, and deduplicated retries.
- Cloudinary uploads for listing photos, avatars, buyer reviews, announcements, and chat photos. Chat photos use authenticated delivery with expiring links.
- Administrator dashboards, seller approval, account suspension, listing/review moderation, support report responses, announcements, order CSV exports, and audit records.
- Vercel Container deployment, WebSocket-only chat with Redis Streams, shared rate limits, and a 4 MB image limit.
- Admin analytics for 7/30/90 days, daily order charts, category/stock summaries, and cached Groq recommendations grounded in aggregate metrics.
- Empty states, loading/error handling, responsive pages, and preserved visual credits.

## Payments

Orders are real database records. This package does **not** integrate a payment gateway. Buyers and sellers arrange cash, GCash, or Maya directly. Checkout starts `unpaid`; only a seller/admin can record receipt with a reference. Paid orders require a recorded refund before cancellation. No wallet charge, fake receipt, or simulated payment success occurs.

## Project layout

```text
client/                         Browser application source
public/                         HTML, CSS, built bundle, images, video
server/                         Express API, authentication, Socket.IO, uploads
supabase/migrations/            Database schema, permissions, business transactions
scripts/                        Build, syntax checks, admin bootstrap
tests/                         Isolated automated tests (no production fixtures)
.env.example                    Configuration template
SETUP.md                        Supabase, Google, Cloudinary, local and hosted setup
VERIFICATION.md                 Tested behavior and live acceptance checklist
Dockerfile                      Optional Node hosting container
Dockerfile.vercel               Vercel Container deployment
VERCEL.md                       Vercel, Redis, verification-code email and Groq setup
.env.vercel.example             Production environment template
supabase/email-templates/       Signup verification-code email template
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the exact locked dependencies |
| `npm run build` | Bundle browser code into `public/assets/js/bundle.js` |
| `npm start` | Start the Express and Socket.IO server |
| `npm run dev` | Build, then run Node with server file watching |
| `npm run check` | Check JavaScript syntax |
| `npm test` | Run database, auth, analytics, HTTP and Socket.IO tests; Redis test skips unless TEST_REDIS_URL is set |
| `npm run test:redis` | Run the two-instance test with a disposable TEST_REDIS_URL |
| `npm run admin -- your_username` | Promote your own registered account to administrator |

The ZIP includes source code, lockfile, database migration, environment template, built browser bundle, assets, and setup instructions. `node_modules` is intentionally excluded; install it using `npm ci`.
