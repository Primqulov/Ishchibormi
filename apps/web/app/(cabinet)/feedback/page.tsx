"use client";
import { Send, Lightbulb, MessageSquareWarning, ExternalLink } from "lucide-react";
import { Shell } from "@/components/Shell";
import { T } from "@/components/T";
import { SOCIAL } from "@/lib/contact";

// Taklif va shikoyatlar Telegram support boti orqali qabul qilinadi.
// Havola/username yagona manba (lib/contact.ts -> SOCIAL.support) dan olinadi.
const BOT_URL = SOCIAL.support.href;
const BOT_LABEL = SOCIAL.support.label;

const STEPS = [
  "Botni oching va /start ni bosing.",
  "Telefon raqamingizni yuboring.",
  "\"Taklif\" yoki \"Shikoyat\" ni tanlang.",
  "Fikringizni matn, ovozli xabar yoki rasm ko'rinishida yuboring.",
  "Javobni shu botning o'zida olasiz.",
];

export default function FeedbackPage() {
  return (
    <Shell title="Taklif va shikoyatlar">
      <div className="card p-6 sm:p-8 grid gap-5 max-w-2xl">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 shrink-0 grid place-items-center rounded-xl" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
            <Send size={22} />
          </div>
          <div>
            <h2 className="font-semibold heading text-lg"><T>Fikringizni Telegram bot orqali yuboring</T></h2>
            <p className="text-sm muted mt-1">
              <T>Taklif va shikoyatlar maxsus Telegram bot orqali qabul qilinadi. Shu orqali xabaringizga tezroq va bevosita javob beramiz.</T>
            </p>
          </div>
        </div>

        {/* Nima yuborish mumkin */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="surface rounded-xl p-3 flex items-center gap-2 text-sm">
            <Lightbulb size={16} className="text-accent-amber shrink-0" /><T>Taklif — platformani yaxshilash uchun</T>
          </div>
          <div className="surface rounded-xl p-3 flex items-center gap-2 text-sm">
            <MessageSquareWarning size={16} className="text-danger shrink-0" /><T>Shikoyat — muammo yoki nosozlik haqida</T>
          </div>
        </div>

        {/* Qadamlar */}
        <ol className="grid gap-2.5 text-sm">
          {STEPS.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="shrink-0 h-6 w-6 grid place-items-center rounded-full text-xs font-bold" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>{i + 1}</span>
              <span className="muted mt-0.5"><T>{step}</T></span>
            </li>
          ))}
        </ol>

        <a href={BOT_URL} target="_blank" rel="noreferrer" className="btn-primary gap-2 justify-center py-3 text-base">
          <Send size={18} /><T>Telegramda o'tish</T><ExternalLink size={15} />
        </a>
        <p className="text-xs muted text-center">{BOT_LABEL}</p>
      </div>
    </Shell>
  );
}
