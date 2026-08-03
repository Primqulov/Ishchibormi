"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Script = "latin" | "cyrillic";

const latinToCyr: Array<[RegExp | string, string]> = [
  // digraphs first
  ["O'", "Ў"], ["o'", "ў"], ["G'", "Ғ"], ["g'", "ғ"],
  ["Sh", "Ш"], ["sh", "ш"], ["SH", "Ш"],
  ["Ch", "Ч"], ["ch", "ч"], ["CH", "Ч"],
  ["Yo", "Ё"], ["yo", "ё"], ["YO", "Ё"],
  ["Yu", "Ю"], ["yu", "ю"], ["YU", "Ю"],
  ["Ya", "Я"], ["ya", "я"], ["YA", "Я"],
  ["Ye", "Е"], ["ye", "е"], ["YE", "Е"],
  ["Ng", "Нг"], ["ng", "нг"],
  // single letters
  ["A", "А"], ["a", "а"], ["B", "Б"], ["b", "б"],
  ["D", "Д"], ["d", "д"], ["E", "Э"], ["e", "э"],
  ["F", "Ф"], ["f", "ф"], ["G", "Г"], ["g", "г"],
  ["H", "Ҳ"], ["h", "ҳ"], ["I", "И"], ["i", "и"],
  ["J", "Ж"], ["j", "ж"], ["K", "К"], ["k", "к"],
  ["L", "Л"], ["l", "л"], ["M", "М"], ["m", "м"],
  ["N", "Н"], ["n", "н"], ["O", "О"], ["o", "о"],
  ["P", "П"], ["p", "п"], ["Q", "Қ"], ["q", "қ"],
  ["R", "Р"], ["r", "р"], ["S", "С"], ["s", "с"],
  ["T", "Т"], ["t", "т"], ["U", "У"], ["u", "у"],
  ["V", "В"], ["v", "в"], ["X", "Х"], ["x", "х"],
  ["Y", "Й"], ["y", "й"], ["Z", "З"], ["z", "з"],
  ["'", "ъ"],
];

export function toCyrillic(s: string): string {
  let out = s;
  for (const [from, to] of latinToCyr) {
    if (typeof from === "string") {
      out = out.split(from).join(to);
    } else {
      out = out.replace(from, to);
    }
  }
  return out;
}

interface ScriptState {
  script: Script;
  setScript: (s: Script) => void;
  toggle: () => void;
}

export const useScript = create<ScriptState>()(
  persist(
    (set, get) => ({
      script: "latin",
      setScript: (s) => set({ script: s }),
      toggle: () => set({ script: get().script === "latin" ? "cyrillic" : "latin" }),
    }),
    {
      name: "ib-script",
      // SSR bilan mos kelishi uchun localStorage'dan avtomatik o'qimaymiz —
      // birinchi render doim "latin" (server bilan bir xil), so'ng Providers
      // mount bo'lgach qo'lda rehydrate qilinadi. Aks holda hydration mismatch.
      skipHydration: true,
    }
  )
);

/** Tr: transliterate Uzbek-Latin text to the user's chosen script. */
export function tr(s: string, script: Script): string {
  if (script === "cyrillic") return toCyrillic(s);
  return s;
}
