package main

import (
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed web/* data
var content embed.FS

type sample struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	Title          string `json:"title"`
	Classification string `json:"classification"`
	Method         string `json:"method"`
	Resolution     string `json:"resolution"`
	Atoms          int    `json:"atoms"`
	Residues       int    `json:"residues"`
	Chains         int    `json:"chains"`
	Models         int    `json:"models"`
	SizeBytes      int    `json:"sizeBytes"`
}

func main() {
	host := flag.String("host", "127.0.0.1", "host interface to bind")
	port := flag.Int("port", 8765, "preferred localhost port")
	noOpen := flag.Bool("no-open", false, "do not open the browser automatically")
	flag.Parse()

	if err := mime.AddExtensionType(".js", "text/javascript; charset=utf-8"); err != nil {
		log.Printf("mime registration warning: %v", err)
	}

	handler, err := appHandler()
	if err != nil {
		log.Fatalf("failed to prepare embedded app: %v", err)
	}

	listener, actualPort, err := listen(*host, *port)
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	url := fmt.Sprintf("http://%s:%d", *host, actualPort)
	fmt.Printf("Proteoscope is running at %s\n", url)
	fmt.Println("Press Ctrl+C to stop.")

	if !*noOpen {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				log.Printf("open browser: %v", err)
			}
		}()
	}

	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server error: %v", err)
	}
}

func appHandler() (http.Handler, error) {
	webFS, err := fs.Sub(content, "web")
	if err != nil {
		return nil, err
	}

	samples, err := loadSamples()
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/samples", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"samples": samples})
	})
	mux.Handle("/data/", cacheControl(http.FileServer(http.FS(content))))
	mux.Handle("/", spaFileServer(webFS))
	return mux, nil
}

func loadSamples() ([]sample, error) {
	entries, err := content.ReadDir("data")
	if err != nil {
		return nil, err
	}
	var samples []sample
	for _, entry := range entries {
		if entry.IsDir() || !isStructureFile(entry.Name()) {
			continue
		}
		path := "data/" + entry.Name()
		body, err := content.ReadFile(path)
		if err != nil {
			return nil, err
		}
		item := parseSample(entry.Name(), string(body))
		item.URL = "/" + path
		item.SizeBytes = len(body)
		samples = append(samples, item)
	}
	sort.Slice(samples, func(i, j int) bool {
		return samples[i].ID < samples[j].ID
	})
	return samples, nil
}

func isStructureFile(filename string) bool {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".pdb", ".cif", ".mmcif":
		return true
	default:
		return false
	}
}

func parseSample(filename, body string) sample {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".cif", ".mmcif":
		return parseCIFSample(filename, body)
	default:
		return parsePDBSample(filename, body)
	}
}

func newSample(filename string) sample {
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	return sample{ID: filename, Name: strings.ToUpper(base), Models: 1}
}

func parsePDBSample(filename, pdb string) sample {
	item := newSample(filename)
	chains := make(map[string]bool)
	residues := make(map[string]bool)
	models := 0
	var titleParts []string

	for _, line := range strings.Split(pdb, "\n") {
		record := recordName(line)
		switch record {
		case "HEADER":
			item.Classification = strings.TrimSpace(substr(line, 10, 50))
			if code := strings.TrimSpace(substr(line, 62, 66)); code != "" {
				item.Name = code
			}
		case "TITLE":
			titleParts = append(titleParts, strings.TrimSpace(substr(line, 10, 80)))
		case "EXPDTA":
			item.Method = strings.TrimSpace(substr(line, 10, 80))
		case "REMARK":
			if strings.HasPrefix(line, "REMARK   2 RESOLUTION.") {
				item.Resolution = strings.TrimSpace(strings.TrimPrefix(line[10:], "2 RESOLUTION."))
			}
		case "MODEL":
			models++
		case "ATOM", "HETATM":
			item.Atoms++
			chain := strings.TrimSpace(substr(line, 21, 22))
			resSeq := strings.TrimSpace(substr(line, 22, 27))
			resName := strings.TrimSpace(substr(line, 17, 20))
			chains[chain] = true
			residues[chain+"|"+resSeq+"|"+resName] = true
		}
	}
	if len(titleParts) > 0 {
		item.Title = strings.Join(titleParts, " ")
	}
	if item.Title == "" {
		item.Title = item.Name
	}
	if models > 0 {
		item.Models = models
	}
	item.Chains = len(chains)
	item.Residues = len(residues)
	return item
}

func parseCIFSample(filename, body string) sample {
	item := newSample(filename)
	cif := parseCIF(body)

	if code := cifClean(cifValue(cif, "_entry.id")); code != "" {
		item.Name = code
	}
	title := cifClean(cifValue(cif, "_struct.title"))
	if title != "" {
		item.Title = collapseSpace(title)
	}
	if item.Title == "" {
		item.Title = item.Name
	}
	if item.Name != "" && !strings.HasPrefix(strings.ToUpper(item.Title), strings.ToUpper(item.Name)+":") {
		item.Title = item.Name + ": " + item.Title
	}
	item.Classification = firstClean(
		cifValue(cif, "_struct_keywords.pdbx_keywords"),
		cifValue(cif, "_struct_keywords.text"),
	)
	item.Method = strings.Join(cifColumnValues(cif, "exptl", "method"), "; ")
	if item.Method == "" {
		item.Method = cifClean(cifValue(cif, "_exptl.method"))
	}
	item.Resolution = firstClean(
		cifValue(cif, "_refine.ls_d_res_high"),
		cifValue(cif, "_em_3d_reconstruction.resolution"),
		cifValue(cif, "_reflns.d_resolution_high"),
	)
	if item.Resolution != "" && !strings.Contains(strings.ToLower(item.Resolution), "angstrom") {
		item.Resolution += " Angstroms"
	}

	chains := make(map[string]bool)
	residues := make(map[string]bool)
	models := make(map[string]bool)
	for _, row := range cif.loops["atom_site"] {
		group := strings.ToUpper(cifClean(row["group_pdb"]))
		if group != "ATOM" && group != "HETATM" {
			continue
		}
		altLoc := cifClean(row["label_alt_id"])
		if altLoc != "" && altLoc != "A" && altLoc != "1" {
			continue
		}
		item.Atoms++
		chain := firstClean(row["auth_asym_id"], row["label_asym_id"])
		if chain == "" {
			chain = "_"
		}
		resSeq := firstClean(row["auth_seq_id"], row["label_seq_id"])
		resName := firstClean(row["auth_comp_id"], row["label_comp_id"])
		model := cifClean(row["pdbx_pdb_model_num"])
		if model == "" {
			model = "1"
		}
		chains[chain] = true
		residues[chain+"|"+resSeq+"|"+resName] = true
		models[model] = true
	}
	if len(models) > 0 {
		item.Models = len(models)
	}
	item.Chains = len(chains)
	item.Residues = len(residues)
	return item
}

type cifDoc struct {
	fields    map[string]string
	loops     map[string][]map[string]string
	dataBlock string
}

func parseCIF(body string) cifDoc {
	tokens := tokenizeCIF(body)
	doc := cifDoc{
		fields: make(map[string]string),
		loops:  make(map[string][]map[string]string),
	}
	for i := 0; i < len(tokens); {
		token := tokens[i]
		lower := strings.ToLower(token)
		switch {
		case strings.HasPrefix(lower, "data_"):
			doc.dataBlock = strings.TrimSpace(token[5:])
			i++
		case lower == "loop_":
			i++
			var headers []string
			for i < len(tokens) && strings.HasPrefix(tokens[i], "_") {
				headers = append(headers, tokens[i])
				i++
			}
			if len(headers) == 0 {
				continue
			}
			category, attrs := cifHeaderParts(headers)
			var rows []map[string]string
			for i < len(tokens) && !cifControlToken(tokens[i]) {
				row := make(map[string]string, len(headers))
				complete := true
				for column := 0; column < len(headers); column++ {
					if i >= len(tokens) || cifControlToken(tokens[i]) {
						complete = false
						break
					}
					row[attrs[column]] = tokens[i]
					i++
				}
				if complete {
					rows = append(rows, row)
				}
			}
			if category != "" && len(rows) > 0 {
				doc.loops[category] = append(doc.loops[category], rows...)
			}
		case strings.HasPrefix(token, "_"):
			if i+1 < len(tokens) {
				doc.fields[cifTagKey(token)] = tokens[i+1]
				i += 2
			} else {
				i++
			}
		default:
			i++
		}
	}
	return doc
}

func tokenizeCIF(text string) []string {
	var tokens []string
	for i := 0; i < len(text); {
		for i < len(text) && isCIFSpace(text[i]) {
			i++
		}
		if i >= len(text) {
			break
		}
		if text[i] == '#' {
			for i < len(text) && text[i] != '\n' {
				i++
			}
			continue
		}
		if text[i] == ';' && (i == 0 || text[i-1] == '\n') {
			start := i + 1
			if start < len(text) && text[start] == '\r' {
				start++
			}
			if start < len(text) && text[start] == '\n' {
				start++
			}
			searchFrom := start
			end := len(text)
			for searchFrom < len(text) {
				offset := strings.Index(text[searchFrom:], "\n;")
				if offset < 0 {
					break
				}
				end = searchFrom + offset
				i = end + 2
				for i < len(text) && text[i] != '\n' {
					i++
				}
				if i < len(text) {
					i++
				}
				break
			}
			if end == len(text) {
				i = len(text)
			}
			tokens = append(tokens, text[start:end])
			continue
		}
		if text[i] == '\'' || text[i] == '"' {
			quote := text[i]
			i++
			start := i
			for i < len(text) && text[i] != quote {
				i++
			}
			tokens = append(tokens, text[start:i])
			if i < len(text) {
				i++
			}
			continue
		}
		start := i
		for i < len(text) && !isCIFSpace(text[i]) {
			i++
		}
		tokens = append(tokens, text[start:i])
	}
	return tokens
}

func cifHeaderParts(headers []string) (string, []string) {
	attrs := make([]string, len(headers))
	category := ""
	for i, header := range headers {
		cat, attr := cifTagParts(header)
		if category == "" {
			category = cat
		}
		attrs[i] = attr
	}
	return category, attrs
}

func cifTagParts(tag string) (string, string) {
	key := cifTagKey(tag)
	key = strings.TrimPrefix(key, "_")
	parts := strings.SplitN(key, ".", 2)
	if len(parts) != 2 {
		return key, ""
	}
	return parts[0], parts[1]
}

func cifTagKey(tag string) string {
	return strings.ToLower(strings.TrimSpace(tag))
}

func cifControlToken(token string) bool {
	lower := strings.ToLower(token)
	return strings.HasPrefix(token, "_") ||
		lower == "loop_" ||
		lower == "stop_" ||
		strings.HasPrefix(lower, "data_") ||
		strings.HasPrefix(lower, "save_")
}

func isCIFSpace(ch byte) bool {
	return ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'
}

func cifValue(doc cifDoc, tag string) string {
	if value, ok := doc.fields[cifTagKey(tag)]; ok {
		return value
	}
	category, attr := cifTagParts(tag)
	for _, row := range doc.loops[category] {
		if value, ok := row[attr]; ok {
			return value
		}
	}
	return ""
}

func cifColumnValues(doc cifDoc, category, attr string) []string {
	var values []string
	seen := make(map[string]bool)
	for _, row := range doc.loops[strings.ToLower(category)] {
		value := cifClean(row[strings.ToLower(attr)])
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		values = append(values, value)
	}
	return values
}

func cifClean(value string) string {
	value = strings.TrimSpace(value)
	if value == "." || value == "?" {
		return ""
	}
	return value
}

func firstClean(values ...string) string {
	for _, value := range values {
		if clean := cifClean(value); clean != "" {
			return clean
		}
	}
	return ""
}

func collapseSpace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func recordName(line string) string {
	if len(line) < 6 {
		return strings.TrimSpace(line)
	}
	return strings.TrimSpace(line[:6])
}

func substr(line string, start, end int) string {
	if start >= len(line) {
		return ""
	}
	if end > len(line) {
		end = len(line)
	}
	return line[start:end]
}

func listen(host string, preferredPort int) (net.Listener, int, error) {
	for offset := 0; offset < 50; offset++ {
		port := preferredPort + offset
		listener, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
		if err == nil {
			return listener, port, nil
		}
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		return nil, 0, err
	}
	return listener, listener.Addr().(*net.TCPAddr).Port, nil
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func cacheControl(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "public, max-age=3600")
		next.ServeHTTP(w, r)
	})
}

func spaFileServer(root fs.FS) http.Handler {
	files := http.FileServer(http.FS(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			files.ServeHTTP(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if _, err := fs.Stat(root, path); err == nil {
			files.ServeHTTP(w, r)
			return
		}
		r.URL.Path = "/"
		files.ServeHTTP(w, r)
	})
}
