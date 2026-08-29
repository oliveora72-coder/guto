import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

export const cfg = {
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.VERCEL_ENV === 'production',
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  provider: process.env.PAYMENT_PROVIDER || 'sandbox',
  mpAccessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || '',
  mpPublicKey: process.env.MERCADO_PAGO_PUBLIC_KEY || '',
  mpWebhookSecret: process.env.MERCADO_PAGO_WEBHOOK_SECRET || '',
  webhookSecret: process.env.WEBHOOK_SIGNING_SECRET || '',
  cronSecret: process.env.CRON_SECRET || '',
  adminEmail: (process.env.ADMIN_EMAIL || '').toLowerCase(),
  openRegistration: process.env.ALLOW_OPEN_REGISTRATION !== 'false',
  defaultFeeBps: Number(process.env.DEFAULT_FEE_BPS || 199),
  defaultFixedFee: Number(process.env.DEFAULT_FIXED_FEE_CENTS || 49),
};

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new HttpError(413, 'payload_too_large', 'O corpo da requisição excede 1 MB.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON inválido.');
  }
}

export function publicError(error, requestId) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message, details: error.details }, request_id: requestId } };
  }
  console.error(`[${requestId}]`, error);
  return { status: 500, body: { error: { code: 'internal_error', message: 'Não foi possível concluir a operação.' }, request_id: requestId } };
}

function requireDatabase() {
  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    throw new HttpError(503, 'database_not_configured', 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  }
}

