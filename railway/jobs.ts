import type { WorkerConfig } from "./config";
import { Database } from "./db";
import { calculateAttentionScore } from "./scoring";
import { SolanaService } from "./solana";
import { XService } from "./x";

type Campaign = { id: string; token_mint: string; status: string; review_status?: string };
type Submission = { id: string; campaign_id: string; user_id: string; wallet_id: string; x_post_id: string; status: string };
type Wallet = { id: string; user_id: string; address: string; first_transaction_at: string | null; verified_at: string | null };
type XAccount = { id: string; user_id: string; x_user_id: string; followers_count: number; smart_follower_score: string | null; eligibility_status: string };
type HolderPosition = {
  id: string;
  campaign_id: string;
  user_id: string;
  wallet_id: string;
  balance_raw: string;
  continuous_hold_started_at: string | null;
  sold_during_campaign: boolean;
  balance_decrease_count: number;
};
type LeaderboardRow = { submission_id: string; attention_score: string; rank: number };
type RewardEpoch = { id: string };
type RewardPayout = { id: string; submission_id: string };
type BuybackEpoch = { id: string };

export class ProtocolJobs {
  private scoringRunning = false;
  private rewardRunning = false;
  private followerRunning = false;
  private buybackRunning = false;

  constructor(
    private readonly config: WorkerConfig,
    private readonly db: Database,
    private readonly solana: SolanaService,
    private readonly x: XService,
  ) {}

  async scoreCycle() {
    if (this.scoringRunning) return;
    this.scoringRunning = true;
    try {
      const campaigns = await this.db.select<Campaign>(
        `campaigns?select=id,token_mint,status,review_status&token_mint=eq.${encodeURIComponent(this.config.poaMint)}&status=eq.live`,
      );
      for (const campaign of campaigns) await this.scoreCampaign(campaign);
    } finally {
      this.scoringRunning = false;
    }
  }

