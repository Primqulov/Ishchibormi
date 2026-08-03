"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, ExternalLink } from "lucide-react";
import { api, setAccess, User } from "@/lib/api";
import { AUTH_BOT_USERNAME } from "@/lib/contact";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/Logo";
import { T, useT } from "@/components/T";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";

type Req = { tgToken: string; botUrl: string; devCode?: string };
type Verify = { accessToken: string; refreshToken: string; user: User };

/** Figma "01 · Ro'yxatdan o'tish (Kod kiritish)": chapda ko'k panel, o'ngda kod kartasi. */
export default function LoginPage() {
  const router = useRouter();
  const t = useT();
  const [tgToken, setTgToken] = useState("");
  const [botUrl, setBotUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.post<Req>("/api/auth/otp/request", {}).then((r) => {
      setTgToken(r.tgToken); setBotUrl(r.botUrl);
    }).catch(() => {
      setError("Serverga ulanib bo'lmadi. Birozdan so'ng qayta urinib ko'ring.");
    });
    // Faqat bir marta ishlaydi (mount'da). `t` bilan bog'lamaymiz — u har
    // renderda yangi funksiya, aks holda OTP so'rovi takrorlanib ketadi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backend botUrl'ni bermasa (username sozlanmagan bo'lsa), token va ochiq
  // bot username'idan zaxira havola quramiz. Bot nomi lib/contact.ts dagi
  // yagona manbadan olinadi (NEXT_PUBLIC_BOT_USERNAME orqali sozlanadi).
  const botUsername = AUTH_BOT_USERNAME;
  const effectiveBotUrl =
    botUrl || (tgToken && botUsername ? `https://t.me/${botUsername}?start=${tgToken}` : "");
  // t.me ba'zi tarmoqlarda brauzerda ochilmaydi (DNS bloklanishi mumkin), lekin
  // Telegram ilovasi ishlaydi. tg:// havolasi DNS'siz to'g'ridan-to'g'ri
  // o'rnatilgan Telegram ilovasini ochadi — "This site can't be reached" holatida zaxira yo'l.
  const tgAppUrl =
    tgToken && botUsername ? `tg://resolve?domain=${botUsername}&start=${tgToken}` : "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (code.length < 6) return;
    setSubmitting(true);
    try {
      const v = await api.post<Verify>("/api/auth/otp/verify", { token: tgToken, code });
      // Faqat access token saqlanadi. Refresh token localStorage'da saqlanmaydi
      // (web ilova refresh oqimini ishlatmaydi) — XSS hujum yuzasini kamaytiradi.
      setAccess(v.accessToken);
      router.replace(v.user.onboardingCompleted ? "/dashboard" : "/onboarding");
    } catch (err: any) {
      // Bloklangan hisob: backend token bermaydi (aks holda foydalanuvchi
      // "kirib" darhol qaytib chiqarilardi). Server xabari inglizcha, shuning
      // uchun kodni o'zimiz tarjima qilamiz.
      if (err?.code === "account_blocked") {
        setError(t("Hisobingiz bloklangan"));
      } else {
        setError(err?.message || t("Kod noto'g'ri yoki muddati o'tgan"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[38%_1fr]">
      {/* ── Chap panel — Figma: ko'k gradient ─────────────────────── */}
      <aside className="gradient-hero text-white hidden lg:flex flex-col justify-between p-12">
        <Link href="/" className="text-[21px] font-black tracking-[-0.3px]">
          <span className="text-white">Ishchi</span><span style={{ color: "var(--accent)" }}>Bormi</span>
        </Link>
        <div>
          <h2 className="text-[38px] font-black leading-[1.15] tracking-[-1.2px]">
            <T>Ish topish va</T><br /><T>ishchi yollash —</T><br /><T>bir joyda.</T>
          </h2>
          <p className="mt-5 text-[14px] text-white/75 leading-relaxed max-w-sm">
            <T>Bitta hisob — ham ish qidiring, ham ishchi yollang. Telegram bot orqali bir daqiqada ro'yxatdan o'ting.</T>
          </p>
          <div className="mt-9 grid grid-cols-3 gap-4 max-w-md">
            {[["30 soniya", "Ro'yxatdan o'tish"], ["0 so'm", "Xizmat haqi"], ["24/7", "Qo'llab-quvvatlash"]].map(([v, l]) => (
              <div key={l}>
                <div className="text-[20px] font-black"><T>{v}</T></div>
                <div className="text-[11.5px] text-white/70 mt-0.5"><T>{l}</T></div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ── O'ng panel — kod kartasi ─────────────────────────────── */}
      <div className="flex flex-col" style={{ background: "var(--bg-subtle)" }}>
        <header className="flex items-center justify-between px-5 sm:px-10 py-5">
          <div className="lg:hidden"><Logo /></div>
          <div className="flex items-center gap-2 ml-auto">
            <LangMenu />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 grid place-items-center px-5 sm:px-10 pb-10">
          <form onSubmit={submit} className="card w-full max-w-[480px] p-7 sm:p-8 animate-slide-up">
            <h1 className="text-[24px] font-black heading tracking-[-0.6px]"><T>Ro'yxatdan o'tish</T></h1>
            <p className="mt-1.5 text-[13.5px] muted">
              <T>Telegram botimiz orqali kod oling va quyida kiriting.</T>
            </p>

            {/* 1-qadam */}
            <div className="mt-6 rounded-xl p-4 flex gap-3" style={{ background: "var(--brand-soft)" }}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white"
                    style={{ background: "var(--brand)" }}>
                <Send size={16} />
              </span>
              <div>
                <div className="text-[13px] font-bold" style={{ color: "var(--brand)" }}>
                  <T>1-qadam · Telegram bot</T>
                </div>
                <div className="mt-1 text-[12.5px] muted leading-relaxed">
                  <T>Botga o'ting, «Start» tugmasini bosing va 6 xonali kodni oling.</T>
                </div>
              </div>
            </div>

            <a
              href={effectiveBotUrl || "#"}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => { if (!effectiveBotUrl) e.preventDefault(); }}
              className="btn btn-outline w-full mt-3 gap-2"
            >
              <T>Telegram botni ochish</T><ExternalLink size={14} />
            </a>

            {/* t.me brauzerda ochilmasa (DNS bloklangan bo'lsa) — ilovada ochish */}
            {tgAppUrl && (
              <a href={tgAppUrl} className="mt-2 block text-center text-[12px] subtle underline underline-offset-2 hover:text-[color:var(--text)]">
                <T>Havola ochilmayaptimi? Telegram ilovasida ochish</T>
              </a>
            )}

            {/* 2-qadam — kod kataklari */}
            <div className="mt-6">
              <div className="text-[13px] font-bold heading mb-2.5"><T>2-qadam · Kodni kiriting</T></div>
              <OtpBoxes value={code} onChange={(v) => { setCode(v); setError(""); }} />
              {error && (
                <div className="mt-3 text-[13px] text-danger flex items-center gap-1.5 animate-fade-in">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger shrink-0" />{error}
                </div>
              )}
            </div>

            <Button type="submit" size="lg" fullWidth className="mt-5" disabled={code.length < 6} loading={submitting}>
              {submitting ? <T>Tekshirilmoqda…</T> : <T>Davom etish</T>}
            </Button>

            <p className="mt-4 text-center text-[11.5px] subtle leading-relaxed">
              <T>Davom etish orqali siz</T>{" "}
              <Link href="/foydalanish-shartlari" className="heading underline-offset-2 hover:underline"><T>Foydalanish shartlari</T></Link>{" "}
              <T>va</T>{" "}
              <Link href="/maxfiylik-siyosati" className="heading underline-offset-2 hover:underline"><T>Maxfiylik siyosati</T></Link>{" "}
              <T>ga rozilik bildirasiz.</T>
            </p>
          </form>
        </main>

        <footer className="px-5 sm:px-10 py-5 flex flex-col sm:flex-row justify-between gap-2 text-[12.5px] subtle">
          <div>© 2026 Ishchi Bormi</div>
          <div className="flex gap-5">
            <Link href="/yordam" className="hover:text-[color:var(--text)]"><T>Yordam</T></Link>
            <Link href="/maxfiylik-siyosati" className="hover:text-[color:var(--text)]"><T>Maxfiylik siyosati</T></Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Figma: 6 ta alohida katak. Bitta yashirin input emas — har katak alohida,
 *  lekin qiymat yagona `code` satrida saqlanadi (qo'yib yuborish ham ishlaydi). */
function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function setAt(i: number, ch: string) {
    const digits = value.padEnd(6, " ").split("");
    digits[i] = ch || " ";
    onChange(digits.join("").replace(/\s+$/, "").replace(/\s/g, ""));
  }

  return (
    <div className="flex gap-2.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ""}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (raw.length > 1) {
              // Kodni to'liq qo'yib yuborish
              onChange(raw.slice(0, 6));
              refs.current[Math.min(5, raw.length - 1)]?.focus();
              return;
            }
            setAt(i, raw);
            if (raw && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const raw = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
            if (raw) { e.preventDefault(); onChange(raw); refs.current[Math.min(5, raw.length - 1)]?.focus(); }
          }}
          className="input !p-0 h-[52px] w-full text-center text-[22px] font-bold"
          aria-label={`${i + 1}-raqam`}
        />
      ))}
    </div>
  );
}
