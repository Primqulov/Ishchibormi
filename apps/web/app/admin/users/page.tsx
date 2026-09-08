"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, Info } from "lucide-react";
import {
  api,
  User,
  Paged,
  downloadAdminCsv,
  getAdminRole,
  APIError,
  isUserBlocked,
  moderationBanUntil,
  platformLabel,
  CLIENT_PLATFORMS,
} from "@/lib/api";
import { AdminModal } from "@/components/admin/AdminModal";
import { DeleteModeModal, DeleteMode } from "@/components/admin/DeleteModeModal";
import { Pagination } from "@/components/Pagination";
import { MatnFiltr, Tanlov } from "@/components/admin/Filtr";
import {
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KUL,
  OCH_KUL,
  ORANJ,
  ORANJ_FON,
  ORANJ_MATN,
  QIZIL,
  SARLAVHA_FON,
  SOYA,
  XIRA,
  XIRA_QUYUQ,
  YASHIL,
  tugma,
} from "@/components/admin/ui";

/* ─────────────────────────────────────────────────────────────────────
   Figma: "3.3 · Foydalanuvchilar — ro'yxat (1440×1024)" va
          "3.3a · Foydalanuvchilar — oynalar va bo'sh holat".

   Figma'dagi hoshiya INSIDE turadi — CSS `border` qutini kattartirib
   yuborardi, shuning uchun hamma joyda `inset` box-shadow ishlatilgan.
   ───────────────────────────────────────────────────────────────────── */

const LIMIT = 20;

/* Filtrlarning RUXSAT ETILGAN qiymatlari. Backend ham o'z tomonida
   tekshiradi, lekin so'rov yuborilishidan oldin oq ro'yxatdan o'tkazish
   bu yerdagi holat buzilib qolsa ham (masalan, eski `sessionStorage`)
   kutilmagan parametr ketishining oldini oladi. */
const HOLAT_QIY = ["", "0", "1"] as const;
const OCHIRILGAN_QIY = ["", "hide", "only"] as const;
const PLATFORMA_QIY: readonly string[] = ["", ...CLIENT_PLATFORMS];

const oq = (v: string, ruxsat: readonly string[]) => (ruxsat.includes(v) ? v : "");

