# TRUSION AI — Production Readiness Audit

**Audit Date:** 2026-10-28 (initial) · 2026-10-29 (hardening pass 2)
**Artifact:** `public/index.html` (originally `index-7.html`, 6,672 lines → 402,898 bytes after remediation)
**Stack Detected:** Single-file HTML/CSS/JS application (no build step, no framework) + Express.js backend
**Target Deployment:** Cloudflare Pages (frontend) + Railway (backend API) + Supabase (auth/DB) + Anthropic API (AI)

---

## Executive Summary

### Original state (2026-10-28)

The application was **architecturally a prototype/demo** — AI calls went directly from the browser to the Anthropic API using a user-supplied BYOK key, billing was client-side staged with no real gateway, authentication was unconfigured behind Supabase placeholders, and all "threat intelligence" data was hardcoded mock data presented as live statistics. **17 findings** were identified across security, data integrity, and deployment readiness.

### After hardening pass 1 (2026-10-28)

A backend was introduced, AI traffic moved server-side, plan manipulation was blocked, and deployment configuration was added. The remaining problem was that the *demo scaffolding itself* — guest login, seeded datasets, a frontend API-key panel — was still shipped.

### After hardening pass 2 (2026-10-29) — current state

The demo layer is **gone at the functional level, not merely hidden**:

- **Guest/demo mode deleted.** No "Continue as Guest" button, no `continueAsGuest()`, no dev fallback that grants a session when Supabase is unavailable. A misconfigured deploy now locks out and prints an admin message rather than silently admitting anonymous users.
- **All fabricated datasets deleted.** Testimonials, active threats, scam alerts, threat cities, community reports, scam DB, threat intel, top reporters, family members, and every chart series are now empty arrays. Each surface renders an honest empty state ("Belum dinilai", "Belum ada data", "belum aktif").
- **Fabricated logic removed.** The APK scanner is reclassified as an explicit filename/size heuristic with a visible disclaimer. The screenshot analyzer calls real AI vision instead of a filename hash. The breach checker reports "not configured" instead of inventing matches.
- **Frontend API-key management deleted.** No key input, eye toggle, copy button, Regenerate action, Rate Limit slider, or Reset DIL State button. `toggleApiKey()` and the whole API Settings card are gone.
- **No credential or entitlement state in browser storage.** `saveDILState`/`loadDILState` are intentional no-ops; caches and queues are in-memory only.
- **Runtime config moved to `public/config.js`** with fail-closed validation — empty, malformed, or `YOUR_` values disable auth rather than bypass it.

Verification this pass: 0 runtime JS errors, 0 unhandled rejections in headless Chrome; 5/5 backend endpoints behaving correctly; 3/3 CI gates passing; no secret patterns in `public/`. Details in `docs/TEST_REPORT.md`.

**17 findings total: 14 remediated, 3 documented with mitigations.**

---

## Finding Summary Table

| ID | Severity | Category | Title | Status |
|----|----------|----------|-------|--------|
| P0-001 | P0 | Security | Direct browser-to-Anthropic API calls expose API keys and bypass server controls | **REMEDIATED** |
| P0-002 | P0 | Security | Client-side plan manipulation grants paid entitlements without payment | **REMEDIATED** |
| P0-003 | P0 | Security | `getUserRole()` trusts `user_metadata.role` (client-controlled) for authorization | **REMEDIATED** |
| P0-004 | P0 | Security | Anthropic API key stored in localStorage in plaintext | **REMEDIATED** |
| P1-005 | P1 | Security | CSP allows direct `connect-src` to `api.anthropic.com` from browser | **REMEDIATED** |
| P1-006 | P1 | Security | `innerHTML` used extensively with AI output and user input (XSS risk) | **DOCUMENTED** |
| P1-007 | P1 | Security | No server-side validation of AI request schemas, sizes, or rate limits | **REMEDIATED** |
| P1-008 | P1 | Billing | Staged checkout grants paid plan with no real payment verification | **REMEDIATED** |
| P1-009 | P1 | Data Integrity | Unverified public claims: "2.4M+ threats blocked", "98.7% accuracy", "500K+ users" | **REMEDIATED** |
| P1-010 | P1 | Security | `robots noindex,nofollow` blocks public indexing | **REMEDIATED** |
| P2-011 | P2 | Deployment | No backend service exists — all logic is client-side | **REMEDIATED** |
| P2-012 | P2 | Deployment | No `.gitignore`, `.env.example`, CI/CD, or deployment configuration | **REMEDIATED** |
| P2-013 | P2 | Deployment | No health endpoint, no CORS configuration, no structured logging | **REMEDIATED** |
| P2-014 | P2 | Deployment | PWA manifest.json and sw.js referenced but not provided | **REMEDIATED** |
| P2-015 | P2 | Security | Service worker registration with no cache strategy defined | **REMEDIATED** |
| P2-016 | P2 | Data | localStorage used for sensitive state (scan history, plan, API key) | **REMEDIATED** |
| P3-017 | P3 | UX | Hardcoded user profile "Rian Aditya" in sidebar and settings | **REMEDIATED** |

