"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type CampaignStatus = "draft" | "funding" | "upcoming" | "live" | "review" | "finalized" | "cancelled";

type CampaignRecord = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  token_mint: string;
  brief: string;
  reward_kind: "SOL" | "SPL";
  reward_mint: string | null;
  reward_amount_raw: string;
  reward_decimals: number;
  duration_hours: number;
  submission_limit: number;
  winner_count: number;
  holder_bonus_max_bps: number;
  holder_min_balance_raw: string;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  funded_at: string | null;
  created_at: string;
};

type SubmissionRecord = {
  id: string;
  user_id: string;
  x_post_url: string;
  status: "tracking" | "flagged" | "approved" | "disqualified" | "winner";
  submitted_at: string;
};

type LeaderboardRecord = {
  submission_id: string;
  x_post_url: string;
  x_username: string;
  x_display_name: string | null;
  attention_score: string;
  holder_multiplier: string;
  rank: number;
};

type MetricRecord = {
  submission_id: string;
  captured_at: string;
  impression_count: number;
  organic_impression_count: number | null;
  like_count: number;
  repost_count: number;
  reply_count: number;
  quote_count: number;
  bookmark_count: number;
};

type PayoutRecord = {
  id: string;
  submission_id: string;
  rank: number;
  asset_mint: string | null;
  amount_raw: string;
  transaction_signature: string | null;
  confirmed_at: string;
};

type MarketSnapshotRecord = {
  token_mint: string;
  price_usd: string | null;
  volume_24h_usd: string | null;
  liquidity_usd: string | null;
  source: string;
  captured_at: string;
};

type BuybackEpochRecord = {
  id: string;
  input_lamports: string | null;
  output_amount_raw: string | null;
  output_decimals: number | null;
  transaction_signature: string | null;
  confirmed_at: string | null;
  status: string;
};

type OptionalRows<T> = {
  available: boolean;
  rows: T[];
};

type DashboardData = {
  campaigns: CampaignRecord[];
  submissions: SubmissionRecord[];
  leaderboard: LeaderboardRecord[];
  metrics: MetricRecord[];
  payouts: PayoutRecord[];
  market: OptionalRows<MarketSnapshotRecord>;
  buybacks: OptionalRows<BuybackEpochRecord>;
};

type SyncState = "loading" | "ready" | "unconfigured" | "error";

const EMPTY_DATA: DashboardData = {
  campaigns: [],
  submissions: [],
  leaderboard: [],
  metrics: [],
  payouts: [],
  market: { available: false, rows: [] },
  buybacks: { available: false, rows: [] },
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim()
  || "8MWh6MXsd64vgxrtjN2HygwJLR8g6fTGPTGJUXVBpump";

async function fetchRows<T>(resource: string): Promise<T[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });

  if (!response.ok) throw new Error(`Campaign data request failed with ${response.status}`);
  return response.json() as Promise<T[]>;
}

async function fetchOptionalRows<T>(resource: string): Promise<OptionalRows<T>> {
  try {
    return { available: true, rows: await fetchRows<T>(resource) };
  } catch {
    return { available: false, rows: [] };
  }
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUsd(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    notation: parsed >= 1000 ? "compact" : "standard",
    maximumFractionDigits: parsed >= 1000 ? 1 : 4,
  }).format(parsed);
}

