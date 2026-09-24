// Structure comparison: pairs residues between two models (sequence alignment, UniProt numbering,
// shared residue keys, or a structure-only alignment by TM-align/MM-align computed beforehand),
// superposes them on their principal atoms (Cα, or C4′ for nucleic acids) and reports RMSD,
// TM-score and lDDT with per-residue deviations.
import { alignSequences } from './align.js';
import { uniprotPositionForResidue } from './structure.js';
import { iterativeFit, lddt, rmsf, tmScore, transformPoint, transformPoints } from './superpose.js';

export function principalAtom(residue) {
  if (!residue) return null;
  if (residue.kind === 'protein') return residue.backbone?.CA ?? null;
  if (residue.kind === 'nucleic') return residue.nucleic?.C4 ?? residue.nucleic?.P ?? null;
  return null;
}

// Chains as the structure aligner (tmalign.js) sees them: one atom per residue, Cα for proteins and
// C3′ for nucleic acids as in US-align, in file order (the chain's path, which sorted numbers do
// not give with insertion codes placed before their number, as in chymotrypsin numbering). Its
// residue indices map back through `residues`.
export function alignerChains(model, chainIds = null) {
  const chains = [];
  for (const chain of polymerChainResidues(model).values()) {
    if (chainIds?.length && !chainIds.includes(chain.id)) continue;
    const residues = chain.residues.filter((residue) => alignerAtom(residue)).sort((a, b) => a.atoms[0].id - b.atoms[0].id);
    if (residues.length < 3) continue;
    const coords = new Float64Array(residues.length * 3);
    residues.forEach((residue, index) => {
      const atom = alignerAtom(residue);
      coords[index * 3] = atom.x;
      coords[index * 3 + 1] = atom.y;
      coords[index * 3 + 2] = atom.z;
    });
    chains.push({ id: chain.id, kind: chain.kind, residues, coords, sequence: sequenceOf(residues) });
  }
  return chains;
}

function alignerAtom(residue) {
  return residue.kind === 'nucleic' ? residue.nucleic?.C3 ?? residue.nucleic?.C4 ?? null : residue.backbone?.CA ?? null;
}

// Gapped alignment rows (reference, moving) from aligned index pairs [moving, reference].
function alignmentRows(pairs, referenceSequence, mobileSequence) {
  const rowA = [];
  const rowB = [];
  let i = 0;
  let j = 0;
  const reference = (end) => {
    for (; j < end; j += 1) {
      rowA.push(referenceSequence[j]);
      rowB.push('-');
    }
  };
  const mobile = (end) => {
    for (; i < end; i += 1) {
      rowA.push('-');
      rowB.push(mobileSequence[i]);
    }
  };
  for (const [m, r] of pairs) {
    reference(r);
    mobile(m);
    rowA.push(referenceSequence[j]);
    rowB.push(mobileSequence[i]);
    i += 1;
    j += 1;
  }
  reference(referenceSequence.length);
  mobile(mobileSequence.length);
  return { rowA: rowA.join(''), rowB: rowB.join('') };
}

// Polymer residues with a principal atom, grouped by chain; a chain's kind is its majority kind.
export function polymerChainResidues(model) {
  const byChain = new Map();
  for (const residue of model.residues) {
    if ((residue.kind !== 'protein' && residue.kind !== 'nucleic') || !principalAtom(residue)) continue;
    if (!byChain.has(residue.chain)) byChain.set(residue.chain, []);
    byChain.get(residue.chain).push(residue);
  }
  const chains = new Map();
  for (const [id, residues] of byChain) {
    const protein = residues.filter((residue) => residue.kind === 'protein').length;
    const kind = protein >= residues.length - protein ? 'protein' : 'nucleic';
    chains.set(id, { id, kind, residues: residues.filter((residue) => residue.kind === kind) });
  }
  return chains;
}

function sequenceOf(residues) {
  return residues.map((residue) => (residue.code && residue.code.length === 1 ? residue.code : 'X')).join('');
}

function secondaryOf(residues) {
  return residues.map((residue) => (residue.ss === 'helix' ? 'H' : residue.ss === 'sheet' ? 'E' : 'C')).join('');
}

