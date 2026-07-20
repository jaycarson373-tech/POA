import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { loadConfig, configReadiness } from "./config";
import { Database } from "./db";
import { encryptToken, nonceHash } from "./crypto";
import { ProtocolJobs } from "./jobs";
import { SolanaService, verifyWalletSignature } from "./solana";
import { XService } from "./x";

type AuthUser = Awaited<ReturnType<Database["authUser"]>> & { id: string };
type WalletRow = { id: string; user_id: string; address: string; first_transaction_at: string | null; verified_at: string | null; eligibility_status?: string; eligibility_reason?: string | null };
type XAccountRow = { id: string; user_id: string; x_user_id: string; username: string; followers_count: number; account_created_at: string; eligibility_status: string };
type ChallengeRow = { id: string; user_id: string; wallet_address: string; nonce_hash: string; message: string; expires_at: string; consumed_at: string | null };
type CampaignRow = {
  id: string;
  creator_id: string;
  slug: string;
  name: string;
  ticker: string;
  token_mint: string;
  brief: string;
  required_terms: string[];
  reward_kind: "SOL" | "SPL";
  reward_mint: string | null;
  reward_amount_raw: string;
  reward_decimals: number;
  duration_hours: number;
  submission_limit: number;
  winner_count: number;
  holder_bonus_max_bps: number;
  holder_min_balance_raw: string;
  status: string;
  review_status: string;
  starts_at: string | null;
  ends_at: string | null;
};
type ApplicationRow = {
  id: string;
  creator_id: string;
  slug: string;
  name: string;
  ticker: string;
  token_mint: string;
  brief: string;
  required_terms: string[];
  reward_kind: "SOL" | "SPL";
  reward_mint: string | null;
  reward_amount_raw: string;
  reward_decimals: number;
  duration_hours: number;
  submission_limit: number;
  winner_count: number;
  holder_bonus_max_bps: number;
  holder_min_balance_raw: string;
  collection_address: string;
  funding_transaction_signature: string | null;
  funding_status: string;
  public_status: string;
};
type LeaderboardRow = { submission_id: string; rank: number; attention_score: string };
type AdminSubmissionRow = { id: string; campaign_id: string; user_id: string; wallet_id: string; status: string; x_post_url: string };
type PayoutRow = { id: string; submission_id: string; wallet_id: string; status: string; amount_raw: string; transaction_signature: string | null };

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const config = loadConfig();
const db = new Database(config);
const solana = new SolanaService(config);
const x = new XService(config);
const jobs = new ProtocolJobs(config, db, solana, x);

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function setCors(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin?.replace(/\/$/, "") || "";
  if (origin && config.allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Internal-Secret");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

async function body<T extends Record<string, unknown>>(request: IncomingMessage): Promise<T> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100_000) throw new HttpError(413, "Request body is too large");
  }
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

async function authenticated(request: IncomingMessage): Promise<AuthUser> {
  const header = request.headers.authorization || "";
  const jwt = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!jwt) throw new HttpError(401, "Sign in with X first");
  const user = await db.authUser(jwt);
  if (!user) throw new HttpError(401, "Your session is invalid or expired");
  return user as AuthUser;
}

async function admin(request: IncomingMessage) {
  const user = await authenticated(request);
  const rows = await db.select<{ user_id: string }>(`admin_users?select=user_id&user_id=eq.${user.id}&limit=1`);
  if (!rows[0]) throw new HttpError(403, "POA administrator access required");
  return user;
}

function text(value: unknown, name: string, max = 500) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `${name} is required`);
  return value.trim().slice(0, max);
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function positiveRaw(value: unknown, name: string) {
  try {
    const parsed = BigInt(text(value, name, 80));
    if (parsed <= BigInt(0)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, `${name} must be a positive integer in base units`);
  }
}

