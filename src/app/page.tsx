import Link from "next/link";
import { MarketingNav } from "@/components/nav";
import { TokenSection } from "@/components/token-section";
import { Button } from "@/components/ui";
import {
  Wallet,
  Coins,
  ShieldCheck,
  Zap,
  HandCoins,
  Eye,
  ArrowRight,
} from "lucide-react";

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <MarketingNav />

      {/* Hero */}
      <section className="relative mx-auto max-w-6xl px-4 pt-12 pb-24 md:pt-24 md:pb-32 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Live on
          paytochat.fun
        </div>
        <h1 className="mt-6 text-5xl md:text-7xl font-black tracking-tight leading-[1.05] text-balance">
          Make people <span className="gradient-text">pay</span> to land in your inbox.
        </h1>
        <p className="mt-6 text-lg md:text-xl text-muted max-w-2xl mx-auto text-balance">
          Spam, marketing blasts, cold pitches — your attention is worth more.
          Senders attach <span className="text-foreground">USDC, USDT, USDG, or PUSD</span> on Solana or
          Ethereum. The tip amount stays hidden until you tap to reveal.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/a/sign-up">
            <Button size="lg" className="px-8">
              Claim your link <ArrowRight size={18} />
            </Button>
          </Link>
          <Link href="/a/sign-in">
            <Button size="lg" variant="outline" className="px-8">
              I already have an account
            </Button>
          </Link>
        </div>
        <div className="mt-6 flex justify-center">
          <a
            href="https://t.me/paytochat"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted hover:text-foreground hover:border-white/20 transition-colors"
          >
            <TelegramIcon className="h-3.5 w-3.5" /> Join the community on Telegram
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 pb-20">
        <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-center mb-12">
          How it works
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              Icon: Wallet,
              title: "1. Connect your wallets",
              body: "Drop in an Ethereum address and a Solana address. Set thresholds for what gets through and what triggers a notification.",
            },
            {
              Icon: HandCoins,
              title: "2. Share your link",
              body: "paytochat.fun/yourname. Drop it in your X bio, your IG link tree, your email signature. Senders pay USDC, USDT, USDG, or PUSD directly to your wallet.",
            },
            {
              Icon: Eye,
              title: "3. Tap to reveal",
              body: "The tip amount stays hidden until you tap to open the message. Once opened, the sender gets a read receipt and you keep the tip.",
            },
          ].map(({ Icon, title, body }) => (
            <div
              key={title}
              className="glass rounded-2xl p-6 hover:border-brand/30 transition-colors"
            >
              <Icon className="text-brand-300" size={28} />
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="grid md:grid-cols-2 gap-4">
          <Feature
            Icon={Coins}
            title="USDC, USDT, USDG, PUSD — on the chain you choose"
            body="Stablecoins only — no price guessing. Senders pick Solana for sub-cent fees or Ethereum for the network they already use. You receive on your own wallet, instantly."
          />
          <Feature
            Icon={Zap}
            title="Cool-off reply window"
            body="Every paid message unlocks a 24-hour window where both sides can reply free in the thread. Once it closes, a fresh paid message reopens the chat — so the meter only runs at the start of each conversation."
          />
          <Feature
            Icon={ShieldCheck}
            title="No middleman"
            body="We never hold the money. The Pay to Chat server only verifies the on-chain transaction matches the message and unlocks the reveal."
          />
          <Feature
            Icon={Eye}
            title="The amount stays hidden"
            body="The whole point: the recipient can't pre-judge by tip size. They have to read the message first. Then they swipe to learn what it was worth."
          />
        </div>
      </section>

      {/* $PTC Token */}
      <section id="token" className="mx-auto max-w-6xl px-4 pb-24 scroll-mt-20">
        <TokenSection />
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-4 pb-32 text-center">
        <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-balance">
          Your inbox isn&apos;t a free dumping ground.
        </h2>
        <p className="mt-4 text-muted text-lg">Charge what your time is worth.</p>
        <Link href="/a/sign-up" className="inline-block mt-8">
          <Button size="lg" className="px-8">
            Claim your handle <ArrowRight size={18} />
          </Button>
        </Link>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-muted">
        <div className="flex flex-col items-center gap-3">
          <a
            href="https://t.me/paytochat"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted hover:text-foreground transition-colors"
          >
            <TelegramIcon className="h-4 w-4" /> @paytochat on Telegram
          </a>
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
          </nav>
          <p>
            paytochat.fun · Built on Firebase, Solana &amp; Ethereum · Stablecoins are
            subject to issuer terms.
          </p>
        </div>
      </footer>
    </main>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M21.94 4.34a1.5 1.5 0 0 0-1.6-.23L2.9 11.3a1.2 1.2 0 0 0 .07 2.24l4.27 1.42 1.65 5.28a1 1 0 0 0 1.66.45l2.46-2.27 4.4 3.23a1.4 1.4 0 0 0 2.2-.84l3.04-14.78a1.5 1.5 0 0 0-.71-1.69ZM9.7 14.7l8.7-7.7-7.18 8.34a1 1 0 0 0-.25.55l-.36 2.4-.91-3.6Z" />
    </svg>
  );
}

function Feature({
  Icon,
  title,
  body,
}: {
  Icon: typeof Wallet;
  title: string;
  body: string;
}) {
  return (
    <div className="glass rounded-2xl p-6">
      <Icon className="text-brand-300" size={24} />
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted">{body}</p>
    </div>
  );
}
