import assert from 'node:assert/strict';
import test from 'node:test';
import { INTERACTION_TYPES, findInteractions, findInterfaceInteractions, perceiveRings } from './interactions.js';
import { residueKindFromName } from './residues.js';
import { TIME_SCALE, examplePDB } from './test-data.mjs';

const COVALENT_RADII = {
  H: 0.31, D: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07, SE: 1.2, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39,
  FE: 1.32, ZN: 1.22, MG: 1.41, CA: 1.76, NA: 1.66, K: 2.03, MN: 1.39, CU: 1.32, CO: 1.26, NI: 1.24,
};

test('INTERACTION_TYPES lists every type in display order with its colour', () => {
  assert.deepEqual(INTERACTION_TYPES.map((type) => [type.id, type.color]), [
    ['hydrogen-bond', '#3fa7ff'],
    ['salt-bridge', '#ff5fa2'],
    ['pi-stacking', '#39d98a'],
    ['cation-pi', '#ffb347'],
    ['hydrophobic', '#9aa3ad'],
    ['halogen-bond', '#40e0d0'],
    ['metal-coordination', '#b388ff'],
    ['water-bridge', '#7ec8ff'],
  ]);
  for (const type of INTERACTION_TYPES) assert.ok(type.label);
});

test('hydrogen bonds without hydrogens use a 3.5 Å cutoff and reject impossible donor angles', () => {
  const build = (nitrogenX, caOffsetX) => buildModel([
    residue('LIG', 1, 'L', carbonylFragment()),
    residue('GLY', 10, 'A', [['N', 'N', nitrogenX, 0, 0], ['CA', 'C', nitrogenX + caOffsetX, 1.25, 0]]),
  ]);
  const good = build(1.23 + 2.9, 0.75);
  const [bond] = ofType(findInteractions(good, residueAtoms(good, 'LIG')), 'hydrogen-bond');
  assert.ok(bond, 'N–H···O=C at 2.9 Å is a hydrogen bond');
  assert.equal(good.atoms[bond.atomA].name, 'O1');
  assert.equal(good.atoms[bond.atomB].name, 'N');
  assert.equal(bond.details.donor, bond.atomB);
  assert.equal(bond.details.acceptor, bond.atomA);
  assert.equal(bond.details.hydrogen, -1);
  assert.ok(Math.abs(bond.distance - 2.9) < 1e-9);
  assert.ok(bond.details.donorAngle > 115 && bond.details.donorAngle < 125);
  assert.equal(bond.residueA, 'L:1:LIG');
  assert.equal(bond.residueB, 'A:10:GLY');
  assert.deepEqual(bond.pointA, [1.23, 0, 0]);

  const bentAway = build(1.23 + 2.9, -0.75);
  assert.equal(ofType(findInteractions(bentAway, residueAtoms(bentAway, 'LIG')), 'hydrogen-bond').length, 0, 'CA–N···O of ~60° is rejected');
  const tooFar = build(1.23 + 3.7, 0.75);
  assert.equal(ofType(findInteractions(tooFar, residueAtoms(tooFar, 'LIG')), 'hydrogen-bond').length, 0, '3.7 Å needs an explicit hydrogen');
});

test('explicit hydrogens allow PLIP’s 4.1 Å cutoff but require D–H···A > 100°', () => {
  const build = (hydrogen) => buildModel([
    residue('LIG', 1, 'L', carbonylFragment()),
    residue('GLY', 10, 'A', [['N', 'N', 5.13, 0, 0], ['CA', 'C', 5.88, 1.25, 0], ['H', 'H', ...hydrogen]]),
  ]);
  const aligned = build([4.12, 0, 0]);
  const [bond] = ofType(findInteractions(aligned, residueAtoms(aligned, 'LIG')), 'hydrogen-bond');
  assert.ok(bond, 'D···A = 3.9 Å with a linear N–H···O');
  assert.equal(aligned.atoms[bond.details.hydrogen].name, 'H');
  assert.ok(bond.details.angle > 179);
  const misaligned = build([5.13, -1.01, 0]);
  assert.equal(ofType(findInteractions(misaligned, residueAtoms(misaligned, 'LIG')), 'hydrogen-bond').length, 0);
});

