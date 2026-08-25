package config

import (
	"os"
	"testing"
)

// TestModerationFailClosedDefault — fail-open/fail-closed standarti muhitga
// bog'liq: productionda tekshirilmagan e'lon ommaga chiqmasligi kerak.
func TestModerationFailClosedDefault(t *testing.T) {
	// Productionda Load() boshqa qat'iy talablarni ham tekshiradi, shuning
	// uchun bu yerda faqat sof qaror mantig'i sinaladi (Load'dagi bilan bir xil).
	cases := []struct {
		name       string
		appEnv     string
		envValue   string // "" = umuman berilmagan
		wantClosed bool
		wantWarn   bool
	}{
		{"dev, berilmagan", "dev", "", false, false},
		{"production, berilmagan", "production", "", true, false},
		{"prod (qisqa), berilmagan", "prod", "", true, false},
		{"production, ataylab false", "production", "false", false, true},
		{"production, ataylab true", "production", "true", true, false},
		{"dev, ataylab true", "dev", "true", true, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if c.envValue == "" {
				os.Unsetenv("MODERATION_FAIL_CLOSED")
			} else {
				t.Setenv("MODERATION_FAIL_CLOSED", c.envValue)
			}
			cfg := Config{AppEnv: c.appEnv}
			if v, ok := envBoolSet("MODERATION_FAIL_CLOSED"); ok {
				cfg.ModerationFailClosed = v
				cfg.moderationFailClosedExplicit = true
			} else {
				cfg.ModerationFailClosed = cfg.IsProd()
			}
			if cfg.ModerationFailClosed != c.wantClosed {
				t.Errorf("ModerationFailClosed = %v, want %v", cfg.ModerationFailClosed, c.wantClosed)
			}
			if got := cfg.ModerationFailOpenInProd(); got != c.wantWarn {
				t.Errorf("ModerationFailOpenInProd() = %v, want %v", got, c.wantWarn)
			}
		})
	}
}

// TestLoadUsesEnvironmentDefault — Load() haqiqatan shu qarorni qo'llaydi.
func TestLoadUsesEnvironmentDefault(t *testing.T) {
	os.Unsetenv("MODERATION_FAIL_CLOSED")
	t.Setenv("APP_ENV", "dev")
	if cfg := Load(); cfg.ModerationFailClosed {
		t.Error("dev: ModerationFailClosed = true, want false")
	}
	t.Setenv("MODERATION_FAIL_CLOSED", "true")
	if cfg := Load(); !cfg.ModerationFailClosed {
		t.Error("dev + aniq true: ModerationFailClosed = false, want true")
	}
}
