/**
 * TRUSION AI — Backend API Server
 * Express.js backend for Railway deployment.
 *
 * Endpoints:
 *   GET  /health                    — health check
 *   POST /api/ai/analyze            — text-based AI analysis (auth required)
 *   POST /api/ai/analyze-image      — image-based AI analysis (auth required)
 *   GET  /api/auth/role             — server-confirmed user role (auth required)
 *   POST /api/billing/checkout     — create checkout session (auth required)
 *   POST /api/billing/webhook       — payment gateway webhook (signature verified)
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ─── Configuration ───────────────────────────────────────────
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// ─── Supabase Admin Client (server-side only) ────────────────
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

// ─── Anthropic Client (server-side only) ────────────────────
const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null;

// ─── Middleware ──────────────────────────────────────────────
const corsOptions = {
  origin: NODE_ENV === 'production'
    ? (FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN.split(',').map(s => s.trim()))
    : true,
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '6mb' })); // 6MB max for image base64

// Request logging with correlation ID
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  console.log(JSON.stringify({
    type: 'REQUEST',
    method: req.method,
    path: req.path,
    correlationId,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  }));

  res.on('finish', () => {
    console.log(JSON.stringify({
      type: 'RESPONSE',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      correlationId,
      durationMs: Date.now() - req.startTime || 0,
    }));
  });
  req.startTime = Date.now();
  next();
});

// ─── Auth Middleware ────────────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', correlationId: req.correlationId });
  }
  const token = authHeader.split(' ')[1];
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Auth service not configured', correlationId: req.correlationId });
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token', correlationId: req.correlationId });
    }
    req.user = data.user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Auth verification failed', correlationId: req.correlationId });
  }
}

// ─── Rate Limiting ───────────────────────────────────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: (req) => {
    // Higher limits for paid users — checked in handler
    return 10; // default: free plan
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Please try again shortly.' },
});

// ─── Plan/Role helpers ───────────────────────────────────────
async function getUserPlan(userId) {
  if (!supabaseAdmin || !userId) return 'free';
  try {
    const { data } = await supabaseAdmin
      .from('user_roles')
      .select('role, plan')
      .eq('user_id', userId)
      .single();
    return data?.plan || data?.role || 'free';
  } catch {
    return 'free';
  }
}

async function getUserRoleServer(userId) {
  if (!supabaseAdmin || !userId) return 'free';
  try {
    const { data } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();
    return data?.role || 'free';
  } catch {
    return 'free';
  }
}

// ─── Input Validation ────────────────────────────────────────
const MAX_TEXT_LENGTH = 10000; // 10KB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB base64

function validateTextRequest(body) {
  if (!body.systemPrompt || typeof body.systemPrompt !== 'string') {
    return { error: 'systemPrompt is required and must be a string' };
  }
  if (!body.userMessage || typeof body.userMessage !== 'string') {
    return { error: 'userMessage is required and must be a string' };
  }
  if (body.userMessage.length > MAX_TEXT_LENGTH) {
    return { error: `userMessage exceeds ${MAX_TEXT_LENGTH} characters` };
  }
  if (body.systemPrompt.length > MAX_TEXT_LENGTH) {
    return { error: `systemPrompt exceeds ${MAX_TEXT_LENGTH} characters` };
  }
  return null;
}

function validateImageRequest(body) {
  const textError = validateTextRequest(body);
  if (textError) return textError;
  if (!body.image || !body.image.base64Data || !body.image.mediaType) {
    return { error: 'image.base64Data and image.mediaType are required' };
  }
  if (!/^image\/(jpeg|png|gif|webp)$/.test(body.image.mediaType)) {
    return { error: 'Unsupported media type. Allowed: jpeg, png, gif, webp' };
  }
  if (body.image.base64Data.length > MAX_IMAGE_SIZE) {
    return { error: `Image exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB` };
  }
  return null;
}

// ─── AI Schema Validation ───────────────────────────────────
function validateAIOutput(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  // Expect at least score and risk fields
  if (typeof parsed.score !== 'number') return false;
  if (typeof parsed.risk !== 'string') return false;
  return true;
}

async function callAnthropic(systemPrompt, userMessage, isVision = false, imageData = null) {
  if (!anthropic) {
    throw { status: 503, message: 'AI service not configured (ANTHROPIC_API_KEY missing)' };
  }

  const messageParams = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: isVision
        ? [
            { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64Data } },
            { type: 'text', text: userMessage }
          ]
        : userMessage
    }]
  };

  const response = await anthropic.messages.create(messageParams);
  const raw = response.content.map(b => b.text || '').join('');
  // Parse JSON from AI response (strip markdown fences)
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ─── Health Endpoint ────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    services: {
      supabase: !!supabaseAdmin,
      anthropic: !!anthropic,
    }
  });
});

// ─── AI Analyze (text) ──────────────────────────────────────
app.post('/api/ai/analyze', requireAuth, aiLimiter, async (req, res) => {
  const validationError = validateTextRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError.error, correlationId: req.correlationId });
  }

  const plan = await getUserPlan(req.user.id);
  // Enforce scan quota
  if (plan === 'free') {
    const { count } = await supabaseAdmin
      .from('scan_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    if (count >= 10) {
      return res.status(402).json({
        error: 'Monthly scan limit reached (10 scans for Free plan). Upgrade for unlimited scans.',
        correlationId: req.correlationId,
      });
    }
  }

  try {
    const result = await callAnthropic(req.body.systemPrompt, req.body.userMessage);
    if (!validateAIOutput(result)) {
      console.warn(JSON.stringify({
        type: 'AI_OUTPUT_VALIDATION_FAILED',
        correlationId: req.correlationId,
        userId: req.user.id,
      }));
    }

    // Log scan
    if (supabaseAdmin) {
      await supabaseAdmin.from('scan_logs').insert({
        user_id: req.user.id,
        scan_type: 'text',
        risk_score: result.score || 0,
        risk_level: result.risk || 'unknown',
        correlation_id: req.correlationId,
      });
    }

    res.json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    console.error(JSON.stringify({
      type: 'AI_REQUEST_ERROR',
      correlationId: req.correlationId,
      error: err.message,
    }));
    const status = err.status || 500;
    res.status(status).json({
      error: status === 503 ? 'AI service unavailable' : 'AI request failed',
      correlationId: req.correlationId,
    });
  }
});

// ─── AI Analyze (image) ─────────────────────────────────────
app.post('/api/ai/analyze-image', requireAuth, aiLimiter, async (req, res) => {
  const validationError = validateImageRequest(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError.error, correlationId: req.correlationId });
  }

  const plan = await getUserPlan(req.user.id);
  if (plan === 'free') {
    return res.status(402).json({
      error: 'Image analysis requires a paid plan. Upgrade to Basic or higher.',
      correlationId: req.correlationId,
    });
  }

  try {
    const result = await callAnthropic(
      req.body.systemPrompt,
      req.body.userText,
      true,
      { base64Data: req.body.image.base64Data, mediaType: req.body.image.mediaType }
    );
    res.json({ data: result, correlationId: req.correlationId });
  } catch (err) {
    console.error(JSON.stringify({
      type: 'AI_IMAGE_REQUEST_ERROR',
      correlationId: req.correlationId,
      error: err.message,
    }));
    const status = err.status || 500;
    res.status(status).json({
      error: status === 503 ? 'AI service unavailable' : 'Image analysis failed',
      correlationId: req.correlationId,
    });
  }
});

// ─── Auth: Get Server-Confirmed Role ────────────────────────
app.get('/api/auth/role', requireAuth, async (req, res) => {
  const role = await getUserRoleServer(req.user.id);
  const plan = await getUserPlan(req.user.id);
  res.json({ role, plan, userId: req.user.id });
});

// ─── Billing: Create Checkout ───────────────────────────────
app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const { planId, gateway, billingCycle } = req.body;
  if (!planId || !['basic', 'pro', 'business'].includes(planId)) {
    return res.status(400).json({ error: 'Invalid planId', correlationId: req.correlationId });
  }

  // Look up price server-side (never trust client-sent price)
  const PLAN_PRICES = {
    basic: { monthly: 49000, yearly: 490000 },
    pro: { monthly: 99000, yearly: 990000 },
    business: { monthly: 299000, yearly: 2990000 },
  };
  const price = PLAN_PRICES[planId]?.[billingCycle || 'monthly'];
  if (!price) {
    return res.status(400).json({ error: 'Invalid billing cycle', correlationId: req.correlationId });
  }

  // TODO: Integrate with actual payment gateway (Xendit/Midtrans)
  // For now, return a clear "not configured" response
  res.status(503).json({
    error: 'Payment gateway not yet configured. Set PAYMENT_PROVIDER and related env vars to enable checkout.',
    planId, price, currency: 'IDR',
    correlationId: req.correlationId,
  });
});

// ─── Billing: Webhook ───────────────────────────────────────
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Webhook signature verification must be implemented per payment provider.
  // For Xendit: verify X-Callback-Token header matches XENDIT_WEBHOOK_TOKEN
  // For Midtrans: verify signature using server key
  const webhookToken = req.headers['x-callback-token'];
  const expectedToken = process.env.PAYMENT_WEBHOOK_SECRET;

  if (!expectedToken || webhookToken !== expectedToken) {
    console.warn(JSON.stringify({
      type: 'WEBHOOK_REJECTED',
      reason: 'Invalid or missing webhook token',
      ip: req.ip,
    }));
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  try {
    const event = JSON.parse(req.body.toString());

    // Idempotency check: verify event hasn't been processed
    if (supabaseAdmin) {
      const { data: existing } = await supabaseAdmin
        .from('payment_logs')
        .select('id')
        .eq('gateway_event_id', event.id || event.external_id)
        .single();
      if (existing) {
        return res.json({ status: 'already_processed' });
      }
    }

    // Process payment event
    if (event.status === 'PAID' || event.status === 'SETTLED' || event.status === 'SUCCESS') {
      // Grant entitlement
      if (supabaseAdmin) {
        await supabaseAdmin.from('user_roles').upsert({
          user_id: event.user_id,
          plan: event.plan_id,
          role: event.plan_id,
          billing_status: 'active',
          renewed_at: new Date().toISOString(),
        });
      }
      console.log(JSON.stringify({
        type: 'PAYMENT_SUCCESS',
        userId: event.user_id,
        plan: event.plan_id,
      }));
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error(JSON.stringify({ type: 'WEBHOOK_ERROR', error: err.message }));
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ─── Error Handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    type: 'UNHANDLED_ERROR',
    error: err.message,
    stack: NODE_ENV === 'development' ? err.stack : undefined,
    correlationId: req.correlationId,
  }));
  res.status(500).json({
    error: 'Internal server error',
    correlationId: req.correlationId,
  });
});

// ─── Graceful Shutdown ──────────────────────────────────────
process.on('SIGTERM', () => {
  console.log(JSON.stringify({ type: 'SHUTDOWN', signal: 'SIGTERM' }));
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log(JSON.stringify({ type: 'SHUTDOWN', signal: 'SIGINT' }));
  process.exit(0);
});

// ─── Start ──────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    type: 'SERVER_START',
    port: PORT,
    env: NODE_ENV,
    timestamp: new Date().toISOString(),
    services: {
      supabase: !!supabaseAdmin,
      anthropic: !!anthropic,
    }
  }));
});
