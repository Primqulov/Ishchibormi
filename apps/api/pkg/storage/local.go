package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// NewLocal returns a Service that stores uploaded files on the local filesystem
// under dir, and exposes them at publicBaseURL (which must be served by the API,
// e.g. http://localhost:8080/uploads). Used as a fallback when S3 isn't
// configured, so uploads work out of the box in local/self-hosted setups.
func NewLocal(dir, publicBaseURL string) (*Service, error) {
	if dir == "" {
		return nil, errors.New("storage: local dir not set")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("storage: mkdir %q: %w", dir, err)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Errorf("storage: abs %q: %w", dir, err)
	}
	return &Service{
		localDir:      abs,
		publicBaseURL: strings.TrimRight(publicBaseURL, "/"),
	}, nil
}

// LocalDir reports the on-disk directory backing local storage ("" for S3 mode).
func (s *Service) LocalDir() string { return s.localDir }

// resolveLocal maps an object key to an absolute on-disk path, ensuring the
// result stays within localDir (defence-in-depth against path traversal even
// though keys are server-generated and sanitized).
func (s *Service) resolveLocal(key string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash("/" + key)) // force absolute, drop ".."
	full := filepath.Join(s.localDir, clean)
	if full != s.localDir && !strings.HasPrefix(full, s.localDir+string(os.PathSeparator)) {
		return "", errors.New("storage: key escapes local dir")
	}
	return full, nil
}

func (s *Service) writeLocal(key string, buf []byte) (*UploadResult, error) {
	full, err := s.resolveLocal(key)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return nil, fmt.Errorf("storage: mkdir: %w", err)
	}
	if err := os.WriteFile(full, buf, 0o644); err != nil {
		return nil, fmt.Errorf("storage: write: %w", err)
	}
	return &UploadResult{Key: key, URL: s.publicBaseURL + "/" + key}, nil
}

func (s *Service) deleteLocal(key string) error {
	full, err := s.resolveLocal(key)
	if err != nil {
		return err
	}
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
