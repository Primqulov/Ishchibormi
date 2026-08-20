"use client";
import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Briefcase, LayoutGrid, List, Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import { api, Category, Elon, GENDER_LABEL, GENDER_OPTIONS } from "@/lib/api";
import { Shell, ShellSearch } from "@/components/Shell";
import { JobCard } from "@/components/JobCard";
import { CategoryIcon } from "@/components/CategoryIcon";
import { JobMapExplorer } from "@/components/JobMapExplorer";
import { EmptyState } from "@/components/ui/EmptyState";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { Select, TextInput } from "@/components/ui/Input";
import { T, useT } from "@/components/T";
import { onlyDigits, fmtThousands } from "@/lib/format";
import { REGIONS } from "@/lib/regions";

/**
 * Ish e'lonlari bo'limi — ikki ko'rinish:
 *  · Ro'yxat — Figma "04 · Ish e'lonlari (Filtrlar bilan)": chapda filtr paneli, o'ngda ro'yxat.
 *  · Xarita  — Figma "04b · Ish e'lonlari — Xarita ko'rinishi": chapda ixcham
 *    ro'yxat, o'ngda pinli xarita.
 */
export default function ElonlarPage() {
  return (
    <Suspense fallback={null}>
      <ElonlarClient />
    </Suspense>
  );
}

