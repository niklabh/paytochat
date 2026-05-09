"use client";

import { useEffect, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase/client";
import { Button, Card, Input, Label, Switch } from "@/components/ui";
import { toast } from "sonner";
import { Copy, ExternalLink, Save, Check } from "lucide-react";
import type { Chain, Token } from "@/lib/types";

export default function SettingsPage() {
  const { user, profile } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [ethAddr, setEthAddr] = useState("");
  const [solAddr, setSolAddr] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [igHandle, setIgHandle] = useState("");
  const [website, setWebsite] = useState("");
  const [minThreshold, setMinThreshold] = useState(1);
  const [notifyThreshold, setNotifyThreshold] = useState(10);
  const [coolOffDays, setCoolOffDays] = useState(1);
  const [autoReply, setAutoReply] = useState("");
  const [acceptEth, setAcceptEth] = useState(true);
  const [acceptSol, setAcceptSol] = useState(true);
  const [acceptUSDC, setAcceptUSDC] = useState(true);
  const [acceptUSDT, setAcceptUSDT] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName || "");
    setBio(profile.bio || "");
    setEthAddr(profile.wallets?.ethereum || "");
    setSolAddr(profile.wallets?.solana || "");
    setXHandle(profile.socials?.x || "");
    setIgHandle(profile.socials?.instagram || "");
    setWebsite(profile.socials?.website || "");
    setMinThreshold(profile.settings.minThresholdUSD);
    setNotifyThreshold(profile.settings.notifyThresholdUSD);
    setCoolOffDays(profile.settings.coolOffDays);
    setAutoReply(profile.settings.autoReplyTemplate || "");
    setAcceptEth(profile.settings.acceptedChains.includes("ethereum"));
    setAcceptSol(profile.settings.acceptedChains.includes("solana"));
    setAcceptUSDC(profile.settings.acceptedTokens.includes("USDC"));
    setAcceptUSDT(profile.settings.acceptedTokens.includes("USDT"));
    setEmailNotifications(profile.settings.emailNotifications ?? true);
  }, [profile]);

  async function save() {
    if (!user || !profile) return;
    setBusy(true);
    try {
      const acceptedChains: Chain[] = [
        ...(acceptSol ? (["solana"] as const) : []),
        ...(acceptEth ? (["ethereum"] as const) : []),
      ];
      const acceptedTokens: Token[] = [
        ...(acceptUSDC ? (["USDC"] as const) : []),
        ...(acceptUSDT ? (["USDT"] as const) : []),
      ];
      if (acceptedChains.length === 0)
        throw new Error("Pick at least one chain.");
      if (acceptedTokens.length === 0) throw new Error("Pick at least one token.");

      await updateDoc(doc(db, "users", user.uid), {
        displayName: displayName.trim() || profile.handle,
        bio: bio.trim().slice(0, 280),
        "wallets.ethereum": ethAddr.trim() || null,
        "wallets.solana": solAddr.trim() || null,
        "socials.x": xHandle.replace(/^@/, "") || null,
        "socials.instagram": igHandle.replace(/^@/, "") || null,
        "socials.website": website.trim() || null,
        "settings.minThresholdUSD": Number(minThreshold) || 0,
        "settings.notifyThresholdUSD": Number(notifyThreshold) || 0,
        "settings.coolOffDays": Number(coolOffDays) || 0,
        "settings.autoReplyTemplate": autoReply.slice(0, 280),
        "settings.acceptedChains": acceptedChains,
        "settings.acceptedTokens": acceptedTokens,
        "settings.emailNotifications": emailNotifications,
      });
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return <div className="text-muted">Loading…</div>;
  }

  const profileUrl = `https://paytochat.fun/${profile.handle}`;
  const interpolatedAutoReply = autoReply.replace("{handle}", profile.handle);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <h2 className="text-lg font-semibold">Profile</h2>
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <Field label="Handle">
            <Input value={profile.handle} disabled />
          </Field>
          <Field label="Display name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Bio" className="md:col-span-2">
            <Input
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What kind of messages do you want?"
              maxLength={280}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Receive wallets</h2>
        <p className="mt-1 text-sm text-muted">
          Senders pay USDC / USDT directly to these addresses. We never custody funds.
        </p>
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <Field label="Ethereum address (mainnet)">
            <Input
              placeholder="0x…"
              value={ethAddr}
              onChange={(e) => setEthAddr(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field label="Solana address">
            <Input
              placeholder="solana base58 address"
              value={solAddr}
              onChange={(e) => setSolAddr(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Filters & thresholds</h2>
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          <Field label="Minimum tip (USD)">
            <Input
              type="number"
              min={0}
              step="0.5"
              value={minThreshold}
              onChange={(e) => setMinThreshold(parseFloat(e.target.value || "0"))}
            />
          </Field>
          <Field label="Notify me above (USD)">
            <Input
              type="number"
              min={0}
              step="0.5"
              value={notifyThreshold}
              onChange={(e) => setNotifyThreshold(parseFloat(e.target.value || "0"))}
            />
          </Field>
          <Field label="Cool-off (days)">
            <Input
              type="number"
              min={0}
              step="1"
              value={coolOffDays}
              onChange={(e) => setCoolOffDays(parseInt(e.target.value || "0"))}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">
          After a paid message lands, the sender can reply free for the cool-off
          window. Set 0 to disable.
        </p>

        <div className="mt-6 grid md:grid-cols-2 gap-3">
          <div>
            <Label>Accepted chains</Label>
            <div className="mt-2 flex flex-col gap-2">
              <Switch checked={acceptSol} onChange={setAcceptSol} label="Solana" />
              <Switch checked={acceptEth} onChange={setAcceptEth} label="Ethereum" />
            </div>
          </div>
          <div>
            <Label>Accepted tokens</Label>
            <div className="mt-2 flex flex-col gap-2">
              <Switch checked={acceptUSDC} onChange={setAcceptUSDC} label="USDC" />
              <Switch checked={acceptUSDT} onChange={setAcceptUSDT} label="USDT" />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted">
          Get an email whenever a paid message lands in your inbox. Subject
          to the &ldquo;notify above&rdquo; threshold — free in-thread
          replies never email. The email itself never includes the message
          content or the tip amount; you have to open the inbox to see
          either.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-white/3 border border-white/5 px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Email me about new messages</div>
            <div className="text-xs text-muted">
              Sent to {user?.email || "your account email"}.
            </div>
          </div>
          <Switch
            checked={emailNotifications}
            onChange={setEmailNotifications}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Socials</h2>
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          <Field label="X / Twitter">
            <Input
              placeholder="username"
              value={xHandle}
              onChange={(e) => setXHandle(e.target.value)}
            />
          </Field>
          <Field label="Instagram">
            <Input
              placeholder="username"
              value={igHandle}
              onChange={(e) => setIgHandle(e.target.value)}
            />
          </Field>
          <Field label="Website">
            <Input
              placeholder="https://…"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">DM auto-reply</h2>
        <p className="mt-1 text-sm text-muted">
          Paste this into any X or Instagram DM request. Use{" "}
          <code className="text-foreground">{`{handle}`}</code> to insert your handle.
        </p>
        <textarea
          className="mt-3 min-h-24 w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm focus:outline-none focus:border-brand/60 resize-none"
          rows={3}
          value={autoReply}
          onChange={(e) => setAutoReply(e.target.value)}
          maxLength={280}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyChip
            label="Copy reply"
            value={interpolatedAutoReply}
          />
          <CopyChip label="Copy my link" value={profileUrl} />
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(
              `${interpolatedAutoReply}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs border border-white/10"
          >
            <ExternalLink size={12} /> Tweet it
          </a>
        </div>
        <p className="mt-3 text-xs text-muted">
          Real auto-DM replies require X/Instagram OAuth and are subject to those
          platforms&apos; terms — for now, paste manually.
        </p>
      </Card>

      <div className="sticky bottom-20 md:bottom-4 flex justify-end">
        <Button onClick={save} disabled={busy} size="lg" className="shadow-lg">
          {busy ? "Saving…" : (
            <>
              <Save size={16} /> Save changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className || ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success("Copied");
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs border border-white/10"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {label}
    </button>
  );
}
