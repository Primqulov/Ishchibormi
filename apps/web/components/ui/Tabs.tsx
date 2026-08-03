"use client";
import * as React from "react";

interface Item { value: string; label: React.ReactNode; count?: number; }

export function Tabs({
  items, value, onChange, className = "",
}: {
  items: Item[]; value: string; onChange: (v: string) => void; className?: string;
}) {
  return (
    <div className={`card p-1 inline-flex w-full sm:w-auto ${className}`}>
      {items.map((it) => {
        const active = value === it.value;
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={`flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-[0.625rem] text-sm transition ${
              active
                ? "bg-brand-navy text-white shadow-sm"
                : "muted hover:text-[color:var(--text)]"
            }`}
          >
            <span>{it.label}</span>
            {typeof it.count === "number" && (
              <span
                className={`text-2xs px-1.5 py-0.5 rounded-full ${
                  active ? "bg-white/20" : "bg-[color:var(--bg-subtle)]"
                }`}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