test('salt bridges use charge-centre distance and replace the overlapping hydrogen bond', () => {
  const build = (shift) => buildModel([
    residue('LYS', 20, 'A', [['CE', 'C', 0, 0, 0], ['NZ', 'N', 1.49, 0, 0]]),
    residue('ASP', 30, 'B', carboxylate('CG', 'OD', 4.37 + shift, 0, 'CB')),
  ]);
  const close = build(0);
  const list = findInteractions(close, residueAtoms(close, 'LYS'));
  const [bridge] = ofType(list, 'salt-bridge');
  assert.ok(bridge);
  assert.equal(close.atoms[bridge.atomA].name, 'NZ');
  assert.equal(bridge.atomB, -1, 'a two-oxygen carboxylate is reported at its centroid');
  assert.ok(Math.abs(bridge.distance - 2.88) < 1e-6);
  assert.equal(bridge.details.chargeA, 'positive');
  assert.equal(bridge.details.groupB, 'aspartate');
  assert.deepEqual(bridge.details.atomsB.map((index) => close.atoms[index].name), ['OD1', 'OD2']);
  assert.ok(Math.abs(bridge.details.closestDistance - Math.hypot(2.88, 1.08)) < 1e-6);
  assert.equal(ofType(list, 'hydrogen-bond').length, 0, 'NZ···OD1 is reported as the salt bridge only');

  const far = build(3);
  assert.equal(ofType(findInteractions(far, residueAtoms(far, 'LYS')), 'salt-bridge').length, 0, '5.88 Å exceeds 5.5 Å');
});

test('histidine counts as a cation only when histidinePositive is on', () => {
  const model = buildModel([
    residue('HIS', 5, 'A', histidine([0, 0, 0], 90)),
    residue('ASP', 9, 'B', [['OD1', 'O', -1.29, -4.3, 0], ['OD2', 'O', 0.87, -4.3, 0], ['CG', 'C', -0.21, -4.93, 0], ['CB', 'C', -0.21, -6.43, 0]]),
  ]);
  const group = residueAtoms(model, 'HIS');
  assert.equal(ofType(findInteractions(model, group), 'salt-bridge').length, 1);
  assert.equal(ofType(findInteractions(model, group, { histidinePositive: false }), 'salt-bridge').length, 0);
});

test('π-stacking distinguishes parallel and T-shaped rings and suppresses ring–ring hydrophobic contacts', () => {
  const x = [1, 0, 0];
  const y = [0, 1, 0];
  const z = [0, 0, 1];
  const stack = (center, u, v) => {
    const model = buildModel([residue('BNZ', 1, 'L', hexagon(0, 0, 0, x, y)), residue('BNZ', 2, 'M', hexagon(...center, u, v))]);
    return findInteractions(model, residueAtoms(model, 'BNZ', 'L'));
  };
  const parallel = stack([1, 0, 3.7], x, y);
  const [stacking] = ofType(parallel, 'pi-stacking');
  assert.equal(stacking?.details.subtype, 'parallel');
  assert.ok(Math.abs(stacking.details.offset - 1) < 1e-6);
  assert.ok(stacking.details.angle < 1e-6);
  assert.equal(stacking.atomA, -1);
  assert.equal(stacking.details.atomsA.length, 6);
  assert.equal(ofType(parallel, 'hydrophobic').length, 0);

  const tShaped = stack([0, 0, 5], x, z);
  assert.equal(ofType(tShaped, 'pi-stacking')[0]?.details.subtype, 't-shaped');
  assert.equal(ofType(stack([2.6, 0, 3.5], x, y), 'pi-stacking').length, 0, 'offset 2.6 Å is too large');
  assert.equal(ofType(stack([0, 0, 5], x, [0, Math.SQRT1_2, Math.SQRT1_2]), 'pi-stacking').length, 0, '45° is neither');
});

test('cation–π needs a charge within 6 Å of the centroid and within 2 Å of the ring axis', () => {
  const build = (nx, nz) => buildModel([
    residue('BNZ', 1, 'L', hexagon(0, 0, 0, [1, 0, 0], [0, 1, 0])),
    residue('LYS', 7, 'A', [['NZ', 'N', nx, 0, nz], ['CE', 'C', nx, 0, nz + 1.49]]),
  ]);
  const above = build(0, 3.8);
  const [contact] = ofType(findInteractions(above, residueAtoms(above, 'BNZ')), 'cation-pi');
  assert.ok(contact);
  assert.equal(contact.atomA, -1);
  assert.equal(above.atoms[contact.atomB].name, 'NZ');
  assert.equal(contact.details.cation, 'B');
  assert.ok(Math.abs(contact.distance - 3.8) < 1e-6);
  const offAxis = build(3, 3.5);
  assert.equal(ofType(findInteractions(offAxis, residueAtoms(offAxis, 'BNZ')), 'cation-pi').length, 0);
  const distant = build(0, 6.5);
  assert.equal(ofType(findInteractions(distant, residueAtoms(distant, 'BNZ')), 'cation-pi').length, 0);
});

