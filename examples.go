package main

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// The bundled examples are gzipped mmCIF files in data/, described by data/examples.json: an id
// (shown upper-cased as the example's name), a menu label, a category, a description, a credit,
// and the commands that set up each example's opening view. Structure files in data/ that the manifest does not list are still offered, after the
// listed ones, so a file dropped into data/ in --dev mode shows up.

const exampleManifestPath = "data/examples.json"

type exampleManifest struct {
	Examples []exampleEntry `json:"examples"`
}

type exampleEntry struct {
	ID          string   `json:"id"`
	File        string   `json:"file"`
	PAE         string   `json:"pae"`
	Accession   string   `json:"accession"`
	Label       string   `json:"label"`
	Category    string   `json:"category"`
	Description string   `json:"description"`
	View        []string `json:"view"`
	Credit      string   `json:"credit"`
}

func readExampleManifest(fsys fs.FS) ([]exampleEntry, error) {
	body, err := fs.ReadFile(fsys, exampleManifestPath)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var manifest exampleManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, fmt.Errorf("%s: %w", exampleManifestPath, err)
	}
	return manifest.Examples, nil
}

func loadSamples(fsys fs.FS) ([]sample, error) {
	manifest, err := readExampleManifest(fsys)
	if err != nil {
		return nil, err
	}
	listed := map[string]bool{}
	seen := map[string]bool{}
	var samples []sample
	for _, entry := range manifest {
		item, err := listedSample(fsys, entry)
		if err != nil {
			return nil, fmt.Errorf("%s lists %s: %w", exampleManifestPath, entry.File, err)
		}
		if seen[item.ID] {
			return nil, fmt.Errorf("%s lists the example id %q twice", exampleManifestPath, item.ID)
		}
		seen[item.ID] = true
		listed[entry.File] = true
		if entry.PAE != "" {
			if _, err := fs.Stat(fsys, "data/"+entry.PAE); err != nil {
				return nil, fmt.Errorf("%s lists %s: %w", exampleManifestPath, entry.PAE, err)
			}
			listed[entry.PAE] = true
			item.PAE = "/data/" + trimGzip(entry.PAE)
		}
		item.Accession = entry.Accession
		item.Label = entry.Label
		item.Category = entry.Category
		item.Description = entry.Description
		item.View = entry.View
		item.Credit = entry.Credit
		samples = append(samples, item)
	}

	entries, err := fs.ReadDir(fsys, "data")
	if err != nil {
		return nil, err
	}
	var others []sample
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || listed[name] || !isStructureFile(trimGzip(name)) {
			continue
		}
		item, err := readSample(fsys, name)
		if err != nil {
			return nil, err
		}
		if seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		others = append(others, item)
	}
	sort.Slice(others, func(i, j int) bool { return others[i].ID < others[j].ID })
	return append(samples, others...), nil
}

// A listed example is described by its manifest entry, so its file is checked but not parsed:
// parsing every example took most of the startup time. The size is the uncompressed size, read
// from the gzip trailer.
func listedSample(fsys fs.FS, entry exampleEntry) (sample, error) {
	name := entry.File
	if strings.Contains(name, "/") || !isStructureFile(trimGzip(name)) {
		return sample{}, fmt.Errorf("%q is not a structure file in data/", name)
	}
	body, err := fs.ReadFile(fsys, "data/"+name)
	if err != nil {
		return sample{}, err
	}
	size := len(body)
	if isGzipName(name) {
		if len(body) < 18 || body[0] != 0x1f || body[1] != 0x8b {
			return sample{}, errors.New("not a gzip file")
		}
		size = int(binary.LittleEndian.Uint32(body[len(body)-4:]))
	}
	plain := trimGzip(name)
	item := sample{ID: sampleID(plain), URL: "/data/" + plain, SizeBytes: size}
	if entry.ID != "" {
		item.ID = strings.ToLower(entry.ID)
	}
	item.Name = strings.ToUpper(item.ID)
	item.Title = item.Name
	if entry.Label != "" {
		item.Title += ": " + entry.Label
	}
	return item, nil
}

