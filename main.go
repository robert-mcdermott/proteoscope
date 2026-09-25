package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web/index.html web/styles.css web/app.js web/favicon.svg web/lib/*.js data
var content embed.FS

var version = "0.8.0"

type sample struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	Title          string `json:"title"`
	Classification string `json:"classification"`
	Method         string `json:"method"`
	Resolution     string `json:"resolution"`
	// Counted only for files the manifest does not list.
	Atoms     int `json:"atoms,omitempty"`
	Residues  int `json:"residues,omitempty"`
	Chains    int `json:"chains,omitempty"`
	Models    int `json:"models,omitempty"`
	SizeBytes int `json:"sizeBytes"`
	// From data/examples.json.
	Label       string   `json:"label,omitempty"`
	Category    string   `json:"category,omitempty"`
	Description string   `json:"description,omitempty"`
	View        []string `json:"view,omitempty"`
	Credit      string   `json:"credit,omitempty"`
	PAE         string   `json:"pae,omitempty"`
	Accession   string   `json:"accession,omitempty"`
}

type config struct {
	host        string
	port        int
	noOpen      bool
	offline     bool
	noCache     bool
	cacheDir    string
	cacheMaxAge time.Duration
	dev         bool
	showVersion bool
	remote      bool
	// mcp: started as "proteoscope mcp"; the agent talks to the hub in-process.
	mcp   bool
	files []string
}

type app struct {
	offline  bool
	dev      bool
	control  *remoteHub
	assetDir string
	assets   fs.FS
	// files grows when a script opens more files (remote control, MCP); startupFiles are the
	// ones named on the command line, which the page opens when it loads.
	filesMu      sync.RWMutex
	files        []localFile
	fileIndex    map[string]int
	startupFiles []localFile
	cache        *diskCache
	remote       *upstream
}

func init() {
	if err := mime.AddExtensionType(".js", "text/javascript; charset=utf-8"); err != nil {
		log.Printf("mime registration warning: %v", err)
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		os.Exit(runMCP(os.Args[2:], os.Stdin, os.Stdout, os.Stderr))
	}
	cfg, err := parseConfig(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		os.Exit(2)
	}
	if cfg.showVersion {
		fmt.Printf("proteoscope %s\n", version)
		return
	}
	running, err := start(cfg, os.Stdout)
	if err != nil {
		log.Fatal(err)
	}
	if err := running.serve(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

// A prepared server: the app, its listener and address.
type runningServer struct {
	app      *app
	server   *http.Server
	listener net.Listener
	url      string
	cancel   context.CancelFunc
}

// stop ends open event streams (their requests share the server's context) and shuts down.
func (s *runningServer) stop(timeout time.Duration) {
	s.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	s.server.Shutdown(ctx)
}

func (s *runningServer) serve() error {
	if err := s.server.Serve(s.listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// start prepares the app, listens, prints the banner to out and opens the browser.
func start(cfg config, out io.Writer) (*runningServer, error) {
	a, err := newApp(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare app: %w", err)
	}
	handler, err := a.handler()
	if err != nil {
		return nil, fmt.Errorf("failed to prepare app: %w", err)
	}
	listener, actualPort, err := listen(cfg.host, cfg.port)
	if err != nil {
		return nil, fmt.Errorf("failed to listen: %w", err)
	}
	url := "http://" + net.JoinHostPort(cfg.host, strconv.Itoa(actualPort))
	a.printBanner(out, url)
	if !cfg.noOpen {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				log.Printf("open browser: %v", err)
			}
		}()
	}
	base, cancel := context.WithCancel(context.Background())
	server := &http.Server{
		Handler:           protect(handler, cfg.host, actualPort),
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return base },
	}
	return &runningServer{app: a, server: server, listener: listener, url: url, cancel: cancel}, nil
}

func parseConfig(args []string) (config, error) {
	var cfg config
	flags := flag.NewFlagSet("proteoscope", flag.ContinueOnError)
	flags.StringVar(&cfg.host, "host", "127.0.0.1", "host interface to bind")
	flags.IntVar(&cfg.port, "port", 8765, "preferred localhost port")
	flags.BoolVar(&cfg.noOpen, "no-open", false, "do not open the browser automatically")
	flags.BoolVar(&cfg.offline, "offline", false, "disable remote structure fetching (cached downloads are still served)")
	flags.StringVar(&cfg.cacheDir, "cache-dir", "", "directory for cached downloads (default: <user cache dir>/proteoscope)")
	flags.BoolVar(&cfg.noCache, "no-cache", false, "do not cache downloads on disk")
	flags.DurationVar(&cfg.cacheMaxAge, "cache-max-age", defaultCacheMaxAge, "refetch cached downloads older than this (0 keeps them forever)")
	flags.BoolVar(&cfg.dev, "dev", false, "serve web/ and data/ from the working directory instead of the embedded copies")
	flags.BoolVar(&cfg.showVersion, "version", false, "print the version and exit")
	flags.BoolVar(&cfg.remote, "remote-control", false, "accept commands from scripts on this computer at /api/remote/command (for example Jupyter)")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "Usage: proteoscope [flags] [structure files or prediction folders...]")
		fmt.Fprintln(flags.Output(), "       proteoscope mcp [flags]   (an MCP server for AI agents, on stdin and stdout)")
		flags.PrintDefaults()
	}
	files, err := parseArgs(flags, args)
	cfg.files = files
	return cfg, err
}

func parseArgs(flags *flag.FlagSet, args []string) ([]string, error) {
	var positional []string
	for {
		if err := flags.Parse(args); err != nil {
			return nil, err
		}
		rest := flags.Args()
		if len(rest) == 0 {
			return positional, nil
		}
		if consumed := len(args) - len(rest); consumed > 0 && args[consumed-1] == "--" {
			return append(positional, rest...), nil
		}
		positional = append(positional, rest[0])
		args = rest[1:]
	}
}

func newApp(cfg config) (*app, error) {
	a := &app{
		offline: cfg.offline,
		dev:     cfg.dev,
		assets:  content,
		files:   loadLocalFiles(cfg.files),
		cache:   openCache(cfg.cacheDir, cfg.noCache, cfg.cacheMaxAge),
		remote:  defaultUpstream(),
	}
	a.startupFiles = a.files
	if cfg.remote {
		a.control = newRemoteHub()
		a.control.open = a.addLocalFiles
		a.control.scripts = !cfg.mcp
	}
	if !cfg.dev {
		return a, nil
	}
	dir, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	a.assetDir = dir
	a.assets = os.DirFS(dir)
	if _, err := fs.Stat(a.assets, "web/index.html"); err != nil {
		return nil, fmt.Errorf("--dev must be run from the repository root: %w", err)
	}
	return a, nil
}

func (a *app) printBanner(out io.Writer, url string) {
	fmt.Fprintf(out, "Proteoscope %s is running at %s\n", version, url)
	if a.dev {
		fmt.Fprintf(out, "Dev mode: serving web/ and data/ from disk in %s (no-store)\n", a.assetDir)
	}
	if a.offline {
		fmt.Fprintln(out, "Offline mode: remote fetching is disabled.")
	}
	if a.cache != nil && a.cache.maxAge > 0 {
		fmt.Fprintf(out, "Download cache: %s (refreshed after %s)\n", a.cache.dir, formatAge(a.cache.maxAge))
	} else if a.cache != nil {
		fmt.Fprintf(out, "Download cache: %s\n", a.cache.dir)
	} else {
		fmt.Fprintln(out, "Download cache: disabled")
	}
	if a.control != nil && a.control.scripts {
		fmt.Fprintf(out, "Remote control: POST {\"command\": ...} to %s/api/remote/command\n", url)
		fmt.Fprintf(out, "Opening files by path: POST {\"paths\": [...]} to %s/api/remote/open with the header %s: %s\n", url, remoteTokenHeader, a.control.token)
	}
	folders := map[string]int{}
	var order []string
	for _, file := range a.files {
		if file.Path == "" {
			fmt.Fprintf(out, "Local file %s: %s\n", file.URL, file.path)
			continue
		}
		folder := strings.SplitN(file.Path, "/", 2)[0]
		if folders[folder] == 0 {
			order = append(order, folder)
		}
		folders[folder]++
	}
	for _, folder := range order {
		fmt.Fprintf(out, "Local folder %s: %d files\n", folder, folders[folder])
	}
	fmt.Fprintln(out, "Press Ctrl+C to stop.")
}

func (a *app) handler() (http.Handler, error) {
	if a.startupFiles == nil {
		a.startupFiles = a.files
	}
	webFS, err := fs.Sub(a.assets, "web")
	if err != nil {
		return nil, err
	}
	dataFS, err := fs.Sub(a.assets, "data")
	if err != nil {
		return nil, err
	}
	samples, err := a.sampleSource()
	if err != nil {
		return nil, err
	}
	webCache, dataCache := "", "public, max-age=3600"
	if a.dev {
		webCache, dataCache = "no-store", "no-store"
	}

	mux := http.NewServeMux()
	a.registerAPI(mux, samples)
	mux.Handle("/data/", cacheControl(dataCache, http.StripPrefix("/data", dataHandler(dataFS))))
	mux.Handle("/", cacheControl(webCache, spaFileServer(webFS)))
	return mux, nil
}

func (a *app) registerAPI(mux *http.ServeMux, samples func() ([]sample, error)) {
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/samples", func(w http.ResponseWriter, r *http.Request) {
		list, err := samples()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, map[string]any{"samples": list})
	})
	mux.HandleFunc("GET /api/startup", a.serveStartup)
	if a.control != nil {
		a.control.register(mux)
	}
	mux.HandleFunc("GET /api/local/{index}", a.serveLocal)
	mux.HandleFunc("GET /api/fetch/pdb/{id}", a.fetchPDB)
	mux.HandleFunc("GET /api/fetch/afdb/{accession}", a.fetchAlphaFold)
	mux.HandleFunc("GET /api/fetch/afdb/{accession}/pae", a.fetchAlphaFoldPAE)
	mux.HandleFunc("GET /api/fetch/afdb/{accession}/missense", a.fetchAlphaMissense)
	mux.HandleFunc("GET /api/fetch/afdb/{accession}/msa", a.fetchAlphaFoldMSA)
	mux.HandleFunc("GET /api/fetch/uniprot/{accession}", a.fetchUniProt)
	mux.HandleFunc("GET /api/fetch/validation/{id}", a.fetchValidation)
	mux.HandleFunc("GET /api/fetch/ccd/{id}", a.fetchComponent)
	mux.HandleFunc("GET /api/fetch/compound/{id}", a.fetchCompound)
	mux.HandleFunc("GET /api/fetch/volume/{source}/{id}", a.fetchVolumeHeader)
	mux.HandleFunc("GET /api/fetch/volume/{source}/{id}/box", a.fetchVolumeBox)
	mux.HandleFunc("GET /api/fetch/volume/{source}/{id}/cell", a.fetchVolumeCell)
	mux.HandleFunc("GET /api/fetch/emdb/{id}", a.fetchEMDB)
	mux.HandleFunc("GET /api/fetch/model", a.fetchModel)
	mux.HandleFunc("GET /api/fetch/proteomics/{accession}", a.fetchProteomicsEvidence)
	mux.HandleFunc("GET /api/search/text", a.searchText)
	mux.HandleFunc("GET /api/search/sequence", a.searchSequence)
	mux.HandleFunc("GET /api/search/uniprot", a.searchUniProt)
	mux.HandleFunc("GET /api/search/protein/{accession}", a.searchProtein)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "Unknown API endpoint.")
	})
}

func (a *app) sampleSource() (func() ([]sample, error), error) {
	if a.dev {
		return func() ([]sample, error) { return loadSamples(a.assets) }, nil
	}
	samples, err := loadSamples(a.assets)
	if err != nil {
		return nil, err
	}
	return func() ([]sample, error) { return samples, nil }, nil
}

func isStructureFile(filename string) bool {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".pdb", ".cif", ".mmcif", ".ent":
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
			return listener, listener.Addr().(*net.TCPAddr).Port, nil
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
	writeJSONStatus(w, http.StatusOK, value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSONStatus(w, status, map[string]string{"error": message})
}

func writeJSONStatus(w http.ResponseWriter, status int, value any) {
	body, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	w.Write(append(body, '\n'))
}

func cacheControl(value string, next http.Handler) http.Handler {
	if value == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", value)
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
