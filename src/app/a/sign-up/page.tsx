"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button, Card, Input, Label } from "@/components/ui";
import { Logo } from "@/components/logo";
import { toast } from "sonner";
import { FirebaseError } from "firebase/app";
import { isValidHandle, slugifyHandle } from "@/lib/utils";

export default function SignUpPage() {
  const { signUpEmail, signInGoogle, user, profile, loading, configured } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  // Wait for the auth listener to settle before routing. Brand-new Google
  // users land here without a profile yet and need /a/onboarding to claim a
  // handle.
  useEffect(() => {
    if (loading || !user) return;
    router.replace(profile ? "/a/dashboard" : "/a/onboarding");
  }, [loading, user, profile, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!configured) {
      toast.error("Firebase not configured. Add NEXT_PUBLIC_FIREBASE_* env vars.");
      return;
    }
    if (!isValidHandle(handle)) {
      toast.error("Handle must be 3–24 chars, lowercase letters, digits, or _.");
      return;
    }
    setBusy(true);
    try {
      await signUpEmail(email, password, handle, displayName || handle);
      toast.success(`Welcome, @${handle}`);
      // The redirect effect above handles routing once auth state settles.
    } catch (e: unknown) {
      const code = e instanceof FirebaseError ? e.code : "";
      toast.error(code || "Could not create account.");
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
      // The redirect effect routes the user to /a/onboarding so they can
      // claim a handle before reaching the dashboard.
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
          <h1 className="text-2xl font-bold">Claim your handle</h1>
          <p className="text-sm text-muted mt-1">
            Your link will be{" "}
            <span className="text-foreground font-mono">
              paytochat.fun/{handle || "you"}
            </span>
            .
          </p>

          <Button onClick={onGoogle} disabled={busy} variant="outline" className="mt-6 w-full">
            Continue with Google
          </Button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="handle">Handle</Label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-white/10 bg-white/5 px-3 text-sm text-muted">
                  paytochat.fun/
                </span>
                <Input
                  id="handle"
                  required
                  value={handle}
                  onChange={(e) => setHandle(slugifyHandle(e.target.value))}
                  placeholder="yourname"
                  className="rounded-l-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should senders see you?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
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
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? "Creating…" : "Create account"}
            </Button>
          </form>
          <p className="mt-6 text-sm text-muted text-center">
            Already have one?{" "}
            <Link href="/a/sign-in" className="text-brand-300 hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
