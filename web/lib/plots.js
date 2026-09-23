import { SECONDARY_COLORS, colorToHex } from './colors.js';

const RAMA_REGIONS = {
  general: [
    { phi: -63, psi: -42, sphi: 14, spsi: 14, weight: 1.0 },
    { phi: -120, psi: 132, sphi: 26, spsi: 22, weight: 0.75 },
    { phi: -68, psi: 146, sphi: 14, spsi: 16, weight: 0.55 },
    { phi: 58, psi: 42, sphi: 10, spsi: 14, weight: 0.12 },
    { phi: -88, psi: 2, sphi: 18, spsi: 20, weight: 0.18 },
  ],
  glycine: [
    { phi: -63, psi: -42, sphi: 18, spsi: 18, weight: 0.6 },
    { phi: 63, psi: 42, sphi: 18, spsi: 18, weight: 0.6 },
    { phi: -80, psi: 170, sphi: 28, spsi: 28, weight: 0.5 },
    { phi: 80, psi: -170, sphi: 28, spsi: 28, weight: 0.5 },
    { phi: 95, psi: 5, sphi: 20, spsi: 25, weight: 0.3 },
  ],
  proline: [
    { phi: -65, psi: -30, sphi: 10, spsi: 14, weight: 0.8 },
    { phi: -68, psi: 145, sphi: 10, spsi: 16, weight: 1.0 },
  ],
};

// Background shading is a smooth Gaussian-mixture approximation of the favored regions,
// intended as orientation, not as a MolProbity validation contour.
export function ramachandranDensity(phi, psi, kind = 'general') {
  let total = 0;
  for (const region of RAMA_REGIONS[kind] ?? RAMA_REGIONS.general) {
    const dphi = wrapAngle(phi - region.phi) / region.sphi;
    const dpsi = wrapAngle(psi - region.psi) / region.spsi;
    total += region.weight * Math.exp(-0.5 * (dphi * dphi + dpsi * dpsi));
  }
  return total;
}

