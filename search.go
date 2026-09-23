package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Discovery: searches of public databases that need no key, reduced to what the "Find structures"
// panel lists. RCSB PDB answers text and sequence searches (and describes entries through its
// GraphQL API); UniProt finds proteins by gene or name; PDBe ranks the experimental structures of
// a protein and 3D-Beacons lists its models (AlphaFold DB, SWISS-MODEL, ModelArchive, PED …).
// Results are cached for a day ("search" kind) and honor --offline like downloads.

const (
	searchCacheAge     = 24 * time.Hour
	maxSearchRows      = 50
	maxProteinChains   = 400
	maxSummaryEntries  = 60
	maxSearchQuery     = 500
	minSearchSequence  = 20
	maxSearchSequence  = 5000
	defaultSearchLimit = 25
)

var (
	organismPattern   = regexp.MustCompile(`^[0-9]{1,8}$`)
	sequenceLetters   = regexp.MustCompile(`^[ACDEFGHIKLMNPQRSTVWYBZXUO]+$`)
	defaultModelHosts = []string{
		"https://alphafold.ebi.ac.uk", "https://swissmodel.expasy.org", "https://alphafill.eu",
		"https://www.modelarchive.org", "https://modelarchive.org", "https://data.isoform.io",
		"https://www.sasbdb.org", "https://deposition.proteinensemble.org", "https://proteinensemble.org",
		"https://www.ebi.ac.uk", "https://files.rcsb.org", "https://models.rcsb.org",
	}
)

type entrySummary struct {
	ID         string          `json:"id"`
	Title      string          `json:"title,omitempty"`
	Method     string          `json:"method,omitempty"`
	Resolution *float64        `json:"resolution,omitempty"`
	Released   string          `json:"released,omitempty"`
	Atoms      int             `json:"atoms,omitempty"`
	Organisms  []string        `json:"organisms,omitempty"`
	Molecules  []string        `json:"molecules,omitempty"`
	Accessions []string        `json:"accessions,omitempty"`
	Ligands    []ligandSummary `json:"ligands,omitempty"`
	Match      *sequenceMatch  `json:"match,omitempty"`
}

type ligandSummary struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type sequenceMatch struct {
	Entity        string  `json:"entity"`
	Identity      float64 `json:"identity"`
	EValue        float64 `json:"evalue"`
	QueryFrom     int     `json:"queryFrom"`
	QueryTo       int     `json:"queryTo"`
	QueryLength   int     `json:"queryLength"`
	SubjectFrom   int     `json:"subjectFrom"`
	SubjectTo     int     `json:"subjectTo"`
	SubjectLength int     `json:"subjectLength"`
}

type entrySearch struct {
	Query   string         `json:"query"`
	Total   int            `json:"total"`
	Entries []entrySummary `json:"entries"`
}