test('hydrophobic contacts need carbon bonded only to carbon, ≤ 4 Å, and are thinned per residue', () => {
  const model = buildModel([
    residue('LIG', 1, 'L', [['C1', 'C', 0, 0, 0], ['C2', 'C', 1.53, 0, 0]]),
    residue('LIG', 2, 'M', [['C1', 'C', 0.765, 3.7, 0], ['C2', 'C', 0.765, 5.23, 0]]),
    residue('LIG', 3, 'N', [['C1', 'C', 0, -3.6, 0], ['O1', 'O', 0, -4.83, 0]]),
    residue('LIG', 4, 'P', [['C1', 'C', -4.3, 0, 0], ['C2', 'C', -5.83, 0, 0]]),
  ]);
  const contacts = ofType(findInteractions(model, residueAtoms(model, 'LIG', 'L')), 'hydrophobic');
  assert.deepEqual(contacts.map((contact) => contact.residueB), ['M:2:LIG'], 'carbonyl carbon and the 4.3 Å carbon are excluded');
  const [contact] = contacts;
  assert.equal(model.atoms[contact.atomB].name, 'C1', 'both ethane carbons touch M:C1 but only the closest pair is kept');
  assert.ok(Math.abs(contact.distance - Math.hypot(0.765, 3.7)) < 1e-6);
});

test('pairs within three covalent bonds are excluded (and a new bonds array invalidates the cache)', () => {
  const model = buildModel([
    residue('LIG', 1, 'L', [['CA', 'C', 0, 0, 0], ['CB', 'C', 1.53, 0, 0]]),
    residue('LIG', 2, 'M', [['CC', 'C', 2.04, 1.44, 0], ['CD', 'C', 1.2, 2.2, 1.0]]),
  ]);
  const group = residueAtoms(model, 'LIG', 'L');
  assert.ok(ofType(findInteractions(model, group), 'hydrophobic').length > 0, 'unlinked residues touch');
  model.bonds = [...model.bonds, { a: atomIndex(model, 1, 'CB'), b: atomIndex(model, 2, 'CC') }];
  assert.equal(ofType(findInteractions(model, group), 'hydrophobic').length, 0, 'CA–CB–CC–CD is only three bonds');
});

test('halogen bonds need C–X···A ≈ 165° and X···A–Y ≈ 120°; fluorine never donates', () => {
  const acceptor = (ox, oy, cx, cy) => residue('ACE', 2, 'B', [['O', 'O', ox, oy, 0], ['C', 'C', cx, cy, 0], ['CH3', 'C', cx + 1.5, cy, 0]]);
  const donor = (element, length) => residue('LIG', 1, 'L', [['C1', 'C', 0, 0, 0], [`${element}1`, element, length, 0, 0], ['C2', 'C', -0.75, 1.3, 0]]);
  const linear = buildModel([donor('CL', 1.75), acceptor(4.85, 0, 5.465, 1.065)]);
  const [bond] = ofType(findInteractions(linear, residueAtoms(linear, 'LIG')), 'halogen-bond');
  assert.ok(bond);
  assert.equal(linear.atoms[bond.atomA].name, 'CL1');
  assert.ok(bond.details.donorAngle > 179);
  assert.ok(Math.abs(bond.details.acceptorAngle - 120) < 0.5);

  const sideOn = buildModel([donor('CL', 1.75), acceptor(3.3, 2.68, 3.915, 3.745)]);
  assert.equal(ofType(findInteractions(sideOn, residueAtoms(sideOn, 'LIG')), 'halogen-bond').length, 0, 'C–Cl···O of 120°');
  const fluorine = buildModel([donor('F', 1.35), acceptor(4.45, 0, 5.065, 1.065)]);
  assert.equal(ofType(findInteractions(fluorine, residueAtoms(fluorine, 'LIG')), 'halogen-bond').length, 0);
});