  private async scoreCampaign(campaign: Campaign) {
    const submissions = await this.db.select<Submission>(
      `submissions?select=id,campaign_id,user_id,wallet_id,x_post_id,status&campaign_id=eq.${campaign.id}&status=in.(tracking,approved,winner)`,
    );
    if (submissions.length === 0) return;
    const userIds = [...new Set(submissions.map((row) => row.user_id))].join(",");
    const walletIds = [...new Set(submissions.map((row) => row.wallet_id))].join(",");
    const [wallets, accounts, positions] = await Promise.all([
      this.db.select<Wallet>(`wallets?select=id,user_id,address,first_transaction_at,verified_at&id=in.(${walletIds})`),
      this.db.select<XAccount>(`x_accounts?select=id,user_id,x_user_id,followers_count,smart_follower_score,eligibility_status&user_id=in.(${userIds})`),
      this.db.select<HolderPosition>(`campaign_holder_positions?select=id,campaign_id,user_id,wallet_id,balance_raw,continuous_hold_started_at,sold_during_campaign,balance_decrease_count&campaign_id=eq.${campaign.id}`),
    ]);
    const walletById = new Map(wallets.map((row) => [row.id, row]));
    const accountByUser = new Map(accounts.map((row) => [row.user_id, row]));
    const positionByWallet = new Map(positions.map((row) => [row.wallet_id, row]));

    for (const submission of submissions) {
      const wallet = walletById.get(submission.wallet_id);
      const account = accountByUser.get(submission.user_id);
      if (!wallet || !account || !wallet.verified_at) continue;
      try {
        const [balance, tweet] = await Promise.all([
          this.solana.getTokenBalance(wallet.address, campaign.token_mint),
          this.x.tweet(submission.x_post_id),
        ]);
        const previous = positionByWallet.get(wallet.id);
        const previousBalance = BigInt(previous?.balance_raw || "0");
        const decreased = Boolean(previous) && balance < previousBalance;
        const eligibleNow = balance >= this.config.minimumHolderRaw;
        const continuousHoldStartedAt = eligibleNow
          ? previous?.continuous_hold_started_at || new Date().toISOString()
          : null;
        const position = (await this.db.upsert<HolderPosition>("campaign_holder_positions", {
          campaign_id: campaign.id,
          user_id: submission.user_id,
          wallet_id: wallet.id,
          token_mint: campaign.token_mint,
          balance_raw: balance.toString(),
          first_observed_balance_at: previous ? undefined : new Date().toISOString(),
          continuous_hold_started_at: continuousHoldStartedAt,
          eligible_since: continuousHoldStartedAt,
          sold_during_campaign: Boolean(previous?.sold_during_campaign || decreased),
          last_outflow_at: decreased ? new Date().toISOString() : undefined,
          balance_decrease_count: (previous?.balance_decrease_count || 0) + (decreased ? 1 : 0),
          last_verified_at: new Date().toISOString(),
        }, "campaign_id,wallet_id,token_mint"))[0];
        positionByWallet.set(wallet.id, position);

        const metrics = tweet.public_metrics || {
          impression_count: 0,
          like_count: 0,
          retweet_count: 0,
          reply_count: 0,
          quote_count: 0,
          bookmark_count: 0,
        };
        const capturedAt = new Date().toISOString();
        await this.db.insert("x_metric_snapshots", {
          submission_id: submission.id,
          captured_at: capturedAt,
          impression_count: metrics.impression_count || 0,
          organic_impression_count: null,
          like_count: metrics.like_count || 0,
          repost_count: metrics.retweet_count || 0,
          reply_count: metrics.reply_count || 0,
          quote_count: metrics.quote_count || 0,
          bookmark_count: metrics.bookmark_count || 0,
          fetch_status: "ok",
          raw_metrics: metrics,
        });
        const score = calculateAttentionScore({
          impressions: metrics.impression_count || 0,
          likes: metrics.like_count || 0,
          reposts: metrics.retweet_count || 0,
          replies: metrics.reply_count || 0,
          quotes: metrics.quote_count || 0,
          followers: account.followers_count,
          smartFollowerScore: Number(account.smart_follower_score || 0),
          balanceRaw: balance,
          minimumBalanceRaw: this.config.minimumHolderRaw,
          holdStartedAt: position.continuous_hold_started_at,
          soldDuringCampaign: position.sold_during_campaign,
          sellPenaltyBps: this.config.sellPenaltyBps,
        });
        await this.db.insert("score_snapshots", {
          submission_id: submission.id,
          captured_at: capturedAt,
          base_attention_score: score.baseAttention,
          engagement_quality_multiplier: score.engagementQualityMultiplier,
          holder_multiplier: score.holderMultiplier,
          total_score: score.totalScore,
          formula_version: "poa-v2",
          components: score.components,
        });
      } catch (error) {
        console.error("score_submission_failed", submission.id, error);
      }
    }
  }

  async followerQualityCycle() {
    if (this.followerRunning) return;
    this.followerRunning = true;
    try {
      const accounts = await this.db.select<XAccount>(
        "x_accounts?select=id,user_id,x_user_id,followers_count,smart_follower_score,eligibility_status&order=last_synced_at.asc.nullsfirst&limit=50",
      );
      for (const account of accounts) {
        try {
          const quality = await this.x.followerQuality(account.x_user_id);
          await this.db.insert("x_follower_quality_snapshots", {
            x_account_id: account.id,
            sampled_followers: quality.sampledFollowers,
            quality_followers: quality.qualityFollowers,
            smart_follower_score: quality.score,
            components: { heuristic: "age_90d_followers_25_tweets_10_ratio_v1" },
          });
          await this.db.update("x_accounts", `id=eq.${account.id}`, {
            smart_follower_score: quality.score,
            last_synced_at: new Date().toISOString(),
          });
        } catch (error) {
          console.error("follower_quality_failed", account.id, error);
        }
      }
    } finally {
      this.followerRunning = false;
    }
  }

  async rewardCycle() {
    if (this.rewardRunning || this.config.rewardMode === "disabled") return;
    this.rewardRunning = true;
    try {
      const campaigns = await this.db.select<Campaign>(
        `campaigns?select=id,token_mint,status,review_status&token_mint=eq.${encodeURIComponent(this.config.poaMint)}&status=eq.live&limit=1`,
      );
      if (campaigns[0]) await this.rewardCampaign(campaigns[0]);
    } finally {
      this.rewardRunning = false;
    }
  }