function slug(value: unknown) {
  const normalized = text(value, "slug", 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (normalized.length < 2) throw new HttpError(400, "slug is invalid");
  return normalized;
}

async function userIdentity(userId: string) {
  const [wallets, accounts] = await Promise.all([
    db.select<WalletRow>(`wallets?select=id,user_id,address,first_transaction_at,verified_at,eligibility_status,eligibility_reason&user_id=eq.${userId}&limit=1`),
    db.select<XAccountRow>(`x_accounts?select=id,user_id,x_user_id,username,followers_count,account_created_at,eligibility_status&user_id=eq.${userId}&limit=1`),
  ]);
  return { wallet: wallets[0] || null, xAccount: accounts[0] || null };
}

async function syncX(request: IncomingMessage) {
  const user = await authenticated(request);
  const input = await body<{ access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown }>(request);
  const accessToken = text(input.access_token, "X provider access token", 5000);
  const xUser = await x.me(accessToken);
  const created = new Date(xUser.created_at).getTime();
  const oldEnough = Number.isFinite(created) && created <= Date.now() - config.xMinimumAgeDays * 86_400_000;
  const followers = xUser.public_metrics?.followers_count || 0;
  const eligibilityStatus = oldEnough && followers >= config.xMinimumFollowers ? "eligible" : "ineligible";
  const reasons = [
    ...(!oldEnough ? [`X account must be at least ${config.xMinimumAgeDays} days old`] : []),
    ...(followers < config.xMinimumFollowers ? [`X account needs at least ${config.xMinimumFollowers} followers`] : []),
  ];

  await db.upsert("profiles", {
    id: user.id,
    display_name: xUser.name,
    avatar_url: xUser.profile_image_url || null,
  }, "id");
  const [account] = await db.upsert<XAccountRow>("x_accounts", {
    user_id: user.id,
    x_user_id: xUser.id,
    username: xUser.username,
    display_name: xUser.name,
    profile_image_url: xUser.profile_image_url || null,
    followers_count: followers,
    following_count: xUser.public_metrics?.following_count || 0,
    account_created_at: xUser.created_at,
    verified_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    eligibility_status: eligibilityStatus,
    eligibility_reason: reasons.join("; ") || null,
  }, "user_id");
  const expiresIn = Number(input.expires_in || 0);
  await db.upsert("x_oauth_credentials", {
    x_account_id: account.id,
    access_token_ciphertext: encryptToken(accessToken, config.tokenEncryptionKey),
    refresh_token_ciphertext: typeof input.refresh_token === "string" && input.refresh_token
      ? encryptToken(input.refresh_token, config.tokenEncryptionKey)
      : null,
    scope: typeof input.scope === "string" ? input.scope.slice(0, 1000) : null,
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
  }, "x_account_id");
  return { account, eligible: eligibilityStatus === "eligible", reasons };
}

async function createWalletChallenge(request: IncomingMessage) {
  const user = await authenticated(request);
  const input = await body<{ address?: unknown }>(request);
  const walletAddress = solana.validateAddress(text(input.address, "wallet address", 100));
  const nonce = randomBytes(24).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
  const message = [
    "Proof of Attention wallet verification",
    `Domain: ${config.webAppUrl}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt.toISOString()}`,
    `Expires at: ${expiresAt.toISOString()}`,
    "This request does not authorize a transaction or transfer funds.",
  ].join("\n");
  const [challenge] = await db.insert<ChallengeRow>("wallet_verification_challenges", {
    user_id: user.id,
    wallet_address: walletAddress,
    nonce_hash: nonceHash(nonce),
    message,
    expires_at: expiresAt.toISOString(),
  });
  return { challenge_id: challenge.id, message, expires_at: challenge.expires_at };
}

async function verifyWallet(request: IncomingMessage) {
  const user = await authenticated(request);
  const input = await body<{ challenge_id?: unknown; signature?: unknown }>(request);
  const challengeId = text(input.challenge_id, "challenge id", 100);
  const signature = text(input.signature, "signature", 500);
  const rows = await db.select<ChallengeRow>(
    `wallet_verification_challenges?select=id,user_id,wallet_address,nonce_hash,message,expires_at,consumed_at&id=eq.${challengeId}&user_id=eq.${user.id}&limit=1`,
  );
  const challenge = rows[0];
  if (!challenge || challenge.consumed_at) throw new HttpError(400, "Wallet challenge is invalid or already used");
  if (new Date(challenge.expires_at).getTime() <= Date.now()) throw new HttpError(400, "Wallet challenge expired");
  if (!verifyWalletSignature(challenge.wallet_address, challenge.message, signature)) {
    throw new HttpError(400, "Wallet signature is invalid");
  }
  const history = await solana.getWalletHistory(challenge.wallet_address);
  const eligibilityStatus = history.oldEnough ? "eligible" : "ineligible";
  const eligibilityReason = history.oldEnough ? null : `Wallet must be at least ${config.walletMinimumAgeDays} days old`;
  const [wallet] = await db.upsert<WalletRow>("wallets", {
    user_id: user.id,
    address: challenge.wallet_address,
    first_transaction_at: history.firstObservedTransactionAt,
    verified_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString(),
    eligibility_status: eligibilityStatus,
    eligibility_reason: eligibilityReason,
  }, "user_id");
  await db.update("wallet_verification_challenges", `id=eq.${challenge.id}&consumed_at=is.null`, {
    consumed_at: new Date().toISOString(),
  });
  return { wallet, eligible: history.oldEnough, reason: eligibilityReason };
}

async function submitPost(request: IncomingMessage) {
  const user = await authenticated(request);
  const input = await body<{ campaign_id?: unknown; x_post_url?: unknown }>(request);
  const campaignId = text(input.campaign_id, "campaign id", 100);
  const postUrl = text(input.x_post_url, "X post URL", 500);
  const [campaign] = await db.select<CampaignRow>(
    `campaigns?select=*&id=eq.${campaignId}&review_status=eq.approved&status=eq.live&limit=1`,
  );
  if (!campaign) throw new HttpError(404, "This campaign is not live");
  const identity = await userIdentity(user.id);
  if (!identity.wallet?.verified_at) throw new HttpError(403, "Verify a Solana wallet first");
  if (identity.wallet.eligibility_status !== "eligible") throw new HttpError(403, identity.wallet.eligibility_reason || "Wallet is not eligible");
  if (!identity.xAccount || identity.xAccount.eligibility_status !== "eligible") throw new HttpError(403, "X account is not eligible");
  const tweetId = x.parseTweetId(postUrl);
  const tweet = await x.tweet(tweetId);
  if (tweet.author_id !== identity.xAccount.x_user_id) throw new HttpError(403, "The post must belong to your connected X account");
  const required = campaign.required_terms || [];
  const isPoa = campaign.token_mint === config.poaMint;
  if (isPoa && !x.qualifiesText(tweet.text)) throw new HttpError(400, `The post must contain $POA or ${config.poaMint}`);
  if (required.some((term) => !tweet.text.toLowerCase().includes(term.toLowerCase()))) {
    throw new HttpError(400, "The post is missing one or more campaign terms");
  }
  const createdAt = new Date(tweet.created_at).getTime();
  if (campaign.starts_at && createdAt < new Date(campaign.starts_at).getTime()) throw new HttpError(400, "The post predates this campaign");
  if (campaign.ends_at && createdAt > new Date(campaign.ends_at).getTime()) throw new HttpError(400, "The post was created after this campaign ended");
  const existing = await db.select<{ id: string }>(
    `submissions?select=id&campaign_id=eq.${campaign.id}&user_id=eq.${user.id}&limit=${campaign.submission_limit}`,
  );
  if (existing.length >= campaign.submission_limit) throw new HttpError(409, "Submission limit reached for this campaign");
  const [submission] = await db.insert("submissions", {
    campaign_id: campaign.id,
    user_id: user.id,
    wallet_id: identity.wallet.id,
    x_account_id: identity.xAccount.id,
    x_post_id: tweet.id,
    x_post_url: postUrl,
    post_created_at: tweet.created_at,
    tracking_started_at: new Date().toISOString(),
    status: "tracking",
  });
  return { submission };
}

async function createApplication(request: IncomingMessage) {
  const user = await authenticated(request);
  const input = await body<Record<string, unknown>>(request);
  if (!config.collectionAddress) throw new HttpError(503, "Campaign collection wallet is not configured");
  const identity = await userIdentity(user.id);
  if (!identity.wallet?.verified_at) throw new HttpError(403, "Verify a Solana wallet before submitting a campaign");
  const rewardKind = text(input.reward_kind, "reward kind", 3).toUpperCase();
  if (rewardKind !== "SOL" && rewardKind !== "SPL") throw new HttpError(400, "reward_kind must be SOL or SPL");
  const tokenMint = solana.validateAddress(text(input.token_mint, "campaign token mint", 100));
  const rewardMint = rewardKind === "SPL"
    ? solana.validateAddress(text(input.reward_mint, "reward mint", 100))
    : null;
  const durationHours = integer(input.duration_hours, "duration_hours", 24, 72);
  if (![24, 48, 72].includes(durationHours)) throw new HttpError(400, "duration_hours must be 24, 48, or 72");
  const requiredTerms = Array.isArray(input.required_terms)
    ? input.required_terms.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 100)).filter(Boolean).slice(0, 20)
    : [];
  const [application] = await db.insert<ApplicationRow>("campaign_applications", {
    creator_id: user.id,
    slug: slug(input.slug),
    name: text(input.name, "name", 100),
    ticker: text(input.ticker, "ticker", 15).replace(/^\$/, "").toUpperCase(),
    token_mint: tokenMint,
    brief: text(input.brief, "brief", 2000),
    required_terms: requiredTerms,
    reward_kind: rewardKind,
    reward_mint: rewardMint,
    reward_amount_raw: positiveRaw(input.reward_amount_raw, "reward_amount_raw").toString(),
    reward_decimals: integer(input.reward_decimals, "reward_decimals", 0, 18),
    duration_hours: durationHours,
    submission_limit: integer(input.submission_limit ?? 1, "submission_limit", 1, 10),
    winner_count: integer(input.winner_count, "winner_count", 1, 1000),
    holder_bonus_max_bps: integer(input.holder_bonus_max_bps ?? 2000, "holder_bonus_max_bps", 0, 10000),
    holder_min_balance_raw: String(input.holder_min_balance_raw ?? "0"),
    collection_address: config.collectionAddress,
  });
  return { application };
}

