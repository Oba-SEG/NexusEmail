import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Manrope is used as a display face for headings, brand wordmarks, and
// numerical surfaces (status counts, prices, etc.). It pairs well with
// Inter and feels appropriately premium for a hosted SaaS tenancy.
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700", "800"],
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
    <html lang="en" className={cn(inter.variable, manrope.variable)} suppressHydrationWarning>
      <head>
        {/* Static-export (GitHub Pages) builds can't receive response headers,
            so the CSP ships as a <meta> tag instead. Server builds (Docker/VPS
            staging) get it from next.config headers() and skip the meta. */}
        {process.env.NEXUSEMAIL_STATIC_EXPORT ? (
          <meta
            httpEquiv="Content-Security-Policy"
            content="default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.brandprotection.segbytes.xyz http://localhost:4000; base-uri 'self'; form-action 'self'"
          />
        ) : null}
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
