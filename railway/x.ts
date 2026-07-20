import type { WorkerConfig } from "./config";

type XUser = {
  id: string;
  username: string;
  name: string;
  created_at: string;
  profile_image_url?: string;
  verified?: boolean;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
  };
};

type XTweet = {
  id: string;
  author_id: string;
  text: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    bookmark_count?: number;
    impression_count?: number;
  };
};

async function xRequest<T>(url: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`X API ${response.status}: ${detail.slice(0, 400)}`);
  }
  return response.json() as Promise<T>;
}

export class XService {
  constructor(private readonly config: WorkerConfig) {}

  async me(accessToken: string) {
    const response = await xRequest<{ data: XUser }>(
      "https://api.x.com/2/users/me?user.fields=created_at,profile_image_url,public_metrics,verified",
      accessToken,
    );
    return response.data;
  }

  async tweet(tweetId: string, accessToken?: string) {
    const token = accessToken || this.config.xBearerToken;
    if (!token) throw new Error("X_BEARER_TOKEN is required for tweet tracking");
    const response = await xRequest<{ data: XTweet }>(
      `https://api.x.com/2/tweets/${encodeURIComponent(tweetId)}?tweet.fields=author_id,created_at,text,public_metrics`,
      token,
    );
    return response.data;
  }

  async followerQuality(xUserId: string) {
    if (!this.config.xBearerToken) throw new Error("X_BEARER_TOKEN is required for follower quality");
    const response = await xRequest<{ data?: XUser[] }>(
      `https://api.x.com/2/users/${encodeURIComponent(xUserId)}/followers?max_results=1000&user.fields=created_at,public_metrics,verified`,
      this.config.xBearerToken,
    );
    const followers = response.data || [];
    const now = Date.now();
    let qualityFollowers = 0;
    for (const follower of followers) {
      const metrics = follower.public_metrics;
      const ageDays = (now - new Date(follower.created_at).getTime()) / 86_400_000;
      if (
        ageDays >= 90
        && (metrics?.followers_count || 0) >= 25
        && (metrics?.tweet_count || 0) >= 10
        && (metrics?.following_count || 0) <= Math.max(5000, (metrics?.followers_count || 0) * 20)
      ) qualityFollowers += 1;
    }
    return {
      sampledFollowers: followers.length,
      qualityFollowers,
      score: followers.length === 0 ? 0 : qualityFollowers / followers.length,
    };
  }

  parseTweetId(urlOrId: string) {
    const value = urlOrId.trim();
    if (/^\d{5,30}$/.test(value)) return value;
    const match = value.match(/(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)/i);
    if (!match) throw new Error("Enter a valid X post URL");
    return match[1];
  }

  qualifiesText(text: string) {
    return /(^|\s|[^a-z0-9])\$poa([^a-z0-9]|$)/i.test(text)
      || text.includes(this.config.poaMint);
  }
}

export type { XTweet, XUser };
