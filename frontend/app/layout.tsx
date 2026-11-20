import type { Metadata } from "next";
import { Public_Sans, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { cspValue } from "@/lib/csp";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Mono is a data face only: domains, DNS records, selectors, API keys.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

// Editorial face for the public site only. The console keeps Public Sans.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Nexus Brand Protection",
  description: "Brand monitoring, threat detection, and takedowns for your domains.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn(publicSans.variable, plexMono.variable, instrumentSerif.variable)} suppressHydrationWarning>
      <head>
        {/* Static-export (GitHub Pages) builds can't receive response headers,
            so the CSP ships as a <meta> tag instead. Server builds (Docker/VPS
            staging) get it from next.config headers() and skip the meta.
            frame-ancestors has no effect in <meta> CSP; GitHub Pages enforces
            SAMEORIGIN X-Frame-Options for Pages sites, covering clickjacking
            there. */}
        {process.env.NEXUSEMAIL_STATIC_EXPORT ? (
          <meta httpEquiv="Content-Security-Policy" content={cspValue()} />
        ) : null}
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
