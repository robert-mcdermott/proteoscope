package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	maxDownloadBytes = 512 << 20
	textContentType  = "text/plain; charset=utf-8"
	jsonContentType  = "application/json"
	offlineMessage   = "Proteoscope is running with --offline; remote fetching is disabled."
	uniprotFields    = "accession,id,protein_name,gene_names,organism_name,length,sequence," +
		"ft_domain,ft_region,ft_motif,ft_act_site,ft_binding,ft_site,ft_mod_res,ft_carbohyd," +
		"ft_disulfid,ft_crosslnk,ft_variant,ft_mutagen,ft_helix,ft_strand,ft_turn"
)

var (
	pdbIDPattern         = regexp.MustCompile(`^[0-9][A-Za-z0-9]{3}$`)
	extendedPDBIDPattern = regexp.MustCompile(`(?i)^pdb_[0-9a-z]{8}$`)
	accessionPattern     = regexp.MustCompile(`^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})(-[0-9]+)?$`)
	errUpstreamNotFound  = errors.New("not found upstream")
	errTooLarge          = errors.New("download too large")
)

type upstream struct {
	client     *http.Client
	rcsb       string
	rcsbSearch string
	rcsbData   string
	afdb       string
	uniprot    string
	ebi        string
	modelHosts []string
	maxBytes   int64
}

type payload struct {
	body        []byte
	contentType string
	headers     map[string]string
	// partial marks an answer assembled while one of several services failed; it is served but
	// not cached, so the next request asks again.
	partial bool
}

type fetchError struct {
	status  int
	message string
}

// AlphaFold DB renamed entryId to modelEntityId in October 2025 (the old name is still served for
// now); both are read.
type afdbMeta struct {
	EntryID                string          `json:"entryId"`
	ModelEntityID          string          `json:"modelEntityId,omitempty"`
	UniprotAccession       string          `json:"uniprotAccession"`
	UniprotDescription     string          `json:"uniprotDescription"`
	Gene                   string          `json:"gene"`
	OrganismScientificName string          `json:"organismScientificName"`
	GlobalMetricValue      json.RawMessage `json:"globalMetricValue"`
	LatestVersion          json.RawMessage `json:"latestVersion"`
}

type afdbEntry struct {
	afdbMeta
	CifURL           string `json:"cifUrl"`
	PaeDocURL        string `json:"paeDocUrl"`
	AmAnnotationsURL string `json:"amAnnotationsUrl"`
	MsaURL           string `json:"msaUrl"`
}

func (m afdbMeta) id() string {
	if m.ModelEntityID != "" {
		return m.ModelEntityID
	}
	return m.EntryID
}

func (e *fetchError) Error() string {
	return e.message
}

func fetchErrorf(status int, format string, args ...any) error {
	return &fetchError{status: status, message: fmt.Sprintf(format, args...)}
}

func defaultUpstream() *upstream {
	return &upstream{
		client:     newUpstreamClient(),
		rcsb:       "https://files.rcsb.org",
		rcsbSearch: "https://search.rcsb.org",
		rcsbData:   "https://data.rcsb.org",
		afdb:       "https://alphafold.ebi.ac.uk",
		uniprot:    "https://rest.uniprot.org",
		ebi:        "https://www.ebi.ac.uk",
		maxBytes:   maxDownloadBytes,
	}
}

func newUpstreamClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second, CheckRedirect: sameHostRedirect}
}

func sameHostRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("too many redirects")
	}
	if req.URL.Scheme != via[0].URL.Scheme || !strings.EqualFold(req.URL.Host, via[0].URL.Host) {
		return fmt.Errorf("refusing redirect to %s", req.URL.Host)
	}
	return nil
}

func normalizePDBID(raw string) (string, bool) {
	switch {
	case pdbIDPattern.MatchString(raw):
		return strings.ToUpper(raw), true
	case extendedPDBIDPattern.MatchString(raw):
		return strings.ToLower(raw), true
	default:
		return "", false
	}
}

func normalizeAccession(raw string) (string, bool) {
	accession := strings.ToUpper(raw)
	if !accessionPattern.MatchString(accession) {
		return "", false
	}
	return accession, true
}

