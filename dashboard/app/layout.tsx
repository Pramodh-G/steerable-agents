import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "steerable-agents",
  description: "Every agent session, compressed around the decisions.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <nav className="nav">
          <Link href="/" className="brand">steerable-agents</Link>
          <Link href="/">Sessions</Link>
          <Link href="/haiku">Haiku</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
