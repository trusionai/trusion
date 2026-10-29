# TRUSION AI — Security Checklist

Security posture of the production deployment. Items marked ✅ were verified in this audit; items marked ⬜ are manual steps the operator must complete before go-live.

---

## 1. Authentication & Authorization

- ✅ Supabase Auth wired for email/password, Google, Facebook, magic link, and password reset
- ✅ **Guest / demo mode fully removed** — no "Continue as Guest" button, no `continueAsGuest()`, no anonymous session
- ✅ **Auth gate is mandatory** — unauthenticated users see only the landing page and auth modal
- ✅ **No dev fallback grants access** when Supabase is unreachable; the app shows an explicit "not configured" error instead
- ✅ Missing/placeholder Supabase config fails closed (`isSupabaseConfigured()` rejects empty, malformed, or `YOUR_` values)
- ✅ `SUPABASE_SERVICE_ROLE_KEY` is server-side only (Railway env var)
- ✅ Anon key is public and RLS-protected
- ✅ `getUserRole()` does **not** trust `user_metadata.role` (client-controlled)
- ✅ Roles confirmed server-side via `/api/auth/role`; admin/superadmin deny-by-default until confirmed
- ✅ Signup cannot set `role` in `user_metadata`
- ✅ Every authenticated backend route validates the Bearer JWT (verified: `/api/auth/role`, `/api/ai/analyze`, `/api/ai/analyze-image`, `/api/billing/checkout` all return **401** without a token)
- ✅ Logout calls `supabase.auth.signOut()`, clears session state, and returns to landing
- ✅ Session restore and token refresh handled by the Supabase client (no custom token storage)
- ✅ Per-user data isolation via RLS on `profiles`, `user_roles`, `scan_logs`, `payment_logs`, `community_reports`

## 2. AI Gateway

- ✅ All AI traffic goes through the Railway backend (`/api/ai/analyze`, `/api/ai/analyze-image`)
- ✅ **No browser-to-Anthropic calls** — `api.anthropic.com` removed from CSP `connect-src`
- ✅ **Frontend API-key management removed entirely** — no "TRUSION API KEY" field, no show/hide, no copy, no Regenerate, no Rate Limit slider, no `aiEngineApiKey` in storage
- ✅ `ANTHROPIC_API_KEY` lives only in Railway env vars
- ✅ Every AI request carries the user's Bearer JWT via `getAuthHeaders()`
- ✅ Input validation: ≤10 KB text, ≤5 MB image
- ✅ Content-type allowlist for images: jpeg, png, gif, webp
- ✅ Rate limiting (10 req/min default, per-plan configurable) + a global 120 req/min limiter
- ✅ Plan-based quota enforcement (Free: 10 scans/month)
- ✅ Timeouts: 20 s text, 30 s image
- ✅ Output schema validated before rendering
- ✅ Correlation IDs on every request and response
- ✅ Structured JSON logs contain no secrets and no user content
- ✅ No silent provider fallback — failures surface as explicit errors
- ✅ Honest 503 when `ANTHROPIC_API_KEY` is absent

## 3. Billing & Subscriptions

- ✅ **No staged or client-side entitlement grant** — checkout requires a real gateway
- ✅ `/api/billing/checkout` returns **503** when the gateway is unconfigured
- ✅ Prices come from a server-side `PLAN_PRICES` catalog; client-sent amounts are ignored
- ✅ Webhook verifies `x-callback-token` against `PAYMENT_WEBHOOK_SECRET`
- ✅ Webhook is idempotent (event-ID deduplication)
- ✅ Entitlements granted only after authoritative payment confirmation
- ✅ Free "downgrade" in the UI no longer mutates client state — it directs the user to the billing portal
- ✅ Enterprise flow is honest (contact-sales, no fake checkout)
- ✅ Plan state is server-authoritative on reload

## 4. Browser & Application Security

- ✅ CSP `connect-src` limited to `'self'`, `https://*.supabase.co`, and the Railway origin
- ✅ `api.anthropic.com` absent from CSP
- ✅ `X-Content-Type-Options: nosniff`
- ✅ `X-Frame-Options: DENY` / `frame-ancestors 'none'`
- ✅ `Referrer-Policy: strict-origin-when-cross-origin`
- ✅ `Permissions-Policy` restricts camera, geolocation, microphone
- ✅ HSTS `max-age=31536000; includeSubDomains; preload`
- ✅ `escapeHtml()` used for all user-submitted text
- ✅ AI output validated against schema before rendering
- ✅ **No credentials or entitlement state in `localStorage`** — `saveDILState`/`loadDILState` are intentional no-ops; `MiniKnowledgeCache`, `DKCSyncQueue`, and `EventLog` are in-memory only
- ✅ Service worker does not cache API responses
- ✅ Production HTML has no `noindex,nofollow`
- ✅ `robots.txt` permits indexing
- ✅ `config.js` served with `no-store`

