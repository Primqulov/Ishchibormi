// Package storage wraps the AWS S3 client and exposes
// simple Upload / Delete operations used across the application.
//
// All uploaded objects live under prefixes derived from their purpose
// (avatars/, elons/<elonId>/), so we can later
// reason about ownership and ACL.
package storage

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"path"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Service struct {
	client        *s3.Client
	presign       *s3.PresignClient
	bucket        string
	publicBaseURL string // e.g. https://my-bucket.s3.eu-central-1.amazonaws.com
	localDir      string // when set and client==nil, store files on local disk
}

type Config struct {
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	PublicBaseURL   string
}

// New configures an S3 client. Returns (nil, error) if the bucket isn't set;
// callers can fall back to disabling upload features.
func New(ctx context.Context, cfg Config) (*Service, error) {
	if cfg.Bucket == "" {
		return nil, errors.New("s3: bucket not configured")
	}
	loadOpts := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(cfg.Region),
	}
	if cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" {
		loadOpts = append(loadOpts, awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, loadOpts...)
	if err != nil {
		return nil, fmt.Errorf("s3 config: %w", err)
	}
	cli := s3.NewFromConfig(awsCfg)
	pub := cfg.PublicBaseURL
	if pub == "" {
		pub = fmt.Sprintf("https://%s.s3.%s.amazonaws.com", cfg.Bucket, cfg.Region)
	}
	pub = strings.TrimRight(pub, "/")
	return &Service{
		client:        cli,
		presign:       s3.NewPresignClient(cli),
		bucket:        cfg.Bucket,
		publicBaseURL: pub,
	}, nil
}

// UploadResult is returned by Upload — key is the S3 object key,
// url is the publicly accessible URL.
type UploadResult struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

// Upload reads body fully into memory and writes it to S3 under
// <prefix>/<random>-<basename>. Returns key and public URL.
// contentType may be empty; if so, it's inferred from the filename.
func (s *Service) Upload(ctx context.Context, prefix, originalName, contentType string, body io.Reader) (*UploadResult, error) {
	if body == nil {
		return nil, errors.New("s3: empty body")
	}
	buf, err := io.ReadAll(io.LimitReader(body, 50<<20)) // 50 MB max
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}
	ext := strings.ToLower(path.Ext(originalName))
	if ext == "" {
		// derive from content type
		if exts, _ := mime.ExtensionsByType(contentType); len(exts) > 0 {
			ext = exts[0]
		}
	}
	rand6 := randHex(6)
	ts := time.Now().UTC().Format("20060102-150405")
	clean := sanitizeFilename(strings.TrimSuffix(path.Base(originalName), ext))
	if clean == "" {
		clean = "file"
	}
	key := strings.Trim(prefix, "/") + "/" + ts + "-" + rand6 + "-" + clean + ext
	if contentType == "" {
		contentType = mime.TypeByExtension(ext)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
	}

	// Local-disk backend (no S3 configured): write under localDir/<key>.
	if s.client == nil {
		return s.writeLocal(key, buf)
	}

	_, err = s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(s.bucket),
		Key:          aws.String(key),
		Body:         bytes.NewReader(buf),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String("public, max-age=31536000, immutable"),
	})
	if err != nil {
		return nil, fmt.Errorf("s3 put: %w", err)
	}
	return &UploadResult{Key: key, URL: s.publicBaseURL + "/" + key}, nil
}

// Delete removes the object referenced by the given key. If you have a URL
// instead, call KeyFromURL first.
func (s *Service) Delete(ctx context.Context, key string) error {
	if key == "" {
		return nil
	}
	if s.client == nil {
		return s.deleteLocal(key)
	}
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}

// DeleteByURL removes by a previously stored public URL. Safe to call with
// URLs that don't belong to this bucket — those are silently ignored.
func (s *Service) DeleteByURL(ctx context.Context, url string) error {
	key := s.KeyFromURL(url)
	if key == "" {
		return nil
	}
	return s.Delete(ctx, key)
}

// DeleteMany best-effort deletes a batch of object keys.
func (s *Service) DeleteMany(ctx context.Context, keys []string) error {
	for _, k := range keys {
		_ = s.Delete(ctx, k)
	}
	return nil
}

// KeyFromURL extracts the S3 key from a public URL we previously produced.
// Returns "" if the URL doesn't look like one of ours.
func (s *Service) KeyFromURL(url string) string {
	if url == "" || s.publicBaseURL == "" {
		return ""
	}
	if !strings.HasPrefix(url, s.publicBaseURL+"/") {
		return ""
	}
	return strings.TrimPrefix(url, s.publicBaseURL+"/")
}

// PublicURL composes the public URL for a key (used when re-rendering).
func (s *Service) PublicURL(key string) string { return s.publicBaseURL + "/" + key }

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func sanitizeFilename(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ' || r == '.':
			b.WriteByte('-')
		}
		if b.Len() >= 60 {
			break
		}
	}
	return strings.Trim(b.String(), "-_")
}
