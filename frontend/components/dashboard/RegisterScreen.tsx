"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusViewport } from "@/components/ui/status";

interface RegisterScreenProps {
  registerForm: { organization_name: string; name: string; email: string; password: string };
  onFormChange: (form: { organization_name: string; name: string; email: string; password: string }) => void;
  onSubmit: () => void;
  registering: boolean;
  registerError: string | null;
  onSignIn: () => void;
  onBackToHome: () => void;
}

const PROOF_POINTS = [
  "One workspace for domains, brands and reports",
  "No DNS changes to get your first score",
  "Invite the rest of your team later",
];

export default function RegisterScreen({
  registerForm, onFormChange, onSubmit, registering, registerError, onSignIn, onBackToHome,
}: RegisterScreenProps) {
  return (
    <main className="min-h-screen bg-[#09090b] text-[#f5f2ee]">
      <StatusViewport />

      <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-white/[0.07] bg-[#0b0b0e] px-12 py-9 lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-32 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,#ff6b1a_0%,#a3340a_36%,transparent_68%)] opacity-25 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 font-mono text-[9px] leading-[2] tracking-[0.06em] text-[#ff9d52]/[0.05]">
            {Array.from({ length: 20 }).map((_, i) => (
              <p key={i} className="whitespace-nowrap">
                {"v=DMARC1; p=reject; rua=mailto:dmarc@acme.com   v=spf1 include:_spf.acme.com -all   selector1._domainkey CNAME   _dmarc TXT   ".repeat(3)}
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

          <div className="relative z-10 max-w-[460px]">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#ff9d52]">Start with one domain</p>
            <h1 className="mt-5 text-[46px] font-bold leading-[0.98] tracking-[-0.04em]">
              Make the perimeter
              <br />
              yours<span className="text-[#ff6b1a]">.</span>
            </h1>
            <p className="mt-5 text-[13.5px] leading-6 text-white/45">
              Create a workspace for your team. Your first owner account is
              ready the moment you finish.
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
              <p><span className="text-[#ff9d52]">$</span> nexus workspace init acme</p>
              <p className="text-[#ffb987]">→ workspace ready · owner created</p>
            </div>
          </div>

          <p className="relative z-10 font-mono text-[10px] text-white/25">Segbytes · Nexus console</p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[430px]">
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

            <button type="button" onClick={onBackToHome} className="mb-7 hidden items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/35 transition-colors hover:text-white lg:inline-flex">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to homepage
            </button>

            <p className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-[#ff9d52]/20 bg-[#ff6b1a]/10 px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#ffb987]">
              <Terminal className="h-3 w-3" /> new workspace
            </p>
            <h2 className="text-[28px] font-bold tracking-[-0.035em]">Create your workspace</h2>
            <p className="mt-2 text-[12.5px] leading-5 text-white/45">
              One owner, one workspace. You can add teammates after your first scan.
            </p>

            <form
              className="mt-7 space-y-4"
              onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
            >
              <div>
                <label htmlFor="register-organization" className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Workspace name</label>
                <Input
                  id="register-organization"
                  autoComplete="organization"
                  placeholder="Acme Security"
                  className="mt-1.5 h-11 rounded-lg border-white/10 bg-white/[0.04] text-[13px] text-white placeholder:text-white/25 hover:border-white/20 focus-visible:border-[#ff9d52]/60 focus-visible:ring-[#ff9d52]/40"
                  value={registerForm.organization_name}
                  onChange={(e) => onFormChange({ ...registerForm, organization_name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="register-name" className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Your name</label>
                <Input
                  id="register-name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  className="mt-1.5 h-11 rounded-lg border-white/10 bg-white/[0.04] text-[13px] text-white placeholder:text-white/25 hover:border-white/20 focus-visible:border-[#ff9d52]/60 focus-visible:ring-[#ff9d52]/40"
                  value={registerForm.name}
                  onChange={(e) => onFormChange({ ...registerForm, name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="register-email" className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Work email</label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="mt-1.5 h-11 rounded-lg border-white/10 bg-white/[0.04] text-[13px] text-white placeholder:text-white/25 hover:border-white/20 focus-visible:border-[#ff9d52]/60 focus-visible:ring-[#ff9d52]/40"
                  value={registerForm.email}
                  onChange={(e) => onFormChange({ ...registerForm, email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="register-password" className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Password</label>
                <Input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className="mt-1.5 h-11 rounded-lg border-white/10 bg-white/[0.04] text-[13px] text-white placeholder:text-white/25 hover:border-white/20 focus-visible:border-[#ff9d52]/60 focus-visible:ring-[#ff9d52]/40"
                  value={registerForm.password}
                  onChange={(e) => onFormChange({ ...registerForm, password: e.target.value })}
                />
              </div>

              {registerError && (
                <p className="border-l-2 border-red-400/60 py-1 pl-3 text-[12px] text-red-300" role="alert">
                  {registerError}
                </p>
              )}

              <Button
                className="h-11 w-full rounded-lg bg-[#ff6b1a] text-[13px] font-semibold text-[#160a03] hover:bg-[#ff9d52]"
                type="submit"
                disabled={registering}
                aria-busy={registering}
              >
                {registering ? "Creating workspace…" : "Create workspace"}
              </Button>
            </form>

            <div className="mt-7 border-t border-white/10 pt-5">
              <p className="text-[12px] text-white/40">
                Already have an account?{" "}
                <button type="button" onClick={onSignIn} className="inline-flex items-center gap-1 font-medium text-[#ff9d52] underline-offset-4 hover:underline">
                  Sign in <ArrowRight className="h-3 w-3" />
                </button>
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