func (a *app) fetchPDB(w http.ResponseWriter, r *http.Request) {
	id, ok := normalizePDBID(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid PDB ID: use a 4-character ID such as 1CRN or an extended ID such as pdb_00001crn.")
		return
	}
	a.serveRemote(w, r, "pdb", id+".cif", func(ctx context.Context) (payload, error) {
		return a.remote.pdbEntry(ctx, id)
	})
}

func (a *app) fetchAlphaFold(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "afdb", accession+".cif", func(ctx context.Context) (payload, error) {
			return a.remote.alphaFoldModel(ctx, accession)
		})
	}
}

func (a *app) fetchAlphaFoldPAE(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "afdb", accession+".pae.json", func(ctx context.Context) (payload, error) {
			return a.remote.alphaFoldPAE(ctx, accession)
		})
	}
}

func (a *app) fetchAlphaMissense(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "afdb", accession+".missense.csv", func(ctx context.Context) (payload, error) {
			return a.remote.alphaMissense(ctx, accession)
		})
	}
}

func (a *app) fetchAlphaFoldMSA(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "afdb", accession+".msa.a3m", func(ctx context.Context) (payload, error) {
			return a.remote.alphaFoldMSA(ctx, accession)
		})
	}
}

func (a *app) fetchUniProt(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "uniprot", accession+".json", func(ctx context.Context) (payload, error) {
			return a.remote.uniProtEntry(ctx, accession)
		})
	}
}

func accessionParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	accession, ok := normalizeAccession(r.PathValue("accession"))
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid UniProt accession: use an accession such as P69905 or P04637-2.")
	}
	return accession, ok
}

// Serves a download from the cache when it is fresh. "?refresh=1" skips the cache; an expired
// entry is refetched and still served, marked stale, if the upstream cannot be reached.
func (a *app) serveRemote(w http.ResponseWriter, r *http.Request, kind, name string, fetch func(context.Context) (payload, error)) {
	refresh := r.URL.Query().Get("refresh") != ""
	cached, ok, stale := a.cache.load(kind, name)
	if ok && !stale && !refresh {
		writePayload(w, cached, "hit")
		return
	}
	if a.offline {
		if ok {
			writePayload(w, cached, "stale")
			return
		}
		writeError(w, http.StatusForbidden, offlineMessage)
		return
	}
	fresh, err := fetch(r.Context())
	if err != nil {
		log.Printf("fetch %s/%s: %v", kind, name, err)
		var fetchErr *fetchError
		if ok && !(errors.As(err, &fetchErr) && fetchErr.status == http.StatusNotFound) {
			writePayload(w, cached, "stale")
			return
		}
		writeFetchError(w, err)
		return
	}
	if fresh.partial {
		// An earlier complete answer beats a partial one, unless the user asked for a refresh.
		if ok && !refresh {
			writePayload(w, cached, "stale")
			return
		}
		writePayload(w, fresh, "partial")
		return
	}
	a.cache.store(kind, name, fresh)
	writePayload(w, fresh, "miss")
}

