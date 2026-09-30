package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The test binary doubles as the hidden browser: started with PROTEOSCOPE_FAKE_BROWSER set, it
// connects to the page's event stream the way the page does and answers like the page would.
func TestMain(m *testing.M) {
	if os.Getenv("PROTEOSCOPE_FAKE_BROWSER") == "1" {
		fakeBrowser(os.Args[len(os.Args)-1])
		os.Exit(0)
	}
	os.Exit(m.Run())
}

const fakeJPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="

func fakeBrowser(url string) {
	response, err := http.Get(url + "/api/remote/events")
	if err != nil {
		os.Exit(3)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		var event remoteEvent
		if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event) != nil {
			continue
		}
		body, _ := json.Marshal(fakeAnswer(event))
		answer, err := http.Post(url+"/api/remote/result/"+event.ID, "application/json", bytes.NewReader(body))
		if err == nil {
			answer.Body.Close()
		}
	}
}

func fakeAnswer(event remoteEvent) remoteResult {
	switch {
	case len(event.Files) > 0:
		return remoteResult{OK: true, Message: "Opened 2 prediction jobs."}
	case strings.HasPrefix(event.Command, "triage by"):
		data, _ := json.Marshal(map[string]any{
			"metric": "ipsae", "level": "jobs", "pair": nil, "total": 2,
			"rows": []map[string]any{
				{"position": 1, "job": "aurka_tpx2", "tool": "AlphaFold Server", "model": "Model 0", "chains": []string{"A", "B"}, "ipsae": 0.8665, "pdockq2": 0.712, "meanPlddt": 92.4776, "poseChecks": map[string]any{"ligands": 1, "passed": 18, "checked": 19, "failed": []string{"protein-distance"}}},
				{"position": 2, "job": "raf1", "tool": "ColabFold", "model": "Rank 1", "chains": []string{"A", "C"}, "ipsae": 0.598, "pdockq2": 0.119, "meanPlddt": 55.2, "problem": "The PAE matrix does not match."},
			},
		})
		// The command line comes back in the message, for the test to check.
		return remoteResult{OK: true, Message: event.Command, Data: data}
	case event.Command == "triage export":
		data, _ := json.Marshal(map[string]string{"csv": "tool,job\nAlphaFold Server,aurka_tpx2"})
		return remoteResult{OK: true, Data: data}
	case strings.HasPrefix(event.Command, "triage gallery"):
		data, _ := json.Marshal([]map[string]any{{"position": 1, "job": "aurka tpx2", "model": "Model 0", "image": fakeJPEG}})
		return remoteResult{OK: true, Message: event.Command, Data: data}
	}
	return remoteResult{OK: false, Message: "Unknown command: " + event.Command}
}

func TestTriageRunsThePageHiddenAndWritesItsResults(t *testing.T) {
	t.Setenv("PROTEOSCOPE_FAKE_BROWSER", "1")
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	dir := t.TempDir()
	jobs := filepath.Join(dir, "jobs")
	if err := os.MkdirAll(jobs, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(jobs, "model.cif"), []byte("data_x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	csvPath := filepath.Join(dir, "ranking.csv")
	jsonPath := filepath.Join(dir, "ranking.json")
	gallery := filepath.Join(dir, "gallery")
	opts, err := parseTriageOptions([]string{jobs, "--csv", csvPath, "--json", jsonPath, "--gallery", gallery, "--gallery-count", "3", "--browser", os.Args[0], "--no-cache", "--port", "0"}, &bytes.Buffer{})
	if err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	if err := triage(opts, &stdout, &stderr); err != nil {
		t.Fatalf("%v\n%s", err, stderr.String())
	}
	table := stdout.String()
	for _, want := range []string{"aurka_tpx2", "A–B", "0.867", "18/19", "⚠ The PAE matrix does not match.", "2 of 2 jobs, ranked by ipSAE."} {
		if !strings.Contains(table, want) {
			t.Errorf("table lacks %q:\n%s", want, table)
		}
	}
	// ipSAE is ranked by, so it comes right after the model.
	if header := strings.Fields(strings.SplitN(table, "\n", 2)[0]); strings.Join(header[:5], " ") != "# Job Model Chains ipSAE" {
		t.Errorf("header %v", header)
	}
	if !strings.Contains(stderr.String(), "Opened 2 prediction jobs.") || !strings.Contains(stderr.String(), "Wrote 1 images") {
		t.Errorf("progress: %s", stderr.String())
	}
	if body, _ := os.ReadFile(csvPath); string(body) != "tool,job\nAlphaFold Server,aurka_tpx2\n" {
		t.Errorf("CSV %q", body)
	}
	var ranking triageRanking
	if body, err := os.ReadFile(jsonPath); err != nil || json.Unmarshal(body, &ranking) != nil || len(ranking.Rows) != 2 || ranking.Rows[0].PoseChecks.Passed != 18 {
		t.Errorf("JSON %+v (%v)", ranking, err)
	}
	if info, err := os.Stat(filepath.Join(gallery, "01_aurka_tpx2_Model_0.jpg")); err != nil || info.Size() == 0 {
		t.Errorf("gallery image: %v", err)
	}
}

func TestTriageOptionsAndCommands(t *testing.T) {
	dir := t.TempDir()
	parse := func(args ...string) (triageOptions, error) {
		return parseTriageOptions(append([]string{dir}, args...), &bytes.Buffer{})
	}
	opts, err := parse("--by", "pose", "--models", "--pair", "A,B")
	if err != nil {
		t.Fatal(err)
	}
	if got := opts.rankCommand(10); got != "triage by pose top 10 models pair A B" {
		t.Errorf("command %q", got)
	}
	if !opts.cfg.remote || !opts.cfg.mcp || !opts.cfg.noOpen || !opts.cfg.blank {
		t.Errorf("config %+v", opts.cfg)
	}
	if opts, _ := parse(); opts.rankCommand(5) != "triage by auto top 5 jobs best" {
		t.Errorf("default command %q", opts.rankCommand(5))
	}
	for _, args := range [][]string{
		{"--by", "nonsense"},
		{"--pair", "A"},
		{"--pair", "A,B,C"},
		{"--top", "0"},
		{"--gallery-count", "25"},
		{"--gallery-width", "5000"},
		{"--csv", "-", "--json", "-"},
	} {
		if _, err := parse(args...); err == nil {
			t.Errorf("%v was accepted", args)
		}
	}
	if _, err := parseTriageOptions(nil, &bytes.Buffer{}); err == nil {
		t.Error("no folders was accepted")
	}
	if _, err := parseTriageOptions([]string{filepath.Join(dir, "missing")}, &bytes.Buffer{}); err == nil {
		t.Error("a missing folder was accepted")
	}
}

func TestTriageBrowserIsFoundOrNamed(t *testing.T) {
	if _, err := findBrowser(filepath.Join(t.TempDir(), "no-such-browser")); err == nil {
		t.Error("a missing browser was accepted")
	}
	if path, err := findBrowser(os.Args[0]); err != nil || path == "" {
		t.Errorf("named browser: %q, %v", path, err)
	}
	t.Setenv("PROTEOSCOPE_BROWSER", os.Args[0])
	if path, err := findBrowser(""); err != nil || path == "" {
		t.Errorf("PROTEOSCOPE_BROWSER: %q, %v", path, err)
	}
}
