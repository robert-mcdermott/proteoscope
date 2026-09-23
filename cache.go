package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

type diskCache struct {
	dir      string
	warnOnce sync.Once
}

type cacheMeta struct {
	ContentType string            `json:"contentType"`
	Headers     map[string]string `json:"headers"`
}

func openCache(dir string, disabled bool) *diskCache {
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
	return &diskCache{dir: dir}
}

func (c *diskCache) load(kind, name string) (payload, bool) {
	if c == nil {
		return payload{}, false
	}
	file := filepath.Join(c.dir, kind, name)
	raw, err := os.ReadFile(file + ".meta.json")
	if err != nil {
		return payload{}, false
	}
	var meta cacheMeta
	if err := json.Unmarshal(raw, &meta); err != nil || meta.ContentType == "" {
		return payload{}, false
	}
	body, err := os.ReadFile(file)
	if err != nil {
		return payload{}, false
	}
	return payload{body: body, contentType: meta.ContentType, headers: meta.Headers}, true
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
