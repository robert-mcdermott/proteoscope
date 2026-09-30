package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"
)

// "proteoscope triage" ranks prediction jobs without a window, for clusters and pipelines. It
// starts Proteoscope with remote control, opens the page in a hidden (headless) Chrome,
// Chromium, Edge or Brave, has the page score every model as the Triage table does, and writes
// the ranking, the CSV and the gallery to files. The page does the scoring, so the scores are
// the same as in the window; nothing is computed twice.

const (
	triagePageWait     = time.Minute
	triageCommandLimit = 10 * time.Minute
	triageMaxGallery   = 24
	// The hidden window, which also bounds the gallery's images.
	triageWindowWidth  = 1600
	triageWindowHeight = 1000
)

var triageMetrics = []string{"ipsae", "pdockq2", "pdockq", "lis", "iptm", "ranking", "ptm", "plddt", "pose", "affinity", "binder"}

var errNoBrowser = errors.New("proteoscope triage needs Chrome, Chromium, Edge or Brave, which it runs hidden to score the models; none was found. Install one, or name it with --browser or the PROTEOSCOPE_BROWSER variable")

type triageOptions struct {
	cfg          config
	paths        []string
	metric       string
	top          int
	models       bool
	pair         []string
	csvPath      string
	jsonPath     string
	galleryDir   string
	galleryCount int
	galleryWidth int
	browser      string
	timeout      time.Duration
	verbose      bool
}

func parseTriageOptions(args []string, output io.Writer) (triageOptions, error) {
	opts := triageOptions{cfg: config{host: "127.0.0.1"}}
	flags := flag.NewFlagSet("proteoscope triage", flag.ContinueOnError)
	flags.SetOutput(output)
	var pair string
	flags.StringVar(&opts.metric, "by", "auto", "score to rank by: "+strings.Join(triageMetrics, ", ")+", or auto (ipsae for complexes, pdockq without a PAE, plddt otherwise)")
	flags.IntVar(&opts.top, "top", 20, "rows to print")
	flags.BoolVar(&opts.models, "models", false, "one row per model instead of one per job (its best model)")
	flags.StringVar(&pair, "pair", "", "score this chain pair instead of each model's best interface, for example A,B")
	flags.StringVar(&opts.csvPath, "csv", "", "write every model and interface of every job as CSV to this file (- for standard output)")
	flags.StringVar(&opts.jsonPath, "json", "", "write the ranked rows as JSON to this file (- for standard output)")
	flags.StringVar(&opts.galleryDir, "gallery", "", "render the best models as JPEG images into this folder")
	flags.IntVar(&opts.galleryCount, "gallery-count", 12, fmt.Sprintf("how many models the gallery shows (1 to %d)", triageMaxGallery))
	flags.IntVar(&opts.galleryWidth, "gallery-width", 1200, "width of each gallery image in pixels (120 to 1600)")
	flags.StringVar(&opts.browser, "browser", "", "the browser to run hidden (default: Chrome, Chromium, Edge or Brave, found automatically)")
	flags.DurationVar(&opts.timeout, "timeout", openTimeout, "give up after this long")
	flags.BoolVar(&opts.verbose, "verbose", false, "show the server's and the browser's messages")
	flags.IntVar(&opts.cfg.port, "port", 8765, "preferred localhost port (a nearby free one is used when it is busy)")
	flags.BoolVar(&opts.cfg.offline, "offline", false, "no downloads; ligands whose dictionary entries are not cached get fewer pose checks")
	flags.StringVar(&opts.cfg.cacheDir, "cache-dir", "", "directory for cached downloads (default: <user cache dir>/proteoscope)")
	flags.BoolVar(&opts.cfg.noCache, "no-cache", false, "do not cache downloads on disk")
	flags.DurationVar(&opts.cfg.cacheMaxAge, "cache-max-age", defaultCacheMaxAge, "refetch cached downloads older than this (0 keeps them forever)")
	flags.BoolVar(&opts.cfg.dev, "dev", false, "serve web/ from the working directory (development)")
	flags.Usage = func() {
		fmt.Fprintln(flags.Output(), "Usage: proteoscope triage [flags] <prediction folders, or folders of them...>")
		fmt.Fprintln(flags.Output(), "Scores every model of every job as the Triage table does, without a window, and prints the ranking.")
		flags.PrintDefaults()
	}
	paths, err := parseArgs(flags, args)
	if err != nil {
		return opts, err
	}
	if len(paths) == 0 {
		flags.Usage()
		return opts, errors.New("name at least one prediction folder")
	}
	for _, name := range paths {
		absolute, err := expandPath(name)
		if err != nil {
			return opts, err
		}
		if _, err := os.Stat(absolute); err != nil {
			return opts, fmt.Errorf("%s: %w", name, err)
		}
		opts.paths = append(opts.paths, absolute)
	}
	if opts.metric != "auto" && !contains(triageMetrics, opts.metric) {
		return opts, fmt.Errorf("--by %s: rank by %s", opts.metric, strings.Join(triageMetrics, ", "))
	}
	if opts.top < 1 {
		return opts, errors.New("--top must be at least 1")
	}
	if pair != "" {
		opts.pair = strings.FieldsFunc(pair, func(r rune) bool { return r == ',' || r == ' ' || r == '-' })
		if len(opts.pair) != 2 || !chainID.MatchString(opts.pair[0]) || !chainID.MatchString(opts.pair[1]) {
			return opts, errors.New("--pair takes two chain IDs, such as A,B")
		}
	}
	if opts.galleryCount < 1 || opts.galleryCount > triageMaxGallery {
		return opts, fmt.Errorf("--gallery-count must be from 1 to %d", triageMaxGallery)
	}
	if opts.galleryWidth < 120 || opts.galleryWidth > triageWindowWidth {
		return opts, fmt.Errorf("--gallery-width must be from 120 to %d", triageWindowWidth)
	}
	if opts.csvPath == "-" && opts.jsonPath == "-" {
		return opts, errors.New("only one of --csv and --json can go to standard output")
	}
	opts.cfg.remote, opts.cfg.mcp, opts.cfg.noOpen, opts.cfg.blank = true, true, true, true
	return opts, nil
}

