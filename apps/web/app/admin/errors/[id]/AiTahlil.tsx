"use client";
/**
 * "3.12.1 · Xatolik — batafsil" ekranidagi «Sababini aniqla» kartasi.
 *
 * # NIMA QILADI
 *
 * `POST /api/admin/errors/{id}/ai` — server niqoblangan kontekstni
 * (aynan pastdagi «AI uchun tayyor kontekst» paneli ko'rsatadigan matn)
 * Gemini'ga yuboradi va ildiz-sabab xulosasini guruhga YOZIB qaytaradi.
 * Shu sababli javob — yangilangan guruh, xulosaning o'zi emas: ekran
 * boshqa amallardagi kabi bitta joydan yangilanadi.
 *
 * # NEGA TUGMA, AVTOMATIK EMAS
 *
 * Har chaqiruv pul va kvota turadi, xatoliklarning katta qismi esa bir
 * marta chiqib yo'qoladi. Bundan ham muhimi: matn TASHQI xizmatga
 * chiqadi, ya'ni qaror odamniki bo'lishi kerak. Amal audit jurnaliga
 * yoziladi (`error_ai`), tarixda esa to'q sariq nuqta bilan turadi —
 * eksport va Telegram kabi "ma'lumot chiqdi" belgisi.
 *
 * # XULOSA — FAKT EMAS
 *
 * Bu yerdagi har bir gap MODEL yozgan matn. Panel shuning uchun uchta
 * narsani doim yonida ko'rsatadi: ishonch darajasi, model nomi va tahlil
 * paytidagi hodisalar soni. Oxirgisi eng muhimi — xatolik tahlildan
 * keyin yana takrorlangan bo'lsa, xulosa ESKIRGAN bo'lishi mumkin va
 * karta buni ochiq aytadi.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Crosshair, RefreshCw, Sparkles } from "lucide-react";
import type {
  APIError,
  AdminErrorDetail,
  AdminErrorGroup,
  XatoAI,
  XatoKontekstKalit,
} from "@/lib/api";
import { api } from "@/lib/api";
import {
  AVATAR_FON,
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KUL,
  OCH_KUL,
  ORANJ,
  QUTI_FON,
  XIRA_QUYUQ,
  YASHIL,
  tugma,
} from "@/components/admin/ui";
import { FOKUS, Izohcha, Karta, Nishon } from "@/components/admin/xatoQismlar";
import { kunSoat, son } from "@/components/admin/xato";

/**
 * Ishonch darajasi — serverdagi yopiq ro'yxat (`gemini.ConfLow/Mid/High`).
 *
 * Rang MA'NOLI: yashil — xulosaga tayanib tuzatishni boshlash mumkin,
 * to'q sariq — avval tekshirish kerak, kulrang — model o'zi ham
 * ishonmagan (noma'lum qiymat ham shu yerga tushadi, chunki server
 * noaniqlikni "past" ga aylantiradi).
 */
const ISHONCH: Record<string, { nomi: string; rang: string; matn?: string }> = {
  yuqori: { nomi: "Ishonch: yuqori", rang: YASHIL },
  "o'rta": { nomi: "Ishonch: o'rta", rang: ORANJ },
  past: { nomi: "Ishonch: past", rang: HOSHIYA_QUYUQ, matn: OCH_KUL },
};

/** Kontekst bo'laklarining o'zbekcha nomi — meta qatorida ko'rsatiladi. */
const BOLAK_NOMI: Record<XatoKontekstKalit, string> = {
  stack: "stack trace",
  device: "qurilma",
  request: "so'rov",
  steps: "qadamlar",
  code: "kod manzillari",
  serverlog: "server log",
  similar: "o'xshashlar",
};

/**
 * Server xato kodlari → paneldagi xabar.
 *
 * Kodlar `internal/admin/errai.go · aiError` bilan bir xil. Ular ATAYLAB
 * 5xx emas: `lib/api.ts · responseError` 5xx javob tanasini tashlab
 * yuboradi va admin "nimadir xato" dan boshqa hech narsa ko'rmasdi.
 * `ai_quota` bu ro'yxatda yo'q — uning matnini server o'zi hisoblaydi
 * (qaysi kvota tugagani va qancha kutish kerakligi faqat unga ma'lum).
 * U `details` da ikki xil javob beradi: `daily: true` — kunlik chegara,
 * kutish behuda; `retryAfter` — daqiqalik chegara, sanoq ko'rsatiladi.
 */
