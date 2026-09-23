package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"testing/fstest"
)

const testPDB = "HEADER    TEST PROTEIN\n" +
	"ATOM      1  N   GLY A   1       0.000   0.000   0.000  1.00  0.00           N\n" +
	"END\n"

func TestStructureFileExtensions(t *testing.T) {
	for _, name := range []string{"1abc.pdb", "1abc.cif", "1abc.mmcif", "pdb1abc.ent", "1ABC.PDB"} {
		if !isStructureFile(name) {
			t.Fatalf("expected %s to be accepted", name)
		}
	}
	if isStructureFile("validation.pdf") {
		t.Fatal("PDF validation report should not be accepted as a structure file")
	}
	if isStructureFile("1abc.pdb.gz") {
		t.Fatal("compressed files are only accepted as command-line files, not samples")
	}
}

func TestParseCIFSample(t *testing.T) {
	const cif = `data_1ABC
_entry.id 1ABC
_struct.title
;Example structure
with multiline title
;
loop_
_exptl.method
'X-RAY DIFFRACTION'
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_atom_id
_atom_site.pdbx_PDB_model_num
ATOM 1 N N . GLY A 10 ? 1.0 2.0 3.0 1.00 10.0 10 GLY A N 1
ATOM 2 C CA B GLY A 10 ? 1.5 2.5 3.5 0.50 11.0 10 GLY A CA 1
HETATM 3 O O . HOH B . ? 4.0 5.0 6.0 1.00 20.0 301 HOH B O 1
ATOM 4 C CA . GLY A 10 ? 1.6 2.6 3.6 1.00 12.0 10 GLY A CA 2
`

	item := parseSample("1abc.cif", cif)
	if item.Name != "1ABC" {
		t.Fatalf("Name = %q, want 1ABC", item.Name)
	}
	if item.Title != "1ABC: Example structure with multiline title" {
		t.Fatalf("Title = %q", item.Title)
	}
	if item.Atoms != 3 {
		t.Fatalf("Atoms = %d, want 3", item.Atoms)
	}
	if item.Models != 2 {
		t.Fatalf("Models = %d, want 2", item.Models)
	}
	if item.Chains != 2 {
		t.Fatalf("Chains = %d, want 2", item.Chains)
	}
	if item.Residues != 2 {
		t.Fatalf("Residues = %d, want 2", item.Residues)
	}
	if item.Method != "X-RAY DIFFRACTION" {
		t.Fatalf("Method = %q", item.Method)
	}
}

