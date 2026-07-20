-- POA / Proof of Attention — initial production schema
-- Run once in Supabase SQL Editor, or apply with `supabase db push`.

begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.x_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  x_user_id text not null unique,
  username text not null,
  display_name text,
  profile_image_url text,
  followers_count bigint not null default 0 check (followers_count >= 0),
  following_count bigint not null default 0 check (following_count >= 0),
  account_created_at timestamptz not null,
  verified_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index x_accounts_username_lower_key
  on public.x_accounts (lower(username));

-- Provider tokens must be encrypted by the server before insertion.
-- RLS is enabled below with no client policy, so only service_role can access it.
create table public.x_oauth_credentials (
  x_account_id uuid primary key references public.x_accounts(id) on delete cascade,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_type text not null default 'bearer',
  scope text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  address text not null unique,
  chain text not null default 'solana' check (chain = 'solana'),
  first_transaction_at timestamptz,
  verified_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete restrict,
  slug text not null unique,
  name text not null,
  ticker text not null,
  token_mint text not null,
  brief text not null,
  required_terms text[] not null default '{}',
  rules jsonb not null default '{}'::jsonb,
  reward_kind text not null check (reward_kind in ('SOL', 'SPL')),
  reward_mint text,
  reward_amount_raw numeric(78, 0) not null check (reward_amount_raw > 0),
  reward_decimals smallint not null default 9 check (reward_decimals between 0 and 18),
  duration_hours smallint not null check (duration_hours in (24, 48, 72)),
  submission_limit smallint not null default 1 check (submission_limit between 1 and 10),
  winner_count smallint not null default 10 check (winner_count between 1 and 1000),
  holder_bonus_max_bps integer not null default 2000 check (holder_bonus_max_bps between 0 and 10000),
  holder_min_balance_raw numeric(78, 0) not null default 0 check (holder_min_balance_raw >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'funding', 'upcoming', 'live', 'review', 'finalized', 'cancelled')),
  treasury_address text,
  starts_at timestamptz,
  ends_at timestamptz,
  funded_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_mint_matches_kind check (
    (reward_kind = 'SOL' and reward_mint is null)
    or (reward_kind = 'SPL' and reward_mint is not null)
  ),
  constraint campaign_time_order check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create table public.campaign_funding (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  funder_address text not null,
  asset_mint text,
  amount_raw numeric(78, 0) not null check (amount_raw > 0),
  transaction_signature text not null unique,
  slot bigint,
  status text not null default 'observed'
    check (status in ('observed', 'confirmed', 'rejected')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.campaign_payout_tiers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  rank_start integer not null check (rank_start > 0),
  rank_end integer not null check (rank_end >= rank_start),
  allocation_bps integer not null check (allocation_bps between 1 and 10000),
  created_at timestamptz not null default now(),
  unique (campaign_id, rank_start, rank_end)
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  x_account_id uuid not null references public.x_accounts(id) on delete restrict,
  x_post_id text not null,
  x_post_url text not null,
  post_created_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  tracking_started_at timestamptz,
  status text not null default 'tracking'
    check (status in ('tracking', 'flagged', 'approved', 'disqualified', 'winner')),
  disqualification_reason text,
  final_rank integer check (final_rank is null or final_rank > 0),
  final_attention_score numeric(30, 6),
  final_holder_multiplier numeric(8, 4)
    check (final_holder_multiplier is null or final_holder_multiplier between 1 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, x_post_id)
);

create table public.x_metric_snapshots (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  captured_at timestamptz not null default now(),
  impression_count bigint not null default 0 check (impression_count >= 0),
  organic_impression_count bigint check (organic_impression_count is null or organic_impression_count >= 0),
  like_count bigint not null default 0 check (like_count >= 0),
  repost_count bigint not null default 0 check (repost_count >= 0),
  reply_count bigint not null default 0 check (reply_count >= 0),
  quote_count bigint not null default 0 check (quote_count >= 0),
  bookmark_count bigint not null default 0 check (bookmark_count >= 0),
  fetch_status text not null default 'ok' check (fetch_status in ('ok', 'missing', 'private', 'error')),
  raw_metrics jsonb not null default '{}'::jsonb,
  unique (submission_id, captured_at)
);

create table public.holder_snapshots (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  token_mint text not null,
  balance_raw numeric(78, 0) not null check (balance_raw >= 0),
  source_slot bigint,
  captured_at timestamptz not null default now(),
  unique (submission_id, captured_at)
);

create table public.score_snapshots (
  id bigint generated always as identity primary key,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  captured_at timestamptz not null default now(),
  base_attention_score numeric(30, 6) not null default 0,
  engagement_quality_multiplier numeric(8, 4) not null default 1
    check (engagement_quality_multiplier between 0 and 2),
  holder_multiplier numeric(8, 4) not null default 1
    check (holder_multiplier between 1 and 2),
  total_score numeric(30, 6) not null default 0,
  formula_version text not null default 'v1',
  components jsonb not null default '{}'::jsonb,
  unique (submission_id, captured_at)
);

create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check (decision in ('approved', 'disqualified', 'needs_review')),
  reason_code text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  submission_id uuid not null unique references public.submissions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  wallet_id uuid not null references public.wallets(id) on delete restrict,
  rank integer not null check (rank > 0),
  asset_mint text,
  amount_raw numeric(78, 0) not null check (amount_raw > 0),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'submitted', 'confirmed', 'failed', 'cancelled')),
  transaction_signature text unique,
  error_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index campaigns_status_ends_at_idx on public.campaigns (status, ends_at);
