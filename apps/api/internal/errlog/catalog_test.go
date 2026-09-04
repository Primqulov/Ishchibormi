package errlog

import (
	"regexp"
	"testing"
)

// figmaSeverity — Figma "3.12.2 · Xatoliklar — turlari, holatlar va
// ko'rinishlar" C bo'limidagi 56 ta turning DARAJASI, dizayndan bir-bir
// ko'chirilgan.
//
// Bu test katalogni dizayn bilan bog'lab turadi. Daraja shunchaki rang
// emas: u bildirishnoma qoidasini belgilaydi (Kritik → darhol Telegram,
// Yuqori → 10 hodisadan keyin, qolgani → faqat panelda). Kodni
// tahrirlayotganda darajani beixtiyor pasaytirish — eng jim xatoliklardan
// biri bo'lardi: sahifa oldingidek ko'rinadi, faqat hech kim xabar olmaydi.
var figmaSeverity = map[string]string{
	// C1 · Backend
	"panic": SevCritical, "internal": SevHigh, "config_invalid": SevCritical,
	"invalid_json": SevMedium, "rate_limited": SevMedium, "server_timeout": SevHigh,
	"encode_failed": SevMedium, "export_truncated": SevHigh, "bad_id": SevLow,
	// C2 · Ma'lumotlar bazasi
	"db_unavailable": SevCritical, "db_connect_failed": SevCritical,
	"index_create_failed": SevHigh, "migration_failed": SevHigh,
	"silent_empty_result": SevHigh, "write_conflict": SevMedium,
	// C3 · Tashqi xizmatlar
	"moderation_skipped": SevCritical, "fcm_init_failed": SevCritical,
	"telegram_unreachable": SevHigh, "moderation_unavailable": SevHigh,
	"moderation_parse_failed": SevHigh, "fcm_auth_failed": SevHigh,
	"upload_failed": SevHigh, "fcm_send_failed": SevMedium,
	"image_fetch_failed": SevMedium, "fcm_token_unregistered": SevLow,
	"geocode_failed": SevLow, "orphaned_object": SevLow,
	// C4 · Fon jarayonlari
	"background_panic": SevCritical, "broadcast_dispatch_failed": SevHigh,
	"broadcast_stuck": SevHigh, "retention_purge_failed": SevHigh,
	"autocomplete_failed": SevMedium, "notification_insert_failed": SevMedium,
	"viewbump_overflow": SevLow,
	// C5 · Admin ilovasi
	"flutter.uncaught_exception": SevCritical, "response_cast_failed": SevCritical,
	"secure_storage_failed": SevCritical, "dio.connection_timeout": SevHigh,
	"token_refresh_failed": SevHigh, "pagination_silent_fail": SevHigh,
	"record_dropped": SevMedium, "route_not_found": SevMedium,
	"setstate_after_dispose": SevMedium,
	// C6 · Foydalanuvchi ilovasi va veb
	"otp_send_failed": SevCritical, "auth_bounce_loop": SevCritical,
	"schema_drift": SevHigh, "slot_race": SevHigh,
	"post_accept_cascade_failed": SevMedium, "web_client_error": SevMedium,
	"image_load_failed": SevLow,
	// C7 · Xavfsizlik
	"jwt_sign_failed": SevCritical, "review_login_enabled": SevCritical,
	"rbac_mismatch": SevMedium, "strike_not_recorded": SevMedium,
	"bad_token": SevLow, "biometric_failed": SevLow,
}

func TestCatalogMatchesFigma(t *testing.T) {
	if len(figmaSeverity) != 56 {
		t.Fatalf("dizayn jadvali 56 ta bo'lishi kerak, %d ta yozilgan", len(figmaSeverity))
	}
	for code, want := range figmaSeverity {
		got, ok := Catalog[code]
		if !ok {
			t.Errorf("dizayndagi %q katalogda yo'q", code)
			continue
		}
		if got.Severity != want {
			t.Errorf("%q darajasi %q, dizaynda %q", code, got.Severity, want)
		}
	}
}

