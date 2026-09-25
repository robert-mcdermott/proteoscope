package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// runMCPLines feeds JSON-RPC lines to a server and returns its replies, one decoded object each.
func runMCPLines(t *testing.T, server *mcpServer, lines ...string) []map[string]any {
	t.Helper()
	var out bytes.Buffer
	server.out = &out
	if err := server.serveStream(context.Background(), strings.NewReader(strings.Join(lines, "\n")+"\n")); err != nil {
		t.Fatal(err)
	}
	var replies []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if line == "" {
			continue
		}
		var reply map[string]any
		if err := json.Unmarshal([]byte(line), &reply); err != nil {
			t.Fatalf("reply %q: %v", line, err)
		}
		replies = append(replies, reply)
	}
	return replies
}

// fakePage answers the next events like the Proteoscope page would, recording what it was asked.
func fakePage(t *testing.T, hub *remoteHub, answer func(remoteEvent) remoteResult) <-chan remoteEvent {
	t.Helper()
	client := hub.connect()
	seen := make(chan remoteEvent, 8)
	go func() {
		for {
			select {
			case <-client.done:
				return
			case event := <-client.events:
				seen <- event
				if answer == nil {
					continue
				}
				if result, ok := hub.take(event.ID); ok {
					result <- answer(event)
				}
			}
		}
	}()
	t.Cleanup(func() { hub.disconnect(client) })
	return seen
}

func call(id int, name string, args string) string {
	return `{"jsonrpc":"2.0","id":` + itoa(id) + `,"method":"tools/call","params":{"name":"` + name + `","arguments":` + args + `}}`
}

func itoa(value int) string {
	data, _ := json.Marshal(value)
	return string(data)
}

func resultOf(t *testing.T, reply map[string]any) map[string]any {
	t.Helper()
	result, ok := reply["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result in %v", reply)
	}
	return result
}

