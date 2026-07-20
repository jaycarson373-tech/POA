# POA — Proof of Attention

POA is an attention marketplace for Solana communities. Projects fund a timed
campaign in SOL or an SPL token, creators submit original X posts, and the
campaign rewards the posts that generate the most verified organic attention.
Holding the campaign token adds a transparent, time-weighted score bonus.

## Current version

The repository currently contains the complete interactive launch experience:

- campaign discovery, filtering, and detail views
- simulated X and Solana wallet connection
- eligibility messaging for account age, followers, and wallet age
- X post submission and attention-tracking flow
- live leaderboard, attention score, and holder bonus presentation
- token/SOL campaign creation and funding flow
- finalist review and anti-bot policy messaging
- responsive desktop and mobile layouts
- custom Open Graph card for social sharing

The production data integrations are the next phase. Until those are connected,
accounts, campaigns, scores, and transactions use demonstration data.

Live preview: [proof-of-attention.sufficientlev.chatgpt.site](https://proof-of-attention.sufficientlev.chatgpt.site)

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

- `app/page.tsx` — POA product interface and prototype interactions
- `app/globals.css` — visual system and responsive layouts
- `app/layout.tsx` — metadata and social preview configuration
- `public/og.png` — POA social sharing card
- `tests/rendered-html.test.mjs` — rendered-product checks

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