type proteinCandidate struct {
	Accession string `json:"accession"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Gene      string `json:"gene,omitempty"`
	Organism  string `json:"organism,omitempty"`
	TaxID     int    `json:"taxId,omitempty"`
	Length    int    `json:"length,omitempty"`
	Reviewed  bool   `json:"reviewed"`
}

type proteinSearch struct {
	Query   string             `json:"query"`
	Results []proteinCandidate `json:"results"`
}

type structureChain struct {
	PDB        string   `json:"pdb"`
	Chain      string   `json:"chain"`
	Method     string   `json:"method,omitempty"`
	Resolution *float64 `json:"resolution,omitempty"`
	Coverage   float64  `json:"coverage"`
	UnpStart   int      `json:"unpStart"`
	UnpEnd     int      `json:"unpEnd"`
	TaxID      int      `json:"taxId,omitempty"`
}

type modelSummary struct {
	Provider       string   `json:"provider"`
	ID             string   `json:"id"`
	Category       string   `json:"category,omitempty"`
	URL            string   `json:"url"`
	Format         string   `json:"format,omitempty"`
	Page           string   `json:"page,omitempty"`
	UnpStart       int      `json:"unpStart,omitempty"`
	UnpEnd         int      `json:"unpEnd,omitempty"`
	Coverage       float64  `json:"coverage,omitempty"`
	Identity       float64  `json:"identity,omitempty"`
	ConfidenceType string   `json:"confidenceType,omitempty"`
	Confidence     *float64 `json:"confidence,omitempty"`
	Created        string   `json:"created,omitempty"`
	Oligomer       string   `json:"oligomer,omitempty"`
	Molecules      []string `json:"molecules,omitempty"`
	Fetchable      bool     `json:"fetchable"`
}

type proteinStructures struct {
	Accession  string                  `json:"accession"`
	Length     int                     `json:"length,omitempty"`
	Structures []structureChain        `json:"structures"`
	Entries    map[string]entrySummary `json:"entries"`
	Models     []modelSummary          `json:"models"`
	Problems   []string                `json:"problems,omitempty"`
}

func searchCacheName(kind string, parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return kind + "-" + hex.EncodeToString(sum[:12]) + ".json"
}

func cleanQuery(raw string) string {
	return strings.Join(strings.Fields(raw), " ")
}

// GET /api/search/text?q=…: RCSB full-text search over experimental entries.
func (a *app) searchText(w http.ResponseWriter, r *http.Request) {
	query := cleanQuery(r.URL.Query().Get("q"))
	if query == "" || len(query) > maxSearchQuery {
		writeError(w, http.StatusBadRequest, "Search for a protein, gene, ligand or keyword (up to 500 characters).")
		return
	}
	rows := searchLimit(r)
	a.serveRemote(w, r, "search", searchCacheName("text", query, strconv.Itoa(rows)), func(ctx context.Context) (payload, error) {
		return a.remote.textSearch(ctx, query, rows)
	})
}

// GET /api/search/sequence?seq=…: RCSB sequence search (MMseqs2), grouped by entry.
func (a *app) searchSequence(w http.ResponseWriter, r *http.Request) {
	sequence := normalizeSequence(r.URL.Query().Get("seq"))
	if len(sequence) < minSearchSequence || len(sequence) > maxSearchSequence || !sequenceLetters.MatchString(sequence) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("Search with a protein sequence of %d to %d one-letter residues.", minSearchSequence, maxSearchSequence))
		return
	}
	identity := boundedFloat(r.URL.Query().Get("identity"), 0.3, 0.1, 1)
	evalue := boundedFloat(r.URL.Query().Get("evalue"), 0.1, 1e-30, 10)
	a.serveRemote(w, r, "search", searchCacheName("sequence", sequence, fmt.Sprint(identity), fmt.Sprint(evalue)), func(ctx context.Context) (payload, error) {
		return a.remote.sequenceSearch(ctx, sequence, identity, evalue)
	})
}

// GET /api/search/uniprot?q=…&organism=9606: UniProtKB proteins, best ranked first.
func (a *app) searchUniProt(w http.ResponseWriter, r *http.Request) {
	query := cleanQuery(r.URL.Query().Get("q"))
	organism := r.URL.Query().Get("organism")
	if query == "" || len(query) > maxSearchQuery || (organism != "" && !organismPattern.MatchString(organism)) {
		writeError(w, http.StatusBadRequest, "Search UniProt with a gene or protein name, optionally with a numeric organism (taxonomy) ID.")
		return
	}
	a.serveRemote(w, r, "search", searchCacheName("uniprot", query, organism), func(ctx context.Context) (payload, error) {
		return a.remote.uniProtSearch(ctx, query, organism)
	})
}

// GET /api/search/protein/{accession}: experimental structures (PDBe) and models (3D-Beacons).
func (a *app) searchProtein(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "search", "protein-"+accession+".json", func(ctx context.Context) (payload, error) {
			return a.remote.proteinStructures(ctx, accession)
		})
	}
}

// GET /api/fetch/model?url=…: a model file listed by 3D-Beacons, from an allowed provider.
func (a *app) fetchModel(w http.ResponseWriter, r *http.Request) {
	source, err := a.remote.modelURL(r.URL.Query().Get("url"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := searchCacheName("model", source.String())
	name = strings.TrimSuffix(name, ".json") + ".txt"
	a.serveRemote(w, r, "model", name, func(ctx context.Context) (payload, error) {
		body, err := a.remote.download(ctx, source.String(), source.Host)
		if errors.Is(err, errUpstreamNotFound) {
			return payload{}, fetchErrorf(http.StatusNotFound, "%s no longer serves this model", source.Host)
		}
		if err != nil {
			return payload{}, err
		}
		return textPayload(body, modelFilename(source, body), source.String()), nil
	})
}

func searchLimit(r *http.Request) int {
	rows, err := strconv.Atoi(r.URL.Query().Get("rows"))
	if err != nil || rows < 1 {
		return defaultSearchLimit
	}
	return min(rows, maxSearchRows)
}

func boundedFloat(raw string, fallback, low, high float64) float64 {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(value) || value < low || value > high {
		return fallback
	}
	return value
}

// Accepts FASTA (header lines are dropped), whitespace, digits and lower case.
func normalizeSequence(raw string) string {
	var builder strings.Builder
	for _, line := range strings.Split(raw, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), ">") {
			continue
		}
		for _, char := range strings.ToUpper(line) {
			if char >= 'A' && char <= 'Z' || char == '*' {
				builder.WriteRune(char)
			}
		}
	}
	return strings.TrimSuffix(builder.String(), "*")
}

func (u *upstream) modelURL(raw string) (*url.URL, error) {
	source, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || source.User != nil || source.Host == "" {
		return nil, errors.New("Give the model URL listed by 3D-Beacons.")
	}
	origin := strings.ToLower(source.Scheme + "://" + source.Host)
	hosts := u.modelHosts
	if hosts == nil {
		hosts = defaultModelHosts
	}
	for _, allowed := range hosts {
		if origin == strings.ToLower(allowed) {
			return source, nil
		}
	}
	return nil, fmt.Errorf("Models are downloaded only from known providers (AlphaFold DB, SWISS-MODEL, ModelArchive, PED, PDBe …); %s is not one of them.", source.Host)
}

// The model's file name, for the parser: SWISS-MODEL serves "P01116.cif?range=…", AlphaFill
// "/v1/aff/P01116" with no extension, so the content decides between mmCIF and PDB.
func modelFilename(source *url.URL, body []byte) string {
	base := path.Base(source.Path)
	lower := strings.ToLower(base)
	for _, ext := range []string{".cif", ".pdb", ".mmcif", ".ent"} {
		if strings.HasSuffix(lower, ext) {
			return base
		}
	}
	head := string(body[:min(len(body), 2048)])
	if strings.HasPrefix(strings.TrimSpace(head), "data_") || strings.Contains(head, "\ndata_") {
		return base + ".cif"
	}
	return base + ".pdb"
}

/* ---------- RCSB ---------- */

func (u *upstream) textSearch(ctx context.Context, query string, rows int) (payload, error) {
	request := map[string]any{
		"query":       map[string]any{"type": "terminal", "service": "full_text", "parameters": map[string]any{"value": query}},
		"return_type": "entry",
		"request_options": map[string]any{
			"paginate":             map[string]any{"start": 0, "rows": rows},
			"results_content_type": []string{"experimental"},
			"sort":                 []map[string]any{{"sort_by": "score", "direction": "desc"}},
		},
	}
	var response struct {
		Total   int `json:"total_count"`
		Results []struct {
			Identifier string `json:"identifier"`
		} `json:"result_set"`
	}
	if err := u.rcsbQuery(ctx, request, &response); err != nil {
		return payload{}, err
	}
	ids := make([]string, 0, len(response.Results))
	for _, result := range response.Results {
		ids = append(ids, strings.ToUpper(result.Identifier))
	}
	summaries, err := u.entrySummaries(ctx, ids)
	if err != nil {
		return payload{}, err
	}
	result := entrySearch{Query: query, Total: response.Total, Entries: make([]entrySummary, 0, len(ids))}
	for _, id := range ids {
		if summary, ok := summaries[id]; ok {
			result.Entries = append(result.Entries, summary)
		} else {
			result.Entries = append(result.Entries, entrySummary{ID: id})
		}
	}
	return marshalPayload(result, "RCSB PDB search")
}

func (u *upstream) sequenceSearch(ctx context.Context, sequence string, identity, evalue float64) (payload, error) {
	request := map[string]any{
		"query": map[string]any{"type": "terminal", "service": "sequence", "parameters": map[string]any{
			"evalue_cutoff": evalue, "identity_cutoff": identity, "sequence_type": "protein", "value": sequence,
		}},
		"return_type": "polymer_entity",
		"request_options": map[string]any{
			"paginate":             map[string]any{"start": 0, "rows": 250},
			"results_content_type": []string{"experimental"},
			"scoring_strategy":     "sequence",
			"results_verbosity":    "verbose",
		},
	}
	var response struct {
		Total   int `json:"total_count"`
		Results []struct {
			Identifier string `json:"identifier"`
			Services   []struct {
				Nodes []struct {
					Context []struct {
						Identity      float64 `json:"sequence_identity"`
						EValue        float64 `json:"evalue"`
						QueryFrom     int     `json:"query_beg"`
						QueryTo       int     `json:"query_end"`
						QueryLength   int     `json:"query_length"`
						SubjectFrom   int     `json:"subject_beg"`
						SubjectTo     int     `json:"subject_end"`
						SubjectLength int     `json:"subject_length"`
					} `json:"match_context"`
				} `json:"nodes"`
			} `json:"services"`
		} `json:"result_set"`
	}
	if err := u.rcsbQuery(ctx, request, &response); err != nil {
		return payload{}, err
	}
	// One row per entry, with its best-matching polymer entity.
	best := map[string]sequenceMatch{}
	var order []string
	for _, result := range response.Results {
		// "8UDR_2": the entity number follows the last underscore (extended IDs such as
		// "pdb_00008udr_2" contain one more).
		entry, entity := result.Identifier, ""
		if cut := strings.LastIndex(entry, "_"); cut >= 0 {
			entry, entity = entry[:cut], entry[cut+1:]
		}
		entry = strings.ToUpper(entry)
		for _, service := range result.Services {
			for _, node := range service.Nodes {
				for _, context := range node.Context {
					match := sequenceMatch{Entity: entity, Identity: context.Identity, EValue: context.EValue,
						QueryFrom: context.QueryFrom, QueryTo: context.QueryTo, QueryLength: context.QueryLength,
						SubjectFrom: context.SubjectFrom, SubjectTo: context.SubjectTo, SubjectLength: context.SubjectLength}
					previous, seen := best[entry]
					if !seen {
						order = append(order, entry)
					}
					if !seen || match.Identity > previous.Identity || (match.Identity == previous.Identity && match.EValue < previous.EValue) {
						best[entry] = match
					}
				}
			}
		}
	}
	sort.SliceStable(order, func(i, j int) bool {
		a, b := best[order[i]], best[order[j]]
		if a.Identity != b.Identity {
			return a.Identity > b.Identity
		}
		return a.EValue < b.EValue
	})
	if len(order) > maxSearchRows {
		order = order[:maxSearchRows]
	}
	summaries, err := u.entrySummaries(ctx, order)
	if err != nil {
		return payload{}, err
	}
	result := entrySearch{Query: fmt.Sprintf("%d-residue sequence", len(sequence)), Total: len(best), Entries: make([]entrySummary, 0, len(order))}
	// The hits above are the best 250 chains; the number of matching entries needs a count query.
	if response.Total > len(response.Results) {
		countRequest := map[string]any{"query": request["query"], "return_type": "entry", "request_options": map[string]any{
			"return_counts": true, "results_content_type": []string{"experimental"},
		}}
		var counted struct {
			Total int `json:"total_count"`
		}
		if err := u.rcsbQuery(ctx, countRequest, &counted); err == nil && counted.Total > result.Total {
			result.Total = counted.Total
		}
	}
	for _, id := range order {
		summary := summaries[id]
		summary.ID = id
		match := best[id]
		summary.Match = &match
		result.Entries = append(result.Entries, summary)
	}
	return marshalPayload(result, "RCSB PDB sequence search")
}

// POSTs a Search API query. An empty result is HTTP 204.
func (u *upstream) rcsbQuery(ctx context.Context, request map[string]any, target any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return err
	}
	data, status, err := u.send(ctx, http.MethodPost, u.rcsbSearch+"/rcsbsearch/v2/query", body, "RCSB PDB search")
	if err != nil {
		return err
	}
	if status == http.StatusNoContent || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fetchErrorf(http.StatusBadGateway, "RCSB PDB search returned an unexpected response")
	}
	return nil
}

const entrySummaryFields = `rcsb_id struct{title} exptl{method} rcsb_entry_info{resolution_combined deposited_atom_count}
rcsb_accession_info{initial_release_date}
polymer_entities{rcsb_polymer_entity{pdbx_description} rcsb_entity_source_organism{scientific_name}
rcsb_polymer_entity_container_identifiers{reference_sequence_identifiers{database_name database_accession}}}
nonpolymer_entities{nonpolymer_comp{chem_comp{id name}}}`

// Common additives are left out of the ligand lists.
var additiveLigands = map[string]bool{
	"HOH": true, "SO4": true, "PO4": true, "GOL": true, "EDO": true, "PEG": true, "PG4": true, "PGE": true, "1PE": true,
	"CL": true, "NA": true, "K": true, "ACT": true, "FMT": true, "DMS": true, "MPD": true, "TRS": true, "EPE": true,
	"MES": true, "IMD": true, "BME": true, "NO3": true, "IOD": true, "BR": true, "CIT": true, "ACY": true, "MLI": true,
	"SCN": true, "NH4": true, "AZI": true, "IPA": true, "EOH": true, "MOH": true, "PEU": true, "P6G": true, "UNX": true,
}

func (u *upstream) entrySummaries(ctx context.Context, ids []string) (map[string]entrySummary, error) {
	summaries := map[string]entrySummary{}
	if len(ids) == 0 {
		return summaries, nil
	}
	quoted := make([]string, len(ids))
	for i, id := range ids {
		quoted[i] = strconv.Quote(id)
	}
	query := "{entries(entry_ids:[" + strings.Join(quoted, ",") + "]){" + entrySummaryFields + "}}"
	data, _, err := u.send(ctx, http.MethodGet, u.rcsbData+"/graphql?query="+url.QueryEscape(query), nil, "RCSB PDB data")
	if err != nil {
		return nil, err
	}
	var response struct {
		Data struct {
			Entries []struct {
				ID     string `json:"rcsb_id"`
				Struct struct {
					Title string `json:"title"`
				} `json:"struct"`
				Exptl []struct {
					Method string `json:"method"`
				} `json:"exptl"`
				Info struct {
					Resolution []float64 `json:"resolution_combined"`
					Atoms      int       `json:"deposited_atom_count"`
				} `json:"rcsb_entry_info"`
				Accession struct {
					Released string `json:"initial_release_date"`
				} `json:"rcsb_accession_info"`
				Polymers []struct {
					Entity struct {
						Description string `json:"pdbx_description"`
					} `json:"rcsb_polymer_entity"`
					Organisms []struct {
						Name string `json:"scientific_name"`
					} `json:"rcsb_entity_source_organism"`
					Identifiers struct {
						References []struct {
							Database  string `json:"database_name"`
							Accession string `json:"database_accession"`
						} `json:"reference_sequence_identifiers"`
					} `json:"rcsb_polymer_entity_container_identifiers"`
				} `json:"polymer_entities"`
				Nonpolymers []struct {
					Comp struct {
						Chem struct {
							ID   string `json:"id"`
							Name string `json:"name"`
						} `json:"chem_comp"`
					} `json:"nonpolymer_comp"`
				} `json:"nonpolymer_entities"`
			} `json:"entries"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, fetchErrorf(http.StatusBadGateway, "RCSB PDB data returned an unexpected response")
	}
	for _, entry := range response.Data.Entries {
		summary := entrySummary{ID: strings.ToUpper(entry.ID), Title: entry.Struct.Title, Atoms: entry.Info.Atoms}
		var methods []string
		for _, method := range entry.Exptl {
			methods = append(methods, method.Method)
		}
		summary.Method = strings.Join(methods, "; ")
		if len(entry.Info.Resolution) > 0 {
			resolution := entry.Info.Resolution[0]
			summary.Resolution = &resolution
		}
		if len(entry.Accession.Released) >= 10 {
			summary.Released = entry.Accession.Released[:10]
		}
		for _, polymer := range entry.Polymers {
			summary.Molecules = appendUnique(summary.Molecules, polymer.Entity.Description)
			for _, organism := range polymer.Organisms {
				summary.Organisms = appendUnique(summary.Organisms, organism.Name)
			}
			for _, reference := range polymer.Identifiers.References {
				if strings.EqualFold(reference.Database, "UniProt") {
					summary.Accessions = appendUnique(summary.Accessions, reference.Accession)
				}
			}
		}
		for _, ligand := range entry.Nonpolymers {
			if id := ligand.Comp.Chem.ID; id != "" && !additiveLigands[id] {
				summary.Ligands = append(summary.Ligands, ligandSummary{ID: id, Name: ligand.Comp.Chem.Name})
			}
		}
		summaries[summary.ID] = summary
	}
	return summaries, nil
}