export async function db(path, { method = 'GET', body, headers = {}, single = false } = {}) {
  requireDatabase();
  const response = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: `Bearer ${cfg.supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: single ? 'return=representation' : 'return=representation',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    const message = data?.message || data?.hint || `Falha no banco (${response.status}).`;
    throw new HttpError(response.status === 404 ? 404 : 500, 'database_error', message, data?.code);
  }
  if (single) return Array.isArray(data) ? (data[0] || null) : data;
  return data;
}

export async function rpc(name, args) {
  return db(`rpc/${name}`, { method: 'POST', body: args, single: true });
}

export function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, 'invalid_email', 'Informe um e-mail válido.');
  }
  return email;
}

export function cleanText(value, name, min = 1, max = 160) {
  const text = String(value || '').trim();
  if (text.length < min || text.length > max) throw new HttpError(400, 'invalid_field', `${name} deve ter entre ${min} e ${max} caracteres.`);
  return text;
}

export function amountToCents(value) {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new HttpError(400, 'invalid_amount', 'Informe um valor maior que zero.');
  const cents = Math.round(number * 100);
  if (cents < 50 || cents > 10_000_000_00) throw new HttpError(400, 'amount_out_of_range', 'O valor deve ficar entre R$ 0,50 e R$ 10.000.000,00.');
  return cents;
}

export const money = cents => (Number(cents) / 100).toFixed(2);
export const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
export const randomId = () => crypto.randomUUID();
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
    throw new HttpError(400, 'weak_password', 'A senha deve ter entre 10 e 128 caracteres.');
  }
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [kind, cost, salt64, hash64] = String(encoded).split('$');
    if (kind !== 'scrypt' || cost !== '16384') return false;
    const derived = await scryptAsync(password, Buffer.from(salt64, 'base64url'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(Buffer.from(hash64, 'base64url'), Buffer.from(derived));
  } catch { return false; }
}

function b64json(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }

export function signSession(payload, ttlSeconds = 60 * 60 * 12) {
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) throw new HttpError(503, 'jwt_not_configured', 'Configure um JWT_SECRET com pelo menos 32 caracteres.');
  const now = Math.floor(Date.now() / 1000);
  const header = b64json({ alg: 'HS256', typ: 'JWT' });
  const body = b64json({ ...payload, iat: now, exp: now + ttlSeconds, jti: randomId() });
  const signature = crypto.createHmac('sha256', cfg.jwtSecret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifySession(token) {
  try {
    const [header, body, signature] = String(token).split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac('sha256', cfg.jwtSecret).update(`${header}.${body}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

export function parseCookies(req) {
  const result = {};
  for (const item of String(req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index > 0) result[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return result;
}

export function sessionCookie(token) {
  return `spacepay_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${cfg.cookieSecure ? '; Secure' : ''}`;
}

export function clearSessionCookie() {
  return `spacepay_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.cookieSecure ? '; Secure' : ''}`;
}

export async function authenticate(req, requiredScopes = []) {
  const bearer = String(req.headers.authorization || '');
  if (bearer.startsWith('Bearer sp_')) {
    const raw = bearer.slice(7);
    const key = await db(`api_keys?key_hash=eq.${sha256(raw)}&revoked_at=is.null&select=*,merchants(*)&limit=1`, { single: true });
    if (!key || (key.expires_at && new Date(key.expires_at) < new Date())) throw new HttpError(401, 'invalid_api_key', 'Chave de API inválida ou expirada.');
    for (const scope of requiredScopes) if (!key.scopes?.includes(scope)) throw new HttpError(403, 'missing_scope', `A chave não possui o escopo ${scope}.`);
    db(`api_keys?id=eq.${key.id}`, { method: 'PATCH', body: { last_used_at: new Date().toISOString() } }).catch(() => {});
    return { type: 'api_key', merchant: key.merchants, merchantId: key.merchant_id, apiKey: key, role: 'merchant' };
  }

  const token = parseCookies(req).spacepay_session;
  const session = token && verifySession(token);
  if (!session?.sub) throw new HttpError(401, 'unauthenticated', 'Faça login para continuar.');
  const user = await db(`users?id=eq.${session.sub}&active=eq.true&select=*,merchants(*)&limit=1`, { single: true });
  if (!user) throw new HttpError(401, 'session_expired', 'Sua sessão expirou.');
  return { type: 'session', user, merchant: user.merchants, merchantId: user.merchant_id, role: user.role };
}

export function requireRole(auth, roles) {
  if (!roles.includes(auth.role)) throw new HttpError(403, 'forbidden', 'Você não possui permissão para esta operação.');
}

export function checkOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (String(req.headers.authorization || '').startsWith('Bearer sp_')) return;
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new URL(cfg.appUrl).origin;
  if (origin !== allowed) throw new HttpError(403, 'invalid_origin', 'Origem da requisição não permitida.');
}

export async function rateLimit(key, limit, windowSeconds) {
  const result = await rpc('consume_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (!result?.allowed) throw new HttpError(429, 'rate_limited', 'Muitas tentativas. Aguarde e tente novamente.');
  return result;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

export function encryptSecret(value) {
  const master = cfg.webhookSecret || cfg.jwtSecret;
  if (!master) throw new HttpError(503, 'encryption_not_configured', 'Configure WEBHOOK_SIGNING_SECRET.');
  const key = crypto.createHash('sha256').update(master).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

export function decryptSecret(encoded) {
  const master = cfg.webhookSecret || cfg.jwtSecret;
  const [iv64, tag64, data64] = String(encoded).split('.');
  const key = crypto.createHash('sha256').update(master).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data64, 'base64url')), decipher.final()]).toString('utf8');
}

export function calculateFee(amountCents, merchant) {
  const fee = Math.min(amountCents, Math.round(amountCents * Number(merchant.fee_bps || 0) / 10000) + Number(merchant.fixed_fee_cents || 0));
  return { fee, net: amountCents - fee };
}

export async function evaluateRisk(merchantId, input) {
  const flags = [];
  let score = 0;
  const rules = await db(`risk_rules?or=(merchant_id.eq.${merchantId},merchant_id.is.null)&active=eq.true&select=*`);
  for (const rule of rules || []) {
    let matched = false;
    if (rule.rule_type === 'max_amount' && input.amountCents > Number(rule.config?.amount_cents || Infinity)) matched = true;
    if (rule.rule_type === 'email_domain' && rule.config?.blocked?.includes(String(input.email || '').split('@')[1])) matched = true;
    if (rule.rule_type === 'manual_review') matched = true;
    if (matched) {
      flags.push(rule.name);
      score += rule.action === 'block' ? 100 : rule.action === 'review' ? 60 : 20;
    }
  }
  return { score: Math.min(100, score), flags, blocked: score >= 100 };
}

async function mpRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!cfg.mpAccessToken) throw new HttpError(503, 'mercado_pago_not_configured', 'Configure MERCADO_PAGO_ACCESS_TOKEN.');
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.mpAccessToken}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(502, 'provider_error', data?.message || 'O Mercado Pago recusou a solicitação.', data);
  return data;
}

function mapProviderStatus(status) {
  const map = { processed: 'approved', approved: 'approved', action_required: 'action_required', pending: 'pending', rejected: 'rejected', failed: 'failed', cancelled: 'cancelled', refunded: 'refunded', expired: 'expired' };
  return map[status] || 'pending';
}

