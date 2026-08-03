"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, setAccess, APIError } from "@/lib/api";
import { T, useT } from "@/components/T";

interface DeleteRequestResp {
  sent: boolean;
  botUrl?: string;
  expiresInSeconds?: number;
  codeLength: number;
}

type Stage =
  // Just the red button.
  | "idle"
  // "Are you sure?" — the destructive gate before anything is sent.
  | "confirm"
  // Waiting on the backend to push the code to Telegram.
  | "sending"
  // Code is in the user's Telegram; waiting for them to type it.
  | "code"
  // The bot couldn't message them — show the link and ask for /start.
  | "botUnreachable"
  // Submitting the typed code.
  | "confirming";

/**
 * Account deletion, confirmed by a one-time code delivered over Telegram.
 *
 * The code never travels through the browser: the backend pushes it to the bot
 * the user logged in with, so an unattended logged-in tab can't delete the
 * account. When the bot can't reach them (never pressed /start, or blocked it)
 * we surface the bot link and let them retry.
 */
export function DeleteAccountCard() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();

  const [stage, setStage] = useState<Stage>("idle");
  const [code, setCode] = useState("");
  const [codeLength, setCodeLength] = useState(6);
  const [botUrl, setBotUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);

  const busy = stage === "sending" || stage === "confirming";

  async function requestCode() {
    setStage("sending");
    setError(null);
    setCode("");
    try {
      const res = await api.post<DeleteRequestResp>("/api/me/delete/request");
      setCodeLength(res.codeLength || 6);
      if (res.sent) {
        setStage("code");
      } else {
        setBotUrl(res.botUrl);
        setStage("botUnreachable");
      }
    } catch (e) {
      setError((e as APIError).message);
      setStage("confirm");
    }
  }

  async function confirmDelete() {
    setStage("confirming");
    setError(null);
    try {
      await api.post("/api/me/delete/confirm", { code });
      // Account is gone — drop the session and any cached data from it.
      setAccess(null);
      qc.clear();
      router.replace("/login");
    } catch (e) {
      setError((e as APIError).message);
      // Stay on the code step so a typo can be corrected without a new code.
      setStage("code");
    }
  }

  function cancel() {
    setStage("idle");
    setCode("");
    setError(null);
  }

  return (
    <div className="card p-6 max-w-xl border-danger">
      <h2 className="font-semibold text-danger mb-2">
        <T>Hisobni o&apos;chirish</T>
      </h2>

      {stage === "idle" && (
        <>
          <p className="text-sm text-[color:var(--text-muted)] mb-3">
            <T>Bu amalni qaytarib bo&apos;lmaydi.</T>
          </p>
          <button className="btn-danger" onClick={() => setStage("confirm")}>
            <T>O&apos;chirish</T>
          </button>
        </>
      )}

      {(stage === "confirm" || stage === "sending") && (
        <>
          <p className="text-sm text-[color:var(--text-muted)] mb-3">
            <T>
              Hisobingizni o&apos;chirish uchun Telegram botingizga tasdiqlash
              kodi yuboriladi. E&apos;lonlaringiz yopiladi, arizalaringiz bekor
              qilinadi.
            </T>
          </p>
          {error && <p className="text-sm text-danger mb-3">{error}</p>}
          <div className="flex gap-3">
            <button className="btn-danger" onClick={requestCode} disabled={busy}>
              <T>{busy ? "Yuborilmoqda..." : "Kodni yuborish"}</T>
            </button>
            <button className="btn-ghost" onClick={cancel} disabled={busy}>
              <T>Bekor qilish</T>
            </button>
          </div>
        </>
      )}

      {stage === "botUnreachable" && (
        <>
          <p className="text-sm text-[color:var(--text-muted)] mb-3">
            <T>
              Kodni yuborib bo&apos;lmadi. Botni oching, &quot;Start&quot;
              tugmasini bosing va qaytadan urinib ko&apos;ring.
            </T>
          </p>
          <div className="flex gap-3">
            {botUrl && (
              <a
                className="btn-tg"
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <T>Botni ochish</T>
              </a>
            )}
            <button className="btn-danger" onClick={requestCode}>
              <T>Qayta urinish</T>
            </button>
            <button className="btn-ghost" onClick={cancel}>
              <T>Bekor qilish</T>
            </button>
          </div>
        </>
      )}

      {(stage === "code" || stage === "confirming") && (
        <>
          <p className="text-sm text-[color:var(--text-muted)] mb-3">
            <T>
              Tasdiqlash kodini Telegram botingizga yubordik. Kodda katta va
              kichik harflar hamda belgilar bor — aynan ko&apos;rsatilganidek
              kiriting.
            </T>
          </p>
          <input
            className="input mb-3 font-mono tracking-[0.4em] text-lg"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={codeLength}
            placeholder={t("Kodni kiriting")}
            // A password manager or autocapitalising field would corrupt a
            // case-sensitive code.
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={stage === "confirming"}
          />
          {error && <p className="text-sm text-danger mb-3">{error}</p>}
          <div className="flex gap-3">
            <button
              className="btn-danger"
              onClick={confirmDelete}
              disabled={code.length !== codeLength || stage === "confirming"}
            >
              <T>
                {stage === "confirming"
                  ? "O'chirilmoqda..."
                  : "Hisobni butunlay o'chirish"}
              </T>
            </button>
            <button
              className="btn-ghost"
              onClick={requestCode}
              disabled={stage === "confirming"}
            >
              <T>Kodni qayta yuborish</T>
            </button>
            <button
              className="btn-ghost"
              onClick={cancel}
              disabled={stage === "confirming"}
            >
              <T>Bekor qilish</T>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