var codeRe = regexp.MustCompile(`^[a-z0-9_.]{2,48}$`)

// Har bir yozuv to'liq bo'lishi shart: bo'sh sarlavha ekranda bo'sh qator,
// noma'lum modul esa filtrga tushmaydigan — ya'ni ko'rinmas — xatolik.
func TestCatalogEntriesComplete(t *testing.T) {
	runtimes := map[string]bool{RTBackend: true, RTAdminApp: true, RTClientApp: true, RTOTPBot: true, RTWeb: true}
	for code, ty := range Catalog {
		if !codeRe.MatchString(code) {
			t.Errorf("kod shakli noto'g'ri: %q", code)
		}
		if !Modules[ty.Module] {
			t.Errorf("%q: noma'lum modul %q", code, ty.Module)
		}
		if !Severities[ty.Severity] {
			t.Errorf("%q: noma'lum daraja %q", code, ty.Severity)
		}
		if !runtimes[ty.Runtime] {
			t.Errorf("%q: noma'lum ish muhiti %q", code, ty.Runtime)
		}
		if ty.Title == "" {
			t.Errorf("%q: sarlavha bo'sh", code)
		}
		if SeverityRank[ty.Severity] == 0 {
			t.Errorf("%q: daraja tartibi yo'q — saralash noto'g'ri ishlaydi", code)
		}
	}
}

// Mijoz yubora oladigan kodlar ro'yxati — xavfsizlikning asosiy chegarasi.
// Har bir yangi `ClientReportable: true` shu testni buzadi va ataylab:
// server tomonidagi kodni mijozga ochish "MongoDB o'chdi" degan yolg'on
// Kritik hodisani tashqaridan yasash imkonini berardi.
func TestClientReportableIsClosedSet(t *testing.T) {
	want := map[string]bool{
		// C5 · admin ilovasi (admin tokeni bilan)
		"flutter.uncaught_exception": true, "response_cast_failed": true,
		"secure_storage_failed": true, "dio.connection_timeout": true,
		"token_refresh_failed": true, "pagination_silent_fail": true,
		"record_dropped": true, "route_not_found": true,
		"setstate_after_dispose": true,
		// C6 · foydalanuvchi ilovasi va veb (foydalanuvchi tokeni bilan)
		"auth_bounce_loop": true, "schema_drift": true,
		"web_client_error": true, "image_load_failed": true,
		// C7 · qurilma qulfi — admin ilovasida
		"biometric_failed": true,
	}
	for code, ty := range Catalog {
		if ty.ClientReportable != want[code] {
			t.Errorf("%q: ClientReportable=%v, kutilgan %v", code, ty.ClientReportable, want[code])
		}
		// Mijozdan keladigan kod faqat mijoz muhitiga tegishli modulda
		// bo'lishi mumkin (ingest.go dagi allow ro'yxati shunga tayanadi).
		if ty.ClientReportable && ty.Module != ModAdminApp && ty.Module != ModClientApp && ty.Module != ModSecurity {
			t.Errorf("%q: mijozdan qabul qilinadigan kod %q modulida", code, ty.Module)
		}
	}
}

// Server tomonida aniqlanadigan xatolik hech qachon mijozdan kelmasligi
// kerak — aks holda "OTP yetib bormadi" degan Kritik hodisani istalgan
// foydalanuvchi yasab, Telegram ogohlantirishini chiqara olardi.
func TestServerOnlyCodesRejectClients(t *testing.T) {
	for _, code := range []string{
		"otp_send_failed", "slot_race", "post_accept_cascade_failed",
		"db_unavailable", "panic", "review_login_enabled", "moderation_skipped",
	} {
		if Catalog[code].ClientReportable {
			t.Errorf("%q mijozdan qabul qilinadi — bu server tomonidagi xatolik", code)
		}
	}
}
