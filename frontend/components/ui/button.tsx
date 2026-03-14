import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300 disabled:pointer-events-none disabled:opacity-50 active:translate-y-[1px]",
  {
    variants: {
      variant: {
        default:
          "border border-yellow-300/75 bg-gradient-to-b from-yellow-400/95 via-yellow-400/95 to-yellow-500/95 text-zinc-900 shadow-[0_7px_14px_rgba(161,98,7,0.2),0_2px_0_rgba(161,98,7,0.35)] hover:-translate-y-[1px] hover:from-yellow-300/95 hover:to-yellow-500/95 hover:shadow-[0_10px_20px_rgba(161,98,7,0.22),0_2px_0_rgba(161,98,7,0.38)] active:shadow-[0_4px_9px_rgba(161,98,7,0.18),0_1px_0_rgba(161,98,7,0.28)]",
        outline:
          "border border-white/85 bg-gradient-to-b from-white/95 to-zinc-100/92 text-zinc-800 shadow-[0_7px_14px_rgba(15,23,42,0.12),0_2px_0_rgba(148,163,184,0.3)] backdrop-blur-xl hover:-translate-y-[1px] hover:from-white hover:to-zinc-100 hover:shadow-[0_10px_20px_rgba(15,23,42,0.15),0_2px_0_rgba(148,163,184,0.34)] active:shadow-[0_4px_9px_rgba(15,23,42,0.12),0_1px_0_rgba(148,163,184,0.24)]",
        secondary:
          "border border-zinc-200/80 bg-gradient-to-b from-zinc-50 to-zinc-200/90 text-zinc-900 shadow-[0_8px_18px_rgba(15,23,42,0.16),0_2px_0_rgba(113,113,122,0.28)] hover:-translate-y-[1px] hover:from-white hover:to-zinc-200 active:shadow-[0_4px_10px_rgba(15,23,42,0.12),0_1px_0_rgba(113,113,122,0.24)]",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);

Button.displayName = "Button";
