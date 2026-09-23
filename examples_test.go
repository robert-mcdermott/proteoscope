package main

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

const testCIF = "data_1XYZ\n_entry.id 1XYZ\n_struct.title 'Test complex'\n_exptl.method 'X-RAY DIFFRACTION'\n" +
	"loop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n" +
	"_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n" +
	"_atom_site.auth_seq_id\n_atom_site.auth_asym_id\n_atom_site.pdbx_PDB_model_num\n" +
	"ATOM 1 N N GLY A 1 0.0 0.0 0.0 1 A 1\nATOM 2 C CA GLY A 1 1.4 0.0 0.0 1 A 1\n"

func gzipped(t *testing.T, text string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func exampleAssets(t *testing.T, manifest string) fstest.MapFS {
	assets := testAssets()
	assets["data/1xyz.cif.gz"] = &fstest.MapFile{Data: gzipped(t, testCIF)}
	assets["data/1xyz-pae.json.gz"] = &fstest.MapFile{Data: gzipped(t, `[{"predicted_aligned_error":[[0]]}]`)}
	assets["data/examples.json"] = &fstest.MapFile{Data: []byte(manifest)}
	return assets
}

func TestExamplesFollowTheManifest(t *testing.T) {
	assets := exampleAssets(t, `{"examples":[{"id":"XYZ","file":"1xyz.cif.gz","pae":"1xyz-pae.json.gz","label":"A test complex","category":"Tests","description":"Two atoms.","view":["focus /A"],"credit":"Nobody, 2026","accession":"P12345"}]}`)
	samples, err := loadSamples(assets)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 2 {
		t.Fatalf("samples = %+v, want the listed example then 1abc.pdb", samples)
	}
	first := samples[0]
	if first.ID != "xyz" || first.URL != "/data/1xyz.cif" || first.PAE != "/data/1xyz-pae.json" || first.Name != "XYZ" {
		t.Fatalf("listed example = %+v", first)
	}
	if first.Label != "A test complex" || first.Category != "Tests" || first.Description != "Two atoms." || first.Credit != "Nobody, 2026" || first.Accession != "P12345" {
		t.Fatalf("manifest fields = %+v", first)
	}
	if len(first.View) != 1 || first.View[0] != "focus /A" || first.Title != "XYZ: A test complex" || first.SizeBytes != len(testCIF) {
		t.Fatalf("view %v, title %q, size %d", first.View, first.Title, first.SizeBytes)
	}
	if first.Atoms != 0 {
		t.Fatalf("listed examples are not parsed at startup, but counted %d atoms", first.Atoms)
	}
	if samples[1].ID != "1abc" || samples[1].URL != "/data/1abc.pdb" || samples[1].Category != "" || samples[1].Atoms == 0 {
		t.Fatalf("unlisted file = %+v", samples[1])
	}

	for _, manifest := range []string{
		`{"examples":[{"file":"missing.cif.gz"}]}`,
		`{"examples":[{"file":"1xyz.cif.gz","pae":"missing.json"}]}`,
		`{"examples":[{"file":"1xyz.cif.gz"},{"file":"1xyz.cif.gz"}]}`,
		`{"examples":[{"file":"../web/app.js"}]}`,
		`{"examples":`,
	} {
		if _, err := loadSamples(exampleAssets(t, manifest)); err == nil {
			t.Errorf("manifest %s: expected an error", manifest)
		}
	}
}

func TestDataHandlerServesCompressedExamples(t *testing.T) {
	h := testHandler(t, &app{assets: exampleAssets(t, `{"examples":[{"file":"1xyz.cif.gz"}]}`)})

	req := httptest.NewRequest(http.MethodGet, "/data/1xyz.cif", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	rec := serve(h, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("gzip client: status %d, headers %v", rec.Code, rec.Header())
	}
	body, err := gunzipBytes(rec.Body.Bytes())
	if err != nil || string(body) != testCIF {
		t.Fatalf("gzip client body: %q, %v", body, err)
	}

	rec = get(h, "/data/1xyz.cif")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Encoding") != "" || rec.Body.String() != testCIF {
		t.Fatalf("plain client: status %d, encoding %q, body %q", rec.Code, rec.Header().Get("Content-Encoding"), rec.Body)
	}
	if got := rec.Header().Get("Content-Type"); got != textContentType {
		t.Fatalf("Content-Type = %q", got)
	}

	rec = get(h, "/data/1xyz-pae.json")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != jsonContentType || !strings.Contains(rec.Body.String(), "predicted_aligned_error") {
		t.Fatalf("PAE: status %d, Content-Type %q, body %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	head := serve(h, httptest.NewRequest(http.MethodHead, "/data/1xyz.cif", nil))
	if head.Code != http.StatusOK || head.Body.Len() != 0 || head.Header().Get("Content-Length") == "" {
		t.Fatalf("HEAD: status %d, body %d bytes, length %q", head.Code, head.Body.Len(), head.Header().Get("Content-Length"))
	}
	for _, target := range []string{"/data/1xyz.cif.gz", "/data/1abc.pdb"} {
		if rec := get(h, target); rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", target, rec.Code)
		}
	}

	// The listing accepts a .GZ suffix in any case; so does serving.
	assets := exampleAssets(t, `{"examples":[]}`)
	assets["data/2xyz.cif.GZ"] = &fstest.MapFile{Data: gzipped(t, testCIF)}
	upper := testHandler(t, &app{assets: assets})
	if rec := get(upper, "/data/2xyz.cif"); rec.Code != http.StatusOK || rec.Body.String() != testCIF {
		t.Fatalf(".GZ file: status %d", rec.Code)
	}
	for _, target := range []string{"/data/missing.cif", "/data/../web/app.js"} {
		if rec := get(h, target); rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "export") {
			t.Fatalf("%s escaped data/", target)
		} else if target == "/data/missing.cif" && rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status %d", target, rec.Code)
		}
	}
}