async function confirmApplicationFunding(request: IncomingMessage, applicationId: string) {
  const user = await authenticated(request);
  const input = await body<{ transaction_signature?: unknown }>(request);
  const signature = text(input.transaction_signature, "transaction signature", 200);
  const [application] = await db.select<ApplicationRow>(
    `campaign_applications?select=*&id=eq.${applicationId}&creator_id=eq.${user.id}&limit=1`,
  );
  if (!application) throw new HttpError(404, "Campaign application not found");
  if (application.public_status !== "pending") throw new HttpError(409, "This application has already been reviewed");
  if (application.funding_status === "confirmed") return { application };
  await db.update("campaign_applications", `id=eq.${application.id}`, {
    funding_transaction_signature: signature,
    funding_status: "submitted",
  });
  try {
    const verification = await solana.verifyFundingTransaction({
      signature,
      collectionAddress: application.collection_address,
      rewardKind: application.reward_kind,
      rewardMint: application.reward_mint,
      amountRaw: BigInt(application.reward_amount_raw),
    });
    const [updated] = await db.update<ApplicationRow>("campaign_applications", `id=eq.${application.id}`, {
      funding_status: "confirmed",
      funding_confirmed_at: new Date().toISOString(),
      funding_received_raw: verification.receivedRaw.toString(),
    });
    return { application: updated };
  } catch (error) {
    await db.update("campaign_applications", `id=eq.${application.id}`, {
      funding_status: "rejected",
      funding_error: String(error).slice(0, 500),
    });
    throw error;
  }
}

