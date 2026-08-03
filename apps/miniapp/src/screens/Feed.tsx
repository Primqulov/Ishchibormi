/**
 * Ishlar ro'yxati — ilovaning bosh ekrani.
 *
 * Mobil uchun muhim tafsilotlar:
 *  - qidiruv 300 ms debounce bilan (har harfda so'rov yubormaslik uchun —
 *    sekin tarmoqda bu sezilarli farq);
 *  - cheksiz scroll IntersectionObserver orqali ("Yana" tugmasini bosishdan
 *    ko'ra tabiiyroq va bir qo'lda qulay);
 *  - birinchi yuklashda skeletonlar, keyingi sahifalarda pastda spinner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { JobCard } from "@/components/JobCard";
import { SearchIcon, BriefcaseIcon } from "@/components/icons";
import { EmptyState, ErrorState, ListSkeleton, Spinner } from "@/components/ui";
import {
  fetchCategories,
  fetchFeed,
  FEED_PAGE_SIZE,
  type APIError,
  type Category,
  type Elon,
} from "@/lib/api";
import { haptic } from "@/lib/telegram";

export function Feed({ onOpenJob }: { onOpenJob: (id: string) => void }) {
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

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* Qidiruv */}
      <div className="relative">
        <SearchIcon
          size={17}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 subtle"
        />
        <input
          className="input !pl-11"
          placeholder="Ish qidirish..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>

      {/* Turkumlar — gorizontal surilib ketadigan qator */}
      {categories.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <button
            type="button"
            onClick={() => {
              haptic.select();
              setCategoryId("");
            }}
            className={`chip ${categoryId === "" ? "chip-active" : ""}`}
          >
            Hammasi
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                haptic.select();
                setCategoryId((prev) => (prev === c.id ? "" : c.id));
              }}
              className={`chip ${categoryId === c.id ? "chip-active" : ""}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Ro'yxat */}
      {loading ? (
        <ListSkeleton count={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => setReload((n) => n + 1)} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BriefcaseIcon size={26} />}
          title="E'lon topilmadi"
          hint={
            debouncedQ || categoryId
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
            <p className="py-4 text-center text-[12.5px] subtle">Barcha e'lonlar ko'rsatildi</p>
          )}
        </div>
      )}
    </div>
  );
}