/** Ming ajratgichi — uzuq bo'shliq (Figma: "12 480"). */
function son(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Math.max(0, Math.round(v))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Figma sana ko'rinishi: 12.09.2026 */
function sana(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Figma telefon ko'rinishi: +998 90 123 45 67. Mos kelmasa — o'zgarishsiz. */
function telefon(v: string): string {
  const t = v.replace(/[^\d+]/g, "");
  const m = /^\+?998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(t);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : v;
}

/**
 * "Holat" ustunining qiymati — Figma 3.3.
 *
 * # NEGA UCHTA, VA NEGA AYNAN SHU TARTIBDA
 *
 * Hisob bir vaqtda ham o'chirilgan, ham bloklangan bo'lishi mumkin:
 * o'chirish `isBlocked` ni tozalamaydi (apps/api/internal/admin/users.go —
 * u faqat `isDeleted` va `deletedAt` ni yozadi). Ustun esa bitta javob
 * beradi, shuning uchun ustuvorlik kerak.
 *
 * O'chirilgan YAKUNIY holat va shuning uchun birinchi turadi:
 *   • bunday hisob blok holatidan qat'i nazar ilovaga kira olmaydi
 *     (auth/handler.go: `u.IsBlocked || u.IsDeleted`);
 *   • blokni ochish uni qaytarmaydi — ya'ni "Bloklangan" deb ko'rsatish
 *     adminni bor bo'lmagan amalga undardi.
 *
 * # NEGA BLOK MANBASI YO'Q
 *
 * Blokni admin qo'lda qo'yganmi yoki avtomatik moderatsiyami — bu yerda
 * ATAYLAB ko'rsatilmaydi. Ro'yxat "kim qanday holatda" degan savolga
 * javob beradi; "nega" degan savol batafsil sahifadagi "Blok
 * ma'lumotlari" kartasida, bitta bosish narida (Figma 3.4). Sabab matni
 * ko'pincha shaxsiy tafsilot bo'ladi — uni butun ekranga yoyilgan
 * jadvalda tutib turish keraksiz oshkoralik.
 */
type Holat = "ochirilgan" | "bloklangan" | "faol";

function holat(u: User): Holat {
  if (u.isDeleted) return "ochirilgan";
  if (isUserBlocked(u)) return "bloklangan";
  return "faol";
}

/**
 * Figma 4.4 qoidasi: "Matn va chegara doim bir xil rangda, fon shaffof.
 * Rang holat ma'nosini bildiradi — yangi rang qo'shilmaydi."
 *
 * Sariq (ORANJ) — brend palitrasidagi bor rang; bloklangan uchun aynan u
 * tanlangan, chunki blok qaytariladigan holat. Qizil esa qaytarib
 * bo'lmaydigan o'chirishga qoldirilgan.
 */
const HOLAT_KOR: Record<Holat, { matn: string; rang: string }> = {
  faol: { matn: "Faol", rang: YASHIL },
  bloklangan: { matn: "Bloklangan", rang: ORANJ },
  ochirilgan: { matn: "O'chirilgan", rang: QIZIL },
};

export default function AdminUsers() {
  const [data, setData] = useState<Paged<User> | null>(null);
  const [page, setPage] = useState(1);
  // Qidiruv maydonlari darhol emas, kechikib so'rovga aylanadi — aks holda
  // har bosilgan harf uchun alohida so'rov ketardi.
  const [qKirit, setQKirit] = useState("");
  const [viloyatKirit, setViloyatKirit] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [blocked, setBlocked] = useState("");
  const [platform, setPlatform] = useState("");
  // O'chirish oynasi butun `User` ni oladi, `id` ni emas: oyna kimni
  // o'chirayotganini ismi va raqami bilan ko'rsatadi va tasdiq uchun
  // o'sha ismdan foydalanadi (Figma 3.3a · 3–4).
  const [delTarget, setDelTarget] = useState<User | null>(null);
  // Avtomatik blokni faqat superadmin ocha oladi — backend ham shu qoidani
  // qo'llaydi (403 `moderation_ban_superadmin_only`). Rolni bilib turish
  // tugmani oldindan o'chirib qo'yish uchun kerak: bosilib, keyin rad
  // etiladigan amal taklif qilinmasin.
  const [isSuper, setIsSuper] = useState(false);
  // Bloklash oynasi: sabab MAJBURIY, shuning uchun bu bir bosishli amal emas.
  const [blockTarget, setBlockTarget] = useState<User | null>(null);
  const [reason, setReason] = useState("");
  // Blokni ochish oynasi.
  const [unblockTarget, setUnblockTarget] = useState<User | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState("");
  // "O'chirilgan" filtri: bo'sh = hammasi (standart), chunki o'chirilgan
  // hisob admin panelida ko'rinib turishi kerak.
  const [deleted, setDeleted] = useState("");
  const [yuklanmoqda, setYuklanmoqda] = useState(true);
  const [royxatXato, setRoyxatXato] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQ(qKirit.trim()), 300);
    return () => clearTimeout(t);
  }, [qKirit]);
  useEffect(() => {
    const t = setTimeout(() => setRegion(viloyatKirit.trim()), 300);
    return () => clearTimeout(t);
  }, [viloyatKirit]);

  // Har so'rovga tartib raqami beriladi: sekin qaytgan ESKI javob yangi
  // filtr natijasini bosib ketmasin.
  const soravRaqami = useRef(0);

  const load = useCallback(async () => {
    const men = ++soravRaqami.current;
    setYuklanmoqda(true);
    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, Math.floor(page))),
        limit: String(LIMIT),
      });
      if (q) params.set("q", q);
      if (region) params.set("region", region);
      if (oq(blocked, HOLAT_QIY)) params.set("blocked", blocked);
      if (oq(platform, PLATFORMA_QIY)) params.set("platform", platform);
      if (oq(deleted, OCHIRILGAN_QIY)) params.set("deleted", deleted);
      const javob = await api.get<Paged<User>>(`/api/admin/users?${params}`, { auth: "admin" } as any);
      if (men !== soravRaqami.current) return;
      setData(javob);
      setRoyxatXato("");
    } catch (e) {
      if (men !== soravRaqami.current) return;
      setData(null);
      setRoyxatXato((e as APIError)?.message || "Ro'yxatni yuklab bo'lmadi");
    } finally {
      if (men === soravRaqami.current) setYuklanmoqda(false);
    }
  }, [page, q, region, blocked, platform, deleted]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setIsSuper(getAdminRole() === "superadmin"); }, []);
  // Filtr o'zgarsa 1-sahifaga qaytamiz.
  useEffect(() => { setPage(1); }, [q, region, blocked, platform, deleted]);

  /** Bu foydalanuvchini shu admin blokdan chiqara oladimi. */
  function canUnblock(u: User): boolean {
    return isSuper || !moderationBanUntil(u);
  }

  async function submitBlock() {
    if (!blockTarget || !reason.trim()) return;
    setBusy(true); setErr("");
    try {
      await api.post(
        `/api/admin/users/${encodeURIComponent(blockTarget.id)}/block`,
        { isBlocked: true, reason: reason.trim() },
        { auth: "admin" } as any,
      );
      setBlockTarget(null); setReason("");
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Bloklab bo'lmadi");
    } finally { setBusy(false); }
  }

  async function submitUnblock() {
    if (!unblockTarget) return;
    setBusy(true); setErr("");
    try {
      // Bitta chaqiruv ikkala blokni ham ochadi (qo'lda qo'yilgani va
      // avtomatik) — panelda blok bitta tushuncha bo'lgani uchun.
      await api.post(
        `/api/admin/users/${encodeURIComponent(unblockTarget.id)}/block`,
        { isBlocked: false },
        { auth: "admin" } as any,
      );
      setUnblockTarget(null);
      load();
    } catch (e) {
      setErr((e as APIError)?.message || "Blokni ochib bo'lmadi");
    } finally { setBusy(false); }
  }

  async function del(mode: DeleteMode) {
    if (!delTarget) return;
    setDelBusy(true); setDelErr("");
    try {
      await api.delete(
        `/api/admin/users/${encodeURIComponent(delTarget.id)}?mode=${encodeURIComponent(mode)}`,
        { auth: "admin" } as any,
      );
      setDelTarget(null);
      load();
    } catch (e) {
      setDelErr((e as APIError)?.message || "O'chirib bo'lmadi");
    } finally { setDelBusy(false); }
  }

  function exportCsv() {
    // Figma 6-panel: "Tugma ekrandagi filtrlarni saqlab qoladi — qidiruv,
    // viloyat, holat va platforma eksportga ham qo'llanadi."
    // `deleted` ataylab yuborilmaydi: eksport faol hisoblar ro'yxati.
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (region) params.set("region", region);
    if (oq(blocked, HOLAT_QIY)) params.set("blocked", blocked);
    if (oq(platform, PLATFORMA_QIY)) params.set("platform", platform);
    downloadAdminCsv("/api/admin/export/users.csv", params);
  }

  const total = useMemo(() => {
    const t = data?.total;
    return typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0;
  }, [data]);
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const users = data?.items ?? [];
  const csvUslub = tugma("ikkilamchi");
  const karta: React.CSSProperties = { boxShadow: `inset 0 0 0 1px ${HOSHIYA}, ${SOYA}` };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sarlavha kartasi ─────────────────────────────────────────── */}
      <div className="flex h-16 items-center justify-between gap-3 rounded-[14px] bg-white px-5" style={karta}>
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-6" style={{ color: IK }}>Foydalanuvchilar</h1>
          <p className="text-[12px] leading-4" style={{ color: OCH_KUL }}>
            Jami {son(total)} ta foydalanuvchi
          </p>
        </div>
        <button onClick={exportCsv} className={`${csvUslub.className} w-[180px] shrink-0`} style={csvUslub.style}>
          <Download size={16} aria-hidden />
          CSV yuklab olish
        </button>
      </div>

      {/* ── Filtr + jadval kartasi ───────────────────────────────────── */}
      <div className="overflow-hidden rounded-[14px] bg-white" style={karta}>
        <div className="flex flex-wrap items-center gap-2 px-5 pb-[15px] pt-[15px]">
          {/* Maydonlar endi umumiy komponentdan (components/admin/Filtr.tsx).
              Ilgari ular shu yerda yozilgan va to'liq dumaloq edi; Figma'da
              esa 3.3 da ham, 3.5 da ham radius 9 px — tugmalar bilan bir
              oilada turishi uchun. */}
          <MatnFiltr
            nomi="Ism yoki telefon bo'yicha qidiruv"
            kenglik={200}
            qidiruv
            placeholder="Ism yoki telefon…"
            qiymat={qKirit}
            maxLength={80}
            ozgardi={setQKirit}
          />
          <MatnFiltr
            nomi="Viloyat bo'yicha filtr"
            kenglik={130}
            placeholder="Viloyat"
            qiymat={viloyatKirit}
            maxLength={60}
            ozgardi={setViloyatKirit}
          />
          <Tanlov nomi="Holat" kenglik={145} qiymat={blocked} ozgardi={(v) => setBlocked(oq(v, HOLAT_QIY))}>
            <option value="">Holat (barchasi)</option>
            <option value="0">Faol</option>
            <option value="1">Bloklangan</option>
          </Tanlov>
          <Tanlov nomi="O'chirilganlar" kenglik={178} qiymat={deleted} ozgardi={(v) => setDeleted(oq(v, OCHIRILGAN_QIY))}>
            <option value="">O&apos;chirilganlar bilan</option>
            <option value="hide">Faqat faollari</option>
            <option value="only">Faqat o&apos;chirilganlari</option>
          </Tanlov>
          <Tanlov nomi="Platforma" kenglik={158} qiymat={platform} ozgardi={(v) => setPlatform(oq(v, PLATFORMA_QIY))}>
            <option value="">Platforma (barchasi)</option>
            {CLIENT_PLATFORMS.map((p) => (
              <option key={p} value={p}>{platformLabel(p)}</option>
            ))}
          </Tanlov>
          <div className="ml-auto text-[13px]" style={{ color: OCH_KUL }}>Jami: {son(total)}</div>
        </div>
        <div className="h-px" style={{ background: HOSHIYA }} />

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] table-fixed border-collapse text-[14px]">
            {/* Figma 3.3 jadvali 1152 px keng, ustunlar:
                Ism 220 · Telefon 150 · Viloyat 110 · Platforma 140 ·
                Holat 230 · Amallar 302. Foizga aylantirilgan — panel
                kengligi ekranga qarab o'zgaradi, nisbat esa qolishi kerak. */}
            <colgroup>
              <col style={{ width: `${(220 / 1152) * 100}%` }} />
              <col style={{ width: `${(150 / 1152) * 100}%` }} />
              <col style={{ width: `${(110 / 1152) * 100}%` }} />
              <col style={{ width: `${(140 / 1152) * 100}%` }} />
              <col style={{ width: `${(230 / 1152) * 100}%` }} />
              <col style={{ width: `${(302 / 1152) * 100}%` }} />
            </colgroup>
            <thead>
              {/* Figma: sarlavha yo'lagi 46 px, matn Semi Bold 12/16. */}
              <tr style={{ background: SARLAVHA_FON }}>
                <th className="h-[46px] pl-5 pr-3 text-left text-[12px] font-semibold leading-4" style={{ color: IK }}>Ism</th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: IK }}>Telefon</th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: IK }}>Viloyat</th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: IK }}>Platforma</th>
                <th className="px-3 text-left text-[12px] font-semibold leading-4" style={{ color: IK }}>Holat</th>
                <th className="pl-3 pr-5 text-right text-[12px] font-semibold leading-4" style={{ color: IK }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const blockedNow = isUserBlocked(u);
                const ocha = canUnblock(u);
                const holati = holat(u);
                return (
                  <tr key={u.id} className="border-b last:border-b-0" style={{ borderColor: HOSHIYA }}>
                    {/* Ism yonida hech qanday belgi YO'Q. O'chirilganlik endi
                        "Holat" ustunida turadi — bitta ustun, bitta javob.
                        Ilgari bu yerda qizil "o'chirilgan" yorlig'i bor edi
                        va u Holat ustunidagi "Faol" bilan ziddiyat hosil
                        qilardi. */}
                    <td className="py-[12px] pl-5 pr-3 align-middle">
                      <Link
                        href={`/admin/users/${encodeURIComponent(u.id)}`}
                        className="block truncate text-[13px] font-medium leading-[18px] hover:underline"
                        style={{ color: IK }}
                      >
                        {u.firstName} {u.lastName}
                      </Link>
                    </td>
                    {/* O'chirilgan hisobda raqam `deletedPhone` ga ko'chadi —
                        aks holda katak bo'sh ko'rinardi. Xira rang Figma'da
                        ham shunday: raqam endi hech kimga biriktirilmagan. */}
                    <td
                      className="whitespace-nowrap px-3 py-[12px] align-middle text-[12px] leading-[17px]"
                      style={{ color: u.isDeleted ? XIRA_QUYUQ : KUL }}
                    >
                      {telefon(u.phone || u.deletedPhone || "") || "—"}
                    </td>
                    <td className="truncate px-3 py-[12px] align-middle text-[12px] leading-[17px]" style={{ color: KUL }}>
                      {u.region || "—"}
                    </td>
                    {/* Platforma: BITTA nishon, izohsiz. Vebda qurilma ham
                        qo'shiladi — "Veb Android", "Veb iOS"; kompyuter
                        brauzerida shunchaki "Veb".

                        Ro'yxatdan o'tgan joyi bu ustunda ATAYLAB yo'q: u
                        batafsil sahifadagi alohida "Ro'yxat platformasi"
                        maydonida turadi. Ustun sarlavhasi ("Platforma")
                        bitta qiymat va'da qiladi, ikkinchi qator esa har
                        bir satrni balandlashtirardi. */}
                    <td className="px-3 py-[12px] align-middle">
                      <span
                        className="inline-flex h-[21px] items-center rounded-full px-[10px] text-[11px] font-medium leading-[15px]"
                        style={{ color: KUL, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
                      >
                        {platformLabel(u.lastPlatform, u.lastDevice)}
                      </span>
                    </td>
                    {/* BITTA nishon, izohsiz. Blok manbasi va sababi ataylab
                        yo'q — `holat()` izohiga qarang. */}
                    <td className="px-3 py-[12px] align-middle">
                      <HolatNishoni holati={holati} />
                    </td>
                    <td className="py-[12px] pl-3 pr-5 align-middle">
                      <div className="flex items-center justify-end gap-[6px]">
                        <Link href={`/admin/users/${encodeURIComponent(u.id)}`} {...tugma("ikkilamchi", { kichik: true })}>
                          Batafsil
                        </Link>
                        {/* BITTA tugma: blok manbasi qanday bo'lishidan qat'i
                            nazar. Avtomatik blokni moderator ocha olmaydi —
                            tugma bosilib 403 olishdan ko'ra, o'chiq turgani
                            va sababi aytilgani ma'qul. */}
                        {u.isDeleted ? null : blockedNow ? (
                          <button
                            onClick={() => { setErr(""); setUnblockTarget(u); }}
                            disabled={!ocha}
                            title={ocha ? "" : "Avtomatik moderatsiya blokini faqat superadmin ocha oladi"}
                            {...tugma("ikkilamchi", { kichik: true, ochiq: !ocha })}
                          >
                            Blokdan chiqarish
                          </button>
                        ) : (
                          <button
                            onClick={() => { setErr(""); setReason(""); setBlockTarget(u); }}
                            {...tugma("ikkilamchi", { kichik: true })}
                          >
                            Bloklash
                          </button>
                        )}
                        {/* O'chirilgan hisob uchun bloklash ma'nosini yo'qotadi:
                            u allaqachon kira olmaydi va qaytarilmaydi. Faqat
                            superadmin uni bazadan butunlay o'chira oladi. */}
                        {(!u.isDeleted || isSuper) && (
                          <button
                            onClick={() => { setDelErr(""); setDelTarget(u); }}
                            {...tugma("xavf", { kichik: true })}
                          >
                            {u.isDeleted ? "Bazadan o'chirish" : "O'chirish"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {/* Bo'sh holat — Figma 3.3a · 5: jadval o'rnida 120 px balandlikda
                  bitta yozuv. Xato ham shu yerda chiqadi: ro'yxat kelmaganda
                  admin bo'sh jadvalni "hech kim yo'q" deb o'qimasligi kerak. */}
              {!users.length && (
                <tr>
                  <td
                    colSpan={6}
                    className="h-[120px] px-5 text-center text-[13px] font-medium leading-[18px]"
                    style={{ color: royxatXato ? QIZIL : XIRA_QUYUQ }}
                  >
                    {yuklanmoqda ? "Yuklanmoqda…" : royxatXato || "Hech narsa topilmadi"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <>
            <div className="h-px" style={{ background: HOSHIYA }} />
            <div className="px-5 py-[15px]">
              <Pagination page={page} pages={pages} onPage={setPage} />
            </div>
          </>
        )}
      </div>

      <DeleteModeModal
        open={!!delTarget}
        title="Foydalanuvchini o'chirish"
        what="hisob"
        canPurge={isSuper}
        kim={
          delTarget
            ? {
                yorliq: "O'chirilayotgan foydalanuvchi",
                nomi: `${delTarget.firstName} ${delTarget.lastName}`.trim() || "Ismsiz hisob",
                // O'chirilgan hisobda raqam `phone` dan `deletedPhone` ga
                // ko'chadi (apps/api/internal/admin/users.go) — arxivdagisini
                // ko'rsatamiz, aks holda superadmin bazadan o'chirayotganda
                // karta raqamsiz qolar va aynan kimligini tasdiqlab
                // bo'lmasdi.
                tafsilot:
                  telefon(delTarget.phone || delTarget.deletedPhone || "") ||
                  "Raqam bo'shatilgan",
              }
            : undefined
        }
        // Uchovidan biri tasodifiy so'raladi. Bo'sh maydon oynaning o'zida
        // tashlab yuboriladi, shuning uchun familiyasiz hisob ham
        // o'chiriladi — ismi yoki raqami so'raladi, xolos.
        //
        // Raqam ham nomzod, chunki ismdosh ikki hisobni faqat u ajratadi.
        // Manba kartadagi bilan BIR XIL bo'lishi shart (`phone`, u bo'sh
        // bo'lsa arxivdagi `deletedPhone`), aks holda kartada bir raqam
        // turib, boshqasi so'ralardi.
        tasdiq={
          delTarget
            ? [
                { maydon: "ismini", qiymat: delTarget.firstName, placeholder: "Ism" },
                { maydon: "familiyasini", qiymat: delTarget.lastName, placeholder: "Familiya" },
                {
                  maydon: "telefon raqamini",
                  qiymat: delTarget.phone || delTarget.deletedPhone || "",
                  placeholder: "Telefon raqami",
                  tur: "raqam",
                },
              ]
            : undefined
        }
        busy={delBusy}
        error={delErr}
        onCancel={() => setDelTarget(null)}
        onConfirm={del}
      />

      {/* ── Bloklash — sabab MAJBURIY (Figma 3.3a · 1) ────────────────
          Nega: blokni ochadigan yoki e'tirozni ko'radigan admin ko'pincha uni
          qo'ygan admin emas, va oradan oylar o'tgan bo'ladi. Sababsiz blok —
          hech kim javob bera olmaydigan qaror. */}
      <AdminModal
        open={!!blockTarget}
        onClose={() => setBlockTarget(null)}
        title="Foydalanuvchini bloklash"
        footer={
          <>
            <button onClick={() => setBlockTarget(null)} disabled={busy} {...tugma("ikkilamchi", { ochiq: busy })}>
              Bekor
            </button>
            <button
              onClick={submitBlock}
              disabled={busy || !reason.trim()}
              {...tugma("xavf", { ochiq: busy || !reason.trim() })}
            >
              {busy ? "Bloklanmoqda…" : "Bloklash"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            {blockTarget?.firstName} {blockTarget?.lastName} ilovadan foydalana olmay qoladi va uning
            e&apos;lonlari yashiriladi.
          </p>
          <div className="flex flex-col gap-[5px]">
            <label htmlFor="blok-sabab" className="text-[13px] font-semibold leading-[17px]" style={{ color: KUL }}>
              Bloklash sababi
            </label>
            <textarea
              id="blok-sabab"
              className="h-[82px] w-full resize-none rounded-[10px] bg-white px-[13px] py-[9px] text-[13px] leading-[19px] outline-none placeholder:text-[#a7acb9]"
              style={{ color: IK, boxShadow: `inset 0 0 0 1px ${HOSHIYA_QUYUQ}` }}
              placeholder="Masalan: takroriy spam e'lonlar, boshqa foydalanuvchilarga tahdid…"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="text-right text-[12px] leading-4 tabular-nums" style={{ color: XIRA }}>
              {reason.length} / 500
            </div>
          </div>
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            Sabab foydalanuvchining batafsil sahifasida saqlanadi — ertaga nega bloklangani shu
            yerdan bilinadi.
          </p>
          {err && <p className="text-[13px] leading-[19px]" style={{ color: QIZIL }}>{err}</p>}
        </div>
      </AdminModal>

      {/* ── Blokni ochish — bitta amal, manbasidan qat'i nazar (3.3a · 2) ── */}
      <AdminModal
        open={!!unblockTarget}
        onClose={() => setUnblockTarget(null)}
        title="Blokdan chiqarasizmi?"
        footer={
          <>
            <button onClick={() => setUnblockTarget(null)} disabled={busy} {...tugma("ikkilamchi", { ochiq: busy })}>
              Yo&apos;q
            </button>
            <button onClick={submitUnblock} disabled={busy} {...tugma("asosiy", { ochiq: busy })}>
              {busy ? "Ochilmoqda…" : "Ha, ochish"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-[14px]">
          {unblockTarget?.blockReason && (
            <p className="text-[13px] leading-[19px]">
              <span style={{ color: XIRA }}>Blok sababi: </span>
              <span style={{ color: IK }}>{unblockTarget.blockReason}</span>
            </p>
          )}
          <p className="text-[13px] leading-[19px]" style={{ color: OCH_KUL }}>
            Foydalanuvchi ilovadan yana foydalana boshlaydi va e&apos;lonlari qaytadi.
          </p>
          {unblockTarget && moderationBanUntil(unblockTarget) && (
            <div
              className="flex gap-[10px] rounded-[10px] px-[13px] py-[7px]"
              style={{ background: ORANJ_FON }}
            >
              <Info size={16} aria-hidden className="mt-[1px] shrink-0" style={{ color: ORANJ }} />
              <p className="text-[13px] leading-[17px]" style={{ color: ORANJ_MATN }}>
                Bu avtomatik blok ({sana(moderationBanUntil(unblockTarget)!)} gacha edi).
                Buzilishlar hisobi ham nolga tushadi — aks holda keyingi bitta buzilish uni darhol
                qayta bloklardi.
              </p>
            </div>
          )}
          {err && <p className="text-[13px] leading-[19px]" style={{ color: QIZIL }}>{err}</p>}
        </div>
      </AdminModal>
    </div>
  );
}

/**
 * "Holat" ustunidagi nishon — Figma 3.3 va 4.4 · Holat nishoni.
 *
 * O'lchamlar Figma'dan: 92×22, to'liq dumaloq, 1 px ICHKI hoshiya, matn
 * Inter Medium 11/15. Kenglik qat'iy — uch xil matn (Faol / Bloklangan /
 * O'chirilgan) turli uzunlikda, lekin ustun bo'ylab nishonlarning chekkasi
 * bir chiziqda turishi kerak.
 */
function HolatNishoni({ holati }: { holati: Holat }) {
  const { matn, rang } = HOLAT_KOR[holati];
  return (
    <span
      className="inline-flex h-[22px] w-[92px] items-center justify-center rounded-full text-[11px] font-medium leading-[15px]"
      style={{ color: rang, boxShadow: `inset 0 0 0 1px ${rang}` }}
    >
      {matn}
    </span>
  );
}
