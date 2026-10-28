# TRUSION AI — Deployment Guide

## Architecture

```
┌─────────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Cloudflare Pages   │─────▶│  Railway Backend  │─────▶│  Anthropic API  │
│  (Frontend / PWA)    │      │  (Express.js)     │      │  (Claude AI)    │
│  public/             │      │  backend/          │      │                 │
└─────────────────────┘      └────────┬──────────┘      └─────────────────┘
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Supabase         │
                             │  (Auth + Postgres)│
                             └──────────────────┘
```

- **Frontend:** Static files in `public/` deployed to Cloudflare Pages via GitHub integration.
- **Backend:** Express.js server in `backend/` deployed to Railway via GitHub integration.
- **Auth/DB:** Supabase manages authentication and PostgreSQL database.
- **AI:** Anthropic API key stored as a Railway environment variable — never exposed to the browser.

---

## Step 1: GitHub Repository Setup

1. Create a new GitHub repository (e.g., `trusion-ai`).
2. Push the contents of this project to the repository:
   ```bash
   git init
   git add .
   git commit -m "TRUSION AI — production readiness remediation"
   git branch -M main
   git remote add origin https://github.com/YOUR_ORG/trusion-ai.git
   git push -u origin main
   ```

---

## Step 2: Supabase Configuration

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Settings → API** and note:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-side only!)
3. Go to **Authentication → Providers** and enable:
   - Email/Password
   - Google OAuth (add your Google Cloud OAuth client ID/secret)
   - Facebook OAuth (add your Meta app credentials)
4. Create the `user_roles` table:
   ```sql
   CREATE TABLE user_roles (
     user_id UUID REFERENCES auth.users(id) PRIMARY KEY,
     role TEXT DEFAULT 'free' CHECK (role IN ('free','basic','pro','business','admin','superadmin')),
     plan TEXT DEFAULT 'free' CHECK (plan IN ('free','basic','pro','business')),
     billing_status TEXT DEFAULT 'inactive',
     renewed_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can read own role" ON user_roles FOR SELECT USING (auth.uid() = user_id);
   ```

5. Create the `scan_logs` table:
   ```sql
   CREATE TABLE scan_logs (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     user_id UUID REFERENCES auth.users(id),
     scan_type TEXT,
     risk_score INTEGER,
     risk_level TEXT,
     correlation_id TEXT,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users can read own scans" ON scan_logs FOR SELECT USING (auth.uid() = user_id);
   ```

6. Create the `payment_logs` table:
   ```sql
   CREATE TABLE payment_logs (
     id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
     user_id UUID REFERENCES auth.users(id),
     gateway_event_id TEXT UNIQUE,
     plan_id TEXT,
     amount INTEGER,
     currency TEXT DEFAULT 'IDR',
     status TEXT,
     gateway TEXT,
     raw_event JSONB,
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
   ```

7. Update the frontend `SUPABASE_CONFIG` in `public/index.html` with your project URL and anon key.

---

## Step 3: Railway Backend Deployment

1. Go to [railway.app](https://railway.app) and create a new project.
2. Choose **Deploy from GitHub repo** and select your `trusion-ai` repository.
3. Set the **root directory** to `backend/`.
4. Railway will detect the `Dockerfile` and `railway.json` automatically.
5. Go to **Variables** and set:
   - `NODE_ENV` = `production`
   - `PORT` = `3000` (Railway provides this automatically)
   - `FRONTEND_ORIGIN` = your Cloudflare Pages URL (e.g., `https://trusion.pages.dev`)
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service role key
   - `ANTHROPIC_API_KEY` = your Anthropic API key
6. Railway will assign a domain like `https://trusion-backend.up.railway.app`.
7. Verify the health check: visit `https://trusion-backend.up.railway.app/health` — should return `{ "status": "ok", ... }`.

---

## Step 4: Cloudflare Pages Deployment

1. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages).
2. Click **Create a project** → **Connect to Git**.
3. Select your `trusion-ai` GitHub repository.
4. Set:
   - **Production branch:** `main`
   - **Build command:** (leave empty — no build step needed)
   - **Build output directory:** `public`
   - **Root directory:** `/` (project root)
5. Go to **Settings → Environment variables** and set:
   - `TRUSION_API_BASE` = your Railway backend URL (e.g., `https://trusion-backend.up.railway.app`)
   - (Optional) `TRUSION_PRODUCTION` = `true`
6. Deploy.
7. Your site will be available at `https://trusion.pages.dev` (or your custom domain).

### Custom Domain (Optional)

1. In Cloudflare Pages → **Custom domains** → **Set up a custom domain**.
2. Add your domain (e.g., `trusion.ai`).
3. Update the `FRONTEND_ORIGIN` variable in Railway to match.
4. Update the CSP in `public/_headers` to include your domain in `connect-src`.

---

## Step 5: Configure Frontend API URL

In `public/index.html`, find the `API_BASE_URL` configuration (near the top of the script section) and either:

- Set it via a `window.TRUSION_API_BASE` global before the script loads, OR
- Update the fallback string to point to your Railway backend URL.

For Cloudflare Pages, you can use a `_redirects` rule or an environment-based approach. The simplest method:

```html
<script>window.TRUSION_API_BASE = 'https://trusion-backend.up.railway.app';</script>
```

Add this line before the main application `<script>` tag in `index.html`.

---

## Step 6: Verify Deployment

1. Visit the Cloudflare Pages URL — the landing page should load.
2. Click **Launch App** — if Supabase is configured, the auth gate appears.
3. Sign in — you should be redirected to the dashboard.
4. Try the Scam Analyzer — the request should go to your Railway backend, not directly to Anthropic.
5. Check Railway logs — you should see structured JSON request logs.
6. Run `/health` on the backend — should return `status: ok`.

---

## Rollback Procedure

### Cloudflare Pages
1. Go to Cloudflare Pages → your project → **Deployments**.
2. Find the last known good deployment.
3. Click **⋯** → **Rollback to this deployment**.
4. The rollback is instantaneous — no rebuild needed.

### Railway
1. Go to Railway → your service → **Deployments**.
2. Find the last successful deployment.
3. Click **Rollback**.
4. Railway will redeploy the previous commit.

### Database
1. Supabase automatically creates daily backups.
2. To restore: Supabase Dashboard → **Database → Backups**.
3. Select the backup point and click **Restore**.
4. **Warning:** Database restore is destructive — all data after the restore point is lost.

---

## Production Branch & Commands

| Item | Value |
|------|-------|
| Production branch | `main` |
| Frontend build command | (none — static files) |
| Frontend output directory | `public/` |
| Backend start command | `node server.js` |
| Backend health check path | `/health` |
| Backend root directory | `backend/` |