func appendUnique(list []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return list
	}
	for _, item := range list {
		if item == value {
			return list
		}
	}
	return append(list, value)
}

/* ---------- UniProt ---------- */

var geneSymbolPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]{1,14}$`)

// UniProt ranks a bare "TP53" below proteins that mention it (TP53BP1 …), so a single word that
// could be a gene symbol is first looked up as an exact gene name.
func (u *upstream) uniProtSearch(ctx context.Context, query, organism string) (payload, error) {
	result := proteinSearch{Query: query, Results: []proteinCandidate{}}
	queries := []string{"(" + query + ")"}
	if geneSymbolPattern.MatchString(query) {
		queries = []string{"(gene_exact:" + query + ")", "(" + query + ")"}
	}
	seen := map[string]bool{}
	for index, text := range queries {
		candidates, err := u.uniProtQuery(ctx, text, organism)
		if err != nil {
			if index == 0 && len(queries) > 1 {
				continue
			}
			return payload{}, err
		}
		for _, candidate := range candidates {
			if !seen[candidate.Accession] && len(result.Results) < 10 {
				seen[candidate.Accession] = true
				result.Results = append(result.Results, candidate)
			}
		}
	}
	return marshalPayload(result, "UniProt")
}

func (u *upstream) uniProtQuery(ctx context.Context, query, organism string) ([]proteinCandidate, error) {
	if organism != "" {
		query += " AND (organism_id:" + organism + ")"
	}
	values := url.Values{
		"query":  {query},
		"fields": {"accession,id,protein_name,gene_primary,organism_name,organism_id,length,reviewed"},
		"format": {"json"},
		"size":   {"10"},
	}
	data, _, err := u.send(ctx, http.MethodGet, u.uniprot+"/uniprotkb/search?"+values.Encode(), nil, "UniProt")
	if err != nil {
		var fetchErr *fetchError
		if errors.As(err, &fetchErr) && fetchErr.status == http.StatusBadGateway && strings.Contains(fetchErr.message, "HTTP 400") {
			return nil, fetchErrorf(http.StatusBadRequest, "UniProt could not read the query %q", query)
		}
		return nil, err
	}
	var response struct {
		Results []struct {
			Accession   string `json:"primaryAccession"`
			ID          string `json:"uniProtkbId"`
			EntryType   string `json:"entryType"`
			Description struct {
				Recommended struct {
					FullName struct {
						Value string `json:"value"`
					} `json:"fullName"`
				} `json:"recommendedName"`
				Submission []struct {
					FullName struct {
						Value string `json:"value"`
					} `json:"fullName"`
				} `json:"submissionNames"`
			} `json:"proteinDescription"`
			Genes []struct {
				Name struct {
					Value string `json:"value"`
				} `json:"geneName"`
			} `json:"genes"`
			Organism struct {
				Name  string `json:"scientificName"`
				TaxID int    `json:"taxonId"`
			} `json:"organism"`
			Sequence struct {
				Length int `json:"length"`
			} `json:"sequence"`
		} `json:"results"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, fetchErrorf(http.StatusBadGateway, "UniProt returned an unexpected response")
	}
	candidates := []proteinCandidate{}
	for _, item := range response.Results {
		candidate := proteinCandidate{
			Accession: item.Accession, ID: item.ID, Name: item.Description.Recommended.FullName.Value,
			Organism: item.Organism.Name, TaxID: item.Organism.TaxID, Length: item.Sequence.Length,
			Reviewed: strings.Contains(strings.ToLower(item.EntryType), "reviewed") && !strings.Contains(strings.ToLower(item.EntryType), "unreviewed"),
		}
		if candidate.Name == "" && len(item.Description.Submission) > 0 {
			candidate.Name = item.Description.Submission[0].FullName.Value
		}
		if len(item.Genes) > 0 {
			candidate.Gene = item.Genes[0].Name.Value
		}
		candidates = append(candidates, candidate)
	}
	return candidates, nil
}

