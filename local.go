package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// A file named on the command line, or one found in a folder named there (a prediction output
// folder, for example). Path keeps the folder-relative location so the page can group the files.
type localFile struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Size int64  `json:"size"`
	Path string `json:"path,omitempty"`
	path string
}

const maxFolderFiles = 4000

type startupInfo struct {
	Version       string      `json:"version"`
	Offline       bool        `json:"offline"`
	RemoteControl bool        `json:"remoteControl"`
	Files         []localFile `json:"files"`
}

func loadLocalFiles(paths []string) []localFile {
	files := []localFile{}
	for _, name := range paths {
		if info, err := os.Stat(name); err == nil && info.IsDir() {
			files = append(files, localFolder(name, len(files))...)
			continue
		}
		file, err := localStructure(name, len(files))
		if err != nil {
			log.Printf("skipping %s: %v", name, err)
			continue
		}
		files = append(files, file)
	}
	return files
}

// Collects the structures and confidence files of a folder (and its subfolders), skipping hidden
// entries, so "proteoscope af3_output/job/" opens a whole prediction.
func localFolder(dir string, start int) []localFile {
	abs, err := filepath.Abs(dir)
	if err != nil {
		log.Printf("skipping %s: %v", dir, err)
		return nil
	}
	parent := filepath.Dir(abs)
	var files []localFile
	filepath.WalkDir(abs, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if strings.HasPrefix(entry.Name(), ".") && path != abs {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() || !isLocalFile(entry.Name()) {
			return nil
		}
		if len(files) >= maxFolderFiles {
			return filepath.SkipAll
		}
		file, err := localStructure(path, start+len(files))
		if err != nil {
			return nil
		}
		if rel, err := filepath.Rel(parent, path); err == nil {
			file.Path = trimGzip(filepath.ToSlash(rel))
		}
		files = append(files, file)
		return nil
	})
	if len(files) >= maxFolderFiles {
		log.Printf("%s: only the first %d files are served", dir, maxFolderFiles)
	}
	return files
}

// Structures plus the files predictors write next to them: confidence JSON, NumPy arrays,
// alignments, ranking tables, BinaryCIF and ZIP archives (AlphaFold Server downloads).
func isLocalFile(name string) bool {
	base := trimGzip(name)
	if isStructureFile(base) {
		return true
	}
	switch strings.ToLower(filepath.Ext(base)) {
	case ".bcif", ".json", ".npz", ".npy", ".a3m", ".csv", ".zip":
		return true
	default:
		return false
	}
}

func localStructure(name string, index int) (localFile, error) {
	if !isLocalFile(name) {
		return localFile{}, errors.New("unsupported file type (expected .pdb, .cif, .bcif, .json, .zip … optionally .gz, or a folder)")
	}
	abs, err := filepath.Abs(name)
	if err != nil {
		return localFile{}, err
	}
	info, err := os.Stat(abs)
	if errors.Is(err, fs.ErrNotExist) {
		return localFile{}, errors.New("file not found")
	}
	if err != nil {
		return localFile{}, err
	}
	if !info.Mode().IsRegular() {
		return localFile{}, errors.New("not a regular file")
	}
	return localFile{
		Name: trimGzip(filepath.Base(abs)),
		URL:  "/api/local/" + strconv.Itoa(index),
		Size: info.Size(),
		path: abs,
	}, nil
}

func isGzipName(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".gz")
}

func trimGzip(name string) string {
	if isGzipName(name) {
		return name[:len(name)-len(".gz")]
	}
	return name
}

func (a *app) serveStartup(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, startupInfo{Version: version, Offline: a.offline, RemoteControl: a.control != nil, Files: a.files})
}

func (a *app) serveLocal(w http.ResponseWriter, r *http.Request) {
	file, ok := a.localFileAt(r.PathValue("index"))
	if !ok {
		writeError(w, http.StatusNotFound, "No local file with that index.")
		return
	}
	f, info, err := openRegular(file.path)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Sprintf("%s can no longer be read: %v", file.Name, err))
		return
	}
	defer f.Close()
	if !isGzipName(file.path) {
		setLocalHeaders(w, file.Name)
		http.ServeContent(w, r, "", info.ModTime(), f)
		return
	}
	body, err := readGzipFile(f)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("Could not decompress %s: %v", filepath.Base(file.path), err))
		return
	}
	setLocalHeaders(w, file.Name)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Write(body)
}

func (a *app) localFileAt(raw string) (localFile, bool) {
	index, err := strconv.Atoi(raw)
	if err != nil || index < 0 || index >= len(a.files) || strconv.Itoa(index) != raw {
		return localFile{}, false
	}
	return a.files[index], true
}

func openRegular(name string) (*os.File, fs.FileInfo, error) {
	f, err := os.Open(name)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err == nil && !info.Mode().IsRegular() {
		err = errors.New("not a regular file")
	}
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	return f, info, nil
}

func readGzipFile(r io.Reader) ([]byte, error) {
	body, err := decompressIfGzip(r)
	if err != nil {
		return nil, err
	}
	return readLimited(body, maxDownloadBytes)
}

func setLocalHeaders(w http.ResponseWriter, name string) {
	w.Header().Set("Content-Type", textContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Proteoscope-Filename", name)
}
