"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  User as UserIcon, Settings as SettingsIcon, History as HistoryIcon, Briefcase,
  FileText, LifeBuoy, ShieldCheck, Check, Moon, Sun,
} from "lucide-react";
import { api, APIError, Category, User } from "@/lib/api";
import { Shell } from "@/components/Shell";
import { ModerationModal, isModerationError } from "@/components/ModerationModal";
import { AvatarUploader } from "@/components/ui/ImageUpload";
import { useScript } from "@/lib/i18n";
import { T, useT } from "@/components/T";
import { DeleteAccountCard } from "@/components/DeleteAccountCard";
import { PROFILE_REGIONS, districtsOf, optionsWithCurrent } from "@/lib/regions";

/** Figma "14 · Sozlamalar": yon menyu + bo'limlarga ajratilgan kartalar. */
export default function Settings() {
  const t = useT();
  const qc = useQueryClient();
  const script = useScript((s) => s.script);
  const setScript = useScript((s) => s.setScript);
  const { theme, setTheme } = useTheme();

  const [me, setMe] = useState<User | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [bio, setBio] = useState("");
  const [region, setRegion] = useState("");
  const [district, setDistrict] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const regionOptions = optionsWithCurrent(PROFILE_REGIONS, region);
  const districtOptions = optionsWithCurrent(districtsOf(region), district);

  const { data: cats } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/categories"),
  });

  useEffect(() => {
    api.get<User>("/api/me").then((u) => {
      setMe(u);
      setFirst(u.firstName);
      setLast(u.lastName);
      setBio(u.bio || "");
      setRegion(u.region || "");
      setDistrict(u.district || "");
      setSkills(u.skills || []);
      setAvatarUrl(u.avatarUrl || undefined);
    });
  }, []);

  // Moderatsiya rad etgan profil — modal oynada sabab va ogohlantirish bilan.
  const [modErr, setModErr] = useState<APIError | null>(null);

  async function save() {
    setSaving(true);
    setModErr(null);
    try {
      const updated = await api.patch<User>("/api/me", {
        firstName: first, lastName: last, bio, region, district, skills,
        langPref: script, avatarUrl: avatarUrl || "",
      });
      qc.setQueryData(["me"], updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      if (isModerationError(e)) setModErr(e);
      else throw e;
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell wide>
      <div className="py-6 grid lg:grid-cols-[240px_1fr] gap-5 items-start">
        {/* Yon menyu */}
        <nav className="card p-2 hidden lg:flex flex-col gap-0.5 sticky top-[92px]">
          <SideLink href="/profile" icon={<UserIcon size={16} />} label="Profil" />
          <SideLink href="/settings" icon={<SettingsIcon size={16} />} label="Sozlamalar" active />
          <SideLink href="/history" icon={<HistoryIcon size={16} />} label="Bajarilgan ishlar" />
          <SideLink href="/my-elons" icon={<Briefcase size={16} />} label="E'lon qilgan ishlar" />
          <SideLink href="/process" icon={<FileText size={16} />} label="Mening arizalarim" />
          <SideLink href="/yordam" icon={<LifeBuoy size={16} />} label="Yordam markazi" />
          <SideLink href="/maxfiylik-siyosati" icon={<ShieldCheck size={16} />} label="Maxfiylik va shartlar" />
        </nav>

        <div className="flex flex-col gap-5 min-w-0">
          <div>
            <h1 className="text-[26px] font-black heading tracking-[-0.6px] leading-tight"><T>Sozlamalar</T></h1>
            <p className="text-[13.5px] muted mt-1"><T>Hisobingiz, ko'rinish va maxfiylik</T></p>
          </div>

          {/* Shaxsiy ma'lumotlar */}
          <section className="card p-6">
            <h2 className="section-title"><T>Shaxsiy ma'lumotlar</T></h2>

            <div className="mt-4 surface p-4">
              <AvatarUploader value={avatarUrl} name={`${first} ${last}`} onChange={setAvatarUrl} />
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[13px] font-bold heading"><T>Ism</T></span>
                <input className="input mt-1.5" value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-[13px] font-bold heading"><T>Familiya</T></span>
                <input className="input mt-1.5" value={last} onChange={(e) => setLast(e.target.value)} />
              </label>
            </div>

            <label className="block mt-4">
              <span className="text-[13px] font-bold heading"><T>Telefon raqam</T></span>
              <input className="input mt-1.5" value={me?.phone || ""} disabled />
            </label>

            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[13px] font-bold heading"><T>Viloyat</T></span>
                <select className="input mt-1.5" value={region} onChange={(e) => {
                  setRegion(e.target.value);
                  setDistrict("");
                }}>
                  <option value="">{t("Tanlang")}</option>
                  {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[13px] font-bold heading"><T>Tuman</T></span>
                <select className="input mt-1.5" value={district}
                        onChange={(e) => setDistrict(e.target.value)} disabled={!region}>
                  <option value="">{t("Tanlang")}</option>
                  {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
            </div>

            <label className="block mt-4">
              <span className="text-[13px] font-bold heading"><T>Men haqimda</T></span>
              <textarea className="input mt-1.5 min-h-[90px]" value={bio} onChange={(e) => setBio(e.target.value)}
                        placeholder={t("Tajribangiz va qanday ishlarni bajarishingiz haqida qisqacha yozing.")} />
            </label>

            {(cats || []).length > 0 && (
              <div className="mt-4">
                <span className="text-[13px] font-bold heading"><T>Mutaxassisliklar</T></span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(cats || []).map((c) => {
                    const on = skills.includes(c.name);
                    return (
                      <button key={c.id} type="button"
                        onClick={() => setSkills((s) => (on ? s.filter((x) => x !== c.name) : [...s, c.name]))}
                        className={`chip ${on ? "chip-active" : ""}`}>
                        {on && <Check size={13} />}<T>{c.name}</T>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-50">
                {saving ? <T>Saqlanmoqda…</T> : <T>Saqlash</T>}
              </button>
              {saved && <span className="badge-success"><Check size={12} /><T>Saqlandi</T></span>}
            </div>
          </section>

          {/* Til va ko'rinish */}
          <section className="card p-6">
            <h2 className="section-title"><T>Til va ko'rinish</T></h2>

            {/* Figma "14 · Sozlamalar → Ilova tili" */}
            <SettingRow title="Ilova tili" desc="Interfeys va bildirishnomalar tili">
              <div className="flex items-center gap-1.5">
                <Seg active={script === "latin"} onClick={() => setScript("latin")}>O'zbek</Seg>
                <Seg active={script === "cyrillic"} onClick={() => setScript("cyrillic")}>Ўзбекча</Seg>
              </div>
            </SettingRow>

            <SettingRow title="Mavzu" desc="Yorug' yoki tungi ko'rinish">
              <div className="flex items-center gap-1.5">
                <Seg active={theme !== "dark"} onClick={() => setTheme("light")}><Sun size={14} /></Seg>
                <Seg active={theme === "dark"} onClick={() => setTheme("dark")}><Moon size={14} /></Seg>
              </div>
            </SettingRow>
          </section>

          {/* Bildirishnomalar */}
          <section className="card p-6">
            <h2 className="section-title"><T>Bildirishnomalar</T></h2>
            <p className="mt-2 text-[13px] muted leading-relaxed">
              <T>Ariza holati o'zgarganda, e'loningizga yangi ariza kelganda va ish yakunlanganda sizga bildirishnoma yuboriladi. Ularni Telegram orqali ham olishingiz mumkin.</T>
            </p>
            <Link href="/notifications" className="btn btn-soft mt-4 btn-sm"><T>Bildirishnomalarni ko'rish</T></Link>
          </section>

          {/* Maxfiylik va xavfsizlik */}
          <section className="card p-6">
            <h2 className="section-title"><T>Maxfiylik va xavfsizlik</T></h2>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Link href="/maxfiylik-siyosati" className="btn btn-outline btn-sm"><T>Maxfiylik siyosati</T></Link>
              <Link href="/foydalanish-shartlari" className="btn btn-outline btn-sm"><T>Foydalanish shartlari</T></Link>
              <Link href="/feedback" className="btn btn-outline btn-sm"><T>Taklif va shikoyat</T></Link>
            </div>
          </section>

          <DeleteAccountCard />
        </div>
      </div>
          <ModerationModal error={modErr} onClose={() => setModErr(null)} />
    </Shell>
  );
}

/* ── helpers ─────────────────────────────────────────── */

function SideLink({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <Link href={href} className={`sidenav-item ${active ? "sidenav-item-active" : ""}`}>
      {icon}<T>{label}</T>
    </Link>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div className="min-w-0">
        <div className="text-[14px] font-bold heading"><T>{title}</T></div>
        <div className="text-[12.5px] subtle mt-0.5"><T>{desc}</T></div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Seg({
  active, onClick, children, disabled, title,
}: {
  active: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-bold transition inline-flex items-center gap-1.5 ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
      style={active
        ? { background: "var(--brand)", color: "#fff" }
        : { background: "var(--bg-subtle)", color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}
