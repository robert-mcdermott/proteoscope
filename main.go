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
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed web/* data/*.pdb
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
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".pdb") {
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

func parseSample(filename, pdb string) sample {
	id := strings.TrimSuffix(filename, ".pdb")
	item := sample{ID: id, Name: strings.ToUpper(id), Models: 1}
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
