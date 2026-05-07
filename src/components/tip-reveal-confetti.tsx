"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// lottie-react pulls in lottie-web, which touches `document` at import time —
// load it on the client only.
const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

interface Props {
  /**
   * Bumping this value (e.g. with `Date.now()`) plays the animation once.
   * Pass `null` to do nothing.
   */
  trigger: number | null;
  /** Optional amount label rendered behind the burst. */
  amountLabel?: string;
}

type AnimationData = unknown;

export function TipRevealConfetti({ trigger, amountLabel }: Props) {
  const [data, setData] = useState<AnimationData | null>(null);
  const [playId, setPlayId] = useState<number | null>(null);
  const lastTrigger = useRef<number | null>(null);

  // Lazy-load the (heavy) JSON the first time we need it, then keep it.
  useEffect(() => {
    if (trigger === null || data !== null) return;
    let cancelled = false;
    import("@/lotties/tip-reveal.json").then((mod) => {
      if (!cancelled) setData(mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [trigger, data]);

  // React to a new trigger value.
  useEffect(() => {
    if (trigger === null) return;
    if (trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    setPlayId(trigger);
  }, [trigger]);

  if (playId === null || data === null) return null;

  return (
    <div
      key={playId}
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      aria-hidden
    >
      {amountLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-6 py-3 text-2xl font-black text-emerald-200 shadow-glow">
            +{amountLabel}
          </div>
        </div>
      )}
      <div className="w-[min(90vw,640px)] aspect-square">
        <Lottie
          animationData={data}
          loop={false}
          autoplay
          onComplete={() => setPlayId(null)}
        />
      </div>
    </div>
  );
}
