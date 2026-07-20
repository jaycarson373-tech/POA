"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Campaign = {
  id: number;
  name: string;
  ticker: string;
  glyph: string;
  color: string;
  soft: string;
  prize: string;
  prizeTicker: string;
  ends: string;
  duration: string;
  submissions: number;
  participants: number;
  topScore: string;
  holderBonus: string;
  description: string;
  status: "Live" | "Upcoming";
  tag: string;
};

const campaigns: Campaign[] = [
  {
    id: 1,
    name: "BONK Attention Sprint",
    ticker: "BONK",
    glyph: "B",
    color: "#f8fbff",
    soft: "#164ee8",
    prize: "250M",
    prizeTicker: "$BONK",
    ends: "18:42:09",
    duration: "48 hours",
    submissions: 186,
    participants: 142,
    topScore: "91.8K",
    holderBonus: "+20%",
    description:
      "Create an original post about BONK, its community, or something only the BONK timeline would understand.",
    status: "Live",
    tag: "Community",
  },
  {
    id: 2,
    name: "Jupiter Everywhere",
    ticker: "JUP",
    glyph: "J",
    color: "#8fc2ff",
    soft: "#071d5c",
    prize: "75K",
    prizeTicker: "$JUP",
    ends: "31:06:44",
    duration: "72 hours",
    submissions: 91,
    participants: 74,
    topScore: "68.2K",
    holderBonus: "+15%",
    description:
      "Show the timeline how Jupiter makes Solana feel connected. Memes, product takes, and original threads all count.",
    status: "Live",
    tag: "Product",
  },
  {
    id: 3,
    name: "SOL Summer Signal",
    ticker: "SOL",
    glyph: "S",
    color: "#ffffff",
    soft: "#285fff",
    prize: "120",
    prizeTicker: "SOL",
    ends: "06:21:18",
    duration: "24 hours",
    submissions: 248,
    participants: 201,
    topScore: "142K",
    holderBonus: "+10%",
    description:
      "Make one post that captures why the next wave of internet culture is happening on Solana.",
    status: "Live",
    tag: "Ecosystem",
  },
  {
    id: 4,
    name: "WIF Meme Marathon",
    ticker: "WIF",
    glyph: "W",
    color: "#a8ccff",
    soft: "#0c286f",
    prize: "500K",
    prizeTicker: "$WIF",
    ends: "Starts tomorrow",
    duration: "48 hours",
    submissions: 0,
    participants: 318,
    topScore: "—",
    holderBonus: "+25%",
    description:
      "The hat stays on. Bring your sharpest original WIF post and compete for a share of the pool.",
    status: "Upcoming",
    tag: "Memes",
  },
];

const leaders = [
  { rank: 1, handle: "@solmason", avatar: "SM", score: "91,842", views: "487K", bonus: "+20%", prize: "62.5M" },
  { rank: 2, handle: "@ponzibonk", avatar: "PB", score: "74,390", views: "392K", bonus: "+20%", prize: "40M" },
  { rank: 3, handle: "@jpegsandsol", avatar: "JS", score: "69,104", views: "355K", bonus: "+12%", prize: "30M" },
  { rank: 4, handle: "@meowterminal", avatar: "MT", score: "55,882", views: "301K", bonus: "+20%", prize: "22.5M" },
  { rank: 5, handle: "@chainkay", avatar: "CK", score: "44,210", views: "228K", bonus: "—", prize: "17.5M" },
];

const scoreParts = [
  { label: "Qualified views", value: "61.4K", note: "Unique, quality-weighted impressions" },
  { label: "Engagement", value: "18.7K", note: "Replies, reposts, likes, and bookmarks" },
  { label: "Holder proof", value: "+20%", note: "Time-weighted onchain bonus" },
];

function TokenMark({ campaign, small = false }: { campaign: Campaign; small?: boolean }) {
  return (
    <span
      className={`token-mark${small ? " token-mark--small" : ""}`}
      style={{ background: campaign.soft, color: campaign.color }}
      aria-hidden="true"
    >
      {campaign.glyph}
    </span>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="close-button" onClick={onClick} aria-label="Close dialog">
      ×
    </button>
  );
}

