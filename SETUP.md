# AquaMarket setup

The code is connected to real provider APIs, but no Supabase project, Google OAuth application, or Cloudinary credentials were supplied with the original archive. Complete these steps once. There is no demo mode or localStorage database fallback.

For Vercel deployment, Redis, verification-code email setup and Groq analytics, follow **[VERCEL.md](VERCEL.md)**. Existing databases need only the new migration 002; do not rerun 001.

## 1. Install and open the project

Install **Node.js 22 or newer**, extract the ZIP, and open the extracted `AquaMarket` folder in VS Code. In its terminal:

```sh
npm ci
```

On Windows PowerShell, copy the configuration template:

```powershell
Copy-Item .env.example .env
```

On macOS/Linux:

```sh
cp .env.example .env
```

Do not put passwords or server credentials in `public/` or any `client/` file.

## 2. Create the Supabase database

1. Create a new Supabase project.
2. Open its **SQL Editor**.
3. Copy the entire contents of `supabase/migrations/001_aquamarket.sql` into a new SQL query and run it once. It creates the schema, indexes, authentication trigger, permissions, and transaction functions. It inserts no records. Then run `002_admin_analytics.sql` to add the administrator analytics function. On an existing AquaMarket database, run only migration 002.
4. In the project's API settings, copy the project URL, publishable key (or legacy anon key), and the **server secret key or legacy service_role key** into `.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_or_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_server_secret_or_service_role_key
```

Use a **fresh project**. The migration is not a reset script and is not meant to be repeatedly executed over existing tables. For a Supabase CLI workflow, add this migration to your linked project's migration directory and use `supabase db push`; do not also run it manually.

The schema assumes Supabase's `auth.users`, `anon`, `authenticated`, and `service_role` roles. It is not a standalone generic PostgreSQL dump.

### Database access model

Every app table has row-level security enabled. The `anon` and `authenticated` roles have no direct table privileges or business-function execution privileges. Only the Node server's service client accesses marketplace records. The API verifies the incoming Supabase token with `auth.getUser(token)`, loads account status, checks ownership/roles, and then executes the permitted operation.

Keep the service/secret key on the server. The browser receives only the project URL and publishable/anon key. Do not add broad table policies or grants to work around configuration problems.

## 3. Enable email and password accounts

In Supabase Authentication:

1. Enable the **Email** provider and keep email confirmation enabled.
2. Set the Site URL to `http://localhost:3000` for local development.
3. Add these redirect URLs to the allow list:
   - `http://localhost:3000/auth-callback.html`
   - `http://localhost:3000/reset-password.html`
4. Configure custom SMTP for public email delivery. Resend SMTP is documented in VERCEL.md and requires a verified sending domain. Paste `supabase/email-templates/confirm-signup.html` into Supabase's **Confirm sign up** email template so new accounts receive the six-digit `{{ .Token }}` code. Keep email confirmation enabled. Supabase's default sender is unsuitable for public registration.
5. Set a suitable password policy; the registration interface requires at least 10 characters.

A new password account supplies a unique username, full name, email, and password. The user enters the emailed six-digit code on `/verify-email.html` (with a resend option), then logs in using either the **username** or **email**, plus the password. The server resolves the username internally; it never exposes a username-to-email lookup endpoint.

Verification codes can be entered on the verification page without opening a link. Password recovery continues to use a PKCE link: open it in the same browser that requested the reset. Google OAuth still returns through the callback page.

## 4. Enable Google sign-in

1. Create/configure a Google Cloud project and its OAuth consent screen (Google Auth Platform).
2. Create a **Web application** OAuth client.
3. Add `http://localhost:3000` as an authorized JavaScript origin.
4. Add your Supabase callback as an authorized redirect URI:
   `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
5. Copy the Google Client ID and Client Secret into the **Google provider** settings in Supabase Authentication, and enable the provider.
6. If the Google app is in testing mode, add your intended test users. Configure its audience/publication as appropriate before opening the marketplace to everyone.

Google's redirect goes to **Supabase**, which then returns the user to AquaMarket's `/auth-callback.html`. These are different URLs and both must be configured correctly.

Google users get a unique generated username. They can choose another available username from their profile. To add password login, they can use **Forgot password** with their Google account's email and set a password through the emailed link.

## 5. Connect Cloudinary

Create a Cloudinary product environment. Copy its cloud name, API key, and API secret from the console into `.env`:

```dotenv
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

No unsigned upload preset is required. Files go through the authenticated Node upload endpoint. It checks size and file signatures, then uploads with Cloudinary's server SDK.

- File formats: JPEG, PNG, WebP.
- Maximum incoming size: 4 MB (4,000,000 bytes) per file.
- Maximum listing gallery: 6 photos.
- Images are resized to fit within 2000 × 2000 pixels; metadata profiles are stripped.
- Public images use Cloudinary's normal upload delivery.
- Chat images use `authenticated` delivery; only participants receive a download URL, valid for 5 minutes. A recipient can save any photo you send, so a signed URL is not protection against the recipient sharing it.

If you start an upload then abandon the form, the image remains in Cloudinary/media storage. Monitor usage and remove unreferenced old uploads as part of maintenance; no automatic media deletion job is included.

## 6. Start the application