function ElonlarClient() {
  const t = useT();
  // Bosh sahifadagi qidiruv/kategoriya havolalari shu parametrlar bilan keladi.
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [cat, setCat] = useState(params.get("categoryId") || "");
  const [gender, setGender] = useState("");
  const [sort, setSort] = useState("time");
  const [region, setRegion] = useState(params.get("region") || "");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [mobileFilters, setMobileFilters] = useState(false);
  // Bo'limning ikki ko'rinishi: oddiy ro'yxat va xarita.
  const [mode, setMode] = useState<"list" | "map">("list");

  const activeFilters = [region, minPrice, maxPrice, cat, gender].filter(Boolean).length;

  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });
  // Xarita ko'rinishida bir vaqtning o'zida ko'proq pin ko'rsatiladi.
  const limit = mode === "map" ? 100 : 24;
  const { data, isLoading } = useQuery<{ items: Elon[] }>({
    queryKey: ["feed", q, cat, gender, sort, region, minPrice, maxPrice, limit],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (cat) p.set("categoryId", cat);
      if (gender) p.set("gender", gender);
      if (sort) p.set("sort", sort);
      if (region) p.set("region", region);
      if (minPrice) p.set("minPrice", onlyDigits(minPrice));
      if (maxPrice) p.set("maxPrice", onlyDigits(maxPrice));
      p.set("limit", String(limit));
      return api.get<{ items: Elon[] }>(`/api/elons?${p.toString()}`);
    },
  });

  const items = data?.items || [];

  function resetFilters() {
    setRegion(""); setMinPrice(""); setMaxPrice(""); setCat(""); setGender("");
  }

  const filters = (
    <div className="card p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="section-title"><T>Filtrlar</T></h2>
        {activeFilters > 0 && (
          <button onClick={resetFilters} className="text-[13px] font-semibold subtle hover:text-[color:var(--brand)] transition">
            <T>Tozalash</T>
          </button>
        )}
      </div>

      <div>
        <div className="text-sm font-bold heading mb-2.5"><T>Kategoriya</T></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCat("")} className={`chip ${cat === "" ? "chip-active" : ""}`}><T>Barchasi</T></button>
          {(cats || []).map((c) => (
            <button key={c.id} onClick={() => setCat(c.id)} className={`chip ${cat === c.id ? "chip-active" : ""}`}>
              <CategoryIcon icon={c.icon} name={c.name} className="h-4 w-4" />
              <T>{c.name}</T>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-sm font-bold heading mb-2.5"><T>Ish haqi (kunlik)</T></div>
        <div className="grid grid-cols-2 gap-2.5">
          <TextInput
            inputMode="numeric" placeholder={t("50 000")}
            value={minPrice}
            onChange={(e) => setMinPrice(fmtThousands(onlyDigits(e.target.value)))}
          />
          <TextInput
            inputMode="numeric" placeholder={t("Cheklovsiz")}
            value={maxPrice}
            onChange={(e) => setMaxPrice(fmtThousands(onlyDigits(e.target.value)))}
          />
        </div>
      </div>

      <div>
        <div className="text-sm font-bold heading mb-2.5"><T>Joylashuv</T></div>
        <Select value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">{t("Barcha viloyatlar")}</option>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </div>

      <div>
        <div className="text-sm font-bold heading mb-2.5"><T>Kim uchun</T></div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setGender("")} className={`chip ${gender === "" ? "chip-active" : ""}`}><T>Hammasi</T></button>
          {GENDER_OPTIONS.map((g) => (
            <button key={g} onClick={() => setGender(g)} className={`chip ${gender === g ? "chip-active" : ""}`}>
              <T>{GENDER_LABEL[g]}</T>
            </button>
          ))}
        </div>
      </div>

      {activeFilters > 0 && (
        <button onClick={resetFilters} className="btn btn-soft w-full gap-1.5">
          <X size={15} /><T>Filtrlarni tozalash</T>
        </button>
      )}
    </div>
  );

  return (
    <Shell wide>
      <div className="py-6 flex flex-col gap-5">
        {/* Sarlavha + ko'rinish almashtirgichi — Figma "View Toggle" */}
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <h1 className="text-[30px] font-black heading tracking-[-0.8px] leading-tight"><T>Barcha ish e'lonlari</T></h1>
            <p className="text-sm muted mt-1">
              {mode === "map" ? <T>Xaritada</T> : null} <b className="heading">{items.length}</b>{" "}
              {mode === "map" ? <T>ta e'lon</T> : <T>ta e'lon topildi</T>}
              {region ? ` · ${region}` : ""}
            </p>
          </div>

          <div
            className="ml-auto flex items-center gap-1.5 p-[5px] rounded-[11px] border shrink-0"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
            role="tablist"
            aria-label={t("Ko'rinish")}
          >
            <button
              role="tab"
              aria-selected={mode === "list"}
              onClick={() => setMode("list")}
              className={`inline-flex items-center gap-2 h-[34px] px-[15px] rounded-lg text-[13.5px] font-semibold transition ${
                mode === "list" ? "text-white" : "muted hover:bg-[color:var(--bg-subtle)]"
              }`}
              style={mode === "list" ? { background: "var(--brand)" } : undefined}
            >
              <List size={15} /><T>Ro'yxat</T>
            </button>
            <button
              role="tab"
              aria-selected={mode === "map"}
              onClick={() => setMode("map")}
              className={`inline-flex items-center gap-2 h-[34px] px-[15px] rounded-lg text-[13.5px] font-semibold transition ${
                mode === "map" ? "text-white" : "muted hover:bg-[color:var(--bg-subtle)]"
              }`}
              style={mode === "map" ? { background: "var(--brand)" } : undefined}
            >
              <MapIcon size={15} /><T>Xarita</T>
            </button>
          </div>
        </div>

        {/* ── Xarita ko'rinishi — Figma 04b ──────────────────────────── */}
        {mode === "map" ? (
          <div className="flex flex-col gap-4">
            {/* Gorizontal filtr paneli */}
            <div className="card p-3.5 flex items-center gap-2.5 flex-wrap">
              <button
                onClick={() => setMobileFilters((s) => !s)}
                className="inline-flex items-center gap-2 h-[34px] px-3.5 rounded-[9px] text-[13.5px] font-semibold transition"
                style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
              >
                <SlidersHorizontal size={14} /><T>Filtrlar</T>
                {activeFilters > 0 && (
                  <span className="grid place-items-center min-w-[19px] h-[15px] px-1.5 rounded-full text-[10.5px] font-bold text-white"
                        style={{ background: "var(--brand)" }}>
                    {activeFilters}
                  </span>
                )}
              </button>
              <button onClick={() => setCat("")} className={`chip ${cat === "" ? "chip-active" : ""}`}><T>Barchasi</T></button>
              {(cats || []).slice(0, 4).map((c) => (
                <button key={c.id} onClick={() => setCat(c.id)} className={`chip ${cat === c.id ? "chip-active" : ""}`}>
                  <T>{c.name}</T>
                </button>
              ))}

              <div className="flex-1 min-w-[200px]">
                <ShellSearch value={q} onChange={setQ} placeholder={t("Ish nomi yoki kalit so'z…")} />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[12.5px] muted"><T>Saralash</T>:</span>
                <button onClick={() => setSort("time")} className={`chip ${sort === "time" ? "chip-active" : ""}`}><T>Eng yangi</T></button>
                <button onClick={() => setSort("price")} className={`chip ${sort === "price" ? "chip-active" : ""}`}><T>Ish haqi</T></button>
              </div>
            </div>
            {mobileFilters && filters}

            <JobMapExplorer items={items} loading={isLoading} />
          </div>
        ) : (
        <>
        {/* Saralash paneli — sahifa bo'ylab uzun; o'rtasida qidiruv, o'ngda ko'rinish */}
        <div className="card p-3.5 flex items-center gap-3 flex-wrap">
          {/* Saralash tugmalari — qidiruv inputi bilan bir xil shakl va balandlik */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[13.5px] muted"><T>Saralash</T>:</span>
            <button
              onClick={() => setSort("time")}
              className={`btn ${sort === "time" ? "btn-primary" : "btn-outline"} !h-[46px]`}
            >
              <T>Eng yangi</T>
            </button>
            <button
              onClick={() => setSort("price")}
              className={`btn ${sort === "price" ? "btn-primary" : "btn-outline"} !h-[46px]`}
            >
              <T>Ish haqi</T>
            </button>
          </div>

          <div className="flex-1 min-w-[200px]">
            <ShellSearch
              value={q}
              onChange={setQ}
              placeholder={t("Ish nomi yoki kalit so'z…")}
              className="!h-[46px]"
            />
          </div>

          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            <span className="text-[13.5px] muted"><T>Ko'rinish</T>:</span>
            <button
              onClick={() => setView("list")}
              className={`grid h-8 w-8 place-items-center rounded-lg transition ${view === "list" ? "text-white" : "muted hover:bg-[color:var(--bg-subtle)]"}`}
              style={view === "list" ? { background: "var(--brand)" } : undefined}
              aria-label={t("Ro'yxat")}
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setView("grid")}
              className={`grid h-8 w-8 place-items-center rounded-lg transition ${view === "grid" ? "text-white" : "muted hover:bg-[color:var(--bg-subtle)]"}`}
              style={view === "grid" ? { background: "var(--brand)" } : undefined}
              aria-label={t("Katak")}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[300px_1fr] gap-5 items-start">
          {/* Filtrlar — desktop */}
          <div className="hidden lg:block sticky top-[92px]">{filters}</div>

          {/* Filtrlar — mobil */}
          <button
            onClick={() => setMobileFilters((s) => !s)}
            className="lg:hidden btn btn-outline w-full gap-2"
          >
            <SlidersHorizontal size={16} /><T>Filtrlar</T>
            {activeFilters > 0 && (
              <span className="grid place-items-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold text-white"
                    style={{ background: "var(--brand)" }}>
                {activeFilters}
              </span>
            )}
          </button>
          {mobileFilters && <div className="lg:hidden">{filters}</div>}

          <div className="flex flex-col gap-4 min-w-0">
            {isLoading ? (
              <div className="flex flex-col gap-4">
                {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Briefcase size={22} />}
                title={t("Hozircha e'lonlar yo'q")}
                body={t("Filtrlarni o'zgartirib qaytadan urinib ko'ring yoki o'zingiz birinchi e'lonni joylashtiring.")}
                action={<Link href="/elon/create" className="btn btn-primary"><T>E'lon yaratish</T></Link>}
              />
            ) : (
              <div className={view === "grid" ? "grid xl:grid-cols-2 gap-4" : "flex flex-col gap-4"}>
                {items.map((e) => <JobCard key={e.id} e={e} compact={view === "grid"} />)}
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>
    </Shell>
  );
}
