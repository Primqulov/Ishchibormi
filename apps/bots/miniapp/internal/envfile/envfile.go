// Package envfile — .env faylini tashqi bog'liqliksiz os.Environ ga yuklaydi.
//
// Web/bot/internal/envfile bilan bir xil xulq-atvor: bu modul mustaqil bo'lishi
// uchun ataylab nusxalangan (Go modullari orasida umumiy paket ulashish uchun
// yo aloqador replace direktivasi, yo alohida chop etilgan modul kerak bo'lardi
// — 50 qatorlik yordamchi uchun bu ortiqcha).
package envfile

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Load joriy papkadagi .env ni qidiradi, topilmasa 4 pog'ona yuqoriga chiqadi.
func Load() {
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for i := 0; i < 4; i++ {
		if loadFile(filepath.Join(dir, ".env")) {
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}

func loadFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(line[:eq])
		v := strings.TrimSpace(line[eq+1:])
		if l := len(v); l >= 2 {
			if (v[0] == '"' && v[l-1] == '"') || (v[0] == '\'' && v[l-1] == '\'') {
				v = v[1 : l-1]
			}
		}
		// Haqiqiy muhit o'zgaruvchisi (docker/compose) har doim ustun turadi.
		if _, exists := os.LookupEnv(k); !exists {
			_ = os.Setenv(k, v)
		}
	}
	return true
}
