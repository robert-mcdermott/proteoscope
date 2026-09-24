package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// wwPDB validation reports: the XML behind every entry's validation PDF, reduced to what the
// viewer draws. Entry-level attributes (percentiles, clashscore, R-free, resolution) pass through
// as strings; each residue keeps its identity, Ramachandran and rotamer class, numeric
// attributes (RSRZ, RSCC, Q-score …) and a count of outliers by kind; clash pairs are matched
// by their clash id so they can be drawn.

const maxValidationClashes = 20000

type validationReport struct {
	ID       string              `json:"id"`
	Source   string              `json:"source"`
	Entry    map[string]string   `json:"entry"`
	Residues []validationResidue `json:"residues"`
	Clashes  []validationClash   `json:"clashes"`
}

type validationResidue struct {
	Model    int                `json:"model"`
	Chain    string             `json:"chain"`
	Number   int                `json:"resnum"`
	ICode    string             `json:"icode,omitempty"`
	Name     string             `json:"resname"`
	LabelSeq string             `json:"seq,omitempty"`
	AltCode  string             `json:"altcode,omitempty"`
	Rama     string             `json:"rama,omitempty"`
	Rota     string             `json:"rota,omitempty"`
	Phi      *float64           `json:"phi,omitempty"`
	Psi      *float64           `json:"psi,omitempty"`
	Values   map[string]float64 `json:"values,omitempty"`
	Outliers map[string]int     `json:"outliers,omitempty"`
}

type validationAtom struct {
	Model  int    `json:"model"`
	Chain  string `json:"chain"`
	Number int    `json:"resnum"`
	ICode  string `json:"icode,omitempty"`
	Name   string `json:"resname"`
	Atom   string `json:"atom"`
}

type validationClash struct {
	A        validationAtom `json:"a"`
	B        validationAtom `json:"b"`
	Overlap  float64        `json:"overlap"`
	Distance float64        `json:"distance"`
}

// Residue attributes that identify the residue or are text; every other numeric attribute is kept
// in Values under its own name.
var validationIdentity = map[string]bool{
	"chain": true, "resnum": true, "icode": true, "resname": true, "model": true, "said": true, "seq": true,
	"ent": true, "altcode": true, "rama": true, "rota": true, "phi": true, "psi": true,
}

func (a *app) fetchValidation(w http.ResponseWriter, r *http.Request) {
	id, ok := normalizePDBID(r.PathValue("id"))
	if !ok || len(id) != 4 {
		writeError(w, http.StatusBadRequest, "Validation reports are available for 4-character PDB IDs such as 1M17.")
		return
	}
	a.serveRemote(w, r, "validation", id+".json", func(ctx context.Context) (payload, error) {
		return a.remote.validationReport(ctx, id)
	})
}

func (u *upstream) validationReport(ctx context.Context, id string) (payload, error) {
	lower := strings.ToLower(id)
	source := u.rcsb + "/pub/pdb/validation_reports/" + lower[1:3] + "/" + lower + "/" + lower + "_validation.xml.gz"
	body, err := u.download(ctx, source, "RCSB")
	if errors.Is(err, errUpstreamNotFound) {
		return payload{}, fetchErrorf(http.StatusNotFound, "No wwPDB validation report was found for %s (computed models and some older entries have none)", id)
	}
	if err != nil {
		return payload{}, err
	}
	report, err := parseValidationXML(bytes.NewReader(body))
	if err != nil {
		return payload{}, fetchErrorf(http.StatusBadGateway, "The validation report for %s could not be read: %v", id, err)
	}
	report.ID = id
	report.Source = source
	encoded, err := json.Marshal(report)
	if err != nil {
		return payload{}, err
	}
	return payload{body: encoded, contentType: jsonContentType, headers: map[string]string{"X-Proteoscope-Source": source}}, nil
}