test('metal coordination reports N/O/S within 3 Å and strips H-bond roles from the ligating nitrogen', () => {
  const model = buildModel([
    residue('ZN', 100, 'A', [['ZN', 'ZN', 0, 0, 0]]),
    residue('HIS', 50, 'A', histidine([3.207, 0, 0], 324)),
    residue('LIG', 1, 'L', [['C1', 'C', 0, 2.5, 0], ['C2', 'C', 0, 4.03, 0]]),
    residue('LIG', 2, 'M', [['O1', 'O', -3.3, 0, 0], ['C1', 'C', -4.53, 0, 0]]),
    residue('LIG', 3, 'N', [['O1', 'O', 1.18, 0, 2.77], ['C1', 'C', 1.18, 0, 4.0], ['C2', 'C', 1.93, 1.3, 4.0]]),
  ]);
  const zinc = residueAtoms(model, 'ZN');
  const list = findInteractions(model, zinc);
  assert.deepEqual(list.map((item) => [item.type, model.atoms[item.atomB].name]), [['metal-coordination', 'NE2']]);
  assert.equal(list[0].atomA, zinc[0]);
  assert.ok(Math.abs(list[0].distance - 2.05) < 1e-3);
  assert.equal(list[0].details.coordination, 1);

  const fromHistidine = findInteractions(model, residueAtoms(model, 'HIS'));
  assert.equal(ofType(fromHistidine, 'metal-coordination')[0].atomB, zinc[0], 'the group-A atom is always endpoint A');
  assert.equal(ofType(fromHistidine, 'hydrogen-bond').length, 0, 'a zinc-bound NE2 is neither donor nor acceptor');
});

test('water bridges are opt-in and need both legs within 2.5–4.1 Å', () => {
  const build = (nitrogenX) => buildModel([
    residue('LIG', 1, 'L', [['C1', 'C', 0, 0, 0], ['O1', 'O', 1.43, 0, 0]]),
    residue('HOH', 200, 'W', [['O', 'O', 4.23, 0, 0]]),
    residue('GLY', 10, 'B', [['N', 'N', nitrogenX, 0, 0], ['CA', 'C', nitrogenX + 0.75, 1.25, 0]]),
  ]);
  const model = build(7.13);
  const group = residueAtoms(model, 'LIG');
  assert.equal(findInteractions(model, group).length, 0);
  const [bridge] = findInteractions(model, group, { includeWater: true });
  assert.equal(bridge?.type, 'water-bridge');
  assert.equal(model.atoms[bridge.atomA].name, 'O1');
  assert.equal(model.atoms[bridge.atomB].name, 'N');
  assert.equal(model.atoms[bridge.details.water].resName, 'HOH');
  assert.deepEqual(bridge.details.waterPoint, [4.23, 0, 0]);
  assert.ok(Math.abs(bridge.details.distanceA - 2.8) < 1e-6 && Math.abs(bridge.details.distanceB - 2.9) < 1e-6);
  const stretched = build(8.73);
  assert.equal(findInteractions(stretched, residueAtoms(stretched, 'LIG'), { includeWater: true }).length, 0);
});

test('ring perception uses residue tables and a planarity test for ligand cycles', () => {
  const x = [1, 0, 0];
  const y = [0, 1, 0];
  const chair = [];
  for (let k = 0; k < 6; k += 1) {
    const angle = (k * Math.PI) / 3;
    chair.push([`C${k + 1}`, 'C', 1.446 * Math.cos(angle), 1.446 * Math.sin(angle), k % 2 ? -0.25 : 0.25]);
  }
  const model = buildModel([
    residue('BNZ', 1, 'L', hexagon(0, 0, 0, x, y)),
    residue('CHX', 2, 'M', chair.map(([name, element, cx, cy, cz]) => [name, element, cx + 20, cy, cz])),
  ]);
  const [benzene] = perceiveRings(model, residueAtoms(model, 'BNZ'));
  assert.equal(benzene.aromatic, true);
  assert.equal(benzene.atoms.length, 6);
  assert.ok(benzene.centroid.every((value) => Math.abs(value) < 1e-9));
  assert.ok(Math.abs(Math.abs(benzene.normal[2]) - 1) < 1e-9);
  const [cyclohexane] = perceiveRings(model, residueAtoms(model, 'CHX'));
  assert.equal(cyclohexane.aromatic, false, 'a chair deviates 0.25 Å from its mean plane');

  const kinase = loadPDB('1m17');
  const ringsOf = (resName, resSeq) => perceiveRings(
    kinase,
    kinase.atoms.filter((atom) => atom.resName === resName && atom.resSeq === resSeq).map((atom) => atom.id),
  );
  const trp = kinase.atoms.find((atom) => atom.resName === 'TRP');
  const phe = kinase.atoms.find((atom) => atom.resName === 'PHE');
  const his = kinase.atoms.find((atom) => atom.resName === 'HIS');
  assert.deepEqual(ringsOf('TRP', trp.resSeq).map((ring) => ring.atoms.length), [5, 6]);
  assert.deepEqual(ringsOf('PHE', phe.resSeq).map((ring) => ring.atoms.length), [6]);
  assert.deepEqual(ringsOf('HIS', his.resSeq).map((ring) => ring.atoms.length), [5]);
  assert.deepEqual(perceiveRings(kinase, residueAtoms(kinase, 'AQ4')).map((ring) => ring.aromatic), [true, true, true]);

  const dna = loadPDB('1tup');
  const guanine = dna.atoms.find((atom) => atom.resName === 'DG');
  const cytosine = dna.atoms.find((atom) => atom.resName === 'DC');
  const baseRings = (probe) => perceiveRings(dna, dna.atoms.filter((atom) => atom.residueKey === probe.residueKey).map((atom) => atom.id));
  assert.deepEqual(baseRings(guanine).map((ring) => ring.atoms.length), [6, 5]);
  assert.deepEqual(baseRings(cytosine).map((ring) => ring.atoms.length), [6]);
});

