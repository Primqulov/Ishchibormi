// Package envfile loads a .env file into os.Environ without any external deps.
package envfile

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Load tries .env in the current dir, then walks up to 4 parent dirs.
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
		if _, exists := os.LookupEnv(k); !exists {
			_ = os.Setenv(k, v)
		}
	}
	return true
}
