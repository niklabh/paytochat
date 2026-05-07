"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button, Card, Input, Label } from "@/components/ui";
import { Logo } from "@/components/logo";
import { toast } from "sonner";
import { FirebaseError } from "firebase/app";

export default function SignInPage() {
  const { signInEmail, signInGoogle, user, configured } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace("/a/dashboard");
  }, [user, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!configured) {
      toast.error("Firebase not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.");
      return;
    }
    setBusy(true);
    try {
      await signInEmail(email, password);
      router.replace("/a/dashboard");
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : "";
      toast.error(code || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (!configured) {
      toast.error("Firebase not configured.");
      return;
    }
    setBusy(true);
    try {
      await signInGoogle();
      router.replace("/a/dashboard");
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : "";
      toast.error(code || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-4 py-4">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <h1 className="text-2xl font-bold">Welcome back</h1>
          <p className="text-sm text-muted mt-1">Sign in to your inbox.</p>

          <Button onClick={onGoogle} disabled={busy} variant="outline" className="mt-6 w-full">
            <GoogleMark /> Continue with Google
          </Button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-sm text-muted text-center">
            New here?{" "}
            <Link href="/a/sign-up" className="text-brand-300 hover:underline">
              Create an account
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M12 11v3.2h5.1c-.2 1.4-1.6 4.1-5.1 4.1-3 0-5.5-2.5-5.5-5.6S8.9 7.2 12 7.2c1.7 0 2.9.7 3.6 1.4l2.4-2.3C16.5 4.8 14.4 4 12 4 6.9 4 3 7.9 3 13s3.9 9 9 9c5.2 0 8.6-3.6 8.6-8.7 0-.6-.1-1-.1-1.3H12z" />
    </svg>
  );
}
