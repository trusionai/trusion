# TRUSION AI — Environment Variables

Complete reference for every variable the application reads, where it is set, and whether it may be exposed to the browser.

> **CRITICAL:** Variables marked **SERVER-SIDE ONLY** must never appear in browser code, client bundles, or the frontend repository. They exist only in Railway environment variables or in `.env` files that `.gitignore` excludes.

---

## 1. Frontend Runtime Config (Cloudflare Pages)

The frontend reads its configuration from `public/config.js`, which defines a single global object:

```js
window.TRUSION_CONFIG = {
  API_BASE: '',            // Railway backend base URL
  SUPABASE_URL: '',        // https://<project>.supabase.co
  SUPABASE_ANON_KEY: '',   // publishable anon key
  PRODUCTION: true         // fail-closed behaviour
};
```

This file is committed with **empty placeholders**. Fill it in per environment (or generate it in the Pages build step). It is served with `Cache-Control: no-store` (see `public/_headers`).

| Key | Required | Public? | Description |
|-----|----------|---------|-------------|
| `API_BASE` | Yes (production) | Yes | Railway backend origin, e.g. `https://trusion-api.up.railway.app`. Must exactly match an entry in the backend's `FRONTEND_ORIGIN` allowlist counterpart. |
| `SUPABASE_URL` | Yes | Yes | Supabase project URL. Validated as `https://*.supabase.co` or `*.supabase.in`. |
| `SUPABASE_ANON_KEY` | Yes | Yes | Supabase anon/publishable key. Safe to expose — protected by Row Level Security. |
| `PRODUCTION` | Yes | Yes | `true` disables every dev fallback. Set `false` only for local work. |

**Fail-safe behaviour:** if `SUPABASE_URL` is empty, malformed, or still contains `YOUR_`, `isSupabaseConfigured()` returns `false`. The app then shows *"Authentication service belum dikonfigurasi. Hubungi administrator."* and refuses to start the session. There is no guest or demo fallback.

> **Legacy note:** older builds hardcoded `SUPABASE_CONFIG` inside `index.html` and read `window.TRUSION_API_BASE`. Both are gone. Only `config.js` is read now.

---

## 2. Backend (Railway)

Set in Railway → service → **Variables**.

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `NODE_ENV` | **Yes** | Server | Must be `production` in production. Controls CORS enforcement, error verbosity, and config warnings. |
| `PORT` | Auto | Server | Railway injects this. Do not hardcode. |
| `FRONTEND_ORIGIN` | **Yes** | Server | Comma-separated **exact** origins for CORS, e.g. `https://trusion.pages.dev,https://www.trusion.app`. Wildcards and `*` are rejected in production — with no value, every cross-origin request is blocked (fail-closed) and a `CONFIG_WARNINGS` line is emitted at boot. |
| `SUPABASE_URL` | **Yes** | Server | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | **SERVER-SIDE ONLY** | Bypasses RLS. Used only for admin role lookup and server-side log writes. Never send to a browser. |
| `ANTHROPIC_API_KEY` | **Yes** | **SERVER-SIDE ONLY** | Anthropic API key. Used only by `/api/ai/analyze` and `/api/ai/analyze-image`. |
| `DATABASE_URL` | No | **SERVER-SIDE ONLY** | Direct Postgres connection string. Only needed for migrations or raw queries outside the Supabase client. |

### Payment gateway (optional — disabled by default)

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `XENDIT_SECRET_KEY` | If using Xendit | **SERVER-SIDE ONLY** | Xendit API secret. |
| `XENDIT_WEBHOOK_TOKEN` | If using Xendit | **SERVER-SIDE ONLY** | Verifies inbound Xendit callbacks. |
| `MIDTRANS_SERVER_KEY` | If using Midtrans | **SERVER-SIDE ONLY** | Midtrans server key. |
| `PAYMENT_WEBHOOK_SECRET` | If using payments | **SERVER-SIDE ONLY** | Shared secret compared against the `x-callback-token` header on `/api/billing/webhook`. Without it the webhook returns 503 and **no entitlement is ever granted**. |

While the gateway is unconfigured, `/api/billing/checkout` returns **503** and the UI shows *"Pembayaran belum dikonfigurasi"*. No plan is upgraded client-side.

### Optional

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `EVENT_LOG_ENDPOINT` | No | Server | Forwards structured event logs to an external sink. |
| `AI_RATE_LIMIT_PER_MIN` | No | Server | Overrides the default 10 req/min AI limit. |
| `FREE_SCAN_QUOTA` | No | Server | Monthly scan allowance for the free tier (default 10). |

---

## 3. GitHub Actions

| Secret | Required | Description |
|--------|----------|-------------|
| — | None | CI runs lint, syntax checks, and the demo/secret gates with no secrets. Add `RAILWAY_TOKEN` and `CLOUDFLARE_API_TOKEN` only if you enable automated deploys. |

---

## 4. Verification Commands

```bash
# Backend readiness (expects 503 until Supabase + Anthropic are set)
curl -s -o /dev/null -w "%{http_code}\n" "$API_BASE/ready"

# Health (expects 200)
curl -s "$API_BASE/health" | jq

# Confirm a protected route rejects anonymous access (expects 401)
curl -s -o /dev/null -w "%{http_code}\n" "$API_BASE/api/auth/role"
```

Expected with a complete configuration:

```json
{"status":"ok","services":{"supabase":true,"anthropic":true}}
```

```json
{"ready":true,"dependencies":{"supabase":true,"anthropic":true}}
```

---

## 5. Security Rules

1. **Never commit `.env`** — `.gitignore` excludes it.
2. **Never place `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, or payment secrets in `public/`** — CI fails the build if it detects them.
3. **Never store credentials in `localStorage` or `sessionStorage`** — CI enforces this.
4. **Keep `.env.example` placeholder-only** — it must never contain a real value.
5. **Rotate on exposure** — if any secret reaches a commit, rotate it at the provider before rewriting history.
6. **Keep `config.js` and `_headers` `connect-src` in sync** — if `API_BASE` changes origin, the CSP must be updated in the same commit or the browser will block the call.
