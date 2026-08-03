// Kategoriya teglari ranglari — apps/web/lib/cat-color.ts dan ko'chirilgan.
// Sayt va Mini App'da bir xil kategoriya bir xil rangda ko'rinishi kerak,
// shuning uchun palitra va nomlar jadvali aynan bir xil saqlanadi.

export type Tone = { bg: string; fg: string };

const PALETTE: Record<string, Tone> = {
  blue:   { bg: "#DCE9FF", fg: "#0038D8" },
  pink:   { bg: "#FDF2F8", fg: "#BE185D" },
  amber:  { bg: "#FFEED4", fg: "#8A5300" },
  green:  { bg: "#DFF5E5", fg: "#1A7F3C" },
  violet: { bg: "#EDE9FE", fg: "#6D28D9" },
  teal:   { bg: "#D9F5F2", fg: "#0F766E" },
};

const BY_NAME: Record<string, keyof typeof PALETTE> = {
  "tozalash": "blue",
  "yuk tashish": "pink",
  "qurilish": "amber",
  "yetkazish": "blue",
  "bog'bonlik": "green",
  "bogbonlik": "green",
  "santexnika": "teal",
  "mebel": "violet",
  "elektrik": "amber",
};

/** Ro'yxatda yo'q nom barqaror hash orqali palitradan rang oladi. */
export function catTone(name?: string): Tone {
  if (!name) return PALETTE.blue;
  const key = name.trim().toLowerCase();
  const direct = BY_NAME[key];
  if (direct) return PALETTE[direct];
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const keys = Object.keys(PALETTE);
  return PALETTE[keys[h % keys.length]];
}