test('types filter and group-A orientation hold for a real ligand', () => {
  const model = loadPDB('2hyy');
  const ligand = residueAtoms(model, 'STI', 'A');
  const inLigand = new Set(ligand);
  for (const interaction of findInteractions(model, ligand, { includeWater: true })) {
    if (interaction.atomA >= 0) assert.ok(inLigand.has(interaction.atomA), `${interaction.type} endpoint A`);
    else assert.ok(interaction.details.atomsA.every((index) => inLigand.has(index)));
    if (interaction.atomB >= 0) assert.ok(!inLigand.has(interaction.atomB));
    assert.equal(interaction.residueA, 'A:600:STI');
  }
  const onlyHydrogenBonds = findInteractions(model, ligand, { types: ['hydrogen-bond'] });
  assert.ok(onlyHydrogenBonds.length > 0);
  assert.ok(onlyHydrogenBonds.every((interaction) => interaction.type === 'hydrogen-bond'));
});

test('1M17: erlotinib (AQ4) accepts the hinge H-bond from Met769 N', () => {
  const model = loadPDB('1m17');
  const list = findInteractions(model, residueAtoms(model, 'AQ4'));
  printInteractions('1M17 erlotinib (AQ4 A999)', model, list);
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'MET', 769, 'N'));
  const withWater = findInteractions(model, residueAtoms(model, 'AQ4'), { includeWater: true });
  printInteractions('1M17 erlotinib with water bridges', model, ofType(withWater, 'water-bridge'));
  const [bridge] = ofType(withWater, 'water-bridge').filter((item) => item.residueB === 'A:766:THR');
  assert.ok(bridge, 'N3–water–Thr766 is the classic bridged contact');
  const water = model.atoms.filter((atom) => atom.residueKey === model.atoms[bridge.details.water].residueKey).map((atom) => atom.id);
  const fromWater = findInteractions(model, water);
  assert.deepEqual(
    fromWater.map((item) => [item.type, item.residueB]).sort(),
    [['hydrogen-bond', 'A:766:THR'], ['hydrogen-bond', 'A:999:AQ4']],
    'a selected water is an ordinary donor/acceptor',
  );
  assert.equal(fromWater[0].details.donorAngle, undefined, 'a water donor has no heavy neighbour to measure');
});

test('6OIM: Mg²⁺ is octahedral once waters are included', () => {
  const model = loadPDB('6oim');
  const magnesium = residueAtoms(model, 'MG');
  const dry = findInteractions(model, magnesium);
  const wet = findInteractions(model, magnesium, { includeWater: true });
  printInteractions('6OIM Mg2+ with waters', model, wet);
  assert.deepEqual(dry.map((item) => item.residueB).sort(), ['A:17:SER', 'A:302:GDP']);
  assert.equal(ofType(wet, 'metal-coordination').length, 6);
  assert.ok(wet.every((item) => item.details.coordination === 6));
});

test('2HYY: imatinib (STI) H-bonds Met318 N at the hinge', () => {
  const model = loadPDB('2hyy');
  const list = findInteractions(model, residueAtoms(model, 'STI', 'A'));
  printInteractions('2HYY imatinib (STI A600)', model, list);
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'MET', 318, 'N'));
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'THR', 315, 'OG1'));
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'GLU', 286, 'OE2'));
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'ASP', 381, 'N'));
});

