package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Remote control, enabled with --remote-control: a script on this computer (for example a Jupyter
// notebook) POSTs a command line to /api/remote/command, or paths of files and folders to
// /api/remote/open. The open Proteoscope page receives the request over Server-Sent Events from
// /api/remote/events, runs it, and POSTs the outcome to /api/remote/result/{id}, which the
// server returns to the waiting caller. "proteoscope mcp" uses the same hub from inside the
// process and leaves the two script routes out.
//
// Only requests from this computer that name it in their Host header are accepted, whatever
// --host the server listens on, and browsers on other origins are refused. Opening files by
// path also needs the token printed at startup, since it makes the server read files: another
// user of a shared computer can reach the loopback port but not the owner's terminal.

const (
	maxRemoteCommandBytes = 64 << 10
	maxRemoteResultBytes  = 64 << 20
	remoteHeartbeat       = 15 * time.Second
	openTimeout           = 30 * time.Minute
	remoteTokenHeader     = "X-Proteoscope-Token"
)

type remoteHub struct {
	mu      sync.Mutex
	counter uint64
	clients []*remoteClient
	pending map[string]chan remoteResult
	timeout time.Duration
	// One request at a time reaches the page, which runs commands as they arrive.
	turn chan struct{}
	// connected is closed and replaced whenever a page connects.
	connected chan struct{}
	// open registers local files for the page to read (app.addLocalFiles).
	open func(paths []string) ([]localFile, error)
	// token authorizes /api/remote/open; scripts routes are off in MCP mode.
	token   string
	scripts bool
}

type remoteClient struct {
	id     uint64
	events chan remoteEvent
	done   chan struct{}
}

// An event carries a command line, or files for the page to open.
type remoteEvent struct {
	ID      string      `json:"id"`
	Command string      `json:"command,omitempty"`
	Files   []localFile `json:"files,omitempty"`
	Add     bool        `json:"add,omitempty"`
}

var (
	errNoPage      = errors.New("No Proteoscope page is connected. Open Proteoscope in a browser first.")
	errPageBusy    = errors.New("The Proteoscope page is busy; try again.")
	errPageTimeout = errors.New("The Proteoscope page did not answer in time.")
	errPageGone    = errors.New("The Proteoscope page was closed or reloaded before it answered.")
)

type remoteResult struct {
	OK      bool            `json:"ok"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func newRemoteHub() *remoteHub {
	return &remoteHub{
		pending:   map[string]chan remoteResult{},
		timeout:   2 * time.Minute,
		turn:      make(chan struct{}, 1),
		connected: make(chan struct{}),
		token:     randomToken(),
		scripts:   true,
	}
}

func randomToken() string {
	buffer := make([]byte, 18)
	if _, err := rand.Read(buffer); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buffer)
}

func (h *remoteHub) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/remote/events", localOnly(h.serveEvents))
	mux.HandleFunc("POST /api/remote/result/{id}", localOnly(h.serveResult))
	if h.scripts {
		mux.HandleFunc("POST /api/remote/command", localOnly(h.serveCommand))
		mux.HandleFunc("POST /api/remote/open", localOnly(h.serveOpen))
	}
}

// localOnly refuses requests from other machines and from web pages that reach the loopback
// port under another name (DNS rebinding), also when --host serves the page to the network.
func localOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !isLoopbackRequest(r) {
			writeError(w, http.StatusForbidden, "Forbidden: remote control only accepts requests from this computer, addressed to localhost or 127.0.0.1.")
			return
		}
		next(w, r)
	}
}

func (h *remoteHub) connect() *remoteClient {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.counter++
	client := &remoteClient{id: h.counter, events: make(chan remoteEvent, 16), done: make(chan struct{})}
	h.clients = append(h.clients, client)
	close(h.connected)
	h.connected = make(chan struct{})
	return client
}

// disconnect removes a page; requests it had not answered fail at once.
func (h *remoteHub) disconnect(client *remoteClient) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for index, item := range h.clients {
		if item == client {
			h.clients = append(h.clients[:index], h.clients[index+1:]...)
			close(client.done)
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
	h.respond(w, r, remoteEvent{Command: command})
}

// serveOpen registers files and folders named by path and has the page open them, as if they
// had been named on the command line: {"paths": ["/runs/campaign"], "add": false}, with the
// token printed at startup in the X-Proteoscope-Token header.
func (h *remoteHub) serveOpen(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get(remoteTokenHeader)), []byte(h.token)) != 1 {
		writeError(w, http.StatusUnauthorized, "Opening files needs the X-Proteoscope-Token header with the token Proteoscope printed when it started.")
		return
	}
	var request struct {
		Paths []string `json:"paths"`
		Add   bool     `json:"add"`
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRemoteCommandBytes))
	if err == nil {
		err = json.Unmarshal(body, &request)
	}
	if err != nil || len(request.Paths) == 0 {
		writeError(w, http.StatusBadRequest, `Send JSON such as {"paths": ["/path/to/prediction/folder"]}.`)
		return
	}
	// Nothing is read until a page is there to open it.
	if h.latest() == nil {
		writeError(w, http.StatusServiceUnavailable, errNoPage.Error())
		return
	}
	event, err := h.openEvent(request.Paths, request.Add)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.respond(w, r, event)
}

func (h *remoteHub) openEvent(paths []string, add bool) (remoteEvent, error) {
	if h.open == nil {
		return remoteEvent{}, errors.New("Opening files by path is not available.")
	}
	files, err := h.open(paths)
	if err != nil {
		return remoteEvent{}, err
	}
	return remoteEvent{Files: files, Add: add}, nil
}

func (h *remoteHub) respond(w http.ResponseWriter, r *http.Request, event remoteEvent) {
	outcome, err := h.dispatch(r.Context(), event)
	switch {
	case err == nil:
		writeJSON(w, outcome)
	case errors.Is(err, errPageTimeout):
		writeError(w, http.StatusGatewayTimeout, err.Error())
	case errors.Is(err, errNoPage), errors.Is(err, errPageBusy), errors.Is(err, errPageGone):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// The caller went away; nobody reads the answer.
	default:
		writeError(w, http.StatusBadGateway, err.Error())
	}
}

// dispatch sends an event to the most recently opened page and waits for its result. Requests
// reach the page one at a time; one that waits its turn can still be cancelled.
func (h *remoteHub) dispatch(ctx context.Context, event remoteEvent) (remoteResult, error) {
	select {
	case h.turn <- struct{}{}:
	case <-ctx.Done():
		return remoteResult{}, ctx.Err()
	}
	defer func() { <-h.turn }()
	client := h.latest()
	if client == nil {
		return remoteResult{}, errNoPage
	}
	id, result := h.expect()
	event.ID = id
	select {
	case client.events <- event:
	default:
		h.take(id)
		return remoteResult{}, errPageBusy
	}
	// Opening files can mean scoring a whole design campaign.
	limit := h.timeout
	if len(event.Files) > 0 && limit < openTimeout {
		limit = openTimeout
	}
	timer := time.NewTimer(limit)
	defer timer.Stop()
	select {
	case outcome := <-result:
		return outcome, nil
	case <-client.done:
		h.take(id)
		return remoteResult{}, errPageGone
	case <-timer.C:
		h.take(id)
		return remoteResult{}, errPageTimeout
	case <-ctx.Done():
		h.take(id)
		return remoteResult{}, ctx.Err()
	}
}

// waitForPage waits until a page is connected, for example one the browser is still opening.
func (h *remoteHub) waitForPage(ctx context.Context, limit time.Duration) bool {
	timer := time.NewTimer(limit)
	defer timer.Stop()
	for {
		h.mu.Lock()
		connected, ready := h.connected, len(h.clients) > 0
		h.mu.Unlock()
		if ready {
			return true
		}
		select {
		case <-connected:
		case <-timer.C:
			return false
		case <-ctx.Done():
			return false
		}
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