// Aligns two residue lists; falls back to author numbering when the alignment would be too large.
export function alignResidues(refResidues, mobResidues, kind = 'protein', options = {}) {
  const result = alignSequences(sequenceOf(refResidues), sequenceOf(mobResidues), {
    kind,
    ssA: options.useSecondary === false ? null : secondaryOf(refResidues),
    ssB: options.useSecondary === false ? null : secondaryOf(mobResidues),
  });
  if (result.truncated) {
    const byNumber = new Map(mobResidues.map((residue, index) => [`${residue.resSeq}${residue.iCode || ''}`, index]));
    const pairs = [];
    refResidues.forEach((residue, index) => {
      const match = byNumber.get(`${residue.resSeq}${residue.iCode || ''}`);
      if (match !== undefined) pairs.push([index, match]);
    });
    const identical = pairs.filter(([i, j]) => refResidues[i].code === mobResidues[j].code).length;
    return { indexPairs: pairs, identity: pairs.length ? identical / pairs.length : 0, identical, score: identical, rowA: '', rowB: '', byNumber: true };
  }
  return { indexPairs: result.pairs, identity: result.identity, identical: result.identical, score: result.score, rowA: result.rowA, rowB: result.rowB };
}

// Pairs the chains of two models. The best-scoring chain pair seeds a superposition; every other
// reference chain then takes the unused moving chain of (nearly) the same sequence whose centroid
// lands closest after that seed fit, so identical subunits of homo-oligomers pair by position.
export function pairChains(refModel, mobModel, options = {}) {
  const refChains = [...polymerChainResidues(refModel).values()].filter((chain) => chain.residues.length >= 3 && (!options.refChains?.length || options.refChains.includes(chain.id)));
  const mobChains = [...polymerChainResidues(mobModel).values()].filter((chain) => chain.residues.length >= 3 && (!options.mobChains?.length || options.mobChains.includes(chain.id)));
  const alignmentCache = new Map();
  const kmerCache = new Map();
  const candidates = [];
  const exhaustive = refChains.length * mobChains.length <= (options.maxChainAlignments ?? 400);
  for (const ref of refChains) {
    let pool = mobChains.filter((mob) => mob.kind === ref.kind);
    if (!exhaustive) {
      const refKmers = kmers(sequenceOf(ref.residues), kmerCache);
      pool = pool
        .map((mob) => ({ mob, similarity: kmerSimilarity(refKmers, kmers(sequenceOf(mob.residues), kmerCache)) }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 3)
        .map((item) => item.mob);
    }
    for (const mob of pool) {
      const key = `${ref.kind}|${sequenceOf(ref.residues)}|${secondaryOf(ref.residues)}|${sequenceOf(mob.residues)}|${secondaryOf(mob.residues)}`;
      let alignment = alignmentCache.get(key);
      if (!alignment) {
        alignment = alignResidues(ref.residues, mob.residues, ref.kind, options);
        alignmentCache.set(key, alignment);
      }
      const shorter = Math.min(ref.residues.length, mob.residues.length);
      const coverage = alignment.indexPairs.length / shorter;
      if (alignment.indexPairs.length < 3) continue;
      if (alignment.identity < (options.minIdentity ?? 0.2) && coverage < 0.5) continue;
      candidates.push({
        ref,
        mob,
        alignment,
        identity: alignment.identity,
        coverage,
        score: alignment.score,
        pairs: alignment.indexPairs.map(([i, j]) => ({ ref: ref.residues[i], mob: mob.residues[j] })),
      });
    }
  }
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);
  // Identical subunits score (almost) the same against every copy, so each near-top pair is tried
  // as a seed and the complete pairing that keeps the most residues within the cutoff wins; ties
  // prefer matching chain IDs (4HHB A↔A rather than A↔C).
  const top = candidates[0];
  const seeds = candidates
    .filter((candidate) => candidate.identity >= top.identity - 0.02 && candidate.score >= top.score * 0.9)
    .sort((a, b) => Number(b.ref.id === b.mob.id) - Number(a.ref.id === a.mob.id) || b.score - a.score)
    .slice(0, options.maxSeeds ?? 6);
  if (options.single || refChains.length === 1 || mobChains.length === 1) return [seeds[0]];

  const order = new Map(refChains.map((chain, index) => [chain.id, index]));
  const cutoff = options.cutoff ?? 2;
  let best = null;
  for (const seed of seeds) {
    const chosen = extendPairing(seed, refChains, candidates, cutoff);
    const fit = iterativeFit(
      pointsOf(chosen.flatMap((chainPair) => chainPair.pairs.map((pair) => principalAtom(pair.mob)))),
      pointsOf(chosen.flatMap((chainPair) => chainPair.pairs.map((pair) => principalAtom(pair.ref)))),
      { cutoff },
    );
    const quality = { kept: fit.keptCount, total: fit.kept.length, rmsd: fit.rmsd, sameIds: chosen.filter((chainPair) => chainPair.ref.id === chainPair.mob.id).length };
    if (!best || betterPairing(quality, best.quality)) best = { chosen, quality };
  }
  return best.chosen.sort((a, b) => order.get(a.ref.id) - order.get(b.ref.id));
}