// options.contours(φ, ψ) → 0 outlier, 1 allowed, 2 favored draws MolProbity-style contour regions;
// without it an approximate Gaussian guide is shaded.
export function drawRamachandran(canvas, residues, options = {}) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const pad = Math.round(size * 0.1);
  const plot = size - pad * 1.4;
  const x0 = pad;
  const y0 = pad * 0.4;
  ctx.clearRect(0, 0, size, size);
  const image = ctx.createImageData(Math.round(plot), Math.round(plot));
  const w = image.width;
  for (let py = 0; py < w; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const phi = -180 + (px / w) * 360;
      const psi = 180 - (py / w) * 360;
      const offset = (py * w + px) * 4;
      let level;
      if (options.contours) {
        level = options.contours(phi, psi);
      } else {
        const density = ramachandranDensity(phi, psi, 'general');
        level = density > 0.35 ? 2 : density > 0.05 ? 1 : 0;
      }
      const colors = [[22, 27, 30], [36, 58, 74], [52, 104, 136]];
      image.data[offset] = colors[level][0];
      image.data[offset + 1] = colors[level][1];
      image.data[offset + 2] = colors[level][2];
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, x0, y0);
  ctx.strokeStyle = 'rgba(248,245,238,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + plot / 2, y0);
  ctx.lineTo(x0 + plot / 2, y0 + plot);
  ctx.moveTo(x0, y0 + plot / 2);
  ctx.lineTo(x0 + plot, y0 + plot / 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(248,245,238,0.3)';
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, plot - 1, plot - 1);
  ctx.fillStyle = 'rgba(248,245,238,0.6)';
  ctx.font = `${Math.round(size * 0.035)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (const tick of [-180, -90, 0, 90, 180]) {
    const x = x0 + ((tick + 180) / 360) * plot;
    ctx.fillText(String(tick), x, y0 + plot + size * 0.045);
    const y = y0 + ((180 - tick) / 360) * plot;
    ctx.textAlign = 'right';
    ctx.fillText(String(tick), x0 - size * 0.012, y + size * 0.012);
    ctx.textAlign = 'center';
  }
  ctx.fillText('φ (degrees)', x0 + plot / 2, size - size * 0.012);
  ctx.save();
  ctx.translate(size * 0.03, y0 + plot / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('ψ', 0, 0);
  ctx.restore();

  const points = [];
  for (const residue of residues) {
    if (!Number.isFinite(residue.phi) || !Number.isFinite(residue.psi)) continue;
    const x = x0 + ((residue.phi + 180) / 360) * plot;
    const y = y0 + ((180 - residue.psi) / 360) * plot;
    points.push({ x, y, residue });
  }
  const selected = options.selected ?? new Set();
  const radius = Math.max(2, size * 0.0065);
  // With a validation report, MolProbity classes replace the secondary-structure colors, and
  // outliers are drawn last so they stay on top.
  const classOf = (residue) => String(options.classify?.(residue) ?? '').toUpperCase();
  if (options.classify) points.sort((a, b) => (classOf(a.residue) === 'OUTLIER') - (classOf(b.residue) === 'OUTLIER'));
  for (const point of points) {
    const residue = point.residue;
    const isSelected = selected.has(residue.key);
    const label = options.classify ? classOf(residue) : '';
    const classColor = label === 'OUTLIER' ? '#ff4d5a' : label === 'ALLOWED' ? '#f5d547' : null;
    ctx.fillStyle = isSelected ? '#59ff8c' : classColor ?? colorToHex(SECONDARY_COLORS[residue.ss] ?? SECONDARY_COLORS.coil);
    ctx.beginPath();
    if (residue.parent === 'GLY') {
      ctx.moveTo(point.x, point.y - radius * 1.3);
      ctx.lineTo(point.x + radius * 1.2, point.y + radius);
      ctx.lineTo(point.x - radius * 1.2, point.y + radius);
      ctx.closePath();
    } else if (residue.parent === 'PRO') {
      ctx.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
    } else {
      ctx.arc(point.x, point.y, isSelected ? radius * 1.6 : label === 'OUTLIER' ? radius * 1.35 : radius, 0, Math.PI * 2);
    }
    ctx.fill();
    if (isSelected || label === 'OUTLIER') {
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }
  return { points, radius: radius * 2.2 };
}

export function drawProfile(canvas, series, options = {}) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const left = width * 0.08;
  const right = width * 0.02;
  const top = height * 0.14;
  const bottom = height * 0.16;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  ctx.clearRect(0, 0, width, height);
  if (!series.length) {
    ctx.fillStyle = 'rgba(248,245,238,0.45)';
    ctx.font = `${Math.round(height * 0.08)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(options.emptyText ?? 'No data', width / 2, height / 2);
    return { points: [] };
  }
  const values = series.map((item) => item.value).filter(Number.isFinite);
  let min = options.min ?? Math.min(...values);
  let max = options.max ?? Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const xFor = (index) => left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
  const yFor = (value) => top + (1 - (value - min) / (max - min)) * plotHeight;
  for (const band of options.bands ?? []) {
    ctx.fillStyle = band.color;
    const y1 = yFor(Math.min(max, band.to));
    const y2 = yFor(Math.max(min, band.from));
    ctx.fillRect(left, y1, plotWidth, y2 - y1);
  }
  series.forEach((item, index) => {
    const color = SECONDARY_COLORS[item.residue?.ss];
    if (!color || item.residue?.ss === 'coil') return;
    ctx.fillStyle = colorToHex(color);
    const x = xFor(index);
    ctx.fillRect(x - plotWidth / series.length / 2, top - height * 0.07, Math.max(1, plotWidth / series.length), height * 0.04);
  });
  ctx.strokeStyle = 'rgba(248,245,238,0.25)';
  ctx.strokeRect(left + 0.5, top + 0.5, plotWidth - 1, plotHeight - 1);
  ctx.lineWidth = Math.max(1.2, width / 420);
  ctx.strokeStyle = options.color ?? '#4cc9f0';
  ctx.beginPath();
  let started = false;
  series.forEach((item, index) => {
    if (!Number.isFinite(item.value)) {
      started = false;
      return;
    }
    const x = xFor(index);
    const y = yFor(item.value);
    if (!started) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    started = true;
  });
  ctx.stroke();
  const selected = options.selected ?? new Set();
  ctx.fillStyle = '#59ff8c';
  series.forEach((item, index) => {
    if (item.residue && selected.has(item.residue.key) && Number.isFinite(item.value)) {
      ctx.beginPath();
      ctx.arc(xFor(index), yFor(item.value), Math.max(2.5, width / 180), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.fillStyle = 'rgba(248,245,238,0.6)';
  ctx.font = `${Math.round(height * 0.075)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(formatTick(max), left - 4, top + height * 0.05);
  ctx.fillText(formatTick(min), left - 4, top + plotHeight);
  ctx.textAlign = 'left';
  const first = series[0]?.residue;
  const last = series[series.length - 1]?.residue;
  if (first) ctx.fillText(String(first.resSeq), left, height - height * 0.03);
  ctx.textAlign = 'right';
  if (last) ctx.fillText(String(last.resSeq), left + plotWidth, height - height * 0.03);
  ctx.textAlign = 'center';
  ctx.fillText(options.label ?? '', left + plotWidth / 2, height - height * 0.03);
  return { points: series.map((item, index) => ({ x: xFor(index), residue: item.residue })) };
}

// Distance histogram: bars per bin (a second series overlaid as outlines), and the cutoff as a line.
export function drawHistogram(canvas, histogram, options = {}) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const left = width * 0.08;
  const right = width * 0.03;
  const top = height * 0.1;
  const bottom = height * 0.2;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  ctx.clearRect(0, 0, width, height);
  const { bins, binWidth, max } = histogram;
  const overlay = options.overlay?.bins ?? null;
  const peak = Math.max(1, ...bins, ...(overlay ?? []));
  const barWidth = plotWidth / bins.length;
  const cutoff = options.cutoff;
  bins.forEach((count, index) => {
    if (!count) return;
    const x = left + index * barWidth;
    const barHeight = (count / peak) * plotHeight;
    ctx.fillStyle = Number.isFinite(cutoff) && (index + 1) * binWidth > cutoff ? 'rgba(255,107,107,0.75)' : 'rgba(82,214,138,0.75)';
    ctx.fillRect(x + 1, top + plotHeight - barHeight, Math.max(1, barWidth - 2), barHeight);
  });
  if (overlay) {
    ctx.strokeStyle = options.overlayColor ?? '#4cc9f0';
    ctx.lineWidth = Math.max(1.2, width / 420);
    overlay.forEach((count, index) => {
      if (!count) return;
      const x = left + index * barWidth;
      const barHeight = (count / peak) * plotHeight;
      ctx.strokeRect(x + 1.5, top + plotHeight - barHeight + 0.5, Math.max(1, barWidth - 3), barHeight - 1);
    });
  }
  ctx.strokeStyle = 'rgba(248,245,238,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, plotWidth - 1, plotHeight - 1);
  if (Number.isFinite(cutoff)) {
    const x = left + (Math.min(cutoff, max) / (bins.length * binWidth)) * plotWidth;
    ctx.strokeStyle = '#ffd166';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(248,245,238,0.6)';
  ctx.font = `${Math.round(height * 0.075)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  for (let value = 0; value <= bins.length * binWidth; value += 10) {
    ctx.fillText(value >= max ? `${value}+` : String(value), left + (value / (bins.length * binWidth)) * plotWidth, height - bottom * 0.4);
  }
  ctx.textAlign = 'left';
  ctx.fillText(options.label ?? 'Distance (Å)', left, top * 0.8);
  ctx.textAlign = 'right';
  ctx.fillText(String(peak), left - 4, top + ctx.measureText('0').actualBoundingBoxAscent);
}

// Woods plot: each peptide a horizontal bar over its residues at its value (ΔD, or relative
// uptake); significant protection blue, deprotection red, the rest gray; ± the limit dashed.
export function drawWoods(canvas, rows, options = {}) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const left = width * 0.09;
  const right = width * 0.02;
  const top = height * 0.1;
  const bottom = height * 0.18;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  ctx.clearRect(0, 0, width, height);
  if (!rows.length) return;
  const first = Math.min(...rows.map((row) => row.start));
  const last = Math.max(...rows.map((row) => row.end));
  const key = options.value ?? 'delta';
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  const limit = options.limit ?? 0;
  let min = Math.min(0, -limit, ...values);
  let max = Math.max(0, limit, ...values);
  if (options.range) [min, max] = options.range;
  if (max - min < 1e-6) max = min + 1;
  const pad = (max - min) * 0.08;
  min -= pad;
  max += pad;
  const xFor = (position) => left + ((position - first) / Math.max(1, last - first + 1)) * plotWidth;
  const yFor = (value) => top + (1 - (value - min) / (max - min)) * plotHeight;
  ctx.strokeStyle = 'rgba(248,245,238,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, plotWidth - 1, plotHeight - 1);
  ctx.beginPath();
  ctx.moveTo(left, yFor(0));
  ctx.lineTo(left + plotWidth, yFor(0));
  ctx.stroke();
  if (limit) {
    ctx.strokeStyle = '#ffd166';
    ctx.setLineDash([4, 3]);
    for (const value of [limit, -limit]) {
      ctx.beginPath();
      ctx.moveTo(left, yFor(value));
      ctx.lineTo(left + plotWidth, yFor(value));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.lineWidth = Math.max(2, height / 70);
  ctx.lineCap = 'butt';
  for (const row of rows) {
    const value = row[key];
    if (!Number.isFinite(value)) continue;
    ctx.strokeStyle = !row.significant ? 'rgba(170,178,189,0.75)' : value < 0 ? '#3f7fff' : '#ff5a4d';
    ctx.beginPath();
    ctx.moveTo(xFor(row.start), yFor(value));
    ctx.lineTo(xFor(row.end + 1), yFor(value));
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(248,245,238,0.6)';
  ctx.font = `${Math.round(height * 0.07)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  const step = Math.max(10, Math.ceil((last - first) / 8 / 10) * 10);
  for (let position = Math.ceil(first / step) * step; position <= last; position += step) ctx.fillText(String(position), xFor(position), height - bottom * 0.35);
  ctx.textAlign = 'left';
  ctx.fillText(options.label ?? 'ΔD (D)', left, top * 0.8);
  ctx.textAlign = 'right';
  ctx.fillText(formatTick(max - pad), left - 4, top + 8);
  ctx.fillText(formatTick(min + pad), left - 4, top + plotHeight);
}

export function drawPAE(canvas, pae, options = {}) {
  const ctx = canvas.getContext('2d');
  const n = pae.size;
  const size = canvas.width;
  const pad = Math.round(size * 0.08);
  const plot = size - pad * 1.3;
  ctx.clearRect(0, 0, size, size);
  const image = new ImageData(n, n);
  const max = pae.max || 31.75;
  // Contact probabilities: white (0) to dark purple (1).
  const color = options.mode === 'contacts' ? contactColor : paeColor;
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const value = pae.matrix[row * n + column];
      const [r, g, b] = color(Math.min(1, Math.max(0, value / max)));
      const offset = (row * n + column) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = 255;
    }
  }
  const scratch = document.createElement('canvas');
  scratch.width = n;
  scratch.height = n;
  scratch.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = n > plot;
  ctx.drawImage(scratch, pad, pad * 0.3, plot, plot);
  ctx.strokeStyle = 'rgba(248,245,238,0.3)';
  ctx.strokeRect(pad + 0.5, pad * 0.3 + 0.5, plot - 1, plot - 1);
  for (const boundary of pae.chainBoundaries ?? []) {
    const offset = (boundary / n) * plot;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.moveTo(pad + offset, pad * 0.3);
    ctx.lineTo(pad + offset, pad * 0.3 + plot);
    ctx.moveTo(pad, pad * 0.3 + offset);
    ctx.lineTo(pad + plot, pad * 0.3 + offset);
    ctx.stroke();
  }
  if (options.selection) {
    const { x0, x1, y0, y1 } = options.selection;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.strokeRect(pad + (Math.min(x0, x1) / n) * plot, pad * 0.3 + (Math.min(y0, y1) / n) * plot, (Math.abs(x1 - x0) + 1) / n * plot, (Math.abs(y1 - y0) + 1) / n * plot);
    ctx.lineWidth = 1;
  }
  ctx.fillStyle = 'rgba(248,245,238,0.6)';
  ctx.font = `${Math.round(size * 0.032)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Scored residue', pad + plot / 2, size - size * 0.015);
  ctx.save();
  ctx.translate(size * 0.035, pad * 0.3 + plot / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Aligned residue', 0, 0);
  ctx.restore();
  return {
    toIndex(x, y) {
      const column = Math.floor(((x - pad) / plot) * n);
      const row = Math.floor(((y - pad * 0.3) / plot) * n);
      if (column < 0 || row < 0 || column >= n || row >= n) return null;
      return { row, column };
    },
  };
}

function contactColor(t) {
  const light = [247, 245, 250];
  const dark = [63, 0, 125];
  return [light[0] + (dark[0] - light[0]) * t, light[1] + (dark[1] - light[1]) * t, light[2] + (dark[2] - light[2]) * t];
}

function paeColor(t) {
  const dark = [0, 68, 27];
  const light = [247, 252, 245];
  const mid = [65, 171, 93];
  if (t < 0.5) {
    const k = t / 0.5;
    return [dark[0] + (mid[0] - dark[0]) * k, dark[1] + (mid[1] - dark[1]) * k, dark[2] + (mid[2] - dark[2]) * k];
  }
  const k = (t - 0.5) / 0.5;
  return [mid[0] + (light[0] - mid[0]) * k, mid[1] + (light[1] - mid[1]) * k, mid[2] + (light[2] - mid[2]) * k];
}

function wrapAngle(value) {
  let angle = value;
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

function formatTick(value) {
  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1);
}
