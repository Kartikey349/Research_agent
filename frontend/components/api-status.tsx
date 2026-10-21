"use client";

import { useEffect, useState } from "react";

import { checkHealth } from "@/lib/api";

type Health = "checking" | "online" | "offline";

const healthStyles: Record<Health, string> = {
  checking: "bg-stone-400",
  online: "bg-emerald-600",
  offline: "bg-red-500",
};

const healthLabels: Record<Health, string> = {
  checking: "Checking API",
  online: "API online",
  offline: "API offline",
};

export default function ApiStatus() {
  const [health, setHealth] = useState<Health>("checking");

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        await checkHealth();

        if (active) {
          setHealth("online");
        }
      } catch {
        if (active) {
          setHealth("offline");
        }
      }
    }

    void check();
    const interval = window.setInterval(check, 30000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <div
      className="flex items-center gap-2 text-xs text-stone-500"
      role="status"
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${healthStyles[health]}`}
        aria-hidden="true"
      />
      <span>{healthLabels[health]}</span>
    </div>
  );
}
