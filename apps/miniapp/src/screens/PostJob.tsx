/**
 * E'lon berish.
 *
 * Ish beruvchi uchun eng uzun forma, shuning uchun mobil qulayligiga alohida
 * e'tibor:
 *  - sana kalendar emas, uchta tugma. Backend ish sanasini eng ko'pi 3 kun
 *    oldinga qo'yishga ruxsat beradi (MAX_SCHEDULE_DAYS) — kalendar
 *    ochilganda foydalanuvchi taqiqlangan kunni tanlab, keyin xato olardi.
 *    Uchta tugma cheklovni xatoga aylantirmasdan ko'rsatadi;
 *  - raqamli maydonlarda `inputMode` — telefon darhol raqam klaviaturasini
 *    ochadi;
 *  - rasm tanlangan zahoti yuklanadi, yuborishda emas: sekin tarmoqda
 *    "Yuborish" bosgandan keyin uzoq kutish yomon taassurot qoldiradi;
 *  - yuborish tugmasi Telegram'ning MainButton'ida — u klaviatura ustida
 *    turadi, ya'ni forma to'ldirilayotganda ham ko'rinib turadi.
 */

import { useEffect, useRef, useState } from "react";
import { LocationPicker } from "@/components/LocationPicker";
import { ImageIcon, TrashIcon, PlusIcon, XIcon } from "@/components/icons";
import { Spinner } from "@/components/ui";
import { fmtSum, fmtPhone, onlyDigits } from "@/lib/format";
import { alertUser, haptic, showMainButton } from "@/lib/telegram";
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

type Pricing = "per_worker" | "total" | "negotiable";

const PRICING_LABEL: Record<Pricing, string> = {
  per_worker: "Bir ishchiga",
  total: "Umumiy summa",
  negotiable: "Kelishiladi",
};

