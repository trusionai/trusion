# TRUSION AI — Deployment Guide

## Architecture

```
┌─────────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Cloudflare Pages   │─────▶│  Railway Backend │─────▶│  Anthropic API  │
│  (Frontend / PWA)   │      │  (Express.js)    │      │  (Claude AI)    │
│  public/            │      │  backend/        │      │                 │
└──────────┬──────────┘      └────────┬─────────┘      └─────────────────┘
           │                          │
           │ direct auth/RLS          ▼
           ▼                 ┌──────────────────┐
    ┌──────────────┐         │  Supabase        │
    │  Supabase    │◀────────│  (Auth + Postgres│
    │  Auth (JWT)  │         │   + RLS)         │
    └──────────────┘         └──────────────────┘
```

- **Frontend:** static files in `public/` → Cloudflare Pages (GitHub integration).
- **Backend:** Express.js in `backend/` → Railway (GitHub integration).
- **Auth/DB:** Supabase handles identity, JWT issuance, and Postgres with RLS.
- **AI:** Anthropic is called **only** from Railway. The key never reaches a browser.

Two independent trust boundaries: the browser talks to Supabase directly for auth (anon key + RLS), and to Railway with a Bearer JWT for privileged work.

---

## Step 1: GitHub Repository

```bash
git init
git add .
git commit -m "TRUSION AI — production hardening"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/trusion-ai.git
git push -u origin main
```

CI runs automatically: syntax checks, reference resolution, the demo-mode gate, the API-key-UI gate, and the storage-secret gate. **A failing gate blocks merge — do not bypass it.**

---

## Step 2: Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **Settings → API** — copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` → `SUPABASE_ANON_KEY` (public, RLS-protected)
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (**server-side only**)
3. **Authentication → Providers** — enable Email/Password, Google, Facebook as needed. Add the Pages domain to **URL Configuration → Redirect URLs**.
4. **Run the schema.** The complete, authoritative DDL is in `backend/supabase_schema.sql` (tables `user_roles`, `scan_logs`, `payment_logs`, `community_reports`, `profiles`, plus RLS policies and the signup trigger). Run it in the SQL editor:

   ```bash
   # or via psql
   psql "$DATABASE_URL" -f backend/supabase_schema.sql
   ```

5. **Verify RLS is on** for every table:

   ```sql
   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
   ```

   Every row must show `rowsecurity = true`. If any is `false`, stop — user data is exposed.

---

## Step 3: Railway Backend

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
2. **Root directory:** `backend/`. Railway picks up `Dockerfile` and `railway.json`.
3. **Variables:**

   | Variable | Value |
   |----------|-------|
   | `NODE_ENV` | `production` |
   | `PORT` | *(Railway injects — do not set)* |
   | `FRONTEND_ORIGIN` | `https://your-project.pages.dev` — exact origin, comma-separate multiples, **no wildcard** |
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key |
   | `ANTHROPIC_API_KEY` | your Anthropic key |

4. Deploy. Railway assigns a domain such as `https://trusion-api.up.railway.app`.
5. **Verify both probes:**

   ```bash
   curl -s https://trusion-api.up.railway.app/health   # expect 200, services both true
   curl -s https://trusion-api.up.railway.app/ready    # expect 200, ready:true
   ```

   If `/ready` returns **503**, read the Railway log for a `CONFIG_WARNINGS` line — it names the missing variable. Do not point the frontend at the backend until `/ready` returns 200.

---

## Step 4: Cloudflare Pages

1. **Dashboard → Pages → Create a project → Connect to Git.**
2. Settings:

   | Field | Value |
   |-------|-------|
   | Production branch | `main` |
   | Build command | *(empty — static)* |
   | Build output directory | `public` |
   | Root directory | `/` |

3. Deploy. The site appears at `https://your-project.pages.dev`.

---

## Step 5: Wire the Frontend to the Backend

The frontend reads **only** `public/config.js`. There is no in-HTML `SUPABASE_CONFIG` and no `window.TRUSION_API_BASE` any more.

Edit `public/config.js`:

```js
window.TRUSION_CONFIG = {
  API_BASE: 'https://trusion-api.up.railway.app',
  SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....',
  PRODUCTION: true
};
```

Commit and redeploy. `config.js` is served with `Cache-Control: no-store`, so changes take effect on the next load without a cache purge.

### 5a. Sync the CSP — mandatory

`public/_headers` restricts `connect-src`. If `API_BASE` points at an origin not listed there, the browser blocks every API call and the console fills with CSP violations.

```diff
- connect-src 'self' https://*.supabase.co https://trusion-api.up.railway.app;
+ connect-src 'self' https://*.supabase.co https://your-actual-api.up.railway.app;
```

Change both in the same commit.

### 5b. Fail-safe behaviour to expect

If `SUPABASE_URL` is empty, malformed, or still contains `YOUR_`, `isSupabaseConfigured()` returns `false` and the app shows:

> *"Authentication service belum dikonfigurasi. Hubungi administrator."*

This is intentional. There is **no guest or demo fallback** — a misconfigured deploy locks out rather than silently granting anonymous access.

---

## Step 6: Verify the Deployment

| # | Check | Expected |
|---|-------|----------|
| 1 | Landing page loads at the Pages URL | Renders; no console errors |
| 2 | Click **Launch App** | Auth modal appears (not a dashboard) |
| 3 | Sign in with email | Redirect to dashboard |
| 4 | Dashboard security score | "Belum dinilai" — **not** a fabricated number |
| 5 | Active Threats / Scam Alerts | Honest empty states |
| 6 | Run a Scam Analyzer scan | Network tab shows a call to the Railway origin with an `Authorization: Bearer` header — never to `api.anthropic.com` |
| 7 | Open Settings | No API-key field, no Rate Limit slider, no Reset DIL State |
| 8 | Settings → export data | JSON file downloads |
| 9 | Attempt upgrade | "Pembayaran belum dikonfigurasi" if no gateway is set |
| 10 | Railway logs | Structured JSON with `correlationId` per request |
| 11 | Logout | Returns to landing; back button does not restore the dashboard |
| 12 | Anonymous hit on a protected API route | 401 |

---

## Rollback

### Cloudflare Pages
Deployments → select last good → **⋯ → Rollback**. Instant, no rebuild.

### Railway
Deployments → select last good → **Rollback**. Redeploys the prior commit.

### Database
Supabase → **Database → Backups** → Restore.

> **Warning:** a database restore is destructive — everything after the restore point is lost. Take a manual backup before any schema migration.

---

## Reference

| Item | Value |
|------|-------|
| Production branch | `main` |
| Frontend build command | *(none — static)* |
| Frontend output directory | `public/` |
| Backend start command | `node server.js` |
| Backend root directory | `backend/` |
| Liveness probe | `GET /health` → 200 |
| Readiness probe | `GET /ready` → 200 only when Supabase **and** Anthropic are configured |
| Runtime config | `public/config.js` |
| CSP / headers | `public/_headers` |
| Icon assets | `public/assets/trusion-mark-{64,192,512}.png` — regenerate with `node scripts/gen-icons.js` |
| Pre-deploy check | `node scripts/verify-frontend.js` (also runs in CI) |
