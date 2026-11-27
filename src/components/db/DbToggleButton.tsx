"use client";

import { useDbToggle } from "@/hooks/useDbToggle";
import { Database, Cloud, Server, Loader2 } from "lucide-react";

export function DbToggleButton() {
  const { currentTarget, isLoading, toggle, dbInfo } = useDbToggle();

  if (currentTarget === null) {
    return (
      <button
        disabled
        className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 text-xs text-muted-foreground cursor-wait"
      >
        <Loader2 className="size-3.5 animate-spin" />
        <span>جاري التحميل...</span>
      </button>
    );
  }

  const isLocal = currentTarget === "local";

  return (
    <button
      onClick={toggle}
      disabled={isLoading}
      className={`
        flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold
        transition-colors
        ${isLocal 
          ? "bg-info-soft text-info border-info/25 hover:bg-info/15" 
          : "bg-brand-soft text-brand border-brand/20 hover:bg-brand/15"
        }
        ${isLoading ? "opacity-70 cursor-wait" : "cursor-pointer"}
      `}
      title={isLocal 
        ? `الخادم المحلي: ${dbInfo?.local.server || "localhost"}` 
        : `السحابة: ${dbInfo?.cloud.server || "cloud"}`
      }
    >
      {isLoading ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : isLocal ? (
        <Server className="size-3.5" />
      ) : (
        <Cloud className="size-3.5" />
      )}
      
      <span className="hidden sm:inline">
        {isLocal ? "الخادم المحلي" : "السحابة"}
      </span>
      
      <span className="sm:hidden">
        {isLocal ? "محلي" : "سحابة"}
      </span>
      
      <span className={`
        size-1.5 rounded-full bg-current
        ${isLoading ? "animate-pulse" : ""}
      `} />
    </button>
  );
}