func parseValidationXML(r io.Reader) (validationReport, error) {
	report := validationReport{Entry: map[string]string{}, Residues: []validationResidue{}, Clashes: []validationClash{}}
	decoder := xml.NewDecoder(r)
	var current *validationResidue
	sides := map[string]validationAtom{}
	overlaps := map[string][2]float64{}
	sawEntry := false
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return report, err
		}
		switch element := token.(type) {
		case xml.StartElement:
			switch element.Name.Local {
			case "Entry":
				sawEntry = true
				for _, attr := range element.Attr {
					report.Entry[attr.Name.Local] = strings.TrimSpace(attr.Value)
				}
			case "ModelledSubgroup":
				residue := newValidationResidue(element.Attr)
				report.Residues = append(report.Residues, residue)
				current = &report.Residues[len(report.Residues)-1]
			default:
				if current == nil {
					continue
				}
				kind := element.Name.Local
				if current.Outliers == nil {
					current.Outliers = map[string]int{}
				}
				current.Outliers[kind]++
				if kind == "clash" {
					pairClash(&report, current, element.Attr, sides, overlaps)
				}
			}
		case xml.EndElement:
			if element.Name.Local == "ModelledSubgroup" {
				current = nil
			}
		}
	}
	if !sawEntry {
		return report, errors.New("no <Entry> element")
	}
	return report, nil
}

func newValidationResidue(attrs []xml.Attr) validationResidue {
	residue := validationResidue{Model: 1}
	for _, attr := range attrs {
		value := strings.TrimSpace(attr.Value)
		switch attr.Name.Local {
		case "model":
			if model, err := strconv.Atoi(value); err == nil {
				residue.Model = model
			}
		case "chain":
			residue.Chain = value
		case "resnum":
			residue.Number, _ = strconv.Atoi(value)
		case "icode":
			residue.ICode = value
		case "resname":
			residue.Name = value
		case "seq":
			if value != "." {
				residue.LabelSeq = value
			}
		case "altcode":
			residue.AltCode = value
		case "rama":
			residue.Rama = value
		case "rota":
			residue.Rota = value
		case "phi", "psi":
			if number, err := strconv.ParseFloat(value, 64); err == nil {
				if attr.Name.Local == "phi" {
					residue.Phi = &number
				} else {
					residue.Psi = &number
				}
			}
		default:
			if validationIdentity[attr.Name.Local] {
				continue
			}
			if number, err := strconv.ParseFloat(value, 64); err == nil {
				if residue.Values == nil {
					residue.Values = map[string]float64{}
				}
				residue.Values[attr.Name.Local] = number
			}
		}
	}
	return residue
}

// Both atoms of a clash carry the same cid; the second one seen completes the pair.
func pairClash(report *validationReport, residue *validationResidue, attrs []xml.Attr, sides map[string]validationAtom, overlaps map[string][2]float64) {
	var cid, atom string
	var overlap, distance float64
	for _, attr := range attrs {
		switch attr.Name.Local {
		case "cid":
			cid = attr.Value
		case "atom":
			atom = strings.TrimSpace(attr.Value)
		case "clashmag":
			overlap, _ = strconv.ParseFloat(attr.Value, 64)
		case "dist":
			distance, _ = strconv.ParseFloat(attr.Value, 64)
		}
	}
	if cid == "" || atom == "" {
		return
	}
	key := strconv.Itoa(residue.Model) + "|" + cid
	side := validationAtom{Model: residue.Model, Chain: residue.Chain, Number: residue.Number, ICode: residue.ICode, Name: residue.Name, Atom: atom}
	first, seen := sides[key]
	if !seen {
		sides[key] = side
		overlaps[key] = [2]float64{overlap, distance}
		return
	}
	delete(sides, key)
	values := overlaps[key]
	delete(overlaps, key)
	if len(report.Clashes) < maxValidationClashes {
		report.Clashes = append(report.Clashes, validationClash{A: first, B: side, Overlap: values[0], Distance: values[1]})
	}
}
