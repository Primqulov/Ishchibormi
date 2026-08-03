/**
 * Bosh sahifa — Figma maketidagi "Bosh sahifa".
 *
 * Tartibi maketdan: salomlashuv → qidiruv → promo banner → turkumlar →
 * "Yangi e'lonlar" ro'yxati. Ishchi ilovani ochganda birinchi ko'radigan
 * narsa o'z ismi va qidiruv bo'ladi, e'lonlar esa darhol pastda.
 *
 * Mobil uchun muhim tafsilotlar (maketda ko'rinmaydi, lekin kerak):
 *  - qidiruv 300 ms debounce bilan — har harfda so'rov yubormaslik uchun;
 *  - cheksiz scroll IntersectionObserver orqali ("Yana" tugmasidan tabiiyroq);
 *  - birinchi yuklashda skeletonlar, keyingi sahifalarda pastda spinner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { JobCard } from "@/components/JobCard";
import {
  BriefcaseIcon,
  BroomIcon,
  PackageIcon,
  SearchIcon,
  SlidersIcon,
  ToolsIcon,
  TruckIcon,
  WrenchIcon,
} from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, Spinner } from "@/components/ui";
import { catTone } from "@/lib/cat-color";
import {
  fetchCategories,
  fetchFeed,
  FEED_PAGE_SIZE,
  type APIError,
  type Category,
  type Elon,
  type User,
} from "@/lib/api";
import { haptic } from "@/lib/telegram";

/**
 * Turkum → glif. Nomi ro'yxatda bo'lmasa portfel ishlatiladi — yangi turkum
 * qo'shilganda ilova buzilmaydi, shunchaki umumiy ikonka bilan chiqadi.
 */
const CAT_ICON: Record<string, (p: { size?: number }) => JSX.Element> = {
  tozalash: BroomIcon,
  "yuk tashish": TruckIcon,
  qurilish: ToolsIcon,
  yetkazish: PackageIcon,
  santexnika: WrenchIcon,
};

function catIcon(name: string) {
  return CAT_ICON[name.trim().toLowerCase()] || BriefcaseIcon;
}

