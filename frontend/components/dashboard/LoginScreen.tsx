"use client";

import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusViewport } from "@/components/ui/status";

interface LoginScreenProps {
  loginForm: { email: string; password: string };
  onFormChange: (form: { email: string; password: string }) => void;
  onSubmit: () => void;
  loggingIn: boolean;
  loginError: string | null;
}

const PROOF_POINTS = [
  "Domain posture for SPF, DKIM and DMARC",
  "Brand monitoring and threat alerts",
  "Plain-language fixes with evidence",
];

/** Signed-out gate. The status viewport renders here too so session
 * expiry toasts (shown right after logout) stay visible. */
export default function LoginScreen({ loginForm, onFormChange, onSubmit, loggingIn, loginError }: LoginScreenProps) {
  return (
    <main className="min-h-screen bg-background">
      <StatusViewport />

      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="hidden flex-col justify-between border-r border-border bg-[#08080a] px-12 py-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="nbp-mark flex h-9 w-9 items-center justify-center text-[12px]">N</div>
          <div className="leading-tight">
            <p className="text-[13.5px] font-semibold">Nexus</p>
            <p className="text-[11px] text-muted-foreground">Brand protection</p>
          </div>
        </div>

        <div className="max-w-[440px]">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.03em]">
            Email security,
            <br />
            without the noise.
          </h1>
          <p className="mt-4 text-[13.5px] leading-6 text-muted-foreground">
            One console for domain authentication, brand monitoring and the
            evidence your team needs to act.
          </p>
          <ul className="mt-8 space-y-3">
            {PROOF_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-[12.5px] leading-5 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary/80" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[11px] text-muted-foreground">Segbytes · Domain security console</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-[368px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="nbp-mark flex h-9 w-9 items-center justify-center text-[12px]">N</div>
            <div className="leading-tight">
              <p className="text-[13.5px] font-semibold">Nexus</p>
              <p className="text-[11px] text-muted-foreground">Brand protection</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-[19px] font-semibold tracking-[-0.015em]">Sign in</h2>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              Use your Segbytes client account to continue.
            </p>

            <form
              className="mt-6 space-y-4"
              onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
            >
              <div>
                <label htmlFor="login-email" className="text-[12px] font-medium text-muted-foreground">Email</label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  className="mt-1.5"
                  value={loginForm.email}
                  onChange={(e) => onFormChange({ ...loginForm, email: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor="login-password" className="text-[12px] font-medium text-muted-foreground">Password</label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  className="mt-1.5"
                  value={loginForm.password}
                  onChange={(e) => onFormChange({ ...loginForm, password: e.target.value })}
                />
              </div>

              {loginError && (
                <p className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-[12px] text-red-300" role="alert">
                  {loginError}
                </p>
              )}

              <Button className="w-full" type="submit" disabled={loggingIn} aria-busy={loggingIn}>
                {loggingIn ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-5 text-center text-[11px] text-muted-foreground lg:hidden">
            Segbytes · Domain security console
          </p>
        </div>
      </section>
      </div>
    </main>
  );
}
