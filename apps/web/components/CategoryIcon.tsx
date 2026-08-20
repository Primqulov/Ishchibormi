"use client";

import { useState } from "react";
import { Briefcase } from "lucide-react";

type Props = {
  icon?: string;
  name: string;
  className?: string;
};

/**
 * Renders admin-provided category icon URLs as images while retaining support
 * for old emoji values. A broken or missing URL falls back to a local icon, so
 * an external icon host can never leak its URL text into the layout.
 */
export function CategoryIcon({ icon, name, className = "h-5 w-5" }: Props) {
  const source = icon?.trim() || "";
  const isRemoteImage = /^https?:\/\//i.test(source);
  const [brokenSource, setBrokenSource] = useState<string | null>(null);

  if (isRemoteImage && brokenSource !== source) {
    return (
      // Category SVG URLs are intentionally rendered as images rather than
      // injected markup; this keeps third-party SVG content isolated.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={source}
        alt={`${name} ikonkasi`}
        className={`${className} block object-contain`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBrokenSource(source)}
      />
    );
  }

  if (source && !isRemoteImage) {
    return (
      <span
        className={`${className} inline-grid place-items-center`}
        role="img"
        aria-label={`${name} ikonkasi`}
      >
        {source}
      </span>
    );
  }

  return <Briefcase className={className} aria-label={`${name} ikonkasi`} />;
}
