/**
 * "Ishlar" — barcha e'lonlar (Figma maketidagi "Barcha ishlar").
 *
 * Bosh sahifadan farqi: bu yerda salomlashuv, promo va turkum plitkalari
 * yo'q — faqat qidirish va filtrlash. Maketda ham shunday: bosh sahifa
 * tanishtiradi, bu ekran esa ish qidiradi.
 *
 * Qo'shimcha: xarita ko'rinishiga almashtirgich. Maketda alohida xarita
 * ekrani yo'q, lekin ishchi uchun "qayerda?" savoli ko'pincha "qanday ish?"
 * dan muhimroq — shuning uchun ro'yxat/xarita almashtirgichi shu yerda.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { JobCard } from "@/components/JobCard";
import { MapView } from "./MapView";
import { BriefcaseIcon, ListIcon, MapIcon, SearchIcon, SlidersIcon } from "@/components/icons";
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

export function Jobs({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const [mode, setMode] = useState<"list" | "map">("list");

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [showFilters, setShowFilters] = useState(true);

  const [items, setItems] = useState<Elon[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<APIError | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    fetchCategories()
      .then((cs) => setCategories(cs.filter((c) => c.isActive)))
      .catch(() => setCategories([]));
  }, []);

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
      .catch((e: APIError) => !ignore && setError(e))
      .finally(() => !ignore && setLoading(false));
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
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...(res.items || []).filter((x) => !seen.has(x.id))];
        });
        setTotal(res.total || 0);
        setPage(next);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [categoryId, debouncedQ, hasMore, loading, loadingMore, page]);

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || mode !== "list") return;
    const io = new IntersectionObserver((es) => es[0]?.isIntersecting && loadMore(), {
      rootMargin: "400px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, mode]);

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-4">
      {/* Sarlavha + ro'yxat/xarita almashtirgichi */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[24px] font-bold leading-8 tracking-[-0.24px] heading">
          Barcha ishlar
        </h2>
        <div className="surface flex shrink-0 items-center gap-0.5 p-1">
          {(["list", "map"] as const).map((m) => {
            const on = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  if (!on) haptic.select();
                  setMode(m);
                }}
                aria-label={m === "list" ? "Ro'yxat" : "Xarita"}
                aria-pressed={on}
                className="grid h-8 w-9 place-items-center rounded-md transition"
                style={on ? { background: "var(--brand)", color: "#fff" } : { color: "var(--text-subtle)" }}
              >
                {m === "list" ? <ListIcon size={16} /> : <MapIcon size={16} />}
              </button>
            );
          })}
        </div>
      </div>

      {mode === "map" ? (
        <div className="-mx-4">
          <MapView onOpenJob={onOpenJob} />
        </div>
      ) : (
        <>
          {/* Qidiruv qatori — maketda input yonida ko'k "Qidirish" tugmasi. */}
          <div className="flex items-center gap-2">
            <div className="search-pill flex-1">
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
            </div>
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                setDebouncedQ(q.trim());
              }}
              className="shrink-0 rounded-lg px-5 py-3 text-[16px] font-semibold leading-5 text-white transition active:scale-[0.97]"
              style={{ background: "var(--brand)" }}
            >
              Qidirish
            </button>
          </div>

          {/* Filtrlar va turkum chiplari */}
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            <button
              type="button"
              onClick={() => {
                haptic.select();
                setShowFilters((v) => !v);
              }}
              className={`chip shrink-0 ${showFilters ? "" : "chip-active"}`}
              aria-pressed={!showFilters}
            >
              <SlidersIcon size={14} />
              Filtrlar
            </button>

            {showFilters &&
              categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    haptic.select();
                    setCategoryId((prev) => (prev === c.id ? "" : c.id));
                  }}
                  className={`chip shrink-0 ${categoryId === c.id ? "chip-active" : ""}`}
                >
                  {c.name}
                </button>
              ))}
          </div>

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
                  : "Hozircha faol e'lonlar yo'q."
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
        </>
      )}
    </div>
  );
}
