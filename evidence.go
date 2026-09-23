package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// Public proteomics evidence from the EBI Proteins API: peptides observed in PeptideAtlas,
// ProteomicsDB, MaxQB and other resources, and PTM sites from reprocessed PRIDE datasets
// (PTMeXchange), reduced to protein positions. Sites are merged by position and modification,
// with every dataset that reports them, the best site probability, and the best PTMeXchange
// confidence (Gold, Silver, Bronze).

type evidencePeptide struct {
	Begin        int      `json:"begin"`
	End          int      `json:"end"`
	Sequence     string   `json:"sequence"`
	Unique       bool     `json:"unique"`
	Sources      []string `json:"sources"`
	Observations int      `json:"observations,omitempty"`
}

type evidenceSite struct {
	Position    int      `json:"position"`
	Residue     string   `json:"residue"`
	Name        string   `json:"name"`
	Sources     []string `json:"sources"`
	Datasets    []string `json:"datasets"`
	Probability *float64 `json:"probability,omitempty"`
	Confidence  string   `json:"confidence,omitempty"`
	Peptides    int      `json:"peptides"`
}

type proteinEvidence struct {
	Accession string            `json:"accession"`
	Length    int               `json:"length"`
	Peptides  []evidencePeptide `json:"peptides"`
	Sites     []evidenceSite    `json:"sites"`
	Problems  []string          `json:"problems,omitempty"`
}

type proteinsAPIEntry struct {
	Sequence string `json:"sequence"`
	Features []struct {
		Begin     string `json:"begin"`
		End       string `json:"end"`
		Peptide   string `json:"peptide"`
		Unique    bool   `json:"unique"`
		Evidences []struct {
			Source struct {
				Name       string            `json:"name"`
				Properties map[string]string `json:"properties"`
			} `json:"source"`
		} `json:"evidences"`
		PTMs []struct {
			Name         string   `json:"name"`
			Position     int      `json:"position"`
			Sources      []string `json:"sources"`
			DBReferences []struct {
				ID         string            `json:"id"`
				Properties map[string]string `json:"properties"`
			} `json:"dbReferences"`
		} `json:"ptms"`
	} `json:"features"`
}

// GET /api/fetch/proteomics/{accession}
func (a *app) fetchProteomicsEvidence(w http.ResponseWriter, r *http.Request) {
	if accession, ok := accessionParam(w, r); ok {
		a.serveRemote(w, r, "evidence", accession+".json", func(ctx context.Context) (payload, error) {
			return a.remote.proteomicsEvidence(ctx, accession)
		})
	}
}

func (u *upstream) proteomicsEvidence(ctx context.Context, accession string) (payload, error) {
	var (
		wait               sync.WaitGroup
		peptides, ptms     proteinsAPIEntry
		peptideErr, ptmErr error
	)
	wait.Add(2)
	go func() {
		defer wait.Done()
		peptideErr = u.proteinsAPI(ctx, "/proteins/api/proteomics/nonPtm/"+accession, &peptides)
	}()
	go func() {
		defer wait.Done()
		ptmErr = u.proteinsAPI(ctx, "/proteins/api/proteomics/ptm/"+accession, &ptms)
	}()
	wait.Wait()
	result := proteinEvidence{Accession: accession, Peptides: []evidencePeptide{}, Sites: []evidenceSite{}}
	failed := 0
	for _, err := range []error{peptideErr, ptmErr} {
		if err != nil && !errors.Is(err, errUpstreamNotFound) {
			failed++
			result.Problems = append(result.Problems, err.Error())
		}
	}
	if failed == 2 {
		return payload{}, peptideErr
	}
	sequence := peptides.Sequence
	if sequence == "" {
		sequence = ptms.Sequence
	}
	result.Length = len(sequence)
	for _, feature := range peptides.Features {
		begin, errBegin := strconv.Atoi(feature.Begin)
		end, errEnd := strconv.Atoi(feature.End)
		if errBegin != nil || errEnd != nil || feature.Peptide == "" {
			continue
		}
		peptide := evidencePeptide{Begin: begin, End: end, Sequence: feature.Peptide, Unique: feature.Unique}
		for _, evidence := range feature.Evidences {
			peptide.Sources = appendUnique(peptide.Sources, evidence.Source.Name)
			if count, err := strconv.Atoi(evidence.Source.Properties["Times of observations"]); err == nil {
				peptide.Observations += count
			}
		}
		result.Peptides = append(result.Peptides, peptide)
	}
	sites := map[string]*evidenceSite{}
	var order []string
	for _, feature := range ptms.Features {
		begin, err := strconv.Atoi(feature.Begin)
		if err != nil {
			continue
		}
		for _, ptm := range feature.PTMs {
			position := begin + ptm.Position - 1
			key := strconv.Itoa(position) + "|" + ptm.Name
			site := sites[key]
			if site == nil {
				residue := ""
				if position >= 1 && position <= len(sequence) {
					residue = sequence[position-1 : position]
				}
				site = &evidenceSite{Position: position, Residue: residue, Name: ptm.Name, Sources: []string{}, Datasets: []string{}}
				sites[key] = site
				order = append(order, key)
			}
			site.Peptides++
			for _, source := range ptm.Sources {
				site.Sources = appendUnique(site.Sources, source)
			}
			for _, reference := range ptm.DBReferences {
				site.Datasets = appendUnique(site.Datasets, reference.ID)
				for _, name := range []string{"Final site probability", "Localization probability"} {
					if value, err := strconv.ParseFloat(reference.Properties[name], 64); err == nil && (site.Probability == nil || value > *site.Probability) {
						probability := value
						site.Probability = &probability
					}
				}
				if confidenceRank(reference.Properties["Confidence score"]) > confidenceRank(site.Confidence) {
					site.Confidence = reference.Properties["Confidence score"]
				}
			}
		}
	}
	for _, key := range order {
		result.Sites = append(result.Sites, *sites[key])
	}
	sort.SliceStable(result.Sites, func(i, j int) bool { return result.Sites[i].Position < result.Sites[j].Position })
	p, err := marshalPayload(result, "EBI Proteins API")
	p.partial = len(result.Problems) > 0
	return p, err
}

func confidenceRank(confidence string) int {
	switch strings.ToLower(strings.TrimSpace(confidence)) {
	case "gold":
		return 3
	case "silver":
		return 2
	case "bronze":
		return 1
	default:
		return 0
	}
}

func (u *upstream) proteinsAPI(ctx context.Context, path string, target any) error {
	data, _, err := u.send(ctx, http.MethodGet, u.ebi+path, nil, "EBI Proteins API")
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fetchErrorf(http.StatusBadGateway, "EBI Proteins API returned an unexpected response")
	}
	return nil
}