  private async rewardCampaign(campaign: Campaign) {
    if (this.config.rewardBudgetRaw <= BigInt(0)) throw new Error("POA_REWARD_EPOCH_AMOUNT_RAW must be set");
    const intervalMs = this.config.rewardIntervalSeconds * 1000;
    const epochStartMs = Math.floor(Date.now() / intervalMs) * intervalMs;
    const epochStart = new Date(epochStartMs).toISOString();
    const epochEnd = new Date(epochStartMs + intervalMs).toISOString();
    let epoch: RewardEpoch;
    try {
      [epoch] = await this.db.insert<RewardEpoch>("reward_epochs", {
        campaign_id: campaign.id,
        epoch_started_at: epochStart,
        epoch_ended_at: epochEnd,
        token_mint: campaign.token_mint,
        token_decimals: this.config.tokenDecimals,
        budget_raw: this.config.rewardBudgetRaw.toString(),
        minimum_balance_raw: this.config.minimumHolderRaw.toString(),
        mode: this.config.rewardMode,
        status: "processing",
      });
    } catch (error) {
      if (String(error).includes("409") || String(error).includes("duplicate")) return;
      throw error;
    }

    try {
      const leaderboard = await this.db.select<LeaderboardRow>(
        `campaign_leaderboard?select=submission_id,attention_score,rank&campaign_id=eq.${campaign.id}&order=rank.asc&limit=${this.config.rewardMaxRecipients * 3}`,
      );
      if (leaderboard.length === 0) {
        await this.finishEpoch(epoch.id, "skipped", 0, BigInt(0), "No ranked submissions");
        return;
      }
      const submissionIds = leaderboard.map((row) => row.submission_id).join(",");
      const submissions = await this.db.select<Submission>(
        `submissions?select=id,campaign_id,user_id,wallet_id,x_post_id,status&id=in.(${submissionIds})`,
      );
      const userIds = [...new Set(submissions.map((row) => row.user_id))].join(",");
      const walletIds = [...new Set(submissions.map((row) => row.wallet_id))].join(",");
      const [wallets, accounts, positions] = await Promise.all([
        this.db.select<Wallet>(`wallets?select=id,user_id,address,first_transaction_at,verified_at&id=in.(${walletIds})`),
        this.db.select<XAccount>(`x_accounts?select=id,user_id,x_user_id,followers_count,smart_follower_score,eligibility_status&user_id=in.(${userIds})`),
        this.db.select<HolderPosition>(`campaign_holder_positions?select=id,campaign_id,user_id,wallet_id,balance_raw,continuous_hold_started_at,sold_during_campaign,balance_decrease_count&campaign_id=eq.${campaign.id}&wallet_id=in.(${walletIds})`),
      ]);
      const submissionById = new Map(submissions.map((row) => [row.id, row]));
      const walletById = new Map(wallets.map((row) => [row.id, row]));
      const accountByUser = new Map(accounts.map((row) => [row.user_id, row]));
      const positionByWallet = new Map(positions.map((row) => [row.wallet_id, row]));
      const walletAgeCutoff = Date.now() - this.config.walletMinimumAgeDays * 86_400_000;
      const seenUsers = new Set<string>();
      const eligible = leaderboard.flatMap((row) => {
        const submission = submissionById.get(row.submission_id);
        if (!submission) return [];
        const wallet = walletById.get(submission.wallet_id);
        const account = accountByUser.get(submission.user_id);
        const position = positionByWallet.get(submission.wallet_id);
        const score = Number(row.attention_score);
        if (
          !wallet?.verified_at
          || !wallet.first_transaction_at
          || new Date(wallet.first_transaction_at).getTime() > walletAgeCutoff
          || account?.eligibility_status !== "eligible"
          || (submission.status !== "approved" && submission.status !== "winner")
          || !position?.continuous_hold_started_at
          || BigInt(position.balance_raw) < this.config.minimumHolderRaw
          || !Number.isFinite(score)
          || score <= 0
        ) return [];
        if (seenUsers.has(submission.user_id)) return [];
        seenUsers.add(submission.user_id);
        return [{ row, submission, wallet, score }];
      }).slice(0, this.config.rewardMaxRecipients);

      if (eligible.length === 0) {
        await this.finishEpoch(epoch.id, "skipped", 0, BigInt(0), "No verified 500K holders were eligible");
        return;
      }
      const totalScore = eligible.reduce((sum, item) => sum + item.score, 0);
      const weighted = eligible.map((item) => ({
        ...item,
        weight: BigInt(Math.max(1, Math.round(item.score * 1_000_000))),
      }));
      const totalWeight = weighted.reduce((sum, item) => sum + item.weight, BigInt(0));
      const provisional = weighted.map((item) => ({
        ...item,
        amount: (this.config.rewardBudgetRaw * item.weight) / totalWeight,
      }));
      const payable = provisional.filter((item) => item.amount >= this.config.rewardMinimumRaw);
      const payableWeight = payable.reduce((sum, item) => sum + item.weight, BigInt(0));
      let remaining = this.config.rewardBudgetRaw;
      const allocations = payable.map((item, index) => {
        const amount = index === payable.length - 1
          ? remaining
          : (this.config.rewardBudgetRaw * item.weight) / payableWeight;
        remaining -= amount;
        return { ...item, amount };
      });
      if (allocations.length === 0) {
        await this.finishEpoch(epoch.id, "skipped", 0, BigInt(0), "All proportional payouts were below the minimum");
        return;
      }

      await this.db.update("reward_epochs", `id=eq.${epoch.id}`, {
        eligible_creators: allocations.length,
        total_score: totalScore,
      });
      const payoutRows = await this.db.insert<RewardPayout>("reward_epoch_payouts", allocations.map((item) => ({
        epoch_id: epoch.id,
        campaign_id: campaign.id,
        submission_id: item.submission.id,
        user_id: item.submission.user_id,
        wallet_id: item.wallet.id,
        rank: item.row.rank,
        score: item.score,
        amount_raw: item.amount.toString(),
        token_mint: campaign.token_mint,
        wallet_address: item.wallet.address,
        status: this.config.rewardMode === "dry_run" ? "dry_run" : "queued",
      })));
      const payoutBySubmission = new Map(payoutRows.map((row) => [row.submission_id, row]));

      if (this.config.rewardMode === "dry_run") {
        await this.finishEpoch(epoch.id, "dry_run", 0, allocations.reduce((sum, item) => sum + item.amount, BigInt(0)));
        return;
      }

      const rewardAddress = await this.solana.publicAddressForSecret(this.config.rewardWalletSecret);
      const rewardBalance = await this.solana.getTokenBalance(rewardAddress, campaign.token_mint);
      if (rewardBalance < this.config.rewardBudgetRaw + this.config.rewardWalletMinReserveRaw) {
        throw new Error("Reward wallet balance is below the epoch budget plus reserve");
      }

      let confirmed = 0;
      let distributed = BigInt(0);
      for (let index = 0; index < allocations.length; index += 1) {
        const allocation = allocations[index];
        const payout = payoutBySubmission.get(allocation.submission.id);
        if (!payout) throw new Error(`Reward payout row was not returned for submission ${allocation.submission.id}`);
        try {
          const signature = await this.solana.sendSplToken({
            secret: this.config.rewardWalletSecret,
            expectedAddress: this.config.rewardWalletExpectedAddress,
            recipient: allocation.wallet.address,
            amountRaw: allocation.amount,
            mint: campaign.token_mint,
            decimals: this.config.tokenDecimals,
            onSigned: async (signedSignature) => {
              await this.db.update("reward_epoch_payouts", `id=eq.${payout.id}`, {
                status: "signed",
                transaction_signature: signedSignature,
              });
            },
          });
          await this.db.update("reward_epoch_payouts", `id=eq.${payout.id}`, {
            status: "confirmed",
            transaction_signature: signature,
            submitted_at: new Date().toISOString(),
            confirmed_at: new Date().toISOString(),
          });
          confirmed += 1;
          distributed += allocation.amount;
        } catch (error) {
          await this.db.update("reward_epoch_payouts", `id=eq.${payout.id}`, {
            status: "failed",
            error_message: String(error).slice(0, 500),
          });
        }
      }
      await this.finishEpoch(
        epoch.id,
        confirmed === allocations.length ? "confirmed" : confirmed > 0 ? "partial" : "failed",
        confirmed,
        distributed,
      );
    } catch (error) {
      await this.finishEpoch(epoch.id, "failed", 0, BigInt(0), String(error).slice(0, 500));
      throw error;
    }
  }

