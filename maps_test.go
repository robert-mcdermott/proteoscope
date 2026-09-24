package main

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"
)

// packMessage encodes the few MessagePack types the volume server's answers use (small maps,
// arrays and strings).
func packMessage(value any) []byte {
	var out []byte
	var write func(any)
	write = func(value any) {
		switch item := value.(type) {
		case nil:
			out = append(out, 0xc0)
		case int:
			out = append(out, byte(item))
		case string:
			if len(item) < 32 {
				out = append(out, 0xa0|byte(len(item)))
			} else {
				out = append(out, 0xd9, byte(len(item)))
			}
			out = append(out, item...)
		case []byte:
			out = append(out, 0xc4, byte(len(item)))
			out = append(out, item...)
		case []any:
			out = append(out, 0x90|byte(len(item)))
			for _, element := range item {
				write(element)
			}
		case map[string]any:
			keys := make([]string, 0, len(item))
			for key := range item {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			out = append(out, 0x80|byte(len(keys)))
			for _, key := range keys {
				write(key)
				write(item[key])
			}
		}
	}
	write(value)
	return out
}

// A volume-server answer: _density_server_result with has_error (and error), plus a data block.
func volumeAnswer(hasError, message string) []byte {
	column := func(name, value string) map[string]any {
		return map[string]any{"name": name, "data": map[string]any{
			"encoding": []any{map[string]any{"kind": "StringArray", "stringData": value, "dataEncoding": []any{map[string]any{"kind": "ByteArray", "type": 4}}}},
			"data":     []byte{0, 0, 0, 0},
		}}
	}
	columns := []any{column("has_error", hasError)}
	if message != "" {
		columns = append(columns, column("error", message))
	}
	return packMessage(map[string]any{
		"encoder": "VolumeServer 0.9.7",
		"version": "0.3.0",
		"dataBlocks": []any{
			map[string]any{"header": "SERVER", "categories": []any{map[string]any{"name": "_density_server_result", "rowCount": 1, "columns": columns}}},
			map[string]any{"header": "2FO-FC", "categories": []any{map[string]any{"name": "_volume_data_3d", "rowCount": 1, "columns": []any{}}}},
		},
	})
}

func TestVolumeServerRoutes(t *testing.T) {
	good := volumeAnswer("no", "")
	tooBig := volumeAnswer("yes", "Error: The query box volume is too big.")
	failed := volumeAnswer("yes", "Error: Could not read the map.")
	header := `{"formatVersion":"1.0.0","channels":["2Fo-Fc","Fo-Fc"],"isAvailable":true}`
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		path, detail := r.URL.Path, r.URL.Query().Get("detail")
		switch {
		case path == "/pdbe/volume-server/x-ray/1abc":
			w.Write([]byte(header))
		case path == "/pdbe/volume-server/x-ray/2abc", path == "/pdbe/volume-server/x-ray/3abc":
			w.Write([]byte(`{"isAvailable":false}`))
		case path == "/x-ray/3abc":
			w.Write([]byte(header))
		case path == "/x-ray/4abc", path == "/pdbe/volume-server/x-ray/5abc":
			http.Error(w, "busy", http.StatusServiceUnavailable)
		case path == "/x-ray/5abc":
			w.Write([]byte(header))
		case path == "/pdbe/volume-server/x-ray/6abc":
			w.Write([]byte(`{"error":"internal"}`))
		case path == "/pdbe/volume-server/x-ray/1abc/box/1.5,-2,3/11.5,8,13" && detail == "3" && r.URL.Query().Get("encoding") == "bcif":
			w.Write(good)
		case path == "/x-ray/1abc/box/1.5,-2,3/11.5,8,13" && detail == "3":
			w.Write(append([]byte(nil), good...))
		case path == "/pdbe/volume-server/x-ray/1abc/box/0,0,0/500,500,500":
			w.Write(tooBig)
		case path == "/pdbe/volume-server/x-ray/1abc/box/0,0,0/10,10,10":
			w.Write(failed)
		case path == "/x-ray/1abc/box/0,0,0/10,10,10":
			w.Write(good)
		case path == "/pdbe/volume-server/x-ray/1abc/box/0,0,0/20,20,20":
			w.Write([]byte("<html>maintenance</html>"))
		case strings.HasPrefix(path, "/pdbe/volume-server/em/emd-1234/cell"):
			// PDBe fails; RCSB's copy of the service answers.
			http.Error(w, "busy", http.StatusServiceUnavailable)
		case path == "/em/emd-1234/cell" && detail == "5":
			w.Write(good)
		case path == "/emdb/api/entry/map/EMD-1234":
			w.Write([]byte(`{"emdb_id":"EMD-1234","map":{"contour_list":{"contour":[{"primary":true,"level":0.136}]}}}`))
		default:
			http.NotFound(w, r)
		}
	})
	cache := t.TempDir()
	h := testHandler(t, fetchApp(remote.URL, cache, false))

	rec := get(h, "/api/fetch/volume/x-ray/1ABC")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "2Fo-Fc") || rec.Header().Get("X-Proteoscope-Volume-Server") != "pdbe" {
		t.Fatalf("header: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}
	headers := []struct {
		id     string
		status int
		server string
	}{
		{"2abc", http.StatusNotFound, ""},   // no map at PDBe or RCSB
		{"3abc", http.StatusOK, "rcsb"},     // not at PDBe, but at RCSB
		{"4abc", http.StatusNotFound, ""},   // PDBe's 404 stands when RCSB is down
		{"5abc", http.StatusOK, "rcsb"},     // PDBe down, RCSB answers
		{"6abc", http.StatusBadGateway, ""}, // a header without isAvailable
	}
	for _, item := range headers {
		rec := get(h, "/api/fetch/volume/x-ray/"+item.id)
		if rec.Code != item.status || rec.Header().Get("X-Proteoscope-Volume-Server") != item.server {
			t.Errorf("header %s: %d (server %q), want %d (%q): %s", item.id, rec.Code, rec.Header().Get("X-Proteoscope-Volume-Server"), item.status, item.server, rec.Body.String())
		}
	}
	if rec := get(h, "/api/fetch/volume/x-ray/4abc"); !strings.Contains(rec.Body.String(), "No map is available for 4ABC") {
		t.Errorf("PDBe's 404 message: %q", rec.Body.String())
	}

	box := get(h, "/api/fetch/volume/x-ray/1abc/box?min=1.5,-2,3&max=11.5,8,13&detail=3")
	if box.Code != http.StatusOK || string(box.Body.Bytes()) != string(good) || box.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("box: %d %q", box.Code, box.Header().Get("Content-Type"))
	}
	if again := get(h, "/api/fetch/volume/x-ray/1abc/box?min=1.5,-2,3&max=11.5,8,13&detail=3"); again.Header().Get("X-Proteoscope-Cache") != "hit" {
		t.Fatalf("a repeated box should come from the cache, got %q", again.Header().Get("X-Proteoscope-Cache"))
	}
	if files, _ := filepath.Glob(filepath.Join(cache, "volume-box", "box-*.bcif")); len(files) != 1 {
		t.Fatalf("boxes are cached as their own kind: %v", files)
	}
	before := len(remote.requests())
	pinned := get(h, "/api/fetch/volume/x-ray/1abc/box?min=1.5,-2,3&max=11.5,8,13&detail=3&server=rcsb")
	if pinned.Code != http.StatusOK || !slices.Equal(remote.requests()[before:], []string{"/x-ray/1abc/box/1.5,-2,3/11.5,8,13"}) {
		t.Fatalf("server=rcsb: %d, requests %v", pinned.Code, remote.requests()[before:])
	}

	// Errors the server sends with HTTP 200 are errors, and are not cached.
	for range 2 {
		rec := get(h, "/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=500,500,500&detail=1")
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "too big") || rec.Header().Get("X-Proteoscope-Cache") == "hit" {
			t.Fatalf("too big: %d %q", rec.Code, rec.Body.String())
		}
	}
	if rec := get(h, "/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=10,10,10&detail=1"); rec.Code != http.StatusOK || rec.Header().Get("X-Proteoscope-Source") != remote.URL+"/x-ray/1abc/box/0,0,0/10,10,10?detail=1&encoding=bcif" {
		t.Fatalf("a PDBe error falls back to RCSB: %d %v", rec.Code, rec.Header())
	}
	if rec := get(h, "/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=20,20,20&detail=1"); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not BinaryCIF") {
		t.Fatalf("HTML with 200: %d %q", rec.Code, rec.Body.String())
	}

	if cell := get(h, "/api/fetch/volume/em/EMD-1234/cell?detail=5"); cell.Code != http.StatusOK || string(cell.Body.Bytes()) != string(good) {
		t.Fatalf("cell with fallback: %d", cell.Code)
	}
	if rec := get(h, "/api/fetch/emdb/emd-1234"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "0.136") {
		t.Fatalf("emdb: %d %q", rec.Code, rec.Body.String())
	}
	if rec := get(h, "/api/fetch/emdb/EMD-9999"); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "EMDB has no entry EMD-9999") {
		t.Fatalf("missing EMDB entry: %d %q", rec.Code, rec.Body.String())
	}
	for _, path := range []string{
		"/api/fetch/volume/neutron/1abc",
		"/api/fetch/volume/x-ray/12345",
		"/api/fetch/volume/em/1abc",
		"/api/fetch/volume/x-ray/1abc/box?min=1,2&max=3,4,5&detail=1",
		"/api/fetch/volume/x-ray/1abc/box?min=1,2,3&max=0,4,5&detail=1",
		"/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=601,1,1&detail=1",
		"/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=1,1,1&detail=9",
		"/api/fetch/volume/x-ray/1abc/box?min=NaN,0,0&max=1,1,1&detail=1",
		"/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=1,1,1&detail=1&server=elsewhere",
		"/api/fetch/volume/em/emd-1234/cell?detail=x",
		"/api/fetch/emdb/abc",
	} {
		if rec := get(h, path); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", path, rec.Code)
		}
	}

	offline := testHandler(t, fetchApp(remote.URL, cache, true))
	if rec := get(offline, "/api/fetch/volume/x-ray/1abc"); rec.Code != http.StatusOK || rec.Header().Get("X-Proteoscope-Volume-Server") != "pdbe" {
		t.Fatalf("offline with a cached header: %d %v", rec.Code, rec.Header())
	}
	if rec := get(offline, "/api/fetch/volume/x-ray/9abc"); rec.Code != http.StatusForbidden {
		t.Fatalf("offline without a cached header: %d", rec.Code)
	}
}

