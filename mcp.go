package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"sync"
	"time"
)

// "proteoscope mcp" is a Model Context Protocol server for AI agents. It starts Proteoscope as
// usual, with remote control on, and answers the agent's JSON-RPC requests on stdin and stdout.
// Each tool runs Proteoscope commands in the open page, as remote control does, and returns what
// they report as structured content; render_image returns a PNG. The banner and logs go to stderr,
// since stdout carries the protocol. When the agent closes stdin, Proteoscope stops.

var mcpProtocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}

const (
	mcpMaxLine      = 64 << 20
	mcpTextLimit    = 200_000
	mcpImageLimit   = 8 << 20
	mcpPageWait     = 30 * time.Second
	mcpReopenAfter  = 20 * time.Second
	mcpProgressTick = 5 * time.Second
	mcpEndGrace     = time.Second
	mcpInstructions = "Proteoscope shows protein structures in a browser page on this computer. Tools act on that page: open a structure (PDB ID, UniProt accession or local files), then describe it, select residues, list interactions, superpose, load its validation report, rank predictions, or render an image. proteoscope_command runs any command of Proteoscope's command language (type \"help\" for the list)."
)

type mcpMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   json.RawMessage `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpServer struct {
	hub      *remoteHub
	url      string
	out      io.Writer
	outMu    sync.Mutex
	pageWait time.Duration
	calls    sync.WaitGroup
	// openPage opens the browser when a tool needs a page and none is connected.
	openPage func()
	// Calls in flight, by request id, for notifications/cancelled.
	cancelMu sync.Mutex
	cancels  map[string]context.CancelFunc
}

func runMCP(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	log.SetOutput(stderr)
	cfg, err := parseConfig(args)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		return 2
	}
	if cfg.showVersion {
		fmt.Fprintf(stdout, "proteoscope %s\n", version)
		return 0
	}
	// Remote control is on for the agent, so the page stays on this computer.
	if !isLoopbackName(normalizeHost(cfg.host)) {
		fmt.Fprintln(stderr, "proteoscope mcp serves only this computer; leave out --host or use --host 127.0.0.1.")
		return 2
	}
	cfg.remote, cfg.mcp = true, true
	openBrowserOnDemand := !cfg.noOpen
	cfg.noOpen = true
	running, err := start(cfg, stderr)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	fmt.Fprintln(stderr, "MCP: answering on stdin and stdout; the browser opens when a tool needs the page.")
	served := make(chan error, 1)
	go func() { served <- running.serve() }()
	server := &mcpServer{hub: running.app.control, url: running.url, out: stdout, pageWait: mcpPageWait}
	if openBrowserOnDemand {
		var mu sync.Mutex
		var last time.Time
		server.openPage = func() {
			mu.Lock()
			defer mu.Unlock()
			if time.Since(last) < mcpReopenAfter {
				return
			}
			last = time.Now()
			if err := openBrowser(running.url); err != nil {
				log.Printf("open browser: %v", err)
			}
		}
	}
	err = server.serveStream(context.Background(), stdin)
	running.stop(2 * time.Second)
	if err != nil {
		fmt.Fprintln(stderr, "MCP:", err)
		return 1
	}
	if err := <-served; err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	return 0
}

// serveStream reads one JSON-RPC message per line until the input ends, then gives the calls
// still running a moment to finish before cancelling them. Tool calls run concurrently, since one can wait on a
// download while the agent asks for something else; the page still runs them one at a time.
func (s *mcpServer) serveStream(ctx context.Context, in io.Reader) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	reader := bufio.NewReaderSize(in, 1<<20)
	var readErr error
	for {
		line, err := readLine(reader, mcpMaxLine)
		if errors.Is(err, errLineTooLong) {
			s.send(json.RawMessage("null"), nil, &mcpError{Code: -32700, Message: "Parse error: the message is longer than 64 MiB"})
			continue
		}
		if len(strings.TrimSpace(string(line))) > 0 {
			s.receive(ctx, line)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				readErr = err
			}
			break
		}
	}
	// Calls about to finish still answer; the rest are cancelled, so Proteoscope does not keep
	// running after the agent has gone.
	grace := time.AfterFunc(mcpEndGrace, cancel)
	s.calls.Wait()
	grace.Stop()
	return readErr
}

var errLineTooLong = errors.New("line too long")

// readLine returns the next line without its newline. An overlong line is read to its end and
// reported as errLineTooLong, so the stream stays in step.
func readLine(reader *bufio.Reader, limit int) ([]byte, error) {
	var line []byte
	tooLong := false
	for {
		chunk, err := reader.ReadSlice('\n')
		if !tooLong {
			if len(line)+len(chunk) > limit {
				tooLong, line = true, nil
			} else {
				line = append(line, chunk...)
			}
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if tooLong && err == nil {
			return nil, errLineTooLong
		}
		return []byte(strings.TrimRight(string(line), "\r\n")), err
	}
}

func (s *mcpServer) receive(ctx context.Context, line []byte) {
	trimmed := strings.TrimSpace(string(line))
	if !strings.HasPrefix(trimmed, "{") {
		code, message := -32600, "Invalid Request: send one JSON-RPC object per line (batches are not supported)"
		if !json.Valid(line) {
			code, message = -32700, "Parse error"
		}
		s.send(json.RawMessage("null"), nil, &mcpError{Code: code, Message: message})
		return
	}
	var message mcpMessage
	if err := json.Unmarshal(line, &message); err != nil {
		s.send(json.RawMessage("null"), nil, &mcpError{Code: -32700, Message: "Parse error"})
		return
	}
	hasID := len(message.ID) > 0 && string(message.ID) != "null"
	if message.Method == "" {
		// A response to a request of ours (none are sent) or a malformed message.
		if hasID && (len(message.Result) > 0 || len(message.Error) > 0) {
			return
		}
		s.send(idOrNull(message.ID), nil, &mcpError{Code: -32600, Message: "Invalid Request"})
		return
	}
	if message.JSONRPC != "2.0" {
		if hasID {
			s.send(message.ID, nil, &mcpError{Code: -32600, Message: "Invalid Request: jsonrpc must be \"2.0\""})
		}
		return
	}
	if message.Method == "tools/call" && hasID {
		callCtx, cancel := context.WithCancel(ctx)
		key := string(message.ID)
		s.cancelMu.Lock()
		if s.cancels == nil {
			s.cancels = map[string]context.CancelFunc{}
		}
		s.cancels[key] = cancel
		s.cancelMu.Unlock()
		s.calls.Add(1)
		go func() {
			defer s.calls.Done()
			defer func() {
				s.cancelMu.Lock()
				delete(s.cancels, key)
				s.cancelMu.Unlock()
				cancel()
			}()
			s.handle(callCtx, message)
		}()
		return
	}
	s.handle(ctx, message)
}

func idOrNull(id json.RawMessage) json.RawMessage {
	if len(id) == 0 {
		return json.RawMessage("null")
	}
	return id
}

func (s *mcpServer) handle(ctx context.Context, request mcpMessage) {
	notification := len(request.ID) == 0 || string(request.ID) == "null"
	var result any
	var failure *mcpError
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		json.Unmarshal(request.Params, &params)
		result = map[string]any{
			"protocolVersion": negotiateVersion(params.ProtocolVersion),
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "proteoscope", "title": "Proteoscope", "version": version},
			"instructions":    mcpInstructions,
		}
	case "ping":
		result = map[string]any{}
	case "tools/list":
		result = map[string]any{"tools": mcpTools}
	case "tools/call":
		var params struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
			Meta      struct {
				ProgressToken json.RawMessage `json:"progressToken"`
			} `json:"_meta"`
		}
		if err := json.Unmarshal(request.Params, &params); err != nil {
			failure = &mcpError{Code: -32602, Message: "Invalid params"}
			break
		}
		tool, ok := mcpToolByName[params.Name]
		if !ok {
			failure = &mcpError{Code: -32602, Message: fmt.Sprintf("Unknown tool: %s", params.Name)}
			break
		}
		stop := s.reportProgress(params.Meta.ProgressToken)
		result = s.callTool(ctx, tool, params.Arguments)
		stop()
		if ctx.Err() != nil {
			// Cancelled: the client expects no answer.
			return
		}
	case "notifications/cancelled":
		var params struct {
			RequestID json.RawMessage `json:"requestId"`
		}
		json.Unmarshal(request.Params, &params)
		s.cancelMu.Lock()
		cancel := s.cancels[string(params.RequestID)]
		s.cancelMu.Unlock()
		if cancel != nil {
			cancel()
		}
		return
	default:
		if strings.HasPrefix(request.Method, "notifications/") {
			return
		}
		failure = &mcpError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", request.Method)}
	}
	if notification {
		return
	}
	s.send(request.ID, result, failure)
}

// reportProgress sends a progress notification every few seconds while a call runs, when the
// client asked for them, so a long call (scoring a campaign) is seen to be alive.
func (s *mcpServer) reportProgress(token json.RawMessage) func() {
	if len(token) == 0 || string(token) == "null" {
		return func() {}
	}
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(mcpProgressTick)
		defer ticker.Stop()
		for step := 1; ; step++ {
			select {
			case <-done:
				return
			case <-ticker.C:
				s.notify("notifications/progress", map[string]any{"progressToken": token, "progress": step, "message": "Proteoscope is working in the page"})
			}
		}
	}()
	return func() { close(done) }
}

func negotiateVersion(requested string) string {
	for _, supported := range mcpProtocolVersions {
		if requested == supported {
			return requested
		}
	}
	return mcpProtocolVersions[0]
}

func (s *mcpServer) send(id json.RawMessage, result any, failure *mcpError) {
	message := map[string]any{"jsonrpc": "2.0", "id": id}
	if failure != nil {
		message["error"] = failure
	} else {
		message["result"] = result
	}
	s.write(message, id)
}

func (s *mcpServer) notify(method string, params any) {
	s.write(map[string]any{"jsonrpc": "2.0", "method": method, "params": params}, nil)
}

func (s *mcpServer) write(message map[string]any, id json.RawMessage) {
	data, err := json.Marshal(message)
	if err != nil {
		data, _ = json.Marshal(map[string]any{"jsonrpc": "2.0", "id": idOrNull(id), "error": mcpError{Code: -32603, Message: err.Error()}})
	}
	s.outMu.Lock()
	defer s.outMu.Unlock()
	s.out.Write(append(data, '\n'))
}

// callTool waits for a page, turns the tool's arguments into a command line (or files to open),
// runs it in the page and shapes the page's reply as a tool result.
func (s *mcpServer) callTool(ctx context.Context, tool mcpTool, raw json.RawMessage) map[string]any {
	var args map[string]any
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &args); err != nil {
			return toolError("The arguments are not a JSON object.")
		}
	}
	if args == nil {
		args = map[string]any{}
	}
	// Arguments are checked before waiting for a page; a tool with a check (open_files) builds
	// its request only once the page is there, since building it registers files.
	var event remoteEvent
	var err error
	if tool.check != nil {
		err = tool.check(args)
	} else {
		event, err = tool.event(s, args)
	}
	if err != nil {
		return toolError(err.Error())
	}
	if s.hub.latest() == nil && s.openPage != nil {
		s.openPage()
	}
	if !s.hub.waitForPage(ctx, s.pageWait) {
		return toolError(fmt.Sprintf("No Proteoscope page is connected. Open %s in Chrome, Edge or Brave, then try again.", s.url))
	}
	if tool.check != nil {
		if event, err = tool.event(s, args); err != nil {
			return toolError(err.Error())
		}
	}
	outcome, err := s.hub.dispatch(ctx, event)
	if err != nil {
		return toolError(err.Error())
	}
	if tool.image {
		return imageResult(outcome)
	}
	return commandResult(outcome)
}

func toolError(message string) map[string]any {
	return map[string]any{"content": []any{map[string]any{"type": "text", "text": message}}, "isError": true}
}

// commandResult gives the message and the data as text, and the data again as structured content.
func commandResult(outcome remoteResult) map[string]any {
	if !outcome.OK {
		return toolError(outcome.Message)
	}
	text := outcome.Message
	structured := map[string]any{"message": outcome.Message}
	var images []mcpImage
	if len(outcome.Data) > 0 && string(outcome.Data) != "null" {
		var data any
		if err := json.Unmarshal(outcome.Data, &data); err == nil {
			// Images (a triage gallery, "png") go to the agent as images; the data keeps their numbers.
			var dropped int
			data, images, dropped = extractImages(data)
			structured["data"] = data
			serialized := string(outcome.Data)
			if len(images) > 0 || dropped > 0 {
				encoded, _ := json.Marshal(data)
				serialized = string(encoded)
			}
			if len(serialized) > mcpTextLimit {
				serialized = strings.ToValidUTF8(serialized[:mcpTextLimit], "") + " … (truncated; the structured content has everything)"
			}
			if text != "" {
				text += "\n\n"
			}
			text += serialized
			if dropped > 0 {
				text += fmt.Sprintf("\n\n%d more images left out (null above): the images of one result are limited to %d MB.", dropped, mcpImageLimit>>20)
			}
		}
	}
	if text == "" {
		text = "Done."
	}
	content := []any{map[string]any{"type": "text", "text": text}}
	for index, image := range images {
		content = append(content,
			map[string]any{"type": "text", "text": fmt.Sprintf("Image %d: %s", index+1, image.caption)},
			map[string]any{"type": "image", "data": image.data, "mimeType": image.mimeType})
	}
	return map[string]any{"content": content, "structuredContent": structured}
}

type mcpImage struct {
	data, mimeType, caption string
}

var dataURLImage = regexp.MustCompile(`^data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$`)

// extractImages replaces every image data URL in a command's data with its 1-based number among
// the images returned, up to mcpImageLimit bytes of them in all; images past the limit become
// null and are counted. Each image is captioned from the fields next to it (position, job,
// model, score, size), so the agent can tell a gallery's thumbnails apart.
func extractImages(data any) (any, []mcpImage, int) {
	var images []mcpImage
	dropped, total := 0, 0
	var walk func(value any, siblings map[string]any) any
	walk = func(value any, siblings map[string]any) any {
		switch typed := value.(type) {
		case map[string]any:
			for key, item := range typed {
				typed[key] = walk(item, typed)
			}
			return typed
		case []any:
			for index, item := range typed {
				typed[index] = walk(item, nil)
			}
			return typed
		case string:
			match := dataURLImage.FindStringSubmatch(typed)
			if match == nil {
				return typed
			}
			if total+len(match[2]) > mcpImageLimit {
				dropped++
				return nil
			}
			total += len(match[2])
			images = append(images, mcpImage{data: match[2], mimeType: match[1], caption: imageCaption(siblings)})
			return len(images)
		}
		return value
	}
	data = walk(data, nil)
	return data, images, dropped
}

func imageCaption(fields map[string]any) string {
	var parts []string
	if position, ok := fields["position"].(float64); ok {
		parts = append(parts, fmt.Sprintf("#%d", int(position)))
	}
	for _, key := range []string{"job", "model"} {
		if text, ok := fields[key].(string); ok && text != "" {
			parts = append(parts, text)
		}
	}
	if metric, ok := fields["metric"].(string); ok {
		if score, ok := fields["score"].(float64); ok {
			parts = append(parts, fmt.Sprintf("%s %.2f", metric, score))
		}
	}
	width, _ := fields["width"].(float64)
	height, _ := fields["height"].(float64)
	if width > 0 && height > 0 {
		parts = append(parts, fmt.Sprintf("%d × %d", int(width), int(height)))
	}
	if len(parts) == 0 {
		return "image"
	}
	return strings.Join(parts, ", ")
}

func imageResult(outcome remoteResult) map[string]any {
	if !outcome.OK {
		return toolError(outcome.Message)
	}
	var data struct {
		Image  string `json:"image"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	}
	json.Unmarshal(outcome.Data, &data)
	encoded, found := strings.CutPrefix(data.Image, "data:image/png;base64,")
	if !found || encoded == "" {
		return toolError("The page did not return an image.")
	}
	if len(encoded) > mcpImageLimit {
		return toolError(fmt.Sprintf("The %d × %d image is %.1f MB, more than agents accept; render it at scale 1.", data.Width, data.Height, float64(len(encoded))*3/4/(1<<20)))
	}
	return map[string]any{"content": []any{
		map[string]any{"type": "image", "data": encoded, "mimeType": "image/png"},
		map[string]any{"type": "text", "text": outcome.Message},
	}}
}

