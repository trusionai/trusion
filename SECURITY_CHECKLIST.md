# TRUSION AI — Security Checklist

This checklist tracks the security posture of the TRUSION AI production deployment.

## Authentication & Authorization

- [x] Supabase Auth configured with email/password, Google, Facebook providers
- [x] Service role key is server-side only (Railway env var, never in browser)
- [x] Anon key is safe to expose in browser code
- [x] `getUserRole()` does NOT trust `user_metadata.role` (client-controlled)
- [x] Roles are server-confirmed via `/api/auth/role` endpoint
- [x] Admin/superadmin access is deny-by-default until server confirms
- [x] Signup does not allow setting `role` in user_metadata
- [x] JWT validation on every authenticated backend route
- [x] Guest/demo mode is explicit and grants NO admin privileges

## AI Gateway

- [x] All AI requests route through the Railway backend (`/api/ai/analyze`)
- [x] No direct browser-to-Anthropic API calls in production code
- [x] `anthropic-dangerous-direct-browser-access` header removed
- [x] `ANTHROPIC_API_KEY` stored only in Railway environment variables
- [x] API key NOT stored in localStorage (removed `aiEngineApiKey`)
- [x] API key input field removed from Settings page
- [x] Input size validation (max 10KB text, max 5MB image)
- [x] Content-type validation for image uploads (jpeg, png, gif, webp only)
- [x] Rate limiting (10 req/min default, configurable per plan)
- [x] Authentication required on all AI endpoints
- [x] Plan-based quota enforcement (Free: 10 scans/month)
- [x] Timeout handling (20s text, 30s image)
- [x] AI output schema validation before returning to client
- [x] Correlation IDs on all AI requests
- [x] Structured logging without secrets or sensitive content
- [x] No automatic direct-provider fallback when backend fails
- [x] Clear error messages when AI service is unavailable

## Billing & Subscriptions

- [x] Staged checkout does NOT grant paid entitlements in production mode
- [x] Plan changes require server-side payment confirmation
- [x] Prices derived from server-side plan catalog (never client-sent)
- [x] Webhook signature verification (`X-Callback-Token` / server key)
- [x] Idempotent webhook processing (event ID deduplication)
- [x] Entitlements granted only after authoritative payment confirmation
- [x] Client-side plan manipulation ineffective (localStorage is hint only)
- [x] Enterprise/contact-sales flow is honest (no fake checkout)

## Browser & Application Security

- [x] CSP `connect-src` only allows `'self'` and the Railway backend origin
- [x] `api.anthropic.com` removed from CSP `connect-src`
- [x] `X-Content-Type-Options: nosniff` in `_headers`
- [x] `X-Frame-Options: DENY` (frame-ancestors) in `_headers`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Permissions-Policy` configured (camera, geolocation, microphone restricted)
- [x] HSTS enabled in `_headers` (max-age 31536000, includeSubDomains, preload)
- [x] `escapeHtml()` used for user-submitted text rendering
- [x] AI output validated against schema before rendering
- [x] No sensitive data in localStorage (API key removed)
- [x] Service worker does NOT cache API responses
- [x] `robots noindex,nofollow` removed from production HTML
- [x] `robots.txt` allows public indexing

## Data Integrity

- [x] Demo/illustrative data labeled with `data-demo="true"` attribute
- [x] "Updated Live" badge changed to "Demo Data"
- [x] Testimonials section labeled as illustrative
- [x] Threat statistics labeled as illustrative
- [x] Pricing consistent between landing page and `PRICING_PLANS`

## Deployment

- [x] `.gitignore` excludes `.env`, `node_modules/`
- [x] `.env.example` contains only placeholders (no secrets)
- [x] CI workflow checks for secrets in committed code
- [x] CI workflow checks for direct Anthropic API calls in frontend
- [x] Backend health endpoint `/health` returns meaningful 2xx
- [x] Backend CORS allowlists production frontend origin
- [x] Structured JSON logging on all backend requests
- [x] Graceful shutdown on SIGTERM/SIGINT
- [x] PWA `manifest.json` and `sw.js` provided
- [x] Cloudflare Pages `_headers` with security headers
- [x] `robots.txt` for SEO
- [x] `_redirects` for SPA fallback
- [x] Railway deployment configuration (`railway.json`, `Dockerfile`)

## Remaining Manual Steps

- [ ] Configure Supabase project and fill in `SUPABASE_CONFIG` in `public/index.html`
- [ ] Set Railway environment variables (see `docs/ENVIRONMENT_VARIABLES.md`)
- [ ] Set `TRUSION_API_BASE` in Cloudflare Pages or in `public/index.html`
- [ ] Connect GitHub repository to Cloudflare Pages
- [ ] Connect GitHub repository to Railway
- [ ] Configure Supabase database tables (see `docs/DEPLOYMENT_GUIDE.md` Step 2)
- [ ] (Optional) Configure payment gateway (Xendit/Midtrans) when ready
- [ ] (Optional) Set up Google/Facebook OAuth providers in Supabase
- [ ] (Optional) Configure custom domain in Cloudflare Pages