/* ---------- PDBe and 3D-Beacons ---------- */

func (u *upstream) proteinStructures(ctx context.Context, accession string) (payload, error) {
	result := proteinStructures{Accession: accession, Structures: []structureChain{}, Entries: map[string]entrySummary{}, Models: []modelSummary{}}
	var (
		wait              sync.WaitGroup
		bestErr, modelErr error
	)
	wait.Add(2)
	go func() {
		defer wait.Done()
		result.Structures, bestErr = u.bestStructures(ctx, accession)
	}()
	go func() {
		defer wait.Done()
		result.Length, result.Models, modelErr = u.beaconModels(ctx, accession)
	}()
	wait.Wait()
	// A protein without structures or models is an empty answer; a service that fails is reported
	// next to what the other one found, and only both failing is an error.
	failed := 0
	for _, err := range []error{bestErr, modelErr} {
		if err != nil && !errors.Is(err, errUpstreamNotFound) {
			failed++
			result.Problems = append(result.Problems, err.Error())
		}
	}
	if failed == 2 {
		return payload{}, bestErr
	}
	if result.Structures == nil {
		result.Structures = []structureChain{}
	}
	if result.Models == nil {
		result.Models = []modelSummary{}
	}
	var ids []string
	seen := map[string]bool{}
	for _, chain := range result.Structures {
		if !seen[chain.PDB] && len(ids) < maxSummaryEntries {
			seen[chain.PDB] = true
			ids = append(ids, chain.PDB)
		}
	}
	if summaries, err := u.entrySummaries(ctx, ids); err == nil {
		result.Entries = summaries
	} else {
		result.Problems = append(result.Problems, err.Error())
	}
	p, err := marshalPayload(result, "PDBe and 3D-Beacons")
	p.partial = len(result.Problems) > 0
	return p, err
}

