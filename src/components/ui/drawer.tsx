"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Side drawer (DRVO UI kit). Same primitive as Dialog, docked to an inline
 * edge. `side="end"` is the reading end: left in Arabic RTL, right in LTR.
 * Use for record details and edit forms that keep the list visible behind.
 */
function Drawer(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />
}

type DrawerSide = "start" | "end"

// The app is RTL-first: inline start is the right edge, inline end the left.
const SIDE_CLASS: Record<DrawerSide, string> = {
  start: "inset-y-0 start-0 border-e data-open:slide-in-from-right data-closed:slide-out-to-right",
  end: "inset-y-0 end-0 border-s data-open:slide-in-from-left data-closed:slide-out-to-left",
}

function DrawerContent({
  className,
  children,
  side = "end",
  size = "md",
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: DrawerSide
  size?: "sm" | "md" | "lg"
  showCloseButton?: boolean
}) {
  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="drawer-overlay"
        className="fixed inset-0 isolate z-50 bg-foreground/25 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <DialogPrimitive.Popup
        data-slot="drawer-content"
        className={cn(
          "fixed z-50 flex h-full w-full flex-col bg-card text-sm text-foreground shadow-xl outline-none duration-200 data-open:animate-in data-closed:animate-out",
          width,
          SIDE_CLASS[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="drawer-close"
            render={<Button variant="ghost" size="icon-sm" className="absolute top-3 end-3" />}
          >
            <XIcon />
            <span className="sr-only">إغلاق</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1 border-b border-border px-5 py-4 pe-12", className)}
      {...props}
    />
  )
}

function DrawerBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="drawer-body" className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3", className)}
      {...props}
    />
  )
}

function DrawerTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="drawer-title" className={cn("text-base font-semibold", className)} {...props} />
}

function DrawerDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