// Pairings whose fits keep about the same number of residues are equivalent (for example two
// copies packed differently in two crystal forms); then matching chain IDs decide.
function betterPairing(a, b) {
  const tolerance = Math.max(3, 0.02 * Math.max(a.total, b.total));
  if (Math.abs(a.kept - b.kept) > tolerance) return a.kept > b.kept;
  if (a.sameIds !== b.sameIds) return a.sameIds > b.sameIds;
  return a.rmsd < b.rmsd;
}

// Completes a pairing from one seed chain pair: every other reference chain takes the unused moving
// chain of (nearly) the same sequence whose centroid lands closest after the seed superposition.
function extendPairing(seed, refChains, candidates, cutoff) {
  const seedFit = fitPairs(seed.pairs, cutoff);
  const usedMob = new Set([seed.mob.id]);
  const chosen = [seed];
  const remaining = refChains.filter((chain) => chain.id !== seed.ref.id).sort((a, b) => b.residues.length - a.residues.length);
  for (const ref of remaining) {
    const available = candidates.filter((candidate) => candidate.ref === ref && !usedMob.has(candidate.mob.id));
    if (!available.length) continue;
    const topIdentity = Math.max(...available.map((candidate) => candidate.identity));
    const compatible = available.filter((candidate) => candidate.identity >= topIdentity - 0.1);
    const refCenter = centroid(ref.residues.map(principalAtom));
    let closest = null;
    for (const candidate of compatible) {
      const center = centroid(candidate.mob.residues.map(principalAtom));
      const moved = transformPoint(seedFit, center[0], center[1], center[2]);
      const distance = Math.hypot(moved[0] - refCenter[0], moved[1] - refCenter[1], moved[2] - refCenter[2]) - (candidate.mob.id === ref.id ? 0.5 : 0);
      if (!closest || distance < closest.distance) closest = { candidate, distance };
    }
    chosen.push(closest.candidate);
    usedMob.add(closest.candidate.mob.id);
  }
  return chosen;
}

// Residue pairs through UniProt numbering: `ref` residues map to UniProt positions via their
// SIFTS/DBREF segments, and the moving model (an AlphaFold DB model) is numbered in UniProt
// positions directly.
export function uniprotPairs(ref, mob, options = {}) {
  const accession = baseAccession(options.accession ?? '');
  const mobChains = polymerChainResidues(mob.model);
  const mobChain = mobChains.get(options.mobChains?.[0]) ?? [...mobChains.values()][0];
  if (!mobChain) return [];
  const byPosition = new Map(mobChain.residues.filter((residue) => !residue.iCode).map((residue) => [residue.resSeq, residue]));
  const refChains = polymerChainResidues(ref.model);
  const pairs = [];
  for (const chainId of options.refChains ?? [...refChains.keys()]) {
    const chain = refChains.get(chainId);
    const info = ref.structure.sequences?.get(chainId);
    if (!chain || !info) continue;
    for (const residue of chain.residues) {
      const mapped = uniprotPositionForResidue(info, residue);
      if (!mapped || (accession && baseAccession(mapped.accession) !== accession)) continue;
      const partner = byPosition.get(mapped.position);
      if (partner) pairs.push({ ref: residue, mob: partner });
    }
  }
  return pairs;
}

