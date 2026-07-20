begin;

-- Existing public campaigns remain visible. Every campaign created after this
-- migration starts pending and must be approved by a POA administrator.
alter table public.campaigns
  add column if not exists review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected', 'refund_pending', 'refunded')),
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text;

update public.campaigns
set review_status = 'approved'
where status in ('upcoming', 'live', 'review', 'finalized')
  and review_status = 'pending';

create or replace function public.is_poa_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user is not null
    and exists (select 1 from public.admin_users where user_id = check_user);
$$;

revoke all on function public.is_poa_admin(uuid) from public;
grant execute on function public.is_poa_admin(uuid) to authenticated, service_role;

create table public.campaign_review_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null
    check (decision in ('approved', 'rejected', 'refund_requested', 'refund_approved', 'refunded')),
  reason_code text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.campaign_refunds (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  funding_id uuid references public.campaign_funding(id) on delete restrict,
  recipient_address text not null,
  asset_mint text,
  amount_raw numeric(78, 0) not null check (amount_raw > 0),
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'submitted', 'confirmed', 'failed', 'cancelled')),
  transaction_signature text unique,
  error_message text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per wallet/campaign provides current holdings and an auditable hold
-- start. The indexer must reset continuous_hold_started_at when eligibility is
-- broken; the browser never calculates this value from a client clock.
create table public.campaign_holder_positions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  token_mint text not null,
  balance_raw numeric(78, 0) not null default 0 check (balance_raw >= 0),
  first_observed_balance_at timestamptz,
  continuous_hold_started_at timestamptz,
  last_verified_at timestamptz not null,
  source_slot bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, wallet_id, token_mint)
);

-- A trusted market indexer writes snapshots. The UI shows an unavailable state
-- until at least one real row exists; it never substitutes mock volume.
create table public.campaign_market_snapshots (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  token_mint text not null,
  price_usd numeric(30, 12),
  volume_24h_usd numeric(30, 6) check (volume_24h_usd is null or volume_24h_usd >= 0),
  liquidity_usd numeric(30, 6) check (liquidity_usd is null or liquidity_usd >= 0),
  market_cap_usd numeric(30, 6) check (market_cap_usd is null or market_cap_usd >= 0),
  source text not null,
  captured_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  unique (campaign_id, source, captured_at)
);

-- Confirmed fee receipts are the accounting input. No browser or cron should
-- infer spendable funds directly from a displayed treasury balance.
create table public.protocol_fee_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  payer_address text not null,
  recipient_address text not null,
  lamports numeric(78, 0) not null check (lamports > 0),
  transaction_signature text not null unique,
  slot bigint not null,
  confirmed_at timestamptz not null,
  allocated_at timestamptz,
  created_at timestamptz not null default now()
);

-- This is an execution ledger, not a custody mechanism. Signer material must
-- remain in the server-side secret manager and is never stored in Postgres.
create table public.buyback_epochs (
  id uuid primary key default gen_random_uuid(),
  epoch_started_at timestamptz not null,
  epoch_ended_at timestamptz not null,
  interval_seconds integer not null default 300 check (interval_seconds >= 60),
  allocation_bps integer not null default 5000 check (allocation_bps between 1 and 10000),
  treasury_balance_lamports numeric(78, 0) check (treasury_balance_lamports is null or treasury_balance_lamports >= 0),
  reserve_lamports numeric(78, 0) not null default 0 check (reserve_lamports >= 0),
  eligible_lamports numeric(78, 0) check (eligible_lamports is null or eligible_lamports >= 0),
  target_input_lamports numeric(78, 0) check (target_input_lamports is null or target_input_lamports >= 0),
  input_lamports numeric(78, 0) check (input_lamports is null or input_lamports >= 0),
  output_mint text not null,
  output_amount_raw numeric(78, 0) check (output_amount_raw is null or output_amount_raw >= 0),
  output_decimals smallint check (output_decimals is null or output_decimals between 0 and 18),
  min_output_amount_raw numeric(78, 0) check (min_output_amount_raw is null or min_output_amount_raw >= 0),
  swap_provider text,
  quote_id text,
  status text not null default 'pending'
    check (status in ('pending', 'quoted', 'submitted', 'confirmed', 'failed', 'skipped')),
  transaction_signature text unique,
  error_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (epoch_started_at),
  check (epoch_ended_at > epoch_started_at)
);

