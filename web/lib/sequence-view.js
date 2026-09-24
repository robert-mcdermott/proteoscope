import { SECONDARY_COLORS, colorToHex } from './colors.js';

export function createSequenceView(container, callbacks = {}) {
  let sequence = null;
  let spans = new Map();
  let hoverKey = null;
  let selected = new Set();
  let dragStart = null;

  container.addEventListener('pointerover', (event) => {
    const key = event.target?.dataset?.key;
    if (key) callbacks.onHover?.(key);
  });
  container.addEventListener('pointerleave', () => callbacks.onHover?.(null));
  container.addEventListener('pointerdown', (event) => {
    const key = event.target?.dataset?.key;
    if (!key) return;
    event.preventDefault();
    dragStart = key;
    callbacks.onSelect?.([key], { additive: event.shiftKey || event.metaKey || event.ctrlKey, frame: false });
  });
  container.addEventListener('pointermove', (event) => {
    if (!dragStart || !(event.buttons & 1)) return;
    const key = event.target?.dataset?.key;
    if (!key || key === dragStart) return;
    callbacks.onSelect?.(rangeKeys(dragStart, key), { additive: event.shiftKey, frame: false });
  });
  window.addEventListener('pointerup', () => {
    if (dragStart) callbacks.onSelectEnd?.();
    dragStart = null;
  });
  container.addEventListener('dblclick', (event) => {
    const key = event.target?.dataset?.key;
    if (key) callbacks.onFocus?.(key);
  });

  function rangeKeys(fromKey, toKey) {
    const keys = sequence.items.filter((item) => item.residue).map((item) => item.residue.key);
    const a = keys.indexOf(fromKey);
    const b = keys.indexOf(toKey);
    if (a < 0 || b < 0) return [toKey];
    return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  // `options.partner` ({ name, lookup(key) → { code, label } | null }) adds a second row with the
  // aligned residue of another structure under each residue; substitutions and gaps are marked.
  function render(info, colorForResidue, options = {}) {
    sequence = info;
    spans = new Map();
    container.replaceChildren();
    container.classList.toggle('has-partner', Boolean(options.partner));
    if (!info) return;
    const partner = options.partner ?? null;
    const fragment = document.createDocumentFragment();
    let block = null;
    let residuesInBlock = null;
    let partnerInBlock = null;
    let position = 0;
    for (const item of info.items) {
      if (item.gap) {
        const gap = document.createElement('span');
        gap.className = 'seq-gap';
        gap.textContent = `··· ${item.gap} ···`;
        gap.title = `${item.gap} residues missing (numbering gap)`;
        fragment.appendChild(gap);
        block = null;
        continue;
      }
      if (!block || position % 10 === 0) {
        block = document.createElement('span');
        block.className = 'seq-block';
        const label = document.createElement('small');
        label.textContent = item.residue ? `${item.residue.resSeq}${item.residue.iCode}` : '';
        block.appendChild(label);
        residuesInBlock = document.createElement('span');
        residuesInBlock.className = 'residues';
        block.appendChild(residuesInBlock);
        if (partner) {
          partnerInBlock = document.createElement('span');
          partnerInBlock.className = 'residues partner-row';
          block.appendChild(partnerInBlock);
        }
        fragment.appendChild(block);
      }
      const span = document.createElement('span');
      span.className = 'seq-res';
      span.textContent = item.code;
      if (item.residue) {
        span.dataset.key = item.residue.key;
        span.title = `${item.residue.resName} ${item.residue.chain}${item.residue.resSeq}${item.residue.iCode}`;
        span.style.setProperty('--ss-color', ssColor(item.residue.ss));
        spans.set(item.residue.key, span);
        if (block.firstChild.textContent === '') block.firstChild.textContent = `${item.residue.resSeq}`;
      } else {
        span.classList.add('is-missing');
        span.title = `${item.resName || item.code}: not modeled in the structure`;
      }
      residuesInBlock.appendChild(span);
      if (partner) partnerInBlock.appendChild(partnerSpan(item, partner));
      position += 1;
    }
    container.appendChild(fragment);
    recolor(colorForResidue);
    applySelection(selected);
  }

  function recolor(colorForResidue) {
    if (!colorForResidue) return;
    for (const [key, span] of spans) {
      const color = colorForResidue(key);
      if (color) span.style.setProperty('--res-color', colorToHex(lighten(color)));
    }
  }

  function applySelection(keys) {
    selected = keys;
    for (const [key, span] of spans) span.classList.toggle('is-selected', keys.has(key));
  }

  function setHover(key) {
    if (hoverKey === key) return;
    spans.get(hoverKey)?.classList.remove('is-hover');
    hoverKey = key;
    const span = spans.get(key);
    if (span) {
      span.classList.add('is-hover');
    }
  }

  function scrollTo(key) {
    spans.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return { render, recolor, setSelection: applySelection, setHover, scrollTo };
}

function partnerSpan(item, partner) {
  const span = document.createElement('span');
  span.className = 'seq-partner';
  const match = item.residue ? partner.lookup(item.residue.key) : null;
  if (!item.residue) {
    span.textContent = ' ';
  } else if (!match) {
    span.textContent = '–';
    span.classList.add('is-gap');
    span.title = `${partner.name}: no aligned residue`;
  } else {
    span.textContent = match.code;
    const substituted = match.code !== item.code;
    span.classList.toggle('is-mismatch', substituted);
    span.title = `${partner.name}: ${match.label}${substituted ? ` (${item.code}→${match.code})` : ''}`;
    if (item.residue) span.dataset.key = item.residue.key;
  }
  return span;
}

function ssColor(ss) {
  if (ss === 'helix') return colorToHex(SECONDARY_COLORS.helix);
  if (ss === 'sheet') return colorToHex(SECONDARY_COLORS.sheet);
  return 'transparent';
}

function lighten(color) {
  const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  if (luminance > 0.35) return color;
  const t = 0.45;
  return [color[0] + (1 - color[0]) * t, color[1] + (1 - color[1]) * t, color[2] + (1 - color[2]) * t];
}
