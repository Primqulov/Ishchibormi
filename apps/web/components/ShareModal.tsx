"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Check, Send, ExternalLink } from "lucide-react";
import { Modal } from "./Modal";
import { T, useT } from "./T";

/**
 * ShareModal shows the public, shareable link for a single job listing.
 * Pass `path` (e.g. "/elon/<id>") — the absolute URL is resolved on the client
 * from the current origin, so the link works whether opened in dev or prod.
 */
export function ShareModal({
  open,
  onClose,
  path,
  title,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
  title?: string;
}) {
  const t = useT();
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build the absolute URL on the client (origin isn't known during SSR).
  useEffect(() => {
    if (typeof window !== "undefined") setUrl(window.location.origin + path);
  }, [path]);

  // Reset the "copied" state whenever the modal is (re)opened.
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for non-secure contexts: select + execCommand.
      inputRef.current?.select();
      try { document.execCommand("copy"); } catch {}
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const tgShare =
    `https://t.me/share/url?url=${encodeURIComponent(url)}` +
    (title ? `&text=${encodeURIComponent(title)}` : "");

  return (
    <Modal open={open} onClose={onClose} title={t("E'lonni ulashish")}>
      <p className="text-sm muted mb-3">
        <T>Quyidagi havola orqali bu e'lonni istalgan odamga ulashishingiz mumkin:</T>
      </p>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="input flex-1 text-sm"
          aria-label={t("E'lon havolasi")}
        />
        <button type="button" onClick={copy} className="btn-primary shrink-0 gap-1.5">
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? <T>Nusxalandi</T> : <T>Nusxalash</T>}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={tgShare} target="_blank" rel="noreferrer" className="btn-secondary gap-1.5">
          <Send size={15} /><T>Telegram orqali</T>
        </a>
        <a href={url} target="_blank" rel="noreferrer" className="btn-secondary gap-1.5">
          <ExternalLink size={15} /><T>Havolani ochish</T>
        </a>
      </div>
    </Modal>
  );
}
