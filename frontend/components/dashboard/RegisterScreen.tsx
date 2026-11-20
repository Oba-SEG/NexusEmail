"use client";

import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
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
    <main className="min-h-screen bg-[#f5f0e9] text-[#211511]">
      <StatusViewport />

      <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden bg-[#20120f] px-12 py-9 text-[#f6ece4] lg:flex">
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-32 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#ff9d52_0%,#c05b25_38%,transparent_70%)] opacity-35 blur-2xl" />
          <button type="button" onClick={onBackToHome} className="relative z-10 flex w-fit items-center gap-2.5">
            <span className="nbp-mark flex h-9 w-9 items-center justify-center text-[12px]">N</span>
            <span className="leading-tight">
              <span className="block text-[13.5px] font-semibold">Nexus</span>
              <span className="block text-[11px] text-[#b7a397]">Brand protection</span>
            </span>
          </button>

          <div className="relative z-10 max-w-[460px]">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#d58b5d]">Start with one domain</p>
            <h1 className="mt-5 font-serif text-[48px] leading-[0.98] tracking-[-0.03em]">
              Make the perimeter
              <br />
              yours.
            </h1>
            <p className="mt-5 text-[13.5px] leading-6 text-[#c9b6a9]">
              Create a workspace for your team. Your first owner account is
              ready the moment you finish.
            </p>
            <ul className="mt-8 space-y-3">
              {PROOF_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-[12.5px] leading-5 text-[#c9b6a9]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#ff9d52]" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative z-10 text-[11px] text-[#7f6a5d]">Segbytes · Domain security console</p>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[430px]">
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-2.5">
                <span className="nbp-mark flex h-9 w-9 items-center justify-center text-[12px]">N</span>
                <span className="leading-tight">
                  <span className="block text-[13.5px] font-semibold">Nexus</span>
                  <span className="block text-[11px] text-[#8b7567]">Brand protection</span>
                </span>
              </div>
              <button type="button" onClick={onBackToHome} className="text-[11.5px] text-[#8b7567] hover:text-[#211511]">
                Home
              </button>
            </div>

            <button type="button" onClick={onBackToHome} className="mb-7 hidden items-center gap-1.5 text-[11.5px] text-[#8b7567] transition-colors hover:text-[#211511] lg:inline-flex">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to homepage
            </button>

            <h2 className="text-[28px] font-semibold tracking-[-0.03em]">Create your workspace</h2>
            <p className="mt-2 text-[12.5px] leading-5 text-[#6b584c]">
              One owner, one workspace. You can add teammates after your first scan.
            </p>

            <form
              className="mt-7 space-y-4"
              onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
            >
              <div>
                <label htmlFor="register-organization" className="text-[11.5px] font-medium text-[#5e4c42]">Workspace name</label>
                <Input
                  id="register-organization"
                  autoComplete="organization"
                  placeholder="Acme Security"
                  className="mt-1.5 h-11 rounded-lg border-[#d9cdc1] bg-white/70 text-[#211511] placeholder:text-[#a08472] focus-visible:ring-[#ff9d52]"
                  value={registerForm.organization_name}
                  onChange={(e) => onFormChange({ ...registerForm, organization_name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="register-name" className="text-[11.5px] font-medium text-[#5e4c42]">Your name</label>
                <Input
                  id="register-name"
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  className="mt-1.5 h-11 rounded-lg border-[#d9cdc1] bg-white/70 text-[#211511] placeholder:text-[#a08472] focus-visible:ring-[#ff9d52]"
                  value={registerForm.name}
                  onChange={(e) => onFormChange({ ...registerForm, name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="register-email" className="text-[11.5px] font-medium text-[#5e4c42]">Work email</label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="mt-1.5 h-11 rounded-lg border-[#d9cdc1] bg-white/70 text-[#211511] placeholder:text-[#a08472] focus-visible:ring-[#ff9d52]"
                  value={registerForm.email}
                  onChange={(e) => onFormChange({ ...registerForm, email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="register-password" className="text-[11.5px] font-medium text-[#5e4c42]">Password</label>
                <Input
                  id="register-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className="mt-1.5 h-11 rounded-lg border-[#d9cdc1] bg-white/70 text-[#211511] placeholder:text-[#a08472] focus-visible:ring-[#ff9d52]"
                  value={registerForm.password}
                  onChange={(e) => onFormChange({ ...registerForm, password: e.target.value })}
                />
              </div>

              {registerError && (
                <p className="border-l-2 border-red-400/70 py-1 pl-3 text-[12px] text-red-700" role="alert">
                  {registerError}
                </p>
              )}

              <Button
                className="h-11 w-full rounded-full bg-[#ff9d52] text-[13px] font-semibold text-[#28140a] hover:bg-[#ffad6d]"
                type="submit"
                disabled={registering}
                aria-busy={registering}
              >
                {registering ? "Creating workspace…" : "Create workspace"}
              </Button>
            </form>

            <div className="mt-7 border-t border-[#d9cdc1] pt-5">
              <p className="text-[12px] text-[#6b584c]">
                Already have an account?{" "}
                <button type="button" onClick={onSignIn} className="inline-flex items-center gap-1 font-medium text-[#a34e1d] underline-offset-4 hover:underline">
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
