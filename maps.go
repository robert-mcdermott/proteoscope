package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

// Density maps from the PDBe volume server (Mol*'s DensityServer: 2Fo-Fc and Fo-Fc maps of
// X-ray entries, EMDB maps downsampled on request, as BinaryCIF), with RCSB's copy of the same
// service as a fallback, and EMDB's metadata for a map's recommended contour level.
//
//	GET /api/fetch/volume/{source}/{id}                    header (sampling, statistics, cell)
//	GET /api/fetch/volume/{source}/{id}/box?min=&max=&detail=   the map inside a Cartesian box
//	GET /api/fetch/volume/{source}/{id}/cell?detail=       the whole map (EM)
//	GET /api/fetch/emdb/{id}                               EMDB map metadata (contour level)
//
// The two servers hold the same maps, but their statistics differ by a few percent, so map data
// must come from the server that sent the header: the header names it (X-Proteoscope-Volume-
// Server) and box and cell requests pass it back as server=pdbe|rcsb.

var (
	emdbIDPattern = regexp.MustCompile(`(?i)^(emd-)?([0-9]{4,6})$`)
	volumeSources = map[string]bool{"x-ray": true, "em": true}
)

const (
	maxVolumeDetail = 6
	// A box side; the 1VQ5 ribosome's whole-model box is 239 Å.
	maxVolumeBox = 600
	// X-ray maps have few sampling levels, so a large box cannot always be downsampled.
	maxVolumeBytes = 128 << 20
	// Regions around the focus are many and rarely asked for twice; the oldest go first.
	maxVolumeBoxCache = 256 << 20
)

type volumeServer struct {
	name, label, base string
}

func (u *upstream) volumeServers() []volumeServer {
	var servers []volumeServer
	if u.ebi != "" {
		servers = append(servers, volumeServer{"pdbe", "PDBe volume server", u.ebi + "/pdbe/volume-server/"})
	}
	if u.rcsbMaps != "" {
		servers = append(servers, volumeServer{"rcsb", "RCSB volume server", u.rcsbMaps + "/"})
	}
	return servers
}

func (a *app) fetchVolumeHeader(w http.ResponseWriter, r *http.Request) {
	source, id, ok := volumeParams(w, r)
	if !ok {
		return
	}
	a.serveRemote(w, r, "volume", source+"-"+id+".json", func(ctx context.Context) (payload, error) {
		return a.remote.volumeHeader(ctx, source, id)
	})
}

func (a *app) fetchVolumeBox(w http.ResponseWriter, r *http.Request) {
	source, id, ok := volumeParams(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	lower, errLower := parseTriple(query.Get("min"))
	upper, errUpper := parseTriple(query.Get("max"))
	detail, errDetail := strconv.Atoi(query.Get("detail"))
	server, errServer := volumeServerParam(query.Get("server"))
	if errLower != nil || errUpper != nil || errDetail != nil || detail < 0 || detail > maxVolumeDetail || errServer != nil {
		writeError(w, http.StatusBadRequest, "A box needs min=x,y,z, max=x,y,z, detail=0–6 and optionally server=pdbe or rcsb.")
		return
	}
	for axis := range 3 {
		if upper[axis]-lower[axis] <= 0 || upper[axis]-lower[axis] > maxVolumeBox {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("A box must be larger than zero and at most %d Å on each side.", maxVolumeBox))
			return
		}
	}
	path := fmt.Sprintf("%s/%s/box/%s/%s?detail=%d&encoding=bcif", source, id, formatTriple(lower), formatTriple(upper), detail)
	a.serveRemote(w, r, "volume-box", volumeCacheName("box", server, path), func(ctx context.Context) (payload, error) {
		return a.remote.volumeData(ctx, source, id, path, server)
	})
	a.cache.limit("volume-box", maxVolumeBoxCache)
}

func (a *app) fetchVolumeCell(w http.ResponseWriter, r *http.Request) {
	source, id, ok := volumeParams(w, r)
	if !ok {
		return
	}
	detail, err := strconv.Atoi(r.URL.Query().Get("detail"))
	server, errServer := volumeServerParam(r.URL.Query().Get("server"))
	if err != nil || detail < 0 || detail > maxVolumeDetail || errServer != nil {
		writeError(w, http.StatusBadRequest, "The whole map needs detail=0–6 and optionally server=pdbe or rcsb.")
		return
	}
	path := fmt.Sprintf("%s/%s/cell?detail=%d&encoding=bcif", source, id, detail)
	a.serveRemote(w, r, "volume", volumeCacheName("cell", server, path), func(ctx context.Context) (payload, error) {
		return a.remote.volumeData(ctx, source, id, path, server)
	})
}

