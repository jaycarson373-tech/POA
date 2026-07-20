# POA go-live setup

This guide prepares Supabase, Vercel, Railway, X, and Solana for the production
integration. The frontend renders only records it can read from the production
database and shows empty states otherwise. Completing these setup steps gives
the application and workers the remaining infrastructure they need for real
identity-scoped statistics and signed transactions.

## 1. Create the Supabase database

1. Create a Supabase project in the region closest to the majority of users.
2. Open **SQL Editor** and create a new query.
3. Copy the entire contents of
   `supabase/migrations/20260720160000_initial_poa.sql` into the editor.
4. Click **Run** once.
5. In a new query, run
   `supabase/migrations/20260720213000_campaign_control_plane.sql` once.
6. Open **Table Editor** and confirm that `campaigns`, `submissions`,
   `x_metric_snapshots`, `holder_snapshots`, `score_snapshots`, and `payouts`
   exist, along with the campaign control-plane tables.

The migration creates the complete V1 data model, indexes, automatic profile
creation, row-level security, and a public `campaign_leaderboard` view.

## 2. Configure Supabase Auth with X

In Supabase:

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://YOUR-POA-DOMAIN.com`.
3. Add these redirect URLs:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-POA-DOMAIN.com/auth/callback`
4. Open **Authentication → Providers → X / Twitter (OAuth 2.0)**.
5. Copy the Supabase provider callback URL. It will look like:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.

In the X Developer Console:

1. Create a Project and OAuth 2.0 App.
2. Choose **Web App** with read permissions.
3. Set the X callback URL to the Supabase provider callback URL from above.
4. Set the website URL to the production POA domain.
5. Save the Client ID, Client Secret, and Bearer Token securely.
6. Purchase enough X API credits before enabling metric polling.

Return to Supabase, enable the X provider, and paste the X Client ID and Client
Secret there. The application will request `tweet.read users.read
offline.access`. X provider access and refresh tokens will be encrypted before
POA stores them.

## 3. Create the Vercel frontend

1. Import `jaycarson373-tech/POA` into Vercel.
2. Use the **Next.js** framework preset.
3. Keep the repository root as the Root Directory.
4. The committed `vercel.json` sets the correct Vercel build command.
5. Paste `deploy/vercel.env.example` into Environment Variables and replace
   every placeholder.
6. Apply the variables to Production, Preview, and Development.
7. Deploy, then assign the final custom domain.
8. Update `NEXT_PUBLIC_APP_URL`, the Supabase Site URL, and redirect URLs if the
   final domain changed. Redeploy after changing Vercel variables.

Generate the two shared secrets locally:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Use one output as `TOKEN_ENCRYPTION_KEY` and the other as
`INTERNAL_API_SECRET`. Store the same values in Vercel and Railway. Do not send
the values through chat or commit them to GitHub.

## 4. Create the Railway worker/API service

1. Create a Railway project named `poa-production`.
2. Add a service from the same GitHub repository and name it `poa-workers`.
3. Paste `deploy/railway.env.example` into the service's **Variables → Raw
   Editor** and replace every placeholder.
4. Get `DATABASE_URL` from Supabase's **Connect** dialog. Use the Shared Pooler
   **Session mode** URL on port `5432` for the persistent Railway worker.
5. Generate `CRON_SECRET` with `openssl rand -base64 32`.
6. Seal `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `X_CLIENT_SECRET`,
   `X_BEARER_TOKEN`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, and
   `CRON_SECRET` in Railway after confirming they work.

The worker process and API routes are the next implementation step. It will own
X polling, wallet indexing, scoring, campaign transitions, review finalization,
market snapshots, payout preparation, and the buyback execution ledger.

## 5. Solana setup

Create a private mainnet RPC/indexer endpoint and use its HTTPS URL as
`SOLANA_RPC_URL` in both services. Do not use a browser-exposed public variable
for a paid RPC key.

Use a public treasury address for `TREASURY_PUBLIC_KEY`. Launch with
`PAYOUT_MODE=manual` and approve payouts through a multisig or hardware wallet.
Do not store a raw treasury private key in Vercel, Railway, Supabase, GitHub, or
chat.

Keep `BUYBACK_MODE=disabled` until the Railway transaction builder, independent
quote validation, slippage cap, nonzero operating reserve, replay protection,
and managed signer have been reviewed on mainnet. The requested five-minute,
50% policy is represented by `BUYBACK_INTERVAL_SECONDS=300` and
`BUYBACK_ALLOCATION_BPS=5000`; those variables do not execute a swap by
themselves. Only confirmed signatures should be written to `buyback_epochs` and
shown as completed buybacks on the public dashboard.

## 6. Value locations

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API → publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service role key |
| `DATABASE_URL` | Supabase → Connect → Session pooler |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_BEARER_TOKEN` | X Developer Console → App → Keys and tokens |
| `SOLANA_RPC_URL` | Your private Solana RPC/indexer dashboard |
| `RAILWAY_API_URL` | Railway service → Settings → Networking |
| `NEXT_PUBLIC_APP_URL` / `WEB_APP_URL` | Final Vercel custom domain |

## 7. Engineering order after setup

1. Supabase browser/server clients and X login.
2. Solana message signing, one-X/one-wallet enforcement, and age checks.
3. Real campaign creation, funding detection, and submissions.
4. Railway X/Solana scanners and immutable metric snapshots.
5. Transparent V1 scoring and live leaderboard.
6. Admin review queue and manual multisig payout export.
7. Security review, production test campaign, then public launch.
