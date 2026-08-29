import {
  HttpError, cfg, send, readJson, publicError, db, rpc, cleanEmail, cleanText,
  amountToCents, hashPassword, verifyPassword, signSession, sessionCookie,
  clearSessionCookie, authenticate, requireRole, checkOrigin, rateLimit, clientIp,
  sha256, randomId, randomToken, calculateFee, evaluateRisk, createProviderCharge,
  getProviderCharge, refundProviderCharge, verifyMercadoPagoSignature, emitEvent,
  audit, encryptSecret, decryptSecret, signMerchantWebhook, maskPixKey, money,
} from './lib.js';

function routeOf(req) {
  const url = new URL(req.url, 'http://internal');
  const queryRoute = url.searchParams.get('route');
  return String(queryRoute || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
}

function queryOf(req) { return new URL(req.url, 'http://internal').searchParams; }
function uuid(value, name = 'id') {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new HttpError(400, 'invalid_id', `${name} inválido.`);
  return text;
}
function pageParams(req) {
  const q = queryOf(req);
  const page = Math.max(1, Math.min(10000, Number(q.get('page') || 1)));
  const limit = Math.max(1, Math.min(100, Number(q.get('limit') || 25)));
  return { page, limit, offset: (page - 1) * limit, status: q.get('status'), search: q.get('search') };
}
function isAdmin(auth) { return ['admin', 'support', 'analyst'].includes(auth.role); }
function merchantFilter(auth) { return isAdmin(auth) && !auth.merchantId ? '' : `merchant_id=eq.${auth.merchantId}&`; }

function publicCharge(charge) {
  if (!charge) return null;
  const { provider_payload, payer_document, ...safe } = charge;
  return safe;
}

async function idempotent(merchantId, route, key, request, work) {
  if (!key || String(key).length < 8 || String(key).length > 128) throw new HttpError(400, 'idempotency_required', 'Envie um header X-Idempotency-Key entre 8 e 128 caracteres.');
  const requestHash = sha256(JSON.stringify(request));
  const existing = await db(`idempotency_keys?merchant_id=eq.${merchantId}&route=eq.${encodeURIComponent(route)}&idempotency_key=eq.${encodeURIComponent(key)}&select=*&limit=1`, { single: true });
  if (existing?.response_body) {
    if (existing.request_hash !== requestHash) throw new HttpError(409, 'idempotency_conflict', 'Esta chave já foi usada com outro conteúdo.');
    return { replay: true, status: existing.response_status, body: existing.response_body };
  }
  if (existing && new Date(existing.locked_until) > new Date()) throw new HttpError(409, 'idempotency_in_progress', 'Uma requisição com esta chave já está em processamento.');
  const row = existing || await db('idempotency_keys', { method: 'POST', body: { merchant_id: merchantId, route, idempotency_key: key, request_hash: requestHash }, single: true });
  const result = await work();
  await db(`idempotency_keys?id=eq.${row.id}`, { method: 'PATCH', body: { response_status: result.status, response_body: result.body, locked_until: new Date().toISOString() } });
  return { replay: false, ...result };
}

async function handleRegister(req) {
  if (!cfg.openRegistration) throw new HttpError(403, 'registration_closed', 'O cadastro está temporariamente fechado.');
  await rateLimit(`register:${sha256(clientIp(req))}`, 5, 3600);
  const body = await readJson(req);
  const name = cleanText(body.name, 'Nome', 2, 100);
  const businessName = cleanText(body.business_name || `${name} Store`, 'Nome da empresa', 2, 100);
  const email = cleanEmail(body.email);
  const passwordHash = await hashPassword(body.password);
  const slugBase = String(body.slug || businessName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `loja-${randomToken(4).toLowerCase()}`;
  const role = cfg.adminEmail && email === cfg.adminEmail ? 'admin' : 'merchant';
  let created;
  try {
    created = await rpc('register_merchant', { p_name: name, p_business_name: businessName, p_slug: `${slugBase}-${randomToken(3).toLowerCase()}`, p_email: email, p_password_hash: passwordHash, p_role: role, p_fee_bps: cfg.defaultFeeBps, p_fixed_fee_cents: cfg.defaultFixedFee });
  } catch (error) {
    if (String(error.message).toLowerCase().includes('unique')) throw new HttpError(409, 'email_exists', 'Já existe uma conta com este e-mail.');
    throw error;
  }
  const token = signSession({ sub: created.user_id, merchant_id: created.merchant_id, role });
  return { status: 201, body: { user: { id: created.user_id, name, email, role }, merchant: { id: created.merchant_id, name: businessName } }, headers: { 'Set-Cookie': sessionCookie(token) } };
}

async function handleLogin(req) {
  const body = await readJson(req);
  const email = cleanEmail(body.email);
  await rateLimit(`login:${sha256(`${clientIp(req)}:${email}`)}`, 10, 900);
  const user = await db(`users?email=eq.${encodeURIComponent(email)}&select=*,merchants(*)&limit=1`, { single: true });
  const valid = user?.active && (!user.locked_until || new Date(user.locked_until) < new Date()) && await verifyPassword(String(body.password || ''), user.password_hash);
  if (!valid) {
    if (user) {
      const count = Number(user.failed_login_count || 0) + 1;
      await db(`users?id=eq.${user.id}`, { method: 'PATCH', body: { failed_login_count: count, ...(count >= 5 ? { locked_until: new Date(Date.now() + 15 * 60_000).toISOString() } : {}) } });
    }
    throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
  }
  await db(`users?id=eq.${user.id}`, { method: 'PATCH', body: { failed_login_count: 0, locked_until: null, last_login_at: new Date().toISOString() } });
  const token = signSession({ sub: user.id, merchant_id: user.merchant_id, role: user.role });
  await audit(req, { user, merchantId: user.merchant_id }, 'auth.login', 'user', user.id);
  return { status: 200, body: { user: { id: user.id, name: user.name, email: user.email, role: user.role }, merchant: user.merchants }, headers: { 'Set-Cookie': sessionCookie(token) } };
}

async function handleDashboard(auth) {
  const id = auth.merchantId;
  if (!id) return adminOverview();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [merchant, charges, refunds, withdrawals] = await Promise.all([
    db(`merchants?id=eq.${id}&select=*&limit=1`, { single: true }),
    db(`charges?merchant_id=eq.${id}&created_at=gte.${since}&select=id,status,amount_cents,fee_cents,net_amount_cents,method,created_at&order=created_at.desc&limit=500`),
    db(`refunds?merchant_id=eq.${id}&created_at=gte.${since}&select=amount_cents,status`),
    db(`withdrawals?merchant_id=eq.${id}&select=id,status,amount_cents,created_at&order=created_at.desc&limit=10`),
  ]);
  const approved = charges.filter(c => c.status === 'approved');
  return {
    merchant,
    metrics: {
      gross_volume_cents: approved.reduce((sum, c) => sum + Number(c.amount_cents), 0),
      net_volume_cents: approved.reduce((sum, c) => sum + Number(c.net_amount_cents), 0),
      fees_cents: approved.reduce((sum, c) => sum + Number(c.fee_cents), 0),
      approved_count: approved.length,
      pending_count: charges.filter(c => ['pending', 'action_required'].includes(c.status)).length,
      approval_rate: charges.length ? Math.round(approved.length / charges.length * 1000) / 10 : 0,
      refunds_cents: refunds.filter(r => r.status === 'approved').reduce((sum, r) => sum + Number(r.amount_cents), 0),
    },
    recent_charges: charges.slice(0, 10),
    recent_withdrawals: withdrawals,
  };
}

async function listCharges(req, auth) {
  const { page, limit, offset, status, search } = pageParams(req);
  let filter = merchantFilter(auth);
  if (status) filter += `status=eq.${encodeURIComponent(status)}&`;
  if (search) filter += `or=(external_reference.ilike.*${encodeURIComponent(search)}*,payer_email.ilike.*${encodeURIComponent(search)}*)&`;
  const rows = await db(`charges?${filter}select=*&order=created_at.desc&offset=${offset}&limit=${limit}`);
  return { data: rows.map(publicCharge), pagination: { page, limit, has_more: rows.length === limit } };
}

async function createCharge(req, auth) {
  if (!auth.merchantId) throw new HttpError(400, 'merchant_required', 'Selecione um lojista.');
  const body = await readJson(req);
  const key = String(req.headers['x-idempotency-key'] || body.idempotency_key || '');
  return idempotent(auth.merchantId, 'POST:/v1/charges', key, body, async () => {
    const method = String(body.method || 'pix');
    if (!['pix', 'card'].includes(method)) throw new HttpError(400, 'unsupported_method', 'Use pix ou card.');
    if (method === 'card' && (!body.card_token || !body.payment_method_id)) throw new HttpError(400, 'card_token_required', 'Para cartão, envie card_token e payment_method_id gerados pelo Mercado Pago.js.');
    const merchant = await db(`merchants?id=eq.${auth.merchantId}&status=eq.active&select=*&limit=1`, { single: true });
    if (!merchant) throw new HttpError(403, 'merchant_inactive', 'A conta do lojista não está ativa.');
    const amountCents = amountToCents(body.amount);
    const payerEmail = cleanEmail(body.payer?.email || body.payer_email);
    const payerName = cleanText(body.payer?.name || body.payer_name || 'Cliente', 'Nome do pagador', 2, 100);
    const externalReference = cleanText(body.external_reference || randomId(), 'Referência externa', 3, 100);
    const risk = await evaluateRisk(auth.merchantId, { amountCents, email: payerEmail });
    if (risk.blocked) throw new HttpError(403, 'risk_blocked', 'A transação foi bloqueada pelas regras de risco.');
    const { fee, net } = calculateFee(amountCents, merchant);
    const charge = await db('charges', { method: 'POST', single: true, body: {
      merchant_id: auth.merchantId, customer_id: body.customer_id || null, payment_link_id: body.payment_link_id || null,
      external_reference: externalReference, provider: cfg.provider, method, status: 'created', amount_cents: amountCents,
      fee_cents: fee, net_amount_cents: net, payer_name: payerName, payer_email: payerEmail,
      payer_document: body.payer?.document || null, description: String(body.description || '').slice(0, 200) || null,
      risk_score: risk.score, risk_flags: risk.flags, metadata: body.metadata || {}, expires_at: body.expires_at || new Date(Date.now() + 30 * 60_000).toISOString(),
    }});
    try {
      const provider = await createProviderCharge({ method, amountCents, payerEmail, payerName, externalReference, idempotencyKey: key, cardToken: body.card_token, paymentMethodId: body.payment_method_id, installments: body.installments });
      const updated = await db(`charges?id=eq.${charge.id}`, { method: 'PATCH', single: true, body: {
        provider_order_id: provider.id, provider_payment_id: provider.paymentId || null, status: provider.status,
        status_detail: provider.statusDetail || null, pix_copy_paste: provider.pix?.copyPaste || null,
        pix_qr_base64: provider.pix?.qrBase64 || null, ticket_url: provider.pix?.ticketUrl || null,
        provider_payload: provider.raw || {}, updated_at: new Date().toISOString(),
      }});
      if (provider.status === 'approved') await rpc('settle_approved_charge', { p_charge_id: charge.id });
      await emitEvent(auth.merchantId, 'charge.created', 'charge', charge.id, { id: charge.id, status: provider.status, amount_cents: amountCents });
      await audit(req, auth, 'charge.create', 'charge', charge.id, { method, amount_cents: amountCents });
      return { status: 201, body: { data: publicCharge(updated) } };
    } catch (error) {
      await db(`charges?id=eq.${charge.id}`, { method: 'PATCH', body: { status: 'failed', status_detail: error.code || 'provider_error', updated_at: new Date().toISOString() } }).catch(() => {});
      throw error;
    }
  });
}

async function getCharge(id, auth) {
  const filter = isAdmin(auth) && !auth.merchantId ? '' : `merchant_id=eq.${auth.merchantId}&`;
  const charge = await db(`charges?id=eq.${uuid(id)}&${filter}select=*&limit=1`, { single: true });
  if (!charge) throw new HttpError(404, 'charge_not_found', 'Cobrança não encontrada.');
  return publicCharge(charge);
}

async function syncCharge(id, auth) {
  const charge = await getCharge(id, auth);
  if (!charge.provider_order_id) throw new HttpError(409, 'provider_id_missing', 'A cobrança ainda não possui referência no provedor.');
  const provider = await getProviderCharge(charge.provider_order_id);
  let updated = await db(`charges?id=eq.${charge.id}`, { method: 'PATCH', single: true, body: { status: provider.status, status_detail: provider.statusDetail, provider_payload: provider.raw, updated_at: new Date().toISOString() } });
  if (provider.status === 'approved') updated = await rpc('settle_approved_charge', { p_charge_id: charge.id });
  if (provider.status !== charge.status) await emitEvent(charge.merchant_id, 'charge.updated', 'charge', charge.id, { id: charge.id, status: provider.status });
  return publicCharge(updated);
}

async function refundCharge(req, id, auth) {
  const body = await readJson(req);
  const key = String(req.headers['x-idempotency-key'] || body.idempotency_key || '');
  const charge = await getCharge(id, auth);
  return idempotent(charge.merchant_id, `POST:/v1/charges/${charge.id}/refund`, key, body, async () => {
    if (!['approved', 'partially_refunded'].includes(charge.status)) throw new HttpError(409, 'charge_not_refundable', 'Esta cobrança não pode ser reembolsada.');
    const remaining = Number(charge.amount_cents) - Number(charge.refunded_amount_cents || 0);
    const amountCents = body.amount == null ? remaining : amountToCents(body.amount);
    if (amountCents > remaining) throw new HttpError(400, 'refund_exceeds_charge', 'O reembolso excede o saldo da cobrança.');
    const refund = await db('refunds', { method: 'POST', single: true, body: { merchant_id: charge.merchant_id, charge_id: charge.id, amount_cents: amountCents, reason: String(body.reason || '').slice(0, 200) || null, status: 'pending' } });
    try {
      const provider = await refundProviderCharge(charge.provider_order_id, amountCents, key);
      const approved = provider.status === 'approved';
      const updatedRefund = await db(`refunds?id=eq.${refund.id}`, { method: 'PATCH', single: true, body: { provider_refund_id: provider.id, status: approved ? 'approved' : 'pending', provider_payload: provider.raw, updated_at: new Date().toISOString() } });
      if (approved) await rpc('apply_approved_refund', { p_refund_id: refund.id });
      await emitEvent(charge.merchant_id, 'refund.updated', 'refund', refund.id, { id: refund.id, charge_id: charge.id, status: updatedRefund.status, amount_cents: amountCents });
      await audit(req, auth, 'refund.create', 'refund', refund.id, { charge_id: charge.id, amount_cents: amountCents });
      return { status: 201, body: { data: updatedRefund } };
    } catch (error) {
      await db(`refunds?id=eq.${refund.id}`, { method: 'PATCH', body: { status: 'failed', updated_at: new Date().toISOString() } }).catch(() => {});
      throw error;
    }
  });
}

async function listSimple(req, auth, table, select = '*') {
  const { page, limit, offset } = pageParams(req);
  const rows = await db(`${table}?${merchantFilter(auth)}select=${select}&order=created_at.desc&offset=${offset}&limit=${limit}`);
  return { data: rows, pagination: { page, limit, has_more: rows.length === limit } };
}

async function createCustomer(req, auth) {
  const body = await readJson(req);
  const customer = await db('customers', { method: 'POST', single: true, body: { merchant_id: auth.merchantId, external_id: body.external_id || null, name: cleanText(body.name, 'Nome', 2, 100), email: body.email ? cleanEmail(body.email) : null, phone: String(body.phone || '').slice(0, 30) || null, document: String(body.document || '').replace(/\D/g, '').slice(0, 14) || null, metadata: body.metadata || {} } });
  await audit(req, auth, 'customer.create', 'customer', customer.id);
  return customer;
}

async function createPaymentLink(req, auth) {
  const body = await readJson(req);
  const amountCents = body.amount == null ? null : amountToCents(body.amount);
  const link = await db('payment_links', { method: 'POST', single: true, body: { merchant_id: auth.merchantId, slug: `${String(body.slug || 'pay').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32)}-${randomToken(4).toLowerCase()}`, title: cleanText(body.title, 'Título', 2, 100), description: String(body.description || '').slice(0, 240) || null, amount_cents: amountCents, expires_at: body.expires_at || null, redirect_url: body.redirect_url || null, metadata: body.metadata || {} } });
  return { ...link, checkout_url: `${cfg.appUrl}/#pay/${link.slug}` };
}

async function getPublicPaymentLink(slug) {
  const cleanSlug = String(slug || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80);
  const link = await db(`payment_links?slug=eq.${encodeURIComponent(cleanSlug)}&active=eq.true&select=id,merchant_id,slug,title,description,amount_cents,currency,expires_at,redirect_url,merchants(name,status)&limit=1`, { single: true });
  if (!link || link.merchants?.status !== 'active' || (link.expires_at && new Date(link.expires_at) < new Date())) throw new HttpError(404, 'payment_link_not_found', 'Este link de pagamento não está disponível.');
  return { id: link.id, slug: link.slug, title: link.title, description: link.description, amount_cents: link.amount_cents, currency: link.currency, merchant_name: link.merchants.name, redirect_url: link.redirect_url };
}

async function checkoutPublicLink(req, slug) {
  const link = await getPublicPaymentLink(slug);
  await rateLimit(`checkout:${link.id}:${sha256(clientIp(req))}`, 15, 900);
  const body = await readJson(req);
  const key = String(req.headers['x-idempotency-key'] || body.idempotency_key || randomId());
  return idempotent(link.merchant_id || (await db(`payment_links?id=eq.${link.id}&select=merchant_id&limit=1`, { single: true })).merchant_id, `POST:/public/payment-links/${link.slug}/checkout`, key, body, async () => {
    const rawLink = await db(`payment_links?id=eq.${link.id}&select=merchant_id&limit=1`, { single: true });
    const merchant = await db(`merchants?id=eq.${rawLink.merchant_id}&status=eq.active&select=*&limit=1`, { single: true });
    if (!merchant) throw new HttpError(404, 'merchant_unavailable', 'O recebedor não está disponível.');
    const amountCents = link.amount_cents ? Number(link.amount_cents) : amountToCents(body.amount);
    const payerEmail = cleanEmail(body.email);
    const payerName = cleanText(body.name, 'Nome', 2, 100);
    const risk = await evaluateRisk(merchant.id, { amountCents, email: payerEmail });
    if (risk.blocked) throw new HttpError(403, 'risk_blocked', 'A transação foi bloqueada pelas regras de risco.');
    const { fee, net } = calculateFee(amountCents, merchant);
    const externalReference = `link-${link.id}-${randomToken(7)}`;
    const charge = await db('charges', { method: 'POST', single: true, body: { merchant_id: merchant.id, payment_link_id: link.id, external_reference: externalReference, provider: cfg.provider, method: 'pix', status: 'created', amount_cents: amountCents, fee_cents: fee, net_amount_cents: net, payer_name: payerName, payer_email: payerEmail, description: link.title, risk_score: risk.score, risk_flags: risk.flags, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() } });
    try {
      const provider = await createProviderCharge({ method: 'pix', amountCents, payerEmail, payerName, externalReference, idempotencyKey: key });
      const updated = await db(`charges?id=eq.${charge.id}`, { method: 'PATCH', single: true, body: { provider_order_id: provider.id, provider_payment_id: provider.paymentId || null, status: provider.status, status_detail: provider.statusDetail || null, pix_copy_paste: provider.pix?.copyPaste || null, pix_qr_base64: provider.pix?.qrBase64 || null, ticket_url: provider.pix?.ticketUrl || null, provider_payload: provider.raw || {}, updated_at: new Date().toISOString() } });
      if (provider.status === 'approved') await rpc('settle_approved_charge', { p_charge_id: charge.id });
      await emitEvent(merchant.id, 'charge.created', 'charge', charge.id, { id: charge.id, status: provider.status, amount_cents: amountCents });
      return { status: 201, body: { data: publicCharge(updated), redirect_url: link.redirect_url } };
    } catch (error) {
      await db(`charges?id=eq.${charge.id}`, { method: 'PATCH', body: { status: 'failed', status_detail: error.code || 'provider_error', updated_at: new Date().toISOString() } }).catch(() => {});
      throw error;
    }
  });
}

async function createApiKey(req, auth) {
  const body = await readJson(req);
  const mode = body.mode === 'live' ? 'live' : 'test';
  if (mode === 'live' && auth.merchant?.kyc_status !== 'approved') throw new HttpError(403, 'kyc_required', 'A aprovação cadastral é obrigatória para chaves live.');
  const raw = `sp_${mode}_${randomToken(32)}`;
  const row = await db('api_keys', { method: 'POST', single: true, body: { merchant_id: auth.merchantId, name: cleanText(body.name || 'Chave principal', 'Nome', 2, 80), prefix: raw.slice(0, 16), key_hash: sha256(raw), mode, scopes: Array.isArray(body.scopes) ? body.scopes : ['charges:read', 'charges:write', 'refunds:write'] } });
  await audit(req, auth, 'api_key.create', 'api_key', row.id, { mode, prefix: row.prefix });
  return { ...row, secret: raw, warning: 'Copie agora. Esta chave não será exibida novamente.' };
}

async function createWebhook(req, auth) {
  const body = await readJson(req);
  let url;
  try { url = new URL(body.url); } catch { throw new HttpError(400, 'invalid_url', 'Informe uma URL HTTPS válida.'); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new HttpError(400, 'https_required', 'O webhook deve usar HTTPS.');
  const secret = `whsec_${randomToken(32)}`;
  const row = await db('webhook_endpoints', { method: 'POST', single: true, body: { merchant_id: auth.merchantId, url: url.toString(), description: String(body.description || '').slice(0, 120) || null, secret_hash: sha256(secret), secret_encrypted: encryptSecret(secret), events: Array.isArray(body.events) && body.events.length ? body.events.slice(0, 20) : ['charge.updated', 'refund.updated'] } });
  return { ...row, secret, warning: 'Copie o segredo agora. Ele não será exibido novamente.' };
}

async function createWithdrawal(req, auth) {
  const body = await readJson(req);
  const amountCents = amountToCents(body.amount);
  const pixKey = cleanText(body.pix_key, 'Chave PIX', 3, 180);
  const feeCents = 0;
  const row = await rpc('request_withdrawal', { p_merchant_id: auth.merchantId, p_amount_cents: amountCents, p_fee_cents: feeCents, p_pix_key_type: String(body.pix_key_type || 'random').slice(0, 20), p_pix_key_masked: maskPixKey(pixKey), p_pix_key_encrypted: encryptSecret(pixKey) });
  await audit(req, auth, 'withdrawal.request', 'withdrawal', row.id, { amount_cents: amountCents });
  return row;
}

async function adminOverview() {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [merchants, charges, withdrawals] = await Promise.all([
    db('merchants?select=id,status,kyc_status,balance_available_cents,created_at&limit=1000'),
    db(`charges?created_at=gte.${since}&select=id,status,amount_cents,fee_cents,merchant_id,created_at&limit=5000`),
    db('withdrawals?status=in.(requested,in_review,approved,processing)&select=*&order=created_at.asc&limit=100'),
  ]);
  return { metrics: { merchants: merchants.length, active_merchants: merchants.filter(m => m.status === 'active').length, pending_kyc: merchants.filter(m => ['pending','in_review'].includes(m.kyc_status)).length, volume_cents: charges.filter(c => c.status === 'approved').reduce((s,c) => s + Number(c.amount_cents), 0), revenue_cents: charges.filter(c => c.status === 'approved').reduce((s,c) => s + Number(c.fee_cents), 0), pending_withdrawals: withdrawals.length }, withdrawals };
}

async function reviewWithdrawal(req, id, auth, action) {
  requireRole(auth, ['admin']);
  const body = await readJson(req);
  const withdrawal = await db(`withdrawals?id=eq.${uuid(id)}&select=*&limit=1`, { single: true });
  if (!withdrawal || !['requested', 'in_review', 'approved', 'processing'].includes(withdrawal.status)) throw new HttpError(409, 'withdrawal_not_reviewable', 'Este saque não pode mais ser revisado.');
  if (action === 'approve') {
    const updated = await db(`withdrawals?id=eq.${id}`, { method: 'PATCH', single: true, body: { status: cfg.provider === 'sandbox' ? 'paid' : 'approved', reviewed_by: auth.user.id, reviewed_at: new Date().toISOString(), ...(cfg.provider === 'sandbox' ? { paid_at: new Date().toISOString(), provider_transfer_id: `SBXTR-${randomToken(8)}` } : {}) } });
    await audit(req, auth, 'withdrawal.approve', 'withdrawal', id);
    return updated;
  }
  const reason = cleanText(body.reason, 'Motivo', 3, 200);
  const updated = await rpc('reject_withdrawal', { p_withdrawal_id: id, p_reviewer_id: auth.user.id, p_reason: reason });
  await audit(req, auth, 'withdrawal.reject', 'withdrawal', id, { reason });
  return updated;
}

async function handleMercadoPagoWebhook(req) {
  const body = await readJson(req);
  const q = queryOf(req);
  const dataId = q.get('data.id') || body.data?.id;
  const receiptId = String(body.id || `${body.type}:${dataId}:${req.headers['x-request-id'] || randomId()}`);
  if (!dataId || !verifyMercadoPagoSignature(req, dataId)) throw new HttpError(401, 'invalid_webhook_signature', 'Assinatura do webhook inválida.');
  const seen = await db(`provider_webhook_receipts?id=eq.${encodeURIComponent(receiptId)}&select=id,processed_at&limit=1`, { single: true });
  if (seen?.processed_at) return { received: true, duplicate: true };
  if (!seen) await db('provider_webhook_receipts', { method: 'POST', body: { id: receiptId, provider: 'mercadopago', event_type: body.type || body.action, payload: body } });
  const provider = await getProviderCharge(dataId);
  const charge = await db(`charges?provider_order_id=eq.${encodeURIComponent(dataId)}&select=*&limit=1`, { single: true });
  if (charge) {
    const oldStatus = charge.status;
    await db(`charges?id=eq.${charge.id}`, { method: 'PATCH', body: { status: provider.status, status_detail: provider.statusDetail, provider_payload: provider.raw, updated_at: new Date().toISOString() } });
    if (provider.status === 'approved') await rpc('settle_approved_charge', { p_charge_id: charge.id });
    if (provider.status !== oldStatus) await emitEvent(charge.merchant_id, 'charge.updated', 'charge', charge.id, { id: charge.id, status: provider.status, previous_status: oldStatus });
  }
  await db(`provider_webhook_receipts?id=eq.${encodeURIComponent(receiptId)}`, { method: 'PATCH', body: { processed_at: new Date().toISOString() } });
  return { received: true };
}

async function deliverWebhooks(req) {
  const auth = String(req.headers.authorization || '');
  if (!cfg.cronSecret || auth !== `Bearer ${cfg.cronSecret}`) throw new HttpError(401, 'invalid_cron_secret', 'Acesso negado.');
  const rows = await db(`webhook_deliveries?status=in.(pending,failed)&next_attempt_at=lte.${new Date().toISOString()}&select=*,webhook_endpoints(*),webhook_events(*)&order=created_at.asc&limit=50`);
  const results = [];
  for (const item of rows) {
    const endpoint = item.webhook_endpoints;
    const event = item.webhook_events;
    if (!endpoint?.active) continue;
    const body = JSON.stringify({ id: event.id, type: event.event_type, created_at: event.created_at, data: event.payload });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let status = 0, responseBody = '';
    try {
      const response = await fetch(endpoint.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'SpacePay-Webhooks/1.0', 'Spacepay-Event': event.event_type, 'Spacepay-Timestamp': timestamp, 'Spacepay-Signature': `t=${timestamp},v1=${signMerchantWebhook(decryptSecret(endpoint.secret_encrypted), timestamp, body)}` }, body, signal: AbortSignal.timeout(10000) });
      status = response.status;
      responseBody = (await response.text()).slice(0, 1000);
      if (response.ok) {
        await db(`webhook_deliveries?id=eq.${item.id}`, { method: 'PATCH', body: { status: 'delivered', attempts: item.attempts + 1, response_status: status, response_body: responseBody, delivered_at: new Date().toISOString() } });
        await db(`webhook_endpoints?id=eq.${endpoint.id}`, { method: 'PATCH', body: { failure_count: 0, last_delivery_at: new Date().toISOString() } });
        results.push({ id: item.id, delivered: true });
        continue;
      }
    } catch (error) { responseBody = String(error.message).slice(0, 1000); }
    const attempts = item.attempts + 1;
    const dead = attempts >= 8;
    await db(`webhook_deliveries?id=eq.${item.id}`, { method: 'PATCH', body: { status: dead ? 'dead' : 'failed', attempts, response_status: status || null, response_body: responseBody, next_attempt_at: new Date(Date.now() + Math.min(86400, 30 * 2 ** attempts) * 1000).toISOString() } });
    await db(`webhook_endpoints?id=eq.${endpoint.id}`, { method: 'PATCH', body: { failure_count: Number(endpoint.failure_count || 0) + 1 } });
    results.push({ id: item.id, delivered: false, dead });
  }
  return { processed: results.length, results };
}

export default async function handler(req, res) {
  const requestId = String(req.headers['x-request-id'] || randomId());
  res.setHeader('X-Request-Id', requestId);
  try {
    const route = routeOf(req);
    const method = req.method || 'GET';
    if (method === 'OPTIONS') return send(res, 204, {});
    checkOrigin(req);

    if (route === 'health' && method === 'GET') return send(res, 200, { status: 'ok', provider: cfg.provider, database_configured: Boolean(cfg.supabaseUrl && cfg.supabaseKey), timestamp: new Date().toISOString() });
    if (route === 'public/config' && method === 'GET') return send(res, 200, { app_name: 'Space Pay Gateway', provider: cfg.provider, mercado_pago_public_key: cfg.mpPublicKey || null, registration_open: cfg.openRegistration });
    let publicMatch = route.match(/^public\/payment-links\/([^/]+)$/);
    if (publicMatch && method === 'GET') return send(res, 200, { data: await getPublicPaymentLink(publicMatch[1]) });
    publicMatch = route.match(/^public\/payment-links\/([^/]+)\/checkout$/);
    if (publicMatch && method === 'POST') { const result = await checkoutPublicLink(req, publicMatch[1]); return send(res, result.status, result.body, result.replay ? { 'Idempotent-Replayed': 'true' } : {}); }
    if (route === 'auth/register' && method === 'POST') { const result = await handleRegister(req); return send(res, result.status, result.body, result.headers); }
    if (route === 'auth/login' && method === 'POST') { const result = await handleLogin(req); return send(res, result.status, result.body, result.headers); }
    if (route === 'auth/logout' && method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() });
    if (route === 'webhooks/mercado-pago' && method === 'POST') return send(res, 200, await handleMercadoPagoWebhook(req));
    if (route === 'internal/deliver-webhooks' && method === 'GET') return send(res, 200, await deliverWebhooks(req));

    const auth = await authenticate(req);
    if (route === 'auth/me' && method === 'GET') return send(res, 200, { user: { id: auth.user.id, name: auth.user.name, email: auth.user.email, role: auth.role }, merchant: auth.merchant });
    if (route === 'dashboard' && method === 'GET') return send(res, 200, await handleDashboard(auth));
    if (route === 'v1/charges' && method === 'GET') return send(res, 200, await listCharges(req, auth));
    if (route === 'v1/charges' && method === 'POST') { const scoped = auth.type === 'api_key' ? await authenticate(req, ['charges:write']) : auth; const result = await createCharge(req, scoped); return send(res, result.status, result.body, result.replay ? { 'Idempotent-Replayed': 'true' } : {}); }
    let match = route.match(/^v1\/charges\/([^/]+)$/);
    if (match && method === 'GET') return send(res, 200, { data: await getCharge(match[1], auth) });
    match = route.match(/^v1\/charges\/([^/]+)\/sync$/);
    if (match && method === 'POST') return send(res, 200, { data: await syncCharge(match[1], auth) });
    match = route.match(/^v1\/charges\/([^/]+)\/refund$/);
    if (match && method === 'POST') { const scoped = auth.type === 'api_key' ? await authenticate(req, ['refunds:write']) : auth; const result = await refundCharge(req, match[1], scoped); return send(res, result.status, result.body, result.replay ? { 'Idempotent-Replayed': 'true' } : {}); }

    if (route === 'v1/customers' && method === 'GET') return send(res, 200, await listSimple(req, auth, 'customers', 'id,external_id,name,email,phone,created_at'));
    if (route === 'v1/customers' && method === 'POST') return send(res, 201, { data: await createCustomer(req, auth) });
    if (route === 'v1/payment-links' && method === 'GET') return send(res, 200, await listSimple(req, auth, 'payment_links'));
    if (route === 'v1/payment-links' && method === 'POST') return send(res, 201, { data: await createPaymentLink(req, auth) });
    if (route === 'v1/refunds' && method === 'GET') return send(res, 200, await listSimple(req, auth, 'refunds'));
    if (route === 'v1/withdrawals' && method === 'GET') return send(res, 200, await listSimple(req, auth, 'withdrawals', 'id,amount_cents,fee_cents,pix_key_type,pix_key_masked,status,rejection_reason,created_at,paid_at'));
    if (route === 'v1/withdrawals' && method === 'POST') return send(res, 201, { data: await createWithdrawal(req, auth) });
    if (route === 'v1/api-keys' && method === 'GET') return send(res, 200, await listSimple(req, auth, 'api_keys', 'id,name,prefix,mode,scopes,last_used_at,expires_at,revoked_at,created_at'));
    if (route === 'v1/api-keys' && method === 'POST') return send(res, 201, { data: await createApiKey(req, auth) });
    match = route.match(/^v1\/api-keys\/([^/]+)\/revoke$/);
    if (match && method === 'POST') { const id = uuid(match[1]); await db(`api_keys?id=eq.${id}&merchant_id=eq.${auth.merchantId}`, { method: 'PATCH', body: { revoked_at: new Date().toISOString() } }); await audit(req, auth, 'api_key.revoke', 'api_key', id); return send(res, 200, { ok: true }); }
    if (route === 'v1/webhook-endpoints' && method === 'GET') return send(res, 200, await listSimple(req, auth, 'webhook_endpoints', 'id,url,description,events,active,failure_count,last_delivery_at,created_at'));
    if (route === 'v1/webhook-endpoints' && method === 'POST') return send(res, 201, { data: await createWebhook(req, auth) });

    if (route === 'admin/overview' && method === 'GET') { requireRole(auth, ['admin','support','analyst']); return send(res, 200, await adminOverview()); }
    if (route === 'admin/merchants' && method === 'GET') { requireRole(auth, ['admin','support','analyst']); return send(res, 200, { data: await db('merchants?select=*&order=created_at.desc&limit=500') }); }
    match = route.match(/^admin\/withdrawals\/([^/]+)\/(approve|reject)$/);
    if (match && method === 'POST') return send(res, 200, { data: await reviewWithdrawal(req, match[1], auth, match[2]) });
    match = route.match(/^sandbox\/charges\/([^/]+)\/approve$/);
    if (match && method === 'POST') {
      if (cfg.provider !== 'sandbox') throw new HttpError(404, 'not_found', 'Rota disponível apenas no sandbox.');
      const charge = await getCharge(match[1], auth);
      const updated = await rpc('settle_approved_charge', { p_charge_id: charge.id });
      await emitEvent(charge.merchant_id, 'charge.updated', 'charge', charge.id, { id: charge.id, status: 'approved', previous_status: charge.status });
      return send(res, 200, { data: publicCharge(updated) });
    }

    throw new HttpError(404, 'not_found', 'Rota não encontrada.');
  } catch (error) {
    const result = publicError(error, requestId);
    return send(res, result.status, result.body);
  }
}
