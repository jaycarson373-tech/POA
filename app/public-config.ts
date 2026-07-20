export function normalizePublicUrl(value: string) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const RAILWAY_API_URL = normalizePublicUrl(process.env.NEXT_PUBLIC_RAILWAY_API_URL || "");
