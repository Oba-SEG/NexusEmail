"use client";

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

/** Signed-out gate. The status viewport renders here too so session
 * expiry toasts (shown right after logout) stay visible. */
export default function LoginScreen({ loginForm, onFormChange, onSubmit, loggingIn, loginError }: LoginScreenProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(560px 300px at 50% -8%, hsl(var(--primary) / 0.09), transparent 70%)" }}
      />
      <StatusViewport />

      <div className="relative w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="nbp-mark h-9 w-9 text-[12px]">N</div>
          <div className="leading-tight">
            <p className="text-[13.5px] font-semibold">Nexus</p>
            <p className="text-[11px] text-muted-foreground">Brand protection</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em]">Sign in</h1>
          <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
            Use your Segbytes client account to continue.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
          >
            <div>
              <label htmlFor="login-email" className="text-[12px] font-medium text-muted-foreground">Email</label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="Email"
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
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground">Domain security console</p>
      </div>
    </main>
  );
}
