"use client";
import Link from "next/link";

/** Figma "Logo": Inter Black 21px, -0.3px tracking — "Ishchi" primary/blue, "Bormi" accent/orange. */
export function Logo({ href = "/", size = "md" }: { href?: string; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-2xl" : size === "sm" ? "text-lg" : "text-[21px]";
  return (
    <Link href={href} className={`font-black tracking-[-0.3px] leading-none ${cls} shrink-0`}>
      <span style={{ color: "var(--brand)" }}>Ishchi</span>
      <span style={{ color: "var(--accent)" }}>Bormi</span>
    </Link>
  );
}