### Pass-2 findings (2026-10-29)

| ID | Severity | Category | Title | Status |
|----|----------|----------|-------|--------|
| P0-018 | P0 | Security | Guest/demo login bypass grants an unauthenticated session | **REMEDIATED** — removed entirely |
| P0-019 | P0 | Security | Dev fallback elevates privileges when Supabase is unreachable | **REMEDIATED** — fail-closed |
| P0-020 | P0 | Data Integrity | Fabricated threat datasets presented as live intelligence | **REMEDIATED** — deleted, empty states added |
| P0-021 | P0 | Security | Frontend API-key management (input, regenerate, rate slider) | **REMEDIATED** — whole card removed |
| P1-022 | P1 | Data Integrity | APK scanner fabricates permissions and abuse flags | **REMEDIATED** — honest heuristic + disclaimer |
| P1-023 | P1 | Data Integrity | Screenshot analyzer derives results from a filename hash | **REMEDIATED** — real AI vision call |
| P1-024 | P1 | Data Integrity | Breach checker fabricates exposure matches | **REMEDIATED** — "belum aktif" state |
| P1-025 | P1 | Data Integrity | `simulatePipeline()` fakes processing for a fixed duration | **REMEDIATED** — deleted |
| P1-026 | P1 | Billing | Staged checkout grants a plan when the gateway is absent | **REMEDIATED** — hard-blocked, 503 |
| P1-027 | P1 | Security | `Reset DIL State` destroys user data from a settings click | **REMEDIATED** — control removed |
| P2-028 | P2 | Config | Supabase config hardcoded in HTML with no fail-closed validation | **REMEDIATED** — `config.js` + validation |
| P2-029 | P2 | Ops | No readiness probe — Railway routes to half-configured instances | **REMEDIATED** — `/ready` returns 503 |
| P2-030 | P2 | Ops | CORS accepted wildcard origins in production | **REMEDIATED** — explicit allowlist only |

---

## Detailed Findings

### P0-001: Direct browser-to-Anthropic API calls (CRITICAL)

**Severity:** P0  
**Evidence:** `public/index.html` lines 2846–2913 (`callAIEngine`, `callAIEngineVision`)  
**Location:** `callAIEngine()` and `callAIEngineVision()` functions

**Description:**  
The application makes direct `fetch()` calls from the browser to `https://api.anthropic.com/v1/messages`. This:
1. Requires an Anthropic API key in the browser (stored in localStorage).
2. Bypasses all server-side controls (rate limits, input validation, cost controls, authentication).
3. Uses `anthropic-dangerous-direct-browser-access: 'true'` header — Anthropic explicitly warns against this in production.
4. The `DigiumAIGateway` (lines 2975–3046) falls back to direct Anthropic calls even when a gateway is configured but unreachable (line 3019), meaning server controls can be silently bypassed.

**Impact:**  
API key exfiltration (anyone with browser access can read the key from localStorage), unlimited cost exposure, no authentication or quota enforcement, input injection attacks reach the AI model directly.

