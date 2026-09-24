package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

// Chemical Component Dictionary entries: one small mmCIF file per ligand or modified residue
// with its bond orders, aromatic flags and formal charges. The page asks for the components a
// structure file does not define itself (PDB files, predictions); RCSB and PDBe mmCIF files
// carry their own.

var ccdIDPattern = regexp.MustCompile(`^[A-Za-z0-9]{1,5}$`)

func (a *app) fetchComponent(w http.ResponseWriter, r *http.Request) {
	id := strings.ToUpper(r.PathValue("id"))
	if !ccdIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "Invalid chemical component ID: use 1 to 5 letters or digits, such as ATP or HEM.")
		return
	}
	// A prefix keeps components named CON, NUL, AUX or PRN clear of Windows device names.
	a.serveRemote(w, r, "ccd", "ccd-"+id+".cif", func(ctx context.Context) (payload, error) {
		return a.remote.chemicalComponent(ctx, id)
	})
}

func (u *upstream) chemicalComponent(ctx context.Context, id string) (payload, error) {
	source := u.rcsb + "/ligands/view/" + id + ".cif"
	body, err := u.download(ctx, source, "RCSB")
	if errors.Is(err, errUpstreamNotFound) {
		return payload{}, fetchErrorf(http.StatusNotFound, "The Chemical Component Dictionary has no component %s", id)
	}
	if err != nil {
		return payload{}, err
	}
	if !bytes.HasPrefix(bytes.TrimSpace(body), []byte("data_")) {
		return payload{}, fetchErrorf(http.StatusBadGateway, "RCSB returned an unexpected file for component %s", id)
	}
	return textPayload(body, id+".cif", source), nil
}