func TestMCPInitializeListsToolsAndAnswersPing(t *testing.T) {
	server := &mcpServer{hub: newRemoteHub(), url: "http://127.0.0.1:8765", pageWait: time.Millisecond}
	replies := runMCPLines(t, server,
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"ping"}`,
		`{"jsonrpc":"2.0","id":4,"method":"resources/list"}`,
		`not json`,
	)
	if len(replies) != 5 {
		t.Fatalf("%d replies, want 5 (the notification gets none): %v", len(replies), replies)
	}
	init := resultOf(t, replies[0])
	if init["protocolVersion"] != "2025-06-18" || init["serverInfo"].(map[string]any)["name"] != "proteoscope" {
		t.Fatalf("initialize: %v", init)
	}
	if _, ok := init["capabilities"].(map[string]any)["tools"]; !ok {
		t.Fatal("tools capability missing")
	}
	tools := resultOf(t, replies[1])["tools"].([]any)
	names := map[string]bool{}
	for _, item := range tools {
		tool := item.(map[string]any)
		names[tool["name"].(string)] = true
		if tool["inputSchema"].(map[string]any)["type"] != "object" || tool["description"] == "" {
			t.Fatalf("tool %v lacks a schema or description", tool["name"])
		}
	}
	for _, name := range []string{"open_structure", "open_files", "describe_structure", "select_residues", "get_interactions", "superpose", "validation_report", "rank_predictions", "render_image", "proteoscope_command"} {
		if !names[name] {
			t.Errorf("tool %s missing", name)
		}
	}
	if len(resultOf(t, replies[2])) != 0 {
		t.Fatalf("ping: %v", replies[2])
	}
	if replies[3]["error"].(map[string]any)["code"] != float64(-32601) {
		t.Fatalf("unknown method: %v", replies[3])
	}
	if replies[4]["error"].(map[string]any)["code"] != float64(-32700) {
		t.Fatalf("bad JSON: %v", replies[4])
	}
	if negotiateVersion("1999-01-01") != mcpProtocolVersions[0] {
		t.Fatal("an unknown version should get the newest supported one")
	}
}

// Each tool becomes one command line in the page; the page's data comes back as structured content.
func TestMCPToolsRunCommandsInThePage(t *testing.T) {
	hub := newRemoteHub()
	seen := fakePage(t, hub, func(event remoteEvent) remoteResult {
		return remoteResult{OK: true, Message: "ran " + event.Command, Data: json.RawMessage(`{"residues":3}`)}
	})
	server := &mcpServer{hub: hub, url: "http://127.0.0.1:8765", pageWait: time.Second}
	cases := []struct{ tool, args, command string }{
		{"select_residues", `{"selection":"resn HEM"}`, "select resn HEM"},
		{"open_structure", `{"id":"1M17"}`, "fetch 1M17"},
		{"open_structure", `{"id":"P04637","add":true}`, "add P04637"},
		{"get_interactions", `{"selection":"resn STI"}`, "interactions resn STI"},
		{"interface_contacts", `{"chain_a":"A","chain_b":"B"}`, "interface A B"},
		{"superpose", `{"moving":"1AKE","reference":"4AKE","fit":"/A:1-29"}`, "superpose 1AKE onto 4AKE fit /A:1-29"},
		{"superpose", `{"moving":"all","method":"structure"}`, "tmalign all"},
		{"rank_predictions", `{"metric":"pdockq2","limit":5,"level":"models","chains":["A","B"]}`, "triage by pdockq2 top 5 models pair A B"},
		{"rank_predictions", `{}`, "triage by auto top 20 jobs best"},
		{"describe_structure", `{}`, "info"},
		{"validation_report", `{}`, "validate"},
		{"proteoscope_command", `{"command":"color plddt"}`, "color plddt"},
	}
	for index, item := range cases {
		replies := runMCPLines(t, server, call(index+1, item.tool, item.args))
		result := resultOf(t, replies[0])
		if result["isError"] == true {
			t.Fatalf("%s: %v", item.tool, result)
		}
		if event := <-seen; event.Command != item.command {
			t.Fatalf("%s sent %q, want %q", item.tool, event.Command, item.command)
		}
		structured := result["structuredContent"].(map[string]any)
		if structured["message"] != "ran "+item.command || structured["data"].(map[string]any)["residues"] != float64(3) {
			t.Fatalf("%s: structured content %v", item.tool, structured)
		}
		text := result["content"].([]any)[0].(map[string]any)["text"].(string)
		if !strings.Contains(text, `"residues":3`) {
			t.Fatalf("%s: text %q lacks the data", item.tool, text)
		}
	}
}

func TestMCPRenderImageReturnsAPNG(t *testing.T) {
	hub := newRemoteHub()
	seen := fakePage(t, hub, func(event remoteEvent) remoteResult {
		return remoteResult{OK: true, Message: "Rendered 10 × 10 PNG.", Data: json.RawMessage(`{"image":"data:image/png;base64,iVBORw0KGgo=","width":10,"height":10}`)}
	})
	server := &mcpServer{hub: hub, url: "http://127.0.0.1:8765", pageWait: time.Second}
	result := resultOf(t, runMCPLines(t, server, call(1, "render_image", `{"scale":2,"transparent":true}`))[0])
	if event := <-seen; event.Command != "png 2 transparent" {
		t.Fatalf("command %q", event.Command)
	}
	image := result["content"].([]any)[0].(map[string]any)
	if image["type"] != "image" || image["mimeType"] != "image/png" || image["data"] != "iVBORw0KGgo=" {
		t.Fatalf("image content %v", image)
	}
}

func TestMCPToolErrors(t *testing.T) {
	hub := newRemoteHub()
	server := &mcpServer{hub: hub, url: "http://127.0.0.1:8765", pageWait: 20 * time.Millisecond}
	errorText := func(reply map[string]any) string {
		result := resultOf(t, reply)
		if result["isError"] != true {
			t.Fatalf("expected a tool error: %v", result)
		}
		return result["content"].([]any)[0].(map[string]any)["text"].(string)
	}
	replies := runMCPLines(t, server,
		call(1, "select_residues", `{"selection":"resn HEM"}`),
		call(2, "select_residues", `{}`),
		call(3, "select_residues", `{"selection":"resn HEM\nfetch 1abc"}`),
		call(4, "open_structure", `{"id":"1M17; rm"}`),
		call(5, "interface_contacts", `{"chain_a":"A","chain_b":"B C"}`),
		call(6, "superpose", `{"moving":"1AKE","method":"structure","fit":"/A:1-20"}`),
		`{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"no_such_tool","arguments":{}}}`,
	)
	byID := map[float64]map[string]any{}
	for _, reply := range replies {
		byID[reply["id"].(float64)] = reply
	}
	if text := errorText(byID[1]); !strings.Contains(text, "No Proteoscope page") || !strings.Contains(text, "http://127.0.0.1:8765") {
		t.Fatalf("no page: %q", text)
	}
	for id, want := range map[float64]string{2: "selection is required", 3: "single line", 4: "PDB ID or UniProt", 5: "chain IDs", 6: "sequence method only"} {
		if text := errorText(byID[id]); !strings.Contains(text, want) {
			t.Fatalf("call %v: %q lacks %q", id, text, want)
		}
	}
	if byID[7]["error"].(map[string]any)["code"] != float64(-32602) {
		t.Fatalf("unknown tool: %v", byID[7])
	}
	// A failed command is a tool error with the page's message.
	fakePage(t, hub, func(event remoteEvent) remoteResult {
		return remoteResult{OK: false, Message: "Open a structure first."}
	})
	if text := errorText(runMCPLines(t, server, call(8, "describe_structure", `{}`))[0]); text != "Open a structure first." {
		t.Fatalf("failed command: %q", text)
	}
}

func predictionFolder(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "campaign")
	for _, job := range []string{"binder_1", "binder_2"} {
		if err := os.MkdirAll(filepath.Join(dir, job), 0o755); err != nil {
			t.Fatal(err)
		}
		for name, body := range map[string]string{job + "_model.cif": "data_x\n", job + "_summary_confidences.json": "{}", "notes.txt": "skip"} {
			if err := os.WriteFile(filepath.Join(dir, job, name), []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	return dir
}

// open_files registers the files with the server, which serves them to the page, and sends
// the page their list; relative and missing paths are refused.
func TestMCPOpenFilesRegistersLocalFiles(t *testing.T) {
	a := &app{files: []localFile{}}
	hub := newRemoteHub()
	hub.open = a.addLocalFiles
	a.control = hub
	seen := fakePage(t, hub, func(event remoteEvent) remoteResult {
		return remoteResult{OK: true, Message: "Opened 2 prediction jobs.", Data: json.RawMessage(`{"jobs":2}`)}
	})
	server := &mcpServer{hub: hub, url: "http://127.0.0.1:8765", pageWait: time.Second}
	dir := predictionFolder(t)
	result := resultOf(t, runMCPLines(t, server, call(1, "open_files", `{"paths":[`+string(mustJSON(dir))+`]}`))[0])
	if result["isError"] == true {
		t.Fatalf("open_files: %v", result)
	}
	event := <-seen
	if event.Command != "" || len(event.Files) != 4 {
		t.Fatalf("event %+v, want the 4 structure and JSON files", event)
	}
	for _, file := range event.Files {
		if !strings.HasPrefix(file.Path, "campaign/binder_") || !strings.HasPrefix(file.URL, "/api/local/") {
			t.Fatalf("file %+v", file)
		}
	}
	if len(a.localFiles()) != 4 {
		t.Fatalf("%d files registered", len(a.localFiles()))
	}
	h := testHandler(t, a)
	local := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8765"+event.Files[0].URL, nil)
	local.RemoteAddr = "127.0.0.1:50000"
	if rec := serve(h, local); rec.Code != http.StatusOK {
		t.Fatalf("serving a registered file: %d", rec.Code)
	}
	// Files opened while running are served only to this computer.
	for _, request := range []struct{ host, remote string }{{"192.168.1.20:8765", "192.168.1.9:50000"}, {"evil.example:8765", "127.0.0.1:50000"}} {
		req := httptest.NewRequest(http.MethodGet, "http://"+request.host+event.Files[0].URL, nil)
		req.RemoteAddr = request.remote
		if rec := serve(h, req); rec.Code != http.StatusNotFound {
			t.Fatalf("%v: status %d, want 404", request, rec.Code)
		}
	}
	// Opening the same folder again reuses the registrations.
	again := resultOf(t, runMCPLines(t, server, call(3, "open_files", `{"paths":[`+string(mustJSON(dir))+`]}`))[0])
	if again["isError"] == true || len(a.localFiles()) != 4 {
		t.Fatalf("second open: %v, %d files registered", again, len(a.localFiles()))
	}
	if repeat := <-seen; repeat.Files[0].URL != event.Files[0].URL {
		t.Fatalf("second open used %s, first %s", repeat.Files[0].URL, event.Files[0].URL)
	}
	// Files opened later are not reopened when the page reloads.
	a.startupFiles = []localFile{}
	var info startupInfo
	json.Unmarshal(get(h, "/api/startup").Body.Bytes(), &info)
	if len(info.Files) != 0 {
		t.Fatalf("startup lists %d files", len(info.Files))
	}
	for _, args := range []string{`{"paths":["relative/path"]}`, `{"paths":[` + string(mustJSON(filepath.Join(dir, "missing"))) + `]}`, `{"paths":[]}`} {
		failed := resultOf(t, runMCPLines(t, server, call(2, "open_files", args))[0])
		if failed["isError"] != true {
			t.Fatalf("%s should fail: %v", args, failed)
		}
	}
}

func mustJSON(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}

// POST /api/remote/open does the same for scripts, from this computer only.
func TestRemoteOpenEndpoint(t *testing.T) {
	a := &app{files: []localFile{}}
	hub := newRemoteHub()
	hub.open = a.addLocalFiles
	a.control = hub
	seen := fakePage(t, hub, func(event remoteEvent) remoteResult {
		return remoteResult{OK: true, Message: "Opened.", Data: json.RawMessage(`{"files":` + itoa(len(event.Files)) + `}`)}
	})
	h := protect(testHandler(t, a), "127.0.0.1", 8765)
	post := func(body, remote string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/remote/open", strings.NewReader(body))
		req.RemoteAddr = remote
		req.Header.Set(remoteTokenHeader, hub.token)
		return serve(h, req)
	}
	dir := predictionFolder(t)
	rec := post(`{"paths":[`+string(mustJSON(dir))+`],"add":true}`, "127.0.0.1:50000")
	var opened struct {
		OK   bool `json:"ok"`
		Data struct {
			Files int `json:"files"`
		} `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &opened)
	if rec.Code != http.StatusOK || !opened.OK || opened.Data.Files != 4 {
		t.Fatalf("open: %d %s", rec.Code, rec.Body.String())
	}
	if event := <-seen; !event.Add || len(event.Files) != 4 {
		t.Fatalf("event %+v", event)
	}
	if rec := post(`{"paths":["nope"]}`, "127.0.0.1:50000"); rec.Code != http.StatusBadRequest {
		t.Fatalf("relative path: %d", rec.Code)
	}
	if rec := post(`{}`, "127.0.0.1:50000"); rec.Code != http.StatusBadRequest {
		t.Fatalf("no paths: %d", rec.Code)
	}
	if rec := post(`{"paths":[`+string(mustJSON(dir))+`]}`, "192.168.1.9:50000"); rec.Code != http.StatusForbidden {
		t.Fatalf("another machine: %d", rec.Code)
	}
	// Without the token printed at startup, nothing is read.
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765/api/remote/open", strings.NewReader(`{"paths":[`+string(mustJSON(dir))+`]}`))
	req.RemoteAddr = "127.0.0.1:50000"
	if rec := serve(h, req); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: %d", rec.Code)
	}
	req.Header.Set(remoteTokenHeader, "guess")
	if rec := serve(h, req); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d", rec.Code)
	}
}