async function reviewApplication(request: IncomingMessage, applicationId: string) {
  const reviewer = await admin(request);
  const input = await body<{ decision?: unknown; notes?: unknown; refund?: unknown }>(request);
  const decision = text(input.decision, "decision", 20).toLowerCase();
  if (decision !== "approve" && decision !== "deny") throw new HttpError(400, "decision must be approve or deny");
  const [application] = await db.select<ApplicationRow>(`campaign_applications?select=*&id=eq.${applicationId}&limit=1`);
  if (!application) throw new HttpError(404, "Campaign application not found");
  if (application.public_status !== "pending") throw new HttpError(409, "This application has already been reviewed");
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : null;

  if (decision === "approve") {
    if (application.funding_status !== "confirmed") throw new HttpError(409, "Funding must be confirmed on-chain before approval");
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + application.duration_hours * 3_600_000);
    const [campaign] = await db.insert<CampaignRow>("campaigns", {
      creator_id: application.creator_id,
      slug: application.slug,
      name: application.name,
      ticker: application.ticker,
      token_mint: application.token_mint,
      brief: application.brief,
      required_terms: application.required_terms,
      reward_kind: application.reward_kind,
      reward_mint: application.reward_mint,
      reward_amount_raw: application.reward_amount_raw,
      reward_decimals: application.reward_decimals,
      duration_hours: application.duration_hours,
      submission_limit: application.submission_limit,
      winner_count: application.winner_count,
      holder_bonus_max_bps: application.holder_bonus_max_bps,
      holder_min_balance_raw: application.holder_min_balance_raw,
      treasury_address: application.collection_address,
      status: "live",
      review_status: "approved",
      reviewed_by: reviewer.id,
      reviewed_at: startsAt.toISOString(),
      review_notes: notes,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      funded_at: startsAt.toISOString(),
    });
    await db.update("campaign_applications", `id=eq.${application.id}`, {
      public_status: "accepted",
      reviewed_by: reviewer.id,
      reviewed_at: startsAt.toISOString(),
      review_notes: notes,
      published_campaign_id: campaign.id,
    });
    await db.insert("audit_events", {
      actor_user_id: reviewer.id,
      entity_type: "campaign_application",
      entity_id: application.id,
      action: "approved_and_published",
      metadata: { campaign_id: campaign.id },
    });
    return { application_id: application.id, campaign };
  }

  const shouldRefund = input.refund === true && application.funding_status === "confirmed";
  const initialStatus = shouldRefund ? "refund_pending" : "denied";
  await db.update("campaign_applications", `id=eq.${application.id}`, {
    public_status: initialStatus,
    reviewed_by: reviewer.id,
    reviewed_at: new Date().toISOString(),
    review_notes: notes,
  });
  await db.insert("audit_events", {
    actor_user_id: reviewer.id,
    entity_type: "campaign_application",
    entity_id: application.id,
    action: shouldRefund ? "denied_refund_requested" : "denied",
    metadata: {},
  });
  if (!shouldRefund) return { application_id: application.id, status: "denied" };
  if (!config.collectionWalletSecret) {
    return { application_id: application.id, status: "refund_pending", reason: "Collection wallet signer is not configured" };
  }
  const [recipient] = await db.select<WalletRow>(`wallets?select=*&user_id=eq.${application.creator_id}&limit=1`);
  if (!recipient?.verified_at) throw new HttpError(409, "Applicant no longer has a verified refund wallet");
  try {
    const onSigned = async (signature: string) => {
      await db.update("campaign_applications", `id=eq.${application.id}`, {
        refund_transaction_signature: signature,
        refund_submitted_at: new Date().toISOString(),
      });
    };
    const signature = application.reward_kind === "SOL"
      ? await solana.sendSol({
          secret: config.collectionWalletSecret,
          expectedAddress: config.collectionAddress,
          recipient: recipient.address,
          lamports: BigInt(application.reward_amount_raw),
          onSigned,
        })
      : await solana.sendSplToken({
          secret: config.collectionWalletSecret,
          expectedAddress: config.collectionAddress,
          recipient: recipient.address,
          amountRaw: BigInt(application.reward_amount_raw),
          mint: application.reward_mint || undefined,
          decimals: application.reward_decimals,
          onSigned,
        });
    await db.update("campaign_applications", `id=eq.${application.id}`, {
      public_status: "refunded",
      funding_status: "refunded",
      refund_transaction_signature: signature,
      refunded_at: new Date().toISOString(),
      refund_error: null,
    });
    return { application_id: application.id, status: "refunded", transaction_signature: signature };
  } catch (error) {
    await db.update("campaign_applications", `id=eq.${application.id}`, {
      refund_error: String(error).slice(0, 500),
    });
    throw error;
  }
}

