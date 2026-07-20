"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CampaignStatus = "draft" | "funding" | "upcoming" | "live" | "review" | "finalized" | "cancelled";

type CampaignRecord = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  reward_kind: "SOL" | "SPL";
  reward_amount_raw: string;
  reward_decimals: number;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

type SubmissionRecord = {
  id: string;
  campaign_id: string;
  user_id: string;
  status: "tracking" | "flagged" | "approved" | "disqualified" | "winner";
  submitted_at: string;
};

type LeaderboardRecord = {
  campaign_id: string;
  submission_id: string;
  x_username: string;
  x_display_name: string | null;
  x_profile_image_url: string | null;
  attention_score: string;
  holder_multiplier: string;
  rank: number;
};

type MetricRecord = {
  submission_id: string;
  impression_count: number;
  captured_at: string;
};

type PayoutRecord = {
  id: string;
  campaign_id: string;
  submission_id: string;
  user_id: string;
  amount_raw: string;
  asset_mint: string | null;
  rank: number;
  confirmed_at: string;
};

type XAccountRecord = {
  user_id: string;
  username: string;
  display_name: string | null;
};

type ProtocolData = {
  campaigns: CampaignRecord[];
  submissions: SubmissionRecord[];
  leaderboard: LeaderboardRecord[];
  metrics: MetricRecord[];
  payouts: PayoutRecord[];
  accounts: XAccountRecord[];
};

type SyncState = "loading" | "ready" | "unconfigured" | "error";

