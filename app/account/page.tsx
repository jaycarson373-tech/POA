"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { SolanaSignMessage, type SolanaSignMessageFeature } from "@solana/wallet-standard-features";
import { RAILWAY_API_URL } from "../public-config";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const API_URL = RAILWAY_API_URL;

type Identity = {
  xAccount: { username: string; followers_count: number; eligibility_status: string } | null;
  wallet: { address: string; eligibility_status: string; eligibility_reason?: string | null } | null;
  is_admin: boolean;
};

function solanaAccount(account: WalletAccount) {
  return account.chains.some((chain) => chain.startsWith("solana:"));
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

export default function AccountPage() {
  const supabase = useMemo(() => SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null, []);
  const [session, setSession] = useState<Session | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const api = useCallback(async (path: string, init?: RequestInit) => {
    if (!API_URL) throw new Error("Railway API URL is not configured");
    if (!session?.access_token) throw new Error("Connect X first");
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(String(result.error || `Request failed (${response.status})`));
    return result;
  }, [session]);

  const refresh = useCallback(async () => {
    if (!session) return;
    const result = await api("/v1/me");
    setIdentity(result as unknown as Identity);
  }, [api, session]);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    const registry = getWallets();
    const update = () => setWallets(registry.get().filter((wallet) =>
      wallet.chains.some((chain) => chain.startsWith("solana:"))
      && StandardConnect in wallet.features
      && SolanaSignMessage in wallet.features,
    ));
    update();
    const offRegister = registry.on("register", update);
    const offUnregister = registry.on("unregister", update);
    return () => { offRegister(); offUnregister(); };
  }, []);

  useEffect(() => {
    if (!session) {
      const timeout = window.setTimeout(() => setIdentity(null), 0);
      return () => window.clearTimeout(timeout);
    }
    const sync = async () => {
      try {
        if (session.provider_token) {
          await api("/v1/auth/x/sync", {
            method: "POST",
            body: JSON.stringify({
              access_token: session.provider_token,
              refresh_token: session.provider_refresh_token,
              expires_in: session.expires_in,
              scope: "tweet.read users.read follows.read offline.access",
            }),
          });
        }
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not synchronize X");
      }
    };
    const timeout = window.setTimeout(() => void sync(), 0);
    return () => window.clearTimeout(timeout);
  }, [api, refresh, session]);

  const connectX = async () => {
    if (!supabase) return setMessage("Supabase is not configured");
    setBusy("x");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "x",
      options: {
        redirectTo: `${window.location.origin}/account`,
        scopes: "tweet.read users.read follows.read offline.access",
      },
    });
    if (error) {
      setMessage(error.message);
      setBusy("");
    }
  };

  const verifyWallet = async (wallet: Wallet) => {
    setBusy(wallet.name);
    setMessage("");
    try {
      const connect = wallet.features[StandardConnect] as StandardConnectFeature[typeof StandardConnect];
      const { accounts } = await connect.connect();
      const account = accounts.find(solanaAccount);
      if (!account) throw new Error("No Solana account was returned");
      const challenge = await api("/v1/wallet/challenge", {
        method: "POST",
        body: JSON.stringify({ address: account.address }),
      }) as { challenge_id: string; message: string };
      const sign = wallet.features[SolanaSignMessage] as SolanaSignMessageFeature[typeof SolanaSignMessage];
      const [signed] = await sign.signMessage({ account, message: new TextEncoder().encode(challenge.message) });
      await api("/v1/wallet/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_id: challenge.challenge_id, signature: base64(signed.signature) }),
      });
      await refresh();
      setMessage("Wallet ownership verified on the POA worker.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet verification failed");
    } finally {
      setBusy("");
    }
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setIdentity(null);
    setMessage("X disconnected.");
  };

  return (
    <main className="utility-page">
      <header className="protocol-header">
        <Link className="protocol-brand utility-brand" href="/">PROOF OF ATTENTION</Link>
        <nav><Link href="/campaign/">Campaigns</Link><Link href="/apply/">Launch campaign</Link></nav>
        <Link className="button-secondary button-small" href="/">Back</Link>
      </header>
      <div className="status-rail"><span><i className={session ? "status-live" : ""} /> IDENTITY CONTROL</span><span>X + SOLANA</span><span className="status-rail-end">SIGNED PROOF ONLY</span></div>

      <section className="utility-shell">
        <div className="section-head"><div><span className="section-label">ACCOUNT / ELIGIBILITY</span><h1>Connect identity</h1></div></div>
        {!API_URL && <div className="utility-alert">NEXT_PUBLIC_RAILWAY_API_URL is missing on this deployment.</div>}
        <div className="utility-grid">
          <article className="utility-card">
            <span className="section-label">01 / X ACCOUNT</span>
            <h2>{identity?.xAccount ? `@${identity.xAccount.username}` : "Connect X"}</h2>
            <p>Requires at least 25 followers and an account age of 90 days. X author identity and qualifying posts are verified server-side.</p>
            {identity?.xAccount && <dl><div><dt>Followers</dt><dd>{identity.xAccount.followers_count}</dd></div><div><dt>Status</dt><dd>{identity.xAccount.eligibility_status}</dd></div></dl>}
            <button className="button-primary" onClick={() => void (session ? signOut() : connectX())} disabled={busy === "x"}>
              {session ? "Disconnect X" : busy === "x" ? "Redirecting…" : "Connect X"}
            </button>
          </article>
          <article className="utility-card">
            <span className="section-label">02 / VERIFIED WALLET</span>
            <h2>{identity?.wallet ? `${identity.wallet.address.slice(0, 5)}…${identity.wallet.address.slice(-5)}` : "Sign ownership"}</h2>
            <p>The signed message cannot move funds. Reward eligibility requires a Solana wallet with at least seven days of transaction history.</p>
            {identity?.wallet && <dl><div><dt>Status</dt><dd>{identity.wallet.eligibility_status}</dd></div><div><dt>Reason</dt><dd>{identity.wallet.eligibility_reason || "Eligible"}</dd></div></dl>}
            {!session ? <span className="identity-lock">Connect X first</span> : wallets.length === 0 ? <span className="identity-lock">No sign-message wallet detected</span> : (
              <div className="utility-wallets">{wallets.map((wallet) => <button key={wallet.name} onClick={() => void verifyWallet(wallet)} disabled={Boolean(busy)}>{busy === wallet.name ? "Signing…" : `Verify ${wallet.name}`}</button>)}</div>
            )}
          </article>
        </div>
        {message && <div className="utility-alert" role="status">{message}</div>}
        <div className="utility-actions"><Link className="button-primary" href="/campaign/">Open campaigns</Link><Link className="button-secondary" href="/apply/">Apply to launch</Link>{identity?.is_admin && <Link className="button-secondary" href="/admin/">Admin review</Link>}</div>
      </section>
    </main>
  );
}
