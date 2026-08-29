-- Space Pay Gateway — esquema PostgreSQL/Supabase
-- Rode este arquivo uma vez no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create type public.user_role as enum ('merchant', 'admin', 'support', 'analyst');
create type public.kyc_status as enum ('pending', 'in_review', 'approved', 'rejected');
create type public.charge_status as enum ('created', 'pending', 'action_required', 'approved', 'rejected', 'cancelled', 'refunded', 'partially_refunded', 'failed', 'expired');
create type public.refund_status as enum ('pending', 'approved', 'rejected', 'failed');
create type public.withdrawal_status as enum ('requested', 'in_review', 'approved', 'processing', 'paid', 'rejected', 'cancelled');

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,48}$'),
  document text,
  email text not null,
  phone text,
  status text not null default 'active' check (status in ('active','suspended','blocked')),
  kyc_status public.kyc_status not null default 'pending',
  fee_bps integer not null default 199 check (fee_bps between 0 and 10000),
  fixed_fee_cents bigint not null default 49 check (fixed_fee_cents >= 0),
  reserve_bps integer not null default 0 check (reserve_bps between 0 and 10000),
  balance_available_cents bigint not null default 0,
  balance_pending_cents bigint not null default 0,
  balance_reserved_cents bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchants(id) on delete cascade,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role public.user_role not null default 'merchant',
  active boolean not null default true,
  failed_login_count integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  mode text not null default 'test' check (mode in ('test','live')),
  scopes text[] not null default array['charges:read','charges:write'],
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  external_id text,
  name text not null,
  email text,
  phone text,
  document text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, external_id)
);

create table public.payment_links (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text,
  amount_cents bigint,
  currency text not null default 'BRL',
  active boolean not null default true,
  expires_at timestamptz,
  redirect_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.charges (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  payment_link_id uuid references public.payment_links(id) on delete set null,
  external_reference text,
  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  method text not null check (method in ('pix','card','boleto')),
  status public.charge_status not null default 'created',
  status_detail text,
  amount_cents bigint not null check (amount_cents > 0),
  fee_cents bigint not null default 0,
  net_amount_cents bigint not null default 0,
  refunded_amount_cents bigint not null default 0,
  currency text not null default 'BRL',
  payer_name text,
  payer_email text,
  payer_document text,
  description text,
  pix_copy_paste text,
  pix_qr_base64 text,
  ticket_url text,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_flags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, external_reference)
);

create index charges_merchant_created_idx on public.charges (merchant_id, created_at desc);
create index charges_provider_order_idx on public.charges (provider, provider_order_id);
create index charges_status_idx on public.charges (status, created_at desc);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  charge_id uuid not null references public.charges(id) on delete restrict,
  provider_refund_id text,
  amount_cents bigint not null check (amount_cents > 0),
  reason text,
  status public.refund_status not null default 'pending',
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  fee_cents bigint not null default 0,
  pix_key_type text not null,
  pix_key_masked text not null,
  pix_key_encrypted text not null,
  status public.withdrawal_status not null default 'requested',
  rejection_reason text,
  provider_transfer_id text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  url text not null,
  description text,
  secret_hash text not null,
  secret_encrypted text not null,
  events text[] not null default array['charge.updated'],
  active boolean not null default true,
  failure_count integer not null default 0,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  event_type text not null,
  object_type text not null,
  object_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id uuid not null references public.webhook_events(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','delivered','failed','dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  response_status integer,
  response_body text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (endpoint_id, event_id)
);

create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  idempotency_key text not null,
  route text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz not null default (now() + interval '30 seconds'),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  unique (merchant_id, route, idempotency_key)
);

