package main

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

type fakeRemote struct {
	*httptest.Server
	mu    sync.Mutex
	paths []string
}

func newFakeRemote(t *testing.T, handler http.HandlerFunc) *fakeRemote {
	t.Helper()
	remote := &fakeRemote{}
	remote.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remote.mu.Lock()
		remote.paths = append(remote.paths, r.URL.Path)
		remote.mu.Unlock()
		if got, want := r.Header.Get("User-Agent"), "Proteoscope/"+version+" (+local viewer)"; got != want {
			t.Errorf("User-Agent = %q, want %q", got, want)
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			t.Errorf("upstream request carried Origin %q", origin)
		}
		handler(w, r)
	}))
	t.Cleanup(remote.Close)
	return remote
}

func (f *fakeRemote) requests() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.paths...)
}

func fetchApp(base, cacheDir string, offline bool) *app {
	a := &app{
		offline: offline,
		remote:  &upstream{client: newUpstreamClient(), rcsb: base, afdb: base, uniprot: base, maxBytes: maxDownloadBytes},
	}
	if cacheDir != "" {
		a.cache = &diskCache{dir: cacheDir}
	}
	return a
}

func writeTestJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

func alphaFoldTestEntry(base, entryID string) map[string]any {
	return map[string]any{
		"entryId":                entryID,
		"uniprotAccession":       "P04637",
		"uniprotDescription":     "Cellular tumor antigen p53",
		"gene":                   "TP53",
		"organismScientificName": "Homo sapiens",
		"globalMetricValue":      75.06,
		"latestVersion":          6,
		"cifUrl":                 base + "/files/" + entryID + "-model_v6.cif",
		"pdbUrl":                 base + "/files/" + entryID + "-model_v6.pdb",
		"paeDocUrl":              base + "/files/" + entryID + "-predicted_aligned_error_v6.json",
	}
}

func alphaFoldRemote(t *testing.T, model, pae string) *fakeRemote {
	t.Helper()
	compressed := gzipBytes(t, model)
	return newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		switch r.URL.Path {
		case "/api/prediction/P04637":
			writeTestJSON(w, []map[string]any{
				alphaFoldTestEntry(base, "AF-P04637-2-F1"),
				alphaFoldTestEntry(base, "AF-P04637-F1"),
			})
		case "/files/AF-P04637-F1-model_v6.cif":
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(compressed)
		case "/files/AF-P04637-F1-predicted_aligned_error_v6.json":
			w.Write([]byte(pae))
		default:
			http.NotFound(w, r)
		}
	})
}

func TestNormalizePDBID(t *testing.T) {
	valid := map[string]string{
		"1crn":         "1CRN",
		"1CRN":         "1CRN",
		"4hHb":         "4HHB",
		"pdb_00004hhb": "pdb_00004hhb",
		"PDB_00004HHB": "pdb_00004hhb",
		"pdb_1234abcd": "pdb_1234abcd",
	}
	for raw, want := range valid {
		if got, ok := normalizePDBID(raw); !ok || got != want {
			t.Errorf("normalizePDBID(%q) = %q, %v; want %q", raw, got, ok, want)
		}
	}
	for _, raw := range []string{"", "crn1", "1cr", "1crnn", "1cr_", "1crn.cif", "1crn\n", "pdb_0004hhb", "pdb_000004hhb", "pdb-00004hhb", "../1crn"} {
		if got, ok := normalizePDBID(raw); ok {
			t.Errorf("normalizePDBID(%q) = %q, want rejection", raw, got)
		}
	}
}

func TestNormalizeAccession(t *testing.T) {
	valid := map[string]string{
		"P69905":     "P69905",
		"p69905":     "P69905",
		"Q9ZZZ9":     "Q9ZZZ9",
		"A2BC19":     "A2BC19",
		"A0A023GPI8": "A0A023GPI8",
		"P04637-2":   "P04637-2",
	}
	for raw, want := range valid {
		if got, ok := normalizeAccession(raw); !ok || got != want {
			t.Errorf("normalizeAccession(%q) = %q, %v; want %q", raw, got, ok, want)
		}
	}
	for _, raw := range []string{"", "P6990", "P699055", "69905P", "A0A023GPI", "P69905-", "P69905-x", "AF-P69905-F1", "P69905 ", "../P69905"} {
		if got, ok := normalizeAccession(raw); ok {
			t.Errorf("normalizeAccession(%q) = %q, want rejection", raw, got)
		}
	}
}