test('3OG7: vemurafenib (032) binds the Cys532 hinge backbone', () => {
  const model = loadPDB('3og7');
  const list = findInteractions(model, residueAtoms(model, '032', 'A'));
  printInteractions('3OG7 vemurafenib (032 A1)', model, list);
  const hinge = ofType(list, 'hydrogen-bond').filter((bond) => bond.residueB === 'A:532:CYS');
  assert.ok(hinge.some((bond) => ['N', 'O'].includes(model.atoms[bond.atomB].name)));
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'CYS', 532, 'N'), 'azaindole N7 accepts from Cys532 N–H');
  assert.ok(hasContact(model, list, 'hydrogen-bond', 'GLN', 530, 'O'), 'azaindole N1–H donates to Gln530 O');
});

test('4HHB: heme iron coordinates the proximal histidine in α (His87) and β (His92)', () => {
  const model = loadPDB('4hhb');
  for (const [chain, resSeq] of [['A', 87], ['B', 92]]) {
    const list = findInteractions(model, residueAtoms(model, 'HEM', chain));
    printInteractions(`4HHB heme chain ${chain}`, model, list);
    const [coordination] = ofType(list, 'metal-coordination').filter((item) => item.residueB === `${chain}:${resSeq}:HIS`);
    assert.ok(coordination, `Fe–His${resSeq} NE2`);
    assert.equal(model.atoms[coordination.atomA].element, 'FE');
    assert.equal(model.atoms[coordination.atomB].name, 'NE2');
    assert.ok(coordination.distance < 2.4);
    assert.equal(coordination.details.coordination, 5, 'deoxy heme: four pyrrole N plus His');
  }

  const withMetalBonds = loadPDB('4hhb');
  const iron = withMetalBonds.atoms.find((atom) => atom.element === 'FE' && atom.chain === 'A');
  const histidine = withMetalBonds.atoms.find((atom) => atom.residueKey === 'A:87:HIS' && atom.name === 'NE2');
  withMetalBonds.bonds.push({ a: iron.id, b: histidine.id });
  const withBonds = findInteractions(withMetalBonds, residueAtoms(withMetalBonds, 'HEM', 'A'));
  const withoutBonds = findInteractions(model, residueAtoms(model, 'HEM', 'A'));
  assert.deepEqual(summarize(withBonds), summarize(withoutBonds), 'metal bonds in model.bonds change nothing');
});

test('4ZQK: PD-1/PD-L1 interface (chain A vs chain B)', () => {
  const model = loadPDB('4zqk');
  const list = findInterfaceInteractions(model, 'A', 'B');
  const counts = countByType(list);
  console.log('\n4ZQK chain A vs chain B counts:', counts);
  printInteractions('4ZQK polar interface contacts', model, list.filter((item) => item.type !== 'hydrophobic'));
  assert.ok(counts['hydrogen-bond'] >= 8);
  assert.ok(counts['salt-bridge'] >= 2);
  assert.ok(ofType(list, 'salt-bridge').some((item) => item.residueA === 'A:113:ARG' && item.residueB === 'B:136:GLU'));
  assert.ok(list.every((item) => model.atoms[item.atomA >= 0 ? item.atomA : item.details.atomsA[0]].chain === 'A'));
  const reverse = countByType(findInterfaceInteractions(model, 'B', 'A'));
  assert.equal(reverse['salt-bridge'], counts['salt-bridge']);
  assert.equal(reverse['hydrogen-bond'], counts['hydrogen-bond']);
});

test('performance: ligand in a ~100k-atom model < 50 ms, ~6k-vs-6k interface < 300 ms', () => {
  const base = loadPDB('2hyy');
  const copies = Math.ceil(100000 / base.atoms.length);
  const large = tile(base, copies);
  const ligand = large.atoms.filter((atom) => atom.residueKey === '0A:600:STI').map((atom) => atom.id);
  let started = performance.now();
  const first = findInteractions(large, ligand);
  const firstCall = performance.now() - started;
  const ligandTime = bestOf(5, () => findInteractions(large, ligand));
  assert.equal(findInteractions(large, ligand).length, first.length);

  const nucleosome = loadPDB('7lyb');
  const histones = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  started = performance.now();
  const interfaceList = findInterfaceInteractions(nucleosome, histones, ['I', 'J']);
  const interfaceFirst = performance.now() - started;
  const interfaceTime = bestOf(3, () => findInterfaceInteractions(nucleosome, histones, ['I', 'J']));
  const sizeA = nucleosome.atoms.filter((atom) => histones.includes(atom.chain) && !atom.isWater).length;
  const sizeB = nucleosome.atoms.filter((atom) => ['I', 'J'].includes(atom.chain) && !atom.isWater).length;
  console.log(`\nperformance: ${large.atoms.length} atoms, STI query first call (with preprocessing) ${firstCall.toFixed(1)} ms,`
    + ` then ${ligandTime.toFixed(2)} ms`);
  console.log(`performance: 7LYB histones (${sizeA} atoms) vs DNA (${sizeB} atoms) first ${interfaceFirst.toFixed(1)} ms,`
    + ` then ${interfaceTime.toFixed(1)} ms`, countByType(interfaceList));
  assert.ok(ligandTime < 50 * TIME_SCALE, `ligand query took ${ligandTime.toFixed(1)} ms`);
  assert.ok(interfaceTime < 300 * TIME_SCALE, `interface took ${interfaceTime.toFixed(1)} ms`);
});

