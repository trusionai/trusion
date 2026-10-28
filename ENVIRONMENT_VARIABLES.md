# TRUSION AI — Environment Variables

This document lists all environment variables required for the TRUSION AI application.

> **CRITICAL:** Variables marked **SERVER-SIDE ONLY** must never appear in browser code, client bundles, or the frontend repository. They exist only in Railway environment variables or `.env` files that are `.gitignore`d.

## Frontend (Cloudflare Pages)

These are set in Cloudflare Pages → Settings → Environment variables.

| Variable | Required | Description |
|----------|----------|-------------|
| `TRUSION_API_BASE` | Yes (production) | The Railway backend URL (e.g., `https://trusion-backend.up.railway.app`). Set via `window.TRUSION_API_BASE` in index.html or as a Pages environment variable injected during build. |
| `TRUSION_PRODUCTION` | Optional | Set to `true` to enforce production mode (disables staged checkout, BYOK, demo plan changes). |

The following are **hardcoded in `public/index.html`** (in the `SUPABASE_CONFIG` object) and are safe to expose:

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_CONFIG.url` | Yes | Supabase project URL (public — safe to expose) |
| `SUPABASE_CONFIG.anonKey` | Yes | Supabase anon/publishable key (public — safe to expose) |

## Backend (Railway)

These are set in Railway → your service → Variables.

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `NODE_ENV` | Yes | Server | `production` or `development` |
| `PORT` | Auto | Server | Railway assigns automatically |
| `FRONTEND_ORIGIN` | Yes | Server | Comma-separated list of allowed frontend origins for CORS (e.g., `https://trusion.pages.dev,https://*.trusion.pages.dev`) |
| `SUPABASE_URL` | Yes | Server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **SERVER-SIDE ONLY** | Supabase service role key — used for admin operations (user role lookup, scan logging). Never expose in browser. |
| `ANTHROPIC_API_KEY` | Yes | **SERVER-SIDE ONLY** | Anthropic API key for Claude AI. Never expose in browser. |
| `DATABASE_URL` | No | Server | Direct PostgreSQL connection string (only if not using Supabase client) |

### Payment Gateway Variables (when enabled)

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `XENDIT_SECRET_KEY` | If using Xendit | **SERVER-SIDE ONLY** | Xendit API secret key |
| `XENDIT_PUBLIC_KEY` | If using Xendit | Either | Xendit public key (can be exposed in browser) |
| `XENDIT_WEBHOOK_TOKEN` | If using Xendit | **SERVER-SIDE ONLY** | Xendit webhook verification token |
| `MIDTRANS_SERVER_KEY` | If using Midtrans | **SERVER-SIDE ONLY** | Midtrans server key |
| `MIDTRANS_CLIENT_KEY` | If using Midtrans | Either | Midtrans client key (can be exposed) |
| `PAYMENT_WEBHOOK_SECRET` | If using payments | **SERVER-SIDE ONLY** | Shared secret for webhook verification |

### Optional Variables

| Variable | Required | Scope | Description |
|----------|----------|-------|-------------|
| `EVENT_LOG_ENDPOINT` | No | Server | URL for forwarding structured event logs (Supabase Edge Function, etc.) |

## GitHub Actions Secrets

These are set in GitHub → Settings → Secrets and variables → Actions.

| Secret | Required | Description |
|--------|----------|-------------|
| (none currently required) | — | The CI workflow does not require any secrets. If you add automated deployment, you will need `RAILWAY_TOKEN` and `CLOUDFLARE_API_TOKEN`. |

## Security Rules

1. **Never commit `.env` files** — `.gitignore` excludes them.
2. **Never put `SUPABASE_SERVICE_ROLE_KEY` or `ANTHROPIC_API_KEY` in frontend code** — the CI pipeline checks for this.
3. **Never put payment secret keys in frontend code** — only public keys may appear in browser bundles.
4. **Use `.env.example` as a template** — it contains only placeholder values, never real secrets.
5. **Rotate keys if exposed** — if any secret is committed or leaked, rotate it immediately in the provider's dashboard.