create index campaigns_creator_id_idx on public.campaigns (creator_id);
create index campaign_funding_campaign_id_idx on public.campaign_funding (campaign_id);
create index submissions_campaign_score_idx on public.submissions (campaign_id, final_attention_score desc nulls last);
create index submissions_campaign_user_idx on public.submissions (campaign_id, user_id);
create index submissions_user_id_idx on public.submissions (user_id);
create index x_metric_snapshots_submission_captured_idx on public.x_metric_snapshots (submission_id, captured_at desc);
create index holder_snapshots_submission_captured_idx on public.holder_snapshots (submission_id, captured_at desc);
create index score_snapshots_submission_captured_idx on public.score_snapshots (submission_id, captured_at desc);
create index review_decisions_submission_idx on public.review_decisions (submission_id, created_at desc);
create index payouts_campaign_status_idx on public.payouts (campaign_id, status);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger x_accounts_set_updated_at
before update on public.x_accounts
for each row execute function public.set_updated_at();

create trigger x_oauth_credentials_set_updated_at
before update on public.x_oauth_credentials
for each row execute function public.set_updated_at();

create trigger wallets_set_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

create trigger submissions_set_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

create trigger payouts_set_updated_at
before update on public.payouts
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.x_accounts enable row level security;
alter table public.x_oauth_credentials enable row level security;
alter table public.wallets enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_funding enable row level security;
alter table public.campaign_payout_tiers enable row level security;
alter table public.submissions enable row level security;
alter table public.x_metric_snapshots enable row level security;
alter table public.holder_snapshots enable row level security;
alter table public.score_snapshots enable row level security;
alter table public.review_decisions enable row level security;
alter table public.payouts enable row level security;
alter table public.admin_users enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_public_read
on public.profiles for select
to anon, authenticated
using (true);

create policy profiles_self_update
on public.profiles for update
to authenticated
using (auth.uid() is not null and auth.uid() = id)
with check (auth.uid() is not null and auth.uid() = id);

create policy x_accounts_public_read
on public.x_accounts for select
to anon, authenticated
using (true);

create policy wallets_self_read
on public.wallets for select
to authenticated
using (auth.uid() is not null and auth.uid() = user_id);

create policy campaigns_public_or_owner_read
on public.campaigns for select
to anon, authenticated
using (
  status in ('upcoming', 'live', 'review', 'finalized')
  or (auth.uid() is not null and auth.uid() = creator_id)
);

create policy campaigns_owner_insert
on public.campaigns for insert
to authenticated
with check (
  auth.uid() is not null
  and auth.uid() = creator_id
  and status = 'draft'
  and funded_at is null
);

create policy campaigns_owner_update_before_live
on public.campaigns for update
to authenticated
using (
  auth.uid() is not null
  and auth.uid() = creator_id
  and status in ('draft', 'funding')
)
with check (
  auth.uid() is not null
  and auth.uid() = creator_id
  and status in ('draft', 'funding')
);

create policy campaigns_owner_delete_draft
on public.campaigns for delete
to authenticated
using (auth.uid() is not null and auth.uid() = creator_id and status = 'draft');

create policy campaign_funding_public_confirmed_or_owner
on public.campaign_funding for select
to anon, authenticated
using (
  status = 'confirmed'
  or exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and auth.uid() is not null and c.creator_id = auth.uid()
  )
);