function parsePDB(text) {
  const atoms = [];
  for (const line of text.split('\n')) {
    const record = line.slice(0, 6).trim();
    if (record === 'ENDMDL') break;
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (line[16] !== ' ' && line[16] !== 'A') continue;
    const name = line.slice(12, 16).trim();
    const resName = line.slice(17, 20).trim();
    const chain = line[21].trim() || '_';
    const resSeq = Number.parseInt(line.slice(22, 26), 10);
    const iCode = line[26].trim();
    const element = (line.slice(76, 78).trim() || name.replace(/[^A-Za-z]/g, '')[0]).toUpperCase();
    atoms.push(makeAtom(atoms.length, name, element, resName, chain, resSeq, iCode, record === 'HETATM', [
      Number.parseFloat(line.slice(30, 38)),
      Number.parseFloat(line.slice(38, 46)),
      Number.parseFloat(line.slice(46, 54)),
    ]));
  }
  return { atoms, bonds: inferBonds(atoms) };
}

function makeAtom(id, name, element, resName, chain, resSeq, iCode, isHet, [x, y, z]) {
  const kind = residueKindFromName(resName);
  return {
    id,
    name,
    element,
    resName,
    chain,
    resSeq,
    iCode,
    residueKey: `${chain}:${resSeq}${iCode}:${resName}`,
    kind,
    isHet,
    isWater: kind === 'water',
    isHydrogen: element === 'H' || element === 'D',
    x,
    y,
    z,
  };
}

function inferBonds(atoms) {
  const residues = new Map();
  for (const atom of atoms) {
    if (!residues.has(atom.residueKey)) residues.set(atom.residueKey, []);
    residues.get(atom.residueKey).push(atom);
  }
  const ordered = [...residues.values()];
  const bonds = [];
  for (const members of ordered) {
    if (members[0].isWater) continue;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i];
        const b = members[j];
        if (a.isHydrogen && b.isHydrogen) continue;
        const limit = ((COVALENT_RADII[a.element] ?? 0.8) + (COVALENT_RADII[b.element] ?? 0.8)) * 1.25 + 0.1;
        const d = distance(a, b);
        if (d > 0.4 && d <= limit) bonds.push({ a: a.id, b: b.id });
      }
    }
  }
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (current[0].chain !== next[0].chain) continue;
    for (const [fromName, toName] of [['C', 'N'], ["O3'", 'P']]) {
      const from = current.find((atom) => atom.name === fromName);
      const to = next.find((atom) => atom.name === toName);
      if (from && to && distance(from, to) <= 2.0) bonds.push({ a: from.id, b: to.id });
    }
  }
  return bonds;
}

function loadPDB(name) {
  return parsePDB(examplePDB(name));
}

function residue(resName, resSeq, chain, atoms) {
  return { resName, resSeq, chain, atoms };
}

function buildModel(residues) {
  const atoms = [];
  for (const entry of residues) {
    const isHet = !['protein', 'nucleic'].includes(residueKindFromName(entry.resName));
    for (const [name, element, x, y, z] of entry.atoms) {
      atoms.push(makeAtom(atoms.length, name, element, entry.resName, entry.chain, entry.resSeq, '', isHet, [x, y, z]));
    }
  }
  return { atoms, bonds: inferBonds(atoms) };
}

function carbonylFragment() {
  return [['C1', 'C', 0, 0, 0], ['O1', 'O', 1.23, 0, 0], ['C2', 'C', -0.75, 1.3, 0], ['C3', 'C', -0.75, -1.3, 0]];
}

function carboxylate(carbonName, oxygenPrefix, oxygenX, y, previousName) {
  const carbonX = oxygenX + 0.63;
  return [
    [`${oxygenPrefix}1`, 'O', oxygenX, y + 1.08, 0],
    [`${oxygenPrefix}2`, 'O', oxygenX, y - 1.08, 0],
    [carbonName, 'C', carbonX, y, 0],
    [previousName, 'C', carbonX + 1.52, y, 0],
  ];
}

