import { cn } from "@/lib/utils";

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-500 to-brand-300 shadow-glow">
        <span className="text-white font-black leading-none text-lg">$</span>
        <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background" />
      </span>
      {withWordmark && (
        <span className="font-semibold tracking-tight text-base">
          Pay <span className="text-brand-300">to</span> Chat
        </span>
      )}
    </span>
  );
}