create table public.provider_webhook_receipts (
  id text primary key,
  provider text not null,
  event_type text,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchants(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  ip_hash text,
  user_agent text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.risk_rules (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references public.merchants(id) on delete cascade,
  name text not null,
  rule_type text not null check (rule_type in ('max_amount','email_domain','document_blocklist','velocity','manual_review')),
  config jsonb not null,
  action text not null check (action in ('flag','review','block')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text primary key,
  count integer not null default 1,
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create or replace function public.register_merchant(
  p_name text,
  p_business_name text,
  p_slug text,
  p_email text,
  p_password_hash text,
  p_role public.user_role,
  p_fee_bps integer,
  p_fixed_fee_cents bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.merchants;
  u public.users;
begin
  insert into public.merchants (name, slug, email, fee_bps, fixed_fee_cents)
    values (p_business_name, p_slug, lower(p_email), p_fee_bps, p_fixed_fee_cents)
    returning * into m;
  insert into public.users (merchant_id, name, email, password_hash, role)
    values (m.id, p_name, lower(p_email), p_password_hash, p_role)
    returning * into u;
  return jsonb_build_object('merchant_id', m.id, 'user_id', u.id);
end $$;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.rate_limits;
begin
  insert into public.rate_limits as rl (key, count, window_started_at, expires_at)
    values (p_key, 1, now(), now() + make_interval(secs => p_window_seconds))
    on conflict (key) do update set
      count = case when rl.expires_at <= now() then 1 else rl.count + 1 end,
      window_started_at = case when rl.expires_at <= now() then now() else rl.window_started_at end,
      expires_at = case when rl.expires_at <= now() then now() + make_interval(secs => p_window_seconds) else rl.expires_at end
    returning * into r;
  return jsonb_build_object('allowed', r.count <= p_limit, 'remaining', greatest(0, p_limit - r.count), 'reset_at', r.expires_at);
end $$;

-- Débito de saldo atômico para solicitação de saque.
create or replace function public.request_withdrawal(
  p_merchant_id uuid,
  p_amount_cents bigint,
  p_fee_cents bigint,
  p_pix_key_type text,
  p_pix_key_masked text,
  p_pix_key_encrypted text
) returns public.withdrawals
language plpgsql security definer set search_path = public as $$
declare
  m public.merchants;
  w public.withdrawals;
begin
  select * into m from public.merchants where id = p_merchant_id for update;
  if m.id is null then raise exception 'merchant_not_found'; end if;
  if m.balance_available_cents < p_amount_cents + p_fee_cents then raise exception 'insufficient_balance'; end if;
  update public.merchants
    set balance_available_cents = balance_available_cents - p_amount_cents - p_fee_cents,
        balance_reserved_cents = balance_reserved_cents + p_amount_cents + p_fee_cents,
        updated_at = now()
    where id = p_merchant_id;
  insert into public.withdrawals (merchant_id, amount_cents, fee_cents, pix_key_type, pix_key_masked, pix_key_encrypted)
    values (p_merchant_id, p_amount_cents, p_fee_cents, p_pix_key_type, p_pix_key_masked, p_pix_key_encrypted)
    returning * into w;
  return w;
end $$;

-- Liquidação idempotente de uma cobrança aprovada.
create or replace function public.settle_approved_charge(p_charge_id uuid)
returns public.charges
language plpgsql security definer set search_path = public as $$
declare
  c public.charges;
  reserve bigint;
begin
  select * into c from public.charges where id = p_charge_id for update;
  if c.id is null then raise exception 'charge_not_found'; end if;
  if c.approved_at is not null then return c; end if;
  reserve := greatest(0, (c.net_amount_cents * (select reserve_bps from public.merchants where id = c.merchant_id)) / 10000);
  update public.charges set status = 'approved', approved_at = now(), updated_at = now() where id = c.id returning * into c;
  update public.merchants
    set balance_available_cents = balance_available_cents + c.net_amount_cents - reserve,
        balance_reserved_cents = balance_reserved_cents + reserve,
        updated_at = now()
    where id = c.merchant_id;
  return c;
end $$;

create or replace function public.apply_approved_refund(p_refund_id uuid)
returns public.refunds
language plpgsql security definer set search_path = public as $$
declare
  r public.refunds;
  c public.charges;
  next_refunded bigint;
begin
  select * into r from public.refunds where id = p_refund_id for update;
  if r.id is null then raise exception 'refund_not_found'; end if;
  select * into c from public.charges where id = r.charge_id for update;
  if r.status = 'approved' and c.refunded_amount_cents >= r.amount_cents then return r; end if;
  next_refunded := least(c.amount_cents, c.refunded_amount_cents + r.amount_cents);
  update public.refunds set status = 'approved', updated_at = now() where id = r.id returning * into r;
  update public.charges set
    refunded_amount_cents = next_refunded,
    status = case when next_refunded >= amount_cents then 'refunded'::public.charge_status else 'partially_refunded'::public.charge_status end,
    updated_at = now()
    where id = c.id;
  update public.merchants set
    balance_available_cents = balance_available_cents - least(balance_available_cents, r.amount_cents),
    updated_at = now()
    where id = r.merchant_id;
  return r;
end $$;

create or replace function public.reject_withdrawal(
  p_withdrawal_id uuid,
  p_reviewer_id uuid,
  p_reason text
) returns public.withdrawals
language plpgsql security definer set search_path = public as $$
declare
  w public.withdrawals;
begin
  select * into w from public.withdrawals where id = p_withdrawal_id for update;
  if w.id is null then raise exception 'withdrawal_not_found'; end if;
  if w.status not in ('requested','in_review','approved','processing') then raise exception 'withdrawal_not_reviewable'; end if;
  update public.withdrawals set status = 'rejected', rejection_reason = p_reason, reviewed_by = p_reviewer_id, reviewed_at = now(), updated_at = now() where id = w.id returning * into w;
  update public.merchants set
    balance_reserved_cents = greatest(0, balance_reserved_cents - w.amount_cents - w.fee_cents),
    balance_available_cents = balance_available_cents + w.amount_cents + w.fee_cents,
    updated_at = now()
    where id = w.merchant_id;
  return w;
end $$;

alter table public.users enable row level security;
alter table public.merchants enable row level security;
alter table public.api_keys enable row level security;
alter table public.customers enable row level security;
alter table public.charges enable row level security;
alter table public.refunds enable row level security;
alter table public.withdrawals enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.audit_logs enable row level security;

-- A API usa exclusivamente a service role no servidor. Nenhuma tabela é pública.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
