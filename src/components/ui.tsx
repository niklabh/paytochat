"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type HTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost" | "outline" | "danger";
    size?: "sm" | "md" | "lg";
  }
>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all select-none",
        "focus:outline-none focus:ring-2 focus:ring-brand/50 focus:ring-offset-2 focus:ring-offset-background",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" && "h-9 px-3 text-sm",
        size === "md" && "h-11 px-5 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        variant === "primary" &&
          "bg-gradient-to-tr from-brand-500 to-brand-300 text-white shadow-glow hover:from-brand-400 hover:to-brand-200 active:scale-[0.98]",
        variant === "ghost" &&
          "bg-white/5 text-foreground hover:bg-white/10 border border-transparent",
        variant === "outline" &&
          "border border-white/10 bg-transparent hover:bg-white/5",
        variant === "danger" &&
          "bg-red-500/90 text-white hover:bg-red-500 active:scale-[0.98]",
        className
      )}
      {...props}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm",
          "placeholder:text-muted focus:outline-none focus:border-brand/60 focus:bg-white/10",
          "transition-colors",
          className
        )}
        {...props}
      />
    );
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-24 w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm",
          "placeholder:text-muted focus:outline-none focus:border-brand/60 focus:bg-white/10",
          "transition-colors resize-none",
          className
        )}
        {...props}
      />
    );
  }
);

export function Card({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "glass rounded-2xl p-6 border border-white/10",
        className
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium uppercase tracking-wider text-muted", className)}
      {...props}
    />
  );
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-white/8 px-2.5 py-1 text-xs text-foreground border border-white/10",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-3 select-none",
        "focus:outline-none focus:ring-2 focus:ring-brand/40 rounded-full"
      )}
    >
      <span
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors",
          checked ? "bg-brand-500" : "bg-white/15"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            checked && "translate-x-5"
          )}
        />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  );
}
