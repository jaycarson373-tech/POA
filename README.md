# POA — Proof of Attention

POA is an attention marketplace for Solana communities. Projects fund a timed
campaign in SOL or an SPL token, creators submit original X posts, and the
campaign rewards the posts that generate the most verified organic attention.
Holding the campaign token adds a transparent, time-weighted score bonus.

## Current version

The repository contains a real-data frontend with:

- Supabase-backed campaign discovery, protocol totals, rankings, and rewards
- a separate per-campaign dashboard with verified X performance and activity
- Supabase X OAuth, encrypted provider-token storage, and X eligibility gates
- Wallet Standard connect plus signed ownership and seven-day age verification
- honest empty and unavailable states instead of demonstration records
- POA-first campaign ordering when a real POA campaign row exists
- a Railway API/worker for scoring, five-minute reward epochs, campaign funding,
  admin review, refunds, and SOL/SPL payouts
- responsive desktop and mobile layouts and custom social metadata

The automatic POA reward path fails closed unless Railway is explicitly set to
`AUTO_REWARDS_MODE=live`, a per-epoch budget is configured, and the limited hot
wallet key matches its configured public address. Buybacks use the same
idempotent five-minute epoch pattern and Jupiter Swap V2; only a confirmed
onchain result is displayed as completed.

Live site: [proofofattention.fun](https://www.proofofattention.fun/)

## Product flow

1. A sponsor creates a campaign, chooses a duration, and funds the reward pool.
2. A creator connects X and signs a message with a Solana wallet.
3. POA verifies X account age/followers and the wallet's earliest activity.
4. The creator publishes an original post and submits its X URL.
5. Background workers snapshot organic X metrics and onchain token balances.
6. POA ranks submissions by verified attention with a capped holder multiplier.
7. The campaign closes and finalists enter a human anti-bot review queue.
8. Approved winners receive the configured SOL or SPL-token payout.

## Local development

Requirements: Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

The development site runs at `http://localhost:3000`.

```bash
npm test
npm run build
```

## Production services

- **Supabase:** PostgreSQL source of truth, row-level security, campaigns,
  identities, submissions, metric snapshots, reviews, and payouts.
- **Railway:** API service and background workers for X polling, Solana
  indexing, campaign finalization, scoring, and scheduled jobs.
- **X API:** OAuth 2.0 connection, author verification, account eligibility,
  post lookup, and organic/public metrics.
- **Solana RPC/indexer:** wallet-age verification, SPL balances, holder-time
  snapshots, funding confirmation, and payout transaction status.
- **Railway sealed signers:** separate limited-balance reward and campaign
  collection hot wallets. Signer values are server-only and never browser-exposed.

Copy `.env.example` to `.env.local` when the production services are ready.
Only public browser values may use the `NEXT_PUBLIC_` prefix.

For the complete copy-paste infrastructure setup, see
[`docs/GO_LIVE.md`](docs/GO_LIVE.md). The initial Supabase schema is committed
at [`supabase/migrations/20260720160000_initial_poa.sql`](supabase/migrations/20260720160000_initial_poa.sql),
with separate Vercel and Railway environment templates in [`deploy/`](deploy/).

## Application structure

- `app/page.tsx` — POA protocol home and real public-data marketplace
- `app/campaign/` — per-campaign control dashboard
- `app/account/` — X OAuth and signed Solana-wallet eligibility
- `app/apply/` — vetted campaign application and funding verification
- `app/admin/` — application/submission review and payout finalization
- `railway/` — production API, scanners, scoring, and transaction worker
- `app/globals.css` — visual system and responsive layouts
- `app/layout.tsx` — metadata and social preview configuration
- `public/og.png` — POA social sharing card
- `tests/rendered-html.test.mjs` — rendered-product checks
- `supabase/migrations/20260720213000_campaign_control_plane.sql` — vetted
  campaign, refund, holder-position, market, fee, and buyback control plane
- `supabase/migrations/20260720220000_operational_backend.sql` — wallet/X gates,
  campaign applications, reward epochs, and automatic payout ledger

## Reward model

The intended V1 formula is deliberately explainable:

```text
attention score
= verified organic impressions
× engagement-quality multiplier
× holder multiplier
```

The holder multiplier is capped by each campaign. All leaderboard results are
provisional until a human reviews the finalists for purchased engagement,
coordinated bot activity, copied posts, and rule violations.