// PDBe's ranking of the structures of a protein (by coverage, then resolution), one row per chain.
func (u *upstream) bestStructures(ctx context.Context, accession string) ([]structureChain, error) {
	data, _, err := u.send(ctx, http.MethodGet, u.ebi+"/pdbe/api/mappings/best_structures/"+accession, nil, "PDBe")
	if err != nil {
		return nil, err
	}
	var response map[string][]struct {
		PDB        string   `json:"pdb_id"`
		Chain      string   `json:"chain_id"`
		Method     string   `json:"experimental_method"`
		Resolution *float64 `json:"resolution"`
		TaxID      int      `json:"tax_id"`
		UnpStart   int      `json:"unp_start"`
		UnpEnd     int      `json:"unp_end"`
		Coverage   float64  `json:"coverage"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return nil, fetchErrorf(http.StatusBadGateway, "PDBe returned an unexpected response")
	}
	var chains []structureChain
	for _, rows := range response {
		for _, row := range rows {
			chains = append(chains, structureChain{PDB: strings.ToUpper(row.PDB), Chain: row.Chain, Method: row.Method, Resolution: row.Resolution,
				Coverage: row.Coverage, UnpStart: row.UnpStart, UnpEnd: row.UnpEnd, TaxID: row.TaxID})
			if len(chains) >= maxProteinChains {
				return chains, nil
			}
		}
	}
	return chains, nil
}

// Models of a protein from every 3D-Beacons provider except PDBe (whose entries bestStructures
// lists): AlphaFold DB, SWISS-MODEL, ModelArchive, PED, AlphaFill, isoform.io, SASBDB …
func (u *upstream) beaconModels(ctx context.Context, accession string) (int, []modelSummary, error) {
	data, _, err := u.send(ctx, http.MethodGet, u.ebi+"/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/"+accession+".json", nil, "3D-Beacons")
	if err != nil {
		return 0, nil, err
	}
	var response struct {
		Entry struct {
			Length int `json:"sequence_length"`
		} `json:"uniprot_entry"`
		Structures []struct {
			Summary struct {
				ID             string   `json:"model_identifier"`
				Category       string   `json:"model_category"`
				URL            string   `json:"model_url"`
				Format         string   `json:"model_format"`
				Page           string   `json:"model_page_url"`
				Provider       string   `json:"provider"`
				Created        string   `json:"created"`
				Identity       float64  `json:"sequence_identity"`
				UnpStart       int      `json:"uniprot_start"`
				UnpEnd         int      `json:"uniprot_end"`
				Coverage       float64  `json:"coverage"`
				ConfidenceType string   `json:"confidence_type"`
				Confidence     *float64 `json:"confidence_avg_local_score"`
				Oligomer       string   `json:"oligomeric_state"`
				Entities       []struct {
					Description string `json:"description"`
				} `json:"entities"`
			} `json:"summary"`
		} `json:"structures"`
	}
	if err := json.Unmarshal(data, &response); err != nil {
		return 0, nil, fetchErrorf(http.StatusBadGateway, "3D-Beacons returned an unexpected response")
	}
	var models []modelSummary
	for _, structure := range response.Structures {
		summary := structure.Summary
		if strings.EqualFold(summary.Provider, "PDBe") || summary.URL == "" {
			continue
		}
		model := modelSummary{Provider: summary.Provider, ID: summary.ID, Category: summary.Category, URL: summary.URL, Format: summary.Format,
			Page: summary.Page, UnpStart: summary.UnpStart, UnpEnd: summary.UnpEnd, Coverage: summary.Coverage, Identity: summary.Identity,
			ConfidenceType: summary.ConfidenceType, Confidence: summary.Confidence, Oligomer: summary.Oligomer}
		if len(summary.Created) >= 10 {
			model.Created = summary.Created[:10]
		}
		for _, entity := range summary.Entities {
			if len(model.Molecules) < 8 {
				model.Molecules = appendUnique(model.Molecules, entity.Description)
			}
		}
		_, err := u.modelURL(summary.URL)
		model.Fetchable = err == nil
		models = append(models, model)
	}
	// The canonical AlphaFold DB model first, then the other providers, then AlphaFold DB's other
	// models of the sequence (numbered entries such as AF-0000000210539554), each by confidence.
	canonical := "AF-" + accession + "-F1"
	tier := func(model modelSummary) int {
		switch {
		case model.ID == canonical:
			return 0
		case strings.EqualFold(model.Provider, "AlphaFold DB"):
			return 2
		default:
			return 1
		}
	}
	sort.SliceStable(models, func(i, j int) bool {
		a, b := models[i], models[j]
		if tier(a) != tier(b) {
			return tier(a) < tier(b)
		}
		if a.Provider != b.Provider {
			return providerRank(a.Provider) < providerRank(b.Provider)
		}
		return confidenceOf(a) > confidenceOf(b)
	})
	return response.Entry.Length, models, nil
}

func providerRank(provider string) int {
	for index, name := range []string{"AlphaFold DB", "SWISS-MODEL", "ModelArchive", "PED", "AlphaFill", "SASBDB", "isoform.io"} {
		if strings.EqualFold(provider, name) {
			return index
		}
	}
	return 100
}

func confidenceOf(model modelSummary) float64 {
	if model.Confidence == nil {
		return -1
	}
	return *model.Confidence
}

/* ---------- Transport ---------- */

func marshalPayload(value any, service string) (payload, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return payload{}, err
	}
	return payload{body: body, contentType: jsonContentType, headers: map[string]string{"X-Proteoscope-Source": service}}, nil
}

// Like download, for JSON services: GET or POST, HTTP 204 allowed, 404 as errUpstreamNotFound.
func (u *upstream) send(ctx context.Context, method, source string, body []byte, service string) ([]byte, int, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, source, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", "Proteoscope/"+version+" (+local viewer)")
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, 0, upstreamFailure(service, err)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotFound:
		return nil, resp.StatusCode, errUpstreamNotFound
	case resp.StatusCode == http.StatusNoContent:
		return nil, resp.StatusCode, nil
	case resp.StatusCode != http.StatusOK:
		return nil, resp.StatusCode, fetchErrorf(http.StatusBadGateway, "%s returned HTTP %d", service, resp.StatusCode)
	}
	reader, err = decompressIfGzip(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fetchErrorf(http.StatusBadGateway, "%s sent invalid compressed data: %v", service, err)
	}
	data, err := readLimited(reader, u.maxBytes)
	if errors.Is(err, errTooLarge) {
		return nil, resp.StatusCode, u.tooLarge(service)
	}
	if err != nil {
		return nil, resp.StatusCode, upstreamFailure(service, err)
	}
	log.Printf("%s %s (%d bytes)", method, truncateURL(source), len(data))
	return data, resp.StatusCode, nil
}

func truncateURL(source string) string {
	if len(source) > 160 {
		return source[:160] + "…"
	}
	return source
}