func writeFetchError(w http.ResponseWriter, err error) {
	var fetchErr *fetchError
	if errors.As(err, &fetchErr) {
		writeError(w, fetchErr.status, fetchErr.message)
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

func writePayload(w http.ResponseWriter, p payload, cacheStatus string) {
	header := w.Header()
	for key, value := range p.headers {
		header.Set(key, value)
	}
	header.Set("Content-Type", p.contentType)
	header.Set("Content-Length", strconv.Itoa(len(p.body)))
	header.Set("Cache-Control", "no-store")
	header.Set("X-Proteoscope-Cache", cacheStatus)
	w.Write(p.body)
}

func (u *upstream) pdbEntry(ctx context.Context, id string) (payload, error) {
	for _, suffix := range []string{".cif.gz", ".cif"} {
		source := u.rcsb + "/download/" + id + suffix
		body, err := u.download(ctx, source, "RCSB")
		if errors.Is(err, errUpstreamNotFound) {
			continue
		}
		if err != nil {
			return payload{}, err
		}
		return textPayload(body, id+".cif", source), nil
	}
	return payload{}, fetchErrorf(http.StatusNotFound, "PDB entry %s was not found at RCSB", id)
}

func (u *upstream) alphaFoldModel(ctx context.Context, accession string) (payload, error) {
	entry, err := u.alphaFoldEntry(ctx, accession)
	if err != nil {
		return payload{}, err
	}
	model, err := u.alphaFoldFileURL(entry.CifURL)
	if err != nil {
		return payload{}, err
	}
	body, err := u.alphaFoldFile(ctx, model)
	if err != nil {
		return payload{}, err
	}
	meta, err := json.Marshal(entry.afdbMeta)
	if err != nil {
		return payload{}, err
	}
	result := textPayload(body, path.Base(model.Path), model.String())
	result.headers["X-Proteoscope-Meta-B64"] = base64.StdEncoding.EncodeToString(meta)
	if _, err := u.alphaFoldFileURL(entry.PaeDocURL); err == nil {
		result.headers["X-Proteoscope-Pae"] = "/api/fetch/afdb/" + accession + "/pae"
	}
	if _, err := u.alphaFoldFileURL(entry.AmAnnotationsURL); err == nil && entry.AmAnnotationsURL != "" {
		result.headers["X-Proteoscope-Missense"] = "/api/fetch/afdb/" + accession + "/missense"
	}
	if _, err := u.alphaFoldFileURL(entry.MsaURL); err == nil && entry.MsaURL != "" {
		result.headers["X-Proteoscope-Msa"] = "/api/fetch/afdb/" + accession + "/msa"
	}
	return result, nil
}

// The multiple sequence alignment (A3M) AlphaFold DB used for a model, published since v6.
func (u *upstream) alphaFoldMSA(ctx context.Context, accession string) (payload, error) {
	entry, err := u.alphaFoldEntry(ctx, accession)
	if err != nil {
		return payload{}, err
	}
	if entry.MsaURL == "" {
		return payload{}, fetchErrorf(http.StatusNotFound, "AlphaFold DB has no MSA for %s", accession)
	}
	file, err := u.alphaFoldFileURL(entry.MsaURL)
	if err != nil {
		return payload{}, err
	}
	body, err := u.alphaFoldFile(ctx, file)
	if err != nil {
		return payload{}, err
	}
	return textPayload(body, path.Base(file.Path), file.String()), nil
}

// AlphaMissense pathogenicity for every possible substitution (Cheng et al. 2023), published by
// AlphaFold DB for human proteins as one CSV per UniProt entry.
func (u *upstream) alphaMissense(ctx context.Context, accession string) (payload, error) {
	entry, err := u.alphaFoldEntry(ctx, accession)
	if err != nil {
		return payload{}, err
	}
	if entry.AmAnnotationsURL == "" {
		return payload{}, fetchErrorf(http.StatusNotFound, "AlphaFold DB has no AlphaMissense predictions for %s (they cover human proteins only)", accession)
	}
	file, err := u.alphaFoldFileURL(entry.AmAnnotationsURL)
	if err != nil {
		return payload{}, err
	}
	body, err := u.alphaFoldFile(ctx, file)
	if err != nil {
		return payload{}, err
	}
	return textPayload(body, path.Base(file.Path), file.String()), nil
}

func (u *upstream) alphaFoldPAE(ctx context.Context, accession string) (payload, error) {
	entry, err := u.alphaFoldEntry(ctx, accession)
	if err != nil {
		return payload{}, err
	}
	if entry.PaeDocURL == "" {
		return payload{}, fetchErrorf(http.StatusNotFound, "AlphaFold DB has no PAE data for %s", accession)
	}
	pae, err := u.alphaFoldFileURL(entry.PaeDocURL)
	if err != nil {
		return payload{}, err
	}
	body, err := u.alphaFoldFile(ctx, pae)
	if err != nil {
		return payload{}, err
	}
	return jsonPayload(body, "AlphaFold DB", pae.String())
}

func (u *upstream) alphaFoldEntry(ctx context.Context, accession string) (afdbEntry, error) {
	body, err := u.download(ctx, u.afdb+"/api/prediction/"+accession, "AlphaFold DB")
	if errors.Is(err, errUpstreamNotFound) {
		return afdbEntry{}, alphaFoldNotFound(accession)
	}
	if err != nil {
		return afdbEntry{}, err
	}
	var entries []afdbEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return afdbEntry{}, fetchErrorf(http.StatusBadGateway, "AlphaFold DB returned an unexpected response for %s", accession)
	}
	return selectAlphaFoldEntry(entries, accession)
}

func selectAlphaFoldEntry(entries []afdbEntry, accession string) (afdbEntry, error) {
	if len(entries) == 0 {
		return afdbEntry{}, alphaFoldNotFound(accession)
	}
	canonical := "AF-" + accession + "-F1"
	for _, entry := range entries {
		if entry.id() == canonical {
			return entry, nil
		}
	}
	return entries[0], nil
}

func alphaFoldNotFound(accession string) error {
	return fetchErrorf(http.StatusNotFound, "No AlphaFold DB prediction was found for UniProt accession %s", accession)
}

func (u *upstream) alphaFoldFileURL(raw string) (*url.URL, error) {
	base, err := url.Parse(u.afdb)
	if err != nil {
		return nil, err
	}
	file, err := url.Parse(raw)
	if err != nil || file.Scheme != base.Scheme || !strings.EqualFold(file.Host, base.Host) || file.User != nil {
		return nil, fetchErrorf(http.StatusBadGateway, "AlphaFold DB returned a file URL outside %s", base.Host)
	}
	return file, nil
}

func (u *upstream) alphaFoldFile(ctx context.Context, file *url.URL) ([]byte, error) {
	body, err := u.download(ctx, file.String(), "AlphaFold DB")
	if errors.Is(err, errUpstreamNotFound) {
		return nil, fetchErrorf(http.StatusBadGateway, "AlphaFold DB file %s is missing", path.Base(file.Path))
	}
	return body, err
}

func (u *upstream) uniProtEntry(ctx context.Context, accession string) (payload, error) {
	source := u.uniprot + "/uniprotkb/" + accession + ".json?fields=" + uniprotFields
	body, err := u.download(ctx, source, "UniProt")
	if errors.Is(err, errUpstreamNotFound) {
		return payload{}, fetchErrorf(http.StatusNotFound, "UniProt accession %s was not found", accession)
	}
	if err != nil {
		return payload{}, err
	}
	return jsonPayload(body, "UniProt", source)
}

func textPayload(body []byte, filename, source string) payload {
	return payload{body: body, contentType: textContentType, headers: map[string]string{
		"X-Proteoscope-Filename": filename,
		"X-Proteoscope-Source":   source,
	}}
}

func jsonPayload(body []byte, service, source string) (payload, error) {
	if !json.Valid(body) {
		return payload{}, fetchErrorf(http.StatusBadGateway, "%s returned invalid JSON", service)
	}
	return payload{body: body, contentType: jsonContentType, headers: map[string]string{
		"X-Proteoscope-Source": source,
	}}, nil
}

func (u *upstream) download(ctx context.Context, source, service string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Proteoscope/"+version+" (+local viewer)")
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, upstreamFailure(service, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, errUpstreamNotFound
	case resp.StatusCode != http.StatusOK:
		return nil, fetchErrorf(http.StatusBadGateway, "%s returned HTTP %d", service, resp.StatusCode)
	case resp.ContentLength > u.maxBytes:
		return nil, u.tooLarge(service)
	}
	body, err := decompressIfGzip(resp.Body)
	if err != nil {
		return nil, fetchErrorf(http.StatusBadGateway, "%s sent invalid compressed data: %v", service, err)
	}
	data, err := readLimited(body, u.maxBytes)
	if errors.Is(err, errTooLarge) {
		return nil, u.tooLarge(service)
	}
	if err != nil {
		return nil, upstreamFailure(service, err)
	}
	log.Printf("downloaded %s (%d bytes)", source, len(data))
	return data, nil
}

func (u *upstream) tooLarge(service string) error {
	return fetchErrorf(http.StatusBadGateway, "%s response is too large (limit %d MB)", service, u.maxBytes>>20)
}

func upstreamFailure(service string, err error) error {
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fetchErrorf(http.StatusGatewayTimeout, "%s did not respond in time", service)
	}
	return fetchErrorf(http.StatusBadGateway, "Could not download from %s: %v", service, err)
}

func decompressIfGzip(r io.Reader) (io.Reader, error) {
	buffered := bufio.NewReader(r)
	magic, err := buffered.Peek(2)
	if err != nil || magic[0] != 0x1f || magic[1] != 0x8b {
		return buffered, nil
	}
	return gzip.NewReader(buffered)
}

func readLimited(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errTooLarge
	}
	return data, nil
}
