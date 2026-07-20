export function calculateAttentionScore(input: {
  impressions: number;
  likes: number;
  reposts: number;
  replies: number;
  quotes: number;
  followers: number;
  smartFollowerScore: number;
  balanceRaw: bigint;
  minimumBalanceRaw: bigint;
  holdStartedAt: string | null;
  soldDuringCampaign: boolean;
  sellPenaltyBps: number;
}) {
  const baseAttention = Math.max(0,
    input.impressions
      + input.likes * 20
      + input.reposts * 40
      + input.replies * 30
      + input.quotes * 50,
  );
  const interactions = input.likes + input.reposts + input.replies + input.quotes;
  const engagementRate = input.impressions > 0 ? interactions / input.impressions : 0;
  const engagementQualityMultiplier = Math.min(1.5, Math.max(0.75, 1 + engagementRate * 8));
  const followerReach = Math.min(0.25, Math.log10(Math.max(1, input.followers)) / 24);
  const followerQuality = Math.min(0.25, Math.max(0, input.smartFollowerScore) * 0.25);
  const socialMultiplier = Math.min(2, engagementQualityMultiplier + followerReach + followerQuality);
  const balanceRatio = input.minimumBalanceRaw > BigInt(0)
    ? Number(input.balanceRaw) / Number(input.minimumBalanceRaw)
    : 1;
  const balanceBonus = Math.min(0.25, Math.max(0, Math.log10(Math.max(1, balanceRatio)) * 0.1));
  const holdDays = input.holdStartedAt
    ? Math.max(0, (Date.now() - new Date(input.holdStartedAt).getTime()) / 86_400_000)
    : 0;
  const holdBonus = Math.min(0.25, holdDays / 120);
  const holderMultiplier = Math.min(1.5, 1 + balanceBonus + holdBonus);
  const retentionMultiplier = input.soldDuringCampaign
    ? Math.max(0, Math.min(1, input.sellPenaltyBps / 10_000))
    : 1;
  const totalScore = baseAttention * socialMultiplier * holderMultiplier * retentionMultiplier;

  return {
    baseAttention,
    engagementQualityMultiplier: socialMultiplier,
    holderMultiplier,
    retentionMultiplier,
    totalScore,
    components: {
      impressions: input.impressions,
      interactions,
      engagement_rate: engagementRate,
      followers: input.followers,
      smart_follower_score: input.smartFollowerScore,
      balance_raw: input.balanceRaw.toString(),
      balance_ratio: balanceRatio,
      hold_days: holdDays,
      sold_during_campaign: input.soldDuringCampaign,
      retention_multiplier: retentionMultiplier,
    },
  };
}