export function PostJob({
  myPhone,
  onCreated,
  onClose,
}: {
  /** Aloqa raqami sifatida oldindan to'ldiriladi. */
  myPhone?: string;
  onCreated: (e: Elon) => void;
  onClose: () => void;
}) {
  const [categories, setCategories] = useState<Category[] | null>(null);

  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [workers, setWorkers] = useState(1);
  const [pricing, setPricing] = useState<Pricing>("per_worker");
  const [price, setPrice] = useState("");
  const [dayOffset, setDayOffset] = useState(0);
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [gender, setGender] = useState<Gender>("mixed");
  const [phone, setPhone] = useState(myPhone ? fmtPhone(myPhone) : "");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationText, setLocationText] = useState("");

  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchCategories()
      .then((cs) => setCategories(cs.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  const priceNum = Number(onlyDigits(price) || 0);

  // fmtPhone bo'sh matnga ham "+998" qaytaradi (prefiks har doim ko'rinib
  // tursin degani). Ya'ni "maydon bo'shmi" degan tekshiruv yaramaydi —
  // aks holda serverga contactPhone="+998" ketardi. Shuning uchun kodsiz
  // raqamlar sanaladi: 9 ta bo'lsagina to'liq raqam deb hisoblanadi.
  const phoneDigits = onlyDigits(phone).replace(/^998/, "");
  const phoneReady = phoneDigits.length === 9;

  const valid =
    title.trim().length >= 3 &&
    Boolean(categoryId) &&
    description.trim().length >= 5 &&
    workers >= 1 &&
    (pricing === "negotiable" || priceNum > 0);

  // Yuborish — Telegram'ning pastdagi tugmasida.
  useEffect(() => {
    return showMainButton(
      saving ? "Yuborilmoqda..." : "E'lonni joylash",
      () => void submit(),
      { disabled: !valid || saving || uploading > 0, loading: saving },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, saving, uploading, title, categoryId, description, workers, pricing, price, dayOffset, timeFrom, timeTo, gender, phone, images, coords, locationText]);

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const created = await createElon({
        title: title.trim(),
        categoryId,
        description: description.trim(),
        workersNeeded: workers,
        pricingType: pricing,
        priceAmount: pricing === "negotiable" ? 0 : priceNum,
        startDate: dateFromOffset(dayOffset),
        workTimeFrom: timeFrom || undefined,
        workTimeTo: timeTo || undefined,
        contactPhone: phoneReady ? `+998${phoneDigits}` : undefined,
        gender,
        images,
        lat: coords?.lat,
        lng: coords?.lng,
        locationText: locationText.trim() || undefined,
      });
      haptic.success();
      onCreated(created);
    } catch (e) {
      haptic.error();
      // Backend xabari aniq bo'ladi ("start date can be at most 3 days ahead",
      // "category not found", ...) — uni o'zgartirmaymiz.
      alertUser((e as APIError).message || "E'lon joylanmadi. Qayta urinib ko'ring.");
    } finally {
      setSaving(false);
    }
  }

  async function pickImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_IMAGES - images.length;
    const chosen = Array.from(files).slice(0, room);
    if (chosen.length === 0) {
      alertUser(`Eng ko'pi ${MAX_IMAGES} ta rasm qo'shish mumkin.`);
      return;
    }

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
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-black leading-tight tracking-[-0.4px] heading">
            Yangi e'lon
          </h1>
          <p className="mt-0.5 text-[12.5px] subtle">
            Ish {MAX_SCHEDULE_DAYS} kun ichida boshlanishi kerak
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onClose();
          }}
          aria-label="Yopish"
          className="btn-ghost !min-h-[36px] shrink-0 !px-2"
        >
          <XIcon size={20} />
        </button>
      </div>

      {/* ── Rasmlar ─────────────────────────────────────────────── */}
      <Field label="Rasmlar" hint={`ixtiyoriy, ${MAX_IMAGES} tagacha`}>
        <div className="flex flex-wrap gap-2">
          {images.map((src, i) => (
            <div
              key={src}
              className="relative overflow-hidden rounded-xl"
              style={{ width: 84, height: 84, border: "1px solid var(--border)" }}
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
              style={{ width: 84, height: 84, background: "var(--bg-subtle)" }}
            >
              <Spinner />
            </div>
          )}

          {images.length + uploading < MAX_IMAGES && (
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                fileInput.current?.click();
              }}
              className="grid place-items-center rounded-xl transition active:scale-95"
              style={{
                width: 84,
                height: 84,
                background: "var(--bg-subtle)",
                border: "1.5px dashed var(--border-strong)",
                color: "var(--text-subtle)",
              }}
            >
              <ImageIcon size={22} />
            </button>
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
      </Field>

      {/* ── Asosiy ──────────────────────────────────────────────── */}
      <Field label="Ish nomi">
        <input
          className="input"
          placeholder="Masalan: Yuk tushirishga 3 ishchi"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          enterKeyHint="next"
        />
      </Field>

      <Field label="Turkum">
        {categories === null ? (
          <div className="skeleton h-9 w-full" />
        ) : categories.length === 0 ? (
          <p className="text-[13px] subtle">Turkumlar yuklanmadi.</p>
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
                className={`chip ${categoryId === c.id ? "chip-active" : ""}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="Tavsif">
        <textarea
          className="input min-h-[110px] resize-none"
          placeholder="Qanday ish, nima qilinadi, nima olib kelish kerak..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </Field>

      {/* ── Ishchilar soni ──────────────────────────────────────── */}
      <Field label="Nechta ishchi kerak">
        <div className="flex items-center gap-3">
          <Stepper value={workers} onChange={setWorkers} min={1} max={50} />
          <span className="text-[13px] muted">ishchi</span>
        </div>
      </Field>

      {/* ── To'lov ──────────────────────────────────────────────── */}
      <Field label="To'lov">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(PRICING_LABEL) as Pricing[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                haptic.select();
                setPricing(p);
              }}
              className={`chip ${pricing === p ? "chip-active" : ""}`}
            >
              {PRICING_LABEL[p]}
            </button>
          ))}
        </div>

        {pricing !== "negotiable" && (
          <div className="mt-2.5">
            <input
              className="input"
              placeholder="Summa, so'm"
              value={price}
              onChange={(e) => setPrice(onlyDigits(e.target.value).slice(0, 9))}
              inputMode="numeric"
              enterKeyHint="done"
            />
            {priceNum > 0 && (
              <p className="mt-1.5 text-[12.5px] subtle">
                {fmtSum(priceNum)} so'm
                {pricing === "per_worker" && workers > 1 && (
                  <> · jami {fmtSum(priceNum * workers)} so'm</>
                )}
                {pricing === "total" && workers > 1 && (
                  <> · bir ishchiga {fmtSum(Math.floor(priceNum / workers))} so'm</>
                )}
              </p>
            )}
          </div>
        )}
      </Field>

      {/* ── Qachon ──────────────────────────────────────────────── */}
      <Field label="Qachon" hint="eng ko'pi 3 kun ichida">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: MAX_SCHEDULE_DAYS }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                haptic.select();
                setDayOffset(i);
              }}
              className={`chip ${dayOffset === i ? "chip-active" : ""}`}
            >
              {dayLabel(i)}
            </button>
          ))}
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <input
            type="time"
            className="input flex-1"
            value={timeFrom}
            onChange={(e) => setTimeFrom(e.target.value)}
            aria-label="Boshlanish vaqti"
          />
          <span className="subtle">—</span>
          <input
            type="time"
            className="input flex-1"
            value={timeTo}
            onChange={(e) => setTimeTo(e.target.value)}
            aria-label="Tugash vaqti"
          />
        </div>
      </Field>

      {/* ── Joylashuv ───────────────────────────────────────────── */}
      <Field label="Ish joyi" hint="ixtiyoriy, lekin tavsiya etiladi">
        <LocationPicker value={coords} onChange={setCoords} />
        <input
          className="input mt-2"
          placeholder="Mo'ljal: ko'k darvoza, 3-uy..."
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          maxLength={200}
        />
      </Field>

      {/* ── Kimlar uchun ────────────────────────────────────────── */}
      <Field label="Kimlar uchun">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => {
                haptic.select();
                setGender(g);
              }}
              className={`chip ${gender === g ? "chip-active" : ""}`}
            >
              {GENDER_LABEL[g]}
            </button>
          ))}
        </div>
      </Field>

      {/* ── Aloqa ───────────────────────────────────────────────── */}
      <Field label="Aloqa raqami" hint="ixtiyoriy">
        <input
          className="input"
          value={phone}
          onChange={(e) => setPhone(fmtPhone(e.target.value))}
          inputMode="tel"
          placeholder="+998 90 123 45 67"
        />
        {phone.length > 4 && !phoneReady && (
          <p className="text-[12px]" style={{ color: "#B42318" }}>
            Raqam to'liq emas — bo'sh qoldirsangiz profildagi raqam ishlatiladi.
          </p>
        )}
      </Field>

      {!valid && (
        <p className="text-center text-[12.5px] subtle">
          Nomi, turkumi, tavsifi va to'lovi to'ldirilgach e'lonni joylashingiz mumkin.
        </p>
      )}

      {/* Brauzerda (Telegram'siz) MainButton yo'q — zaxira tugma. */}
      {!window.Telegram?.WebApp && (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || saving || uploading > 0}
          className="btn-primary w-full"
        >
          <PlusIcon size={16} />
          {saving ? "Yuborilmoqda..." : "E'lonni joylash"}
        </button>
      )}
    </div>
  );
}

// ── Kichik bo'laklar ───────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-[0.4px] subtle">{label}</h2>
        {hint && <span className="text-[11.5px] subtle">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  const step = (d: number) => {
    const next = Math.min(max, Math.max(min, value + d));
    if (next !== value) {
      haptic.select();
      onChange(next);
    }
  };
  return (
    <div className="surface inline-flex items-center gap-1 p-1">
      <StepBtn label="−" onClick={() => step(-1)} disabled={value <= min} />
      <span className="min-w-[42px] text-center text-[17px] font-black tabular-nums heading">
        {value}
      </span>
      <StepBtn label="+" onClick={() => step(1)} disabled={value >= max} />
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
      onClick={onClick}
      disabled={disabled}
      className="grid h-10 w-10 place-items-center rounded-lg text-[19px] font-bold transition active:scale-95 disabled:opacity-40"
      style={{ background: "var(--card)", color: "var(--brand)" }}
    >
      {label}
    </button>
  );
}

// ── Sana ───────────────────────────────────────────────────────────────

/** 0 → "Bugun", 1 → "Ertaga", 2 → "Indinga". */
function dayLabel(offset: number): string {
  if (offset === 0) return "Bugun";
  if (offset === 1) return "Ertaga";
  if (offset === 2) return "Indinga";
  return `+${offset} kun`;
}

/**
 * Bugundan `offset` kun keyingi sana, `YYYY-MM-DD`.
 *
 * Qurilmaning mahalliy vaqti bo'yicha: foydalanuvchi "Bugun" deganda o'z
 * telefonidagi bugunni tushunadi. `toISOString()` ATAYLAB ishlatilmagan —
 * u UTC ga o'tkazadi va O'zbekistonda (UTC+5) kechqurun 19:00 dan keyin
 * ertangi sanani beradi.
 */
function dateFromOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
