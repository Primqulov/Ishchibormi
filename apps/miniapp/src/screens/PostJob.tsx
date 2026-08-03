/**
 * E'lon berish — Figma maketidagi "E'lon berish (Ish haqi tanlovi bilan)".
 *
 * Tartibi va ko'rinishi maketdan: sarlavha va tavsif, vazifa nomi, turkum
 * chiplari, tavsif, so'ng ish haqi / ishchilar soni / to'lov turi BITTA
 * PANELDA (ular bir-biriga bog'liq — jami summa shulardan hisoblanadi va
 * darhol ko'rsatiladi), sana-vaqt, xarita, rasmlar va pastda katta ko'k tugma.
 *
 * Maketda YO'Q, lekin qoldirilgan ikki maydon — jins va aloqa raqami. Mobil
 * ilovada ular bor (flutter-app → post_job_page.dart), ya'ni mahsulotning
 * haqiqiy funksiyasi; maketga qarab olib tashlash Mini App'ni boshqa
 * klientlardan kamroq imkoniyatli qilardi. Ular maket uslubida chizilgan.
 *
 * SANA maketda oddiy `datetime-local` maydon. Backend esa ish sanasini eng
 * ko'pi 3 kun oldinga qo'yishga ruxsat beradi (MAX_SCHEDULE_DAYS). Shuning
 * uchun maydonga `min`/`max` qo'yilgan: ko'rinishi maketdagidek qoladi, lekin
 * taqiqlangan kunni umuman tanlab bo'lmaydi va foydalanuvchi serverdan xato
 * olmaydi.
 *
 * Yuborish tugmasi sahifa ichida (maketdagidek), Telegram MainButton'ida
 * emas: maket uni aniq shunday ko'rsatadi va forma oxirida turgan katta
 * tugma uzun formada tabiiy tugallanish nuqtasi bo'ladi.
 */