// In MCP mode the agent talks to the hub in-process; scripts cannot post commands or paths.
func TestMCPModeLeavesOutTheScriptRoutes(t *testing.T) {
	hub := newRemoteHub()
	hub.scripts = false
	h := protect(testHandler(t, &app{control: hub}), "127.0.0.1", 8765)
	for _, path := range []string{"/api/remote/command", "/api/remote/open"} {
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8765"+path, strings.NewReader(`{}`))
		req.RemoteAddr = "127.0.0.1:50000"
		if rec := serve(h, req); rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status %d, want 404", path, rec.Code)
		}
	}
}

// A page that closes or reloads fails the request it had not answered, at once.
func TestDispatchFailsWhenThePageGoes(t *testing.T) {
	hub := newRemoteHub()
	client := hub.connect()
	go func() {
		<-client.events
		hub.disconnect(client)
	}()
	started := time.Now()
	_, err := hub.dispatch(context.Background(), remoteEvent{Command: "fetch 1abc"})
	if !errors.Is(err, errPageGone) || time.Since(started) > time.Second {
		t.Fatalf("err %v after %v", err, time.Since(started))
	}
}

// Requests reach the page one at a time: the next is sent only after the page answered.
func TestDispatchRunsOneRequestAtATime(t *testing.T) {
	hub := newRemoteHub()
	client := hub.connect()
	defer hub.disconnect(client)
	var mu sync.Mutex
	outstanding, most := 0, 0
	go func() {
		for {
			select {
			case <-client.done:
				return
			case event := <-client.events:
				mu.Lock()
				outstanding++
				most = max(most, outstanding)
				mu.Unlock()
				go func(id string) {
					time.Sleep(10 * time.Millisecond)
					mu.Lock()
					outstanding--
					mu.Unlock()
					if result, ok := hub.take(id); ok {
						result <- remoteResult{OK: true}
					}
				}(event.ID)
			}
		}
	}()
	var wg sync.WaitGroup
	for index := 0; index < 5; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := hub.dispatch(context.Background(), remoteEvent{Command: "info"}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if most != 1 {
		t.Fatalf("the page had %d requests at once", most)
	}
}

// Protocol edge cases: batches, responses, cancellation and an input that ends mid-call.
func TestMCPProtocolEdges(t *testing.T) {
	hub := newRemoteHub()
	seen := fakePage(t, hub, nil) // a page that never answers
	server := &mcpServer{hub: hub, url: "http://127.0.0.1:8765", pageWait: time.Second}
	var out bytes.Buffer
	server.out = &out
	reader, writer := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- server.serveStream(context.Background(), reader) }()
	write := func(line string) { writer.Write([]byte(line + "\n")) }
	write(`[{"jsonrpc":"2.0","id":1,"method":"ping"}]`)
	write(`{"jsonrpc":"2.0","id":2,"result":{}}`)
	write(`{"id":3,"method":"ping"}`)
	write(call(4, "describe_structure", `{}`))
	<-seen
	write(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":4}}`)
	write(call(5, "describe_structure", `{}`))
	<-seen
	started := time.Now()
	writer.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if time.Since(started) > mcpEndGrace+time.Second {
		t.Fatalf("the stream took %v to end with a call in flight", time.Since(started))
	}
	var replies []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		var reply map[string]any
		json.Unmarshal([]byte(line), &reply)
		replies = append(replies, reply)
	}
	if len(replies) != 2 {
		t.Fatalf("replies %v: want the batch error and the jsonrpc error only (the response is ignored, cancelled calls get no answer)", replies)
	}
	if replies[0]["error"].(map[string]any)["code"] != float64(-32600) || replies[1]["id"] != float64(3) || replies[1]["error"].(map[string]any)["code"] != float64(-32600) {
		t.Fatalf("replies %v", replies)
	}
}

