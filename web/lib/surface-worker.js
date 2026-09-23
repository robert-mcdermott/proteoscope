import { coulombicPotential } from './electrostatics.js';
import { buildSurface, computeGroupedSASA, computeSASA } from './surface.js';

self.onmessage = (event) => {
  const { id, type, payload = {} } = event.data ?? {};
  try {
    if (type === 'surface') {
      const surface = buildSurface(payload.positions, payload.radii, payload.options ?? {});
      const transfer = [surface.positions.buffer, surface.normals.buffer, surface.indices.buffer, surface.atoms.buffer];
      const chargePositions = payload.chargePositions
        ?? (payload.charges?.length * 3 === payload.positions.length ? payload.positions : null);
      if (payload.charges && chargePositions) {
        const started = performance.now();
        surface.potential = coulombicPotential(
          surface.positions,
          surface.normals,
          chargePositions,
          payload.charges,
          payload.potentialOptions ?? {},
        );
        surface.timings.potential = performance.now() - started;
        transfer.push(surface.potential.buffer);
      }
      self.postMessage({ id, result: surface }, transfer);
      return;
    }
    if (type === 'sasa') {
      const sasa = computeSASA(payload.positions, payload.radii, payload.options ?? {});
      self.postMessage({ id, result: sasa }, [sasa.buffer]);
      return;
    }
    if (type === 'sasa-groups') {
      const { complex, isolated } = computeGroupedSASA(payload.positions, payload.radii, payload.groups, payload.options ?? {});
      self.postMessage({ id, result: { complex, isolated } }, [complex.buffer, isolated.buffer]);
      return;
    }
    if (type === 'potential') {
      const potential = coulombicPotential(payload.points, payload.normals, payload.chargePositions, payload.charges, payload.options ?? {});
      self.postMessage({ id, result: potential }, [potential.buffer]);
      return;
    }
    throw new Error(`Unknown surface worker request "${type}"`);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
