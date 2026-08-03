/**
 * Ro'yxatdan o'tish — FAQAT birinchi marta.
 *
 * Nega umuman kerak: Telegram `initData` foydalanuvchining telefon raqamini
 * bermaydi, platformada esa telefon majburiy (ish beruvchi va ishchi bir-biri
 * bilan bog'lanishi kerak). Shuning uchun yangi foydalanuvchi bir marta botda
 * kontaktini ulashadi.
 *
 * Bu ekran yangi oqim O'YLAB TOPMAYDI — saytda va mobil ilovada allaqachon
 * ishlab turgan OTP oqimini chaqiradi (/api/auth/otp/request → /verify).
 * Bir marta o'tgach, keyingi barcha kirishlar initData orqali avtomatik.
 */

import { useEffect, useRef, useState } from "react";
import { AUTH_BOT_USERNAME, requestOtp, verifyOtp, type APIError } from "@/lib/api";
import { haptic, openTelegramLink, showMainButton } from "@/lib/telegram";

const CODE_LENGTH = 6;

export function Register({ onDone }: { onDone: () => void }) {
  // "intro" — tushuntirish; "code" — bot ochilgan, kod kutilmoqda.
  const [step, setStep] = useState<"intro" | "code">("intro");
  const [tgToken, setTgToken] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  async function openBot() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { tgToken: tok, botUrl } = await requestOtp();
      setTgToken(tok);
      setStep("code");
      haptic.tap();
      // Backend bot username sozlanmagan bo'lsa botUrl bo'sh keladi —
      // shunda klientdagi zaxira nomdan foydalanamiz.
      openTelegramLink(botUrl || `https://t.me/${AUTH_BOT_USERNAME}?start=${tok}`);
    } catch (e) {
      haptic.error();
      setError((e as APIError).message || "Botga ulanib bo'lmadi.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    if (busy || code.length < CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(tgToken, code);
      haptic.success();
      onDone();
    } catch (e) {
      haptic.error();
      setError((e as APIError).message || "Kod noto'g'ri yoki eskirgan.");
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  // Kod bosqichida asosiy amalni MainButton bajaradi.
  useEffect(() => {
    if (step !== "code") return;
    return showMainButton("Tasdiqlash", submitCode, {
      disabled: code.length < CODE_LENGTH || busy,
      loading: busy,
    });
    // submitCode har renderda qayta yaratiladi, lekin u faqat code/busy/tgToken
    // ga bog'liq — shu uchtasi o'zgarganda tugma yangilanishi kifoya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, code, busy, tgToken]);

  return (
    <div className="flex min-h-[70vh] flex-col justify-center gap-6 px-5 py-8 animate-fade-in">
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className="grid h-16 w-16 place-items-center rounded-2xl text-[30px]"
          style={{ background: "var(--brand-soft)" }}
        >
          👋
        </span>
        <h1 className="text-[22px] font-black tracking-[-0.4px] heading">
          Ishchi Bormi'ga xush kelibsiz
        </h1>
        <p className="max-w-[300px] text-[14px] leading-relaxed muted">
          Ish berish va ariza yuborish uchun telefon raqamingiz kerak — ish beruvchi
          siz bilan shu raqam orqali bog'lanadi.
        </p>
      </div>

      {step === "intro" ? (
        <div className="flex flex-col gap-4">
          <ol className="card flex flex-col gap-3 p-4 text-[13.5px] muted">
            <Step n={1}>Pastdagi tugmani bosing — bot ochiladi</Step>
            <Step n={2}>Botda «📞 Telefon raqamni ulashish» tugmasini bosing</Step>
            <Step n={3}>Bot bergan 6 xonali kodni shu yerga kiriting</Step>
          </ol>

          <button type="button" onClick={openBot} disabled={busy} className="btn-primary w-full">
            {busy ? "Ochilmoqda..." : "Telegram botga o'tish"}
          </button>

          {error && <ErrorLine text={error} />}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="otp" className="text-[13px] font-semibold muted">
              Botdan kelgan 6 xonali kod
            </label>
            <input
              id="otp"
              ref={codeRef}
              className="input text-center !text-[24px] font-black tracking-[10px]"
              value={code}
              onChange={(e) => {
                setError(null);
                setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH));
              }}
              // inputMode="numeric" — telefonda darhol raqamli klaviatura
              // ochiladi; autoComplete="one-time-code" iOS'ga kodni SMS/xabardan
              // taklif qilish imkonini beradi.
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              placeholder="••••••"
              maxLength={CODE_LENGTH}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCode();
              }}
            />
          </div>

          {error && <ErrorLine text={error} />}

          {/* MainButton ko'rinmaydigan holat (brauzerda ochilgan) uchun zaxira. */}
          <button
            type="button"
            onClick={submitCode}
            disabled={busy || code.length < CODE_LENGTH}
            className="btn-primary w-full"
          >
            {busy ? "Tekshirilmoqda..." : "Tasdiqlash"}
          </button>

          <button
            type="button"
            onClick={openBot}
            disabled={busy}
            className="btn-ghost w-full !text-[13px]"
          >
            Kod kelmadimi? Botni qayta ochish
          </button>
        </div>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11.5px] font-bold"
        style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
      >
        {n}
      </span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p
      className="rounded-lg px-3.5 py-2.5 text-[13px] font-medium"
      style={{ background: "#FEE4E2", color: "#B42318" }}
    >
      {text}
    </p>
  );
}
