"use client";
import { API_BASE, getAccess } from "@/lib/api";

export type UploadKind = "avatar" | "elon";

export interface UploadedFile {
  key: string;
  url: string;
}

export interface UploadOpts {
  scope?: string;                   // e.g. an elon id
  onProgress?: (pct: number) => void;
}

/**
 * Uploads a single file to the backend, which streams it to S3.
 * Returns the public URL + S3 key. Throws on failure.
 */
export function uploadFile(file: File, kind: UploadKind, opts: UploadOpts = {}): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const token = getAccess();
    if (!token) return reject(new Error("Tizimga kirilmagan"));

    const fd = new FormData();
    fd.append("file", file, file.name);

    const url = new URL(`${API_BASE}/api/uploads`);
    url.searchParams.set("kind", kind);
    if (opts.scope) url.searchParams.set("scope", opts.scope);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url.toString(), true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onerror = () => reject(new Error("Tarmoq xatosi"));
    xhr.onload = () => {
      try {
        const data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ key: data.key, url: data.url });
        } else {
          reject(new Error(data?.error?.message || `HTTP ${xhr.status}`));
        }
      } catch (e) {
        reject(e as Error);
      }
    };
    xhr.send(fd);
  });
}

/** Tells the backend to remove an uploaded object (best-effort). */
export async function deleteUploaded(urlOrKey: { url?: string; key?: string }): Promise<void> {
  const token = getAccess();
  if (!token) return;
  const u = new URL(`${API_BASE}/api/uploads`);
  if (urlOrKey.url) u.searchParams.set("url", urlOrKey.url);
  if (urlOrKey.key) u.searchParams.set("key", urlOrKey.key);
  await fetch(u.toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}
