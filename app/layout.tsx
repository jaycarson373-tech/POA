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
  description: "Turn attention into proof. Projects fund campaigns, creators generate attention, and verified performance earns rewards.",
  openGraph: {
    title: "POA — Proof of Attention",
    description: "Turn attention into proof.",
    type: "website",
    url: siteUrl,
    images: [{ url: `${siteUrl}/poa-wordmark.jpg`, width: 1254, height: 1254, alt: "Proof of Attention" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "POA — Proof of Attention",
    description: "Turn attention into proof.",
    images: [`${siteUrl}/poa-wordmark.jpg`],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