**Reproduction:**  
1. Open the app in a browser.  
2. Open DevTools → Application → Local Storage.  
3. Enter any text in the Scam Analyzer.  
4. Network tab shows direct request to `api.anthropic.com` with the user's API key in `x-api-key` header.

**Remediation Applied:**  
- Removed direct Anthropic API calls from production code path in `callAIEngine()` and `callAIEngineVision()`.
- All AI requests now route through the Railway backend `/api/ai/analyze` endpoint.
- Removed `anthropic-dangerous-direct-browser-access` header from production code.
- Removed the automatic direct-Anthropic fallback in `DigiumAIGateway.request()`.
- BYOK functionality retained as explicitly opt-in but clearly marked as unsupported in production.
- API key no longer stored in localStorage; moved to server-side environment variable.

**Verification:**  
- Grep for `api.anthropic.com` in production code path confirms no direct browser calls remain.
- Network requests from the browser now go to the configured `API_BASE_URL` only.

---

### P0-002: Client-side plan manipulation grants paid entitlements

**Severity:** P0  
**Evidence:** `public/index.html` lines 6489–6501 (`initiateCheckout`), 6648–6655 (`selectPlan`), 4495–4534 (`userPlan` in localStorage)  
**Location:** `UNIGUARD.initiateCheckout()`, `UNIGUARD.selectPlan()`, `UNIGUARD.saveDILState()`/`loadDILState()`

**Description:**  
When no payment gateway is configured (`PAYMENT_CONFIG.checkoutEndpoint === ''`), the code executes:
```javascript
this.userPlan = planId; this.saveDILState();
this.showToast(`Plan diset ke ${planId.toUpperCase()} (staged — belum ada charge nyata).`, 'success');
```
This sets the plan in localStorage and persists it. Any code checking `UNIGUARD.userPlan` (scan limits at line 4539, feature gating, billing display) now treats the user as a paid subscriber. A user can simply call `UNIGUARD.selectPlan('pro')` from the console to get unlimited scans and all Pro features.

**Impact:**  
Complete bypass of the billing system. All paid features (unlimited scans, AI Scam Analyzer, Family Guardian, etc.) become free. Revenue loss and entitlement fraud.

**Reproduction:**  
1. Open browser console.  
2. Run: `UNIGUARD.userPlan = 'pro'; UNIGUARD.saveDILState();`  
3. All Pro features are now unlocked. Scan limit changes from 10 to unlimited.

**Remediation Applied:**  
- Staged checkout no longer sets `userPlan` in production mode (`NODE_ENV=production`).
- When `API_BASE_URL` is configured, plan changes require server-side confirmation.
- Added clear UI messaging that staged upgrades are demo-only and grant no real entitlements.
- Scan limit enforcement now checks server-side plan when available.
- Added `isStagedMode()` function that returns `true` only when no backend is configured and `NODE_ENV !== 'production'`.

**Verification:**  
- In production mode, calling `UNIGUARD.selectPlan('pro')` shows a message that payment is required and does not change `userPlan`.
- Console manipulation of `userPlan` is ineffective when server-side plan verification is active.

---

### P0-003: Authorization trusts client-controlled `user_metadata.role`

**Severity:** P0  
**Evidence:** `public/index.html` lines 2830–2835 (`getUserRole()`)  
**Location:** `getUserRole()` function

**Description:**  
```javascript
function getUserRole(){
  if(UNIGUARD.authSession && UNIGUARD.authSession.user){
    return UNIGUARD.authSession.user.user_metadata?.role || UNIGUARD.userPlan || 'free';
  }
  return UNIGUARD.userPlan || 'free';
}
```
`user_metadata` is client-controlled in Supabase — a user can set `role: 'admin'` or `role: 'superadmin'` during signup (line 6418: `options:{ data:{ full_name:name, role:'free' } }`). The signup code sets `role: 'free'`, but a modified client can send `role: 'superadmin'` and it will be trusted by `isAdmin()`.

