"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/nav";
import { useAuth } from "@/lib/auth-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !configured) return;
    if (!user) router.replace("/a/sign-in");
    // Authenticated, but no Firestore profile yet (typical for a brand-new
    // Google sign-in). Send them through onboarding to claim a handle.
    else if (!profile) router.replace("/a/onboarding");
  }, [loading, user, profile, configured, router]);

  // Don't flash the dashboard chrome while we wait for auth to settle or
  // while we're about to redirect to onboarding.
  const ready = !configured || (!loading && !!user && !!profile);

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <AppNav />
      <div className="mx-auto max-w-6xl px-4 py-6">{ready && children}</div>
      {!configured && (
        <div className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-md w-[92%] rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-yellow-200 px-4 py-3 text-xs">
          Firebase isn&apos;t configured yet. The UI works but auth and data won&apos;t persist.
          Add <code className="text-yellow-100">NEXT_PUBLIC_FIREBASE_*</code> values in{" "}
          <code className="text-yellow-100">.env.local</code>.
        </div>
      )}
    </div>
  );
}