create index campaign_review_events_campaign_idx
  on public.campaign_review_events (campaign_id, created_at desc);
create index campaign_refunds_campaign_status_idx
  on public.campaign_refunds (campaign_id, status);
create index campaign_holder_positions_user_campaign_idx
  on public.campaign_holder_positions (user_id, campaign_id);
create index campaign_market_snapshots_campaign_captured_idx
  on public.campaign_market_snapshots (campaign_id, captured_at desc);
create index protocol_fee_receipts_allocation_idx
  on public.protocol_fee_receipts (allocated_at, confirmed_at);
create index buyback_epochs_status_started_idx
  on public.buyback_epochs (status, epoch_started_at desc);

create trigger campaign_refunds_set_updated_at
before update on public.campaign_refunds
for each row execute function public.set_updated_at();

create trigger campaign_holder_positions_set_updated_at
before update on public.campaign_holder_positions
for each row execute function public.set_updated_at();

create trigger buyback_epochs_set_updated_at
before update on public.buyback_epochs
for each row execute function public.set_updated_at();

create or replace function public.protect_campaign_review_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    old.review_status is distinct from new.review_status
    or old.reviewed_by is distinct from new.reviewed_by
    or old.reviewed_at is distinct from new.reviewed_at
    or old.review_notes is distinct from new.review_notes
  ) and coalesce(auth.role(), '') <> 'service_role'
    and not public.is_poa_admin(auth.uid()) then
    raise exception 'Only a POA administrator may change campaign review fields';
  end if;
  return new;
end;
$$;

create trigger campaigns_protect_review_fields
before update on public.campaigns
for each row execute function public.protect_campaign_review_fields();

alter table public.campaign_review_events enable row level security;
alter table public.campaign_refunds enable row level security;
alter table public.campaign_holder_positions enable row level security;
alter table public.campaign_market_snapshots enable row level security;
alter table public.protocol_fee_receipts enable row level security;
alter table public.buyback_epochs enable row level security;

drop policy if exists campaigns_public_or_owner_read on public.campaigns;
create policy campaigns_public_or_owner_read
on public.campaigns for select
to anon, authenticated
using (
  (review_status = 'approved' and status in ('upcoming', 'live', 'review', 'finalized'))
  or (auth.uid() is not null and auth.uid() = creator_id)
  or public.is_poa_admin(auth.uid())
);

create policy campaign_review_events_owner_or_admin_read
on public.campaign_review_events for select
to authenticated
using (
  public.is_poa_admin(auth.uid())
  or exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid()
  )
);

create policy campaign_review_events_admin_write
on public.campaign_review_events for insert
to authenticated
with check (public.is_poa_admin(auth.uid()) and reviewer_id = auth.uid());

create policy campaign_refunds_owner_or_admin_read
on public.campaign_refunds for select
to authenticated
using (
  public.is_poa_admin(auth.uid())
  or exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid()
  )
);

create policy campaign_refunds_admin_write
on public.campaign_refunds for all
to authenticated
using (public.is_poa_admin(auth.uid()))
with check (public.is_poa_admin(auth.uid()));

create policy campaign_holder_positions_participant_or_owner_read
on public.campaign_holder_positions for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid()
  )
  or public.is_poa_admin(auth.uid())
);

create policy campaign_market_snapshots_public_read
on public.campaign_market_snapshots for select
to anon, authenticated
using (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id
      and c.review_status = 'approved'
      and c.status in ('upcoming', 'live', 'review', 'finalized')
  )
);

create policy buyback_epochs_public_confirmed_read
on public.buyback_epochs for select
to anon, authenticated
using (status = 'confirmed');

grant select on table public.campaign_market_snapshots, public.buyback_epochs to anon, authenticated;
grant select on table
  public.campaign_review_events,
  public.campaign_refunds,
  public.campaign_holder_positions
to authenticated;

grant insert on table public.campaign_review_events to authenticated;
grant insert, update, delete on table public.campaign_refunds to authenticated;

grant all on table
  public.campaign_review_events,
  public.campaign_refunds,
  public.campaign_holder_positions,
  public.campaign_market_snapshots,
  public.protocol_fee_receipts,
  public.buyback_epochs
to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on table public.protocol_fee_receipts from anon, authenticated;

commit;
