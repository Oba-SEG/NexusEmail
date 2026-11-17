"use client";

import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <StatusViewport />
      <Card className="w-full max-w-md bg-slate-900 border-slate-800 text-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Nexus Brand Protection</CardTitle>
          <CardDescription>Sign in through your Segbytes client account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Email" value={loginForm.email} onChange={(e) => onFormChange({ ...loginForm, email: e.target.value })} />
          <Input placeholder="Password" type="password" value={loginForm.password} onChange={(e) => onFormChange({ ...loginForm, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && onSubmit()} />
          {loginError && <p className="text-sm text-red-400">{loginError}</p>}
          <Button className="w-full" onClick={onSubmit} disabled={loggingIn}>{loggingIn ? 'Signing in...' : 'Sign in'}</Button>
        </CardContent>
      </Card>
    </main>
  );
}