async function reviewSubmission(request: IncomingMessage, submissionId: string) {
  const reviewer = await admin(request);
  const input = await body<{ decision?: unknown; notes?: unknown }>(request);
  const decision = text(input.decision, "decision", 20).toLowerCase();
  if (decision !== "approve" && decision !== "disqualify") throw new HttpError(400, "decision must be approve or disqualify");
  const [submission] = await db.select<AdminSubmissionRow>(`submissions?select=id,campaign_id,user_id,wallet_id,status,x_post_url&id=eq.${submissionId}&limit=1`);
  if (!submission) throw new HttpError(404, "Submission not found");
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : null;
  await db.insert("review_decisions", {
    submission_id: submission.id,
    reviewer_id: reviewer.id,
    decision: decision === "approve" ? "approved" : "disqualified",
    reason_code: decision === "disqualify" ? "manual_integrity_review" : null,
    notes,
  });
  const [updated] = await db.update("submissions", `id=eq.${submission.id}`, {
    status: decision === "approve" ? "approved" : "disqualified",
    disqualification_reason: decision === "disqualify" ? notes || "Failed manual integrity review" : null,
  });
  return { submission: updated };
}

async function finalizeCampaign(request: IncomingMessage, campaignId: string) {
  const reviewer = await admin(request);
  if (!config.collectionWalletSecret) throw new HttpError(503, "CAMPAIGN_COLLECTION_WALLET_PRIVATE_KEY is not configured");
  const [campaign] = await db.select<CampaignRow>(`campaigns?select=*&id=eq.${campaignId}&review_status=eq.approved&limit=1`);
  if (!campaign) throw new HttpError(404, "Campaign not found");
  if (campaign.status !== "review" && campaign.status !== "live") throw new HttpError(409, "Campaign is not ready for finalization");
  if (campaign.ends_at && new Date(campaign.ends_at).getTime() > Date.now()) throw new HttpError(409, "Campaign has not ended");
  await db.update("campaigns", `id=eq.${campaign.id}`, { status: "review" });
  const leaderboard = await db.select<LeaderboardRow>(
    `campaign_leaderboard?select=submission_id,rank,attention_score&campaign_id=eq.${campaign.id}&order=rank.asc&limit=1000`,
  );
  const submissionIds = leaderboard.map((row) => row.submission_id).join(",");
  if (!submissionIds) throw new HttpError(409, "No submissions are ranked");
  const approved = await db.select<AdminSubmissionRow>(
    `submissions?select=id,campaign_id,user_id,wallet_id,status,x_post_url&id=in.(${submissionIds})&status=in.(approved,winner)`,
  );
  const approvedById = new Map(approved.map((row) => [row.id, row]));
  const winners = leaderboard.filter((row) => approvedById.has(row.submission_id)).slice(0, campaign.winner_count);
  if (winners.length === 0) throw new HttpError(409, "No manually approved submissions are eligible");
  const total = BigInt(campaign.reward_amount_raw);
  const perWinner = total / BigInt(winners.length);
  if (perWinner <= BigInt(0)) throw new HttpError(409, "Reward pool is too small for the winner count");
  let remaining = total;
  let confirmed = 0;
  const signatures: string[] = [];

  for (let index = 0; index < winners.length; index += 1) {
    const ranked = winners[index];
    const submission = approvedById.get(ranked.submission_id)!;
    const amount = index === winners.length - 1 ? remaining : perWinner;
    remaining -= amount;
    const [wallet] = await db.select<WalletRow>(`wallets?select=*&id=eq.${submission.wallet_id}&limit=1`);
    if (!wallet?.verified_at) continue;
    let [payout] = await db.select<PayoutRow>(`payouts?select=id,submission_id,wallet_id,status,amount_raw,transaction_signature&submission_id=eq.${submission.id}&limit=1`);
    if (payout?.status === "confirmed") {
      confirmed += 1;
      if (payout.transaction_signature) signatures.push(payout.transaction_signature);
      continue;
    }
    if (!payout) {
      [payout] = await db.insert<PayoutRow>("payouts", {
        campaign_id: campaign.id,
        submission_id: submission.id,
        user_id: submission.user_id,
        wallet_id: wallet.id,
        rank: ranked.rank,
        asset_mint: campaign.reward_kind === "SPL" ? campaign.reward_mint : null,
        amount_raw: amount.toString(),
        status: "queued",
      });
    } else {
      await db.update("payouts", `id=eq.${payout.id}`, { status: "queued", error_message: null });
    }
    try {
      const onSigned = async (signature: string) => {
        await db.update("payouts", `id=eq.${payout.id}`, {
          status: "submitted",
          transaction_signature: signature,
          submitted_at: new Date().toISOString(),
        });
      };
      const signature = campaign.reward_kind === "SOL"
        ? await solana.sendSol({
            secret: config.collectionWalletSecret,
            expectedAddress: config.collectionAddress,
            recipient: wallet.address,
            lamports: amount,
            onSigned,
          })
        : await solana.sendSplToken({
            secret: config.collectionWalletSecret,
            expectedAddress: config.collectionAddress,
            recipient: wallet.address,
            amountRaw: amount,
            mint: campaign.reward_mint || undefined,
            decimals: campaign.reward_decimals,
            onSigned,
          });
      await db.update("payouts", `id=eq.${payout.id}`, {
        status: "confirmed",
        transaction_signature: signature,
        confirmed_at: new Date().toISOString(),
      });
      await db.update("submissions", `id=eq.${submission.id}`, {
        status: "winner",
        final_rank: ranked.rank,
        final_attention_score: ranked.attention_score,
      });
      confirmed += 1;
      signatures.push(signature);
    } catch (error) {
      await db.update("payouts", `id=eq.${payout.id}`, { status: "failed", error_message: String(error).slice(0, 500) });
    }
  }
  if (confirmed === winners.length) {
    await db.update("campaigns", `id=eq.${campaign.id}`, { status: "finalized", finalized_at: new Date().toISOString() });
  }
  await db.insert("audit_events", {
    actor_user_id: reviewer.id,
    entity_type: "campaign",
    entity_id: campaign.id,
    action: "payout_finalization",
    metadata: { winners: winners.length, confirmed },
  });
  return { campaign_id: campaign.id, winners: winners.length, confirmed, signatures };
}

