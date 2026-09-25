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
	// Opened by a script while running, rather than named on the command line: served only to
	// requests from this computer.
	runtime bool
}

const (
	// A design campaign can hold hundreds of prediction jobs of a dozen files each.
	maxFolderFiles = 20000
	// A folder walk stops after this many entries, so a path such as the home folder or a slow
	// network mount does not walk for ever.
	maxFolderEntries = 200000
)

type startupInfo struct {
	Version       string      `json:"version"`
	Offline       bool        `json:"offline"`
	RemoteControl bool        `json:"remoteControl"`
	Files         []localFile `json:"files"`
}

func loadLocalFiles(paths []string) []localFile {
	files, problems := collectLocalFiles(paths, 0)
	for _, problem := range problems {
		log.Print(problem)
	}
	return files
}

// collectLocalFiles lists the files of paths (files or folders), numbering them from start, and
// describes the paths it skipped or cut short.
func collectLocalFiles(paths []string, start int) ([]localFile, []string) {
	files := []localFile{}
	var problems []string
	for _, name := range paths {
		if info, err := os.Stat(name); err == nil && info.IsDir() {
			found, problem := localFolder(name, start+len(files))
			if problem != "" {
				problems = append(problems, problem)
			}
			if len(found) == 0 && problem == "" {
				problems = append(problems, fmt.Sprintf("skipping %s: no structure or prediction files in the folder", name))
			}
			files = append(files, found...)
			continue
		}
		file, err := localStructure(name, start+len(files))
		if err != nil {
			problems = append(problems, fmt.Sprintf("skipping %s: %v", name, err))
			continue
		}
		files = append(files, file)
	}
	return files, problems
}

// addLocalFiles makes more files available to the page while it runs, for remote control and
// the MCP server: a script on this computer names the paths, and the page opens them.
func (a *app) addLocalFiles(paths []string) ([]localFile, error) {
	if len(paths) == 0 {
		return nil, errors.New("name at least one file or folder")
	}
	expanded := make([]string, 0, len(paths))
	for _, name := range paths {
		name = strings.TrimSpace(name)
		if name == "~" || strings.HasPrefix(name, "~/") || strings.HasPrefix(name, `~\`) {
			if home, err := os.UserHomeDir(); err == nil {
				name = filepath.Join(home, name[1:])
			}
		}
		if !filepath.IsAbs(name) {
			return nil, fmt.Errorf("%s: use an absolute path", name)
		}
		expanded = append(expanded, name)
	}
	// The folders are walked before the list is locked, so the page keeps reading files meanwhile.
	found, problems := collectLocalFiles(expanded, 0)
	if len(found) == 0 {
		return nil, errors.New(strings.Join(problems, "; "))
	}
	for _, problem := range problems {
		log.Print(problem)
	}
	a.filesMu.Lock()
	defer a.filesMu.Unlock()
	if a.fileIndex == nil {
		a.fileIndex = map[string]int{}
		for index, file := range a.files {
			a.fileIndex[file.path] = index
		}
	}
	// A path opened again keeps its number, so repeated requests do not grow the list.
	files := make([]localFile, 0, len(found))
	for _, file := range found {
		index, known := a.fileIndex[file.path]
		if !known {
			index = len(a.files)
			a.fileIndex[file.path] = index
			file.URL = "/api/local/" + strconv.Itoa(index)
			file.runtime = true
			a.files = append(a.files, file)
		}
		registered := a.files[index]
		registered.Path = file.Path
		files = append(files, registered)
	}
	return files, nil
}

func (a *app) localFiles() []localFile {
	a.filesMu.RLock()
	defer a.filesMu.RUnlock()
	return a.files
}

// Collects the structures and confidence files of a folder (and its subfolders), skipping hidden
// entries, so "proteoscope af3_output/job/" opens a whole prediction. The second result says
// why the walk stopped early, if it did.
func localFolder(dir string, start int) ([]localFile, string) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, fmt.Sprintf("skipping %s: %v", dir, err)
	}
	parent := filepath.Dir(abs)
	var files []localFile
	visited := 0
	filepath.WalkDir(abs, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		visited++
		if visited > maxFolderEntries {
			return filepath.SkipAll
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
	switch {
	case len(files) >= maxFolderFiles:
		return files, fmt.Sprintf("%s: only the first %d files are served", dir, maxFolderFiles)
	case visited > maxFolderEntries:
		return files, fmt.Sprintf("%s: stopped after %d entries; name the prediction folders themselves", dir, maxFolderEntries)
	}
	return files, ""
}

// Structures plus the files predictors write next to them: confidence JSON, NumPy arrays,
// alignments, ranking tables, BinaryCIF and ZIP archives (AlphaFold Server downloads). Gzip files
// are decompressed here; Zstandard files (AlphaFold 3's --compress_large_output_files) are served
// as they are and decompressed by the page.
func isLocalFile(name string) bool {
	base := trimGzip(name)
	if strings.EqualFold(filepath.Ext(base), ".zst") {
		base = base[:len(base)-len(".zst")]
	}
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
		return localFile{}, errors.New("unsupported file type (expected .pdb, .cif, .bcif, .json, .zip … optionally .gz or .zst, or a folder)")
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
	writeJSON(w, startupInfo{Version: version, Offline: a.offline, RemoteControl: a.control != nil, Files: a.startupFiles})
}

func (a *app) serveLocal(w http.ResponseWriter, r *http.Request) {
	file, ok := a.localFileAt(r.PathValue("index"))
	if ok && file.runtime && !isLoopbackRequest(r) {
		ok = false
	}
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
	files := a.localFiles()
	index, err := strconv.Atoi(raw)
	if err != nil || index < 0 || index >= len(files) || strconv.Itoa(index) != raw {
		return localFile{}, false
	}
	return files[index], true
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
