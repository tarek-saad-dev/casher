"use client";

import { useDbToggle } from "@/hooks/useDbToggle";
import { Database, Cloud, Server, Loader2 } from "lucide-react";

export function DbToggleButton() {
  const { currentTarget, isLoading, toggle, dbInfo } = useDbToggle();

  if (currentTarget === null) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 text-gray-400 rounded-md cursor-wait"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
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
        flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md
        transition-all duration-200 ease-in-out
        ${isLocal 
          ? "bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-300" 
          : "bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-300"
        }
        ${isLoading ? "opacity-70 cursor-wait" : "cursor-pointer"}
      `}
      title={isLocal 
        ? `الخادم المحلي: ${dbInfo?.local.server || "localhost"}` 
        : `السحابة: ${dbInfo?.cloud.server || "cloud"}`
      }
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isLocal ? (
        <Server className="w-4 h-4" />
      ) : (
        <Cloud className="w-4 h-4" />
      )}
      
      <span className="hidden sm:inline">
        {isLocal ? "الخادم المحلي" : "السحابة"}
      </span>
      
      <span className="sm:hidden">
        {isLocal ? "محلي" : "سحابة"}
      </span>
      
      <span className={`
        w-2 h-2 rounded-full
        ${isLocal ? "bg-blue-500" : "bg-purple-500"}
        ${isLoading ? "animate-pulse" : ""}
      `} />
    </button>
  );
}
