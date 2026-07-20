import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = (
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://proof-of-attention.sufficientlev.chatgpt.site"
).replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "POA — Proof of Attention",
  description: "Onchain rewards for real attention. Compete in token-funded campaigns and earn for the reach you create.",
  openGraph: {
    title: "POA — Proof of Attention",
    description: "Attention is the economy. Onchain rewards for real reach.",
    type: "website",
    url: siteUrl,
    images: [{ url: `${siteUrl}/poa-banner.jpg`, width: 1280, height: 426, alt: "POA — Proof of Attention" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "POA — Proof of Attention",
    description: "Attention is the economy. Onchain rewards for real reach.",
    images: [`${siteUrl}/poa-banner.jpg`],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
