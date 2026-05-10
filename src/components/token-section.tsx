"use client";

import { useState } from "react";
import { Button } from "./ui";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Vote,
} from "lucide-react";

const PTC_MINT = "4kS1dgYJ4d5ZaNf6BiiMrngAxKDqnEdKnvWCF9HYpump";
const PTC_PUMP_URL = `https://pump.fun/coin/${PTC_MINT}`;

export function TokenSection() {
  const [copied, setCopied] = useState(false);
  const shortMint = `${PTC_MINT.slice(0, 6)}…${PTC_MINT.slice(-6)}`;

  async function copyMint() {
    try {
      await navigator.clipboard.writeText(PTC_MINT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore
    }
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-500/10 via-white/5 to-transparent p-8 md:p-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-brand-300/10 blur-3xl"
      />

      <div className="relative grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-muted">
            <Vote size={12} className="text-brand-300" /> Governance token
          </div>
          <h2 className="mt-4 text-3xl md:text-5xl font-bold tracking-tight text-balance">
            Meet <span className="gradient-text">$PTC</span> — the Pay to Chat token.
          </h2>
          <p className="mt-4 text-base md:text-lg text-muted max-w-xl text-balance">
            $PTC is the governance token for paytochat. Holders shape protocol
            decisions — fee splits, supported chains, reveal mechanics, and the
            future of the inbox economy.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <a href={PTC_PUMP_URL} target="_blank" rel="noopener noreferrer">
              <Button size="lg" className="w-full sm:w-auto px-8">
                Buy $PTC on Pump.fun <ExternalLink size={16} />
              </Button>
            </a>
            <a href={PTC_PUMP_URL} target="_blank" rel="noopener noreferrer">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto px-8"
              >
                View chart <ArrowRight size={16} />
              </Button>
            </a>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 md:p-7 border border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-brand-500 to-brand-300 flex items-center justify-center text-white font-bold shadow-glow">
                PTC
              </div>
              <div>
                <div className="text-sm text-muted">Token</div>
                <div className="font-semibold">Pay to Chat</div>
              </div>
            </div>
            <span className="rounded-full bg-white/8 border border-white/10 px-2.5 py-1 text-xs">
              $PTC
            </span>
          </div>

          <dl className="mt-6 space-y-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Network</dt>
              <dd className="font-medium">Solana</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Utility</dt>
              <dd className="font-medium">Governance</dd>
            </div>
            <div className="space-y-2">
              <dt className="text-muted">Mint address</dt>
              <dd>
                <button
                  type="button"
                  onClick={copyMint}
                  title="Copy mint address"
                  className="group flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left font-mono text-xs hover:bg-white/10 transition-colors"
                >
                  <span className="truncate">
                    <span className="hidden sm:inline">{PTC_MINT}</span>
                    <span className="sm:hidden">{shortMint}</span>
                  </span>
                  {copied ? (
                    <Check size={14} className="text-emerald-400 shrink-0" />
                  ) : (
                    <Copy
                      size={14}
                      className="text-muted group-hover:text-foreground shrink-0"
                    />
                  )}
                </button>
              </dd>
            </div>
          </dl>

          <p className="mt-5 text-xs text-muted">
            Tokens are speculative. $PTC is a governance token for the paytochat
            community — not investment advice.
          </p>
        </div>
      </div>
    </div>
  );
}
