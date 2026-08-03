// Package envfile loads a .env file into os.Environ without any external deps.
// It searches upwards from the current working directory for a .env file
// (so running `go run ./cmd/api` from backend/ picks up the project-root .env),
// and only sets variables that are NOT already present in the environment.
package envfile

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Load tries .env in the current dir, then walks up to maxUp parent dirs.
func Load() {
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for i := 0; i < 4; i++ {
		path := filepath.Join(dir, ".env")
		if loadFile(path) {
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
		// Strip optional `export ` prefix.
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		k := strings.TrimSpace(line[:eq])
		v := strings.TrimSpace(line[eq+1:])
		// Strip surrounding quotes if present.
		if l := len(v); l >= 2 {
			if (v[0] == '"' && v[l-1] == '"') || (v[0] == '\'' && v[l-1] == '\'') {
				v = v[1 : l-1]
			}
		}
		if _, exists := os.LookupEnv(k); !exists {
			_ = os.Setenv(k, v)
		}
	}
	return true
}
