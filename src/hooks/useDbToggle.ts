"use client";

import { useState, useEffect, useCallback } from "react";

type DbTarget = "local" | "cloud";

interface DbInfo {
  target: DbTarget;
  local: {
    server: string;
    database: string;
  };
  cloud: {
    server: string;
    database: string;
  };
}

interface UseDbToggleReturn {
  currentTarget: DbTarget | null;
  isLoading: boolean;
  error: string | null;
  toggle: () => Promise<void>;
  setTarget: (target: DbTarget) => Promise<void>;
  refresh: () => Promise<void>;
  dbInfo: DbInfo | null;
}

export function useDbToggle(): UseDbToggleReturn {
  const [currentTarget, setCurrentTarget] = useState<DbTarget | null>(null);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/db/toggle");
      const data = await response.json();
      
      if (data.success) {
        setCurrentTarget(data.currentTarget);
        setDbInfo({
          target: data.currentTarget,
          local: data.local,
          cloud: data.cloud,
        });
        setError(null);
      } else {
        setError(data.error || "فشل في جلب حالة الاتصال");
      }
    } catch (err) {
      setError("فشل في الاتصال بالخادم");
    }
  }, []);

  const toggle = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch("/api/db/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCurrentTarget(data.currentTarget);
        setDbInfo({
          target: data.currentTarget,
          local: data.local,
          cloud: data.cloud,
        });
        // Reload page to ensure all data comes from new database
        window.location.reload();
      } else {
        setError(data.error || "فشل في التبديل");
      }
    } catch (err) {
      setError("فشل في الاتصال بالخادم");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setTarget = useCallback(async (target: DbTarget) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch("/api/db/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCurrentTarget(data.currentTarget);
        setDbInfo({
          target: data.currentTarget,
          local: data.local,
          cloud: data.cloud,
        });
        // Reload page to ensure all data comes from new database
        window.location.reload();
      } else {
        setError(data.error || "فشل في تغيير الاتصال");
      }
    } catch (err) {
      setError("فشل في الاتصال بالخادم");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    currentTarget,
    isLoading,
    error,
    toggle,
    setTarget,
    refresh: fetchStatus,
    dbInfo,
  };
}
