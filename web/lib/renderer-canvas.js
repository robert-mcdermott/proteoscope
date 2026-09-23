// Compatibility renderer for browsers without WebGPU: depth-sorted 2D projection of the same
// sphere/cylinder instance buffers the WebGPU renderer consumes.
export function createCanvasRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const scene = {
    colors: new Float32Array(4),
    flags: new Uint32Array(1),
    spheres: null,
    sphereCount: 0,
    cylinders: null,
    cylinderCount: 0,
    shapes: [],
  };
  let lastView = null;
  let projected = [];

  function setAtomData(colors, flags) {
    scene.colors = colors;
    scene.flags = flags;
  }

  function setSpheres(data, count) {
    scene.spheres = data ? { floats: new Float32Array(data), uints: new Uint32Array(data) } : null;
    scene.sphereCount = count;
  }

  function setCylinders(data, count) {
    scene.cylinders = data ? { floats: new Float32Array(data), uints: new Uint32Array(data) } : null;
    scene.cylinderCount = count;
  }

  function setCanvasShapes(shapes) {
    scene.shapes = shapes ?? [];
  }

  function atomColor(atom, override = 0) {
    if (override) return [(override & 255) / 255, ((override >>> 8) & 255) / 255, ((override >>> 16) & 255) / 255];
    const offset = atom * 4;
    let color = [scene.colors[offset] ?? 0.7, scene.colors[offset + 1] ?? 0.7, scene.colors[offset + 2] ?? 0.7];
    const flags = scene.flags[atom] ?? 0;
    if (flags & 4) color = mix(color, [0.5, 0.52, 0.55], 0.72);
    if (flags & 1) color = mix(color, lastView?.settings.highlightColor ?? [0.35, 1, 0.55], lastView?.settings.highlightStrength ?? 0.55);
    if (flags & 2) color = mix(color, lastView?.settings.hoverColor ?? [1, 0.95, 0.55], lastView?.settings.hoverStrength ?? 0.35);
    return color;
  }

  function project(view, p) {
    const m = view.viewProj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w <= 0.0001) return null;
    const depth = (p[0] - view.eye[0]) * view.forward[0] + (p[1] - view.eye[1]) * view.forward[1] + (p[2] - view.eye[2]) * view.forward[2];
    return {
      x: (x / w * 0.5 + 0.5) * canvas.width,
      y: (0.5 - y / w * 0.5) * canvas.height,
      depth,
      scale: canvas.height * view.proj[5] * 0.5 / (view.orthographic ? 1 : w),
    };
  }

  function clipped(view, depth, settings) {
    const clip = settings.clip ?? {};
    return (clip.nearEnabled && depth < clip.near) || (clip.farEnabled && depth > clip.far);
  }

  function render(view, settings) {
    lastView = { view, settings };
    const width = canvas.width;
    const height = canvas.height;
    const background = settings.background ?? { top: [0, 0, 0], bottom: [0, 0, 0] };
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, css(background.top));
    gradient.addColorStop(1, css(background.bottom));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    const items = [];
    for (const shape of scene.shapes) {
      const a = project(view, shape.a);
      const b = project(view, shape.b);
      if (!a || !b || clipped(view, (a.depth + b.depth) / 2, settings)) continue;
      items.push({ kind: 'line', depth: (a.depth + b.depth) / 2, a, b, radius: shape.width, color: atomColor(shape.atom) });
    }
    if (scene.cylinders) {
      const { floats, uints } = scene.cylinders;
      for (let index = 0; index < scene.cylinderCount; index += 1) {
        const offset = index * 11;
        const a = project(view, [floats[offset], floats[offset + 1], floats[offset + 2]]);
        const b = project(view, [floats[offset + 4], floats[offset + 5], floats[offset + 6]]);
        if (!a || !b || clipped(view, (a.depth + b.depth) / 2, settings)) continue;
        const style = uints[offset + 9];
        const override = style & 2 ? uints[offset + 10] : 0;
        items.push({
          kind: 'line',
          depth: (a.depth + b.depth) / 2,
          a,
          b,
          radius: floats[offset + 3],
          color: atomColor(uints[offset + 7], override),
          colorB: override ? null : atomColor(uints[offset + 8]),
          dashed: Boolean(style & 1),
        });
      }
    }
    projected = [];
    if (scene.spheres) {
      const { floats, uints } = scene.spheres;
      for (let index = 0; index < scene.sphereCount; index += 1) {
        const offset = index * 5;
        const p = project(view, [floats[offset], floats[offset + 1], floats[offset + 2]]);
        if (!p || clipped(view, p.depth, settings)) continue;
        const atom = uints[offset + 4];
        const item = { kind: 'sphere', depth: p.depth, p, radius: floats[offset + 3], atom, color: atomColor(atom) };
        items.push(item);
        projected.push(item);
      }
    }
    items.sort((a, b) => b.depth - a.depth);
    const nearest = items.length ? items[items.length - 1].depth : 0;
    const farthest = items.length ? items[0].depth : 1;
    const span = Math.max(1, farthest - nearest);
    const fogStrength = Math.max(0.25, settings.fog?.strength ?? 0.4);
    const backgroundColor = background.bottom;
    ctx.lineCap = 'round';
    for (const item of items) {
      const fade = ((item.depth - nearest) / span) * fogStrength * 0.8;
      item.color = mix(item.color, backgroundColor, fade);
      if (item.colorB) item.colorB = mix(item.colorB, backgroundColor, fade);
      if (item.kind === 'line') {
        const widthPx = Math.max(1, item.radius * 2 * item.a.scale);
        ctx.lineWidth = widthPx;
        ctx.setLineDash(item.dashed ? [widthPx * 1.5, widthPx * 1.5] : []);
        if (item.colorB) {
          const mx = (item.a.x + item.b.x) / 2;
          const my = (item.a.y + item.b.y) / 2;
          ctx.strokeStyle = css(item.color);
          ctx.beginPath();
          ctx.moveTo(item.a.x, item.a.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
          ctx.strokeStyle = css(item.colorB);
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(item.b.x, item.b.y);
          ctx.stroke();
        } else {
          ctx.strokeStyle = css(item.color);
          ctx.beginPath();
          ctx.moveTo(item.a.x, item.a.y);
          ctx.lineTo(item.b.x, item.b.y);
          ctx.stroke();
        }
      } else {
        const radius = Math.max(1.2, item.radius * item.p.scale);
        const shade = ctx.createRadialGradient(item.p.x - radius * 0.3, item.p.y - radius * 0.3, radius * 0.1, item.p.x, item.p.y, radius);
        shade.addColorStop(0, css(mix(item.color, [1, 1, 1], 0.45)));
        shade.addColorStop(0.7, css(item.color));
        shade.addColorStop(1, css(mix(item.color, [0, 0, 0], 0.35)));
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(item.p.x, item.p.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setLineDash([]);
  }

  async function pick(x, y) {
    let best = null;
    for (const item of projected) {
      const radius = Math.max(3, item.radius * item.p.scale);
      const dx = item.p.x - x;
      const dy = item.p.y - y;
      if (dx * dx + dy * dy <= radius * radius && (!best || item.depth < best.depth)) best = item;
    }
    return best ? best.atom : -1;
  }

  async function capture(view, settings, width, height) {
    const previousWidth = canvas.width;
    const previousHeight = canvas.height;
    canvas.width = width;
    canvas.height = height;
    render(view, settings);
    const data = ctx.getImageData(0, 0, width, height);
    canvas.width = previousWidth;
    canvas.height = previousHeight;
    render(lastView.view, lastView.settings);
    return { width, height, data: data.data };
  }

  return {
    kind: 'canvas',
    label: 'Canvas preview',
    maxTextureDimension: 8192,
    setAtomData,
    updateAtomColors(colors) {
      scene.colors = colors;
    },
    updateAtomFlags(flags) {
      scene.flags = flags;
    },
    setSpheres,
    setCylinders,
    setMesh() {},
    setMeshOpacity() {},
    setMeshAtomOffset() {},
    meshIds() {
      return [];
    },
    setCanvasShapes,
    render,
    pick,
    capture,
  };
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function css(color) {
  return `rgb(${Math.round(Math.min(1, Math.max(0, color[0])) * 255)} ${Math.round(Math.min(1, Math.max(0, color[1])) * 255)} ${Math.round(Math.min(1, Math.max(0, color[2])) * 255)})`;
}