func TestFetchRejectsInvalidIDs(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected upstream request %s", r.URL)
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))
	for _, target := range []string{
		"/api/fetch/pdb/12345",
		"/api/fetch/pdb/abcd",
		"/api/fetch/pdb/..%2F1crn",
		"/api/fetch/afdb/NOTANID",
		"/api/fetch/afdb/P69905-x/pae",
		"/api/fetch/uniprot/P6990",
	} {
		rec := get(h, target)
		if rec.Code != http.StatusBadRequest || errorMessage(t, rec) == "" {
			t.Errorf("%s: status %d body %s", target, rec.Code, rec.Body)
		}
	}
}

func TestFetchPDBDecodesGzipDownload(t *testing.T) {
	const cif = "data_1ABC\n_entry.id 1ABC\n"
	compressed := gzipBytes(t, cif)
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/download/1ABC.cif.gz" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/gzip")
		w.Write(compressed)
	})
	rec := get(testHandler(t, fetchApp(remote.URL, "", false)), "/api/fetch/pdb/1abc")
	if rec.Code != http.StatusOK || rec.Body.String() != cif {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"Content-Type":           "text/plain; charset=utf-8",
		"X-Proteoscope-Filename": "1ABC.cif",
		"X-Proteoscope-Source":   remote.URL + "/download/1ABC.cif.gz",
		"X-Proteoscope-Cache":    "miss",
	})
}

func TestFetchPDBFallsBackToPlainCIF(t *testing.T) {
	const cif = "data_PDB_00004HHB\n"
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/download/pdb_00004hhb.cif" {
			http.NotFound(w, r)
			return
		}
		w.Write([]byte(cif))
	})
	rec := get(testHandler(t, fetchApp(remote.URL, "", false)), "/api/fetch/pdb/PDB_00004HHB")
	if rec.Code != http.StatusOK || rec.Body.String() != cif {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"X-Proteoscope-Filename": "pdb_00004hhb.cif",
		"X-Proteoscope-Source":   remote.URL + "/download/pdb_00004hhb.cif",
	})
	if got, want := remote.requests(), []string{"/download/pdb_00004hhb.cif.gz", "/download/pdb_00004hhb.cif"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("upstream requests = %q, want %q", got, want)
	}
}

func TestFetchPDBNotFound(t *testing.T) {
	remote := newFakeRemote(t, http.NotFound)
	rec := get(testHandler(t, fetchApp(remote.URL, "", false)), "/api/fetch/pdb/9zzz")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404", rec.Code)
	}
	if got := errorMessage(t, rec); got != "PDB entry 9ZZZ was not found at RCSB" {
		t.Fatalf("error = %q", got)
	}
}

func TestFetchUpstreamFailureIsBadGateway(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "maintenance", http.StatusServiceUnavailable)
	})
	rec := get(testHandler(t, fetchApp(remote.URL, "", false)), "/api/fetch/pdb/1abc")
	if rec.Code != http.StatusBadGateway || !strings.Contains(errorMessage(t, rec), "503") {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
}

func TestFetchAlphaFoldSelectsCanonicalEntry(t *testing.T) {
	const model = "data_AF-P04637-F1\n"
	const pae = `[{"predicted_aligned_error":[[0,1],[1,0]],"max_predicted_aligned_error":31.75}]`
	remote := alphaFoldRemote(t, model, pae)
	h := testHandler(t, fetchApp(remote.URL, "", false))

	rec := get(h, "/api/fetch/afdb/p04637")
	if rec.Code != http.StatusOK || rec.Body.String() != model {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"Content-Type":           "text/plain; charset=utf-8",
		"X-Proteoscope-Filename": "AF-P04637-F1-model_v6.cif",
		"X-Proteoscope-Source":   remote.URL + "/files/AF-P04637-F1-model_v6.cif",
		"X-Proteoscope-Pae":      "/api/fetch/afdb/P04637/pae",
	})
	raw, err := base64.StdEncoding.DecodeString(rec.Header().Get("X-Proteoscope-Meta-B64"))
	if err != nil {
		t.Fatalf("decode meta header: %v", err)
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatalf("meta JSON %q: %v", raw, err)
	}
	want := map[string]any{
		"entryId":                "AF-P04637-F1",
		"uniprotAccession":       "P04637",
		"uniprotDescription":     "Cellular tumor antigen p53",
		"gene":                   "TP53",
		"organismScientificName": "Homo sapiens",
		"globalMetricValue":      75.06,
		"latestVersion":          6.0,
	}
	if !reflect.DeepEqual(meta, want) {
		t.Fatalf("meta = %v, want %v", meta, want)
	}

	rec = get(h, "/api/fetch/afdb/P04637/pae")
	if rec.Code != http.StatusOK || rec.Body.String() != pae {
		t.Fatalf("PAE: status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"Content-Type":         "application/json",
		"X-Proteoscope-Source": remote.URL + "/files/AF-P04637-F1-predicted_aligned_error_v6.json",
	})
}