const XATO_MATN: Record<string, { sarlavha: string; matn: string }> = {
  ai_not_configured: {
    sarlavha: "AI tahlili sozlanmagan",
    matn: "Serverda ERROR_AI_API_KEY berilmagan — kalit qo'yilgach tugma o'zi ishlay boshlaydi.",
  },
  ai_key_rejected: {
    sarlavha: "AI kaliti rad etildi",
    matn: "Kalit yaroqsiz yoki loyihada Generative Language API yoqilmagan. Bu server sozlamasi — admin uni tuzata olmaydi.",
  },
  ai_busy: {
    sarlavha: "Bu xatolik hozir tahlil qilinmoqda",
    matn: "Boshqa admin ayni shu guruhni tahlil qilyapti. Bir necha soniyadan keyin sahifani yangilang.",
  },
  ai_timeout: {
    sarlavha: "AI belgilangan vaqtda javob bermadi",
    matn: "Chaqiruv 40 soniyadan oshdi va to'xtatildi. Qayta urinib ko'ring.",
  },
  ai_empty: {
    sarlavha: "AI javob qaytarmadi",
    matn: "Model bo'sh xulosa berdi — bu ba'zan takroriy so'rovda o'tib ketadi.",
  },
  rate_limited: {
    sarlavha: "Juda tez-tez so'ralmoqda",
    matn: "Har bir admin uchun 5 daqiqada 5 ta tahlil. Bir necha daqiqadan keyin urinib ko'ring.",
  },
  forbidden: {
    sarlavha: "Ruxsat yetarli emas",
    matn: "AI tahlilini superadmin va moderator ishga tushira oladi.",
  },
};

function xatoMatni(err?: APIError): { sarlavha: string; matn: string } {
  const k = err?.code ?? "";
  if (XATO_MATN[k]) return XATO_MATN[k];
  return {
    sarlavha: "Tahlilni bajarib bo'lmadi",
    matn: err?.message || "Server javob bermadi. Qayta urinib ko'ring.",
  };
}

/* ── Kichik bo'laklar ──────────────────────────────────────────────── */

function Bolim({ nomi, children }: { nomi: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[7px]">
      <div className="text-[12px] font-semibold leading-4" style={{ color: IK }}>
        {nomi}
      </div>
      {children}
    </div>
  );
}

/**
 * Ro'yxat qatori. Tuzatish — RAQAMLI (tartib muhim: birinchi qadam
 * bajarilmasa ikkinchisi ma'nosiz), tekshirish — belgili (tartibsiz).
 */
function Qadam({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-[8px]">
      <span
        aria-hidden
        className="mt-[1px] grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full text-[10px] font-semibold leading-none"
        style={
          n === undefined
            ? { background: "#e7f5ee", color: "#14663f" }
            : { background: AVATAR_FON, color: KO_K }
        }
      >
        {n === undefined ? <Check size={10} strokeWidth={3} /> : n}
      </span>
      <span className="min-w-0 break-words text-[12.5px] leading-[18px]" style={{ color: KUL }}>
        {children}
      </span>
    </li>
  );
}

/* ── Karta ─────────────────────────────────────────────────────────── */

