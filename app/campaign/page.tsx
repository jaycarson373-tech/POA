import type { Metadata } from "next";
import { Suspense } from "react";
import CampaignDashboard from "./campaign-dashboard";

export const metadata: Metadata = {
  title: "Campaign Dashboard — Proof of Attention",
  description: "Live campaign performance, verified attention, holder proof, rankings, and confirmed rewards.",
};

export default function CampaignPage() {
  return (
    <Suspense
      fallback={(
        <main className="campaign-dashboard-page">
          <div className="campaign-dashboard-loading">SYNCHRONIZING CAMPAIGN DATA…</div>
        </main>
      )}
    >
      <CampaignDashboard />
    </Suspense>
  );
}
