"use client";
import * as React from "react";
import { safeImageSrc } from "@/lib/url";

interface Props {
  name?: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  online?: boolean;
}

const sz = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80 } as const;
const ts = { xs: 11, sm: 12, md: 14, lg: 18, xl: 24 } as const;

function initials(name?: string) {
  if (!name) return "?";
  // Ism o'rniga telefon raqami kelib qolsa ("+998…"), undan "+9" kabi bosh
  // harf yasamaymiz — faqat harflarni hisobga olamiz.
  const parts = name.trim().split(/\s+/).filter((p) => /\p{L}/u.test(p));
  const a = parts[0]?.match(/\p{L}/u)?.[0] || "";
  const b = parts[1]?.match(/\p{L}/u)?.[0] || "";
  return (a + b).toUpperCase() || "?";
}

// Figma dizaynida avatar doim bir xil: ochiq ko'k fon (bg/blue-100) va
// primary/blue harflar. Shuning uchun rang nomga qarab o'zgarmaydi.
function colorFor(_name?: string) {
  return { bg: "var(--brand-100)", fg: "var(--brand)" };
}

export function Avatar({ name, src, size = "md", online }: Props) {
  const px = sz[size];
  const fs = ts[size];
  const { bg, fg } = colorFor(name);
  const safeSrc = safeImageSrc(src);
  return (
    <div className="relative inline-flex shrink-0">
      {safeSrc ? (
        <img
          src={safeSrc} alt={name || ""}
          width={px} height={px}
          className="rounded-full object-cover"
          style={{ width: px, height: px }}
        />
      ) : (
        <div
          className="rounded-full grid place-items-center font-bold"
          style={{ width: px, height: px, background: bg, color: fg, fontSize: fs }}
        >
          {initials(name)}
        </div>
      )}
      {online && (
        <span
          className="absolute bottom-0 right-0 ring-2 rounded-full"
          style={{
            width: Math.max(8, px * 0.22),
            height: Math.max(8, px * 0.22),
            background: "#16A34A",
            // @ts-ignore
            "--tw-ring-color": "var(--card)",
          }}
        />
      )}
    </div>
  );
}