func TestParseConfigAcceptsFlagsBetweenFiles(t *testing.T) {
	cfg, err := parseConfig([]string{"a.pdb", "--no-open", "--port", "9000", "b.cif.gz", "--offline", "--cache-dir", "cache", "--", "--odd.pdb"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"a.pdb", "b.cif.gz", "--odd.pdb"}; !reflect.DeepEqual(cfg.files, want) {
		t.Fatalf("files = %q, want %q", cfg.files, want)
	}
	if !cfg.noOpen || !cfg.offline || cfg.port != 9000 || cfg.cacheDir != "cache" || cfg.host != "127.0.0.1" || cfg.dev || cfg.noCache {
		t.Fatalf("unexpected config %+v", cfg)
	}

	cfg, err = parseConfig([]string{"--version", "--dev", "--no-cache"})
	if err != nil || !cfg.showVersion || !cfg.dev || !cfg.noCache || len(cfg.files) != 0 {
		t.Fatalf("unexpected config %+v (%v)", cfg, err)
	}
}

func TestEmbeddedAssetsExcludeTests(t *testing.T) {
	if _, err := fs.Stat(content, "web/app.test.mjs"); err == nil {
		t.Fatal("web/app.test.mjs must not be embedded")
	}
	libs, err := fs.Glob(content, "web/lib/*")
	if err != nil || len(libs) == 0 {
		t.Fatalf("expected embedded web/lib modules, got %v (%v)", libs, err)
	}
	for _, lib := range libs {
		if !strings.HasSuffix(lib, ".js") || strings.Contains(lib, ".test.") {
			t.Errorf("unexpected embedded file %s", lib)
		}
	}

	h := testHandler(t, &app{assets: content})
	rec := get(h, "/lib/"+path.Base(libs[0]))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/javascript; charset=utf-8" {
		t.Fatalf("lib module: status %d, Content-Type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestEmbeddedSamplesAndStaticRoutes(t *testing.T) {
	h := testHandler(t, &app{assets: content})
	samples := sampleList(t, h)
	if len(samples) == 0 {
		t.Fatal("expected embedded samples")
	}
	rec := get(h, samples[0].URL)
	if rec.Code != http.StatusOK || rec.Body.Len() != samples[0].SizeBytes {
		t.Fatalf("%s: status %d, %d bytes", samples[0].URL, rec.Code, rec.Body.Len())
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=3600" {
		t.Fatalf("data Cache-Control = %q", got)
	}

	rec = get(h, "/some/client/route")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("SPA fallback: status %d, Content-Type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if got := rec.Header().Get("Cache-Control"); got != "" {
		t.Fatalf("embedded web Cache-Control = %q, want none", got)
	}

	rec = get(h, "/api/does-not-exist")
	if rec.Code != http.StatusNotFound || errorMessage(t, rec) == "" {
		t.Fatalf("unknown API: status %d body %s", rec.Code, rec.Body)
	}
}

func TestDevModeServesFromDisk(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, dir, "web/index.html", []byte("<!doctype html><title>dev</title>"))
	writeTestFile(t, dir, "web/app.js", []byte("console.log(1);"))
	writeTestFile(t, dir, "data/1abc.pdb", []byte(testPDB))
	h := testHandler(t, &app{dev: true, assets: os.DirFS(dir)})

	rec := get(h, "/app.js")
	if rec.Body.String() != "console.log(1);" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("app.js: body %q, Cache-Control %q", rec.Body, rec.Header().Get("Cache-Control"))
	}
	writeTestFile(t, dir, "web/app.js", []byte("console.log(2);"))
	if rec := get(h, "/app.js"); rec.Body.String() != "console.log(2);" {
		t.Fatalf("edited app.js not served: %q", rec.Body)
	}

	if got := len(sampleList(t, h)); got != 1 {
		t.Fatalf("samples = %d, want 1", got)
	}
	writeTestFile(t, dir, "data/2xyz.cif", []byte("data_2XYZ\n_entry.id 2XYZ\n"))
	if got := len(sampleList(t, h)); got != 2 {
		t.Fatalf("samples after adding a file = %d, want 2", got)
	}
	rec = get(h, "/data/2xyz.cif")
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("dev data: status %d, Cache-Control %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
}

func testAssets() fstest.MapFS {
	return fstest.MapFS{
		"web/index.html": {Data: []byte("<!doctype html><title>Proteoscope</title>")},
		"web/app.js":     {Data: []byte("export {};\n")},
		"data/1abc.pdb":  {Data: []byte(testPDB)},
	}
}

func testHandler(t *testing.T, a *app) http.Handler {
	t.Helper()
	if a.assets == nil {
		a.assets = testAssets()
	}
	if a.files == nil {
		a.files = []localFile{}
	}
	h, err := a.handler()
	if err != nil {
		t.Fatalf("handler: %v", err)
	}
	return h
}

func get(h http.Handler, target string) *httptest.ResponseRecorder {
	return serve(h, httptest.NewRequest(http.MethodGet, target, nil))
}

func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func sampleList(t *testing.T, h http.Handler) []sample {
	t.Helper()
	var body struct {
		Samples []sample `json:"samples"`
	}
	rec := get(h, "/api/samples")
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode samples %q: %v", rec.Body, err)
	}
	return body.Samples
}

func errorMessage(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body, err)
	}
	return body.Error
}

func assertHeaders(t *testing.T, rec *httptest.ResponseRecorder, want map[string]string) {
	t.Helper()
	for key, value := range want {
		if got := rec.Header().Get(key); got != value {
			t.Errorf("%s = %q, want %q", key, got, value)
		}
	}
}

func writeTestFile(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	file := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return file
}

func gzipBytes(t *testing.T, text string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