import { useEffect, useRef, useState } from "react";
import { LocationPicker } from "@/components/LocationPicker";
import { ImageIcon, TrashIcon, InfoIcon, SendIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import { fmtSum, fmtPhone, onlyDigits } from "@/lib/format";
import { alertUser, haptic } from "@/lib/telegram";
import {
  GENDER_LABEL,
  MAX_SCHEDULE_DAYS,
  createElon,
  fetchCategories,
  uploadFile,
  type APIError,
  type Category,
  type Elon,
  type Gender,
} from "@/lib/api";

const MAX_IMAGES = 5;

export function PostJob({
  myPhone,
  onCreated,
}: {
  /** Aloqa raqami sifatida oldindan to'ldiriladi. */
  myPhone?: string;
  onCreated: (e: Elon) => void;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [workers, setWorkers] = useState(1);
  const [perWorker, setPerWorker] = useState(true);
  const [when, setWhen] = useState("");
  const [gender, setGender] = useState<Gender>("mixed");
  const [phone, setPhone] = useState(myPhone ? fmtPhone(myPhone) : "");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((cs) => setCategories(cs.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  const priceNum = Number(onlyDigits(price) || 0);
  // Backend narx 0 bo'lsa e'lonni "kelishiladi" deb belgilaydi. Maketda
  // uchinchi tugma yo'q, shuning uchun bo'sh maydon shu ma'noni beradi —
  // va buni foydalanuvchiga pastda yozib qo'yamiz (yashirin xatti-harakat
  // bo'lib qolmasin).
  const negotiable = priceNum <= 0;
  const total = perWorker ? priceNum * workers : priceNum;

  // fmtPhone bo'sh matnga ham "+998" qaytaradi, ya'ni "maydon bo'shmi"
  // tekshiruvi yaramaydi — kodsiz raqamlar sanaladi.
  const phoneDigits = onlyDigits(phone).replace(/^998/, "");
  const phoneReady = phoneDigits.length === 9;

  const valid =
    title.trim().length >= 3 &&
    Boolean(categoryId) &&
    description.trim().length >= 5 &&
    workers >= 1;

  async function submit() {
    if (!valid || saving || uploading > 0) return;
    setSaving(true);
    try {
      const created = await createElon({
        title: title.trim(),
        categoryId,
        description: description.trim(),
        workersNeeded: workers,
        pricingType: negotiable ? "negotiable" : perWorker ? "per_worker" : "total",
        priceAmount: negotiable ? 0 : priceNum,
        // `datetime-local` "YYYY-MM-DDTHH:mm" beradi — backend sanani va
        // soatni alohida kutadi.
        startDate: when ? when.slice(0, 10) : undefined,
        workTimeFrom: when ? when.slice(11, 16) : undefined,
        contactPhone: phoneReady ? `+998${phoneDigits}` : undefined,
        gender,
        images,
        lat: coords?.lat,
        lng: coords?.lng,
      });
      haptic.success();
      onCreated(created);
    } catch (e) {
      haptic.error();
      // Backend xabari aniq bo'ladi — uni o'zgartirmaymiz.
      alertUser((e as APIError).message || "E'lon joylanmadi. Qayta urinib ko'ring.");
    } finally {
      setSaving(false);
    }
  }

  async function pickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).slice(0, MAX_IMAGES - images.length);
    if (chosen.length === 0) {
      alertUser(`Eng ko'pi ${MAX_IMAGES} ta rasm qo'shish mumkin.`);
      return;
    }
    // Rasm tanlangan zahoti yuklanadi, yuborishda emas: sekin tarmoqda
    // "Yuborish" bosgandan keyin uzoq kutish yomon taassurot qoldiradi.
    setUploading((n) => n + chosen.length);
    for (const f of chosen) {
      try {
        const { url } = await uploadFile(f, "elon");
        setImages((prev) => [...prev, url]);
        haptic.tap();
      } catch (e) {
        haptic.error();
        alertUser((e as APIError).message || "Rasm yuklanmadi.");
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    // Bir xil faylni qayta tanlash ishlashi uchun input tozalanadi.
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-4 animate-fade-in">
      {/* ── Sarlavha ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <h1 className="text-[24px] font-bold leading-8 tracking-[-0.24px] heading">
          E'lon berish
        </h1>
        <p className="text-[16px] leading-6 muted">
          Vazifa tafsilotlarini kiriting va malakali ishchilarni toping.
        </p>
      </div>

      {/* ── Vazifa nomi ─────────────────────────────────────────── */}
      <div>
        <label className="field-label" htmlFor="pj-title">
          Vazifa nomi
        </label>
        <input
          id="pj-title"
          className="field"
          placeholder="Masalan: Hovlini tozalash"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
        />
      </div>

      {/* ── Kategoriya ──────────────────────────────────────────── */}
      <div>
        <span className="field-label">Kategoriya</span>
        {categories === null ? (
          <div className="skeleton h-10 w-full" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  haptic.select();
                  setCategoryId(c.id);
                }}
                className={`chip !px-5 !py-2.5 !text-[15px] ${categoryId === c.id ? "chip-active" : ""}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tavsif ──────────────────────────────────────────────── */}
      <div>
        <label className="field-label" htmlFor="pj-desc">
          Vazifa tavsifi
        </label>
        <textarea
          id="pj-desc"
          className="field min-h-[120px] resize-none"
          placeholder="Vazifa haqida batafsilroq ma'lumot bering..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </div>

      {/* ── Ish haqi paneli (maketdagi kulrang blok) ────────────── */}
      <div
        className="flex flex-col gap-3 rounded-2xl p-4"
        style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)" }}
      >
        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            <label className="field-label !text-[13px]" htmlFor="pj-price">
              Ish haqi (UZS)
            </label>
            <div className="relative">
              <input
                id="pj-price"
                className="field !pr-14"
                placeholder="150000"
                value={price}
                onChange={(e) => setPrice(onlyDigits(e.target.value).slice(0, 9))}
                inputMode="numeric"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[14px] font-medium subtle">
                UZS
              </span>
            </div>
          </div>

          <div className="shrink-0">
            <span className="field-label !text-[13px]">Ishchilar soni</span>
            <div
              className="flex items-center gap-1 rounded-xl px-1"
              style={{ background: "var(--card)", border: "1px solid var(--border-strong)" }}
            >
              <StepBtn
                label="−"
                onClick={() => setWorkers((w) => Math.max(1, w - 1))}
                disabled={workers <= 1}
              />
              <span className="min-w-[28px] text-center text-[17px] font-bold tabular-nums heading">
                {workers}
              </span>
              <StepBtn
                label="+"
                onClick={() => setWorkers((w) => Math.min(50, w + 1))}
                disabled={workers >= 50}
              />
            </div>
          </div>
        </div>

        <div>
          <span className="field-label !text-[13px]">To'lov turi</span>
          <div className="segmented">
            <button
              type="button"
              aria-pressed={perWorker}
              onClick={() => {
                haptic.select();
                setPerWorker(true);
              }}
            >
              Har bir kishi uchun
            </button>
            <button
              type="button"
              aria-pressed={!perWorker}
              onClick={() => {
                haptic.select();
                setPerWorker(false);
              }}
            >
              Umumiy summa
            </button>
          </div>
        </div>

        {/* Jami summa — maketdagi to'q sariq qator. */}
        {negotiable ? (
          <p className="flex items-start gap-1.5 text-[13.5px] leading-5 subtle">
            <InfoIcon size={15} className="mt-0.5 shrink-0" />
            Narx bo'sh qolsa e'lon «Kelishiladi» bo'lib chiqadi.
          </p>
        ) : (
          <p
            className="flex items-start gap-1.5 text-[14px] font-semibold leading-5"
            style={{ color: "var(--accent-text)" }}
          >
            <InfoIcon size={15} className="mt-0.5 shrink-0" />
            {perWorker
              ? `Jami to'lanadigan summa: ${fmtSum(total)} so'm`
              : `Bir ishchiga: ${fmtSum(Math.floor(total / workers))} so'm`}
          </p>
        )}
      </div>

      {/* ── Sana va vaqt ────────────────────────────────────────── */}
      <div>
        <label className="field-label" htmlFor="pj-when">
          Sana va vaqt
        </label>
        <input
          id="pj-when"
          type="datetime-local"
          className="field"
          value={when}
          min={localISO(0)}
          max={localISO(MAX_SCHEDULE_DAYS - 1, "23:59")}
          onChange={(e) => setWhen(e.target.value)}
        />
        <p className="mt-1.5 pl-0.5 text-[12.5px] subtle">
          Ish {MAX_SCHEDULE_DAYS} kun ichida boshlanishi kerak.
        </p>
      </div>

      {/* ── Manzil ──────────────────────────────────────────────── */}
      <div>
        <span className="field-label">Manzil</span>
        <LocationPicker value={coords} onChange={setCoords} />
      </div>

      {/* ── Kimlar uchun (maketda yo'q, mobil ilovada bor) ───────── */}
      <div>
        <span className="field-label">Kimlar uchun</span>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                haptic.select();
                setGender(g);
              }}
              className={`chip !px-5 !py-2.5 !text-[15px] ${gender === g ? "chip-active" : ""}`}
            >
              {GENDER_LABEL[g]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Aloqa raqami ────────────────────────────────────────── */}
      <div>
        <label className="field-label" htmlFor="pj-phone">
          Aloqa raqami
        </label>
        <input
          id="pj-phone"
          className="field"
          value={phone}
          onChange={(e) => setPhone(fmtPhone(e.target.value))}
          inputMode="tel"
          placeholder="+998 90 123 45 67"
        />
        {phone.length > 4 && !phoneReady && (
          <p className="mt-1.5 pl-0.5 text-[12.5px]" style={{ color: "#B42318" }}>
            Raqam to'liq emas — bo'sh qoldirsangiz profildagi raqam ishlatiladi.
          </p>
        )}
      </div>

      {/* ── Rasmlar ─────────────────────────────────────────────── */}
      <div>
        <span className="field-label">Rasmlar</span>
        <div className="flex flex-wrap gap-3">
          {/* Maketda "QO'SHISH" qutisi birinchi turadi. */}
          {images.length + uploading < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                fileInput.current?.click();
              }}
              className="flex flex-col items-center justify-center gap-1 rounded-xl transition active:scale-95"
              style={{
                width: 96,
                height: 96,
                border: "1.5px dashed var(--border-strong)",
                color: "var(--text-subtle)",
              }}
            >
              <ImageIcon size={22} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.5px]">
                Qo'shish
              </span>
            </button>
          )}

          {images.map((src, i) => (
            <div
              key={src}
              className="relative overflow-hidden rounded-xl"
              style={{ width: 96, height: 96, border: "1px solid var(--border)" }}
            >
              <img src={src} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  setImages((prev) => prev.filter((_, j) => j !== i));
                }}
                aria-label="Rasmni o'chirish"
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full text-white"
                style={{ background: "rgba(0,0,0,.55)" }}
              >
                <TrashIcon size={13} />
              </button>
            </div>
          ))}

          {uploading > 0 && (
            <div
              className="grid place-items-center rounded-xl"
              style={{ width: 96, height: 96, background: "var(--bg-subtle)" }}
            >
              <Spinner />
            </div>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => void pickImages(e.target.files)}
        />
      </div>

      {/* ── Yuborish ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!valid || saving || uploading > 0}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-[17px] font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
        style={{ background: "var(--brand)", boxShadow: "var(--shadow-blue)" }}
      >
        <SendIcon size={18} />
        {saving ? "Yuborilmoqda..." : "E'lonni joylashtirish"}
      </button>

      {!valid && (
        <p className="-mt-2 text-center text-[12.5px] subtle">
          Nomi, turkumi va tavsifi to'ldirilgach e'lonni joylashingiz mumkin.
        </p>
      )}
    </div>
  );
}

function StepBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.select();
        onClick();
      }}
      disabled={disabled}
      className="grid h-11 w-9 place-items-center rounded-lg text-[20px] font-bold transition active:scale-90 disabled:opacity-30"
      style={{ color: "var(--brand)" }}
    >
      {label}
    </button>
  );
}

/**
 * `datetime-local` uchun mahalliy vaqtdagi qiymat: `YYYY-MM-DDTHH:mm`.
 *
 * `toISOString()` ATAYLAB ishlatilmagan — u UTC ga o'tkazadi va
 * O'zbekistonda (UTC+5) kechqurun 19:00 dan keyin ertangi sanani berardi,
 * ya'ni `min` chegarasi noto'g'ri kunga tushib qolardi.
 */
function localISO(dayOffset: number, time = "00:00"): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}T${time}`;
}