func TestFetchAlphaFoldRejectsForeignFileURLs(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/prediction/P04637" {
			t.Errorf("unexpected upstream request %s", r.URL)
			http.NotFound(w, r)
			return
		}
		writeTestJSON(w, []map[string]any{alphaFoldTestEntry("https://evil.example", "AF-P04637-F1")})
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))
	for _, target := range []string{"/api/fetch/afdb/P04637", "/api/fetch/afdb/P04637/pae"} {
		rec := get(h, target)
		if rec.Code != http.StatusBadGateway || !strings.Contains(errorMessage(t, rec), "outside") {
			t.Errorf("%s: status %d body %s", target, rec.Code, rec.Body)
		}
	}
}

func TestAlphaFoldFileURLValidation(t *testing.T) {
	remote := defaultUpstream()
	if _, err := remote.alphaFoldFileURL("https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif"); err != nil {
		t.Fatalf("valid AFDB URL rejected: %v", err)
	}
	for _, raw := range []string{
		"",
		"/files/AF-P69905-F1-model_v6.cif",
		"http://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v6.cif",
		"https://alphafold.ebi.ac.uk.evil.example/files/x.cif",
		"https://evil.example/alphafold.ebi.ac.uk/x.cif",
		"https://alphafold.ebi.ac.uk@evil.example/x.cif",
		"https://user@alphafold.ebi.ac.uk/x.cif",
		"https://alphafold.ebi.ac.uk:8443/x.cif",
	} {
		if _, err := remote.alphaFoldFileURL(raw); err == nil {
			t.Errorf("alphaFoldFileURL(%q) accepted", raw)
		}
	}
}

func TestSelectAlphaFoldEntryFallsBackToFirst(t *testing.T) {
	entries := []afdbEntry{
		{afdbMeta: afdbMeta{EntryID: "AF-P04637-2-F1"}},
		{afdbMeta: afdbMeta{EntryID: "AF-P04637-3-F1"}},
	}
	entry, err := selectAlphaFoldEntry(entries, "P04637")
	if err != nil || entry.EntryID != "AF-P04637-2-F1" {
		t.Fatalf("entry = %q, %v", entry.EntryID, err)
	}
	if _, err := selectAlphaFoldEntry(nil, "P04637"); err == nil {
		t.Fatal("empty prediction list should be an error")
	}
}

func TestFetchAlphaFoldUnknownAccession(t *testing.T) {
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("{}"))
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))
	for _, target := range []string{"/api/fetch/afdb/Q00000", "/api/fetch/afdb/Q00000/pae"} {
		rec := get(h, target)
		if rec.Code != http.StatusNotFound || !strings.Contains(errorMessage(t, rec), "Q00000") {
			t.Errorf("%s: status %d body %s", target, rec.Code, rec.Body)
		}
	}
}

func TestFetchUniProtPassesJSONThrough(t *testing.T) {
	const entry = `{"primaryAccession":"P69905","sequence":{"length":142},"features":[]}`
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/uniprotkb/P69905.json" {
			http.NotFound(w, r)
			return
		}
		if got := r.URL.Query().Get("fields"); got != uniprotFields {
			t.Errorf("fields = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(entry))
	})
	h := testHandler(t, fetchApp(remote.URL, "", false))

	rec := get(h, "/api/fetch/uniprot/p69905")
	if rec.Code != http.StatusOK || rec.Body.String() != entry {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"Content-Type":         "application/json",
		"X-Proteoscope-Source": remote.URL + "/uniprotkb/P69905.json?fields=" + uniprotFields,
	})

	rec = get(h, "/api/fetch/uniprot/O00000")
	if rec.Code != http.StatusNotFound || errorMessage(t, rec) != "UniProt accession O00000 was not found" {
		t.Fatalf("unknown accession: status %d body %s", rec.Code, rec.Body)
	}
}

