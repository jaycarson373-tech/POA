"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import { RAILWAY_API_URL } from "../public-config";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const API_URL = RAILWAY_API_URL;

type Application = {
  id: string;
  name: string;
  ticker: string;
  token_mint: string;
  brief: string;
  reward_kind: string;
  reward_amount_raw: string;
  duration_hours: number;
  funding_status: string;
  funding_transaction_signature: string | null;
  public_status: string;
  published_campaign_id: string | null;
  created_at: string;
};

type Submission = {
  id: string;
  campaign_id: string;
  x_post_url: string;
  status: string;
  submitted_at: string;
};

export default function AdminPage() {
  const supabase = useMemo(() => SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null, []);
  const [session, setSession] = useState<Session | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!session || !API_URL) throw new Error("Admin session or Railway API is unavailable");
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    });
    const result = await response.json() as { error?: string; applications?: Application[]; submissions?: Submission[] };
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
    return result;
  }, [session]);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      const [applicationResult, submissionResult] = await Promise.all([
        api("/v1/admin/campaign-applications"),
        api("/v1/admin/submissions"),
      ]);
      setApplications(applicationResult.applications || []);
      setSubmissions(submissionResult.submissions || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load applications");
    }
  }, [api, session]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const review = async (application: Application, decision: "approve" | "deny", refund = false) => {
    const notes = window.prompt("Internal/public review notes (optional)", "") || "";
    setBusy(application.id);
    try {
      await api(`/v1/admin/campaign-applications/${application.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, refund, notes }),
      });
      setMessage(decision === "approve" ? "Campaign approved and published live." : refund ? "Campaign denied and refund processed or queued." : "Campaign denied.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review failed");
    } finally {
      setBusy("");
    }
  };

  const reviewSubmission = async (submission: Submission, decision: "approve" | "disqualify") => {
    const notes = window.prompt("Integrity review notes (optional)", "") || "";
    setBusy(submission.id);
    try {
      await api(`/v1/admin/submissions/${submission.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, notes }),
      });
      setMessage(decision === "approve" ? "Submission approved for rewards." : "Submission disqualified.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Submission review failed");
    } finally {
      setBusy("");
    }
  };

  const finalize = async (campaignId: string) => {
    if (!window.confirm("Finalize this ended campaign and send its funded reward pool to approved winners?")) return;
    setBusy(campaignId);
    try {
      await api(`/v1/admin/campaigns/${campaignId}/finalize`, { method: "POST", body: "{}" });
      setMessage("Campaign payout finalization completed. Check the public reward ledger for confirmations.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Campaign finalization failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="utility-page">
      <header className="protocol-header"><Link className="protocol-brand utility-brand" href="/">PROOF OF ATTENTION</Link><nav><Link href="/campaign/">Campaigns</Link><Link href="/account/">Identity</Link></nav><Link className="button-secondary button-small" href="/">Back</Link></header>
      <div className="status-rail"><span><i className="status-live" /> ADMIN CONTROL</span><span>VETTING QUEUE</span><span className="status-rail-end">AUTHORIZATION REQUIRED</span></div>
      <section className="utility-shell utility-shell--wide">
        <div className="section-head"><div><span className="section-label">CAMPAIGN REVIEW</span><h1>Applications</h1></div><button className="button-secondary button-small" onClick={() => void load()}>Refresh</button></div>
        {!session && <div className="utility-alert">Connect the X account that was added to public.admin_users.</div>}
        <div className="admin-list">
          {applications.length === 0 ? <div className="dashboard-empty"><span>[000]</span><div><strong>No applications</strong><p>No campaign applications are visible to this administrator.</p></div></div> : applications.map((application) => (
            <article key={application.id}>
              <div className="admin-card-head"><div><span className="section-label">{application.public_status} / {application.funding_status}</span><h2>{application.name} <small>${application.ticker}</small></h2></div><time>{new Date(application.created_at).toLocaleString()}</time></div>
              <p>{application.brief}</p>
              <dl><div><dt>Token mint</dt><dd>{application.token_mint}</dd></div><div><dt>Reward</dt><dd>{application.reward_amount_raw} {application.reward_kind}</dd></div><div><dt>Duration</dt><dd>{application.duration_hours}H</dd></div><div><dt>Funding signature</dt><dd>{application.funding_transaction_signature || "Not submitted"}</dd></div></dl>
              {application.public_status === "pending" && <div className="admin-actions"><button className="button-primary" onClick={() => void review(application, "approve")} disabled={busy === application.id || application.funding_status !== "confirmed"}>Approve + publish</button><button className="button-secondary" onClick={() => void review(application, "deny")} disabled={busy === application.id}>Deny</button><button className="button-secondary" onClick={() => void review(application, "deny", true)} disabled={busy === application.id || application.funding_status !== "confirmed"}>Deny + refund</button></div>}
              {application.public_status === "accepted" && application.published_campaign_id && <div className="admin-actions"><button className="button-primary" onClick={() => void finalize(application.published_campaign_id!)} disabled={busy === application.published_campaign_id}>Finalize ended campaign + pay winners</button></div>}
            </article>
          ))}
        </div>
        <div className="section-head admin-submission-heading"><div><span className="section-label">MANUAL INTEGRITY GATE</span><h1>Submissions</h1></div></div>
        <div className="admin-list">
          {submissions.length === 0 ? <div className="dashboard-empty"><span>[000]</span><div><strong>No submissions to review</strong><p>Tracked campaign posts will appear here.</p></div></div> : submissions.map((submission) => (
            <article key={submission.id}>
              <div className="admin-card-head"><div><span className="section-label">{submission.status} / {submission.campaign_id.slice(0, 8)}</span><h2>Campaign submission</h2></div><time>{new Date(submission.submitted_at).toLocaleString()}</time></div>
              <a className="admin-post-link" href={submission.x_post_url} target="_blank" rel="noreferrer">Open X post ↗</a>
              <div className="admin-actions"><button className="button-primary" onClick={() => void reviewSubmission(submission, "approve")} disabled={busy === submission.id}>Approve for rewards</button><button className="button-secondary" onClick={() => void reviewSubmission(submission, "disqualify")} disabled={busy === submission.id}>Disqualify</button></div>
            </article>
          ))}
        </div>
        {message && <div className="utility-alert" role="status">{message}</div>}
      </section>
    </main>
  );
}