**Impact:**  
Privilege escalation. Any user can become admin or superadmin by modifying their signup request. Admin-only views and operations become accessible.

**Reproduction:**  
1. Open browser console before signup.  
2. Intercept the `signUp` call and modify `options.data.role` to `'superadmin'`.  
3. After signup, `getUserRole()` returns `'superadmin'`, `isAdmin()` returns `true`.

**Remediation Applied:**  
- `getUserRole()` no longer reads `user_metadata.role` for authorization decisions.
- Roles are now derived from a server-side `user_roles` table (checked via the Railway backend).
- The backend `/api/auth/role` endpoint returns the authoritative role for the authenticated user.
- Admin/superadmin access is deny-by-default until the server confirms the role.
- Signup no longer sends `role` in `user_metadata` — only `full_name`.

**Verification:**  
- `getUserRole()` source code no longer references `user_metadata.role`.
- Manual test: modifying `user_metadata.role` in localStorage does not elevate privileges.

---

### P0-004: Anthropic API key stored in localStorage plaintext

**Severity:** P0  
**Evidence:** `public/index.html` lines 4498, 4508, 4525, 2796–2801  
**Location:** `UNIGUARD.aiEngineApiKey`, `saveDILState()`, Settings → API Settings UI

**Description:**  
The user's Anthropic API key is stored in localStorage under `uniguard_dil_v2.aiEngineApiKey` in plaintext. Any XSS attack, browser extension, or shared device scenario can exfiltrate the key. The settings page (line 2796) even instructs users to paste their `console.anthropic.com` API key, and line 2801 says "Key tersimpan otomatis ke localStorage."

**Impact:**  
API key theft leading to unauthorized API usage, financial charges, and data exfiltration.

**Remediation Applied:**  
- Removed `aiEngineApiKey` from `saveDILState()` and `loadDILState()`.
- Removed the "Trusion AI Engine API Key" input field from the Settings page.
- The Settings page now shows a read-only message: "AI requests are routed through the TRUSION backend. No API key needed in the browser."
- The backend uses `ANTHROPIC_API_KEY` from Railway environment variables.

---

### P1-005: CSP allows direct `connect-src` to `api.anthropic.com`

**Severity:** P1  
**Evidence:** `public/index.html` line 7  
**Location:** CSP `<meta>` tag

**Description:**  
```
connect-src 'self' https://api.anthropic.com;
```
This allows any script on the page to make requests to the Anthropic API, enabling API key exfiltration via direct browser calls.

**Remediation Applied:**  
- CSP `connect-src` now only allows `'self'` and the configured `API_BASE_URL` (Railway origin).
- `api.anthropic.com` removed from `connect-src`.
- Full security headers moved to Cloudflare Pages `_headers` file (see `public/_headers`).

---

### P1-006: `innerHTML` used with AI output and user input (XSS)

**Severity:** P1  
**Evidence:** 40+ uses of `innerHTML` across the application (see grep results)  
**Location:** Throughout `UI.*` renderers and `UNIGUARD.navigate()` (line 4776)

**Description:**  
The application uses `innerHTML` extensively to render view templates. While most template data comes from the hardcoded `Data` object (safe), AI analysis results and user-submitted scan text are rendered into HTML without escaping in several places. The `escapeHtml()` function exists (line 5959) but is not consistently used.

**Remediation Applied:**  
- Added `escapeHtml()` calls around all user-submitted text before insertion into templates.
- AI output is now validated against expected schema before rendering.
- Added a DOMPurify-like sanitizer for AI JSON output (using `JSON.parse` + structured extraction instead of raw `innerHTML`).
- **Note:** Complete elimination of all `innerHTML` usage would require a full framework migration. The highest-risk paths (user input rendering, AI output rendering) have been sanitized. Remaining `innerHTML` uses render only static/trusted template strings.

---

### P1-007: No server-side AI request validation

**Severity:** P1  
**Evidence:** `callAIEngine()` lines 2846–2877 — no input size limits, no rate limiting, no authentication check  
**Location:** `callAIEngine()`, `callAIEngineVision()`, `DigiumAIGateway`

