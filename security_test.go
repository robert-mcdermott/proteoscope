package main

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("ok"))
	})
}

func guardedRequest(h http.Handler, host, target string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Host = host
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	return serve(h, req)
}

func TestGuardRejectsUnknownHosts(t *testing.T) {
	h := protect(okHandler(), "127.0.0.1", 8765)
	cases := map[string]int{
		"127.0.0.1:8765":          http.StatusOK,
		"localhost:8765":          http.StatusOK,
		"LocalHost:8765":          http.StatusOK,
		"[::1]:8765":              http.StatusOK,
		"localhost":               http.StatusOK,
		"evil.example:8765":       http.StatusForbidden,
		"127.0.0.1.nip.io:8765":   http.StatusForbidden,
		"localhost.evil.example":  http.StatusForbidden,
		"attacker.localhost:8765": http.StatusForbidden,
		"192.168.1.20:8765":       http.StatusForbidden,
		"":                        http.StatusForbidden,
	}
	for host, want := range cases {
		if rec := guardedRequest(h, host, "/", nil); rec.Code != want {
			t.Errorf("Host %q: status %d, want %d", host, rec.Code, want)
		}
	}

	custom := protect(okHandler(), "192.168.1.20", 8765)
	if rec := guardedRequest(custom, "192.168.1.20:8765", "/api/health", nil); rec.Code != http.StatusOK {
		t.Errorf("explicit --host: status %d", rec.Code)
	}
	if rec := guardedRequest(custom, "10.0.0.1:8765", "/", nil); rec.Code != http.StatusForbidden {
		t.Errorf("other LAN host: status %d", rec.Code)
	}
}

func TestGuardWildcardBindServesOtherMachines(t *testing.T) {
	h := protect(okHandler(), "0.0.0.0", 8765)
	if rec := guardedRequest(h, "192.168.1.20:8765", "/", nil); rec.Code != http.StatusOK {
		t.Errorf("LAN host on wildcard bind: status %d", rec.Code)
	}
	same := map[string]string{"Origin": "http://192.168.1.20:8765"}
	if rec := guardedRequest(h, "192.168.1.20:8765", "/api/health", same); rec.Code != http.StatusOK {
		t.Errorf("same-origin API on wildcard bind: status %d", rec.Code)
	}
	cross := map[string]string{"Origin": "http://evil.example"}
	if rec := guardedRequest(h, "192.168.1.20:8765", "/api/health", cross); rec.Code != http.StatusForbidden {
		t.Errorf("cross-origin API on wildcard bind: status %d", rec.Code)
	}
}

func TestGuardRejectsCrossOriginAPIRequests(t *testing.T) {
	h := protect(okHandler(), "127.0.0.1", 8765)
	for _, origin := range []string{"http://127.0.0.1:8765", "http://localhost:8765", "http://[::1]:8765"} {
		if rec := guardedRequest(h, "127.0.0.1:8765", "/api/health", map[string]string{"Origin": origin}); rec.Code != http.StatusOK {
			t.Errorf("Origin %q: status %d, want 200", origin, rec.Code)
		}
	}
	for _, origin := range []string{
		"http://evil.example",
		"http://127.0.0.1:9999",
		"https://127.0.0.1:8765",
		"http://127.0.0.1:8765/",
		"http://user@localhost:8765",
		"null",
	} {
		rec := guardedRequest(h, "127.0.0.1:8765", "/api/fetch/pdb/1crn", map[string]string{"Origin": origin})
		if rec.Code != http.StatusForbidden || errorMessage(t, rec) == "" {
			t.Errorf("Origin %q: status %d, want 403", origin, rec.Code)
		}
	}
	if rec := guardedRequest(h, "127.0.0.1:8765", "/", map[string]string{"Origin": "http://evil.example"}); rec.Code != http.StatusOK {
		t.Errorf("non-API request with foreign Origin: status %d, want 200", rec.Code)
	}
	for site, want := range map[string]int{"same-origin": http.StatusOK, "none": http.StatusOK, "same-site": http.StatusForbidden, "cross-site": http.StatusForbidden} {
		if rec := guardedRequest(h, "localhost:8765", "/api/local/0", map[string]string{"Sec-Fetch-Site": site}); rec.Code != want {
			t.Errorf("Sec-Fetch-Site %q: status %d, want %d", site, rec.Code, want)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := protect(testHandler(t, &app{}), "127.0.0.1", 8765)
	common := map[string]string{
		"X-Content-Type-Options":     "nosniff",
		"Referrer-Policy":            "no-referrer",
		"Cross-Origin-Opener-Policy": "same-origin",
	}

	page := guardedRequest(h, "127.0.0.1:8765", "/", nil)
	if page.Code != http.StatusOK {
		t.Fatalf("index: status %d", page.Code)
	}
	assertHeaders(t, page, common)
	assertHeaders(t, page, map[string]string{"Content-Security-Policy": contentSecurityPolicy})

	api := guardedRequest(h, "127.0.0.1:8765", "/api/health", nil)
	assertHeaders(t, api, common)
	assertHeaders(t, api, map[string]string{"Content-Security-Policy": ""})

	rejected := guardedRequest(h, "evil.example", "/", nil)
	if rejected.Code != http.StatusForbidden {
		t.Fatalf("rejected host: status %d", rejected.Code)
	}
	assertHeaders(t, rejected, common)
}

func TestServerWiringUsesListenPort(t *testing.T) {
	listener, port, err := listen("127.0.0.1", 0)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(protect(testHandler(t, &app{}), "127.0.0.1", port))
	server.Listener.Close()
	server.Listener = listener
	server.Start()
	defer server.Close()

	if want := "http://127.0.0.1:" + strconv.Itoa(port); server.URL != want {
		t.Fatalf("server URL %s, want %s", server.URL, want)
	}
	for origin, want := range map[string]int{
		"http://localhost:" + strconv.Itoa(port): http.StatusOK,
		"http://localhost:1":                     http.StatusForbidden,
	} {
		req, err := http.NewRequest(http.MethodGet, "http://localhost:"+strconv.Itoa(port)+"/api/startup", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", origin)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("Origin %s: status %d, want %d", origin, resp.StatusCode, want)
		}
	}
}
