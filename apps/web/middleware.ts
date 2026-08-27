import { NextResponse, type NextRequest } from "next/server";

/**
 * Xost bo'yicha ajratish: admin paneli FAQAT boshqaruv subdomenida ochiladi.
 *
 * # NEGA KERAK
 *
 * Panel ilgari ishchibormi.uz/admin da turardi — ya'ni saytga kirgan har
 * qanday odam login formasini ko'rar va unga parol terib ko'rishi mumkin edi.
 * Endi ommaviy domenda `/admin` umuman yo'q (404), panel esa nomi
 * oshkor qilinmagan alohida subdomenda, uning ustiga Caddy darajasidagi
 * qo'shimcha qulf bilan (deploy/Caddyfile).
 *
 * # NEGA IKKI QATLAM
 *
 * Asosiy to'siq Caddy'da: so'rov Next.js gacha yetib ham bormaydi. Bu yerdagi
 * tekshiruv — zaxira. Caddy sozlamasi qo'lda ko'chiriladigan fayl
 * (`sudo cp deploy/Caddyfile /etc/caddy/Caddyfile`), ya'ni bir kun eskirib
 * qolishi mumkin; ilovaning o'zi ham "men qaysi xostdaman" degan qoidani
 * bilib turgani ma'qul.
 *
 * Subdomen nomi MAXFIY: u repoda emas, `ADMIN_PANEL_HOST` orqali beriladi.
 * Ataylab `NEXT_PUBLIC_` EMAS — bitta build ommaviy saytga ham xizmat qiladi
 * va u prefiks qiymatni brauzerga yuklanadigan JS ichiga qo'shib qo'yardi.
 * Middleware faqat serverda ishlaydi, shuning uchun bu yerda nom xavfsiz.
 *
 * Qiymat berilmasa (lokal ishlash) hech narsa o'zgarmaydi — /admin
 * odatdagidek ochiladi.
 */
const ADMIN_HOST = (process.env.ADMIN_PANEL_HOST || "").toLowerCase();

/** Panelning o'zi ishlashi uchun kerak bo'ladigan statik yo'llar. */
const ASSET_PREFIX = /^\/(_next|img|icons?|assets|fonts)\//;
/** favicon.ico, apple-touch-icon.png va shu kabilar. */
const HAS_EXTENSION = /\.[a-z0-9]+$/i;

function notFound(): NextResponse {
  // Ataylab oddiy 404: "bu yerda admin panel bor, lekin ruxsat yo'q" degan
  // ishorani ham bermaymiz.
  return new NextResponse("404 — sahifa topilmadi", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const path = req.nextUrl.pathname;
  const isAdminHost = ADMIN_HOST !== "" && host === ADMIN_HOST;

  if (isAdminHost) {
    // Boshqaruv subdomeni qidiruv tizimlari uchun butunlay yopiq. Ommaviy
    // domendagi robots.txt bu yerga taalluqli emas — u boshqa xost.
    if (path === "/robots.txt") {
      return new NextResponse("User-agent: *\nDisallow: /\n", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    // Ildizga kirgan odam qo'lda /admin yozib o'tirmasin.
    if (path === "/") {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    if (path.startsWith("/admin") || ASSET_PREFIX.test(path) || HAS_EXTENSION.test(path)) {
      const res = NextResponse.next();
      // Sahifa biror yo'l bilan robotga ko'rinib qolsa ham indekslanmasin.
      res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
      return res;
    }
    // Saytning ommaviy qismi bu xostda umuman xizmat qilmaydi: bitta panel
    // ikki manzilda ochilib yurmasin.
    return notFound();
  }

  // Ommaviy domen (ishchibormi.uz): admin paneli bu yerda YO'Q.
  if (path === "/admin" || path.startsWith("/admin/")) {
    return notFound();
  }
  return NextResponse.next();
}

export const config = {
  // Statik chunk'lar va rasm optimizatsiyasi middleware'siz o'tadi — ular har
  // sahifa yuklanishida o'nlab so'rov, tekshiruvdan foyda yo'q.
  matcher: ["/((?!_next/static|_next/image|_next/data).*)"],
};