// Residue pairs by identical residue keys (models of one ensemble or copies of one structure).
export function keyPairs(refModel, mobModel) {
  const pairs = [];
  for (const residue of refModel.residues) {
    if (!principalAtom(residue)) continue;
    const partner = mobModel.residueMap.get(residue.key);
    if (partner && principalAtom(partner)) pairs.push({ ref: residue, mob: partner });
  }
  return pairs;
}

// Superposes `mob` onto `ref` ({ model, structure } each). Options:
//   correspondence: 'sequence' (default), 'uniprot' or 'keys'
//   refChains / mobChains: restrict to these chain IDs
//   fitKeys: Set of reference residue keys to fit on (e.g. a binding site or one domain)
//   cutoff: pruning distance in Å (default 2; 0 disables pruning)
//   structural: a tmAlign/mmAlign result for correspondence 'structure' (computed in a worker on
//     alignerChains of both models); its residue pairs and superposition are used as they are
export function compareStructures(ref, mob, options = {}) {
  let chainPairs = [];
  let pairs;
  const correspondence = options.correspondence ?? 'sequence';
  const structural = correspondence === 'structure' ? options.structural : null;
  if (correspondence === 'structure' && !structural) throw new Error('A structure alignment needs its TM-align result.');
  if (correspondence === 'uniprot') {
    pairs = uniprotPairs(ref, mob, options);
  } else if (correspondence === 'keys') {
    pairs = keyPairs(ref.model, mob.model);
  } else if (structural) {
    const refChains = new Map(alignerChains(ref.model, options.refChains).map((chain) => [chain.id, chain]));
    const mobChains = new Map(alignerChains(mob.model, options.mobChains).map((chain) => [chain.id, chain]));
    chainPairs = structural.chainPairs.map((pair) => {
      const refChain = refChains.get(pair.reference);
      const mobChain = mobChains.get(pair.mobile);
      if (!refChain || !mobChain) throw new Error('The structure alignment does not match the chains of these models.');
      const residuePairs = pair.pairs.map(([m, r]) => ({ ref: refChain.residues[r], mob: mobChain.residues[m] }));
      const identical = residuePairs.filter((item) => item.ref.code === item.mob.code).length;
      return {
        ref: refChain,
        mob: mobChain,
        pairs: residuePairs,
        identity: residuePairs.length ? identical / residuePairs.length : 0,
        alignment: alignmentRows(pair.pairs, refChain.sequence, mobChain.sequence),
        tmScore: pair.tmScore,
      };
    });
    pairs = chainPairs.flatMap((chainPair) => chainPair.pairs);
  } else {
    chainPairs = pairChains(ref.model, mob.model, options);
    pairs = chainPairs.flatMap((chainPair) => chainPair.pairs);
  }
  pairs = pairs.filter((pair) => principalAtom(pair.ref) && principalAtom(pair.mob));
  if (pairs.length < 3) {
    throw new Error('Fewer than three residues could be paired between the structures. Check that they share a chain of similar sequence.');
  }
  const fitIndices = [];
  pairs.forEach((pair, index) => {
    if (!options.fitKeys || options.fitKeys.has(pair.ref.key)) fitIndices.push(index);
  });
  if (fitIndices.length < 3) throw new Error('At least three of the selected residues must be paired with the moving structure.');

  const refAll = pointsOf(pairs.map((pair) => principalAtom(pair.ref)));
  const mobAll = pointsOf(pairs.map((pair) => principalAtom(pair.mob)));
  const cutoff = options.cutoff ?? 2;

  // Candidate fits: all paired residues, and each chain pair on its own. Copies of a protein that
  // are packed differently in two crystals (4AKE and 1AKE) cannot all be fitted at once, so the
  // candidate that brings the most residues within the cutoff wins.
  const candidates = [{ indices: fitIndices, label: '' }];
  if (!options.fitKeys && chainPairs.length > 1) {
    const largest = chainPairs.slice().sort((a, b) => b.pairs.length - a.pairs.length).slice(0, 6);
    for (const chainPair of largest) {
      const indices = fitIndices.filter((index) => pairs[index].ref.chain === chainPair.ref.id && pairs[index].mob.chain === chainPair.mob.id);
      if (indices.length >= 10) candidates.push({ indices, label: chainPair.ref.id === chainPair.mob.id ? chainPair.ref.id : `${chainPair.ref.id}↔${chainPair.mob.id}` });
    }
  }
  const refFit = pick(refAll, fitIndices);
  const mobFit = pick(mobAll, fitIndices);
  let best = null;
  if (structural) {
    // TM-align's superposition, which maximizes the TM-score, replaces the pruned fit; its RMSD is
    // over the pairs it aligns (those closer than d8 after superposition).
    best = { indices: fitIndices, label: '', fit: structuralFit(structural, fitIndices.length) };
  } else {
    for (const candidate of candidates) {
      candidate.fit = iterativeFit(pick(mobAll, candidate.indices), pick(refAll, candidate.indices), { cutoff });
      candidate.close = countWithin(mobFit, refFit, candidate.fit, cutoff);
      if (!best || candidate.close > best.close) best = candidate;
    }
  }
  const fit = best.fit;
  const transform = { rotation: fit.rotation, translation: fit.translation };
  const fitted = new Uint8Array(pairs.length);
  best.indices.forEach((pairIndex, index) => {
    if (fit.kept[index]) fitted[pairIndex] = 1;
  });

  const moved = transformPoints(transform, mobAll);
  let sum = 0;
  const distances = new Float64Array(pairs.length);
  for (let index = 0; index < pairs.length; index += 1) {
    distances[index] = Math.hypot(moved[index * 3] - refAll[index * 3], moved[index * 3 + 1] - refAll[index * 3 + 1], moved[index * 3 + 2] - refAll[index * 3 + 2]);
    sum += distances[index] ** 2;
  }
  const refChainIds = new Set(pairs.map((pair) => pair.ref.chain));
  const refChainMap = polymerChainResidues(ref.model);
  const refLength = [...refChainIds].reduce((total, id) => total + (refChainMap.get(id)?.residues.length ?? 0), 0);
  const tm = structural ? { tmScore: structural.tmScore.reference } : options.skipTM ? null : tmScore(mobAll, refAll, { lengthNorm: Math.max(refLength, 1) });
  const local = lddt(refAll, mobAll);
  const identical = pairs.filter((pair) => pair.ref.code === pair.mob.code).length;
  const close = distances.reduce((count, value) => count + (value <= cutoff ? 1 : 0), 0);

  // Per chain pair: RMSD under the reported superposition, and a TM-score from that chain's own
  // best superposition, so a well-predicted subunit is visible even when the complex differs.
  const chainStats = chainPairs.length > 1 ? chainPairs.map((chainPair) => {
    const indices = [];
    pairs.forEach((pair, index) => {
      if (pair.ref.chain === chainPair.ref.id && pair.mob.chain === chainPair.mob.id) indices.push(index);
    });
    const squared = indices.reduce((total, index) => total + distances[index] ** 2, 0);
    const chainTM = structural ? { tmScore: chainPair.tmScore?.reference ?? NaN }
      : options.skipTM || indices.length < 3 ? null : tmScore(pick(mobAll, indices), pick(refAll, indices), { lengthNorm: Math.max(1, refChainMap.get(chainPair.ref.id)?.residues.length ?? indices.length) });
    return { ref: chainPair.ref.id, mob: chainPair.mob.id, pairs: indices.length, rmsd: indices.length ? Math.sqrt(squared / indices.length) : NaN, tmScore: chainTM?.tmScore ?? NaN };
  }) : [];

  return {
    transform,
    pairs: pairs.map((pair, index) => ({
      ref: pair.ref,
      mob: pair.mob,
      distance: distances[index],
      lddt: local.perPoint[index],
      fitted: Boolean(fitted[index]),
    })),
    stats: {
      rmsd: fit.rmsd,
      keptCount: fit.keptCount,
      fitCount: best.indices.length,
      fittedOn: best.label,
      closeCount: close,
      rmsdAll: Math.sqrt(sum / pairs.length),
      pairCount: pairs.length,
      tmScore: tm?.tmScore ?? NaN,
      tmScoreMobile: structural ? structural.tmScore.mobile : NaN,
      alignedLength: structural ? structural.alignedLength : NaN,
      lddt: local.global,
      identity: identical / pairs.length,
      refLength,
      cycles: fit.cycles,
      correspondence,
    },
    chainPairs: chainPairs.map((chainPair, index) => ({
      ref: chainPair.ref.id,
      mob: chainPair.mob.id,
      identity: chainPair.identity,
      pairs: chainPair.pairs.length,
      rmsd: chainStats[index]?.rmsd ?? NaN,
      tmScore: chainStats[index]?.tmScore ?? NaN,
      rowA: chainPair.alignment.rowA,
      rowB: chainPair.alignment.rowB,
    })),
  };
}

