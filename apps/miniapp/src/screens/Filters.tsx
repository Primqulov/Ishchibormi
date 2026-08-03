/**
 * Filtrlar — Figma maketidagi "Filtrlar sahifasi".
 *
 * Maydonlar backend qabul qiladigan paramlar bilan aynan bir xil
 * (apps/api → elon.Feed): turkum, jins, narx oralig'i, viloyat, saralash.
 * Ishlamaydigan boshqaruv qo'yilmadi — foydalanuvchi filtr belgilab, natija
 * o'zgarmasa, ilova buzuq deb o'ylaydi.
 *
 * Qo'llash Telegram'ning MainButton'ida: forma uzun va tugma pastda doim
 * ko'rinib turadi.
 */

import { useEffect, useState } from "react";
import { XIcon } from "@/components/icons";
import { haptic, showMainButton } from "@/lib/telegram";
import { onlyDigits, fmtSum } from "@/lib/format";
import {
  EMPTY_FILTERS,
  GENDER_LABEL,
  countFilters,
  fetchCategories,
  type Category,
  type FeedFilters,
  type Gender,
} from "@/lib/api";

/** apps/web/lib/regions.ts dagi ro'yxat bilan bir xil bo'lishi kerak. */
const REGIONS = [
  "Toshkent", "Samarqand", "Buxoro", "Farg'ona", "Namangan", "Andijon",
  "Qashqadaryo", "Surxondaryo", "Xorazm", "Navoiy", "Jizzax", "Sirdaryo",
];

const SORTS: { id: NonNullable<FeedFilters["sort"]>; label: string }[] = [
  { id: "", label: "Standart" },
  { id: "new", label: "Yangilari" },
  { id: "price_desc", label: "Qimmatdan arzonga" },
  { id: "price_asc", label: "Arzondan qimmatga" },
];

export function Filters({
  value,
  onApply,
}: {
  value: FeedFilters;
  onApply: (f: FeedFilters) => void;
}) {
  const [draft, setDraft] = useState<FeedFilters>(value);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetchCategories()
      .then((cs) => setCategories(cs.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  const n = countFilters(draft);

  useEffect(() => {
    return showMainButton(n > 0 ? `Qo'llash (${n})` : "Qo'llash", () => onApply(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, n]);

  const set = <K extends keyof FeedFilters>(k: K, v: FeedFilters[K]) => {
    haptic.select();
    setDraft((d) => ({ ...d, [k]: v }));
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 animate-fade-in">
      {n > 0 && (
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            setDraft(EMPTY_FILTERS);
          }}
          className="btn-ghost self-end !min-h-[34px] !px-0 !text-[13px]"
          style={{ color: "#D92D20" }}
        >
          <XIcon size={14} />
          Filtrlarni tozalash
        </button>
      )}

      <Group label="Turkum">
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => set("categoryId", draft.categoryId === c.id ? "" : c.id)}
              className={`chip ${draft.categoryId === c.id ? "chip-active" : ""}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Kimlar uchun">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => set("gender", draft.gender === g ? "" : g)}
              className={`chip ${draft.gender === g ? "chip-active" : ""}`}
            >
              {GENDER_LABEL[g]}
            </button>
          ))}
        </div>
      </Group>

      <Group
        label="Narx oralig'i"
        hint={
          draft.minPrice || draft.maxPrice
            ? `${fmtSum(draft.minPrice || 0)} — ${draft.maxPrice ? fmtSum(draft.maxPrice) : "∞"} so'm`
            : undefined
        }
      >
        <div className="flex items-center gap-2">
          <input
            className="input flex-1"
            placeholder="Eng kam"
            inputMode="numeric"
            value={draft.minPrice ? String(draft.minPrice) : ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                minPrice: Number(onlyDigits(e.target.value).slice(0, 9)) || undefined,
              }))
            }
          />
          <span className="subtle">—</span>
          <input
            className="input flex-1"
            placeholder="Eng ko'p"
            inputMode="numeric"
            value={draft.maxPrice ? String(draft.maxPrice) : ""}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                maxPrice: Number(onlyDigits(e.target.value).slice(0, 9)) || undefined,
              }))
            }
          />
        </div>
      </Group>

      <Group label="Viloyat">
        <div className="flex flex-wrap gap-2">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => set("region", draft.region === r ? "" : r)}
              className={`chip ${draft.region === r ? "chip-active" : ""}`}
            >
              {r}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Saralash">
        <div className="flex flex-wrap gap-2">
          {SORTS.map((s) => (
            <button
              key={s.id || "default"}
              type="button"
              onClick={() => set("sort", s.id)}
              className={`chip ${(draft.sort || "") === s.id ? "chip-active" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Group>

      {/* Brauzerda (Telegram'siz) MainButton yo'q — zaxira tugma. */}
      {!window.Telegram?.WebApp && (
        <button type="button" onClick={() => onApply(draft)} className="btn-primary w-full">
          Qo'llash
        </button>
      )}
    </div>
  );
}

function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--brand)" }}>
          {label}
        </h2>
        {hint && <span className="text-[11.5px] subtle">{hint}</span>}
      </div>
      {children}
    </section>
  );
}