export function Feed({
  me,
  onOpenJob,
  onPost,
  onShowAll,
}: {
  me: User;
  onOpenJob: (id: string) => void;
  onPost: () => void;
  /** "Barchasi" / "Barcha e'lonlarni ko'rish" — filtrsiz to'liq ro'yxatga. */
  onShowAll: () => void;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<Category[]>([]);

  const [items, setItems] = useState<Elon[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<APIError | null>(null);
  // "Qayta urinish" uchun: qidiruv matni o'zgarmaganda ham birinchi sahifani
  // qaytadan so'rashga majburlaydi.
  const [reload, setReload] = useState(0);

  // Qidiruv debounce.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    // Turkumlar bir marta yuklanadi; xatosi feed'ni buzmasligi kerak —
    // filtrsiz ham ro'yxat to'liq ishlaydi.
    fetchCategories()
      .then((cs) => setCategories(cs.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

  // Birinchi sahifa: qidiruv yoki turkum o'zgarganda qaytadan yuklanadi.
  //
  // `ignore` bayrog'i poyga holatiga qarshi: foydalanuvchi tez yozganda eski
  // so'rovning javobi yangisidan keyin kelib, ro'yxatni noto'g'ri natijaga
  // almashtirib yuborishi mumkin.
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError(null);

    fetchFeed({ q: debouncedQ, categoryId, page: 1 })
      .then((res) => {
        if (ignore) return;
        setItems(res.items || []);
        setTotal(res.total || 0);
        setPage(1);
      })
      .catch((e: APIError) => {
        if (!ignore) setError(e);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [debouncedQ, categoryId, reload]);

  const hasMore = items.length < total;

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    setLoadingMore(true);
    const next = page + 1;
    fetchFeed({ q: debouncedQ, categoryId, page: next })
      .then((res) => {
        setItems((prev) => {
          // Bir e'lon ikki marta tushmasin: yangi e'lon qo'shilsa sahifalar
          // suriladi va chegaradagi yozuv takrorlanishi mumkin.
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...(res.items || []).filter((x) => !seen.has(x.id))];
        });
        setTotal(res.total || 0);
        setPage(next);
      })
      .catch(() => {
        // Keyingi sahifa kelmasa jimgina to'xtaymiz — allaqachon ko'rinib
        // turgan ro'yxatni xato ekrani bilan almashtirish yaxshi emas.
      })
      .finally(() => setLoadingMore(false));
  }, [categoryId, debouncedQ, hasMore, loading, loadingMore, page]);

  // Ro'yxat oxiriga yaqinlashganda keyingi sahifa.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      // 400px oldindan boshlaymiz, shunda foydalanuvchi pastga yetganda
      // ma'lumot allaqachon joyida bo'ladi.
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const filtering = Boolean(debouncedQ || categoryId);

  return (
    <div className="flex flex-col gap-6 px-4 pb-4 pt-4">
      {/* ── Salomlashuv ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <h2 className="text-[24px] font-bold leading-8 tracking-[-0.24px] heading">
          Assalomu alaykum, {me.firstName || "do'stim"}!
        </h2>
        <p className="text-[16px] leading-6 muted">Bugun qanday ishlar bor?</p>
      </div>

      {/* ── Qidiruv ─────────────────────────────────────────────── */}
      <div className="search-pill">
        <SearchIcon size={18} className="shrink-0 subtle" />
        <input
          placeholder="Ish qidirish..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Ish qidirish"
        />
        <button
          type="button"
          onClick={() => {
            haptic.select();
            onShowAll();
          }}
          aria-label="Filtrlar"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-90"
          style={{ background: "var(--brand-100)", color: "var(--brand)" }}
        >
          <SlidersIcon size={14} />
        </button>
      </div>

      {/* ── Promo banner ────────────────────────────────────────── */}
      <section className="promo">
        {/* Burchakdagi bezak doira (maketda 128px, 20% shaffof). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-4 -right-4 h-32 w-32 rounded-full"
          style={{ background: "rgba(255,255,255,.2)" }}
        />
        <div className="relative flex max-w-[210px] flex-col gap-3">
          <h3 className="text-[20px] font-semibold leading-[25px] text-white">
            Yangi vazifangiz bormi?
          </h3>
          <p className="text-[14px] leading-5" style={{ color: "#EAF1FF" }}>
            Tez va oson ishchi toping.
          </p>
          <button
            type="button"
            onClick={() => {
              haptic.tap();
              onPost();
            }}
            className="self-start rounded-lg bg-white px-4 py-2 text-[16px] font-semibold leading-5 transition active:scale-95"
            style={{ color: "var(--brand)", boxShadow: "0 1px 1px rgba(0,0,0,.05)" }}
          >
            E'lon berish
          </button>
        </div>
      </section>

      {/* ── Turkumlar ───────────────────────────────────────────── */}
      {categories.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[20px] font-semibold leading-7 heading">Kategoriyalar</h3>
            <button
              type="button"
              onClick={() => {
                haptic.select();
                setCategoryId("");
                onShowAll();
              }}
              className="text-[16px] font-semibold leading-5"
              style={{ color: "var(--brand)" }}
            >
              Barchasi
            </button>
          </div>

          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {categories.map((c) => {
              const Icon = catIcon(c.name);
              const tone = catTone(c.name);
              const on = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    haptic.select();
                    setCategoryId((prev) => (prev === c.id ? "" : c.id));
                  }}
                  className="flex w-[72px] shrink-0 flex-col items-center gap-2"
                  aria-pressed={on}
                >
                  <span
                    className="cat-tile"
                    style={
                      on
                        ? { background: "var(--brand)", color: "#fff" }
                        : { background: tone.bg, color: tone.fg }
                    }
                  >
                    <Icon size={26} />
                  </span>
                  <span className="text-center text-[12px] font-semibold leading-[15px] tracking-[0.6px] heading">
                    {c.name}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ── E'lonlar ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4">
        <h3 className="px-1 text-[20px] font-semibold leading-7 heading">
          {filtering ? "Topilgan e'lonlar" : "Yangi e'lonlar"}
        </h3>

        {loading ? (
          <ListSkeleton count={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => setReload((n) => n + 1)} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BriefcaseIcon size={26} />}
            title="E'lon topilmadi"
            hint={
              filtering
                ? "Qidiruv shartlarini o'zgartirib ko'ring."
                : "Hozircha faol e'lonlar yo'q. Birozdan keyin qayta kiring."
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((e) => (
              <JobCard key={e.id} e={e} onOpen={onOpenJob} />
            ))}

            <div ref={sentinel} aria-hidden="true" />
            {loadingMore && <Spinner />}

            {!hasMore && items.length > FEED_PAGE_SIZE && (
              <p className="py-2 text-center text-[12.5px] subtle">
                Barcha e'lonlar ko'rsatildi
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
