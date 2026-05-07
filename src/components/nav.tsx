"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Button } from "./ui";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";
import { Inbox, Send, Settings, LogOut, User as UserIcon } from "lucide-react";

const tabs = [
  { href: "/a/dashboard", label: "Inbox", Icon: Inbox },
  { href: "/a/dashboard/sent", label: "Sent", Icon: Send },
  { href: "/a/dashboard/settings", label: "Settings", Icon: Settings },
];

export function MarketingNav() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-center">
          <Logo />
        </Link>
        <nav className="flex items-center gap-2">
          {user ? (
            <Link href="/a/dashboard">
              <Button size="sm">Open inbox</Button>
            </Link>
          ) : (
            <>
              <Link href="/a/sign-in" className="text-sm text-muted hover:text-foreground px-3 py-2">
                Sign in
              </Link>
              <Link href="/a/sign-up">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function AppNav() {
  const pathname = usePathname();
  const { profile, signOutUser } = useAuth();
  return (
    <>
      {/* Top bar */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/60 border-b border-white/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/a/dashboard" className="flex items-center">
            <Logo />
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {tabs.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                  pathname === href
                    ? "bg-white/10 text-foreground"
                    : "text-muted hover:text-foreground hover:bg-white/5"
                )}
              >
                <Icon size={16} /> {label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {profile && (
              <Link
                href={`/${profile.handle}`}
                className="hidden md:inline-flex items-center gap-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors px-3 py-1.5 text-sm border border-white/10"
                title="View your public page"
              >
                <UserIcon size={14} />
                @{profile.handle}
              </Link>
            )}
            <button
              onClick={() => signOutUser()}
              title="Sign out"
              className="p-2 rounded-lg text-muted hover:text-foreground hover:bg-white/5"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Bottom mobile nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-background/80 border-t border-white/5">
        <div className="grid grid-cols-3">
          {tabs.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs",
                pathname === href ? "text-brand-300" : "text-muted"
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
