"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { setAnalyticsUser, trackEvent } from "@/lib/firebase/client";

// Next.js App Router doesn't auto-fire Firebase Analytics' default
// `page_view` event the way the gtag snippet does, because client-side
// navigations don't trigger a full page load. We listen to pathname +
// search-param changes and emit one `page_view` per resolved route.
//
// `useSearchParams` opts the entire subtree into client-side rendering, so
// we isolate it inside a Suspense boundary to keep the rest of the app
// statically renderable.
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const search = searchParams?.toString();
    const path = search ? `${pathname}?${search}` : pathname;
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}${path}`
        : path;
    trackEvent("page_view", {
      page_path: path,
      page_location: url,
      page_title: typeof document !== "undefined" ? document.title : undefined,
    });
  }, [pathname, searchParams]);

  return null;
}

function UserIdTracker() {
  const { user } = useAuth();
  useEffect(() => {
    setAnalyticsUser(user?.uid ?? null);
  }, [user]);
  return null;
}

export function AnalyticsTracker() {
  return (
    <>
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
      <UserIdTracker />
    </>
  );
}
