package admin

import (
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Rejalashtirish maydoni — platformadagi eng qaytarib bo'lmaydigan amalning
// qorovuli, shuning uchun u Mongo'siz, aniq vaqt bilan tekshiriladi.
// `kod()` yordamchisi shu paketdagi categories_validate_test.go da.
func TestBroadcastSchedule(t *testing.T) {
	now := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	iso := func(d time.Duration) string { return now.Add(d).Format(time.RFC3339) }

	for nom, tc := range map[string]struct {
		kirish string
		/** Kutilgan xato kodi; bo'sh satr — xato yo'q. */
		kutgan string
		/** Vaqt qaytdimi (ya'ni tarqatma navbatga qo'yiladimi). */
		reja bool
	}{
		"bo'sh — darhol yuboriladi":   {"", "", false},
		"faqat bo'sh joy — darhol":    {"   ", "", false},
		"RFC3339 emas":                {"01.09.2026 10:00", "bad_time", false},
		"umuman sana emas":            {"hozir", "bad_time", false},
		"uzoq o'tmish":                {iso(-48 * time.Hour), "bad_time", false},
		"chekinishdan tashqari":       {iso(-6 * time.Minute), "bad_time", false},
		"chekinish ichida — darhol":   {iso(-2 * time.Minute), "", false},
		"yarim daqiqadan keyin":       {iso(30 * time.Second), "", false},
		"o'n daqiqadan keyin — reja":  {iso(10 * time.Minute), "", true},
		"bir yil ichida — reja":       {iso(bcMaxAhead - time.Hour), "", true},
		"bir yildan uzoq":             {iso(bcMaxAhead + time.Hour), "bad_time", false},
		"vaqt mintaqasi bilan — reja": {"2026-09-01T18:00:00+05:00", "", true},
	} {
		got, err := broadcastSchedule(tc.kirish, now)
		if k := kod(err); k != tc.kutgan {
			t.Errorf("%s: xato kodi %q, kutilgan %q", nom, k, tc.kutgan)
		}
		if (got != nil) != tc.reja {
			t.Errorf("%s: reja %v, kutilgan %v", nom, got != nil, tc.reja)
		}
	}
}

// O'tgan vaqt jimgina «hozir yubor» ga aylanmasligi — shu ekrandagi eng
// muhim xavfsizlik qoidasi. Alohida test: yuqoridagi jadval o'zgarsa ham
// bu holat tushib qolmasin.
func TestBroadcastScheduleOtmishDarholYubormaydi(t *testing.T) {
	now := time.Date(2026, 9, 1, 18, 0, 0, 0, time.UTC)
	// Admin «bugun 09:00» ni tanladi, hozir esa 18:00.
	kechikkan := now.Add(-9 * time.Hour).Format(time.RFC3339)
	got, err := broadcastSchedule(kechikkan, now)
	if got != nil {
		t.Fatalf("o'tgan vaqt reja bo'lib qabul qilindi: %v", got)
	}
	if k := kod(err); k != "bad_time" {
		t.Errorf("xato kodi %q, kutilgan bad_time — aks holda xabar darhol hammaga ketardi", k)
	}
}

// Qabul qiluvchilar filtri — Figma 3.8a · «Segment ko'rinishi» qoidasi:
// viloyat bo'sh bo'lsa barcha viloyat, katakcha o'chiq bo'lsa hammasi.
// O'chirilgan hisoblar esa HAR QANDAY holatda tashqarida qoladi.
func TestBroadcastFilter(t *testing.T) {
	f := broadcastFilter(broadcastReq{})
	if _, ok := f["isDeleted"]; !ok {
		t.Error("isDeleted sharti yo'q — o'chirilgan hisoblarga ham xabar ketardi")
	}
	if _, ok := f["isBlocked"]; ok {
		t.Error("activeOnly=false, lekin isBlocked sharti qo'shilgan")
	}
	if _, ok := f["region"]; ok {
		t.Error("viloyat bo'sh, lekin region sharti qo'shilgan")
	}

	f = broadcastFilter(broadcastReq{ActiveOnly: true, Region: "  Toshkent viloyati  "})
	if _, ok := f["isDeleted"]; !ok {
		t.Error("isDeleted sharti yo'q")
	}
	if _, ok := f["isBlocked"]; !ok {
		t.Error("activeOnly=true, lekin bloklanganlar chetlatilmagan")
	}
	if f["region"] != "Toshkent viloyati" {
		t.Errorf("region = %v, chetlari kesilgan qiymat kutilgan", f["region"])
	}
}

// Segment ro'yxati (Figma 3.8b) — ro'yxatda FAQAT yuborib bo'ladigan
// qiymatlar turishi kerak. Aks holda tanlagich o'z vazifasini buzardi:
// admin ro'yxatdan tanlaydi, lekin xabar ko'rsatilgan sondan kamroq
// odamga (yoki umuman hech kimga) ketadi.
func TestBroadcastRegionItems(t *testing.T) {
	uzun := strings.Repeat("a", bcRegionMax+1)
	got := broadcastRegionItems([]bcRegionCount{
		{Region: "Toshkent shahri", Count: 12480},
		{Region: "", Count: 900},            // bo'sh = «barcha viloyatlar»
		{Region: " Samarqand ", Count: 140}, // filtr chetini kesadi — topilmaydi
		{Region: uzun, Count: 70},           // server `too_long` bilan rad etadi
		{Region: "Samarqand", Count: 5140},
		{Region: "Buxoro", Count: 0}, // hisoblanmagan guruh
		{Region: "Qashqadaryo", Count: 2910},
	})
	kutgan := []bcRegionCount{
		{Region: "Toshkent shahri", Count: 12480},
		{Region: "Samarqand", Count: 5140},
		{Region: "Qashqadaryo", Count: 2910},
	}
	if !reflect.DeepEqual(got, kutgan) {
		t.Errorf("ro'yxat = %v, kutilgan %v", got, kutgan)
	}
}

// Bo'sh ro'yxat ham JSON'da `[]` bo'lib chiqishi kerak, `null` emas:
// klient uni aylantirib chiqadi.
func TestBroadcastRegionItemsBoshRoyxat(t *testing.T) {
	got := broadcastRegionItems(nil)
	if got == nil {
		t.Fatal("nil qaytdi — javobda `null` bo'lib ketardi")
	}
	if len(got) != 0 {
		t.Errorf("uzunlik %d, kutilgan 0", len(got))
	}
}

// Chegara — bazada minglab turli qiymat bo'lsa ham ro'yxat cheklanadi:
// u tanlash uchun, tahlil uchun emas.
func TestBroadcastRegionItemsChegara(t *testing.T) {
	xom := make([]bcRegionCount, 0, bcRegionsMax+50)
	for i := 0; i < bcRegionsMax+50; i++ {
		xom = append(xom, bcRegionCount{Region: "V" + strconv.Itoa(i), Count: int64(bcRegionsMax + 50 - i)})
	}
	got := broadcastRegionItems(xom)
	if len(got) != bcRegionsMax {
		t.Fatalf("uzunlik %d, kutilgan %d", len(got), bcRegionsMax)
	}
	// Kesish OXIRIDAN bo'ladi: pipeline soni ko'p bo'lganini yuqoriga
	// qo'yadi, ya'ni eng katta segmentlar ro'yxatda qoladi.
	if got[0].Region != "V0" {
		t.Errorf("birinchi qator %q, kutilgan «V0»", got[0].Region)
	}
}

// Proyeksiya bilan javob strukturasi bir-biriga qulflanadi.
//
// Asosiy maqsad — `createdBy`: tarqatmani yuborgan xodimning ichki ID'si
// Figma 3.8 jadvalida chizilmagan va javobda kerak emas. Kimdir
// proyeksiyaga qo'shsa yoki strukturaga maydon qo'shib proyeksiyani
// yangilashni unutsa (javobda bo'sh qiymat kelardi), shu test yoriladi.
func TestBcRowProjectionRowBilanBirXil(t *testing.T) {
	tur := reflect.TypeOf(adminBroadcastRow{})
	strukturada := map[string]bool{}
	for i := 0; i < tur.NumField(); i++ {
		tag := tur.Field(i).Tag.Get("bson")
		if tag == "" || tag == "-" {
			continue
		}
		nomi := strings.Split(tag, ",")[0]
		if nomi == "_id" {
			continue // `_id` proyeksiyada har doim bor, uni yozish shart emas
		}
		strukturada[nomi] = true
	}
	for maydon := range strukturada {
		if _, ok := bcRowProjection[maydon]; !ok {
			t.Errorf("adminBroadcastRow.%s proyeksiyada yo'q — javobda bo'sh keladi", maydon)
		}
	}
	for maydon := range bcRowProjection {
		if !strukturada[maydon] {
			t.Errorf("bcRowProjection[%q] o'qiladi, lekin adminBroadcastRow da yo'q", maydon)
		}
	}
	if _, ok := bcRowProjection["createdBy"]; ok {
		t.Error("createdBy proyeksiyaga qaytib kelgan — xodim ID'si javobga oqib ketadi")
	}
}
