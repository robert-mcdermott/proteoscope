package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadLocalFilesSkipsInvalidPaths(t *testing.T) {
	dir := t.TempDir()
	plain := writeTestFile(t, dir, "one.pdb", []byte(testPDB))
	compressed := writeTestFile(t, dir, "two.CIF.gz", gzipBytes(t, "data_TWO\n"))
	notes := writeTestFile(t, dir, "notes.txt", []byte("not a structure"))
	folder := filepath.Join(dir, "folder.pdb")
	if err := os.Mkdir(folder, 0o755); err != nil {
		t.Fatal(err)
	}

	files := loadLocalFiles([]string{plain, filepath.Join(dir, "missing.pdb"), notes, folder, compressed})
	if len(files) != 2 {
		t.Fatalf("files = %+v, want 2 entries", files)
	}
	info, err := os.Stat(compressed)
	if err != nil {
		t.Fatal(err)
	}
	want := []localFile{
		{Name: "one.pdb", URL: "/api/local/0", Size: int64(len(testPDB)), path: plain},
		{Name: "two.CIF", URL: "/api/local/1", Size: info.Size(), path: compressed},
	}
	for i := range want {
		if files[i] != want[i] {
			t.Errorf("files[%d] = %+v, want %+v", i, files[i], want[i])
		}
	}
}

func TestServeLocalFiles(t *testing.T) {
	const cif = "data_TWO\n_entry.id TWO\n"
	dir := t.TempDir()
	plain := writeTestFile(t, dir, "one.pdb", []byte(testPDB))
	compressed := writeTestFile(t, dir, "two.cif.gz", gzipBytes(t, cif))
	h := testHandler(t, &app{files: loadLocalFiles([]string{plain, compressed})})

	rec := get(h, "/api/local/0")
	if rec.Code != http.StatusOK || rec.Body.String() != testPDB {
		t.Fatalf("plain file: status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"Content-Type":           "text/plain; charset=utf-8",
		"X-Proteoscope-Filename": "one.pdb",
		"Cache-Control":          "no-store",
	})

	rec = get(h, "/api/local/1")
	if rec.Code != http.StatusOK || rec.Body.String() != cif {
		t.Fatalf("gzip file: status %d body %q", rec.Code, rec.Body)
	}
	assertHeaders(t, rec, map[string]string{
		"Content-Type":           "text/plain; charset=utf-8",
		"X-Proteoscope-Filename": "two.cif",
	})

	for _, target := range []string{"/api/local/2", "/api/local/-1", "/api/local/01", "/api/local/+1", "/api/local/one.pdb", "/api/local/"} {
		if rec := get(h, target); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", target, rec.Code)
		}
	}

	if err := os.Remove(plain); err != nil {
		t.Fatal(err)
	}
	if rec := get(h, "/api/local/0"); rec.Code != http.StatusNotFound {
		t.Errorf("deleted file: status %d, want 404", rec.Code)
	}
}

func TestServeLocalRejectsCorruptGzip(t *testing.T) {
	dir := t.TempDir()
	corrupt := gzipBytes(t, strings.Repeat("ATOM\n", 100))
	corrupt = corrupt[:len(corrupt)-6]
	file := writeTestFile(t, dir, "broken.pdb.gz", corrupt)
	rec := get(testHandler(t, &app{files: loadLocalFiles([]string{file})}), "/api/local/0")
	if rec.Code != http.StatusUnprocessableEntity || errorMessage(t, rec) == "" {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
}

func TestStartupInfo(t *testing.T) {
	files := []localFile{{Name: "one.pdb", URL: "/api/local/0", Size: 12, path: "/private/one.pdb"}}
	rec := get(testHandler(t, &app{offline: true, files: files}), "/api/startup")
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("status %d Content-Type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var info map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"version":       version,
		"offline":       true,
		"remoteControl": false,
		"files":         []any{map[string]any{"name": "one.pdb", "url": "/api/local/0", "size": 12.0}},
	}
	if !jsonEqual(info, want) {
		t.Fatalf("startup = %v, want %v", info, want)
	}

	rec = get(testHandler(t, &app{}), "/api/startup")
	if !strings.Contains(rec.Body.String(), `"files": []`) || !strings.Contains(rec.Body.String(), `"offline": false`) {
		t.Fatalf("empty startup = %s", rec.Body)
	}
}

func jsonEqual(a, b any) bool {
	left, errA := json.Marshal(a)
	right, errB := json.Marshal(b)
	return errA == nil && errB == nil && string(left) == string(right)
}

func TestLoadLocalFolders(t *testing.T) {
	dir := t.TempDir()
	job := filepath.Join(dir, "job")
	writeTestFile(t, job, "job_model.cif", []byte("data_job\n"))
	writeTestFile(t, job, "job_summary_confidences.json", []byte("{}"))
	writeTestFile(t, filepath.Join(job, "seed-1_sample-0"), "model.cif.gz", gzipBytes(t, "data_s\n"))
	writeTestFile(t, filepath.Join(job, ".cache"), "hidden.cif", []byte("data_h\n"))
	writeTestFile(t, job, "notes.txt", []byte("skip"))
	single := writeTestFile(t, dir, "fold_x.zip", []byte("PK"))

	files := loadLocalFiles([]string{job, single})
	var paths []string
	for _, file := range files {
		paths = append(paths, file.Path+"|"+file.Name+"|"+file.URL)
	}
	want := []string{
		"job/job_model.cif|job_model.cif|/api/local/0",
		"job/job_summary_confidences.json|job_summary_confidences.json|/api/local/1",
		"job/seed-1_sample-0/model.cif|model.cif|/api/local/2",
		"|fold_x.zip|/api/local/3",
	}
	if strings.Join(paths, "\n") != strings.Join(want, "\n") {
		t.Fatalf("files:\n%s\nwant:\n%s", strings.Join(paths, "\n"), strings.Join(want, "\n"))
	}
	h := testHandler(t, &app{files: files})
	if rec := get(h, "/api/local/2"); rec.Code != http.StatusOK || rec.Body.String() != "data_s\n" {
		t.Fatalf("gzipped folder member: status %d body %q", rec.Code, rec.Body)
	}
}
