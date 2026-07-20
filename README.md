# POA — Proof of Attention

POA is an attention marketplace for Solana communities. Projects fund a timed
campaign in SOL or an SPL token, creators submit original X posts, and the
campaign rewards the posts that generate the most verified organic attention.
Holding the campaign token adds a transparent, time-weighted score bonus.

## Current version

The repository contains a real-data frontend with:

- Supabase-backed campaign discovery, protocol totals, rankings, and rewards
- a separate per-campaign dashboard with verified X performance and activity
- Wallet Standard connect, reconnect, copy-address, and disconnect controls
- honest empty and unavailable states instead of demonstration records
- POA-first campaign ordering when a real POA campaign row exists
- campaign-review, refund, holder-position, market-snapshot, fee, and buyback
  accounting schema
- responsive desktop and mobile layouts and custom social metadata

X sign-in, wallet ownership verification, campaign submission, background
indexers, and transaction signing are not implemented yet. The dashboard keeps
identity-scoped holdings, hold time, impressions, and rank locked until those
services can return a verified user. Buybacks are not described as active until
the public ledger contains a confirmed onchain transaction.

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

## Planned production services

- **Supabase:** PostgreSQL source of truth, row-level security, campaigns,
  identities, submissions, metric snapshots, reviews, and payouts.
- **Railway:** API service and background workers for X polling, Solana
  indexing, campaign finalization, scoring, and scheduled jobs.
- **X API:** OAuth 2.0 connection, author verification, account eligibility,
  post lookup, and organic/public metrics.
- **Solana RPC/indexer:** wallet-age verification, SPL balances, holder-time
  snapshots, funding confirmation, and payout transaction status.
- **Secure signer:** multisig or managed signer for production payouts. Never
  place a raw treasury private key in an ordinary environment variable.

Copy `.env.example` to `.env.local` when the production services are ready.
Only public browser values may use the `NEXT_PUBLIC_` prefix.

For the complete copy-paste infrastructure setup, see
[`docs/GO_LIVE.md`](docs/GO_LIVE.md). The initial Supabase schema is committed
at [`supabase/migrations/20260720160000_initial_poa.sql`](supabase/migrations/20260720160000_initial_poa.sql),
with separate Vercel and Railway environment templates in [`deploy/`](deploy/).

## Application structure

- `app/page.tsx` — POA protocol home and real public-data marketplace
- `app/campaign/` — per-campaign control dashboard
- `app/globals.css` — visual system and responsive layouts
- `app/layout.tsx` — metadata and social preview configuration
- `public/og.png` — POA social sharing card
- `tests/rendered-html.test.mjs` — rendered-product checks
- `supabase/migrations/20260720213000_campaign_control_plane.sql` — vetted
  campaign, refund, holder-position, market, fee, and buyback control plane

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
