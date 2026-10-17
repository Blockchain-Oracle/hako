-- Hako's own tables (plan §5b @hako/db): receipts, invoices, contacts, drafts and PayBox links.
-- Atomic amounts are numeric(78,0): any uint256 fits, and pg returns numeric as an exact decimal string.
-- Chains are CAIP-2 strings (eip155:8453, solana:mainnet). Every user reference is Better Auth's "user"(id)
-- (0001_better_auth.sql), the Hako account key (detail/12-wave0-results.md SP10).

-- Invoices first: receipts reference them.
create table if not exists invoices (
  id text primary key,
  pay_to text not null,
  chain text not null,
  asset text not null,
  amount_atomic numeric(78, 0) not null check (amount_atomic > 0),
  note text,
  status text not null default 'open' check (status in ('open', 'settling', 'paid')),
  tx_hash text,
  payer text,
  -- Null when an agent created it through the plugin (no Hako account): /pay/<id> then says "Created by an agent".
  created_by text references "user" (id) on delete set null,
  created_via text not null check (created_via in ('web', 'voice', 'mcp', 'cli', 'plugin', 'gateway')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'paid' or tx_hash is not null)
);
create index if not exists invoices_pay_to_idx on invoices (lower(pay_to), created_at desc);
create index if not exists invoices_created_by_idx on invoices (created_by, created_at desc);

create table if not exists receipts (
  id text primary key,
  kind text not null check (kind in ('x402_settlement', 'lifi_move', 'paybox_transfer')),
  status text not null check (status in ('pending', 'confirmed', 'failed')),
  surface text not null check (surface in ('web', 'voice', 'mcp', 'cli', 'plugin', 'gateway')),
  -- Null for x402 payments from hosts Hako has no session for (plugin runs in Claude, core use_service).
  user_id text references "user" (id) on delete set null,
  chain text not null,
  asset text not null,
  amount_atomic numeric(78, 0) not null check (amount_atomic >= 0),
  payer text,
  pay_to text,
  tx_hash text,
  -- LI.FI moves: what arrived where, and the destination transaction.
  to_chain text,
  to_asset text,
  to_amount_atomic numeric(78, 0) check (to_amount_atomic >= 0),
  dest_tx_hash text,
  lifi_tool text,
  -- What was paid for: a catalog tool (`<provider>/<slug>`), a batch, an invoice.
  tool_id text,
  batch_id text,
  invoice_id text references invoices (id) on delete set null,
  -- The PayBox request and the client that minted it (only that client can read it back).
  paybox_request_id text,
  paybox_client_id text,
  draft_id text,
  draft_version integer check (draft_version >= 1),
  fee_usd numeric(20, 6),
  -- Shared receipts (/r/<id>, the landing proof) are opt-in.
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One receipt per settlement transaction and per PayBox request: recording twice is a no-op.
create unique index if not exists receipts_tx_uidx on receipts (kind, chain, tx_hash) where tx_hash is not null;
create unique index if not exists receipts_request_uidx on receipts (paybox_request_id) where paybox_request_id is not null;
create index if not exists receipts_user_idx on receipts (user_id, created_at desc, id desc);
create index if not exists receipts_payer_idx on receipts (lower(payer), created_at desc);
create index if not exists receipts_pay_to_idx on receipts (lower(pay_to), created_at desc);
create index if not exists receipts_public_idx on receipts (created_at desc) where is_public;

create table if not exists contacts (
  id text primary key,
  owner_user_id text not null references "user" (id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  -- A saved address (with its chain family), a PayBox username (resolved with resolve_username), or both.
  address text,
  family text check (family in ('evm', 'solana')),
  paybox_username text,
  verified boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (address is not null or paybox_username is not null),
  check ((address is null) = (family is null))
);
create unique index if not exists contacts_owner_label_uidx on contacts (owner_user_id, lower(label));

-- One row per draft version: a card edit makes a new version, and each version is executed at most once
-- (plan §1 "One PayBox request per draft version"). The primary key is the unique (draft_id, version) row the
-- money intents claim before they create the PayBox request.
create table if not exists drafts (
  draft_id text not null,
  version integer not null check (version >= 1),
  kind text not null check (kind in ('send', 'swap', 'bridge', 'earn_deposit', 'earn_withdraw', 'run', 'invoice_pay')),
  state text not null check (state in (
    'submitted', 'working', 'input_required', 'auth_required', 'ready_for_approval', 'approved', 'executing',
    'completed', 'failed', 'rejected', 'canceled', 'expired', 'unknown_outcome'
  )),
  input jsonb not null,
  quote jsonb,
  rehearsal jsonb,
  surface text check (surface in ('web', 'voice', 'mcp', 'cli', 'plugin', 'gateway')),
  -- Set when the version is claimed for execution (drafts themselves can be anonymous, plan §1 MCP cards row).
  user_id text references "user" (id) on delete set null,
  request_kind text check (request_kind in ('transfer', 'wallet_sign', 'use_service')),
  paybox_request_id text,
  client_id text,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, version),
  check ((executed_at is null) = (request_kind is null)),
  check (paybox_request_id is null or executed_at is not null)
);
create unique index if not exists drafts_request_uidx on drafts (paybox_request_id) where paybox_request_id is not null;
create index if not exists drafts_user_idx on drafts (user_id, executed_at desc) where executed_at is not null;

-- Connect PayBox (plan §1 execution rules): one public PayBox client per Hako user, its tokens encrypted with
-- AES-256-GCM (HAKO_TOKEN_ENCRYPTION_KEY) by @hako/paybox. A revoked link stays as history; at most one is active.
create table if not exists paybox_links (
  id text primary key,
  user_id text not null references "user" (id) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  -- PayBox's subject: an attribute, never the key (SP10 decides whether it is stable across clients).
  sub text,
  scope text,
  access_token_enc text,
  refresh_token_enc text,
  access_expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((access_token_enc is null) = (access_expires_at is null))
);
create unique index if not exists paybox_links_active_uidx on paybox_links (user_id) where revoked_at is null;
create index if not exists paybox_links_sub_idx on paybox_links (sub) where sub is not null;
create index if not exists paybox_links_client_idx on paybox_links (client_id);