Ensure these settings match the address you open:

```dotenv
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
TRUST_PROXY=0
```

Then run:

```sh
npm run build
npm start
```

Open **http://localhost:3000**. Do not use `file://`, VS Code Live Server, XAMPP-only static hosting, or the original static Vercel configuration. This project now needs its Node API and long-lived Socket.IO server.

Register your first account, confirm its email, and sign in. There should be **zero listings, conversations, orders, and reviews** on a fresh database.

## 7. Create the first administrator

After registering your own account, run in the project terminal:

```sh
npm run admin -- your_username
```

This server-side command promotes only the named existing account. It uses `.env`; it is not exposed as a public API. Sign out and back in, then open:

```text
http://localhost:3000/admin/index.html
```

There are no pre-created admin credentials. Other users cannot promote themselves through registration or profile editing. Existing administrators cannot be suspended through the ordinary users moderation screen; the project owner manages those accounts in Supabase or with controlled server access.

Sellers submit their store details at **Seller account**. Approve them under **Administration → Sellers**. Approved sellers and administrators can create sale/trade listings and upload photos.

## 8. How checkout and fulfillment work

1. A signed-in buyer adds available sale listings to their cart.
2. Checkout submits the reviewed listing IDs, prices, and quantities with an idempotency key.
3. PostgreSQL locks the buyer/cart and listing rows, checks the current stock and prices, creates one order per seller, decrements stock, and clears the cart in one transaction.
4. Orders start `pending` and `unpaid`.
5. The seller confirms, arranges payment/handover, records actual payment with a receipt/reference note, and marks shipment when appropriate.
6. The buyer confirms receipt to complete a paid order. Completed purchases can be reviewed.
7. Pending/confirmed orders can be cancelled, restoring stock once. If money was recorded as received, record its refund before cancelling. No funds are moved by those status actions.

There is no payment gateway or automatic delivery fee calculator in this build. GCash and Maya are **manual arrangements**, clearly labelled in the interface. Do not interpret an order placement as a wallet charge.

For trades, the recipient accepts or declines. Acceptance reserves both listings. Each person confirms their handover; the trade finishes when both have confirmed. Once either handover is confirmed, cancellation requires support/coordination rather than resetting the listings as available.

## 9. Hosting

For **Vercel Container deployment**, use `Dockerfile.vercel` and follow VERCEL.md. Redis is required there. Alternatively, deploy as a Node web service with WebSocket support. Keep the frontend and API on the same origin.

- Install/build: `npm ci && npm run build`
- Start: `npm start`
- Health endpoint: `/healthz` (checks process/config presence, not cloud connectivity)
- Add the `.env` values as private environment variables in the hosting dashboard.
- Set `NODE_ENV=production` and `APP_URL=https://your-domain.example` with **no trailing slash**.
- Add that origin to Google's authorized origins and add the deployed callback/reset URLs to Supabase's redirect allow list. Set Supabase's production Site URL.
- The host may supply `PORT`; the server listens on `0.0.0.0`.
- Use HTTPS. Ensure the proxy supports WebSocket upgrades and idle connections.
- Set `TRUST_PROXY=1` only when exactly one trusted reverse proxy is in front of Node. Otherwise use the topology-appropriate setting. A wrong value can break IP rate limiting.

The included Dockerfile is an alternative:

```sh
docker build -t aquamarket .
docker run --env-file .env -p 3000:3000 aquamarket
```

With `REDIS_URL` configured, this release uses the Redis Streams adapter and shared HTTP/socket rate limits across instances. WebSocket-only transport avoids sticky sessions. Without Redis, only local development or a single non-Vercel Node instance is supported. Vercel refuses to start without Redis. See VERCEL.md for Groq admin analytics and email verification setup.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| “AquaMarket is almost ready” | Fill `.env`, remove `YOUR_` placeholders, restart Node |
| Database request failed | Correct URL/server key; migration ran in that project; schema API exposed; inspect server error code |
| Username login fails | Exact username, confirmed email, correct password, active account |
| Registration confirmation does not arrive | SMTP, email limits, spam folder, Supabase Auth logs |
| Google redirect mismatch | Google's Supabase callback URI, Google origins, Supabase Site URL and redirect allow list |
| “Seller approval is required” | Apply, then approve the account using a real admin |
| Cannot create a first listing | Upload at least one photo, configure Cloudinary, select a valid category and visibility |
| Image upload fails | Cloudinary cloud name/key/secret match; accepted format; file below 4 MB (4,000,000 bytes) |
| Chat does not connect | APP_URL exactly matches browser origin; WebSocket-capable hosting; same-origin frontend/API; active login |
| Old photos in an open chat cannot reload | Press Refresh to obtain new expiring attachment links |
| Missing HTML page on static hosting | Start the Node server and serve only its `public/` directory through that server |

## Provider references

- Supabase Google authentication: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase password authentication: https://supabase.com/docs/guides/auth/passwords
- Supabase database RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Socket.IO authentication middleware: https://socket.io/docs/v4/middlewares/
- Socket.IO delivery guarantees: https://socket.io/docs/v4/delivery-guarantees/
- Cloudinary Node uploads: https://cloudinary.com/documentation/node_image_and_video_upload
