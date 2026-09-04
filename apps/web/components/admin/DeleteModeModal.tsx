"use client";
import { useEffect, useId, useState } from "react";
import { AdminModal } from "@/components/admin/AdminModal";
import {
  HOSHIYA,
  HOSHIYA_QUYUQ,
  IK,
  KO_K,
  KO_K_FON,
  KUL,
  OCH_KUL,
  QIZIL,
  QIZIL_FON,
  SARLAVHA_FON,
  XIRA,
  tugma,
} from "@/components/admin/ui";

export type DeleteMode = "hidden" | "purge";

/**
 * Oyna boshidagi karta — aynan kim (yoki nima) o'chirilayotgani.
 *
 * Jadvalda o'nlab qator turadi va "O'chirish" tugmalari bir xil ko'rinadi.
 * Bir qator pastdagi tugmani bosish — eng oson xato, va uni oyna ochilgandan
 * keyin sezish deyarli imkonsiz edi: oyna faqat "hisob o'chiriladi" derdi.
 */
export type Kim = {
  /** Kartaning ustidagi kichik yozuv: "O'chirilayotgan foydalanuvchi". */
  yorliq: string;
  /** Katta qatorda ko'rinadigan nom. */
  nomi: string;
  /** Ostidagi qo'shimcha qator — telefon raqami va h.k. */
  tafsilot?: string;
};

/**
 * Yozib tasdiqlash uchun bitta nomzod.
 *
 * Ro'yxat beriladi, oyna esa ochilganda ulardan BITTASINI tasodifiy tanlaydi.
 */
export type TasdiqNomzodi = {
  /** Yorliqdagi qalin qism: "ismini", "familiyasini", "telefon raqamini". */
  maydon: string;
  /** Admin aynan shuni yozishi kerak. */
  qiymat: string;
  /** Maydondagi xira yozuv: "Ism", "Familiya", "Telefon raqami". */
  placeholder: string;
  /**
   * Solishtirish qoidasi.
   *
   * `"raqam"` — faqat RAQAMLAR taqqoslanadi. Telefon uchun shart: kartada
   * u "+998 93 445 12 09" ko'rinishida turadi, admin esa uni bo'shliqsiz
   * yoki `+998` siz terishi tabiiy. Matn sifatida solishtirsak, ekrandagi
   * raqamni to'g'ri o'qigan admin ham tugmani ocholmasdi.
   *
   * Standart `"matn"` — ism/familiya uchun ([moslash] ga qarang).
   */
  tur?: "matn" | "raqam";
};

/** Nomzod berilmaganda so'raladigan so'z (e'lonlar ekrani). */
const CONFIRM_WORD = "O'CHIRISH";

/**
 * Yozilganni solishtirishdan oldin normallashtiradi.
 *
 * # NEGA APOSTROFLAR ALOHIDA
 *
 * O'zbekcha ismlarda apostrof ko'p uchraydi — G'ulom, To'lqin, Sa'dulla.
 * Bazada u turli belgilar bilan yozilgan bo'lishi mumkin: to'g'ri tipografik
 * `’`, o'zbek alifbosining `ʻ`/`ʼ` belgilari yoki oddiy `'`. Klaviaturadan
 * esa admin deyarli har doim oddiy `'` teradi.
 *
 * Ularni tenglashtirmasak, admin ekrandagi ismni AYNAN ko'chirib yozsa ham
 * tugma ochilmasdi va oynadan chiqishning yo'li qolmasdi.
 *
 * Katta-kichik harf ham ahamiyatsiz: bu qulf emas, ataylab qo'yilgan to'siq —
 * maqsad adminni to'xtatib, kimni o'chirayotganini o'qishga majburlash.
 * `toLocaleLowerCase` ataylab ISHLATILMAYDI: turkiy tillar uchun u `I` ni
 * nuqtasiz `ı` ga aylantiradi va "Islom" kabi ismlarni buzardi.
 */