// expandPath makes a path absolute, with ~ for the home folder.
func expandPath(name string) (string, error) {
	if name == "~" || strings.HasPrefix(name, "~/") || strings.HasPrefix(name, `~\`) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		name = filepath.Join(home, name[1:])
	}
	return filepath.Abs(name)
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// The line for the page's triage command.
func (opts triageOptions) rankCommand(limit int) string {
	line := fmt.Sprintf("triage by %s top %d", opts.metric, limit)
	if opts.models {
		line += " models"
	} else {
		line += " jobs"
	}
	if len(opts.pair) == 2 {
		return line + " pair " + opts.pair[0] + " " + opts.pair[1]
	}
	return line + " best"
}

func runTriage(args []string, stdout, stderr io.Writer) int {
	opts, err := parseTriageOptions(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, "proteoscope triage:", err)
		return 2
	}
	if err := triage(opts, stdout, stderr); err != nil {
		fmt.Fprintln(stderr, "proteoscope triage:", err)
		return 1
	}
	return 0
}

func triage(opts triageOptions, stdout, stderr io.Writer) error {
	browser, err := findBrowser(opts.browser)
	if err != nil {
		return err
	}
	// Ctrl-C, a scheduler's SIGTERM or a closed pipe (--csv - | head) end the run through the
	// same cleanup as an error: the browser stops and its profile is removed.
	interrupted, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM, syscall.SIGPIPE)
	defer stopSignals()
	ctx, cancel := context.WithTimeout(interrupted, opts.timeout)
	defer cancel()
	logs := io.Discard
	if opts.verbose {
		logs = stderr
	}
	log.SetOutput(logs)
	running, err := start(opts.cfg, logs)
	if err != nil {
		return err
	}
	served := make(chan error, 1)
	go func() { served <- running.serve() }()
	defer running.stop(2 * time.Second)
	hub := running.app.control
	hub.timeout = triageCommandLimit

	page, err := startHiddenBrowser(browser, running.url, logs)
	if err != nil {
		return err
	}
	defer page.stop()
	fmt.Fprintf(stderr, "Scoring in a hidden %s…\n", filepath.Base(browser))
	if !hub.waitForPage(ctx, triagePageWait) {
		if interrupted.Err() != nil {
			return errors.New("interrupted")
		}
		select {
		case err := <-page.exited:
			return fmt.Errorf("the browser stopped before it opened the page (%v); try --verbose", err)
		default:
		}
		return errors.New("the page did not open in the hidden browser; try --verbose")
	}

	event, err := hub.openEvent(opts.paths, false)
	if err != nil {
		return err
	}
	opened, err := pageResult(ctx, hub, event)
	if err != nil {
		return err
	}
	fmt.Fprintln(stderr, opened.Message)

	// Every row, for the JSON; the table prints the first --top.
	ranked, err := pageResult(ctx, hub, remoteEvent{Command: opts.rankCommand(1_000_000)})
	if err != nil {
		return err
	}
	var ranking triageRanking
	if err := json.Unmarshal(ranked.Data, &ranking); err != nil {
		return fmt.Errorf("the ranking could not be read: %w", err)
	}

	table := stdout
	if opts.csvPath == "-" || opts.jsonPath == "-" {
		table = stderr
	}
	if opts.csvPath != "" {
		exported, err := pageResult(ctx, hub, remoteEvent{Command: "triage export"})
		if err != nil {
			return err
		}
		var export struct {
			CSV string `json:"csv"`
		}
		if err := json.Unmarshal(exported.Data, &export); err != nil {
			return fmt.Errorf("the CSV could not be read: %w", err)
		}
		if err := writeOutput(opts.csvPath, stdout, []byte(export.CSV+"\n")); err != nil {
			return err
		}
	}
	if opts.jsonPath != "" {
		body, err := json.MarshalIndent(ranking, "", "  ")
		if err != nil {
			return err
		}
		if err := writeOutput(opts.jsonPath, stdout, append(body, '\n')); err != nil {
			return err
		}
	}
	if opts.galleryDir != "" {
		// The gallery follows the ranking just asked for.
		rendered, err := pageResult(ctx, hub, remoteEvent{Command: fmt.Sprintf("triage gallery %d width %d", opts.galleryCount, opts.galleryWidth)})
		if err != nil {
			return err
		}
		written, err := writeGallery(opts.galleryDir, rendered.Data)
		if err != nil {
			return err
		}
		fmt.Fprintf(stderr, "Wrote %d images to %s.\n", written, opts.galleryDir)
	}
	printRanking(table, ranking, opts.top)
	return nil
}

// pageResult sends an event to the page and returns its answer, failed commands as errors.
func pageResult(ctx context.Context, hub *remoteHub, event remoteEvent) (remoteResult, error) {
	outcome, err := hub.dispatch(ctx, event)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return outcome, errors.New("gave up (--timeout)")
		}
		if errors.Is(err, context.Canceled) {
			return outcome, errors.New("interrupted")
		}
		return outcome, err
	}
	if !outcome.OK {
		return outcome, errors.New(outcome.Message)
	}
	return outcome, nil
}

func writeOutput(path string, stdout io.Writer, body []byte) error {
	if path == "-" {
		_, err := stdout.Write(body)
		return err
	}
	return os.WriteFile(path, body, 0o644)
}

/* ---------- The ranking ---------- */

type triageRanking struct {
	Metric string         `json:"metric"`
	Level  string         `json:"level"`
	Pair   []string       `json:"pair"`
	Total  int            `json:"total"`
	Rows   []triageRecord `json:"rows"`
}

type triagePose struct {
	Ligands int      `json:"ligands"`
	Passed  int      `json:"passed"`
	Checked int      `json:"checked"`
	Failed  []string `json:"failed"`
}

// A row as the page's triage command returns it (triage.js, triageRecords).
type triageRecord struct {
	Position          int             `json:"position"`
	Job               string          `json:"job"`
	Tool              string          `json:"tool"`
	Model             string          `json:"model"`
	Rank              json.RawMessage `json:"rank,omitempty"`
	Chains            []string        `json:"chains"`
	IPSAE             *float64        `json:"ipsae"`
	PDockQ            *float64        `json:"pdockq"`
	PDockQ2           *float64        `json:"pdockq2"`
	LIS               *float64        `json:"lis"`
	IPTM              *float64        `json:"iptm"`
	PTM               *float64        `json:"ptm"`
	RankingScore      *float64        `json:"rankingScore"`
	MeanPLDDT         *float64        `json:"meanPlddt"`
	Contacts          *int            `json:"contacts"`
	Crosslinks        json.RawMessage `json:"crosslinks,omitempty"`
	PoseChecks        *triagePose     `json:"poseChecks"`
	Affinity          *float64        `json:"affinity"`
	BinderProbability *float64        `json:"binderProbability"`
	Problem           *string         `json:"problem"`
}

type triageColumn struct {
	metric string
	label  string
	value  func(triageRecord) string
}

func scoreColumn(metric, label string, digits int, field func(triageRecord) *float64) triageColumn {
	return triageColumn{metric: metric, label: label, value: func(row triageRecord) string {
		value := field(row)
		if value == nil || math.IsNaN(*value) {
			return ""
		}
		return strconv.FormatFloat(*value, 'f', digits, 64)
	}}
}

var triageColumns = []triageColumn{
	scoreColumn("ipsae", "ipSAE", 3, func(row triageRecord) *float64 { return row.IPSAE }),
	scoreColumn("pdockq2", "pDockQ2", 3, func(row triageRecord) *float64 { return row.PDockQ2 }),
	scoreColumn("pdockq", "pDockQ", 3, func(row triageRecord) *float64 { return row.PDockQ }),
	scoreColumn("lis", "LIS", 3, func(row triageRecord) *float64 { return row.LIS }),
	scoreColumn("iptm", "ipTM", 2, func(row triageRecord) *float64 { return row.IPTM }),
	scoreColumn("ptm", "pTM", 2, func(row triageRecord) *float64 { return row.PTM }),
	scoreColumn("ranking", "Score", 2, func(row triageRecord) *float64 { return row.RankingScore }),
	scoreColumn("plddt", "pLDDT", 1, func(row triageRecord) *float64 { return row.MeanPLDDT }),
	{metric: "pose", label: "Pose", value: func(row triageRecord) string {
		if row.PoseChecks == nil || row.PoseChecks.Checked == 0 {
			return ""
		}
		return fmt.Sprintf("%d/%d", row.PoseChecks.Passed, row.PoseChecks.Checked)
	}},
	scoreColumn("affinity", "Affinity", 2, func(row triageRecord) *float64 { return row.Affinity }),
	scoreColumn("binder", "P(binder)", 2, func(row triageRecord) *float64 { return row.BinderProbability }),
}

// printRanking writes the first rows as a table: the metric ranked by first, then every other
// score some row has.
func printRanking(out io.Writer, ranking triageRanking, top int) {
	rows := ranking.Rows
	if len(rows) > top {
		rows = rows[:top]
	}
	if len(rows) == 0 {
		fmt.Fprintln(out, "No models to rank.")
		return
	}
	columns := []triageColumn{}
	for _, column := range triageColumns {
		if column.metric == ranking.Metric {
			columns = append([]triageColumn{column}, columns...)
			continue
		}
		for _, row := range rows {
			if column.value(row) != "" {
				columns = append(columns, column)
				break
			}
		}
	}
	pairs := false
	for _, row := range rows {
		if len(row.Chains) == 2 {
			pairs = true
		}
	}
	writer := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	header := []string{"#", "Job", "Model"}
	if pairs {
		header = append(header, "Chains")
	}
	for _, column := range columns {
		header = append(header, column.label)
	}
	fmt.Fprintln(writer, strings.Join(header, "\t"))
	for _, row := range rows {
		cells := []string{strconv.Itoa(row.Position), row.Job, row.Model}
		if pairs {
			cells = append(cells, strings.Join(row.Chains, "–"))
		}
		for _, column := range columns {
			cells = append(cells, column.value(row))
		}
		if row.Problem != nil && *row.Problem != "" {
			cells = append(cells, "⚠ "+*row.Problem)
		}
		fmt.Fprintln(writer, strings.Join(cells, "\t"))
	}
	writer.Flush()
	unit := "jobs"
	if ranking.Level == "models" {
		unit = "models"
	}
	label := ranking.Metric
	for _, column := range triageColumns {
		if column.metric == ranking.Metric {
			label = column.label
		}
	}
	fmt.Fprintf(out, "%d of %d %s, ranked by %s.\n", len(rows), ranking.Total, unit, label)
}

/* ---------- The gallery ---------- */

var unsafeFileName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// writeGallery saves the gallery's images as NN_job_model.png.
func writeGallery(dir string, data json.RawMessage) (int, error) {
	var images []struct {
		Position int    `json:"position"`
		Job      string `json:"job"`
		Model    string `json:"model"`
		Image    string `json:"image"`
	}
	if err := json.Unmarshal(data, &images); err != nil {
		return 0, fmt.Errorf("the gallery could not be read: %w", err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	written := 0
	for _, image := range images {
		match := dataURLImage.FindStringSubmatch(image.Image)
		if match == nil {
			continue
		}
		body, err := base64.StdEncoding.DecodeString(match[2])
		if err != nil {
			return written, fmt.Errorf("image %d: %w", image.Position, err)
		}
		extension := strings.TrimPrefix(match[1], "image/")
		if extension == "jpeg" {
			extension = "jpg"
		}
		stem := strings.Trim(unsafeFileName.ReplaceAllString(fmt.Sprintf("%s_%s", image.Job, image.Model), "_"), "_")
		name := fmt.Sprintf("%02d_%s.%s", image.Position, stem, extension)
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			return written, err
		}
		written++
	}
	return written, nil
}

/* ---------- The hidden browser ---------- */

// findBrowser returns the browser named by --browser or PROTEOSCOPE_BROWSER, else the first
// Chrome, Chromium, Edge or Brave installed.
func findBrowser(named string) (string, error) {
	if named == "" {
		named = os.Getenv("PROTEOSCOPE_BROWSER")
	}
	if named != "" {
		path, err := exec.LookPath(named)
		if err != nil {
			return "", fmt.Errorf("the browser %s cannot be run: %w", named, err)
		}
		return path, nil
	}
	for _, candidate := range browserCandidates() {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", errNoBrowser
}

func browserCandidates() []string {
	switch runtime.GOOS {
	case "darwin":
		apps := []string{
			"Google Chrome.app/Contents/MacOS/Google Chrome",
			"Chromium.app/Contents/MacOS/Chromium",
			"Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"Brave Browser.app/Contents/MacOS/Brave Browser",
		}
		var list []string
		home, _ := os.UserHomeDir()
		for _, app := range apps {
			list = append(list, filepath.Join("/Applications", app))
			if home != "" {
				list = append(list, filepath.Join(home, "Applications", app))
			}
		}
		return list
	case "windows":
		var list []string
		for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")} {
			if root == "" {
				continue
			}
			list = append(list,
				filepath.Join(root, `Google\Chrome\Application\chrome.exe`),
				filepath.Join(root, `Microsoft\Edge\Application\msedge.exe`),
				filepath.Join(root, `BraveSoftware\Brave-Browser\Application\brave.exe`),
				filepath.Join(root, `Chromium\Application\chrome.exe`))
		}
		return append(list, "chrome", "msedge")
	default:
		return []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"}
	}
}

type hiddenBrowser struct {
	cmd     *exec.Cmd
	profile string
	exited  chan error
}

// startHiddenBrowser opens the page in a headless browser with a profile of its own, so it
// neither touches nor waits for the user's browser.
func startHiddenBrowser(path, url string, logs io.Writer) (*hiddenBrowser, error) {
	profile, err := os.MkdirTemp("", "proteoscope-triage-")
	if err != nil {
		return nil, err
	}
	args := []string{
		"--headless=new",
		"--user-data-dir=" + profile,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-extensions",
		"--disable-sync",
		"--mute-audio",
		"--hide-scrollbars",
		fmt.Sprintf("--window-size=%d,%d", triageWindowWidth, triageWindowHeight),
		// WebGPU for the gallery where the browser offers it; the page falls back otherwise.
		"--enable-unsafe-webgpu",
	}
	if runtime.GOOS == "linux" {
		// Containers give /dev/shm little space, and root cannot use Chrome's sandbox.
		args = append(args, "--disable-dev-shm-usage")
		if os.Geteuid() == 0 {
			args = append(args, "--no-sandbox")
		}
	}
	cmd := exec.Command(path, append(args, url)...)
	cmd.Stdout, cmd.Stderr = logs, logs
	cmd.SysProcAttr = browserProcessAttributes()
	if err := cmd.Start(); err != nil {
		os.RemoveAll(profile)
		return nil, fmt.Errorf("could not start %s: %w", path, err)
	}
	browser := &hiddenBrowser{cmd: cmd, profile: profile, exited: make(chan error, 1)}
	go func() { browser.exited <- cmd.Wait() }()
	return browser, nil
}

func (b *hiddenBrowser) stop() {
	if b.cmd.Process != nil {
		b.cmd.Process.Kill()
	}
	select {
	case <-b.exited:
	case <-time.After(5 * time.Second):
	}
	// The browser's helpers may hold the profile a moment longer.
	for attempt := 0; attempt < 10; attempt++ {
		if os.RemoveAll(b.profile) == nil {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}
