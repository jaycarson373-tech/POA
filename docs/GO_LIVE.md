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
6. In a third query, run
   `supabase/migrations/20260720220000_operational_backend.sql` once.
7. Open **Table Editor** and confirm that `campaigns`, `submissions`,
   `x_metric_snapshots`, `holder_snapshots`, `score_snapshots`, and `payouts`
   exist, along with the campaign control-plane tables.

The migration creates the complete V1 data model, indexes, automatic profile
creation, row-level security, and a public `campaign_leaderboard` view.

## 2. Configure Supabase Auth with X

In Supabase:

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://YOUR-POA-DOMAIN.com`.
3. Add these redirect URLs:
   - `http://localhost:3000/account`
   - `https://YOUR-POA-DOMAIN.com/account`
4. Open **Authentication → Providers → X / Twitter (OAuth 2.0)**.
5. Copy the Supabase provider callback URL. It will look like:
   `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.

In the X Developer Console:

1. Create a Project and OAuth 2.0 App.
2. Choose **Web App, Automated App or Bot** with read permissions.
3. Set the X callback URL to the Supabase provider callback URL from above.
4. Set the website URL to the production POA domain.
5. Save the Client ID, Client Secret, and Bearer Token securely.
6. Purchase enough X API credits before enabling metric polling.

Return to Supabase, enable the X provider, and paste the X Client ID and Client
Secret there. The application requests `tweet.read users.read follows.read
offline.access`. X provider access and refresh tokens are encrypted before POA
stores them.

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

Generate two server-only secrets locally:

```bash
openssl rand -base64 32
openssl rand -base64 32
```

Use one output as `TOKEN_ENCRYPTION_KEY` and the other as
`INTERNAL_API_SECRET`. Store them only in Railway. Do not send the values
through chat or commit them to GitHub.

## 4. Create the Railway worker/API service

1. Create a Railway project named `poa-production`.
2. Add a service from the same GitHub repository and name it `poa-workers`.
3. Paste `deploy/railway.env.example` into the service's **Variables → Raw
   Editor** and replace every placeholder.
4. Add a Railway public domain and copy it into Vercel as
   `NEXT_PUBLIC_RAILWAY_API_URL`, then redeploy Vercel.
5. Seal `SUPABASE_SERVICE_ROLE_KEY`, `X_BEARER_TOKEN`,
   `TOKEN_ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, both wallet private keys, and
   the private RPC URL in Railway.

The committed worker owns X polling, signed wallet verification, scoring,
campaign transitions, application funding verification, review finalization,
and reward transactions. Railway health checks `/health` before routing traffic.

## 5. Solana setup

Create a private mainnet RPC/indexer endpoint and use its HTTPS URL as
`SOLANA_RPC_URL` in Railway. Do not use a browser-exposed public variable for a
paid RPC key.

Create two limited-balance wallets: a POA five-minute reward wallet and a
separate sponsor-campaign collection wallet. Put their public addresses in the
matching public-key variables. Paste each secret only into its Railway sealed
variable; never put it in Vercel, Supabase, GitHub, logs, or chat. Fund only the
amount required for a short operating window and keep the main treasury out of
the worker.

Set `POA_REWARD_EPOCH_AMOUNT_RAW` explicitly. The worker intentionally has no
default transfer amount. Confirm the public key derived from the secret matches
`POA_REWARD_WALLET_PUBLIC_KEY`; the worker refuses to sign if it does not.

The buyback worker uses Jupiter Swap V2 order/execute, keeps the configured SOL
reserve untouched, and allocates 50% of the remaining wallet balance each
five-minute epoch. It records the epoch before requesting a transaction, so a
restart cannot execute the same time bucket twice. Set `JUPITER_API_KEY`, the
buyback wallet pair, and a nonzero reserve before `BUYBACK_MODE=live`. Start
with a deliberately small fee-wallet balance and confirm the first signature.

## 6. Value locations

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API → publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service role key |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X Developer Console → Supabase X provider |
| `X_BEARER_TOKEN` | X Developer Console → Railway sealed variable |
| `SOLANA_RPC_URL` | Your private Solana RPC/indexer dashboard |
| `NEXT_PUBLIC_RAILWAY_API_URL` | Railway service → Settings → Networking |
| `NEXT_PUBLIC_APP_URL` / `WEB_APP_URL` | Final Vercel custom domain |

## 7. Create the first administrator

After connecting the intended admin X account once, open Supabase →
Authentication → Users, copy that user UUID, and run:

```sql
insert into public.admin_users (user_id)
values ('REPLACE_WITH_AUTH_USER_UUID')
on conflict (user_id) do nothing;
```

The same account can then open `/admin`, approve campaign applications, review
each submission for botting, and finalize ended third-party campaigns.

## 8. Launch verification

1. Confirm Railway `/health` returns `status: ready` and `reward_mode: live`.
2. Connect X at `/account` and verify a seven-day-old Solana wallet.
3. Submit one qualifying `$POA` post and approve it from `/admin`.
4. Confirm the next reward epoch writes one `reward_epochs` row and one
   confirmed `reward_epoch_payouts` signature—never two rows for the same epoch.
5. Run one funded SOL or SPL campaign through application, on-chain funding,
   approval, submission review, and finalization with a deliberately small pool.
6. Confirm one small buyback epoch through Jupiter before funding the fee wallet
   with more than the next operating window.
