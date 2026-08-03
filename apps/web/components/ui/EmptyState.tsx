"use client";
import * as React from "react";

interface Props {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <div className="card flex flex-col items-center text-center py-12 px-6 animate-fade-in">
      {icon && (
        <div className="h-14 w-14 grid place-items-center rounded-2xl mb-4" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          {icon}
        </div>
      )}
      <h3 className="font-semibold heading">{title}</h3>
      {body && <p className="mt-1 text-sm muted max-w-md">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
