package main

import (
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; font-src 'self' data:; " +
	"object-src 'none'; base-uri 'none'; frame-ancestors 'none'"

type guard struct {
	next    http.Handler
	hosts   map[string]bool
	port    string
	anyHost bool
}

type cspWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func protect(next http.Handler, bindHost string, port int) http.Handler {
	hosts := map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}
	host := normalizeHost(bindHost)
	if host != "" {
		hosts[host] = true
	}
	// A wildcard bind is an explicit choice to serve other machines, whose Host header is
	// any address of this machine; DNS-rebinding protection only applies to loopback binds.
	anyHost := host == "0.0.0.0" || host == "::"
	return &guard{next: next, hosts: hosts, port: strconv.Itoa(port), anyHost: anyHost}
}

func (g *guard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("Cross-Origin-Opener-Policy", "same-origin")
	header.Set("Cross-Origin-Resource-Policy", "same-origin")
	w = &cspWriter{ResponseWriter: w}
	switch {
	case !g.anyHost && !g.hosts[requestHostname(r.Host)]:
		writeError(w, http.StatusForbidden, "Forbidden: unrecognized Host header.")
	case strings.HasPrefix(r.URL.Path, "/api/") && !g.sameOrigin(r):
		writeError(w, http.StatusForbidden, "Forbidden: cross-origin API request.")
	default:
		g.next.ServeHTTP(w, r)
	}
}

func (g *guard) sameOrigin(r *http.Request) bool {
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
	default:
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if g.anyHost {
		return strings.EqualFold(origin, "http://"+r.Host)
	}
	return g.allowedOrigin(origin)
}

func (g *guard) allowedOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.Host == "" || origin != "http://"+u.Host {
		return false
	}
	port := u.Port()
	if port == "" {
		port = "80"
	}
	return port == g.port && g.hosts[normalizeHost(u.Hostname())]
}

// isLoopbackRequest reports whether a request comes from this computer and names it: a loopback
// peer and a loopback Host header, so neither another machine nor a web page that rebinds its
// own domain to 127.0.0.1 passes, whatever --host the server listens on.
func isLoopbackRequest(r *http.Request) bool {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(peer); err != nil || ip == nil || !ip.IsLoopback() {
		return false
	}
	return isLoopbackName(requestHostname(r.Host))
}

func isLoopbackName(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func requestHostname(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return normalizeHost(host)
	}
	return normalizeHost(hostport)
}

func normalizeHost(host string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimPrefix(host, "["), "]"))
}

func (w *cspWriter) WriteHeader(status int) {
	if !w.wroteHeader {
		w.wroteHeader = true
		if strings.HasPrefix(w.Header().Get("Content-Type"), "text/html") {
			w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *cspWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *cspWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