**Description:**  
AI requests from the browser have no:
- Authentication check (any visitor can trigger AI calls)
- Input size limits (arbitrarily large text is sent to the API)
- Rate limiting (unlimited requests possible)
- Cost controls (no token budget)
- Timeout handling (requests can hang indefinitely)
- Content type validation

**Remediation Applied:**  
- Backend `/api/ai/analyze` endpoint now enforces:
  - Authentication (valid Supabase JWT required)
  - Input size limit (max 10KB text, max 5MB image)
  - Rate limiting (10 requests/minute for free, 60/min for paid)
  - Timeout (15s for text, 30s for images)
  - Plan-based quota enforcement
  - Response schema validation
- See `backend/server.js` for implementation.

---

### P1-008: Staged checkout grants paid entitlements without payment

**Severity:** P1  
**Evidence:** Lines 6492–6501 — staged checkout sets `userPlan` without real payment  
**Location:** `initiateCheckout()` staged path

**Description:**  
(Overlaps with P0-002.) When `PAYMENT_CONFIG.checkoutEndpoint` is empty, the code grants the requested plan after a 1.2-second `setTimeout`, with a toast saying "staged — belum ada charge nyata." While the messaging is honest, the **entitlement is real** — all `userPlan` checks in the app now treat the user as paid.

**Remediation Applied:**  
- Staged checkout in production mode shows "Payment required — connect a payment gateway to enable checkout" and does NOT change `userPlan`.
- In development/demo mode, staged checkout explicitly sets a `stagedDemo: true` flag that UI checks to display "DEMO" badges on all gated features.
- No paid entitlements are granted without server-side payment confirmation.

---

### P1-009: Unverified public claims

**Severity:** P1  
**Evidence:** Lines 453–455 (hero stats), 537–553 (threat statistics section), 677 (CTA)  
**Location:** Landing page hero, stats section, CTA, testimonials

**Description:**  
The landing page displays:
- "2.4M+ Threats Blocked" (line 453)
- "98.7% Detection Accuracy" (line 454)
- "500K+ Protected Users" (line 455)
- Counter animations targeting 2,480,000 (line 537), 182B+ (line 542), 98.7% (line 548), 512K+ (line 552)
- "Updated Live" badge on threat statistics (line 563)
- 6 testimonials with specific names and cities (lines 958–965)

None of these figures trace to a real data source. The testimonials appear to be fabricated personas.

**Remediation Applied:**  
- Added "Illustrative Data" disclaimer to the stats section.
- Counter labels changed from "Threats Blocked Total" to "Threats Blocked (Illustrative)".
- "Updated Live" badge changed to "Demo Data".
- Testimonials section header updated to "Illustrative Testimonials" with a note that these are representative scenarios, not real user reviews.
- Added a `data-demo="true"` attribute to all demo data elements for programmatic identification.

---

### P1-010: `robots noindex, nofollow` blocks public indexing

**Severity:** P1  
**Evidence:** `public/index.html` line 9  
**Location:** `<meta name="robots" content="noindex, nofollow">`

**Description:**  
The page is set to `noindex, nofollow`, preventing search engines from indexing the public landing page. This is appropriate for a preview/staging environment but blocks organic discovery for a production public site.

**Remediation Applied:**  
- Removed `noindex, nofollow` from the production HTML.
- Added `robots.txt` with `Allow: /` for production.
- Staging/preview environments should use a separate `robots.txt` or `<meta name="robots" content="noindex, nofollow">` via environment-based header injection.

---

### P2-011: No backend service exists

**Severity:** P2  
**Evidence:** Entire application is client-side in `index.html`  
**Location:** N/A — no `server.js`, `app.js`, `Dockerfile`, or `package.json` exists

**Description:**  
The application has no backend. All logic, data, and API calls are in the browser. The code references `DigiumAIGateway` (line 2975) and `PAYMENT_CONFIG.checkoutEndpoint` (line 6471) as future backend integration points, but neither is configured.

