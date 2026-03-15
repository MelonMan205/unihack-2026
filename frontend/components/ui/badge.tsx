import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[0.01em] transition-colors duration-300",
  {
    variants: {
      variant: {
        default:
          "border-yellow-300/75 bg-gradient-to-b from-yellow-300/95 via-yellow-300/90 to-yellow-400/95 text-amber-950 shadow-[0_5px_11px_rgba(161,98,7,0.16),0_1px_0_rgba(161,98,7,0.34),inset_0_1px_0_rgba(255,255,255,0.45)]",
        secondary: "border-transparent bg-zinc-100/90 text-zinc-700",
        outline:
          "border-zinc-300/85 bg-gradient-to-b from-white/95 to-zinc-100/90 text-zinc-700 shadow-[0_4px_9px_rgba(15,23,42,0.08),0_1px_0_rgba(148,163,184,0.22)] backdrop-blur",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