func TestReadLineSkipsOverlongLines(t *testing.T) {
	reader := bufio.NewReaderSize(strings.NewReader(strings.Repeat("x", 100)+"\n{\"ok\":1}\n"), 16)
	if _, err := readLine(reader, 50); !errors.Is(err, errLineTooLong) {
		t.Fatalf("err %v", err)
	}
	line, err := readLine(reader, 50)
	if err != nil || string(line) != `{"ok":1}` {
		t.Fatalf("next line %q, %v", line, err)
	}
}

func TestMCPCommandLine(t *testing.T) {
	var out, errs bytes.Buffer
	if code := runMCP([]string{"--version"}, strings.NewReader(""), &out, &errs); code != 0 || !strings.HasPrefix(out.String(), "proteoscope ") {
		t.Fatalf("--version: %d %q", code, out.String())
	}
	out.Reset()
	if code := runMCP([]string{"--host", "0.0.0.0"}, strings.NewReader(""), &out, &errs); code != 2 || out.Len() != 0 || !strings.Contains(errs.String(), "only this computer") {
		t.Fatalf("--host 0.0.0.0: %d stdout %q stderr %q", code, out.String(), errs.String())
	}
}

func TestMCPCommandImagesBecomeImageContent(t *testing.T) {
	hub := newRemoteHub()
	fakePage(t, hub, func(event remoteEvent) remoteResult {
		return remoteResult{OK: true, Message: "Rendered 2 models.", Data: json.RawMessage(`[
			{"position":1,"job":"aurka_tpx2","model":"Model 0","metric":"ipSAE","score":0.8665,"image":"data:image/jpeg;base64,/9j/AAAA"},
			{"position":2,"job":"raf1_ksr1","model":"Rank 1","metric":"ipSAE","score":0.5978,"image":"data:image/jpeg;base64,/9j/BBBB"}]`)}
	})
	server := &mcpServer{hub: hub, url: "http://127.0.0.1:8765", pageWait: time.Second}
	result := resultOf(t, runMCPLines(t, server, call(1, "proteoscope_command", `{"command":"triage gallery 2"}`))[0])
	content := result["content"].([]any)
	if len(content) != 5 {
		t.Fatalf("want the answer and two captioned images, got %d blocks: %v", len(content), content)
	}
	text := content[0].(map[string]any)["text"].(string)
	if strings.Contains(text, "base64") || !strings.Contains(text, `"image":1`) {
		t.Fatalf("the text should number the images, not carry them: %q", text)
	}
	if caption := content[1].(map[string]any)["text"]; caption != "Image 1: #1, aurka_tpx2, Model 0, ipSAE 0.87" {
		t.Fatalf("caption %q", caption)
	}
	image := content[4].(map[string]any)
	if image["type"] != "image" || image["mimeType"] != "image/jpeg" || image["data"] != "/9j/BBBB" {
		t.Fatalf("image %v", image)
	}
	rows := result["structuredContent"].(map[string]any)["data"].([]any)
	if rows[1].(map[string]any)["image"] != float64(2) {
		t.Fatalf("structured content should hold the image's number: %v", rows[1])
	}
}

func TestExtractImagesKeepsResultsWithinTheLimit(t *testing.T) {
	big := "data:image/png;base64," + strings.Repeat("A", mcpImageLimit/2+8)
	data, images, dropped := extractImages(map[string]any{"a": big, "b": big, "c": []any{"text", "data:text/plain;base64,QQ=="}})
	fields := data.(map[string]any)
	if len(images) != 1 || dropped != 1 {
		t.Fatalf("want one image and one left out, got %d and %d", len(images), dropped)
	}
	if (fields["a"] == nil) == (fields["b"] == nil) {
		t.Fatalf("one image should be numbered and the other null: %v, %v", fields["a"], fields["b"])
	}
	if list := fields["c"].([]any); list[1] != "data:text/plain;base64,QQ==" {
		t.Fatalf("only images are taken out: %v", list)
	}
}