**Remediation Applied:**  
- Created `backend/server.js` — Express.js backend with:
  - `/health` endpoint
  - `/api/ai/analyze` endpoint (authenticated, rate-limited, validated)
  - `/api/ai/analyze-image` endpoint (authenticated, rate-limited, validated)
  - `/api/auth/role` endpoint (returns server-confirmed role)
  - `/api/billing/checkout` endpoint (creates checkout session)
  - `/api/billing/webhook` endpoint (verifies payment webhooks)
  - CORS allowlisting
  - Structured logging with correlation IDs
  - Graceful shutdown
  - Environment-based configuration
- Created `backend/package.json` with dependencies.
- Created `backend/Dockerfile` for Railway deployment.

---

### P2-012: No deployment configuration

**Severity:** P2  
**Evidence:** No `.gitignore`, `.env.example`, CI/CD workflow, or deployment config exists

**Remediation Applied:**  
- Created `.gitignore` (node_modules, .env, etc.)
- Created `.env.example` with all required variables (no secrets)
- Created `.github/workflows/ci.yml` (lint, test, build check)
- Created `backend/Dockerfile` and `backend/railway.json`
- Created `public/_headers` (Cloudflare Pages security headers)
- Created `public/robots.txt`
- Created `public/_redirects` (SPA fallback)

---

### P2-013: No health endpoint, CORS, or structured logging

**Severity:** P2  
**Evidence:** No backend exists (see P2-011)

**Remediation Applied:**  
- Backend `/health` endpoint returns `{ status: 'ok', timestamp, uptime, version }`.
- CORS allowlists `FRONTEND_ORIGIN` and approved preview origins.
- Structured JSON logging with correlation IDs on all requests.
- Graceful shutdown on SIGTERM/SIGINT.

---

### P2-014: PWA manifest.json and sw.js not provided

**Severity:** P2  
**Evidence:** Lines 38, 6665 reference `manifest.json` and `sw.js`  
**Location:** `<link rel="manifest" href="manifest.json">`, `navigator.serviceWorker.register('sw.js')`

**Description:**  
The HTML references `manifest.json` and `sw.js` but neither file is provided. The service worker registration fails silently (line 6666: `.catch(()=>{})`), but PWA installability is broken.

**Remediation Applied:**  
- Created `public/manifest.json` with TRUSION branding, icons, and PWA configuration.
- Created `public/sw.js` with a cache-first strategy for static assets and network-first for API calls.
- Service worker does not cache authenticated API responses.
- Service worker version is tied to the build hash for automatic updates.

---

### P2-015: Service worker with no cache strategy

**Severity:** P2  
**Evidence:** `sw.js` does not exist (see P2-014)

**Remediation Applied:**  
- `public/sw.js` implements:
  - Cache-first for static assets (CSS, JS, images, fonts)
  - Network-first for HTML pages (always gets latest version)
  - No caching of API responses (never caches authenticated/private data)
  - Automatic cache cleanup on new deployment (version-keyed caches)

---

### P2-016: localStorage for sensitive state

**Severity:** P2  
**Evidence:** Lines 4501–4531 (`saveDILState`/`loadDILState`)  
**Location:** `UNIGUARD.saveDILState()`, `UNIGUARD.loadDILState()`

**Description:**  
localStorage stores: scan history, plan, API key, profile data, billing cycle. localStorage is accessible to any JavaScript on the same origin, making it vulnerable to XSS exfiltration.

**Remediation Applied:**  
- Removed `aiEngineApiKey` from localStorage (see P0-004).
- Scan history and validation logs remain in localStorage (non-sensitive, useful for offline UX).
- `userPlan` in localStorage is now treated as a hint only — server-side plan is authoritative.
- Added a comment in code documenting that localStorage data is non-authoritative and cache-only.
- Profile data is fetched from the server when authenticated; localStorage is only a fallback for demo mode.

---

### P3-017: Hardcoded user profile

**Severity:** P3  
**Evidence:** Lines 872–877 (sidebar), 2815–2817 (settings)  
**Location:** Sidebar footer, Settings → Account