func (a *app) fetchEMDB(w http.ResponseWriter, r *http.Request) {
	id, ok := normalizeEMDBID(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid EMDB ID: use an ID such as EMD-34272.")
		return
	}
	a.serveRemote(w, r, "emdb", id+".json", func(ctx context.Context) (payload, error) {
		return a.remote.emdbMap(ctx, id)
	})
}

// {source} is x-ray (a PDB ID) or em (an EMDB ID, emd-1234).
func volumeParams(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	source := strings.ToLower(r.PathValue("source"))
	if !volumeSources[source] {
		writeError(w, http.StatusBadRequest, "The map source must be x-ray or em.")
		return "", "", false
	}
	raw := r.PathValue("id")
	if source == "em" {
		id, ok := normalizeEMDBID(raw)
		if !ok {
			writeError(w, http.StatusBadRequest, "Invalid EMDB ID: use an ID such as emd-34272.")
			return "", "", false
		}
		return source, strings.ToLower(id), true
	}
	if !pdbIDPattern.MatchString(raw) {
		writeError(w, http.StatusBadRequest, "X-ray maps need a 4-character PDB ID such as 1M17.")
		return "", "", false
	}
	return source, strings.ToLower(raw), true
}

func volumeServerParam(value string) (string, error) {
	switch value {
	case "", "pdbe", "rcsb":
		return value, nil
	}
	return "", errors.New("unknown volume server")
}

func normalizeEMDBID(raw string) (string, bool) {
	match := emdbIDPattern.FindStringSubmatch(strings.TrimSpace(raw))
	if match == nil {
		return "", false
	}
	return "EMD-" + match[2], true
}