## 5. Data Integrity — No Fabricated Data

- ✅ **Demo datasets deleted** — `Data.testimonials`, `activeThreats`, `scamAlerts`, `threatCities`, `communityReports`, `scamDatabaseEntries`, `threatIntel`, `topReporters`, `familyMembers` are all empty arrays
- ✅ **All chart datasets removed** — charts render an explicit empty state instead of hardcoded series
- ✅ **Security score / risk level** return `null` when unassessed and render "Belum dinilai"
- ✅ **Active Threats, Scam Alerts, Threat Intel, Hall of Fame, Family, Scam DB, Threat Map** all show honest empty states
- ✅ **`simulatePipeline()` removed** — the fake "processing" animation is gone; the card shows the real session event count
- ✅ **Landing page hero stats, ticker, and "Threat Statistics" removed** — replaced with capability copy and a "How It Works" section
- ✅ **Testimonials** no longer presented as live; section is honest about being disabled until real reviews exist
- ✅ FAQ no longer claims a fabricated 98.7% detection rate
- ✅ **APK scanner** honestly reclassified as a filename/size heuristic (`nameBasedOnly: true`) with a visible disclaimer; fabricated permission/accessibility/overlay findings removed
- ✅ **Screenshot analyzer** calls real AI vision with the actual uploaded image (previous filename-hash mock deleted)
- ✅ **Breach checker** shows "belum aktif" instead of fabricated matches; `Engine.analyzeExposure()` and its result template deleted
- ✅ Pricing consistent between landing page and `PRICING_PLANS`

## 6. Settings UI

- ✅ **API Settings card removed** — key input, eye toggle, copy button, Regenerate, Rate Limit slider, Reset DIL State button, and `toggleApiKey()` all deleted
- ✅ **DIL State Reset removed from user settings** — user data is not destroyed from a settings click
- ✅ Retained and functional: account/profile fields (async upsert to Supabase `profiles`), auth & session (logout), preferences, notifications, privacy & data export, app info
- ✅ **Data export works** — `downloadMyData()` produces a real JSON Blob of account + session logs
- ✅ No dead buttons or empty cards left in the settings surface

## 7. Deployment

- ✅ `.gitignore` excludes `.env` and `node_modules/`
- ✅ `.env.example` contains placeholders only
- ✅ CI gate: fails on demo/guest bypass strings
- ✅ CI gate: fails on frontend API-key management strings
- ✅ CI gate: fails on secrets written to browser storage
- ✅ CI gate: fails on direct Anthropic calls in frontend
- ✅ `/health` returns 200 with service status (verified)
- ✅ `/ready` returns 503 until Supabase **and** Anthropic are configured (verified)
- ✅ CORS allowlist enforced in production; unknown origins get no `Access-Control-Allow-Origin` (verified)
- ✅ Structured JSON request/response logging with correlation IDs (verified)
- ✅ Graceful shutdown on SIGTERM/SIGINT
- ✅ Boot-time `CONFIG_WARNINGS` for missing Supabase, Anthropic, or `FRONTEND_ORIGIN`
- ✅ PWA `manifest.json` + `sw.js`
- ✅ Cloudflare `_headers`, `_redirects`, `robots.txt`
- ✅ Railway `railway.json` + `Dockerfile`

## 8. Remaining Manual Steps (operator)

- ⬜ Create the Supabase project, run `backend/supabase_schema.sql`, enable RLS policies
- ⬜ Fill `public/config.js` with `API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PRODUCTION: true`
- ⬜ Set all Railway variables (see `docs/ENVIRONMENT_VARIABLES.md`)
- ⬜ Set `FRONTEND_ORIGIN` to the exact Pages origin(s) — no wildcard
- ⬜ Connect GitHub → Cloudflare Pages (root `public/`)
- ⬜ Connect GitHub → Railway (root `backend/`)
- ⬜ Sync CSP `connect-src` in `public/_headers` with the real `API_BASE`
- ⬜ Enable Google/Facebook OAuth providers in Supabase
- ⬜ (Optional) Configure Xendit/Midtrans + `PAYMENT_WEBHOOK_SECRET`
- ⬜ (Optional) Configure a custom domain