export default function Home() {
  const [xConnected, setXConnected] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All campaigns");
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [toast, setToast] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const fullyConnected = xConnected && walletConnected;
  const visibleCampaigns = useMemo(() => {
    if (activeFilter === "All campaigns") return campaigns;
    if (activeFilter === "Ending soon") return campaigns.filter((campaign) => campaign.id === 3 || campaign.id === 1);
    if (activeFilter === "SOL rewards") return campaigns.filter((campaign) => campaign.prizeTicker === "SOL");
    return campaigns.filter((campaign) => campaign.holderBonus !== "—");
  }, [activeFilter]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedCampaign(null);
        setShowSubmit(false);
        setShowCreate(false);
        setShowProfile(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const connectX = () => {
    setXConnected(true);
    setToast("X account verified — 4 years old · 12.8K followers");
  };

  const connectWallet = () => {
    setWalletConnected(true);
    setToast("Wallet connected — active for 2 years");
  };

  const openSubmission = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    if (!fullyConnected) {
      setToast("Connect X and your wallet before submitting");
      return;
    }
    setShowSubmit(true);
  };

  const handleSubmission = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setToast("Post submitted — attention tracking is now live");
    window.setTimeout(() => setShowSubmit(false), 900);
  };

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setShowCreate(false);
    setToast("Campaign draft created — funding is the final step");
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Proof of Attention home">
          <img className="brand-logo" src="poa-logo.jpg" alt="" />
          <span className="brand-name"><b>POA</b> proof of attention</span>
        </a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#campaigns">Campaigns</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="header-actions">
          <button className="text-button create-desktop" onClick={() => setShowCreate(true)}>
            + Create campaign
          </button>
          {fullyConnected ? (
            <button className="profile-pill" onClick={() => setShowProfile(true)}>
              <span className="status-dot" /> @matthew <span className="wallet-mini">7x…POA</span>
            </button>
          ) : (
            <button className="button button--dark button--compact" onClick={xConnected ? connectWallet : connectX}>
              {xConnected ? "Connect wallet" : "Connect X + wallet"}
            </button>
          )}
        </div>
      </header>

      <section className="brand-banner" aria-label="POA — Proof of Attention">
        <img src="poa-banner.jpg" alt="POA electric blue Proof of Attention banner" />
        <span>PROOF OF ATTENTION · THE ATTENTION MARKET</span>
      </section>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span /> THE ATTENTION MARKET IS OPEN</div>
          <h1>Attention is<br />the <em>economy.</em></h1>
          <p className="hero-lede">
            Turn posts into proof. Compete for token-funded rewards based on real reach, quality engagement, and what you hold onchain.
          </p>
          <div className="hero-actions">
            <a className="button button--acid" href="#campaigns">Explore live campaigns <span>↗</span></a>
            <button className="button button--ghost" onClick={() => setShowCreate(true)}>Launch a campaign</button>
          </div>
          <div className="trust-row">
            <span><b>01</b> Connect X</span>
            <i>→</i>
            <span><b>02</b> Connect wallet</span>
            <i>→</i>
            <span><b>03</b> Post &amp; earn</span>
          </div>
        </div>

        <div className="signal-card" aria-label="Live campaign example">
          <div className="signal-grid" aria-hidden="true" />
          <div className="signal-topline">
            <span className="live-pill"><i /> LIVE SIGNAL</span>
            <span className="mono">18:42:09 LEFT</span>
          </div>
          <div className="signal-campaign">
            <TokenMark campaign={campaigns[0]} />
            <div>
              <span className="micro-label">BONK ATTENTION SPRINT</span>
              <strong>250M <small>$BONK</small></strong>
            </div>
          </div>
          <div className="signal-divider" />
          <div className="signal-score-head">
            <span>YOUR ATTENTION SCORE</span>
            <span>PROJECTED RANK</span>
          </div>
          <div className="signal-score">
            <strong>72,488</strong>
            <span>#2</span>
          </div>
          <div className="sparkline" aria-label="Attention score trending upward">
            {[18, 24, 20, 34, 29, 42, 39, 55, 48, 61, 73, 67, 82, 78, 92].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="signal-footer">
            <span><i>↗</i> 487K verified views</span>
            <span className="bonus-chip">+20% HOLDER BOOST</span>
          </div>
        </div>
      </section>

      <section className="market-strip" aria-label="Platform activity">
        <div><strong>$184K</strong><span>LIVE REWARDS</span></div>
        <div><strong>12.8M</strong><span>VERIFIED VIEWS</span></div>
        <div><strong>1,240</strong><span>CREATORS EARNING</span></div>
        <div><strong>24</strong><span>ACTIVE CAMPAIGNS</span></div>
        <p>Proof, not promises. <span>Onchain rewards for real attention.</span></p>
      </section>

      <section className="campaign-section" id="campaigns">
        <div className="section-heading">
          <div>
            <span className="section-kicker">LIVE OPPORTUNITIES</span>
            <h2>Compete for attention.</h2>
          </div>
          <p>Pick a campaign. Make something worth noticing. The timeline decides the rest.</p>
        </div>
        <div className="filter-row" role="group" aria-label="Filter campaigns">
          {["All campaigns", "Ending soon", "SOL rewards", "Holder boost"].map((filter) => (
            <button
              className={activeFilter === filter ? "active" : ""}
              key={filter}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
          <span>{visibleCampaigns.length} campaigns</span>
        </div>

        <div className="campaign-grid">
          {visibleCampaigns.map((campaign) => (
            <article className="campaign-card" key={campaign.id}>
              <button className="card-hit-area" onClick={() => setSelectedCampaign(campaign)} aria-label={`Open ${campaign.name}`} />
              <div className="campaign-card-top">
                <TokenMark campaign={campaign} />
                <div className="campaign-title">
                  <span>{campaign.tag}</span>
                  <h3>{campaign.name}</h3>
                </div>
                <span className={`campaign-status ${campaign.status === "Upcoming" ? "upcoming" : ""}`}><i /> {campaign.status}</span>
              </div>
              <div className="reward-block">
                <span>REWARD POOL</span>
                <strong>{campaign.prize} <small>{campaign.prizeTicker}</small></strong>
              </div>
              <div className="campaign-stats">
                <div><span>ENDS IN</span><b className="mono">{campaign.ends}</b></div>
                <div><span>ENTRIES</span><b>{campaign.submissions}</b></div>
                <div><span>TOP SCORE</span><b>{campaign.topScore}</b></div>
              </div>
              <div className="campaign-card-footer">
                <span className="holder-tag">◈ {campaign.holderBonus} holder boost</span>
                <button onClick={() => setSelectedCampaign(campaign)}>{campaign.status === "Upcoming" ? "View campaign" : "Enter campaign"} <span>→</span></button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="leaderboard-section" id="leaderboard">
        <div className="leader-intro">
          <span className="section-kicker section-kicker--light">THE TOP OF THE TIMELINE</span>
          <h2>Real reach.<br /><em>Real rewards.</em></h2>
          <p>
            Rankings update as posts move through the timeline. Scores reward verified reach, meaningful engagement, and qualified holder time.
          </p>
          <div className="score-formula">
            <span>ATTENTION SCORE</span>
            <strong>reach × quality <i>+</i> holder proof</strong>
          </div>
          <a href="#how-it-works">See how scoring works <span>↗</span></a>
        </div>
        <div className="leaderboard-card">
          <div className="leaderboard-header">
            <div><TokenMark campaign={campaigns[0]} small /><span><b>BONK Attention Sprint</b><small>Live leaderboard</small></span></div>
            <span className="live-pill live-pill--dark"><i /> UPDATING LIVE</span>
          </div>
          <div className="leader-table" role="table" aria-label="BONK campaign leaderboard">
            <div className="leader-row leader-labels" role="row">
              <span># / CREATOR</span><span>VERIFIED VIEWS</span><span>SCORE</span><span>EST. REWARD</span>
            </div>
            {leaders.map((leader) => (
              <div className={`leader-row${leader.rank <= 3 ? " leader-row--top" : ""}`} role="row" key={leader.rank}>
                <div className="leader-person">
                  <strong>{leader.rank.toString().padStart(2, "0")}</strong>
                  <span className="avatar">{leader.avatar}</span>
                  <b>{leader.handle}</b>
                </div>
                <span>{leader.views}</span>
                <span><b>{leader.score}</b>{leader.bonus !== "—" && <small>{leader.bonus}</small>}</span>
                <span>{leader.prize} <small>$BONK</small></span>
              </div>
            ))}
          </div>
          <button className="table-action" onClick={() => setSelectedCampaign(campaigns[0])}>View full leaderboard <span>→</span></button>
        </div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-heading">
          <div><span className="section-kicker">HOW IT WORKS</span><h2>From post to payout.</h2></div>
          <p>Simple enough to use in a minute. Rigorous enough to reward actual attention.</p>
        </div>
        <div className="steps-grid">
          <article>
            <span className="step-number">01</span>
            <div className="step-icon">@</div>
            <h3>Prove who you are</h3>
            <p>Connect an X account with at least 25 followers and 3 months of history, plus a wallet older than 7 days.</p>
            <small>ONE ACCOUNT · ONE WALLET · ONE HUMAN</small>
          </article>
          <article>
            <span className="step-number">02</span>
            <div className="step-icon">↗</div>
            <h3>Post for a campaign</h3>
            <p>Choose a live token campaign, make an original post, then drop the X link before the campaign ends.</p>
            <small>24H · 48H · 72H CAMPAIGNS</small>
          </article>
          <article>
            <span className="step-number">03</span>
            <div className="step-icon">✦</div>
            <h3>Earn for attention</h3>
            <p>Real reach pushes you up the board. Holding the campaign token adds a transparent, time-weighted bonus.</p>
            <small>HUMAN REVIEW BEFORE EVERY PAYOUT</small>
          </article>
        </div>
        <div className="integrity-banner">
          <span className="shield">✓</span>
          <div><b>Proof over noise.</b><p>Every winning submission is manually reviewed for inorganic engagement, recycled posts, and coordinated bot activity before rewards unlock.</p></div>
          <span className="integrity-label">HUMAN VERIFIED</span>
        </div>
      </section>

      <section className="cta-section">
        <div>
          <span className="section-kicker">YOUR TIMELINE HAS VALUE</span>
          <h2>Get rewarded<br />for your attention <em>now.</em></h2>
        </div>
        <div className="cta-actions">
          <button className="button button--dark button--wide" onClick={xConnected ? connectWallet : connectX}>
            {fullyConnected ? "Explore campaigns" : xConnected ? "Connect wallet" : "Connect X + wallet"} <span>↗</span>
          </button>
          <p>No cost to enter. Rewards are funded upfront.</p>
        </div>
      </section>

      <footer>
        <a className="brand brand--footer" href="#top"><img className="brand-logo brand-logo--footer" src="poa-logo.jpg" alt="" /><span className="brand-name"><b>POA</b> proof of attention</span></a>
        <p>Attention belongs to the people who create it.</p>
        <div><a href="#campaigns">Campaigns</a><a href="#how-it-works">Scoring</a><button onClick={() => setShowCreate(true)}>Launch</button><a href="#top">X / Twitter ↗</a></div>
        <small>© 2026 POA · BUILT ON SOLANA</small>
      </footer>

      {selectedCampaign && !showSubmit && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label={`${selectedCampaign.name} details`}>
          <button className="modal-backdrop" onClick={() => setSelectedCampaign(null)} aria-label="Close campaign details" />
          <div className="campaign-drawer">
            <CloseButton onClick={() => setSelectedCampaign(null)} />
            <div className="drawer-head">
              <TokenMark campaign={selectedCampaign} />
              <span className="campaign-status"><i /> {selectedCampaign.status}</span>
              <span className="section-kicker">{selectedCampaign.tag.toUpperCase()} CAMPAIGN</span>
              <h2>{selectedCampaign.name}</h2>
              <p>{selectedCampaign.description}</p>
            </div>
            <div className="drawer-reward">
              <span>TOTAL REWARDS</span>
              <strong>{selectedCampaign.prize} <small>{selectedCampaign.prizeTicker}</small></strong>
              <i>Fully funded</i>
            </div>
            <div className="drawer-meta">
              <div><span>TIME LEFT</span><b className="mono">{selectedCampaign.ends}</b></div>
              <div><span>DURATION</span><b>{selectedCampaign.duration}</b></div>
              <div><span>CREATORS</span><b>{selectedCampaign.participants}</b></div>
            </div>
            <div className="drawer-rules">
              <span className="section-kicker">HOW TO QUALIFY</span>
              <ul>
                <li><i>01</i><span>Post original content on X during the live campaign.</span></li>
                <li><i>02</i><span>Mention ${selectedCampaign.ticker} and keep the post public.</span></li>
                <li><i>03</i><span>Submit one post. Winners pass a final human review.</span></li>
              </ul>
            </div>
            <div className="drawer-bonus">
              <span>◈</span><div><b>{selectedCampaign.holderBonus} holder boost</b><p>Bonus is based on token balance and time held during the campaign.</p></div>
            </div>
            <button className="button button--acid button--wide" onClick={() => openSubmission(selectedCampaign)} disabled={selectedCampaign.status === "Upcoming"}>
              {selectedCampaign.status === "Upcoming" ? "Campaign opens tomorrow" : fullyConnected ? "Submit your post" : "Connect to enter"} <span>↗</span>
            </button>
          </div>
        </div>
      )}

      {showSubmit && selectedCampaign && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Submit a post">
          <button className="modal-backdrop" onClick={() => setShowSubmit(false)} aria-label="Close submission form" />
          <form className="center-modal" onSubmit={handleSubmission}>
            <CloseButton onClick={() => setShowSubmit(false)} />
            <span className="section-kicker">ENTER CAMPAIGN</span>
            <h2>Submit your post.</h2>
            <div className="selected-campaign-mini"><TokenMark campaign={selectedCampaign} small /><b>{selectedCampaign.name}</b><span>{selectedCampaign.ends}</span></div>
            <label htmlFor="post-url">X post URL</label>
            <input id="post-url" type="url" required placeholder="https://x.com/you/status/…" />
            <div className="eligibility-checks">
              <span><i>✓</i> X account: eligible</span>
              <span><i>✓</i> Wallet age: eligible</span>
              <span><i>✓</i> Holder proof: tracking</span>
            </div>
            <p className="form-note">By submitting, you confirm this is your original post and agree to a manual authenticity review before payout.</p>
            <button className="button button--dark button--wide" type="submit">{submitted ? "Post submitted ✓" : "Start attention tracking"}</button>
          </form>
        </div>
      )}

      {showCreate && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Create a campaign">
          <button className="modal-backdrop" onClick={() => setShowCreate(false)} aria-label="Close campaign creation form" />
          <form className="center-modal create-modal" onSubmit={handleCreate}>
            <CloseButton onClick={() => setShowCreate(false)} />
            <span className="section-kicker">FUND ATTENTION</span>
            <h2>Launch a campaign.</h2>
            <p className="modal-lede">Set the signal, fund the reward pool, and let creators compete for real reach.</p>
            <div className="form-split">
              <label>Campaign name<input required placeholder="e.g. The BONK Attention Sprint" /></label>
              <label>Token ticker<input required placeholder="$TOKEN" /></label>
            </div>
            <label>What should creators post about?<textarea required placeholder="Give the timeline one clear creative direction…" /></label>
            <div className="form-split">
              <label>Reward amount<input required type="number" min="1" placeholder="100,000" /></label>
              <label>Funding asset<select defaultValue="Token"><option>Token</option><option>SOL</option></select></label>
            </div>
            <fieldset>
              <legend>Campaign length</legend>
              <div className="duration-picker"><label><input type="radio" name="duration" value="24" />24 hours</label><label><input type="radio" name="duration" value="48" defaultChecked />48 hours</label><label><input type="radio" name="duration" value="72" />72 hours</label></div>
            </fieldset>
            <button className="button button--acid button--wide" type="submit">Continue to funding <span>→</span></button>
            <small className="funding-note">Campaigns go live only after the entire reward pool is funded onchain.</small>
          </form>
        </div>
      )}

      {showProfile && (
        <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Proof profile">
          <button className="modal-backdrop" onClick={() => setShowProfile(false)} aria-label="Close profile" />
          <div className="profile-popover">
            <CloseButton onClick={() => setShowProfile(false)} />
            <div className="profile-avatar">M</div>
            <span className="verified-label">✓ PROOF VERIFIED</span>
            <h3>@matthew</h3>
            <p>7xKd…POA9</p>
            <div className="profile-stats"><span><b>12.8K</b>followers</span><span><b>4.1 yrs</b>account age</span><span><b>2.0 yrs</b>wallet age</span></div>
            <div className="profile-score">
              <div><span>ALL-TIME ATTENTION</span><b>124,880</b></div>
              <span>TOP 8%</span>
            </div>
            <button className="button button--ghost button--wide" onClick={() => { setShowProfile(false); setToast("Connections refreshed"); }}>Refresh proof</button>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status"><i>✓</i>{toast}</div>}
    </main>
  );
}
