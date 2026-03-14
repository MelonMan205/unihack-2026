"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export const SheetPortal = Dialog.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof Dialog.Overlay>,
  React.ComponentPropsWithoutRef<typeof Dialog.Overlay>
>(({ className, ...props }, ref) => (
  <Dialog.Overlay
    className={cn(
      "fixed inset-0 z-[1390] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.24),rgba(15,23,42,0.45))] backdrop-blur-[2px]",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = Dialog.Overlay.displayName;

type SheetContentProps = React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
  side?: "bottom";
};

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof Dialog.Content>,
  SheetContentProps
>(({ className, children, side = "bottom", ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <Dialog.Content
      ref={ref}
      className={cn(
        "fixed z-[1400] bg-white shadow-2xl transition ease-out",
        side === "bottom" ? "inset-x-0 bottom-0" : "",
        className,
      )}
      {...props}
    >
      {children}
      <Dialog.Close className="absolute right-4 top-4 rounded-full p-1 text-zinc-500 transition hover:bg-zinc-100">
        <X className="h-4 w-4" />
      </Dialog.Close>
    </Dialog.Content>
  </SheetPortal>
));
SheetContent.displayName = Dialog.Content.displayName;

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5", className)} {...props} />
);

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof Dialog.Title>,
  React.ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title ref={ref} className={cn("font-semibold tracking-tight", className)} {...props} />
));
SheetTitle.displayName = Dialog.Title.displayName;

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof Dialog.Description>,
  React.ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description ref={ref} className={cn("text-sm text-zinc-500", className)} {...props} />
));
SheetDescription.displayName = Dialog.Description.displayName;