const EMPTY_DATA: ProtocolData = {
  campaigns: [],
  submissions: [],
  leaderboard: [],
  metrics: [],
  payouts: [],
  accounts: [],
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS?.trim() ||
  "8MWh6MXsd64vgxrtjN2HygwJLR8g6fTGPTGJUXVBpump";
const X_ACCOUNT_URL = "https://x.com/POA_solana";
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(resource: string): Promise<T[]> {
  const rows: T[] = [];

  for (let page = 0; page < 20; page += 1) {
    const separator = resource.includes("?") ? "&" : "?";
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${resource}${separator}limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Protocol data request failed with ${response.status}`);
    }

    const batch = (await response.json()) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

function formatTokenAmount(raw: string, decimals: number, maxFraction = 2) {
  try {
    const digits = BigInt(raw || "0").toString().padStart(decimals + 1, "0");
    const whole = decimals > 0 ? digits.slice(0, -decimals) : digits;
    const fraction = decimals > 0 ? digits.slice(-decimals).replace(/0+$/, "").slice(0, maxFraction) : "";
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fraction ? `${grouped}.${fraction}` : grouped;
  } catch {
    return "—";
  }
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCountdown(endsAt: string | null, now: number) {
  if (!endsAt || now === 0) return "—";
  const remaining = new Date(endsAt).getTime() - now;
  if (remaining <= 0) return "ENDED";

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}D ${hours.toString().padStart(2, "0")}H`;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function rewardLabel(campaign: CampaignRecord) {
  const symbol = campaign.reward_kind === "SOL" ? "SOL" : `$${campaign.ticker}`;
  return `${formatTokenAmount(campaign.reward_amount_raw, campaign.reward_decimals)} ${symbol}`;
}

function payoutLabel(payout: PayoutRecord, campaign?: CampaignRecord) {
  if (!campaign) return formatTokenAmount(payout.amount_raw, 9);
  const symbol = payout.asset_mint ? `$${campaign.ticker}` : "SOL";
  return `${formatTokenAmount(payout.amount_raw, campaign.reward_decimals)} ${symbol}`;
}

function EmptyState({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <div className="empty-state">
      <span className="empty-code">[{code}]</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? "brand-image brand-image--compact" : "brand-image"}
      role="img"
      aria-label="Proof of Attention"
      style={{ backgroundImage: 'url("poa-wordmark.jpg")' }}
    />
  );
}

export default function Home() {
  const [data, setData] = useState<ProtocolData>(EMPTY_DATA);
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [filter, setFilter] = useState<"all" | "live" | "upcoming" | "closed">("all");
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignRecord | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);

  const loadProtocolData = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setData(EMPTY_DATA);
      setSyncState("unconfigured");
      return;
    }

    setSyncState("loading");

    try {
      const [campaigns, submissions, leaderboard, metrics, payouts, accounts] = await Promise.all([
        fetchAllRows<CampaignRecord>(
          "campaigns?select=id,slug,name,ticker,reward_kind,reward_amount_raw,reward_decimals,status,starts_at,ends_at,created_at&status=in.(upcoming,live,review,finalized)&order=created_at.desc",
        ),
        fetchAllRows<SubmissionRecord>(
          "submissions?select=id,campaign_id,user_id,status,submitted_at&status=in.(tracking,flagged,approved,winner)&order=submitted_at.desc",
        ),
        fetchAllRows<LeaderboardRecord>(
          "campaign_leaderboard?select=campaign_id,submission_id,x_username,x_display_name,x_profile_image_url,attention_score,holder_multiplier,rank&order=attention_score.desc",
        ),
        fetchAllRows<MetricRecord>(
          "x_metric_snapshots?select=submission_id,impression_count,captured_at&fetch_status=eq.ok&order=captured_at.desc",
        ),
        fetchAllRows<PayoutRecord>(
          "payouts?select=id,campaign_id,submission_id,user_id,amount_raw,asset_mint,rank,confirmed_at&status=eq.confirmed&order=confirmed_at.desc",
        ),
        fetchAllRows<XAccountRecord>("x_accounts?select=user_id,username,display_name"),
      ]);

      setData({ campaigns, submissions, leaderboard, metrics, payouts, accounts });
      setSyncState("ready");
    } catch {
      setData(EMPTY_DATA);
      setSyncState("error");
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadProtocolData(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadProtocolData]);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const timeout = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCampaign(null);
        setShowLaunch(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const latestMetricBySubmission = useMemo(() => {
    const latest = new Map<string, MetricRecord>();
    for (const metric of data.metrics) {
      if (!latest.has(metric.submission_id)) latest.set(metric.submission_id, metric);
    }
    return latest;
  }, [data.metrics]);

  const campaignById = useMemo(
    () => new Map(data.campaigns.map((campaign) => [campaign.id, campaign])),
    [data.campaigns],
  );

  const accountByUser = useMemo(
    () => new Map(data.accounts.map((account) => [account.user_id, account])),
    [data.accounts],
  );

  const payoutBySubmission = useMemo(
    () => new Map(data.payouts.map((payout) => [payout.submission_id, payout])),
    [data.payouts],
  );

  const campaignActivity = useMemo(() => {
    const entries = new Map<string, number>();
    const attention = new Map<string, number>();

    for (const submission of data.submissions) {
      entries.set(submission.campaign_id, (entries.get(submission.campaign_id) ?? 0) + 1);
      const metric = latestMetricBySubmission.get(submission.id);
      if (metric) {
        attention.set(submission.campaign_id, (attention.get(submission.campaign_id) ?? 0) + metric.impression_count);
      }
    }

    return { entries, attention };
  }, [data.submissions, latestMetricBySubmission]);

  const protocolStats = useMemo(() => {
    const totalAttention = Array.from(latestMetricBySubmission.values()).reduce(
      (total, metric) => total + metric.impression_count,
      0,
    );
    return {
      activeCampaigns: data.campaigns.filter((campaign) => campaign.status === "live").length,
      submissions: data.submissions.length,
      creators: new Set(data.leaderboard.map((row) => row.x_username)).size,
      totalAttention,
      rewards: data.payouts.length,
    };
  }, [data, latestMetricBySubmission]);

  const visibleCampaigns = useMemo(() => {
    if (filter === "all") return data.campaigns;
    if (filter === "live") return data.campaigns.filter((campaign) => campaign.status === "live");
    if (filter === "upcoming") return data.campaigns.filter((campaign) => campaign.status === "upcoming");
    return data.campaigns.filter((campaign) => campaign.status === "review" || campaign.status === "finalized");
  }, [data.campaigns, filter]);

  const showValue = (value: number) => (syncState === "ready" ? formatCompact(value) : "—");

  const requestConnection = (label: "X" | "Wallet") => {
    setNotice(`${label} connection is not available on this deployment yet.`);
  };

  const copyContract = async () => {
    if (!CONTRACT_ADDRESS) return;
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setNotice("Contract address copied.");
    } catch {
      setNotice("Could not copy the contract address.");
    }
  };

  const dataEmptyBody =
    syncState === "unconfigured"
      ? "Protocol data has not been connected on this deployment."
      : syncState === "error"
        ? "Protocol data could not be synchronized. Try again shortly."
        : "No records have been indexed yet.";

  return (
    <main>
      <header className="protocol-header">
        <a className="protocol-brand" href="#top" aria-label="Proof of Attention home">
          <BrandMark compact />
        </a>
        <nav aria-label="Primary navigation">
          <a href="#campaigns">Campaigns</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#rewards">Rewards</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="connection-actions">
          <button className="header-contract" onClick={copyContract} aria-label="Copy POA contract address">
            <span>CA</span>
            <b>{`${CONTRACT_ADDRESS.slice(0, 4)}…${CONTRACT_ADDRESS.slice(-4)}`}</b>
            <i>{notice === "Contract address copied." ? "COPIED" : "COPY"}</i>
          </button>
          <a
            className="header-x-link"
            href={X_ACCOUNT_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Open Proof of Attention on X"
          >
            X <span>/ @POA_SOLANA</span>
          </a>
          <button className="connect-x-button" onClick={() => requestConnection("X")}>Connect X</button>
          <button className="button-primary button-small" onClick={() => requestConnection("Wallet")}>Connect Wallet</button>
        </div>
      </header>

      <div className="status-rail" aria-label="Protocol status">
        <span><i className={syncState === "ready" ? "status-live" : ""} /> POA PROTOCOL</span>
        <span>NETWORK / SOLANA</span>
        <span>DATA / {syncState.toUpperCase()}</span>
        <span className="status-rail-end">PROOF OVER NOISE</span>
      </div>

      <section className="protocol-hero" id="top">
        <div className="hero-primary">
          <BrandMark />
          <span className="section-label">PROOF OF ATTENTION / 001</span>
          <h1>Proof of Attention</h1>
          <h2>Turn attention into proof.</h2>
          <p>
            Projects fund campaigns.<br />
            Creators generate attention.<br />
            Rewards go to the people moving the timeline.
          </p>
          <div className="hero-actions">
            <button className="button-primary" onClick={() => setShowLaunch(true)}>Launch Campaign</button>
            <a className="button-secondary" href="#campaigns">Browse Campaigns</a>
          </div>
        </div>

        <aside className="live-module" aria-label="Live protocol data">
          <div className="module-heading">
            <span><i className={syncState === "ready" ? "status-live" : ""} /> LIVE STATUS</span>
            <button onClick={() => void loadProtocolData()} disabled={syncState === "loading"}>REFRESH</button>
          </div>
          <div className="module-status">
            <span>{syncState === "ready" ? "PROTOCOL INDEX ONLINE" : "AWAITING PROTOCOL DATA"}</span>
            <b>{syncState === "ready" ? "SYNCED" : "—"}</b>
          </div>
          <dl>
            <div><dt>Active campaigns</dt><dd>{showValue(protocolStats.activeCampaigns)}</dd></div>
            <div><dt>Public submissions</dt><dd>{showValue(protocolStats.submissions)}</dd></div>
            <div><dt>Verified attention</dt><dd>{showValue(protocolStats.totalAttention)}</dd></div>
            <div><dt>Ranked creators</dt><dd>{showValue(protocolStats.creators)}</dd></div>
          </dl>
          <div className="module-foot">
            <span>SOURCE / SUPABASE</span>
            <span>NO MOCK DATA</span>
          </div>
        </aside>
      </section>

      <section className="protocol-stats" aria-label="Live protocol statistics">
        <article><span>01 / ACTIVE CAMPAIGNS</span><strong>{showValue(protocolStats.activeCampaigns)}</strong></article>
        <article><span>02 / VERIFIED ATTENTION</span><strong>{showValue(protocolStats.totalAttention)}</strong></article>
        <article><span>03 / RANKED CREATORS</span><strong>{showValue(protocolStats.creators)}</strong></article>
        <article><span>04 / CONFIRMED REWARDS</span><strong>{showValue(protocolStats.rewards)}</strong></article>
      </section>

      <section className="how-panel" id="how-it-works">
        <div className="section-head compact-head">
          <div><span className="section-label">PROTOCOL FLOW</span><h2>How it works</h2></div>
        </div>
        <div className="how-grid">
          {[
            ["01", "Projects launch campaigns."],
            ["02", "Creators submit content."],
            ["03", "POA measures verified performance."],
            ["04", "Rewards are distributed."],
          ].map(([number, copy]) => (
            <article key={number}><span>{number}</span><p>{copy}</p></article>
          ))}
        </div>
      </section>

      <section className="marketplace product-section" id="campaigns">
        <div className="section-head">
          <div><span className="section-label">MARKETPLACE / LIVE PROTOCOL DATA</span><h2>Campaigns</h2></div>
          <button className="button-primary" onClick={() => setShowLaunch(true)}>Launch Campaign</button>
        </div>
        <div className="filter-bar" role="group" aria-label="Campaign filters">
          {(["all", "live", "upcoming", "closed"] as const).map((item) => (
            <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>
              {item}
            </button>
          ))}
          <span>{syncState === "ready" ? `${visibleCampaigns.length} RESULTS` : "— RESULTS"}</span>
        </div>

        {syncState === "loading" ? (
          <EmptyState code="SYNC" title="Loading campaigns" body="Reading the latest public protocol state." />
        ) : visibleCampaigns.length === 0 ? (
          <EmptyState code="000" title="No campaigns available" body={dataEmptyBody} />
        ) : (
          <div className="campaign-list">
            <div className="campaign-row campaign-labels" aria-hidden="true">
              <span>CAMPAIGN</span><span>REWARD POOL</span><span>STATUS</span><span>TIME</span><span>ENTRIES</span><span>ATTENTION</span><span />
            </div>
            {visibleCampaigns.map((campaign) => (
              <article className="campaign-row" key={campaign.id}>
                <div className="campaign-identity">
                  <span className="campaign-token">{campaign.ticker.slice(0, 2)}</span>
                  <div><strong>{campaign.name}</strong><small>${campaign.ticker}</small></div>
                </div>
                <b>{rewardLabel(campaign)}</b>
                <span className={`status-tag status-tag--${campaign.status}`}><i /> {campaign.status}</span>
                <span className="display-value countdown">{formatCountdown(campaign.ends_at, now)}</span>
                <span className="display-value">{formatCompact(campaignActivity.entries.get(campaign.id) ?? 0)}</span>
                <span className="display-value">{formatCompact(campaignActivity.attention.get(campaign.id) ?? 0)}</span>
                <button className="row-action" onClick={() => setSelectedCampaign(campaign)}>View Campaign</button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="product-section table-section" id="leaderboard">
        <div className="section-head">
          <div><span className="section-label">VERIFIED RANKINGS</span><h2>Leaderboard</h2></div>
          <span className="section-meta">ATTENTION SCORE / HOLDER PROOF</span>
        </div>
        {syncState === "loading" ? (
          <EmptyState code="SYNC" title="Loading rankings" body="Reading the current leaderboard." />
        ) : data.leaderboard.length === 0 ? (
          <EmptyState code="000" title="No rankings yet" body={dataEmptyBody} />
        ) : (
          <div className="data-table leaderboard-table" role="table" aria-label="Attention leaderboard">
            <div className="table-row table-labels" role="row">
              <span>RANK / CREATOR</span><span>ATTENTION SCORE</span><span>CAMPAIGN</span><span>VERIFIED ATTENTION</span><span>EST. REWARD</span>
            </div>
            {data.leaderboard.map((row) => {
              const campaign = campaignById.get(row.campaign_id);
              const metric = latestMetricBySubmission.get(row.submission_id);
              const payout = payoutBySubmission.get(row.submission_id);
              return (
                <div className="table-row" role="row" key={row.submission_id}>
                  <div className="creator-cell"><b>#{row.rank.toString().padStart(2, "0")}</b><span>{row.x_display_name || `@${row.x_username}`}<small>@{row.x_username}</small></span></div>
                  <strong className="display-value">{formatCompact(Number(row.attention_score || 0))}</strong>
                  <span>{campaign?.name ?? "—"}</span>
                  <span className="display-value">{metric ? formatCompact(metric.impression_count) : "—"}</span>
                  <span>{payout ? payoutLabel(payout, campaign) : "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="product-section table-section" id="rewards">
        <div className="section-head">
          <div><span className="section-label">ONCHAIN HISTORY</span><h2>Recent rewards</h2></div>
          <span className="section-meta">CONFIRMED PAYOUTS ONLY</span>
        </div>
        {syncState === "loading" ? (
          <EmptyState code="SYNC" title="Loading rewards" body="Reading confirmed payout history." />
        ) : data.payouts.length === 0 ? (
          <EmptyState code="000" title="No rewards distributed" body={dataEmptyBody} />
        ) : (
          <div className="data-table rewards-table" role="table" aria-label="Recent protocol rewards">
            <div className="table-row table-labels" role="row">
              <span>CREATOR</span><span>CAMPAIGN</span><span>REWARD</span><span>TIMESTAMP</span>
            </div>
            {data.payouts.map((payout) => {
              const campaign = campaignById.get(payout.campaign_id);
              const account = accountByUser.get(payout.user_id);
              return (
                <div className="table-row" role="row" key={payout.id}>
                  <strong>{account ? `@${account.username}` : "—"}</strong>
                  <span>{campaign?.name ?? "—"}</span>
                  <span className="reward-value">{payoutLabel(payout, campaign)}</span>
                  <time dateTime={payout.confirmed_at}>{formatDate(payout.confirmed_at)}</time>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="faq-section product-section" id="faq">
        <div className="section-head">
          <div><span className="section-label">PROTOCOL REFERENCE</span><h2>FAQ</h2></div>
        </div>
        <div className="faq-list">
          <details><summary>Who can participate?<span>+</span></summary><p>An eligible X account needs at least 25 followers and three months of history. The connected Solana wallet must be at least seven days old.</p></details>
          <details><summary>What determines Attention Score?<span>+</span></summary><p>POA uses verified post performance and the campaign&apos;s configured holder proof. The active formula version and score components are recorded with each snapshot.</p></details>
          <details><summary>How are campaigns funded?<span>+</span></summary><p>Projects define the duration and reward asset, then fund the campaign before it moves into the live marketplace.</p></details>
          <details><summary>When are rewards distributed?<span>+</span></summary><p>Winning submissions pass the configured review process before confirmed payouts appear in the public reward history.</p></details>
        </div>
      </section>

      <footer>
        <BrandMark compact />
        <p>Turn attention into proof.</p>
        <div><a href="#campaigns">Campaigns</a><a href="#leaderboard">Leaderboard</a><a href="#faq">FAQ</a></div>
        <small>© 2026 PROOF OF ATTENTION / SOLANA</small>
      </footer>

      {(selectedCampaign || showLaunch) && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label={selectedCampaign ? selectedCampaign.name : "Launch campaign"}>
          <button className="modal-backdrop" onClick={() => { setSelectedCampaign(null); setShowLaunch(false); }} aria-label="Close dialog" />
          <div className="protocol-modal">
            <button className="modal-close" onClick={() => { setSelectedCampaign(null); setShowLaunch(false); }} aria-label="Close dialog">×</button>
            {selectedCampaign ? (
              <>
                <span className="section-label">CAMPAIGN / {selectedCampaign.status.toUpperCase()}</span>
                <div className="modal-title-row"><span className="campaign-token">{selectedCampaign.ticker.slice(0, 2)}</span><div><h2>{selectedCampaign.name}</h2><p>${selectedCampaign.ticker}</p></div></div>
                <dl className="modal-data">
                  <div><dt>Reward pool</dt><dd>{rewardLabel(selectedCampaign)}</dd></div>
                  <div><dt>Time remaining</dt><dd className="countdown">{formatCountdown(selectedCampaign.ends_at, now)}</dd></div>
                  <div><dt>Entries</dt><dd>{formatCompact(campaignActivity.entries.get(selectedCampaign.id) ?? 0)}</dd></div>
                  <div><dt>Verified attention</dt><dd>{formatCompact(campaignActivity.attention.get(selectedCampaign.id) ?? 0)}</dd></div>
                </dl>
                <button className="button-primary button-wide" onClick={() => requestConnection("X")}>Connect to Enter</button>
              </>
            ) : (
              <>
                <span className="section-label">PROJECT ACCESS</span>
                <h2>Launch a campaign</h2>
                <p className="modal-copy">Connect an eligible X account and Solana wallet to continue. Campaigns must be funded before they can enter the marketplace.</p>
                <div className="modal-actions">
                  <button className="button-secondary" onClick={() => requestConnection("X")}>Connect X</button>
                  <button className="button-primary" onClick={() => requestConnection("Wallet")}>Connect Wallet</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {notice && <div className="notice" role="status"><i />{notice}</div>}
    </main>
  );
}