export async function createProviderCharge(input) {
  if (cfg.provider === 'sandbox') {
    const id = `SBX-${Date.now()}-${randomToken(5)}`;
    return {
      id,
      status: 'action_required',
      statusDetail: 'sandbox_waiting_payment',
      paymentId: `SBXPAY-${randomToken(6)}`,
      pix: input.method === 'pix' ? {
        copyPaste: `00020101021226820014BR.GOV.BCB.PIX2560sandbox.spacepay.local/${id}520400005303986540${money(input.amountCents)}5802BR5917SPACEPAY SANDBOX6009SAO PAULO62070503***6304DEMO`,
        qrBase64: null,
        ticketUrl: `${cfg.appUrl}/#sandbox/${id}`,
      } : null,
      raw: { sandbox: true, id, auto_approve_after: 'manual_webhook' },
    };
  }

  const payment = {
    amount: money(input.amountCents),
    payment_method: input.method === 'pix'
      ? { id: 'pix', type: 'bank_transfer' }
      : { id: input.paymentMethodId, type: 'credit_card', token: input.cardToken },
    ...(input.method === 'card' ? { installments: Number(input.installments || 1) } : {}),
  };
  const order = await mpRequest('/v1/orders', {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: {
      type: 'online',
      processing_mode: 'automatic',
      external_reference: input.externalReference,
      total_amount: money(input.amountCents),
      payer: { email: input.payerEmail, first_name: input.payerName?.split(' ')[0] || 'Cliente' },
      transactions: { payments: [payment] },
    },
  });
  const providerPayment = order.transactions?.payments?.[0] || {};
  return {
    id: order.id,
    paymentId: providerPayment.id,
    status: mapProviderStatus(order.status),
    statusDetail: order.status_detail,
    pix: input.method === 'pix' ? {
      copyPaste: providerPayment.payment_method?.qr_code,
      qrBase64: providerPayment.payment_method?.qr_code_base64,
      ticketUrl: providerPayment.payment_method?.ticket_url,
    } : null,
    raw: order,
  };
}

export async function getProviderCharge(providerId) {
  if (cfg.provider === 'sandbox') return { id: providerId, status: 'pending', statusDetail: 'sandbox', raw: { sandbox: true } };
  const order = await mpRequest(`/v1/orders/${encodeURIComponent(providerId)}`);
  return { id: order.id, status: mapProviderStatus(order.status), statusDetail: order.status_detail, raw: order };
}

export async function refundProviderCharge(providerId, amountCents, idempotencyKey) {
  if (cfg.provider === 'sandbox') return { id: `RFD-${randomToken(8)}`, status: 'approved', raw: { sandbox: true, amount: money(amountCents) } };
  const data = await mpRequest(`/v1/orders/${encodeURIComponent(providerId)}/refund`, {
    method: 'POST', idempotencyKey, body: amountCents ? { amount: money(amountCents) } : undefined,
  });
  return { id: data.id || data.transactions?.refunds?.[0]?.id, status: data.status === 'refunded' ? 'approved' : 'pending', raw: data };
}

export function verifyMercadoPagoSignature(req, dataId) {
  if (!cfg.mpWebhookSecret) return cfg.provider === 'sandbox';
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(signature.split(',').map(item => item.trim().split('=')));
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', cfg.mpWebhookSecret).update(manifest).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(parts.v1, 'hex'), Buffer.from(expected, 'hex')); } catch { return false; }
}

export async function emitEvent(merchantId, eventType, objectType, objectId, payload) {
  const event = await db('webhook_events', { method: 'POST', body: { merchant_id: merchantId, event_type: eventType, object_type: objectType, object_id: objectId, payload }, single: true });
  const endpoints = await db(`webhook_endpoints?merchant_id=eq.${merchantId}&active=eq.true&events=cs.{${eventType}}&select=id`);
  if (endpoints?.length) {
    await db('webhook_deliveries', { method: 'POST', body: endpoints.map(endpoint => ({ endpoint_id: endpoint.id, event_id: event.id })) });
  }
  return event;
}

export async function audit(req, auth, action, entityType, entityId, details = {}) {
  const payload = {
    merchant_id: auth?.merchantId || null,
    actor_user_id: auth?.user?.id || null,
    action,
    entity_type: entityType || null,
    entity_id: entityId ? String(entityId) : null,
    ip_hash: sha256(clientIp(req)),
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
    details,
  };
  await db('audit_logs', { method: 'POST', body: payload }).catch(error => console.error('audit', error));
}

export function signMerchantWebhook(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function maskPixKey(value) {
  const raw = String(value || '').trim();
  if (raw.length <= 6) return '*'.repeat(raw.length);
  return `${raw.slice(0, 3)}${'*'.repeat(Math.min(12, raw.length - 6))}${raw.slice(-3)}`;
}
