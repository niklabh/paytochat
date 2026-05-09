"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FirebaseError } from "firebase/app";
import { HandleTakenError, useAuth } from "@/lib/auth-context";
import { Button, Card, Input, Label } from "@/components/ui";
import { Logo } from "@/components/logo";
import { isValidHandle, slugifyHandle } from "@/lib/utils";

export default function OnboardingPage() {
  const { user, profile, loading, configured, claimHandle, signOutUser } = useAuth();
  const router = useRouter();

  // Pre-fill handle from the Google account: prefer the email local-part,
  // fall back to a slugified display name.
  const suggestedHandle = useMemo(() => {
    if (!user) return "";
    const fromEmail = user.email?.split("@")[0] ?? "";
    const fromName = user.displayName ?? "";
    return slugifyHandle(fromEmail || fromName);
  }, [user]);

  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // Seed the form once the user object resolves.
  useEffect(() => {
    if (!user) return;
    setHandle((cur) => (cur ? cur : suggestedHandle));
    setDisplayName((cur) => (cur ? cur : user.displayName || ""));
  }, [user, suggestedHandle]);

  // Routing guards: bounce to sign-in if not authed; bounce to dashboard if
  // the profile already exists (i.e. user landed here by mistake).
  useEffect(() => {
    if (loading || !configured) return;
    if (!user) router.replace("/a/sign-in");
    else if (profile) router.replace("/a/dashboard");
  }, [loading, user, profile, configured, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!isValidHandle(handle)) {
      toast.error("Handle must be 3–24 chars: lowercase letters, digits, or _.");
      return;
    }
    setBusy(true);
    try {
      await claimHandle(handle, displayName.trim() || handle);
      toast.success(`Welcome, @${handle}`);
      router.replace("/a/dashboard");
    } catch (e: unknown) {
      if (e instanceof HandleTakenError) {
        toast.error("That handle is already taken. Try another.");
      } else {
        const code = e instanceof FirebaseError ? e.code : "";
        toast.error(code || "Could not save your handle.");
      }
    } finally {
      setBusy(false);
    }
  }

  // While the auth listener is bootstrapping (or before the redirect kicks in
  // for an already-onboarded user), render a minimal shell to avoid flashing
  // the form.
  if (loading || !user || profile) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <Logo />
      </main>
    );
  }

  const handleInvalid = touched && !isValidHandle(handle);

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-4 py-4 flex items-center justify-between">
        <Link href="/">
          <Logo />
        </Link>
        <button
          onClick={() => signOutUser().then(() => router.replace("/"))}
          className="text-xs text-muted hover:text-foreground"
        >
          Sign out
        </button>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md">
          <h1 className="text-2xl font-bold">One last thing</h1>
          <p className="text-sm text-muted mt-1">
            Pick the handle people will use to pay you. Your link will be{" "}
            <span className="text-foreground font-mono">
              paytochat.fun/{handle || "you"}
            </span>
            .
          </p>

          <form onSubmit={onSubmit} className="space-y-4 mt-6">
            <div className="space-y-1.5">
              <Label htmlFor="handle">Handle</Label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-xl border border-r-0 border-white/10 bg-white/5 px-3 text-sm text-muted">
                  paytochat.fun/
                </span>
                <Input
                  id="handle"
                  required
                  autoFocus
                  value={handle}
                  onChange={(e) => {
                    setHandle(slugifyHandle(e.target.value));
                    setTouched(true);
                  }}
                  placeholder="yourname"
                  className="rounded-l-none"
                  aria-invalid={handleInvalid}
                />
              </div>
              {handleInvalid && (
                <p className="text-xs text-red-400">
                  3–24 characters: lowercase letters, digits, or underscores.
                </p>
              )}
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
            <Button
              type="submit"
              disabled={busy || !handle}
              className="w-full"
            >
              {busy ? "Claiming…" : "Claim handle"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
