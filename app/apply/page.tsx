"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const API_URL = (process.env.NEXT_PUBLIC_RAILWAY_API_URL || "").replace(/\/$/, "");

type Application = {
  id: string;
  name: string;
  reward_kind: string;
  reward_mint: string | null;
  reward_amount_raw: string;
  collection_address: string;
  funding_status: string;
  public_status: string;
};

export default function ApplyPage() {
  const supabase = useMemo(() => SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null, []);
  const [session, setSession] = useState<Session | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [signature, setSignature] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const api = async (path: string, init: RequestInit) => {
    if (!session) throw new Error("Connect X and verify your wallet first");
    if (!API_URL) throw new Error("Railway API URL is not configured");
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    });
    const result = await response.json() as { error?: string; application?: Application };
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const values = new FormData(event.currentTarget);
    const rewardKind = String(values.get("reward_kind"));
    try {
      const result = await api("/v1/campaign-applications", {
        method: "POST",
        body: JSON.stringify({
          slug: values.get("slug"),
          name: values.get("name"),
          ticker: values.get("ticker"),
          token_mint: values.get("token_mint"),
          brief: values.get("brief"),
          required_terms: String(values.get("required_terms") || "").split(",").map((value) => value.trim()).filter(Boolean),
          reward_kind: rewardKind,
          reward_mint: rewardKind === "SPL" ? values.get("reward_mint") : undefined,
          reward_amount_raw: values.get("reward_amount_raw"),
          reward_decimals: Number(values.get("reward_decimals")),
          duration_hours: Number(values.get("duration_hours")),
          submission_limit: Number(values.get("submission_limit")),
          winner_count: Number(values.get("winner_count")),
          holder_bonus_max_bps: Number(values.get("holder_bonus_max_bps")),
          holder_min_balance_raw: values.get("holder_min_balance_raw"),
        }),
      });
      setApplication(result.application || null);
      setMessage("Application created. Fund the exact base-unit amount, then submit the transaction signature for on-chain verification.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Application failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmFunding = async () => {
    if (!application) return;
    setBusy(true);
    try {
      const result = await api(`/v1/campaign-applications/${application.id}/funding`, {
        method: "POST",
        body: JSON.stringify({ transaction_signature: signature }),
      });
      setApplication(result.application || application);
      setMessage("Funding confirmed on-chain. The POA team can now approve or deny the campaign.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Funding verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="utility-page">
      <header className="protocol-header"><Link className="protocol-brand utility-brand" href="/">PROOF OF ATTENTION</Link><nav><Link href="/campaign/">Campaigns</Link><Link href="/account/">Identity</Link></nav><Link className="button-secondary button-small" href="/">Back</Link></header>
      <div className="status-rail"><span><i /> CAMPAIGN INTAKE</span><span>TEAM VETTED</span><span className="status-rail-end">REAL FUNDING ONLY</span></div>
      <section className="utility-shell utility-shell--wide">
        <div className="section-head"><div><span className="section-label">PROJECT APPLICATION</span><h1>Launch campaign</h1></div><span className="section-meta">PENDING → FUNDED → REVIEWED → LIVE</span></div>
        {!session ? <div className="utility-alert">Connect X and verify your wallet on the <Link href="/account/">identity page</Link> before applying.</div> : null}
        {!application ? (
          <form className="protocol-form" onSubmit={submit}>
            <label>Name<input name="name" required maxLength={100} /></label>
            <label>URL slug<input name="slug" required placeholder="project-name" /></label>
            <label>Ticker<input name="ticker" required maxLength={15} placeholder="TOKEN" /></label>
            <label>Campaign token mint<input name="token_mint" required /></label>
            <label className="form-wide">Campaign brief<textarea name="brief" required rows={5} /></label>
            <label className="form-wide">Required post terms, comma separated<input name="required_terms" placeholder="$TOKEN, contract address" /></label>
            <label>Reward asset<select name="reward_kind" defaultValue="SOL"><option value="SOL">SOL</option><option value="SPL">SPL token</option></select></label>
            <label>Reward mint (SPL only)<input name="reward_mint" /></label>
            <label>Reward amount in base units<input name="reward_amount_raw" required inputMode="numeric" /></label>
            <label>Reward decimals<input name="reward_decimals" type="number" defaultValue="9" min="0" max="18" required /></label>
            <label>Duration<select name="duration_hours" defaultValue="24"><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option></select></label>
            <label>Winners<input name="winner_count" type="number" defaultValue="10" min="1" max="1000" required /></label>
            <label>Posts per creator<input name="submission_limit" type="number" defaultValue="1" min="1" max="10" required /></label>
            <label>Max holder bonus (bps)<input name="holder_bonus_max_bps" type="number" defaultValue="2000" min="0" max="10000" required /></label>
            <label>Minimum holding (base units)<input name="holder_min_balance_raw" defaultValue="0" inputMode="numeric" required /></label>
            <div className="form-submit form-wide"><p>Campaigns are not listed automatically. Funding is checked on-chain and the team must approve the application.</p><button className="button-primary" disabled={busy || !session}>{busy ? "Submitting…" : "Create application"}</button></div>
          </form>
        ) : (
          <div className="funding-panel">
            <span className="section-label">APPLICATION / {application.public_status}</span><h2>{application.name}</h2>
            <dl><div><dt>Send to</dt><dd>{application.collection_address}</dd></div><div><dt>Exact base units</dt><dd>{application.reward_amount_raw} {application.reward_kind}</dd></div>{application.reward_mint && <div><dt>Reward mint</dt><dd>{application.reward_mint}</dd></div>}<div><dt>Funding status</dt><dd>{application.funding_status}</dd></div></dl>
            <label>Funding transaction signature<input value={signature} onChange={(event) => setSignature(event.target.value)} /></label>
            <button className="button-primary" onClick={() => void confirmFunding()} disabled={busy || !signature.trim()}>{busy ? "Verifying…" : "Verify funding on-chain"}</button>
          </div>
        )}
        {message && <div className="utility-alert" role="status">{message}</div>}
      </section>
    </main>
  );
}