create policy payout_tiers_public_read
on public.campaign_payout_tiers for select
to anon, authenticated
using (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id
      and (c.status in ('upcoming', 'live', 'review', 'finalized') or c.creator_id = auth.uid())
  )
);

create policy payout_tiers_owner_insert
on public.campaign_payout_tiers for insert
to authenticated
with check (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid() and c.status = 'draft'
  )
);

create policy payout_tiers_owner_update
on public.campaign_payout_tiers for update
to authenticated
using (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid() and c.status = 'draft'
  )
)
with check (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid() and c.status = 'draft'
  )
);

create policy payout_tiers_owner_delete
on public.campaign_payout_tiers for delete
to authenticated
using (
  exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and c.creator_id = auth.uid() and c.status = 'draft'
  )
);

create policy submissions_public_read
on public.submissions for select
to anon, authenticated
using (status in ('tracking', 'flagged', 'approved', 'winner'));

create policy submissions_participant_or_campaign_owner_read
on public.submissions for select
to authenticated
using (
  auth.uid() is not null
  and (
    user_id = auth.uid()
    or exists (
      select 1 from public.campaigns c
      where c.id = campaign_id and c.creator_id = auth.uid()
    )
  )
);

create policy x_metrics_public_read
on public.x_metric_snapshots for select
to anon, authenticated
using (
  exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.status in ('tracking', 'flagged', 'approved', 'winner')
  )
);

create policy holder_snapshots_owner_read
on public.holder_snapshots for select
to authenticated
using (
  exists (
    select 1
    from public.submissions s
    join public.campaigns c on c.id = s.campaign_id
    where s.id = submission_id
      and (s.user_id = auth.uid() or c.creator_id = auth.uid())
  )
);

create policy score_snapshots_public_read
on public.score_snapshots for select
to anon, authenticated
using (
  exists (
    select 1 from public.submissions s
    where s.id = submission_id and s.status in ('tracking', 'flagged', 'approved', 'winner')
  )
);

create policy review_decisions_participant_or_campaign_owner_read
on public.review_decisions for select
to authenticated
using (
  exists (
    select 1
    from public.submissions s
    join public.campaigns c on c.id = s.campaign_id
    where s.id = submission_id
      and (s.user_id = auth.uid() or c.creator_id = auth.uid())
  )
);

create policy payouts_public_confirmed_or_participant_read
on public.payouts for select
to anon, authenticated
using (
  status = 'confirmed'
  or (
    auth.uid() is not null
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.campaigns c
        where c.id = campaign_id and c.creator_id = auth.uid()
      )
    )
  )
);

create or replace view public.campaign_leaderboard
with (security_invoker = true)
as
select
  s.campaign_id,
  s.id as submission_id,
  s.x_post_url,
  s.submitted_at,
  xa.username as x_username,
  xa.display_name as x_display_name,
  xa.profile_image_url as x_profile_image_url,
  coalesce(s.final_attention_score, latest.total_score, 0) as attention_score,
  coalesce(s.final_holder_multiplier, latest.holder_multiplier, 1) as holder_multiplier,
  row_number() over (
    partition by s.campaign_id
    order by coalesce(s.final_attention_score, latest.total_score, 0) desc, s.submitted_at asc
  ) as rank
from public.submissions s
join public.x_accounts xa on xa.id = s.x_account_id
left join lateral (
  select ss.total_score, ss.holder_multiplier
  from public.score_snapshots ss
  where ss.submission_id = s.id
  order by ss.captured_at desc
  limit 1
) latest on true
where s.status in ('tracking', 'flagged', 'approved', 'winner');

grant usage on schema public to anon, authenticated, service_role;

grant select on table
  public.profiles,
  public.x_accounts,
  public.campaigns,
  public.campaign_funding,
  public.campaign_payout_tiers,
  public.submissions,
  public.x_metric_snapshots,
  public.score_snapshots,
  public.payouts,
  public.campaign_leaderboard
to anon, authenticated;

grant select on table
  public.wallets,
  public.holder_snapshots,
  public.review_decisions
to authenticated;

grant update on table public.profiles to authenticated;
grant insert, update, delete on table public.campaigns to authenticated;
grant insert, update, delete on table public.campaign_payout_tiers to authenticated;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on table public.x_oauth_credentials from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

commit;