func TestFetchCacheHit(t *testing.T) {
	const model = "data_AF-P04637-F1\n"
	remote := alphaFoldRemote(t, model, "[]")
	cacheDir := t.TempDir()
	h := testHandler(t, fetchApp(remote.URL, cacheDir, false))

	first := get(h, "/api/fetch/afdb/P04637")
	if first.Code != http.StatusOK || first.Header().Get("X-Proteoscope-Cache") != "miss" {
		t.Fatalf("first fetch: status %d cache %q", first.Code, first.Header().Get("X-Proteoscope-Cache"))
	}
	upstreamCalls := len(remote.requests())

	second := get(h, "/api/fetch/afdb/p04637")
	if second.Code != http.StatusOK || second.Body.String() != model {
		t.Fatalf("second fetch: status %d body %q", second.Code, second.Body)
	}
	if got := second.Header().Get("X-Proteoscope-Cache"); got != "hit" {
		t.Fatalf("X-Proteoscope-Cache = %q, want hit", got)
	}
	for _, key := range []string{"Content-Type", "X-Proteoscope-Filename", "X-Proteoscope-Source", "X-Proteoscope-Pae", "X-Proteoscope-Meta-B64"} {
		if got, want := second.Header().Get(key), first.Header().Get(key); got != want || got == "" {
			t.Errorf("cached %s = %q, want %q", key, got, want)
		}
	}
	if got := len(remote.requests()); got != upstreamCalls {
		t.Fatalf("cache hit contacted upstream (%d -> %d requests)", upstreamCalls, got)
	}
	if body, err := os.ReadFile(filepath.Join(cacheDir, "afdb", "P04637.cif")); err != nil || string(body) != model {
		t.Fatalf("cached model = %q, %v", body, err)
	}
}

func TestOfflineServesOnlyCachedEntries(t *testing.T) {
	const cif = "data_1ABC\n"
	compressed := gzipBytes(t, cif)
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/download/1ABC.cif.gz" {
			http.NotFound(w, r)
			return
		}
		w.Write(compressed)
	})
	cacheDir := t.TempDir()
	if rec := get(testHandler(t, fetchApp(remote.URL, cacheDir, false)), "/api/fetch/pdb/1ABC"); rec.Code != http.StatusOK {
		t.Fatalf("priming fetch: status %d body %s", rec.Code, rec.Body)
	}
	upstreamCalls := len(remote.requests())

	offline := testHandler(t, fetchApp(remote.URL, cacheDir, true))
	rec := get(offline, "/api/fetch/pdb/1abc")
	if rec.Code != http.StatusOK || rec.Body.String() != cif || rec.Header().Get("X-Proteoscope-Cache") != "hit" {
		t.Fatalf("offline cache hit: status %d body %q cache %q", rec.Code, rec.Body, rec.Header().Get("X-Proteoscope-Cache"))
	}
	for _, target := range []string{"/api/fetch/pdb/2XYZ", "/api/fetch/afdb/P69905", "/api/fetch/afdb/P69905/pae", "/api/fetch/uniprot/P69905"} {
		rec := get(offline, target)
		if rec.Code != http.StatusForbidden || errorMessage(t, rec) != offlineMessage {
			t.Errorf("%s: status %d body %s", target, rec.Code, rec.Body)
		}
	}
	if rec := get(testHandler(t, fetchApp(remote.URL, "", true)), "/api/fetch/pdb/1ABC"); rec.Code != http.StatusForbidden {
		t.Errorf("offline without cache: status %d", rec.Code)
	}
	if got := len(remote.requests()); got != upstreamCalls {
		t.Fatalf("offline mode contacted upstream (%d -> %d requests)", upstreamCalls, got)
	}
}

func TestFetchRejectsOversizedDownloads(t *testing.T) {
	large := strings.Repeat("A", 4096)
	compressed := gzipBytes(t, large)
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/download/1BIG.cif.gz":
			w.Write([]byte(large))
		case "/download/2BIG.cif.gz":
			w.Write(compressed)
		default:
			http.NotFound(w, r)
		}
	})
	a := fetchApp(remote.URL, "", false)
	a.remote.maxBytes = 1024
	h := testHandler(t, a)
	for _, target := range []string{"/api/fetch/pdb/1BIG", "/api/fetch/pdb/2BIG"} {
		rec := get(h, target)
		if rec.Code != http.StatusBadGateway || !strings.Contains(errorMessage(t, rec), "too large") {
			t.Errorf("%s: status %d body %s", target, rec.Code, rec.Body)
		}
	}
}

func TestFetchRefusesCrossHostRedirects(t *testing.T) {
	other := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("redirect target was contacted: %s", r.URL)
	})
	remote := newFakeRemote(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+r.URL.Path, http.StatusFound)
	})
	rec := get(testHandler(t, fetchApp(remote.URL, "", false)), "/api/fetch/pdb/1ABC")
	if rec.Code != http.StatusBadGateway || !strings.Contains(errorMessage(t, rec), "refusing redirect") {
		t.Fatalf("status %d body %s", rec.Code, rec.Body)
	}
}