export default function AiTahlil({
  d,
  include,
  hozir,
  xabar,
  guruhYangila,
}: {
  d: AdminErrorDetail;
  /** Pastdagi «Nimalar qo'shilsin» ro'yxati — AI aynan shu matnni ko'radi. */
  include: XatoKontekstKalit[];
  hozir: number;
  xabar: (kor: "ok" | "xato", sarlavha: string, tavsif?: string) => void;
  guruhYangila: (g: AdminErrorGroup) => void;
}) {
  const [ishlamoqda, setIshlamoqda] = useState(false);
  /** DAQIQALIK kvota tugaganda: qachondan keyin qayta urinish mumkin (unix ms). */
  const [kutish, setKutish] = useState<number | null>(null);
  const [qoldi, setQoldi] = useState(0);
  /**
   * KUNLIK kvota tugagani (server `details.daily` deb aytadi).
   *
   * Bunga sanoq qo'yilmaydi: chegara ertaga tiklanadi, sanoq esa "yana
   * 42 soniya" degan yolg'on va'da bo'lardi. Tugma shu sababli butunlay
   * bloklanadi — har urinish adminning 5 daqiqalik limitidan bejiz
   * yeyilardi.
   */
  const [kunlik, setKunlik] = useState(false);

  const ai: XatoAI | undefined = d.group.ai;

  // Kvota taymeri faqat u FAOL bo'lganda ishlaydi.
  useEffect(() => {
    if (kutish === null) return;
    const hisobla = () => {
      const q = Math.max(0, Math.ceil((kutish - Date.now()) / 1000));
      setQoldi(q);
      if (q === 0) setKutish(null);
    };
    hisobla();
    const t = window.setInterval(hisobla, 1000);
    return () => window.clearInterval(t);
  }, [kutish]);

  /**
   * Xulosa ESKIRGANmi.
   *
   * `countAt` — tahlil paytidagi hodisalar soni. Undan keyin xatolik yana
   * takrorlangan bo'lsa, sharoit o'zgargan bo'lishi mumkin (yangi versiya,
   * boshqa qurilma) va eski xulosaga tayanib tuzatish boshlash xavfli.
   */
  const yangiHodisa =
    ai && typeof ai.countAt === "number" ? Math.max(0, d.group.count - ai.countAt) : 0;

  const ishonch = ai?.ishonch ? ISHONCH[ai.ishonch] : undefined;

  const bolimlar = useMemo(
    () => (ai?.include ?? []).map((k) => BOLAK_NOMI[k] ?? k).join(", "),
    [ai?.include],
  );

  const tahlil = useCallback(
    async (force: boolean) => {
      if (ishlamoqda) return;
      const eskiVaqt = d.group.ai?.at;
      setIshlamoqda(true);
      try {
        const gr = await api.post<AdminErrorGroup>(
          `/api/admin/errors/${encodeURIComponent(d.group.id)}/ai`,
          { include, force },
          { auth: "admin" } as any,
        );
        if (gr?.id) guruhYangila(gr);
        setKunlik(false);
        // Server saqlangan xulosani ham 200 bilan qaytaradi (hodisalar
        // soni o'zgarmagan bo'lsa). Buni "tahlil qilindi" deb ko'rsatish
        // yolg'on bo'lardi — vaqt bo'yicha ajratamiz.
        if (!force && gr?.ai?.at && gr.ai.at === eskiVaqt) {
          xabar(
            "ok",
            "Saqlangan tahlil ko'rsatildi",
            "Oxirgi tahlildan beri yangi hodisa bo'lmagan — kvota sarflanmadi.",
          );
        } else {
          xabar(
            "ok",
            "AI tahlili tayyor",
            `${d.group.ref} · ${gr?.ai?.model ?? "model"} · ${son(gr?.ai?.tokens ?? 0)} token`,
          );
        }
      } catch (e) {
        const err = e as APIError | undefined;
        if (err?.code === "ai_quota") {
          // Server ikki xil kvotani ajratadi: kunlik (`daily`) va
          // daqiqalik (`retryAfter`). Ularni bir xil ko'rsatish — kunlik
          // chegarada adminni behuda kutishga majburlash degani.
          const det = err.details as { retryAfter?: number; daily?: boolean } | undefined;
          if (det?.daily) {
            setKunlik(true);
            setKutish(null);
          } else {
            const sek = Number(det?.retryAfter);
            if (Number.isFinite(sek) && sek > 0) setKutish(Date.now() + sek * 1000);
          }
          xabar(
            "xato",
            det?.daily ? "Bugungi AI kvotasi tugadi" : "AI kvotasi tugadi",
            err.message || "Bir oz kutib, qayta urinib ko'ring.",
          );
        } else {
          const m = xatoMatni(err);
          xabar("xato", m.sarlavha, m.matn);
        }
      } finally {
        setIshlamoqda(false);
      }
    },
    [d.group.ai?.at, d.group.id, d.group.ref, include, ishlamoqda, guruhYangila, xabar],
  );

  const bloklangan = ishlamoqda || qoldi > 0 || kunlik;
  const tugmaNomi = ishlamoqda
    ? "Tahlil qilinmoqda…"
    : kunlik
      ? "Kvota ertaga yangilanadi"
      : qoldi > 0
        ? `Kvota — ${qoldi} s`
        : ai
          ? "Qayta tahlil qilish"
          : "Sababini aniqla";

  const tugmaKor = ai ? "ikkilamchi" : "asosiy";

  return (
    <Karta
      sarlavha="AI tahlili — sabab va tuzatish yo'li"
      amal={
        <button
          type="button"
          onClick={() => tahlil(Boolean(ai))}
          disabled={bloklangan}
          title={
            kunlik
              ? "Bepul tarifning kunlik so'rovlari tugadi — chegara ertaga tiklanadi."
              : qoldi > 0
                ? "Bepul tarif kvotasi tugadi — server aytgan muddat kutiladi."
                : ai
                  ? "Kontekstni qaytadan yuboradi va xulosani yangilaydi."
                  : "Niqoblangan kontekst AI xizmatiga yuboriladi."
          }
          className={`${tugma(tugmaKor, { kichik: true, ochiq: bloklangan }).className} ${FOKUS}`}
          style={tugma(tugmaKor, { kichik: true, ochiq: bloklangan }).style}
        >
          {ai ? <RefreshCw size={13} aria-hidden /> : <Sparkles size={13} aria-hidden />}
          {tugmaNomi}
        </button>
      }
      tana="p-[18px]"
    >
      {/* Kunlik kvota — kartaning eng tepasida, chunki tugma bloklangani
          sababini admin darhol ko'rishi kerak. */}
      {kunlik && (
        <div className="mb-[12px]">
          <Izohcha kor="sariq" ikon={<CircleAlert size={14} aria-hidden />}>
            Bepul tarifda bu modelga <b>kuniga 20 ta</b> so'rov beriladi va bugungisi tugadi.
            Kutish yordam bermaydi — chegara ertaga yangilanadi. Shoshilinch bo'lsa, serverda
            hisobni to'lovli tarifga o'tkazish kerak; pastdagi kontekstni nusxalab, tahlilni
            qo'lda ham bajarish mumkin.
          </Izohcha>
        </div>
      )}
      {!ai ? (
        /* ── Bo'sh holat ─────────────────────────────────────────── */
        <div className="flex flex-col items-center gap-[10px] py-[22px] text-center">
          <span
            aria-hidden
            className="grid h-[42px] w-[42px] place-items-center rounded-full"
            style={{ background: AVATAR_FON }}
          >
            <Sparkles size={19} color={KO_K} />
          </span>
          <div className="text-[14px] font-semibold leading-[19px]" style={{ color: IK }}>
            Sabab hali aniqlanmagan
          </div>
          <p className="max-w-[620px] text-[12.5px] leading-[18px]" style={{ color: OCH_KUL }}>
            Tugma bosilganda pastdagi «AI uchun tayyor kontekst» matni — o'sha niqoblangan
            holicha — tahlil xizmatiga yuboriladi va ildiz sabab, qayerda ekani hamda tuzatish
            qadamlari qaytadi. Chaqiruv audit jurnaliga yoziladi.
          </p>
          <button
            type="button"
            onClick={() => tahlil(false)}
            disabled={bloklangan}
            className={`${tugma("asosiy", { ochiq: bloklangan }).className} ${FOKUS} mt-[2px]`}
            style={tugma("asosiy", { ochiq: bloklangan }).style}
          >
            <Sparkles size={15} aria-hidden />
            {tugmaNomi}
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-[14px]">
          {/* ── Tashxis qatori ────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-[8px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              {ishonch && (
                <Nishon nomi={ishonch.nomi} rang={ishonch.rang} matn={ishonch.matn} nuqta />
              )}
              {yangiHodisa > 0 && (
                <Nishon
                  nomi={`Tahlildan keyin yana ${son(yangiHodisa)} ta hodisa`}
                  rang={ORANJ}
                />
              )}
            </div>
            <p className="break-words text-[15px] font-semibold leading-[21px]" style={{ color: IK }}>
              {ai.sarlavha}
            </p>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            {/* ── Chap: sabab va tuzatish ─────────────────────────── */}
            <div className="flex min-w-0 flex-col gap-[14px]">
              <Bolim nomi="Ildiz sabab">
                <p className="break-words text-[12.5px] leading-[19px]" style={{ color: KUL }}>
                  {ai.sabab}
                </p>
              </Bolim>

              {(ai.tuzatish?.length ?? 0) > 0 && (
                <Bolim nomi="Tuzatish qadamlari">
                  <ol className="m-0 flex list-none flex-col gap-[7px] p-0">
                    {ai.tuzatish!.map((t, i) => (
                      <Qadam key={i} n={i + 1}>
                        {t}
                      </Qadam>
                    ))}
                  </ol>
                </Bolim>
              )}
            </div>

            {/* ── O'ng: qayerda, tekshirish, meta ─────────────────── */}
            <div className="flex min-w-0 flex-col gap-[14px]">
              <Bolim nomi="Qayerda">
                <div
                  className="flex min-w-0 items-start gap-[8px] rounded-[10px] px-[12px] py-[10px]"
                  style={{ background: QUTI_FON, boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
                >
                  <Crosshair size={14} color={OCH_KUL} aria-hidden className="mt-[2px] shrink-0" />
                  <span
                    className="min-w-0 break-words font-mono text-[12px] leading-[18px]"
                    style={{ color: ai.qayerda ? IK : XIRA_QUYUQ }}
                  >
                    {ai.qayerda || "aniqlanmagan"}
                  </span>
                </div>
              </Bolim>

              {(ai.tekshirish?.length ?? 0) > 0 && (
                <Bolim nomi="Tuzatishdan keyin tekshirish">
                  <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
                    {ai.tekshirish!.map((t, i) => (
                      <Qadam key={i}>{t}</Qadam>
                    ))}
                  </ul>
                </Bolim>
              )}

              <Bolim nomi="Tahlil haqida">
                <div className="flex flex-col gap-[3px] text-[11.5px] leading-[16px]" style={{ color: OCH_KUL }}>
                  <span>Model: {ai.model || "aniqlanmagan"}</span>
                  {typeof ai.tokens === "number" && ai.tokens > 0 && (
                    <span>Sarflangan: {son(ai.tokens)} token</span>
                  )}
                  <span>
                    So'radi: {ai.by || "Tizim"} ·{" "}
                    {(() => {
                      const s = new Date(ai.at);
                      return Number.isNaN(s.getTime()) ? "aniqlanmagan" : kunSoat(s, hozir);
                    })()}
                  </span>
                  {bolimlar && <span>Kontekst: {bolimlar}</span>}
                  {typeof ai.countAt === "number" && (
                    <span>Tahlil paytida: {son(ai.countAt)} ta hodisa</span>
                  )}
                </div>
              </Bolim>
            </div>
          </div>

          {/* ── Ogohlantirishlar ──────────────────────────────────── */}
          {yangiHodisa > 0 && (
            <Izohcha kor="sariq" ikon={<CircleAlert size={14} aria-hidden />}>
              Xulosa <b>{son(ai.countAt ?? 0)}</b> ta hodisa asosida chiqarilgan, o'shandan beri yana{" "}
              <b>{son(yangiHodisa)}</b> tasi qo'shildi. Sharoit o'zgargan bo'lishi mumkin — tuzatishni
              boshlashdan oldin «Qayta tahlil qilish» ni bosing.
            </Izohcha>
          )}
          <Izohcha>
            Bu xulosani MODEL yozgan — u fakt emas, taxmin. Ko'rsatilgan fayl va qatorni kodda o'zingiz
            tekshiring: model kontekstda bo'lmagan joyni ham nomlashi mumkin. Matn tashqi xizmatga
            yuborilgan (telefon, IP va tokenlar niqoblangan holda) va bu audit jurnalida qolgan.
          </Izohcha>
        </div>
      )}
    </Karta>
  );
}
