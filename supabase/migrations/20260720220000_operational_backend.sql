begin;

alter table public.x_accounts
  add column if not exists smart_follower_score numeric(8, 6)
    check (smart_follower_score is null or smart_follower_score between 0 and 1),
  add column if not exists eligibility_status text not null default 'pending'
    check (eligibility_status in ('pending', 'eligible', 'ineligible', 'error')),
  add column if not exists eligibility_reason text;

alter table public.wallets
  add column if not exists eligibility_status text not null default 'pending'
    check (eligibility_status in ('pending', 'eligible', 'ineligible', 'error')),
  add column if not exists eligibility_reason text;

alter table public.campaign_holder_positions
  add column if not exists eligible_since timestamptz,
  add column if not exists sold_during_campaign boolean not null default false,
  add column if not exists last_outflow_at timestamptz,
  add column if not exists balance_decrease_count integer not null default 0
    check (balance_decrease_count >= 0);

create table public.wallet_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_address text not null,
  nonce_hash text not null unique,
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.x_follower_quality_snapshots (
  id bigint generated always as identity primary key,
  x_account_id uuid not null references public.x_accounts(id) on delete cascade,
  sampled_followers integer not null default 0 check (sampled_followers >= 0),
  quality_followers integer not null default 0 check (quality_followers >= 0),
  smart_follower_score numeric(8, 6) not null check (smart_follower_score between 0 and 1),
  components jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

create table public.reward_epochs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  epoch_started_at timestamptz not null,
  epoch_ended_at timestamptz not null,
  token_mint text not null,
  token_decimals smallint not null check (token_decimals between 0 and 18),
  budget_raw numeric(78, 0) not null check (budget_raw > 0),
  minimum_balance_raw numeric(78, 0) not null check (minimum_balance_raw >= 0),
  eligible_creators integer not null default 0 check (eligible_creators >= 0),
  total_score numeric(38, 8) not null default 0 check (total_score >= 0),
  status text not null default 'processing'
    check (status in ('processing', 'dry_run', 'submitted', 'confirmed', 'partial', 'failed', 'skipped')),
  mode text not null check (mode in ('dry_run', 'live')),
  transaction_count integer not null default 0 check (transaction_count >= 0),
  distributed_raw numeric(78, 0) not null default 0 check (distributed_raw >= 0),
  error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, epoch_started_at),
  check (epoch_ended_at > epoch_started_at)
);

create table public.reward_epoch_payouts (
  id uuid primary key default gen_random_uuid(),
  epoch_id uuid not null references public.reward_epochs(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  submission_id uuid not null references public.submissions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  rank integer not null check (rank > 0),
  score numeric(38, 8) not null check (score >= 0),
  amount_raw numeric(78, 0) not null check (amount_raw > 0),
  token_mint text not null,
  wallet_address text not null,
  status text not null default 'queued'
    check (status in ('queued', 'dry_run', 'signed', 'submitted', 'confirmed', 'failed')),
  transaction_signature text,
  error_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (epoch_id, user_id),
  unique (epoch_id, submission_id)
);

create table public.campaign_applications (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete restrict,
  slug text not null,
  name text not null,
  ticker text not null,
  token_mint text not null,
  brief text not null,
  required_terms text[] not null default '{}',
  reward_kind text not null check (reward_kind in ('SOL', 'SPL')),
  reward_mint text,
  reward_amount_raw numeric(78, 0) not null check (reward_amount_raw > 0),
  reward_decimals smallint not null check (reward_decimals between 0 and 18),
  duration_hours smallint not null check (duration_hours in (24, 48, 72)),
  submission_limit smallint not null default 1 check (submission_limit between 1 and 10),
  winner_count smallint not null check (winner_count between 1 and 1000),
  holder_bonus_max_bps integer not null default 2000 check (holder_bonus_max_bps between 0 and 10000),
  holder_min_balance_raw numeric(78, 0) not null default 0 check (holder_min_balance_raw >= 0),
  collection_address text not null,
  funding_transaction_signature text unique,
  funding_status text not null default 'awaiting_payment'
    check (funding_status in ('awaiting_payment', 'submitted', 'confirmed', 'rejected', 'refunded')),
  funding_confirmed_at timestamptz,
  funding_received_raw numeric(78, 0) check (funding_received_raw is null or funding_received_raw > 0),
  funding_error text,
  public_status text not null default 'pending'
    check (public_status in ('pending', 'accepted', 'denied', 'refund_pending', 'refunded')),
  review_notes text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  published_campaign_id uuid references public.campaigns(id) on delete set null,
  refund_transaction_signature text unique,
  refund_submitted_at timestamptz,
  refunded_at timestamptz,
  refund_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_application_reward_mint check (
    (reward_kind = 'SOL' and reward_mint is null)
    or (reward_kind = 'SPL' and reward_mint is not null)
  )
);

create index wallet_verification_challenges_user_idx
  on public.wallet_verification_challenges (user_id, created_at desc);
create index x_follower_quality_snapshots_account_idx
  on public.x_follower_quality_snapshots (x_account_id, captured_at desc);
create index reward_epochs_campaign_started_idx
  on public.reward_epochs (campaign_id, epoch_started_at desc);
create index reward_epoch_payouts_user_idx
  on public.reward_epoch_payouts (user_id, created_at desc);
create index reward_epoch_payouts_status_idx
  on public.reward_epoch_payouts (status, created_at);
create index campaign_applications_status_idx
  on public.campaign_applications (public_status, created_at desc);
create unique index campaign_applications_active_slug_key
  on public.campaign_applications (slug)
  where public_status in ('pending', 'accepted');

create trigger reward_epochs_set_updated_at
before update on public.reward_epochs
for each row execute function public.set_updated_at();

create trigger reward_epoch_payouts_set_updated_at
before update on public.reward_epoch_payouts
for each row execute function public.set_updated_at();

create trigger campaign_applications_set_updated_at
before update on public.campaign_applications
for each row execute function public.set_updated_at();

alter table public.wallet_verification_challenges enable row level security;
alter table public.x_follower_quality_snapshots enable row level security;
alter table public.reward_epochs enable row level security;
alter table public.reward_epoch_payouts enable row level security;
alter table public.campaign_applications enable row level security;

create policy x_follower_quality_public_read
on public.x_follower_quality_snapshots for select
to anon, authenticated
using (true);

create policy reward_epochs_public_read
on public.reward_epochs for select
to anon, authenticated
using (status in ('dry_run', 'submitted', 'confirmed', 'partial', 'skipped'));

create policy reward_epoch_payouts_public_read
on public.reward_epoch_payouts for select
to anon, authenticated
using (status in ('confirmed', 'dry_run'));

create policy campaign_applications_public_read
on public.campaign_applications for select
to anon, authenticated
using (true);

grant select on table
  public.x_follower_quality_snapshots,
  public.reward_epochs,
  public.reward_epoch_payouts
to anon, authenticated;

grant select (
  id, slug, name, ticker, token_mint, brief, reward_kind, reward_mint,
  reward_amount_raw, reward_decimals, duration_hours, winner_count,
  submission_limit, funding_status, public_status, created_at, updated_at
) on public.campaign_applications to anon, authenticated;

grant all on table
  public.wallet_verification_challenges,
  public.x_follower_quality_snapshots,
  public.reward_epochs,
  public.reward_epoch_payouts,
  public.campaign_applications
to service_role;

grant usage, select on all sequences in schema public to service_role;
revoke all on table public.wallet_verification_challenges from anon, authenticated;

commit;
