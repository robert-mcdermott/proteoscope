package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Remote control, enabled with --remote-control: a script on this computer (for example a
// Jupyter notebook) POSTs a command line to /api/remote/command. The open Proteoscope page
// receives it over Server-Sent Events from /api/remote/events, runs it, and POSTs the outcome
// to /api/remote/result/{id}, which the server returns to the waiting caller. Only connections
// from this computer are accepted, whatever --host the server listens on, and browsers on other
// origins are refused.

const (
	maxRemoteCommandBytes = 64 << 10
	maxRemoteResultBytes  = 64 << 20
	remoteHeartbeat       = 15 * time.Second
)

type remoteHub struct {
	mu      sync.Mutex
	counter uint64
	clients []*remoteClient
	pending map[string]chan remoteResult
	timeout time.Duration
}

type remoteClient struct {
	id     uint64
	events chan remoteEvent
}

type remoteEvent struct {
	ID      string `json:"id"`
	Command string `json:"command"`
}

type remoteResult struct {
	OK      bool            `json:"ok"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func newRemoteHub() *remoteHub {
	return &remoteHub{pending: map[string]chan remoteResult{}, timeout: 2 * time.Minute}
}

func (h *remoteHub) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/remote/events", localOnly(h.serveEvents))
	mux.HandleFunc("POST /api/remote/command", localOnly(h.serveCommand))
	mux.HandleFunc("POST /api/remote/result/{id}", localOnly(h.serveResult))
}

// localOnly refuses connections from other machines. Remote control is for scripts on this
// computer, also when --host serves the page to the network.
func localOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() {
			writeError(w, http.StatusForbidden, "Forbidden: remote control only accepts requests from this computer.")
			return
		}
		next(w, r)
	}
}

func (h *remoteHub) connect() *remoteClient {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.counter++
	client := &remoteClient{id: h.counter, events: make(chan remoteEvent, 16)}
	h.clients = append(h.clients, client)
	return client
}

func (h *remoteHub) disconnect(client *remoteClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for index, item := range h.clients {
		if item == client {
			h.clients = append(h.clients[:index], h.clients[index+1:]...)
			return
		}
	}
}

// Commands go to the most recently opened page.
func (h *remoteHub) latest() *remoteClient {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.clients) == 0 {
		return nil
	}
	return h.clients[len(h.clients)-1]
}

func (h *remoteHub) expect() (string, chan remoteResult) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.counter++
	id := strconv.FormatUint(h.counter, 10)
	result := make(chan remoteResult, 1)
	h.pending[id] = result
	return id, result
}

func (h *remoteHub) take(id string) (chan remoteResult, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	result, ok := h.pending[id]
	delete(h.pending, id)
	return result, ok
}

func (h *remoteHub) serveEvents(w http.ResponseWriter, r *http.Request) {
	// ResponseController reaches the flusher through wrapping writers such as the CSP guard.
	stream := http.NewResponseController(w)
	header := w.Header()
	header.Set("Content-Type", "text/event-stream")
	header.Set("Cache-Control", "no-store")
	header.Set("Connection", "keep-alive")
	fmt.Fprint(w, ": connected\n\n")
	if err := stream.Flush(); err != nil {
		return
	}
	client := h.connect()
	defer h.disconnect(client)
	ticker := time.NewTicker(remoteHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-client.events:
			data, err := json.Marshal(event)
			if err != nil {
				continue
			}
			fmt.Fprintf(w, "event: command\ndata: %s\n\n", data)
			if err := stream.Flush(); err != nil {
				return
			}
		case <-ticker.C:
			fmt.Fprint(w, ": ping\n\n")
			if err := stream.Flush(); err != nil {
				return
			}
		}
	}
}

func (h *remoteHub) serveCommand(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Command string `json:"command"`
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRemoteCommandBytes))
	if err == nil {
		err = json.Unmarshal(body, &request)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, `Send JSON such as {"command": "fetch 4hhb"}.`)
		return
	}
	command := strings.TrimSpace(request.Command)
	if command == "" {
		writeError(w, http.StatusBadRequest, "The command is empty.")
		return
	}
	client := h.latest()
	if client == nil {
		writeError(w, http.StatusServiceUnavailable, "No Proteoscope page is connected. Open Proteoscope in a browser first.")
		return
	}
	id, result := h.expect()
	select {
	case client.events <- remoteEvent{ID: id, Command: command}:
	default:
		h.take(id)
		writeError(w, http.StatusServiceUnavailable, "The Proteoscope page is busy; try again.")
		return
	}
	timer := time.NewTimer(h.timeout)
	defer timer.Stop()
	select {
	case outcome := <-result:
		writeJSON(w, outcome)
	case <-timer.C:
		h.take(id)
		writeError(w, http.StatusGatewayTimeout, "The Proteoscope page did not answer in time.")
	case <-r.Context().Done():
		h.take(id)
	}
}

func (h *remoteHub) serveResult(w http.ResponseWriter, r *http.Request) {
	result, ok := h.take(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "No command is waiting for that result.")
		return
	}
	var outcome remoteResult
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRemoteResultBytes))
	if err == nil {
		err = json.Unmarshal(body, &outcome)
	}
	if err != nil {
		var tooLarge *http.MaxBytesError
		message := "The result could not be read."
		if errors.As(err, &tooLarge) {
			message = "The result is too large."
		}
		outcome = remoteResult{OK: false, Message: message}
	}
	result <- outcome
	w.WriteHeader(http.StatusNoContent)
}