/* ---------- Tools ---------- */

type mcpTool struct {
	Name        string         `json:"name"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	Annotations map[string]any `json:"annotations,omitempty"`
	image       bool
	// check validates the arguments before a page is needed; event builds the request.
	check func(args map[string]any) error
	event func(s *mcpServer, args map[string]any) (remoteEvent, error)
}

func schema(properties map[string]any, required ...string) map[string]any {
	result := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		result["required"] = required
	}
	return result
}

func stringProperty(description string) map[string]any {
	return map[string]any{"type": "string", "description": description}
}

// Tool arguments become parts of one command line; line breaks are not allowed in them.
func textArgument(args map[string]any, name string, required bool) (string, error) {
	value, _ := args[name].(string)
	value = strings.TrimSpace(value)
	if value == "" && required {
		return "", fmt.Errorf("%s is required.", name)
	}
	if strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("%s must be a single line.", name)
	}
	return value, nil
}

var (
	structureID = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,64}$`)
	chainID     = regexp.MustCompile(`^[A-Za-z0-9]{1,4}$`)
	metricName  = regexp.MustCompile(`^[a-z0-9]{2,16}$`)
)

func command(line string) (remoteEvent, error) {
	return remoteEvent{Command: line}, nil
}

var mcpTools = []mcpTool{
	{
		Name:        "open_structure",
		Title:       "Open a structure",
		Description: "Open a PDB entry by its ID (for example 1M17), or the AlphaFold DB model of a UniProt accession (for example P04637), replacing the scene unless add is true. Returns the structure's name, atom count and chains.",
		InputSchema: schema(map[string]any{
			"id":  stringProperty("PDB ID or UniProt accession"),
			"add": map[string]any{"type": "boolean", "description": "Add to the scene instead of replacing it"},
		}, "id"),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			id, err := textArgument(args, "id", true)
			if err != nil {
				return remoteEvent{}, err
			}
			if !structureID.MatchString(id) {
				return remoteEvent{}, errors.New("id must be a PDB ID or UniProt accession.")
			}
			if add, _ := args["add"].(bool); add {
				return command("add " + id)
			}
			return command("fetch " + id)
		},
	},
	{
		Name:        "open_files",
		Title:       "Open local files",
		Description: "Open files or folders on this computer by absolute path: structures (.pdb, .cif, .bcif), prediction output folders (AlphaFold 3, AlphaFold Server .zip, Boltz, Chai-1, ColabFold, Protenix, OpenFold3), or a folder of many prediction jobs, which are all scored and ranked together (see rank_predictions). Returns what was opened.",
		InputSchema: schema(map[string]any{
			"paths": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Absolute paths of files or folders (~ is expanded)", "minItems": 1},
			"add":   map[string]any{"type": "boolean", "description": "Add to the scene instead of replacing it"},
		}, "paths"),
		check: func(args map[string]any) error {
			if len(stringList(args["paths"])) == 0 {
				return errors.New("paths must list at least one file or folder.")
			}
			return nil
		},
		// Files are registered only once a page is there to read them.
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			add, _ := args["add"].(bool)
			return s.hub.openEvent(stringList(args["paths"]), add)
		},
	},
	{
		Name:        "describe_structure",
		Title:       "Describe the structure",
		Description: "Describe the active structure: its source, title, experimental method and resolution (or that it is predicted, with its confidence), chains with their molecules and UniProt accessions, ligands, the structures in the scene, and prediction scores, comparison results or validation summary when present.",
		InputSchema: schema(map[string]any{}),
		Annotations: map[string]any{"readOnlyHint": true},
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			return command("info")
		},
	},
	{
		Name:        "list_structures",
		Title:       "List the structures",
		Description: "List the structures in the scene with their chains, which one is active and any superposition results.",
		InputSchema: schema(map[string]any{}),
		Annotations: map[string]any{"readOnlyHint": true},
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			return command("list")
		},
	},
	{
		Name:        "select_residues",
		Title:       "Select residues",
		Description: "Select residues with Proteoscope's selection language, for example \"chain A and resi 40-80\", \"within 5 of resn STI\", \"plddt < 70\", \"outliers\" or \"/A:315\". Returns the residues matched in each structure.",
		InputSchema: schema(map[string]any{"selection": stringProperty("A selection")}, "selection"),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			selection, err := textArgument(args, "selection", true)
			if err != nil {
				return remoteEvent{}, err
			}
			return command("select " + selection)
		},
	},
	{
		Name:        "get_interactions",
		Title:       "List interactions",
		Description: "Focus residues or a ligand (for example \"resn STI\" or \"/A:769\") and list their non-covalent interactions (hydrogen bonds, salt bridges, π-stacking, cation–π, hydrophobic contacts, halogen bonds, metal coordination, water bridges) with the partner residue, atoms and distance, using PLIP's criteria.",
		InputSchema: schema(map[string]any{"selection": stringProperty("The residues or ligand, as a selection")}, "selection"),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			selection, err := textArgument(args, "selection", true)
			if err != nil {
				return remoteEvent{}, err
			}
			return command("interactions " + selection)
		},
	},
	{
		Name:        "interface_contacts",
		Title:       "List interface contacts",
		Description: "List the non-covalent contacts between two chains of the active structure, with the interface residues.",
		InputSchema: schema(map[string]any{"chain_a": stringProperty("First chain ID"), "chain_b": stringProperty("Second chain ID")}, "chain_a", "chain_b"),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			a, _ := textArgument(args, "chain_a", true)
			b, _ := textArgument(args, "chain_b", true)
			if !chainID.MatchString(a) || !chainID.MatchString(b) {
				return remoteEvent{}, errors.New("chain_a and chain_b must be chain IDs, such as A and B.")
			}
			return command("interface " + a + " " + b)
		},
	},
	{
		Name:        "superpose",
		Title:       "Superpose structures",
		Description: "Superpose a structure (or \"all\") onto a reference, by sequence alignment with outlier pruning or by structure alone (TM-align, MM-align for complexes). Structures are named as list_structures shows them, or by #index. Returns RMSD, TM-score, lDDT and the number of aligned pairs.",
		InputSchema: schema(map[string]any{
			"moving":    stringProperty("The structure to move, or \"all\""),
			"reference": stringProperty("The reference structure (default: the active one)"),
			"method":    map[string]any{"type": "string", "enum": []string{"sequence", "structure"}, "description": "Pair residues by sequence (default) or by structure alone"},
			"fit":       stringProperty("Optional selection of reference residues to fit on (sequence method only)"),
		}, "moving"),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			moving, err := textArgument(args, "moving", true)
			if err != nil {
				return remoteEvent{}, err
			}
			reference, err := textArgument(args, "reference", false)
			if err != nil {
				return remoteEvent{}, err
			}
			fit, err := textArgument(args, "fit", false)
			if err != nil {
				return remoteEvent{}, err
			}
			method, _ := args["method"].(string)
			verb := "superpose"
			if method == "structure" {
				if fit != "" {
					return remoteEvent{}, errors.New("fit works with the sequence method only.")
				}
				verb = "tmalign"
			}
			line := verb + " " + moving
			if reference != "" {
				line += " onto " + reference
			}
			if fit != "" {
				line += " fit " + fit
			}
			return command(line)
		},
	},
	{
		Name:        "validation_report",
		Title:       "Load the validation report",
		Description: "Load the wwPDB validation report of the active PDB entry and return its summary: clashscore, Ramachandran and side-chain outliers, RSRZ or Q-score with percentiles, the ligands' fit to density, and the worst residues.",
		InputSchema: schema(map[string]any{}),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			return command("validate")
		},
	},
	{
		Name:        "rank_predictions",
		Title:       "Rank predictions",
		Description: "Rank the opened prediction jobs (open them with open_files) by a score that is computed alike for every tool (ipsae, pdockq2, lis) or by the tools' own scores (iptm, ranking, ptm), mean pLDDT (plddt) or satisfied cross-links (crosslinks). Returns each job's best model with its scores; with level \"models\", every model.",
		InputSchema: schema(map[string]any{
			"metric": map[string]any{"type": "string", "enum": []string{"ipsae", "pdockq2", "pdockq", "lis", "iptm", "ranking", "ptm", "plddt", "crosslinks"}, "description": "The score to rank by (default: ipsae for complexes, plddt otherwise)"},
			"limit":  map[string]any{"type": "integer", "minimum": 1, "maximum": 1000, "description": "How many rows to return (default 20)"},
			"level":  map[string]any{"type": "string", "enum": []string{"jobs", "models"}, "description": "One row per job (its best model) or per model"},
			"chains": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "minItems": 2, "maxItems": 2, "description": "Score this chain pair instead of each model's best interface, for example [\"A\", \"B\"]"},
		}),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			// Every call states all settings, so it does not depend on earlier calls.
			line := "triage by auto"
			if metric, _ := args["metric"].(string); metric != "" {
				if !metricName.MatchString(metric) {
					return remoteEvent{}, errors.New("Unknown metric.")
				}
				line = "triage by " + metric
			}
			limit := 20
			if value, ok := args["limit"].(float64); ok && value >= 1 {
				limit = int(min(value, 1000))
			}
			line += fmt.Sprintf(" top %d", limit)
			if level, _ := args["level"].(string); level == "models" {
				line += " models"
			} else {
				line += " jobs"
			}
			if list, _ := args["chains"].([]any); len(list) == 2 {
				a, _ := list[0].(string)
				b, _ := list[1].(string)
				if !chainID.MatchString(a) || !chainID.MatchString(b) {
					return remoteEvent{}, errors.New("chains must be two chain IDs, such as [\"A\", \"B\"].")
				}
				line += " pair " + a + " " + b
			} else {
				line += " best"
			}
			return command(line)
		},
	},
	{
		Name:        "render_image",
		Title:       "Render an image",
		Description: "Render the current view as a PNG image and return it.",
		InputSchema: schema(map[string]any{
			"scale":       map[string]any{"type": "integer", "minimum": 1, "maximum": 4, "description": "Resolution as a multiple of the view (default 1)"},
			"transparent": map[string]any{"type": "boolean", "description": "Transparent background"},
		}),
		Annotations: map[string]any{"readOnlyHint": true},
		image:       true,
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			scale := 1
			if value, ok := args["scale"].(float64); ok && value >= 1 && value <= 4 {
				scale = int(value)
			}
			line := fmt.Sprintf("png %d", scale)
			if transparent, _ := args["transparent"].(bool); transparent {
				line += " transparent"
			}
			return command(line)
		},
	},
	{
		Name:        "proteoscope_command",
		Title:       "Run a Proteoscope command",
		Description: "Run any command of Proteoscope's command language, as typed in its search box, and return its message and data. Examples: \"example 1m17\" (a bundled example), \"show sticks within 5 of resn AQ4\", \"color plddt\", \"map load\", \"conservation\", \"missense\", \"distance /A:769@N to :AQ4@N2\", \"help\" (the full list).",
		InputSchema: schema(map[string]any{"command": stringProperty("One command line")}, "command"),
		event: func(s *mcpServer, args map[string]any) (remoteEvent, error) {
			line, err := textArgument(args, "command", true)
			if err != nil {
				return remoteEvent{}, err
			}
			return command(line)
		},
	},
}

var mcpToolByName = func() map[string]mcpTool {
	byName := make(map[string]mcpTool, len(mcpTools))
	for _, tool := range mcpTools {
		byName[tool.Name] = tool
	}
	return byName
}()

func stringList(value any) []string {
	list, _ := value.([]any)
	var result []string
	for _, item := range list {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, text)
		}
	}
	return result
}