// Reads data/<name>, decompressing .gz files, and describes it from its contents (files that the
// manifest does not list). The URL names the uncompressed file, which dataHandler serves from the
// .gz copy.
func readSample(fsys fs.FS, name string) (sample, error) {
	if strings.Contains(name, "/") || !isStructureFile(trimGzip(name)) {
		return sample{}, fmt.Errorf("%q is not a structure file in data/", name)
	}
	body, err := readDataFile(fsys, "data/"+name)
	if err != nil {
		return sample{}, err
	}
	plain := trimGzip(name)
	item := parseSample(plain, string(body))
	item.ID = sampleID(plain)
	item.URL = "/data/" + plain
	item.SizeBytes = len(body)
	return item, nil
}

// "1m17.cif" → "1m17". Links and sessions saved when the examples were PDB files ("1m17.pdb")
// resolve through the same stem.
func sampleID(filename string) string {
	return strings.ToLower(strings.TrimSuffix(filename, filepath.Ext(filename)))
}

func readDataFile(fsys fs.FS, name string) ([]byte, error) {
	body, err := fs.ReadFile(fsys, name)
	if err != nil || !isGzipName(name) {
		return body, err
	}
	return gunzipBytes(body)
}

func gunzipBytes(data []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return readLimited(reader, maxDownloadBytes)
}

// Serves data/. A request for name.cif is answered from name.cif.gz when only the compressed copy
// exists: passed through with Content-Encoding when the client accepts gzip (browsers do), or
// decompressed here otherwise.
func dataHandler(fsys fs.FS) http.Handler {
	files := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" || name == "." {
			files.ServeHTTP(w, r)
			return
		}
		if _, err := fs.Stat(fsys, name); err == nil {
			files.ServeHTTP(w, r)
			return
		}
		body, err := gzipCopy(fsys, name)
		if err != nil {
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", dataContentType(name))
		w.Header().Add("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			w.Header().Set("Content-Encoding", "gzip")
		} else if body, err = gunzipBytes(body); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("Could not decompress %s: %v", name, err))
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		if r.Method != http.MethodHead {
			io.Copy(w, bytes.NewReader(body))
		}
	})
}

// The gzip copy of <name>, whatever the case of its .gz suffix (the listing accepts any).
func gzipCopy(fsys fs.FS, name string) ([]byte, error) {
	body, err := fs.ReadFile(fsys, name+".gz")
	if !errors.Is(err, fs.ErrNotExist) {
		return body, err
	}
	dir, base := path.Split(name)
	dir = strings.TrimSuffix(dir, "/")
	if dir == "" {
		dir = "."
	}
	entries, _ := fs.ReadDir(fsys, dir)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), base) && strings.EqualFold(entry.Name(), base+".gz") {
			return fs.ReadFile(fsys, path.Join(dir, entry.Name()))
		}
	}
	return nil, err
}

func dataContentType(name string) string {
	if strings.EqualFold(filepath.Ext(name), ".json") {
		return jsonContentType
	}
	return textContentType
}

// Whether an Accept-Encoding header allows gzip. An explicit "gzip" entry wins over "*", and q=0
// refuses.
func acceptsGzip(header string) bool {
	star := false
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(part, ";")
		coding := strings.ToLower(strings.TrimSpace(fields[0]))
		if coding != "gzip" && coding != "*" {
			continue
		}
		allowed := true
		for _, param := range fields[1:] {
			key, value, _ := strings.Cut(strings.TrimSpace(param), "=")
			if q, err := strconv.ParseFloat(strings.TrimSpace(value), 64); strings.EqualFold(strings.TrimSpace(key), "q") && err == nil && q == 0 {
				allowed = false
			}
		}
		if coding == "gzip" {
			return allowed
		}
		star = allowed
	}
	return star
}