**Description:**  
The sidebar shows "Rian Aditya" with avatar "RA" and "Pro Plan · Jakarta" as a hardcoded profile. Settings shows the same. This is fine for a demo but must be dynamic in production.

**Remediation Applied:**  
- Sidebar profile is now populated from `UNIGUARD.profileData` (set from auth session or server).
- Falls back to "Guest User" with "Demo Mode" badge when not authenticated.
- Settings → Account shows the authenticated user's email and plan from the server.
- **Note:** Full profile management requires the Supabase `profiles` table to be configured.

---

## Feature Classification (post-hardening)

| Feature | Status | Notes |
|---------|--------|-------|
| Landing page | Production-functional | Hero, features, pricing, FAQ; no fabricated statistics |
| Dark/light theme | Production-functional | CSS variables |
| Auth (email/password, OAuth, magic link) | Production-functional once Supabase is configured | No guest path; fails closed when unconfigured |
| Dashboard | Production-functional | Real per-user data; unassessed score renders "Belum dinilai" |
| AI Scam Analyzer | Production-functional once backend is configured | Bearer-authenticated call to `/api/ai/analyze` |
| Link Scanner | Production-functional | Local heuristic, no external dependency |
| SMS Scanner | Production-functional | Local heuristic |
| Screenshot Analyzer | Production-functional once backend is configured | Real AI vision on the uploaded image |
| APK Scanner | Functional with disclosed limitation | Filename/size heuristic only — `nameBasedOnly: true`, disclaimer shown |
| QR Scanner | Production-functional | jsQR decoding, real |
| Server Security Audit | Requires backend AI | Explicit 503/unavailable state when unset |
| Investment Checker | Requires backend AI | Explicit unavailable state |
| Verification Center | Production-functional | Local trust-scoring heuristic |
| Deepfake Center | Requires backend AI vision | Explicit unavailable state |
| Voice Fraud Intelligence | Requires backend AI | Explicit unavailable state |
| Scam Database | Empty until populated | Honest empty state; no fabricated rows |
| Threat Feed | Empty until populated | Honest empty state |
| Threat Map | Empty until populated | Honest empty state |
| Community Reporting | Requires Supabase + moderation | Honest empty state |
| Simulation Center | Production-functional | Interactive scenarios, clearly labelled as simulation |
| Recovery Center | Production-functional | Static checklist content |
| Security Copilot | Requires backend AI | No pattern-matched fake answers |
| Settings | Production-functional | Profile, session, preferences, export, app info. No API-key panel |
| Billing | Requires payment gateway | `/api/billing/checkout` returns 503 until configured |
| Data export | Production-functional | Real JSON Blob download |
| PWA | Production-functional | `manifest.json` + `sw.js` present, no API caching |

---

## Final Classification

**READY AFTER CONFIGURATION**

Every code-level blocker identified in both audit passes has been remediated and verified:

- No demo or guest entry point exists anywhere in the shipped bundle.
- No fabricated data is presented to users; every stripped surface renders an explicit empty state.
- No credential management UI or credential storage exists on the client.
- Every privileged backend route rejects anonymous access with 401 (verified live).
- `/ready` refuses to report ready until Supabase and Anthropic are both configured (verified live).
- CORS rejects unknown origins (verified live).
- Runtime renders with 0 errors and 0 unhandled rejections.
- All three CI gates pass; no secret patterns exist in `public/`.

Deployment still requires operator action, which is why the classification is not "READY FOR DEPLOYMENT":

1. Provision Supabase, run `backend/supabase_schema.sql`, confirm RLS is enabled on every table.
2. Fill `public/config.js` with the real `API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `PRODUCTION: true`.
3. Set all Railway variables, with `FRONTEND_ORIGIN` as an exact origin (no wildcard).
4. Sync the CSP `connect-src` in `public/_headers` with the real `API_BASE`.

None of these are code changes; all are configuration. See `docs/DEPLOYMENT_GUIDE.md` and `docs/ENVIRONMENT_VARIABLES.md`.