function structuralFit(structural, count) {
  return {
    rotation: structural.transform.rotation,
    translation: structural.transform.translation,
    rmsd: structural.rmsd,
    keptCount: structural.alignedLength,
    kept: new Uint8Array(count).fill(1),
    cycles: 0,
  };
}

// Superposes every model of an ensemble onto `models[referenceIndex]` on the residues present in
// all models (pruned at `cutoff`, so floppy termini do not steer the fit) and returns the
// per-model transforms plus per-residue RMSF about the mean structure.
export function superposeEnsemble(models, referenceIndex = 0, options = {}) {
  const reference = models[referenceIndex];
  const keys = reference.residues
    .filter((residue) => principalAtom(residue) && models.every((model) => principalAtom(model.residueMap.get(residue.key))))
    .map((residue) => residue.key);
  if (keys.length < 3) throw new Error('The models share fewer than three residues.');
  const pointsFor = (model) => pointsOf(keys.map((key) => principalAtom(model.residueMap.get(key))));
  const refPoints = pointsFor(reference);
  const transforms = [];
  const frames = [];
  let rmsdSum = 0;
  models.forEach((model, index) => {
    const points = pointsFor(model);
    if (index === referenceIndex) {
      transforms.push({ rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] });
      frames.push(points);
      return;
    }
    const fit = iterativeFit(points, refPoints, { cutoff: options.cutoff ?? 2 });
    rmsdSum += fit.rmsd;
    const transform = { rotation: fit.rotation, translation: fit.translation };
    transforms.push(transform);
    frames.push(transformPoints(transform, points));
  });
  const fluctuation = rmsf(frames);
  return {
    transforms,
    keys,
    rmsf: new Map(keys.map((key, index) => [key, fluctuation[index]])),
    meanRmsd: models.length > 1 ? rmsdSum / (models.length - 1) : 0,
  };
}

