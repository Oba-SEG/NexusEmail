"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusViewport } from "@/components/ui/status";

interface LoginScreenProps {
  loginForm: { email: string; password: string };
  onFormChange: (form: { email: string; password: string }) => void;
  onSubmit: () => void;
  loggingIn: boolean;
  loginError: string | null;
  onCreateAccount: () => void;
  onBackToHome: () => void;
  googleEnabled?: boolean;
  onGoogleSignIn?: () => void;
}

const PROOF_POINTS = [
  "SPF, DKIM, DMARC and related checks",
  "Brand monitoring and threat alerts",
  "Plain-language fixes with evidence",
];

/** Signed-out gate. The status viewport renders here too so session
 * expiry toasts (shown right after logout) stay visible. */
export default function LoginScreen({
  loginForm, onFormChange, onSubmit, loggingIn, loginError, onCreateAccount, onBackToHome, googleEnabled, onGoogleSignIn,
}: LoginScreenProps) {
  return (
    <main className="min-h-screen bg-[#09090b] text-[#f5f2ee]">
      <StatusViewport />

      <div className="grid min-h-screen lg:grid-cols-[1.02fr_1fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.07] bg-[#0b0b0e] px-12 py-9 lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,#ff6b1a_0%,#a3340a_36%,transparent_68%)] opacity-25 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 font-mono text-[9px] leading-[2] tracking-[0.06em] text-[#ff9d52]/[0.05]">
            {Array.from({ length: 20 }).map((_, i) => (
              <p key={i} className="whitespace-nowrap">
                {"_dmarc TXT v=DMARC1; p=reject; rua=mailto:dmarc@acme.com   v=spf1 include:_spf.acme.com -all   selector1._domainkey CNAME   ".repeat(3)}
              </p>
            ))}
          </div>
          <button type="button" onClick={onBackToHome} className="relative z-10 flex w-fit items-center gap-2.5">
            <span className="nbp-mark flex h-9 w-9 items-center justify-center text-[12px]">N</span>
            <span className="leading-tight">
              <span className="block text-[13.5px] font-semibold">Nexus</span>
              <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/35">brand protection</span>
            </span>
          </button>

          <div className="relative z-10 max-w-[440px]">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff9d52]">Brand protection console</p>
            <h1 className="mt-5 text-[46px] font-bold leading-[0.98] tracking-[-0.04em]">
              Your domains,
              <br />
              clearly in view<span className="text-[#ff6b1a]">.</span>
            </h1>
            <p className="mt-5 text-[13.5px] leading-6 text-white/45">
              See how your domains are doing, what needs fixing and what
              changed — all in one place.
            </p>
            <ul className="mt-8 space-y-3">
              {PROOF_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-[12.5px] leading-5 text-white/50">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#ff9d52]" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-3 font-mono text-[10.5px] leading-5 text-white/40">
              <p><span className="text-[#ff9d52]">Last scan</span> acme.com</p>
              <p className="text-[#ffb987]">→ 92/100 · 1 open fix</p>
            </div>
          </div>

          <p className="relative z-10 font-mono text-[10px] text-white/25">Segbytes · Nexus console</p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[390px]">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-2.5">
                <span className="nbp-mark flex h-9 w-9 items-center justify-center text-[12px]">N</span>
                <span className="leading-tight">
                  <span className="block text-[13.5px] font-semibold">Nexus</span>
                  <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/35">brand protection</span>
                </span>
              </div>
              <button type="button" onClick={onBackToHome} className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/35 hover:text-white">
                Home
              </button>
            </div>

            <button type="button" onClick={onBackToHome} className="mb-8 hidden items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/35 transition-colors hover:text-white lg:inline-flex">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to homepage
            </button>

            <p className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-[#ff9d52]/20 bg-[#ff6b1a]/10 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#ffb987]">
              <Terminal className="h-3 w-3" /> console access
            </p>
            <h2 className="text-[28px] font-bold tracking-[-0.035em]">Sign in</h2>
            <p className="mt-2 text-[12.5px] leading-5 text-white/45">
              Use your Nexus workspace account to continue.
            </p>

            <form
              className="mt-7 space-y-4"
              onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
            >
              <div>
                <label htmlFor="login-email" className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Email</label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="mt-1.5 h-11 rounded-lg border-white/10 bg-white/[0.04] text-[13px] text-white placeholder:text-white/25 hover:border-white/20 focus-visible:border-[#ff9d52]/60 focus-visible:ring-[#ff9d52]/40"
                  value={loginForm.email}
                  onChange={(e) => onFormChange({ ...loginForm, email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="login-password" className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Password</label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  className="mt-1.5 h-11 rounded-lg border-white/10 bg-white/[0.04] text-[13px] text-white placeholder:text-white/25 hover:border-white/20 focus-visible:border-[#ff9d52]/60 focus-visible:ring-[#ff9d52]/40"
                  value={loginForm.password}
                  onChange={(e) => onFormChange({ ...loginForm, password: e.target.value })}
                />
              </div>

              {loginError && (
                <p className="border-l-2 border-red-400/60 py-1 pl-3 text-[12px] text-red-300" role="alert">
                  {loginError}
                </p>
              )}

              <Button
                className="h-11 w-full rounded-lg bg-[#ff6b1a] text-[13px] font-semibold text-[#160a03] hover:bg-[#ff9d52]"
                type="submit"
                disabled={loggingIn}
                aria-busy={loggingIn}
              >
                {loggingIn ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            {googleEnabled && (
              <div className="mt-5">
                <div className="mb-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-white/10" />
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/30">or</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
                <button
                  type="button"
                  onClick={onGoogleSignIn}
                  className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-white/15 bg-white/[0.03] text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9a6 6 0 1 1 0-12c1.9 0 3.2.8 4 1.5l2.7-2.6A9.6 9.6 0 0 0 12 2a10 10 0 1 0 0 20c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
                  </svg>
                  Continue with Google
                </button>
              </div>
            )}

            <div className="mt-7 border-t border-white/10 pt-5">
              <p className="text-[12px] text-white/40">
                New to Nexus?{" "}
                <button type="button" onClick={onCreateAccount} className="inline-flex items-center gap-1 font-medium text-[#ff9d52] underline-offset-4 hover:underline">
                  Create a workspace <ArrowRight className="h-3 w-3" />
                </button>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
