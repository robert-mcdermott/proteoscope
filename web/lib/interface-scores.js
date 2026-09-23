// Interface confidence for predicted complexes, computed from the PAE matrix, per-residue pLDDT
// and coordinates, following the definitions in Dunbrack's ipsae.py (version 4, January 2026):
//
//   ipSAE (Dunbrack 2025): for each residue i of chain A, the mean pTM term 1/(1+(PAE_ij/d0)²)
//     over residues j of chain B with PAE_ij below a cutoff, with d0 from the number of those
//     residues (TM-score's d0 = 1.24·∛(L−15) − 1.8, L ≥ 26, d0 ≥ 1 Å, or 2 Å with nucleic acids);
//     the maximum over i gives A→B, and the larger direction is reported. Unlike ipTM it ignores
//     residues that are not confidently placed.
//   ipTM from PAE (d0 from both chain lengths, all pairs): the chain-pair ipTM AlphaFold 3 reports,
//     recomputed for predictors that do not report one.
//   pDockQ (Bryant et al. 2022) and pDockQ2 (Zhu et al. 2023): sigmoids of the pLDDT of interface
//     residues, the number of contacts (Cβ within 8 Å) and, for pDockQ2, the pTM term (d0 = 10 Å) of
//     the PAE of contacting pairs.
//   LIS (Kim et al. 2024): the mean of (12 − PAE)/12 over pairs with PAE below 12 Å, averaged over
//     both directions.
//
// Only polymer residues take part; ligand atoms and the extra atom tokens of modified residues
// are masked out.

export const DEFAULT_PAE_CUTOFF = 10;
export const CONTACT_DISTANCE = 8;

export function tmD0(length, nucleic = false) {
  const L = Math.max(26, length);
  const d0 = 1.24 * Math.cbrt(L - 15) - 1.8;
  return Math.max(nucleic ? 2 : 1, d0);
}

function ptmTerm(pae, d0) {
  const ratio = pae / d0;
  return 1 / (1 + ratio * ratio);
}

// tokens: [{ chain, plddt (0–100), position: [x, y, z] (Cβ, Cα for Gly, C3' for nucleotides),
// polymer, nucleic }] in PAE order; pae: { size, matrix }. Returns { chains, pairs }, where pairs
// lists every ordered-independent chain pair with its scores and interface residues.
export function interfaceScores(pae, tokens, options = {}) {
  const cutoff = options.paeCutoff ?? DEFAULT_PAE_CUTOFF;
  const contactDistance = options.contactDistance ?? CONTACT_DISTANCE;
  const n = pae.size;
  if (tokens.length !== n) throw new Error(`The PAE matrix has ${n} rows but the model has ${tokens.length} tokens.`);
  const chains = [];
  const members = new Map();
  tokens.forEach((token, index) => {
    if (!token?.polymer) return;
    if (!members.has(token.chain)) {
      members.set(token.chain, []);
      chains.push(token.chain);
    }
    members.get(token.chain).push(index);
  });
  const nucleic = (chain) => members.get(chain).some((index) => tokens[index].nucleic);
  const pairs = [];
  for (let a = 0; a < chains.length; a += 1) {
    for (let b = a + 1; b < chains.length; b += 1) {
      const A = members.get(chains[a]);
      const B = members.get(chains[b]);
      const pairNucleic = nucleic(chains[a]) || nucleic(chains[b]);
      const ab = directional(pae.matrix, n, A, B, cutoff, pairNucleic);
      const ba = directional(pae.matrix, n, B, A, cutoff, pairNucleic);
      const contacts = interfaceContacts(tokens, A, B, contactDistance);
      pairs.push({
        chainA: chains[a],
        chainB: chains[b],
        ipsae: Math.max(ab.ipsae, ba.ipsae),
        ipsaeAB: ab.ipsae,
        ipsaeBA: ba.ipsae,
        iptm: Math.max(ab.iptm, ba.iptm),
        iptmAB: ab.iptm,
        iptmBA: ba.iptm,
        lis: (ab.lis + ba.lis) / 2,
        pdockq: pDockQ(tokens, contacts),
        pdockq2: Math.max(pDockQ2(pae.matrix, n, tokens, contacts, false), pDockQ2(pae.matrix, n, tokens, contacts, true)),
        contacts: contacts.pairs.length,
        interface: [...contacts.residuesA, ...contacts.residuesB],
      });
    }
  }
  return { chains, pairs };
}

function directional(matrix, n, A, B, cutoff, nucleic) {
  const d0chn = tmD0(A.length + B.length, nucleic);
  let ipsae = 0;
  let iptm = 0;
  let lisSum = 0;
  let lisCount = 0;
  for (const i of A) {
    let sum = 0;
    let count = 0;
    let allSum = 0;
    for (const j of B) {
      const value = matrix[i * n + j];
      allSum += ptmTerm(value, d0chn);
      if (value < cutoff) count += 1;
      if (value < 12) {
        lisSum += (12 - value) / 12;
        lisCount += 1;
      }
    }
    if (B.length) iptm = Math.max(iptm, allSum / B.length);
    if (!count) continue;
    const d0res = tmD0(count, nucleic);
    for (const j of B) {
      const value = matrix[i * n + j];
      if (value < cutoff) sum += ptmTerm(value, d0res);
    }
    ipsae = Math.max(ipsae, sum / count);
  }
  return { ipsae, iptm, lis: lisCount ? lisSum / lisCount : 0 };
}

function interfaceContacts(tokens, A, B, distance) {
  const limit = distance * distance;
  const pairs = [];
  const residuesA = new Set();
  const residuesB = new Set();
  for (const i of A) {
    const p = tokens[i].position;
    if (!p) continue;
    for (const j of B) {
      const q = tokens[j].position;
      if (!q) continue;
      const dx = p[0] - q[0];
      const dy = p[1] - q[1];
      const dz = p[2] - q[2];
      if (dx * dx + dy * dy + dz * dz <= limit) {
        pairs.push([i, j]);
        residuesA.add(i);
        residuesB.add(j);
      }
    }
  }
  return { pairs, residuesA, residuesB };
}

export function pDockQ(tokens, contacts) {
  if (!contacts.pairs.length) return 0;
  const interfaceTokens = [...contacts.residuesA, ...contacts.residuesB];
  const meanPLDDT = interfaceTokens.reduce((sum, index) => sum + tokens[index].plddt, 0) / interfaceTokens.length;
  const x = meanPLDDT * Math.log10(contacts.pairs.length);
  return 0.724 / (1 + Math.exp(-0.052 * (x - 152.611))) + 0.018;
}

// pDockQ2 in one direction: the PAE of each contacting pair taken as aligned on chain A (or on
// chain B when reversed), with the pLDDT of the interface residues of both chains.
export function pDockQ2(matrix, n, tokens, contacts, reverse) {
  if (!contacts.pairs.length) return 0;
  let ptmSum = 0;
  for (const [i, j] of contacts.pairs) ptmSum += ptmTerm(reverse ? matrix[j * n + i] : matrix[i * n + j], 10);
  const interfaceTokens = [...contacts.residuesA, ...contacts.residuesB];
  const meanPLDDT = interfaceTokens.reduce((sum, index) => sum + tokens[index].plddt, 0) / interfaceTokens.length;
  const x = meanPLDDT * (ptmSum / contacts.pairs.length);
  return 1.31 / (1 + Math.exp(-0.075 * (x - 84.733))) + 0.005;
}