export function pointsOf(atoms) {
  const points = new Float64Array(atoms.length * 3);
  atoms.forEach((atom, index) => {
    points[index * 3] = atom.x;
    points[index * 3 + 1] = atom.y;
    points[index * 3 + 2] = atom.z;
  });
  return points;
}

function countWithin(mobile, reference, transform, cutoff) {
  let count = 0;
  for (let index = 0; index < mobile.length / 3; index += 1) {
    const p = transformPoint(transform, mobile[index * 3], mobile[index * 3 + 1], mobile[index * 3 + 2]);
    if (Math.hypot(p[0] - reference[index * 3], p[1] - reference[index * 3 + 1], p[2] - reference[index * 3 + 2]) <= cutoff) count += 1;
  }
  return count;
}

function pick(points, indices) {
  const result = new Float64Array(indices.length * 3);
  indices.forEach((source, target) => {
    result[target * 3] = points[source * 3];
    result[target * 3 + 1] = points[source * 3 + 1];
    result[target * 3 + 2] = points[source * 3 + 2];
  });
  return result;
}

function fitPairs(pairs, cutoff) {
  const fit = iterativeFit(pointsOf(pairs.map((pair) => principalAtom(pair.mob))), pointsOf(pairs.map((pair) => principalAtom(pair.ref))), { cutoff });
  return { rotation: fit.rotation, translation: fit.translation };
}

function centroid(atoms) {
  const center = [0, 0, 0];
  for (const atom of atoms) {
    center[0] += atom.x / atoms.length;
    center[1] += atom.y / atoms.length;
    center[2] += atom.z / atoms.length;
  }
  return center;
}

function kmers(sequence, cache) {
  if (cache.has(sequence)) return cache.get(sequence);
  const set = new Set();
  for (let index = 0; index + 3 <= sequence.length; index += 1) set.add(sequence.slice(index, index + 3));
  cache.set(sequence, set);
  return set;
}

function kmerSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function baseAccession(accession) {
  return String(accession || '').split('-')[0].toUpperCase();
}