function formatTokenAmount(raw: string, decimals: number, maxFraction = 2) {
  try {
    const digits = BigInt(raw || "0").toString().padStart(decimals + 1, "0");
    const whole = decimals > 0 ? digits.slice(0, -decimals) : digits;
    const fraction = decimals > 0
      ? digits.slice(-decimals).replace(/0+$/, "").slice(0, maxFraction)
      : "";
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fraction ? `${grouped}.${fraction}` : grouped;
  } catch {
    return "—";
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCountdown(endsAt: string | null, now: number) {
  if (!endsAt || now === 0) return "—";
  const remaining = new Date(endsAt).getTime() - now;
  if (remaining <= 0) return "ENDED";

  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}D ${hours.toString().padStart(2, "0")}H`;
  return `${hours.toString().padStart(2, "0")}H ${minutes.toString().padStart(2, "0")}M`;
}

function formatReward(campaign: CampaignRecord) {
  const symbol = campaign.reward_kind === "SOL" ? "SOL" : `$${campaign.ticker}`;
  return `${formatTokenAmount(campaign.reward_amount_raw, campaign.reward_decimals)} ${symbol}`;
}

function CampaignMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? "brand-image brand-image--compact" : "campaign-dashboard-mark"}
      role="img"
      aria-label="Proof of Attention"
      style={{ backgroundImage: 'url("../poa-wordmark.jpg")' }}
    />
  );
}

function DataEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="dashboard-empty">
      <span>[000]</span>
      <div><strong>{title}</strong><p>{body}</p></div>
    </div>
  );
}

export default function CampaignDashboard() {
  const searchParams = useSearchParams();
  const requestedSlug = searchParams.get("slug")?.trim() ?? "";
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setSyncState("unconfigured");
      setData(EMPTY_DATA);
      return;
    }

    setSyncState("loading");
    try {
      const campaigns = await fetchRows<CampaignRecord>(
        "campaigns?select=id,slug,name,ticker,token_mint,brief,reward_kind,reward_mint,reward_amount_raw,reward_decimals,duration_hours,submission_limit,winner_count,holder_bonus_max_bps,holder_min_balance_raw,status,starts_at,ends_at,funded_at,created_at&status=in.(upcoming,live,review,finalized)&order=created_at.desc&limit=250",
      );
      const orderedCampaigns = [...campaigns].sort((left, right) => {
        const leftIsPoa = left.token_mint === CONTRACT_ADDRESS || left.ticker.toUpperCase() === "POA";
        const rightIsPoa = right.token_mint === CONTRACT_ADDRESS || right.ticker.toUpperCase() === "POA";
        return Number(rightIsPoa) - Number(leftIsPoa);
      });
      const selected = orderedCampaigns.find((campaign) => campaign.slug === requestedSlug)
        ?? orderedCampaigns[0];

      if (!selected) {
        setData({ ...EMPTY_DATA, campaigns: orderedCampaigns });
        setSyncState("ready");
        return;
      }

      const campaignFilter = `campaign_id=eq.${encodeURIComponent(selected.id)}`;
      const [submissions, leaderboard, payouts, market, buybacks] = await Promise.all([
        fetchRows<SubmissionRecord>(
          `submissions?select=id,user_id,x_post_url,status,submitted_at&${campaignFilter}&status=in.(tracking,flagged,approved,winner)&order=submitted_at.desc&limit=1000`,
        ),
        fetchRows<LeaderboardRecord>(
          `campaign_leaderboard?select=submission_id,x_post_url,x_username,x_display_name,attention_score,holder_multiplier,rank&${campaignFilter}&order=rank.asc&limit=250`,
        ),
        fetchRows<PayoutRecord>(
          `payouts?select=id,submission_id,rank,asset_mint,amount_raw,transaction_signature,confirmed_at&${campaignFilter}&status=eq.confirmed&order=confirmed_at.desc&limit=1000`,
        ),
        fetchOptionalRows<MarketSnapshotRecord>(
          `campaign_market_snapshots?select=token_mint,price_usd,volume_24h_usd,liquidity_usd,source,captured_at&${campaignFilter}&order=captured_at.desc&limit=1`,
        ),
        fetchOptionalRows<BuybackEpochRecord>(
          "buyback_epochs?select=id,input_lamports,output_amount_raw,output_decimals,transaction_signature,confirmed_at,status&status=eq.confirmed&order=confirmed_at.desc&limit=1000",
        ),
      ]);
      const submissionIds = submissions.map((submission) => submission.id).join(",");
      const metrics = submissionIds
        ? await fetchRows<MetricRecord>(
            `x_metric_snapshots?select=submission_id,captured_at,impression_count,organic_impression_count,like_count,repost_count,reply_count,quote_count,bookmark_count&submission_id=in.(${submissionIds})&fetch_status=eq.ok&order=captured_at.desc&limit=5000`,
          )
        : [];

      setData({ campaigns: orderedCampaigns, submissions, leaderboard, metrics, payouts, market, buybacks });
      setSyncState("ready");
    } catch {
      setData(EMPTY_DATA);
      setSyncState("error");
    }
  }, [requestedSlug]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadDashboard]);

  useEffect(() => {
    const update = () => setNow(Date.now());
    const timeout = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const campaign = useMemo(() => {
    return data.campaigns.find((item) => item.slug === requestedSlug) ?? data.campaigns[0];
  }, [data.campaigns, requestedSlug]);

  const latestMetricBySubmission = useMemo(() => {
    const latest = new Map<string, MetricRecord>();
    for (const metric of data.metrics) {
      if (!latest.has(metric.submission_id)) latest.set(metric.submission_id, metric);
    }
    return latest;
  }, [data.metrics]);

  const campaignTotals = useMemo(() => {
    const totals = {
      impressions: 0,
      organicImpressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0,
    };
    for (const metric of latestMetricBySubmission.values()) {
      totals.impressions += metric.impression_count;
      totals.organicImpressions += metric.organic_impression_count ?? 0;
      totals.likes += metric.like_count;
      totals.reposts += metric.repost_count;
      totals.replies += metric.reply_count;
      totals.quotes += metric.quote_count;
      totals.bookmarks += metric.bookmark_count;
    }
    return totals;
  }, [latestMetricBySubmission]);

  const poaAirdropped = useMemo(() => {
    if (!campaign || campaign.reward_kind !== "SPL" || campaign.reward_mint !== campaign.token_mint) return null;
    return data.payouts
      .filter((payout) => payout.asset_mint === campaign.token_mint)
      .reduce((sum, payout) => sum + BigInt(payout.amount_raw), BigInt(0));
  }, [campaign, data.payouts]);

  const confirmedBuybackSol = useMemo(() => {
    return data.buybacks.rows.reduce((sum, epoch) => sum + BigInt(epoch.input_lamports ?? "0"), BigInt(0));
  }, [data.buybacks.rows]);

  const market = data.market.rows[0];
  const ready = syncState === "ready";
  const emptyBody = syncState === "unconfigured"
    ? "Public protocol data is not configured on this deployment."
    : syncState === "error"
      ? "The public data service could not be synchronized."
      : "No reviewed campaign has been published yet.";

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setNotice("Contract address copied.");
    } catch {
      setNotice("Could not copy contract address.");
    }
  };

  return (
    <main className="campaign-dashboard-page">
      <header className="protocol-header campaign-dashboard-header">
        <Link className="protocol-brand" href="../" aria-label="Proof of Attention home"><CampaignMark compact /></Link>
        <nav aria-label="Campaign navigation">
          <Link href="../#campaigns">Campaigns</Link>
          <a href="#overview">Overview</a>
          <a href="#rankings">Leaderboard</a>
          <a href="#activity">Activity</a>
        </nav>
        <div className="connection-actions">
          <button className="header-contract" onClick={() => void copyContract()} aria-label="Copy POA contract address">
            <span>CA</span><b>{`${CONTRACT_ADDRESS.slice(0, 4)}…${CONTRACT_ADDRESS.slice(-4)}`}</b><i>COPY</i>
          </button>
          <Link className="button-primary button-small" href="../#top">Connect identity</Link>
        </div>
      </header>

      <div className="status-rail">
        <span><i className={ready ? "status-live" : ""} /> CAMPAIGN CONTROL</span>
        <span>NETWORK / SOLANA</span>
        <span>INDEX / {syncState.toUpperCase()}</span>
        <span className="status-rail-end">REAL DATA ONLY</span>
      </div>

      {syncState === "loading" ? (
        <div className="campaign-dashboard-loading">SYNCHRONIZING CAMPAIGN DATA…</div>
      ) : !campaign ? (
        <section className="campaign-dashboard-empty-page">
          <CampaignMark />
          <DataEmpty title="No campaign dashboard available" body={emptyBody} />
          <Link className="button-secondary" href="../">Return to protocol</Link>
        </section>
      ) : (
        <div className="campaign-dashboard-shell">
          <aside className="campaign-index" aria-label="Campaign index">
            <div className="campaign-index-heading"><span>CAMPAIGNS</span><b>{data.campaigns.length.toString().padStart(2, "0")}</b></div>
            <div className="campaign-index-list">
              {data.campaigns.map((item, index) => (
                <Link
                  className={item.id === campaign.id ? "active" : ""}
                  href={`?slug=${encodeURIComponent(item.slug)}`}
                  key={item.id}
                >
                  <span>{(index + 1).toString().padStart(2, "0")}</span>
                  <div><strong>{item.name}</strong><small>${item.ticker} / {item.status}</small></div>
                  <i />
                </Link>
              ))}
            </div>
            <div className="campaign-index-note">
              <span>LISTING POLICY</span>
              <p>Every project is reviewed by the POA team before publication.</p>
            </div>
          </aside>

          <div className="campaign-dashboard-content">
            <section className="campaign-control-hero" id="overview">
              <div className="campaign-control-title">
                <span className="section-label">CAMPAIGN / {campaign.status.toUpperCase()}</span>
                <div>
                  <span className="campaign-token">{campaign.ticker.slice(0, 2)}</span>
                  <div><h1>{campaign.name}</h1><p>${campaign.ticker} / {campaign.token_mint.slice(0, 6)}…{campaign.token_mint.slice(-4)}</p></div>
                </div>
                <p className="campaign-brief">{campaign.brief}</p>
              </div>
              <dl className="campaign-control-meta">
                <div><dt>Reward pool</dt><dd>{formatReward(campaign)}</dd></div>
                <div><dt>Time remaining</dt><dd className="countdown">{formatCountdown(campaign.ends_at, now)}</dd></div>
                <div><dt>Winner count</dt><dd>{campaign.winner_count}</dd></div>
                <div><dt>Holder bonus</dt><dd>UP TO {(campaign.holder_bonus_max_bps / 100).toFixed(0)}%</dd></div>
              </dl>
            </section>

            <section className="dashboard-section">
              <div className="dashboard-section-head"><div><span>LIVE PERFORMANCE</span><h2>Campaign overview</h2></div><small>SOURCE / VERIFIED SNAPSHOTS</small></div>
              <div className="dashboard-stat-grid">
                <article className="dashboard-stat-primary"><span>TOTAL X IMPRESSIONS</span><strong>{formatCompact(campaignTotals.impressions)}</strong><small>Latest verified snapshot per entry</small></article>
                <article><span>ENTRIES</span><strong>{formatCompact(data.submissions.length)}</strong><small>Public tracked submissions</small></article>
                <article><span>RANKED CREATORS</span><strong>{formatCompact(data.leaderboard.length)}</strong><small>Current verified leaderboard</small></article>
                <article><span>TOTAL {campaign.ticker.toUpperCase()} AIRDROPPED</span><strong>{poaAirdropped === null ? "—" : formatTokenAmount(poaAirdropped.toString(), campaign.reward_decimals)}</strong><small>{poaAirdropped === null ? "Campaign reward asset is different" : "Confirmed onchain payouts only"}</small></article>
                <article><span>24H TOKEN VOLUME</span><strong>{formatUsd(market?.volume_24h_usd)}</strong><small>{market ? `${market.source} / ${formatDate(market.captured_at)}` : "Market feed not connected"}</small></article>
                <article><span>LIQUIDITY</span><strong>{formatUsd(market?.liquidity_usd)}</strong><small>{market ? "Latest indexed market snapshot" : "Market feed not connected"}</small></article>
              </div>
              <div className="engagement-strip">
                <div><span>LIKES</span><b>{formatCompact(campaignTotals.likes)}</b></div>
                <div><span>REPOSTS</span><b>{formatCompact(campaignTotals.reposts)}</b></div>
                <div><span>REPLIES</span><b>{formatCompact(campaignTotals.replies)}</b></div>
                <div><span>QUOTES</span><b>{formatCompact(campaignTotals.quotes)}</b></div>
                <div><span>BOOKMARKS</span><b>{formatCompact(campaignTotals.bookmarks)}</b></div>
              </div>
            </section>

            <section className="dashboard-section your-stats-section">
              <div className="dashboard-section-head"><div><span>IDENTITY-SCOPED DATA</span><h2>Your campaign stats</h2></div><small>WALLET + X VERIFICATION REQUIRED</small></div>
              <div className="identity-lock">
                <div><i /> <strong>Identity not verified on this dashboard</strong><p>Connect X and sign with the wallet linked to your POA profile to unlock only your real campaign position.</p></div>
                <Link className="button-secondary" href="../#top">Connect on protocol</Link>
              </div>
              <div className="personal-stat-grid" aria-label="Personal campaign statistics unavailable until identity verification">
                <article><span>YOUR HOLDINGS</span><strong>—</strong><small>Live token balance</small></article>
                <article><span>HOLD TIME</span><strong>—</strong><small>First verified hold → now</small></article>
                <article><span>YOUR X IMPRESSIONS</span><strong>—</strong><small>Campaign submissions only</small></article>
                <article><span>YOUR RANK</span><strong>—</strong><small>Current leaderboard position</small></article>
                <article><span>YOUR ATTENTION SCORE</span><strong>—</strong><small>Verified performance + holder proof</small></article>
              </div>
            </section>

            <section className="dashboard-section buyback-section">
              <div className="dashboard-section-head"><div><span>PROTOCOL BUYBACKS</span><h2>POA fee loop</h2></div><small>{data.buybacks.available ? "LEDGER CONNECTED" : "LEDGER NOT DEPLOYED"}</small></div>
              <div className="buyback-policy">
                <div><span>EXECUTION WINDOW</span><strong>5 MIN</strong><small>Requested policy interval</small></div>
                <div><span>BUYBACK ALLOCATION</span><strong>50%</strong><small>Of eligible SOL after reserve</small></div>
                <div><span>CONFIRMED BUYBACKS</span><strong>{data.buybacks.available ? data.buybacks.rows.length : "—"}</strong><small>Signed and confirmed swaps only</small></div>
                <div><span>CONFIRMED SOL DEPLOYED</span><strong>{data.buybacks.available ? `${formatTokenAmount(confirmedBuybackSol.toString(), 9, 4)} SOL` : "—"}</strong><small>No quote or pending transaction counted</small></div>
              </div>
              {data.buybacks.available && data.buybacks.rows.length > 0 ? (
                <p className="buyback-status"><i className="status-live" /> BUYBACK LEDGER HAS CONFIRMED ONCHAIN EXECUTIONS</p>
              ) : (
                <p className="buyback-status"><i /> POLICY IS VISIBLE; AUTOMATION IS NOT CLAIMED ACTIVE UNTIL CONFIRMED EXECUTIONS EXIST</p>
              )}
            </section>

            <section className="dashboard-section" id="rankings">
              <div className="dashboard-section-head"><div><span>VERIFIED RANKINGS</span><h2>Campaign leaderboard</h2></div><small>ATTENTION SCORE / HOLDER PROOF</small></div>
              {data.leaderboard.length === 0 ? (
                <DataEmpty title="No campaign rankings yet" body="Rankings appear only after verified submissions have a real score." />
              ) : (
                <div className="campaign-dashboard-table" role="table" aria-label={`${campaign.name} leaderboard`}>
                  <div className="dashboard-table-row dashboard-table-labels" role="row"><span>RANK / CREATOR</span><span>SCORE</span><span>X IMPRESSIONS</span><span>HOLDER PROOF</span><span>POST</span></div>
                  {data.leaderboard.map((row) => {
                    const metric = latestMetricBySubmission.get(row.submission_id);
                    return (
                      <div className={`dashboard-table-row dashboard-rank-${Math.min(row.rank, 4)}`} role="row" key={row.submission_id}>
                        <div className="dashboard-creator"><b>#{row.rank.toString().padStart(2, "0")}</b><span><strong>{row.x_display_name || `@${row.x_username}`}</strong><small>@{row.x_username} / X</small></span></div>
                        <strong>{formatCompact(Number(row.attention_score))}</strong>
                        <span>{metric ? formatCompact(metric.impression_count) : "—"}</span>
                        <span>{Number(row.holder_multiplier).toFixed(2)}×</span>
                        <a href={row.x_post_url} target="_blank" rel="noreferrer">VIEW ↗</a>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="dashboard-section" id="activity">
              <div className="dashboard-section-head"><div><span>CAMPAIGN LEDGER</span><h2>Recent activity</h2></div><small>SUBMISSIONS + CONFIRMED REWARDS</small></div>
              {data.submissions.length === 0 && data.payouts.length === 0 ? (
                <DataEmpty title="No campaign activity yet" body="Verified submissions and confirmed payouts will appear here." />
              ) : (
                <div className="campaign-activity-feed">
                  {[
                    ...data.submissions.map((submission) => ({
                      id: `submission-${submission.id}`,
                      at: submission.submitted_at,
                      tag: "SUBMISSION",
                      text: "Campaign post entered tracking",
                      meta: submission.status,
                      href: submission.x_post_url,
                    })),
                    ...data.payouts.map((payout) => ({
                      id: `payout-${payout.id}`,
                      at: payout.confirmed_at,
                      tag: "REWARD",
                      text: `${formatTokenAmount(payout.amount_raw, campaign.reward_decimals)} ${payout.asset_mint ? `$${campaign.ticker}` : "SOL"} confirmed`,
                      meta: `rank ${payout.rank}`,
                      href: payout.transaction_signature ? `https://solscan.io/tx/${payout.transaction_signature}` : "",
                    })),
                  ].sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()).slice(0, 12).map((item) => (
                    <article key={item.id}>
                      <span>{item.tag}</span><div><strong>{item.text}</strong><small>{item.meta.toUpperCase()}</small></div><time>{formatDate(item.at)}</time>
                      {item.href ? <a href={item.href} target="_blank" rel="noreferrer">OPEN ↗</a> : <b>—</b>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {notice && <div className="notice" role="status"><i />{notice}</div>}
    </main>
  );
}
