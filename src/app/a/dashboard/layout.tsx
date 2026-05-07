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
  const { user, loading, configured } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user && configured) router.replace("/a/sign-in");
  }, [loading, user, configured, router]);

  return (
    <div className="min-h-screen pb-20 md:pb-8">
      <AppNav />
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
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