func TestAcceptsGzip(t *testing.T) {
	for header, want := range map[string]bool{
		"":                       false,
		"gzip":                   true,
		"GZIP":                   true,
		"deflate, gzip;q=0.5":    true,
		"br, *":                  true,
		"gzip;q=0":               false,
		"gzip;q=0, *":            false,
		"*;q=0":                  false,
		"identity":               false,
		"x-gzip":                 false,
		" gzip ; q = 0.001 , br": true,
	} {
		if got := acceptsGzip(header); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}

// Every bundled example parses, is described, and opens where its view expects.
func TestBundledExamples(t *testing.T) {
	samples, err := loadSamples(content)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := readExampleManifest(content)
	if err != nil || len(manifest) == 0 {
		t.Fatalf("manifest: %d entries, %v", len(manifest), err)
	}
	if len(samples) != len(manifest) {
		t.Fatalf("%d samples for %d manifest entries: every file in data/ should be described", len(samples), len(manifest))
	}
	h := testHandler(t, &app{assets: content})
	pae := 0
	for _, item := range samples {
		if item.Label == "" || item.Category == "" || item.Description == "" || item.Credit == "" {
			t.Errorf("%s is not fully described: %+v", item.ID, item)
		}
		// Startup skips parsing the examples, so check here that each one decompresses and parses.
		described, err := readSample(content, strings.TrimPrefix(item.URL, "/data/")+".gz")
		if err != nil || described.Atoms == 0 || described.Chains == 0 || described.SizeBytes != item.SizeBytes || !strings.HasSuffix(item.URL, ".cif") {
			t.Errorf("%s: %v, %d atoms, %d chains, %d bytes (manifest size %d), URL %s", item.ID, err, described.Atoms, described.Chains, described.SizeBytes, item.SizeBytes, item.URL)
		}
		if item.PAE != "" {
			pae++
			if rec := get(h, item.PAE); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "predicted_aligned_error") {
				t.Errorf("%s PAE %s: status %d", item.ID, item.PAE, rec.Code)
			}
		}
		for _, command := range item.View {
			if strings.TrimSpace(command) == "" {
				t.Errorf("%s has an empty view command", item.ID)
			}
		}
	}
	if pae != 1 {
		t.Errorf("%d examples with PAE, want the AlphaFold model", pae)
	}
	first := get(h, samples[0].URL)
	if first.Code != http.StatusOK || first.Body.Len() != samples[0].SizeBytes || !strings.HasPrefix(first.Body.String(), "data_") {
		t.Fatalf("%s: status %d, %d bytes of %d", samples[0].URL, first.Code, first.Body.Len(), samples[0].SizeBytes)
	}
}