async function me(request: IncomingMessage) {
  const user = await authenticated(request);
  const identity = await userIdentity(user.id);
  const [positions, submissions, payouts, applications, admins] = await Promise.all([
    db.select(`campaign_holder_positions?select=*&user_id=eq.${user.id}&order=updated_at.desc`),
    db.select(`submissions?select=*&user_id=eq.${user.id}&order=submitted_at.desc`),
    db.select(`reward_epoch_payouts?select=*&user_id=eq.${user.id}&order=created_at.desc&limit=100`),
    db.select(`campaign_applications?select=*&creator_id=eq.${user.id}&order=created_at.desc`),
    db.select<{ user_id: string }>(`admin_users?select=user_id&user_id=eq.${user.id}&limit=1`),
  ]);
  return { user: { id: user.id }, ...identity, positions, submissions, payouts, applications, is_admin: Boolean(admins[0]) };
}

async function route(request: IncomingMessage, response: ServerResponse) {
  setCors(request, response);
  if (request.method === "OPTIONS") return json(response, 204, null);
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const readiness = configReadiness(config);

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, readiness.ready ? 200 : 503, {
      status: readiness.ready ? "ready" : "not_ready",
      missing: readiness.missing,
      reward_mode: config.rewardMode,
      reward_interval_seconds: config.rewardIntervalSeconds,
      minimum_holder_tokens: config.minimumHolderTokens.toString(),
    });
  }
  if (!readiness.ready) throw new HttpError(503, `Worker configuration is incomplete: ${readiness.missing.join(", ")}`);
  if (request.method === "GET" && url.pathname === "/v1/me") return json(response, 200, await me(request));
  if (request.method === "POST" && url.pathname === "/v1/auth/x/sync") return json(response, 200, await syncX(request));
  if (request.method === "POST" && url.pathname === "/v1/wallet/challenge") return json(response, 201, await createWalletChallenge(request));
  if (request.method === "POST" && url.pathname === "/v1/wallet/verify") return json(response, 200, await verifyWallet(request));
  if (request.method === "POST" && url.pathname === "/v1/submissions") return json(response, 201, await submitPost(request));
  if (request.method === "POST" && url.pathname === "/v1/campaign-applications") return json(response, 201, await createApplication(request));
  const fundingMatch = url.pathname.match(/^\/v1\/campaign-applications\/([0-9a-f-]+)\/funding$/i);
  if (request.method === "POST" && fundingMatch) return json(response, 200, await confirmApplicationFunding(request, fundingMatch[1]));
  const reviewMatch = url.pathname.match(/^\/v1\/admin\/campaign-applications\/([0-9a-f-]+)\/review$/i);
  if (request.method === "POST" && reviewMatch) return json(response, 200, await reviewApplication(request, reviewMatch[1]));
  if (request.method === "GET" && url.pathname === "/v1/admin/campaign-applications") {
    await admin(request);
    return json(response, 200, { applications: await db.select("campaign_applications?select=*&order=created_at.desc") });
  }
  if (request.method === "GET" && url.pathname === "/v1/admin/submissions") {
    await admin(request);
    const campaignId = url.searchParams.get("campaign_id");
    const filter = campaignId ? `&campaign_id=eq.${encodeURIComponent(campaignId)}` : "";
    return json(response, 200, { submissions: await db.select(`submissions?select=*&status=in.(tracking,flagged,approved)${filter}&order=submitted_at.desc&limit=1000`) });
  }
  const submissionReviewMatch = url.pathname.match(/^\/v1\/admin\/submissions\/([0-9a-f-]+)\/review$/i);
  if (request.method === "POST" && submissionReviewMatch) return json(response, 200, await reviewSubmission(request, submissionReviewMatch[1]));
  const finalizeMatch = url.pathname.match(/^\/v1\/admin\/campaigns\/([0-9a-f-]+)\/finalize$/i);
  if (request.method === "POST" && finalizeMatch) return json(response, 200, await finalizeCampaign(request, finalizeMatch[1]));
  if (request.method === "POST" && url.pathname.startsWith("/internal/")) {
    if (!config.internalApiSecret || request.headers["x-internal-secret"] !== config.internalApiSecret) {
      throw new HttpError(401, "Internal secret is invalid");
    }
    if (url.pathname === "/internal/score") await jobs.scoreCycle();
    else if (url.pathname === "/internal/rewards") await jobs.rewardCycle();
    else if (url.pathname === "/internal/follower-quality") await jobs.followerQualityCycle();
    else if (url.pathname === "/internal/lifecycle") await jobs.campaignLifecycleCycle();
    else if (url.pathname === "/internal/buyback") await jobs.buybackCycle();
    else throw new HttpError(404, "Route not found");
    return json(response, 200, { ok: true });
  }
  throw new HttpError(404, "Route not found");
}

function runJobs() {
  const scoreAndReward = () => void jobs.scoreCycle()
    .then(() => jobs.campaignLifecycleCycle())
    .then(() => jobs.rewardCycle())
    .catch((error) => console.error("score_reward_cycle_failed", error));
  const follower = () => void jobs.followerQualityCycle()
    .catch((error) => console.error("follower_cycle_failed", error));
  const buyback = () => void jobs.buybackCycle()
    .catch((error) => console.error("buyback_cycle_failed", error));
  setTimeout(scoreAndReward, 5_000).unref();
  setTimeout(follower, 15_000).unref();
  setTimeout(buyback, 20_000).unref();
  setInterval(scoreAndReward, config.rewardIntervalSeconds * 1000).unref();
  setInterval(follower, config.followerQualityIntervalSeconds * 1000).unref();
  setInterval(buyback, config.buybackIntervalSeconds * 1000).unref();
}

const server = createServer((request, response) => {
  void route(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error("request_failed", request.method, request.url, error);
    json(response, status, { error: error instanceof Error ? error.message : "Unexpected server error" });
  });
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`POA worker listening on ${config.port}; rewards=${config.rewardMode}; buybacks=${config.buybackMode}; interval=${config.rewardIntervalSeconds}s`);
  runJobs();
});