function moslash(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[‘’ʹʻʼ`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Telefon raqamini solishtirish uchun: faqat raqamlar qoladi.
 *
 * Kartada raqam "+998 93 445 12 09" bo'lib turadi, klaviaturadan esa uni
 * har xil terish mumkin — `+998934451209`, `998 93 445 12 09`, `93 4451209`.
 * Bularning hammasi bir xil raqam va hammasi o'tishi kerak: to'siqning
 * maqsadi adminni kartani O'QISHGA majburlash, terish uslubini emas.
 */
function faqatRaqam(s: string): string {
  return s.replace(/\D+/g, "");
}

/**
 * O'chirish oynasi — ikki xil o'chirishni ANIQ ajratib ko'rsatadi.
 *
 * # NEGA ALOHIDA KOMPONENT
 *
 * Foydalanuvchilar va e'lonlar sahifalarida bir xil qaror qabul qilinadi.
 * Ikki joyda ikki xil matn yoki ikki xil ogohlantirish bo'lsa, adminning
 * "bu tugma nima qiladi?" degan tasavvuri joyiga qarab o'zgarardi — bu esa
 * qaytarib bo'lmaydigan amalda xavfli.
 *
 * # NEGA YOZIB TASDIQLASH
 *
 * O'chirish qaytarilmaydi va zaxira nusxa yo'q. Oddiy "Ha" tugmasi tasodifiy
 * bosishdan himoya qilmaydi: admin ro'yxatni tozalayotganda bir xil harakatni
 * o'nlab marta takrorlaydi va qo'l avtomatik ravishda tasdiqlab yuboradi.
 * So'zni yozish esa harakatni to'xtatib, diqqatni qaratadi.
 *
 * # NEGA TASODIFIY ISM, DOIMIY SO'Z EMAS
 *
 * `O'CHIRISH` har safar bir xil edi — ya'ni uni yodlab, ko'zni yumib yozish
 * mumkin. U faqat "o'chirmoqchimisan?" degan savolga javob berardi, "KIMNI
 * o'chirmoqchisan?" degan savolga emas. Aynan shu ikkinchi savol muhim:
 * eng qimmat xato — noto'g'ri odamni o'chirish.
 *
 * Endi so'raladigan qiymat o'sha odamning ismi, familiyasi yoki telefon
 * raqami bo'ladi va qaysi biri so'ralishi oyna HAR OCHILGANDA qaytadan
 * tanlanadi. Yodlab bo'lmaydi: javob har foydalanuvchida boshqacha va
 * bitta foydalanuvchida ham har safar boshqa maydon so'ralishi mumkin.
 * Yozish uchun yuqoridagi kartani o'qish SHART — demak tasdiq o'z-o'zidan
 * "ha, aynan shu odam" degan ma'noni bildiradi.
 *
 * Raqam ham nomzod: aynan u ikkita ismdoshni bir-biridan ajratadigan yagona
 * maydon, ya'ni eng qimmat xatoga to'g'ridan-to'g'ri qarshi turadi.
 *
 * Bu server tomonidagi himoyaning O'RNINI BOSMAYDI — u yerda rol tekshiruvi
 * alohida turadi (deletemode.go). Bu shunchaki tasodifga qarshi to'siq.
 *
 * # KO'RINISHI
 *
 * Figma "3.3a · Foydalanuvchilar — oynalar va bo'sh holat", 3 va 4-panel.
 * Tanlangan variant to'liq matnni ko'rsatadi; birinchi variant tanlanmagan
 * bo'lsa bitta qatorga yig'iladi — shunda ko'z darhol tanlanganini topadi.
 */
export function DeleteModeModal({
  open,
  title,
  what,
  canPurge,
  kim,
  tasdiq,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  /** Oyna sarlavhasi, masalan "Foydalanuvchini o'chirish". */
  title: string;
  /** Nima o'chirilayotgani — matn ichida ishlatiladi ("e'lon", "hisob"). */
  what: string;
  /** Faqat superadmin bazadan o'chira oladi. */
  canPurge: boolean;
  /** Berilsa, oyna boshida kim o'chirilayotgani kartada ko'rsatiladi. */
  kim?: Kim;
  /**
   * Yozib tasdiqlash nomzodlari.
   *
   * Berilsa — HAR IKKALA o'chirish turida ham tasdiq so'raladi va ro'yxatdan
   * bittasi tasodifiy tanlanadi. Berilmasa eski xulq saqlanadi: tasdiq faqat
   * "bazadan o'chirish"da va so'z doimo `O'CHIRISH`.
   */
  tasdiq?: TasdiqNomzodi[];
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (mode: DeleteMode) => void;
}) {
  const [mode, setMode] = useState<DeleteMode>("hidden");
  const [typed, setTyped] = useState("");
  const [nomzod, setNomzod] = useState<TasdiqNomzodi | null>(null);
  const nomi = useId();

  // Oyna har ochilganda boshlang'ich holatga qaytadi. Aks holda oldingi
  // safar "purge" tanlangani va yozilgan tasdiq saqlanib qolib, keyingi
  // o'chirish bir bosishda bazadan o'chib ketardi.
  //
  // Tasodifiy nomzod ham AYNAN shu yerda tanlanadi va `tasdiq` ataylab
  // bog'liqliklarga qo'shilmaydi: chaqiruvchi massivni joyida yozadi
  // (`tasdiq={[...]}`), ya'ni u har renderda yangi. Bog'liqlik qilsak,
  // yozilgan har harf effektni qayta ishga tushirib, so'raladigan maydonni
  // almashtirardi va yozib tugatib bo'lmasdi.
  useEffect(() => {
    if (!open) return;
    setMode("hidden");
    setTyped("");
    // Bo'sh qiymatlar tashlab yuboriladi: familiyasi kiritilmagan hisobda
    // "familiyasini yozing" deyish — chiqib bo'lmaydigan oyna.
    const nomzodlar = (tasdiq || []).filter((t) => t.qiymat.trim() !== "");
    setNomzod(
      nomzodlar.length ? nomzodlar[Math.floor(Math.random() * nomzodlar.length)] : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Qaysi so'z so'raladi:
  //
  //   1. Tasodifiy tanlangan ism/familiya/raqam — asosiy holat.
  //   2. `tasdiq` berilgan, lekin nomzod chiqmagan — ya'ni hisobning ismi
  //      ham, familiyasi ham bo'sh va raqami ham bo'shatilgan. Doimiy
  //      so'zga qaytamiz: bu ekran "tasdiq HAR IKKALA turda so'raladi" deb
  //      va'da beradi, bunday hisob esa aynan shu va'dadan tashqarida
  //      qolib, bir bosishda o'chib ketardi.
  //   3. `tasdiq` umuman berilmagan (e'lonlar ekrani) — eski qoida:
  //      tasdiq faqat qaytarib bo'lmaydigan "bazadan o'chirish"da.
  const kutilgan = nomzod
    ? nomzod.qiymat
    : (tasdiq && tasdiq.length > 0) || mode === "purge"
      ? CONFIRM_WORD
      : "";
  // Telefon raqamlar bo'yicha, qolgani matn bo'yicha solishtiriladi.
  // `kutilganRaqam !== ""` sharti kerak: raqamsiz qiymat (masalan bitta
  // "+") ikkala tomonda ham bo'sh satrga aylanib, bo'sh maydonni to'g'ri
  // deb hisoblab yuborardi.
  const kutilganRaqam = faqatRaqam(kutilgan);
  const tasdiqTayyor =
    kutilgan === "" ||
    (nomzod?.tur === "raqam"
      ? kutilganRaqam !== "" && faqatRaqam(typed) === kutilganRaqam
      : moslash(typed) === moslash(kutilgan));
  const ochiq = !!busy || !tasdiqTayyor;

  return (
    <AdminModal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidth="max-w-[500px]"
      footer={
        <>
          <button onClick={onCancel} disabled={busy} {...tugma("ikkilamchi", { ochiq: busy })}>
            Bekor qilish
          </button>
          <button onClick={() => onConfirm(mode)} disabled={ochiq} {...tugma("xavf", { ochiq })}>
            {busy
              ? "Bajarilmoqda…"
              : mode === "purge"
                ? "Bazadan butunlay o'chirish"
                : "Foydalanuvchilardan olib tashlash"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kim && (
          <div
            className="flex flex-col gap-[3px] rounded-[13px] px-[14px] py-3"
            style={{ background: SARLAVHA_FON, boxShadow: `inset 0 0 0 1px ${HOSHIYA}` }}
          >
            <span className="text-[11px] font-medium leading-[15px]" style={{ color: OCH_KUL }}>
              {kim.yorliq}
            </span>
            {/* `break-words` — uzun ism kartadan toshib ketmasin. */}
            <span className="break-words text-[15px] font-bold leading-5" style={{ color: IK }}>
              {kim.nomi}
            </span>
            {kim.tafsilot && (
              <span className="text-[12px] leading-[17px]" style={{ color: KUL }}>
                {kim.tafsilot}
              </span>
            )}
          </div>
        )}

        <Variant
          nomi={nomi}
          tanlangan={mode === "hidden"}
          rang={IK}
          sarlavha="Foydalanuvchilardan olib tashlash"
          onSelect={() => setMode("hidden")}
        >
          {mode === "hidden" ? (
            <>
              <p style={{ color: OCH_KUL }}>
                Bu {what} foydalanuvchilarga umuman ko&apos;rinmaydi — na qidiruvda, na
                ro&apos;yxatda, na to&apos;g&apos;ridan-to&apos;g&apos;ri havola orqali. Admin
                panelida esa &laquo;o&apos;chirilgan&raquo; belgisi bilan ko&apos;rinib turadi va
                bazada saqlanadi.
              </p>
              <p style={{ color: XIRA }}>
                Rasmlar o&apos;chiriladi: ular ommaviy manzilda yotadi.
              </p>
              {/* Oxirgi bo'lak Figma 3.5a · 4 dan: «…u qaytariladi». Aynan shu
                  qarama-qarshilik muhim — yonma-yon turgan ikki amaldan biri
                  qaytariladi, ikkinchisi yo'q. Buni aytmasak, admin ikkisini
                  bir xil xavfsiz deb o'ylardi. */}
              <p style={{ color: QIZIL }}>
                Qaytarib bo&apos;lmaydi — bu &laquo;Yashirish&raquo; tugmasi emas, u
                qaytariladi.
              </p>
            </>
          ) : (
            <p style={{ color: OCH_KUL }}>
              Panelda &laquo;o&apos;chirilgan&raquo; belgisi bilan ko&apos;rinib turadi va bazada
              saqlanadi.
            </p>
          )}
        </Variant>

        {canPurge && (
          <Variant
            nomi={nomi}
            tanlangan={mode === "purge"}
            rang={QIZIL}
            sarlavha="Bazadan butunlay o'chirish"
            onSelect={() => setMode("purge")}
          >
            <p style={{ color: OCH_KUL }}>
              Yozuv bazadan yo&apos;q qilinadi. Adminga ham ko&apos;rinmaydi, bog&apos;liq arizalar
              va bildirishnomalar ham o&apos;chadi.
            </p>
            <p style={{ color: QIZIL }}>Qaytarib bo&apos;lmaydi va zaxira nusxa yo&apos;q.</p>
          </Variant>
        )}

        {kutilgan !== "" && (
          <div className="mt-1 flex flex-col gap-2">
            <label
              htmlFor={`${nomi}-tasdiq`}
              className="text-[13px] leading-[17px]"
              style={{ color: KUL }}
            >
              {nomzod ? (
                <>
                  Tasdiqlash uchun foydalanuvchining{" "}
                  <span className="font-bold" style={{ color: QIZIL }}>
                    {nomzod.maydon}
                  </span>{" "}
                  yozing:
                </>
              ) : (
                <>
                  Tasdiqlash uchun{" "}
                  <span className="font-bold" style={{ color: QIZIL }}>
                    {CONFIRM_WORD}
                  </span>{" "}
                  deb yozing:
                </>
              )}
            </label>
            <input
              id={`${nomi}-tasdiq`}
              className="h-10 w-full rounded-[10px] bg-white px-[13px] text-[13px] outline-none placeholder:text-[#a7acb9]"
              style={{ color: IK, boxShadow: `inset 0 0 0 1px ${QIZIL}` }}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={nomzod ? nomzod.placeholder : CONFIRM_WORD}
              // Telefonda raqamli klaviatura ochilsin — harflarni terish
              // kerak bo'lmagan joyda harf klaviaturasi ortiqcha qadam.
              inputMode={nomzod?.tur === "raqam" ? "tel" : undefined}
              autoComplete="off"
              // Ism/familiya maydonida brauzerning avtomatik to'ldirishi va
              // birinchi harfni katta qilishi to'sqinlik qiladi.
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
            />
            {nomzod && (
              <p className="text-[11px] leading-4" style={{ color: XIRA }}>
                Ism, familiya yoki telefon raqami tasodifiy so&apos;raladi — yuqoridagi
                ma&apos;lumotni o&apos;qing.
              </p>
            )}
          </div>
        )}

        {!canPurge && (
          <p className="text-[13px] leading-[17px]" style={{ color: OCH_KUL }}>
            Bazadan butunlay o&apos;chirishni faqat superadmin bajara oladi.
          </p>
        )}

        {error && (
          <p className="text-[13px] leading-[17px]" style={{ color: QIZIL }}>
            {error}
          </p>
        )}
      </div>
    </AdminModal>
  );
}

/** Bitta variant kartasi: radio + sarlavha + izohlar (Figma 3 va 4-panel). */
function Variant({
  nomi,
  tanlangan,
  rang,
  sarlavha,
  onSelect,
  children,
}: {
  nomi: string;
  tanlangan: boolean;
  /** Sarlavha rangi — u ayni paytda tanlov halqasining rangi ham. */
  rang: string;
  sarlavha: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className="flex cursor-pointer gap-4 rounded-xl px-[13px] py-[11px]"
      style={{
        background: tanlangan ? (rang === QIZIL ? QIZIL_FON : KO_K_FON) : "#ffffff",
        boxShadow: tanlangan
          ? `inset 0 0 0 1.5px ${rang === QIZIL ? QIZIL : KO_K}`
          : `inset 0 0 0 1px ${HOSHIYA_QUYUQ}`,
      }}
    >
      {/* Haqiqiy radio ko'rinmaydi, lekin klaviatura va skrinrider uchun
          o'z o'rnida turadi — ustidagi doira faqat bezak. */}
      <input
        type="radio"
        name={nomi}
        className="sr-only"
        checked={tanlangan}
        onChange={onSelect}
      />
      <span
        aria-hidden
        className="mt-[2px] h-[17px] w-[17px] shrink-0 rounded-full bg-white"
        style={{
          boxShadow: tanlangan
            ? `inset 0 0 0 5px ${rang === QIZIL ? QIZIL : KO_K}`
            : "inset 0 0 0 2px #d2d4e1",
        }}
      />
      <div className="flex min-w-0 flex-col gap-[3px] text-[13px] leading-[17px]">
        <div className="font-semibold" style={{ color: rang }}>
          {sarlavha}
        </div>
        {children}
      </div>
    </label>
  );
}