func TestVolumeServerErrorDecoding(t *testing.T) {
	if message, failed := volumeServerError(volumeAnswer("yes", "Error: The query box volume is too big.")); !failed || message != "The query box volume is too big." {
		t.Fatalf("error answer: %q %v", message, failed)
	}
	if _, failed := volumeServerError(volumeAnswer("no", "")); failed {
		t.Fatal("a normal answer was taken for an error")
	}
	// Truncated or corrupt answers are rejected without panicking.
	answer := volumeAnswer("no", "")
	for length := range len(answer) {
		if _, failed := volumeServerError(answer[:length]); !failed {
			t.Fatalf("an answer cut at %d bytes was accepted", length)
		}
	}
	for _, body := range [][]byte{nil, []byte("{}"), {0xdf, 0xff, 0xff, 0xff, 0xff}, {0x81, 0xdd, 0xff, 0xff, 0xff, 0xff}} {
		if _, failed := volumeServerError(body); !failed {
			t.Errorf("%x was accepted", body)
		}
	}
}

func TestCacheLimit(t *testing.T) {
	c := &diskCache{dir: t.TempDir()}
	for index, name := range []string{"a", "b", "c", "d"} {
		c.store("volume-box", name+".bcif", payload{body: make([]byte, 100), contentType: "application/octet-stream"})
		// Older files first: a, then b, c and d.
		when := time.Now().Add(time.Duration(index-10) * time.Minute)
		os.Chtimes(filepath.Join(c.dir, "volume-box", name+".bcif"), when, when)
	}
	c.limit("volume-box", 250)
	for name, kept := range map[string]bool{"a": false, "b": false, "c": true, "d": true} {
		_, ok, _ := c.load("volume-box", name+".bcif")
		_, metaErr := os.Stat(filepath.Join(c.dir, "volume-box", name+".bcif.meta.json"))
		if ok != kept || (metaErr == nil) != kept {
			t.Errorf("%s: kept %v (meta %v), want %v", name, ok, metaErr == nil, kept)
		}
	}
	// Checked at most once a minute.
	c.store("volume-box", "e.bcif", payload{body: make([]byte, 400), contentType: "application/octet-stream"})
	c.limit("volume-box", 250)
	if _, ok, _ := c.load("volume-box", "c.bcif"); !ok {
		t.Error("the limit was applied twice within a minute")
	}
	var nilCache *diskCache
	nilCache.limit("volume-box", 0)
}

func TestVolumeRegionTooLarge(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		w.Write(make([]byte, 4096))
	})
	a := fetchApp(remote.URL, t.TempDir(), false)
	a.remote.maxBytes = 1024
	h := testHandler(t, a)
	rec := get(h, "/api/fetch/volume/x-ray/1abc/box?min=0,0,0&max=500,500,500&detail=4")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "choose a smaller region") {
		t.Fatalf("too large: %d %q", rec.Code, rec.Body.String())
	}
	if requests := remote.requests(); len(requests) != 1 || !strings.HasPrefix(requests[0], "/pdbe/") {
		t.Fatalf("a region too large is not asked of the second server: %v", requests)
	}
}