  private async finishEpoch(id: string, status: string, transactionCount: number, distributedRaw: bigint, errorMessage?: string) {
    await this.db.update("reward_epochs", `id=eq.${id}`, {
      status,
      transaction_count: transactionCount,
      distributed_raw: distributedRaw.toString(),
      error_message: errorMessage || null,
      completed_at: new Date().toISOString(),
    });
  }

  async campaignLifecycleCycle() {
    const expired = await this.db.select<Campaign>(
      `campaigns?select=id,token_mint,status,review_status&status=eq.live&ends_at=lt.${encodeURIComponent(new Date().toISOString())}`,
    );
    for (const campaign of expired) {
      await this.db.update("campaigns", `id=eq.${campaign.id}&status=eq.live`, { status: "review" });
    }
  }

  async buybackCycle() {
    if (this.buybackRunning || this.config.buybackMode === "disabled") return;
    this.buybackRunning = true;
    let epoch: BuybackEpoch | null = null;
    try {
      const intervalMs = this.config.buybackIntervalSeconds * 1000;
      const startMs = Math.floor(Date.now() / intervalMs) * intervalMs;
      try {
        [epoch] = await this.db.insert<BuybackEpoch>("buyback_epochs", {
          epoch_started_at: new Date(startMs).toISOString(),
          epoch_ended_at: new Date(startMs + intervalMs).toISOString(),
          interval_seconds: this.config.buybackIntervalSeconds,
          allocation_bps: this.config.buybackAllocationBps,
          reserve_lamports: this.config.buybackReserveLamports.toString(),
          output_mint: this.config.buybackOutputMint,
          status: "pending",
        });
      } catch (error) {
        if (String(error).includes("409") || String(error).includes("duplicate")) return;
        throw error;
      }
      const address = this.config.buybackWalletExpectedAddress;
      const balance = await this.solana.getSolBalance(address);
      const eligible = balance > this.config.buybackReserveLamports
        ? balance - this.config.buybackReserveLamports
        : BigInt(0);
      const target = eligible * BigInt(this.config.buybackAllocationBps) / BigInt(10_000);
      await this.db.update("buyback_epochs", `id=eq.${epoch.id}`, {
        treasury_balance_lamports: balance.toString(),
        eligible_lamports: eligible.toString(),
        target_input_lamports: target.toString(),
        input_lamports: target.toString(),
      });
      if (target <= BigInt(0)) {
        await this.db.update("buyback_epochs", `id=eq.${epoch.id}`, {
          status: "skipped",
          error_message: "No SOL was available above the configured reserve",
        });
        return;
      }
      if (this.config.buybackMode === "dry_run") {
        await this.db.update("buyback_epochs", `id=eq.${epoch.id}`, { status: "skipped", error_message: "Dry run" });
        return;
      }
      const result = await this.solana.executeJupiterSwap({
        secret: this.config.buybackWalletSecret,
        expectedAddress: address,
        inputLamports: target,
        outputMint: this.config.buybackOutputMint,
        apiKey: this.config.jupiterApiKey,
        onOrder: async (order) => {
          await this.db.update("buyback_epochs", `id=eq.${epoch!.id}`, {
            status: "quoted",
            quote_id: order.requestId,
            swap_provider: `jupiter-${order.router}`,
          });
        },
      });
      await this.db.update("buyback_epochs", `id=eq.${epoch.id}`, {
        status: "confirmed",
        transaction_signature: result.signature,
        input_lamports: result.totalInputAmount,
        output_amount_raw: result.totalOutputAmount,
        output_decimals: this.config.tokenDecimals,
        submitted_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
      });
    } catch (error) {
      if (epoch) {
        await this.db.update("buyback_epochs", `id=eq.${epoch.id}`, {
          status: "failed",
          error_message: String(error).slice(0, 500),
        });
      }
      throw error;
    } finally {
      this.buybackRunning = false;
    }
  }
}
