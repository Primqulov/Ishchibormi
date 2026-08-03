"use client";
import Link from "next/link";
import {
  ShieldCheck, Sparkles, Target, Eye, Heart, Users, HandHeart,
  CheckCircle2, Briefcase, Star, MapPin, Phone, Send, ArrowRight,
  Mail, Instagram, Youtube, LifeBuoy,
} from "lucide-react";
import { CONTACT, SOCIAL } from "@/lib/contact";
import { LangMenu } from "@/components/LangMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { T } from "@/components/T";
import { getAccess } from "@/lib/api";
import { Logo } from "@/components/Logo";

const HERO_BG =
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1600&q=70";

export default function AboutPage() {
  const ctaHref = getAccess() ? "/dashboard" : "/login";

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top nav ─────────────────────── */}
      <header className="border-b" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
          <Logo />
          <div className="flex items-center gap-3">
            <LangMenu />
            <ThemeToggle />
            <Link href={ctaHref} className="btn-primary"><T>Kirish</T></Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ─────────────────────── */}
        <section className="px-4 pt-4">
          <div className="mx-auto max-w-6xl card overflow-hidden p-0">
            <div
              className="relative px-6 py-16 sm:py-20 text-center text-white"
              style={{
                backgroundImage: `linear-gradient(var(--hero-overlay), var(--hero-overlay)), url(${HERO_BG})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
                <Sparkles size={14} /><T>Biz haqimizda</T>
              </div>
              <h1 className="mx-auto mt-4 max-w-3xl text-2xl sm:text-4xl font-extrabold leading-tight">
                <T>Mehnatga hurmat, ishonchga kafolat</T>
              </h1>
              <p className="mx-auto mt-3 max-w-2xl text-white/85 text-sm sm:text-base">
                <T>Ishchi Bormi — O'zbekistondagi har bir mehnatkash inson uchun ochiq, xavfsiz va shaffof ish topish platformasi.</T>
              </p>
            </div>
          </div>
        </section>

        {/* ── Bizning hikoyamiz ─────────── */}
        <section className="px-4 mt-10">
          <div className="mx-auto max-w-6xl grid md:grid-cols-2 gap-6 items-center">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-accent-amber">
                <T>BIZNING HIKOYAMIZ</T>
              </div>
              <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold heading">
                <T>Bozorlar tepasidan zamonaviy platformaga</T>
              </h2>
              <p className="mt-4 text-sm leading-relaxed muted">
                <T>Yillar davomida O'zbekistondagi ishchilar ertalabdan bozor chetida turib ish kutar edi: ob-havo qiyinchiliklari, vaqt isrofi va eng yomoni — kafolat yo'qligi. Ish beruvchilar esa kerakli mutaxassisni topishda Telegram guruhlari va og'zaki tavsiyalarga tayanardi.</T>
              </p>
              <p className="mt-3 text-sm leading-relaxed muted">
                <T>Ishchi Bormi shu muammoni hal qilish uchun yaratildi. Telefon raqami orqali tasdiqlangan profillar, ochiq baholar, qulay xizmat turlari va to'g'ridan-to'g'ri aloqa — bularning barchasi bir joyda.</T>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Mini label="bajarilgan ishlar" value="1000+" icon={<CheckCircle2 size={18} className="text-success" />} />
              <Mini label="tasdiqlangan ishchilar" value="500+" icon={<ShieldCheck size={18} className="text-tg-blue" />} />
              <Mini label="o'rtacha reyting" value="4.8" icon={<Star size={18} className="text-accent-amber" fill="currentColor" />} />
              <Mini label="xizmat turlari" value="15+" icon={<Briefcase size={18} className="heading" />} />
            </div>
          </div>
        </section>

        {/* ── Mission / Vision / Values ──── */}
        <section className="px-4 mt-12">
          <h2 className="text-center text-xl font-bold heading"><T>Bizning qadriyatlarimiz</T></h2>
          <p className="text-center text-sm muted mt-1"><T>Har bir qarorimizda yo'l ko'rsatuvchi printsiplar</T></p>
          <div className="mx-auto max-w-6xl mt-6 grid md:grid-cols-3 gap-4">
            <ValueCard
              icon={<Target size={22} />}
              title="Bizning maqsadimiz"
              body="O'zbekistondagi har bir mehnatkash insonni xavfsiz, qulay va adolatli mehnat bozori bilan ta'minlash."
            />
            <ValueCard
              icon={<Eye size={22} />}
              title="Bizning ko'zlangan kelajagimiz"
              body="Mintaqadagi eng ishonchli va ommabop ish topish platformasiga aylanib, millionlab odamlarni bog'lash."
            />
            <ValueCard
              icon={<Heart size={22} />}
              title="Bizning qadriyatlarimiz"
              body="Halollik, shaffoflik, mas'uliyat va har bir foydalanuvchi haqida g'amxo'rlik."
            />
          </div>
        </section>

        {/* ── Nega bizni tanlashadi ─────── */}
        <section className="px-4 mt-12">
          <h2 className="text-center text-xl font-bold heading"><T>Nega bizni tanlashadi?</T></h2>
          <div className="mx-auto max-w-6xl mt-6 grid md:grid-cols-2 gap-4">
            <FeatureRow
              icon={<ShieldCheck size={22} className="text-success" />}
              title="Tasdiqlangan profillar"
              body="Har bir foydalanuvchi telefon raqami orqali tekshiriladi. Hech qanday soxta hisob yo'q."
            />
            <FeatureRow
              icon={<Star size={22} className="text-accent-amber" />}
              title="Ochiq reyting tizimi"
              body="Har bir ishdan keyin baho va sharh — ishonchli mutaxassis tanlash uchun asos."
            />
            <FeatureRow
              icon={<HandHeart size={22} className="text-danger" />}
              title="To'g'ridan-to'g'ri aloqa"
              body="Vositachilarsiz — telefon orqali bevosita ishchi yoki ish beruvchi bilan gaplashing."
            />
            <FeatureRow
              icon={<Users size={22} className="text-tg-blue" />}
              title="Ko'p qirrali xizmatlar"
              body="Qurilishdan tozalashgacha, kuryerlikdan bog'dorchilikgacha — 15+ kategoriya."
            />
          </div>
        </section>

        {/* ── Qanday boshlandi ─────────── */}
        <section className="px-4 mt-12">
          <h2 className="text-center text-xl font-bold heading"><T>Qanday boshlandi?</T></h2>
          <div className="mx-auto max-w-3xl mt-6 grid gap-4">
            <Timeline year="2024" title="G'oya" body="Toshkent bozorlarida ishchilar va ish beruvchilarning qiyinchiliklarini kuzatib, muammoga yechim izlay boshladik." />
            <Timeline year="2025" title="Birinchi versiya" body="Telegram bot va veb-platforma birgalikda ishlovchi tizim ishga tushirildi. Birinchi 100 ta foydalanuvchi qo'shildi." />
            <Timeline year="2026" title="O'sish" body="500+ tasdiqlangan ishchi, 1000+ bajarilgan ish va butun mamlakat bo'ylab xizmatlar." />
            <Timeline year="Kelajak" body="Mintaqaviy kengayish, mobil ilovalar va sun'iy intellekt yordamida aniqroq tavsiyalar." />
          </div>
        </section>

        {/* ── Aloqa / CTA ─────────────── */}
        <section className="px-4 mt-12">
          <div className="mx-auto max-w-6xl rounded-2xl bg-brand-navy text-white p-6 sm:p-8 grid md:grid-cols-[1fr_auto] items-center gap-6">
            <div>
              <h3 className="text-lg sm:text-xl font-bold"><T>Bizga qo'shiling</T></h3>
              <p className="mt-1 text-white/80 text-sm">
                <T>Ish topmoqchimisiz yoki ishchi qidiryapsizmi? Bir necha daqiqada tizimga kiring va o'z yo'lingizni boshlang.</T>
              </p>
            </div>
            <Link href={ctaHref} className="btn bg-white text-brand-navy hover:opacity-90 gap-2 py-3 px-5">
              <T>Boshlash</T><ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ─────────────── */}
      <footer className="mt-12 border-t" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="mx-auto max-w-6xl px-4 py-8 grid md:grid-cols-2 gap-6 text-sm">
          <div>
            <div className="font-extrabold heading text-lg">Ishchi Bormi</div>
            <ul className="mt-3 space-y-1.5 muted">
              <li><a href={CONTACT.phoneHref} className="flex items-center gap-2 hover:heading"><Phone size={14} />{CONTACT.phone}</a></li>
              <li><a href={CONTACT.emailHref} className="flex items-center gap-2 hover:heading"><Mail size={14} />{CONTACT.email}</a></li>
              <li><a href={SOCIAL.telegram.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><Send size={14} />Telegram {SOCIAL.telegram.label}</a></li>
              <li><a href={SOCIAL.support.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><LifeBuoy size={14} />Support {SOCIAL.support.label}</a></li>
              <li><a href={SOCIAL.instagram.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><Instagram size={14} />Instagram {SOCIAL.instagram.label}</a></li>
              <li><a href={SOCIAL.youtube.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:heading"><Youtube size={14} />YouTube {SOCIAL.youtube.label}</a></li>
            </ul>
            <p className="mt-4 text-xs muted">© 2026 Ishchi Bormi. <T>Barcha huquqlar himoyalangan.</T></p>
          </div>
          <div className="md:text-right">
            <div className="flex md:justify-end gap-5 muted">
              <Link href="/biz-haqimizda" className="heading"><T>Biz haqimizda</T></Link>
              <Link href="/maxfiylik-siyosati"><T>Maxfiylik siyosati</T></Link>
              <Link href="/foydalanish-shartlari"><T>Foydalanish shartlari</T></Link>
              <Link href="/yordam"><T>Yordam</T></Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── helpers ────────────────────────── */

function Mini({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="h-10 w-10 grid place-items-center rounded-full" style={{ background: "rgba(127,127,127,0.08)" }}>{icon}</div>
      <div>
        <div className="text-lg font-extrabold heading">{value}</div>
        <div className="text-[11px] muted"><T>{label}</T></div>
      </div>
    </div>
  );
}

function ValueCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="card p-6">
      <div className="h-11 w-11 grid place-items-center rounded-xl bg-brand-navy text-white">{icon}</div>
      <h3 className="mt-3 font-semibold heading"><T>{title}</T></h3>
      <p className="mt-1 text-sm muted"><T>{body}</T></p>
    </div>
  );
}

function FeatureRow({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="card p-5 flex gap-4">
      <div className="h-11 w-11 shrink-0 grid place-items-center rounded-xl" style={{ background: "rgba(127,127,127,0.06)" }}>{icon}</div>
      <div>
        <h4 className="font-semibold heading"><T>{title}</T></h4>
        <p className="mt-1 text-sm muted"><T>{body}</T></p>
      </div>
    </div>
  );
}

function Timeline({ year, title, body }: { year: string; title?: string; body: string }) {
  return (
    <div className="card p-5 grid grid-cols-[64px_1fr] gap-4">
      <div className="rounded-lg bg-accent-amberBg text-accent-amber font-bold text-sm grid place-items-center px-2 py-2 self-start">
        {year}
      </div>
      <div>
        {title && <h4 className="font-semibold heading"><T>{title}</T></h4>}
        <p className="mt-1 text-sm muted"><T>{body}</T></p>
      </div>
    </div>
  );
}
