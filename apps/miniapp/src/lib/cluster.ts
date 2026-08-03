// Xarita pinlarini ekran masofasi bo'yicha klasterlash.
//
// apps/web/lib/cluster.ts dan AYNAN ko'chirilgan — ikkala klientda xarita bir
// xil "yig'ilib/yoyilib" ko'rinishi kerak. Sof funksiya: leaflet'ga ham,
// React'ga ham bog'liq emas, shuning uchun nusxa xavfsiz.
//
// Xarita uzoqlashtirilganda pinlar bir-biriga yaqinlashadi va shu yerda
// birlashib, ustida soni yozilgan bitta raqamga aylanadi. Yana uzoqlashtirilsa
// klasterlarning o'zi ham qo'shilib boradi (markazi a'zolarning o'rtachasiga
// suriladi — shu tufayli zanjir bo'lib birlashish tabiiy chiqadi).
// Yaqinlashtirilganda esa masofalar ochilib, klasterlar mayda raqamlarga va
// oxir-oqibat alohida pinlarga bo'linadi.

export type ClusterNode<T> = { key: string; x: number; y: number; items: T[] };

export interface ClusterInput<T> {
  key: string;
  x: number;
  y: number;
  item: T;
}

export function clusterByRadius<T>(points: ClusterInput<T>[], radius: number): ClusterNode<T>[] {
  const out: ClusterNode<T>[] = [];
  const r2 = radius * radius;

  for (const p of points) {
    let host: ClusterNode<T> | null = null;
    for (const n of out) {
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      if (dx * dx + dy * dy <= r2) {
        host = n;
        break;
      }
    }
    if (host) {
      host.items.push(p.item);
      host.x += (p.x - host.x) / host.items.length;
      host.y += (p.y - host.y) / host.items.length;
    } else {
      out.push({ key: p.key, x: p.x, y: p.y, items: [p.item] });
    }
  }
  return out;
}
