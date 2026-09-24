package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The server runs behind the same request guard as the real one, so wrapped response writers
// are exercised too.
func remoteServer(t *testing.T, hub *remoteHub) *httptest.Server {
	t.Helper()
	server := httptest.NewUnstartedServer(nil)
	port := server.Listener.Addr().(*net.TCPAddr).Port
	server.Config.Handler = protect(testHandler(t, &app{control: hub}), "127.0.0.1", port)
	server.Start()
	t.Cleanup(server.Close)
	return server
}

func postCommand(t *testing.T, server *httptest.Server, command string) (*http.Response, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"command": command})
	resp, err := http.Post(server.URL+"/api/remote/command", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var decoded map[string]any
	json.NewDecoder(resp.Body).Decode(&decoded)
	return resp, decoded
}

func TestRemoteControlIsOffByDefault(t *testing.T) {
	h := testHandler(t, &app{})
	req := httptest.NewRequest(http.MethodPost, "/api/remote/command", strings.NewReader(`{"command":"help"}`))
	if rec := serve(h, req); rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, want 404 without --remote-control", rec.Code)
	}
	var info startupInfo
	json.Unmarshal(get(h, "/api/startup").Body.Bytes(), &info)
	if info.RemoteControl {
		t.Fatal("startup reports remote control while it is off")
	}
}

func TestRemoteCommandNeedsAConnectedPage(t *testing.T) {
	server := remoteServer(t, newRemoteHub())
	resp, body := postCommand(t, server, "fetch 4hhb")
	if resp.StatusCode != http.StatusServiceUnavailable || !strings.Contains(body["error"].(string), "No Proteoscope page") {
		t.Fatalf("status %d body %v", resp.StatusCode, body)
	}
	bad, err := http.Post(server.URL+"/api/remote/command", "application/json", strings.NewReader(`{"command": "  "}`))
	if err != nil {
		t.Fatal(err)
	}
	bad.Body.Close()
	if bad.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty command: status %d", bad.StatusCode)
	}
}

// A simulated page subscribes to events, runs the command it receives and posts a result,
// which the original caller gets back.
func TestRemoteCommandRoundTrip(t *testing.T) {
	server := remoteServer(t, newRemoteHub())
	events, err := http.Get(server.URL + "/api/remote/events")
	if err != nil {
		t.Fatal(err)
	}
	defer events.Body.Close()
	if got := events.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content type %q", got)
	}
	reader := bufio.NewReader(events.Body)
	pageDone := make(chan error, 1)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				pageDone <- err
				return
			}
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var event remoteEvent
			if err := json.Unmarshal([]byte(strings.TrimPrefix(strings.TrimSpace(line), "data: ")), &event); err != nil {
				pageDone <- err
				return
			}
			reply := `{"ok": true, "message": "ran ` + event.Command + `", "data": {"atoms": 42}}`
			resp, err := http.Post(server.URL+"/api/remote/result/"+event.ID, "application/json", strings.NewReader(reply))
			if err == nil {
				resp.Body.Close()
			}
			pageDone <- err
			return
		}
	}()
	resp, body := postCommand(t, server, "select resn HEM")
	if resp.StatusCode != http.StatusOK || body["ok"] != true || body["message"] != "ran select resn HEM" {
		t.Fatalf("status %d body %v", resp.StatusCode, body)
	}
	if data, _ := body["data"].(map[string]any); data["atoms"] != float64(42) {
		t.Fatalf("data %v", body["data"])
	}
	if err := <-pageDone; err != nil {
		t.Fatal(err)
	}
}

func TestRemoteCommandTimesOutAndUnknownResultsAreRejected(t *testing.T) {
	hub := newRemoteHub()
	hub.timeout = 50 * time.Millisecond
	server := remoteServer(t, hub)
	events, err := http.Get(server.URL + "/api/remote/events")
	if err != nil {
		t.Fatal(err)
	}
	defer events.Body.Close()
	resp, _ := postCommand(t, server, "help")
	if resp.StatusCode != http.StatusGatewayTimeout {
		t.Fatalf("status %d, want 504", resp.StatusCode)
	}
	late, err := http.Post(server.URL+"/api/remote/result/1", "application/json", strings.NewReader(`{"ok": true}`))
	if err != nil {
		t.Fatal(err)
	}
	late.Body.Close()
	if late.StatusCode != http.StatusNotFound {
		t.Fatalf("late result: status %d, want 404", late.StatusCode)
	}
}

func TestRemoteCommandsFromOtherSitesAreRefused(t *testing.T) {
	h := protect(testHandler(t, &app{control: newRemoteHub()}), "127.0.0.1", 8765)
	req := httptest.NewRequest(http.MethodPost, "/api/remote/command", strings.NewReader(`{"command":"fetch 1abc"}`))
	req.Host = "127.0.0.1:8765"
	req.Header.Set("Origin", "https://evil.example")
	if rec := serve(h, req); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin command: status %d, want 403", rec.Code)
	}
}

// With --host 0.0.0.0 the page is served to the network, but remote control still only takes
// requests from this computer.
func TestRemoteControlRefusesOtherMachines(t *testing.T) {
	h := protect(testHandler(t, &app{control: newRemoteHub()}), "0.0.0.0", 8765)
	for _, path := range []string{"/api/remote/command", "/api/remote/result/1"} {
		req := httptest.NewRequest(http.MethodPost, "http://192.168.1.20:8765"+path, strings.NewReader(`{"command":"help"}`))
		req.RemoteAddr = "192.168.1.30:51234"
		if rec := serve(h, req); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "this computer") {
			t.Fatalf("%s from another machine: status %d %s", path, rec.Code, rec.Body.String())
		}
	}
	events := httptest.NewRequest(http.MethodGet, "http://192.168.1.20:8765/api/remote/events", nil)
	events.RemoteAddr = "[fe80::1]:51234"
	if rec := serve(h, events); rec.Code != http.StatusForbidden {
		t.Fatalf("events from another machine: status %d", rec.Code)
	}
	local := httptest.NewRequest(http.MethodPost, "http://192.168.1.20:8765/api/remote/command", strings.NewReader(`{"command":"help"}`))
	local.RemoteAddr = "[::1]:51234"
	if rec := serve(h, local); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("local command: status %d, want 503 (no page connected)", rec.Code)
	}
}
