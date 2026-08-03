"use client";
import * as React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  padded?: boolean;
  hover?: boolean;
}

export function Card({ elevated, padded = true, hover, className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={[
        elevated ? "card-elevated" : "card",
        padded ? "p-5" : "",
        hover ? "transition hover:shadow-pop hover:-translate-y-0.5" : "",
        className,
      ].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="font-semibold heading text-base leading-tight">{title}</h3>
        {subtitle && <p className="text-sm muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