function hexagon(cx, cy, cz, u, v, radius = 1.39) {
  const atoms = [];
  for (let k = 0; k < 6; k += 1) {
    const angle = (k * Math.PI) / 3;
    const c = radius * Math.cos(angle);
    const s = radius * Math.sin(angle);
    atoms.push([`C${k + 1}`, 'C', cx + c * u[0] + s * v[0], cy + c * u[1] + s * v[1], cz + c * u[2] + s * v[2]]);
  }
  return atoms;
}

function histidine(center, cgDegrees) {
  const ring = ['CG', 'ND1', 'CE1', 'NE2', 'CD2'].map((name, k) => [name, name[0], ...polar(center, cgDegrees + 72 * k, 1.157)]);
  return [...ring, ['CB', 'C', ...polar(center, cgDegrees, 2.657)]];
}

function polar(center, degrees, radius) {
  const angle = (degrees * Math.PI) / 180;
  return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle), center[2]];
}

function tile(model, copies) {
  const atoms = [];
  const bonds = [];
  for (let copy = 0; copy < copies; copy += 1) {
    const offset = atoms.length;
    for (const atom of model.atoms) {
      const chain = `${copy}${atom.chain}`;
      atoms.push({ ...atom, id: offset + atom.id, chain, residueKey: `${chain}:${atom.resSeq}${atom.iCode}:${atom.resName}`, x: atom.x + copy * 200 });
    }
    for (const bond of model.bonds) bonds.push({ a: bond.a + offset, b: bond.b + offset });
  }
  return { atoms, bonds };
}

function residueAtoms(model, resName, chain) {
  return model.atoms.filter((atom) => atom.resName === resName && (!chain || atom.chain === chain)).map((atom) => atom.id);
}

function atomIndex(model, resSeq, name) {
  return model.atoms.findIndex((atom) => atom.resSeq === resSeq && atom.name === name);
}

function ofType(list, type) {
  return list.filter((interaction) => interaction.type === type);
}

function hasContact(model, list, type, resName, resSeq, atomName) {
  return ofType(list, type).some((interaction) => {
    const atom = model.atoms[interaction.atomB];
    return atom && atom.resName === resName && atom.resSeq === resSeq && atom.name === atomName;
  });
}

function countByType(list) {
  const counts = {};
  for (const interaction of list) counts[interaction.type] = (counts[interaction.type] ?? 0) + 1;
  return counts;
}

function summarize(list) {
  return list.map((item) => `${item.type} ${item.atomA} ${item.atomB} ${item.distance.toFixed(3)}`);
}

function bestOf(runs, fn) {
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    fn();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function printInteractions(title, model, list) {
  const label = (index, residueKey, atoms) => {
    if (index >= 0) {
      const atom = model.atoms[index];
      return `${atom.resName}${atom.resSeq}${atom.chain}:${atom.name}`;
    }
    return `${residueKey}[${atoms.map((atomIndexValue) => model.atoms[atomIndexValue].name).join(' ')}]`;
  };
  console.log(`\n${title}: ${list.length} interactions`);
  for (const item of list) {
    const details = item.details;
    const notes = [];
    if (details.donor !== undefined) notes.push(`donor ${model.atoms[details.donor].name}`);
    if (details.angle !== undefined) notes.push(`angle ${details.angle.toFixed(0)}°`);
    if (details.donorAngle !== undefined && item.type === 'halogen-bond') notes.push(`C–X···A ${details.donorAngle.toFixed(0)}°`);
    if (details.subtype) notes.push(details.subtype);
    if (details.offset !== undefined) notes.push(`offset ${details.offset.toFixed(2)} Å`);
    if (details.closestDistance !== undefined) notes.push(`closest ${details.closestDistance.toFixed(2)} Å`);
    if (details.water !== undefined) notes.push(`via ${label(details.water)} ${details.distanceA.toFixed(2)}/${details.distanceB.toFixed(2)} Å`);
    if (details.coordination !== undefined) notes.push(`CN ${details.coordination}`);
    const endA = label(item.atomA, item.residueA, details.atomsA ?? []).padEnd(30);
    const endB = label(item.atomB, item.residueB, details.atomsB ?? []).padEnd(34);
    console.log(`  ${item.type.padEnd(18)} ${endA} ${endB} ${item.distance.toFixed(2)} Å  ${notes.join(', ')}`);
  }
}
