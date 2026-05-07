import { Logo } from "@/components/logo";
import { MarketingNav } from "@/components/nav";
import { adminDb } from "@/lib/firebase/admin";
import type { UserDoc } from "@/lib/types";
import { notFound } from "next/navigation";
import { SendMessageForm } from "./send-form";
import { Globe, ShieldCheck } from "lucide-react";

interface ProfileData {
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string;
  acceptedChains: UserDoc["settings"]["acceptedChains"];
  acceptedTokens: UserDoc["settings"]["acceptedTokens"];
  minThresholdUSD: number;
  wallets: UserDoc["wallets"];
  socials: NonNullable<UserDoc["socials"]>;
}

async function loadProfile(handle: string): Promise<ProfileData | null> {
  let snap;
  try {
    snap = await adminDb()
      .collection("users")
      .where("handleLower", "==", handle.toLowerCase())
      .limit(1)
      .get();
  } catch {
    // Admin not configured; render the page in "preview" mode so dev still sees the UI.
    return null;
  }
  if (snap.empty) return null;
  const doc = snap.docs[0].data() as UserDoc;
  return {
    handle: doc.handle,
    displayName: doc.displayName,
    bio: doc.bio || "",
    avatarUrl: doc.avatarUrl || "",
    acceptedChains: doc.settings.acceptedChains,
    acceptedTokens: doc.settings.acceptedTokens,
    minThresholdUSD: doc.settings.minThresholdUSD,
    wallets: doc.wallets,
    socials: (doc.socials || {}) as NonNullable<UserDoc["socials"]>,
  };
}

// Don't statically prerender – profiles are dynamic.
export const dynamic = "force-dynamic";

export default async function PublicProfile({
  params,
}: {
  params: { handle: string };
}) {
  const profile = await loadProfile(params.handle);
  if (!profile) {
    // Allow handle to still render in dev when admin SDK isn't configured.
    if (
      !process.env.FIREBASE_ADMIN_PROJECT_ID ||
      !process.env.FIREBASE_ADMIN_CLIENT_EMAIL ||
      !process.env.FIREBASE_ADMIN_PRIVATE_KEY
    ) {
      return <PreviewMissing handle={params.handle} />;
    }
    notFound();
  }

  return (
    <main className="min-h-screen">
      <MarketingNav />
      <section className="mx-auto max-w-3xl px-4 py-8 md:py-16">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-3xl font-black text-white shadow-glow overflow-hidden">
            {profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              profile.displayName.slice(0, 1).toUpperCase()
            )}
          </div>
          <h1 className="mt-4 text-2xl md:text-3xl font-bold">{profile.displayName}</h1>
          <p className="text-muted">@{profile.handle}</p>
          {profile.bio && (
            <p className="mt-4 max-w-md mx-auto text-sm text-muted">{profile.bio}</p>
          )}
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            {profile.socials.x && (
              <SocialChip icon={<XMark />} href={`https://x.com/${profile.socials.x}`}>
                {profile.socials.x}
              </SocialChip>
            )}
            {profile.socials.instagram && (
              <SocialChip
                icon={<IgMark />}
                href={`https://instagram.com/${profile.socials.instagram}`}
              >
                {profile.socials.instagram}
              </SocialChip>
            )}
            {profile.socials.website && (
              <SocialChip icon={<Globe size={14} />} href={profile.socials.website}>
                website
              </SocialChip>
            )}
          </div>
        </div>

        <div className="mt-8 glass rounded-2xl p-5 md:p-6 grid grid-cols-3 gap-3 text-center text-xs">
          <Stat label="Min tip" value={`$${profile.minThresholdUSD}`} />
          <Stat
            label="Chains"
            value={profile.acceptedChains
              .map((c) => (c === "ethereum" ? "ETH" : "SOL"))
              .join(" · ")}
          />
          <Stat label="Tokens" value={profile.acceptedTokens.join(" · ")} />
        </div>

        <SendMessageForm
          recipient={{
            handle: profile.handle,
            displayName: profile.displayName,
            wallets: profile.wallets,
            acceptedChains: profile.acceptedChains,
            acceptedTokens: profile.acceptedTokens,
            minThresholdUSD: profile.minThresholdUSD,
          }}
        />

        <div className="mt-6 text-xs text-muted text-center inline-flex items-center gap-1.5 justify-center w-full">
          <ShieldCheck size={14} className="text-emerald-400" />
          Funds go directly to {profile.displayName}. Pay to Chat never custodies them.
        </div>
      </section>
    </main>
  );
}

function PreviewMissing({ handle }: { handle: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold">Profile preview unavailable</h1>
        <p className="mt-2 text-sm text-muted">
          @{handle}&apos;s page renders from Firestore. Add the{" "}
          <code className="text-foreground">FIREBASE_ADMIN_*</code> env vars to load real
          profiles.
        </p>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-foreground font-semibold text-sm">{value}</div>
    </div>
  );
}

function SocialChip({
  icon,
  href,
  children,
}: {
  icon: React.ReactNode;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors border border-white/10 px-3 py-1 text-xs"
    >
      {icon}
      {children}
    </a>
  );
}

function XMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2H21l-6.5 7.43L22 22h-6.27l-4.91-6.42L5.16 22H2.4l6.94-7.94L2 2h6.41l4.44 5.87L18.244 2zm-2.2 18h1.5L7.94 4h-1.6l9.7 16z" />
    </svg>
  );
}

function IgMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.5" y2="6.5" />
    </svg>
  );
}
