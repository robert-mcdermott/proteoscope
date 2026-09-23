package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Downloads older than maxAge are refetched (and served stale only if the refetch fails);
// a zero maxAge keeps them forever.
type diskCache struct {
	dir      string
	maxAge   time.Duration
	warnOnce sync.Once
}

type cacheMeta struct {
	ContentType string            `json:"contentType"`
	Headers     map[string]string `json:"headers"`
}

const defaultCacheMaxAge = 30 * 24 * time.Hour

func openCache(dir string, disabled bool, maxAge time.Duration) *diskCache {
	if disabled {
		return nil
	}
	if dir == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			log.Printf("download cache disabled: %v", err)
			return nil
		}
		dir = filepath.Join(base, "proteoscope")
	}
	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}
	return &diskCache{dir: dir, maxAge: maxAge}
}

func formatAge(age time.Duration) string {
	day := 24 * time.Hour
	switch {
	case age == day:
		return "1 day"
	case age%day == 0:
		return fmt.Sprintf("%d days", age/day)
	default:
		return age.String()
	}
}

// load returns a cached payload and whether it is older than the cache's maximum age.
func (c *diskCache) load(kind, name string) (payload, bool, bool) {
	if c == nil {
		return payload{}, false, false
	}
	file := filepath.Join(c.dir, kind, name)
	raw, err := os.ReadFile(file + ".meta.json")
	if err != nil {
		return payload{}, false, false
	}
	var meta cacheMeta
	if err := json.Unmarshal(raw, &meta); err != nil || meta.ContentType == "" {
		return payload{}, false, false
	}
	info, err := os.Stat(file)
	if err != nil {
		return payload{}, false, false
	}
	body, err := os.ReadFile(file)
	if err != nil {
		return payload{}, false, false
	}
	maxAge := c.maxAgeFor(kind)
	stale := maxAge > 0 && time.Since(info.ModTime()) > maxAge
	return payload{body: body, contentType: meta.ContentType, headers: meta.Headers}, true, stale
}

// Search results go stale within a day, since new entries are released weekly.
func (c *diskCache) maxAgeFor(kind string) time.Duration {
	if kind == "search" && (c.maxAge == 0 || c.maxAge > searchCacheAge) {
		return searchCacheAge
	}
	return c.maxAge
}

func (c *diskCache) store(kind, name string, p payload) {
	if c == nil {
		return
	}
	if err := c.write(kind, name, p); err != nil {
		c.warnOnce.Do(func() {
			log.Printf("download cache write failed (further cache errors are not logged): %v", err)
		})
	}
}

func (c *diskCache) write(kind, name string, p payload) error {
	dir := filepath.Join(c.dir, kind)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	meta, err := json.Marshal(cacheMeta{ContentType: p.contentType, Headers: p.headers})
	if err != nil {
		return err
	}
	file := filepath.Join(dir, name)
	if err := writeFileAtomic(file, p.body); err != nil {
		return err
	}
	return writeFileAtomic(file+".meta.json", meta)
}

func writeFileAtomic(file string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(file), "."+filepath.Base(file)+".*.tmp")
	if err != nil {
		return err
	}
	_, err = tmp.Write(data)
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), file)
	}
	if err != nil {
		os.Remove(tmp.Name())
	}
	return err
}
