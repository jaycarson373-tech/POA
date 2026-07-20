import type { WorkerConfig } from "./config";

export class Database {
  constructor(private readonly config: WorkerConfig) {}

  private headers(extra?: Record<string, string>) {
    return {
      apikey: this.config.supabaseServiceRoleKey,
      Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.supabaseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase ${response.status}: ${detail.slice(0, 500)}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  select<T>(resource: string) {
    return this.request<T[]>(`/rest/v1/${resource}`);
  }

  insert<T>(table: string, value: unknown) {
    return this.request<T[]>(`/rest/v1/${table}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(value),
    });
  }

  upsert<T>(table: string, value: unknown, onConflict: string) {
    return this.request<T[]>(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(value),
    });
  }

  update<T>(table: string, query: string, value: unknown) {
    return this.request<T[]>(`/rest/v1/${table}?${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(value),
    });
  }

  async authUser(jwt: string) {
    const response = await fetch(`${this.config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: this.config.supabasePublishableKey || this.config.supabaseServiceRoleKey,
        Authorization: `Bearer ${jwt}`,
      },
    });
    if (!response.ok) return null;
    return response.json() as Promise<{
      id: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    }>;
  }
}