func parseTriple(text string) ([3]float64, error) {
	var values [3]float64
	parts := strings.Split(text, ",")
	if len(parts) != 3 {
		return values, errors.New("need three values")
	}
	for index, part := range parts {
		value, err := strconv.ParseFloat(strings.TrimSpace(part), 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || math.Abs(value) > 1e5 {
			return values, errors.New("invalid coordinate")
		}
		// Coordinates beyond a thousandth of an ångström change nothing but the cache name.
		values[index] = math.Round(value*1000) / 1000
	}
	return values, nil
}

func formatTriple(values [3]float64) string {
	parts := make([]string, 3)
	for index, value := range values {
		parts[index] = strconv.FormatFloat(value, 'f', -1, 64)
	}
	return strings.Join(parts, ",")
}

func volumeCacheName(kind, server, path string) string {
	sum := sha256.Sum256([]byte(server + "|" + path))
	return kind + "-" + hex.EncodeToString(sum[:12]) + ".bcif"
}

func volumeLabel(id string) string {
	return strings.ToUpper(id)
}

// The header of a map from the first server that has it. A server's "no map" (404, or
// isAvailable false) decides unless another server has the map; a failure of the second server
// never hides the first one's answer.
func (u *upstream) volumeHeader(ctx context.Context, source, id string) (payload, error) {
	var first error
	for _, server := range u.volumeServers() {
		body, err := u.download(ctx, server.base+source+"/"+id, server.label)
		if err == nil {
			err = checkVolumeHeader(body, server.label, volumeLabel(id))
		}
		if err == nil {
			return payload{body: body, contentType: jsonContentType, headers: map[string]string{
				"X-Proteoscope-Source":        server.base + source + "/" + id,
				"X-Proteoscope-Volume-Server": server.name,
			}}, nil
		}
		if errors.Is(err, errUpstreamNotFound) {
			err = fetchErrorf(http.StatusNotFound, "No map is available for %s", volumeLabel(id))
		}
		if first == nil {
			first = err
		}
	}
	if first == nil {
		first = fetchErrorf(http.StatusBadGateway, "No volume server is configured")
	}
	return payload{}, first
}

// Both servers answer {"isAvailable": true, "channels": [...], ...} for a map they hold.
func checkVolumeHeader(body []byte, label, entry string) error {
	var header struct {
		IsAvailable *bool    `json:"isAvailable"`
		Channels    []string `json:"channels"`
	}
	if json.Unmarshal(body, &header) != nil || header.IsAvailable == nil {
		return fetchErrorf(http.StatusBadGateway, "The %s returned an unexpected header for %s", label, entry)
	}
	if !*header.IsAvailable {
		return errUpstreamNotFound
	}
	if len(header.Channels) == 0 {
		return fetchErrorf(http.StatusBadGateway, "The %s lists no map channels for %s", label, entry)
	}
	return nil
}

// Map data (a box or the whole cell) from the named server, or from the first that has it.
func (u *upstream) volumeData(ctx context.Context, source, id, path, only string) (payload, error) {
	var first error
	for _, server := range u.volumeServers() {
		if only != "" && server.name != only {
			continue
		}
		limit := min(int64(maxVolumeBytes), u.maxBytes)
		body, err := u.downloadLimit(ctx, server.base+path, server.label, limit)
		// The other server would send the same data: a region too large is final.
		if errors.Is(err, errTooLarge) {
			return payload{}, fetchErrorf(http.StatusBadRequest, "The map region is larger than %d MB; choose a smaller region.", limit>>20)
		}
		if errors.Is(err, errUpstreamNotFound) {
			err = fetchErrorf(http.StatusNotFound, "No map is available for %s", volumeLabel(id))
		} else if err == nil {
			if message, failed := volumeServerError(body); failed {
				// The servers share their software and its limits, so a refused region is final.
				if strings.Contains(strings.ToLower(message), "too big") {
					return payload{}, fetchErrorf(http.StatusBadRequest, "The %s refused the region: %s Choose a smaller region.", server.label, message)
				}
				err = fetchErrorf(http.StatusBadGateway, "The %s could not send the map of %s: %s", server.label, volumeLabel(id), message)
			}
		}
		if err == nil {
			return payload{body: body, contentType: "application/octet-stream", headers: map[string]string{"X-Proteoscope-Source": server.base + path}}, nil
		}
		if first == nil {
			first = err
		}
	}
	if first == nil {
		first = fetchErrorf(http.StatusBadGateway, "No volume server is configured")
	}
	return payload{}, first
}

// A volume-server answer is BinaryCIF (a MessagePack map). Errors come with HTTP 200 and
// _density_server_result.has_error = "yes"; the message is in its error column.
func volumeServerError(body []byte) (string, bool) {
	if len(body) == 0 || !(body[0]&0xf0 == 0x80 || body[0] == 0xde || body[0] == 0xdf) {
		return "the answer is not BinaryCIF.", true
	}
	root, _, err := msgpackValue(body, 0, 0)
	if err != nil {
		return "the answer is not valid BinaryCIF.", true
	}
	result := bcifCategory(root, "_density_server_result")
	if result == nil || bcifString(result, "has_error") != "yes" {
		return "", false
	}
	message := strings.TrimPrefix(bcifString(result, "error"), "Error: ")
	if message == "" {
		message = "an error without a message."
	}
	return message, true
}

func bcifCategory(root any, name string) map[string]any {
	file, _ := root.(map[string]any)
	blocks, _ := file["dataBlocks"].([]any)
	for _, block := range blocks {
		categories, _ := block.(map[string]any)["categories"].([]any)
		for _, category := range categories {
			if item, ok := category.(map[string]any); ok && item["name"] == name {
				return item
			}
		}
	}
	return nil
}

// The value of a one-row string column: StringArray keeps the distinct strings, here one, in
// stringData.
func bcifString(category map[string]any, name string) string {
	columns, _ := category["columns"].([]any)
	for _, column := range columns {
		item, ok := column.(map[string]any)
		if !ok || item["name"] != name {
			continue
		}
		data, _ := item["data"].(map[string]any)
		encodings, _ := data["encoding"].([]any)
		if len(encodings) == 0 {
			return ""
		}
		encoding, _ := encodings[0].(map[string]any)
		if encoding["kind"] != "StringArray" {
			return ""
		}
		text, _ := encoding["stringData"].(string)
		return text
	}
	return ""
}

var errMessagePack = errors.New("invalid MessagePack")

// msgpackValue decodes the MessagePack value at data[pos:]: maps with string keys become
// map[string]any, arrays []any, strings string, binary []byte (sharing data), and numbers
// int64, uint64 or float64. Extension values are skipped as nil.
func msgpackValue(data []byte, pos, depth int) (any, int, error) {
	if pos >= len(data) || depth > 64 {
		return nil, 0, errMessagePack
	}
	b := data[pos]
	pos++
	size := func(width int) (int, int, error) {
		if pos+width > len(data) {
			return 0, 0, errMessagePack
		}
		var n uint64
		switch width {
		case 1:
			n = uint64(data[pos])
		case 2:
			n = uint64(binary.BigEndian.Uint16(data[pos:]))
		case 4:
			n = uint64(binary.BigEndian.Uint32(data[pos:]))
		case 8:
			n = binary.BigEndian.Uint64(data[pos:])
		}
		if n > uint64(len(data)) {
			return 0, 0, errMessagePack
		}
		return int(n), pos + width, nil
	}
	raw := func(n, at int) ([]byte, int, error) {
		if at+n > len(data) || at+n < at {
			return nil, 0, errMessagePack
		}
		return data[at : at+n], at + n, nil
	}
	collection := func(n, at int, isMap bool) (any, int, error) {
		// Every element takes at least one byte.
		if n > len(data)-at {
			return nil, 0, errMessagePack
		}
		if !isMap {
			items := make([]any, 0, n)
			for range n {
				item, next, err := msgpackValue(data, at, depth+1)
				if err != nil {
					return nil, 0, err
				}
				items = append(items, item)
				at = next
			}
			return items, at, nil
		}
		items := make(map[string]any, min(n, 64))
		for range n {
			key, next, err := msgpackValue(data, at, depth+1)
			if err != nil {
				return nil, 0, err
			}
			value, after, err := msgpackValue(data, next, depth+1)
			if err != nil {
				return nil, 0, err
			}
			if text, ok := key.(string); ok {
				items[text] = value
			}
			at = after
		}
		return items, at, nil
	}
	switch {
	case b <= 0x7f:
		return int64(b), pos, nil
	case b >= 0xe0:
		return int64(int8(b)), pos, nil
	case b&0xf0 == 0x80:
		return collection(int(b&0x0f), pos, true)
	case b&0xf0 == 0x90:
		return collection(int(b&0x0f), pos, false)
	case b&0xe0 == 0xa0:
		text, next, err := raw(int(b&0x1f), pos)
		return string(text), next, err
	}
	switch b {
	case 0xc0:
		return nil, pos, nil
	case 0xc2:
		return false, pos, nil
	case 0xc3:
		return true, pos, nil
	case 0xc4, 0xc5, 0xc6, 0xd9, 0xda, 0xdb:
		width := map[byte]int{0xc4: 1, 0xc5: 2, 0xc6: 4, 0xd9: 1, 0xda: 2, 0xdb: 4}[b]
		n, at, err := size(width)
		if err != nil {
			return nil, 0, err
		}
		bytes, next, err := raw(n, at)
		if b >= 0xd9 {
			return string(bytes), next, err
		}
		return bytes, next, err
	case 0xc7, 0xc8, 0xc9:
		n, at, err := size(map[byte]int{0xc7: 1, 0xc8: 2, 0xc9: 4}[b])
		if err != nil {
			return nil, 0, err
		}
		_, next, err := raw(n+1, at)
		return nil, next, err
	case 0xd4, 0xd5, 0xd6, 0xd7, 0xd8:
		_, next, err := raw(1+(1<<(b-0xd4)), pos)
		return nil, next, err
	case 0xca:
		bytes, next, err := raw(4, pos)
		if err != nil {
			return nil, 0, err
		}
		return float64(math.Float32frombits(binary.BigEndian.Uint32(bytes))), next, nil
	case 0xcb:
		bytes, next, err := raw(8, pos)
		if err != nil {
			return nil, 0, err
		}
		return math.Float64frombits(binary.BigEndian.Uint64(bytes)), next, nil
	case 0xcc, 0xcd, 0xce, 0xcf:
		width := 1 << (b - 0xcc)
		bytes, next, err := raw(width, pos)
		if err != nil {
			return nil, 0, err
		}
		var n uint64
		for _, c := range bytes {
			n = n<<8 | uint64(c)
		}
		return n, next, nil
	case 0xd0, 0xd1, 0xd2, 0xd3:
		width := 1 << (b - 0xd0)
		bytes, next, err := raw(width, pos)
		if err != nil {
			return nil, 0, err
		}
		var n uint64
		for _, c := range bytes {
			n = n<<8 | uint64(c)
		}
		shift := 64 - 8*width
		return int64(n<<shift) >> shift, next, nil
	case 0xdc, 0xdd:
		n, at, err := size(map[byte]int{0xdc: 2, 0xdd: 4}[b])
		if err != nil {
			return nil, 0, err
		}
		return collection(n, at, false)
	case 0xde, 0xdf:
		n, at, err := size(map[byte]int{0xde: 2, 0xdf: 4}[b])
		if err != nil {
			return nil, 0, err
		}
		return collection(n, at, true)
	}
	return nil, 0, errMessagePack
}

func (u *upstream) emdbMap(ctx context.Context, id string) (payload, error) {
	source := u.ebi + "/emdb/api/entry/map/" + id
	body, err := u.download(ctx, source, "EMDB")
	if errors.Is(err, errUpstreamNotFound) {
		return payload{}, fetchErrorf(http.StatusNotFound, "EMDB has no entry %s", id)
	}
	if err != nil {
		return payload{}, err
	}
	return jsonPayload(body, "EMDB", source)
}
