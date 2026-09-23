const FRAME_FLOATS = 128;
const AO_KERNEL_SIZE = 16;
const PICK_RADIUS = 4;

export const SPHERE_STRIDE = 20;
export const CYLINDER_STRIDE = 44;
export const MESH_VERTEX_STRIDE = 32;

export const CYLINDER_STYLE = {
  dashed: 1,
  colorOverride: 2,
  noPick: 4,
  roundCaps: 8,
};

const COMMON_WGSL = /* wgsl */ `
struct Frame {
  viewProj: mat4x4f,
  view: mat4x4f,
  proj: mat4x4f,
  invProj: mat4x4f,
  eye: vec4f,
  right: vec4f,
  up: vec4f,
  forward: vec4f,
  viewport: vec4f,
  clip: vec4f,
  light: vec4f,
  material: vec4f,
  highlight: vec4f,
  hover: vec4f,
  params: vec4f,
  fog: vec4f,
  bgTop: vec4f,
  bgBottom: vec4f,
  post: vec4f,
  post2: vec4f,
};

fn viewDepthOf(p: vec3f) -> f32 {
  return dot(p - frame.eye.xyz, frame.forward.xyz);
}

fn clipped(p: vec3f) -> bool {
  let depth = viewDepthOf(p);
  return (frame.clip.z > 0.5 && depth < frame.clip.x) || (frame.clip.w > 0.5 && depth > frame.clip.y);
}

fn viewDirection(p: vec3f) -> vec3f {
  if (frame.eye.w > 0.5) {
    return -frame.forward.xyz;
  }
  return normalize(frame.eye.xyz - p);
}
`;

const GEOMETRY_WGSL = /* wgsl */ `
${COMMON_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> atomColors: array<vec4f>;
@group(0) @binding(2) var<storage, read> atomFlags: array<u32>;

struct GBuffer {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
  @location(2) id: u32,
};

struct ImpostorOut {
  @location(0) color: vec4f,
  @location(1) normal: vec4f,
  @location(2) id: u32,
  @builtin(frag_depth) depth: f32,
};

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

const CUBE = array<vec3f, 36>(
  vec3f(1.0, -1.0, -1.0), vec3f(1.0, 1.0, -1.0), vec3f(1.0, 1.0, 1.0),
  vec3f(1.0, -1.0, -1.0), vec3f(1.0, 1.0, 1.0), vec3f(1.0, -1.0, 1.0),
  vec3f(-1.0, -1.0, -1.0), vec3f(-1.0, -1.0, 1.0), vec3f(-1.0, 1.0, 1.0),
  vec3f(-1.0, -1.0, -1.0), vec3f(-1.0, 1.0, 1.0), vec3f(-1.0, 1.0, -1.0),
  vec3f(-1.0, 1.0, -1.0), vec3f(-1.0, 1.0, 1.0), vec3f(1.0, 1.0, 1.0),
  vec3f(-1.0, 1.0, -1.0), vec3f(1.0, 1.0, 1.0), vec3f(1.0, 1.0, -1.0),
  vec3f(-1.0, -1.0, -1.0), vec3f(1.0, -1.0, -1.0), vec3f(1.0, -1.0, 1.0),
  vec3f(-1.0, -1.0, -1.0), vec3f(1.0, -1.0, 1.0), vec3f(-1.0, -1.0, 1.0),
  vec3f(-1.0, -1.0, 1.0), vec3f(1.0, -1.0, 1.0), vec3f(1.0, 1.0, 1.0),
  vec3f(-1.0, -1.0, 1.0), vec3f(1.0, 1.0, 1.0), vec3f(-1.0, 1.0, 1.0),
  vec3f(-1.0, -1.0, -1.0), vec3f(-1.0, 1.0, -1.0), vec3f(1.0, 1.0, -1.0),
  vec3f(-1.0, -1.0, -1.0), vec3f(1.0, 1.0, -1.0), vec3f(1.0, -1.0, -1.0),
);

fn applyFlags(base: vec3f, flags: u32) -> vec3f {
  var color = base;
  if ((flags & 4u) != 0u) {
    color = mix(color, vec3f(0.5, 0.52, 0.55), 0.72);
  }
  if ((flags & 1u) != 0u) {
    color = mix(color, frame.highlight.rgb, frame.highlight.w);
  }
  if ((flags & 2u) != 0u) {
    color = mix(color, frame.hover.rgb, frame.hover.w);
  }
  return color;
}

fn shade(base: vec3f, normal: vec3f, position: vec3f) -> vec3f {
  let n = normalize(normal);
  let v = viewDirection(position);
  let facing = max(dot(n, v), 0.0);
  if (frame.params.z > 0.5) {
    return base * (0.8 + 0.2 * facing);
  }
  let l = normalize(frame.light.xyz);
  let diffuse = max(dot(n, l), 0.0);
  let h = normalize(l + v);
  let specular = pow(max(dot(n, h), 0.0), frame.material.w) * frame.material.z;
  let rim = pow(1.0 - facing, 3.0) * 0.08;
  return base * (frame.material.x + frame.material.y * (0.6 * diffuse + 0.4 * facing)) + vec3f(specular + rim);
}

fn encodeNormal(n: vec3f) -> vec4f {
  let viewNormal = normalize((frame.view * vec4f(n, 0.0)).xyz);
  return vec4f(viewNormal * 0.5 + 0.5, 1.0);
}

fn projectDepth(p: vec3f) -> f32 {
  let clip = frame.viewProj * vec4f(p, 1.0);
  return clip.z / clip.w;
}

fn raySphere(origin: vec3f, direction: vec3f, center: vec3f, radius: f32) -> f32 {
  let oc = origin - center;
  let b = dot(oc, direction);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) {
    return -1.0;
  }
  return -b - sqrt(h);
}

struct SphereVarying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) center: vec3f,
  @location(2) @interpolate(flat) radius: f32,
  @location(3) @interpolate(flat) color: vec3f,
  @location(4) @interpolate(flat) atom: u32,
};

@vertex
fn vsSphere(@builtin(vertex_index) vertexIndex: u32, @location(0) centerRadius: vec4f, @location(1) atom: u32) -> SphereVarying {
  let corner = QUAD[vertexIndex];
  let center = centerRadius.xyz;
  let radius = centerRadius.w;
  var axisZ = -frame.forward.xyz;
  var size = radius;
  if (frame.eye.w < 0.5) {
    let toEye = frame.eye.xyz - center;
    let d = length(toEye);
    axisZ = toEye / max(d, 0.0001);
    size = radius * d / sqrt(max(d * d - radius * radius, radius * radius * 0.05));
  }
  var axisX = cross(frame.up.xyz, axisZ);
  if (dot(axisX, axisX) < 0.000001) {
    axisX = frame.right.xyz;
  }
  axisX = normalize(axisX);
  let axisY = cross(axisZ, axisX);
  let world = center + (axisX * corner.x + axisY * corner.y) * size * 1.04;
  var out: SphereVarying;
  out.position = frame.viewProj * vec4f(world, 1.0);
  out.world = world;
  out.center = center;
  out.radius = radius;
  out.color = applyFlags(atomColors[atom].rgb, atomFlags[atom]);
  out.atom = atom;
  return out;
}

@fragment
fn fsSphere(in: SphereVarying) -> ImpostorOut {
  var origin = frame.eye.xyz;
  var direction = normalize(in.world - frame.eye.xyz);
  if (frame.eye.w > 0.5) {
    direction = frame.forward.xyz;
    origin = in.world - direction * (in.radius * 3.0);
  }
  let oc = origin - in.center;
  let b = dot(oc, direction);
  let c = dot(oc, oc) - in.radius * in.radius;
  let h = b * b - c;
  if (h < 0.0) {
    discard;
  }
  let s = sqrt(h);
  let t = -b - s;
  if (t < 0.0) {
    discard;
  }
  var hit = origin + direction * t;
  var normal = (hit - in.center) / in.radius;
  var color = in.color;
  if (frame.clip.z > 0.5 && viewDepthOf(hit) < frame.clip.x) {
    let back = origin + direction * (-b + s);
    if (viewDepthOf(back) < frame.clip.x) {
      discard;
    }
    let tPlane = (frame.clip.x - viewDepthOf(origin)) / dot(direction, frame.forward.xyz);
    hit = origin + direction * tPlane;
    normal = -frame.forward.xyz;
    color = color * 0.62;
  }
  if (frame.clip.w > 0.5 && viewDepthOf(hit) > frame.clip.y) {
    discard;
  }
  var out: ImpostorOut;
  out.color = vec4f(shade(color, normal, hit), 1.0);
  out.normal = encodeNormal(normal);
  out.id = in.atom + 1u;
  out.depth = projectDepth(hit);
  return out;
}

struct CylinderVarying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) start: vec3f,
  @location(2) @interpolate(flat) end: vec3f,
  @location(3) @interpolate(flat) radius: f32,
  @location(4) @interpolate(flat) colorA: vec3f,
  @location(5) @interpolate(flat) colorB: vec3f,
  @location(6) @interpolate(flat) ids: vec2u,
  @location(7) @interpolate(flat) style: u32,
};

@vertex
fn vsCylinder(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) startRadius: vec4f,
  @location(1) end: vec3f,
  @location(2) atomA: u32,
  @location(3) atomB: u32,
  @location(4) style: u32,
  @location(5) overrideColor: vec4f,
) -> CylinderVarying {
  let start = startRadius.xyz;
  let radius = startRadius.w;
  let axis = end - start;
  let len = max(length(axis), 0.0001);
  let u = axis / len;
  var reference = vec3f(0.0, 1.0, 0.0);
  if (abs(u.y) > 0.9) {
    reference = vec3f(1.0, 0.0, 0.0);
  }
  let v = normalize(cross(u, reference));
  let w = cross(u, v);
  let corner = CUBE[vertexIndex];
  let along = mix(-radius, len + radius, corner.z * 0.5 + 0.5);
  let world = start + u * along + (v * corner.x + w * corner.y) * radius * 1.04;
  var out: CylinderVarying;
  out.position = frame.viewProj * vec4f(world, 1.0);
  out.world = world;
  out.start = start;
  out.end = end;
  out.radius = radius;
  if ((style & 2u) != 0u) {
    out.colorA = overrideColor.rgb;
    out.colorB = overrideColor.rgb;
  } else {
    out.colorA = applyFlags(atomColors[atomA].rgb, atomFlags[atomA]);
    out.colorB = applyFlags(atomColors[atomB].rgb, atomFlags[atomB]);
  }
  out.ids = vec2u(atomA, atomB);
  out.style = style;
  return out;
}

@fragment
fn fsCylinder(in: CylinderVarying) -> ImpostorOut {
  var origin = frame.eye.xyz;
  var direction = normalize(in.world - frame.eye.xyz);
  if (frame.eye.w > 0.5) {
    direction = frame.forward.xyz;
    origin = in.world - direction * (in.radius * 3.0);
  }
  let axis = in.end - in.start;
  let len = max(length(axis), 0.0001);
  let u = axis / len;
  let oa = origin - in.start;
  let dz = dot(direction, u);
  let oz = dot(oa, u);
  let dp = direction - u * dz;
  let op = oa - u * oz;
  let a = dot(dp, dp);
  let b = dot(op, dp);
  let c = dot(op, op) - in.radius * in.radius;
  let h = b * b - a * c;
  var t = -1.0;
  var along = 0.0;
  var normal = vec3f(0.0, 0.0, 1.0);
  if (a > 0.00000001 && h >= 0.0) {
    let side = (-b - sqrt(h)) / a;
    let z = oz + side * dz;
    if (side > 0.0 && z >= 0.0 && z <= len) {
      t = side;
      along = z;
      normal = (op + dp * side) / in.radius;
    }
  }
  if ((in.style & 8u) != 0u) {
    let capA = raySphere(origin, direction, in.start, in.radius);
    if (capA > 0.0 && (t < 0.0 || capA < t)) {
      t = capA;
      along = 0.0;
      normal = normalize(origin + direction * capA - in.start);
    }
    let capB = raySphere(origin, direction, in.end, in.radius);
    if (capB > 0.0 && (t < 0.0 || capB < t)) {
      t = capB;
      along = len;
      normal = normalize(origin + direction * capB - in.end);
    }
  }
  if (t < 0.0) {
    discard;
  }
  if ((in.style & 1u) != 0u && fract(along / frame.params.w) > 0.56) {
    discard;
  }
  let hit = origin + direction * t;
  if (clipped(hit)) {
    discard;
  }
  let first = along < len * 0.5;
  var out: ImpostorOut;
  out.color = vec4f(shade(select(in.colorB, in.colorA, first), normal, hit), 1.0);
  out.normal = encodeNormal(normal);
  if ((in.style & 4u) != 0u) {
    out.id = 0u;
  } else {
    out.id = select(in.ids.y, in.ids.x, first) + 1u;
  }
  out.depth = projectDepth(hit);
  return out;
}

struct MeshParams {
  opacity: f32,
  flags: u32,
  atomOffset: u32,
  pad1: f32,
};

@group(1) @binding(0) var<uniform> meshParams: MeshParams;

struct MeshVarying {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) @interpolate(flat) atom: u32,
};

@vertex
fn vsMesh(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) atom: u32,
  @location(3) color: vec4f,
) -> MeshVarying {
  var out: MeshVarying;
  let id = atom + meshParams.atomOffset;
  out.position = frame.viewProj * vec4f(position, 1.0);
  out.world = position;
  out.normal = normal;
  var base = atomColors[id].rgb;
  if (color.a > 0.0) {
    base = color.rgb;
  }
  out.color = applyFlags(base, atomFlags[id]);
  out.atom = id;
  return out;
}

@fragment
fn fsMesh(in: MeshVarying) -> GBuffer {
  if (clipped(in.world)) {
    discard;
  }
  var n = normalize(in.normal);
  if (dot(n, viewDirection(in.world)) < 0.0) {
    n = -n;
  }
  var out: GBuffer;
  out.color = vec4f(shade(in.color, n, in.world), 1.0);
  out.normal = encodeNormal(n);
  out.id = in.atom + 1u;
  return out;
}

@fragment
fn fsMeshDepth(in: MeshVarying) -> @location(0) vec4f {
  if (clipped(in.world)) {
    discard;
  }
  return vec4f(0.0);
}

@fragment
fn fsMeshTransparent(in: MeshVarying) -> @location(0) vec4f {
  if (clipped(in.world)) {
    discard;
  }
  var n = normalize(in.normal);
  if (dot(n, viewDirection(in.world)) < 0.0) {
    n = -n;
  }
  var color = shade(in.color, n, in.world);
  let depth = viewDepthOf(in.world);
  let fogAmount = clamp((depth - frame.fog.x) / max(frame.fog.y - frame.fog.x, 0.001), 0.0, 1.0) * frame.fog.z;
  let uvY = in.position.y * frame.viewport.w;
  color = mix(color, mix(frame.bgTop.rgb, frame.bgBottom.rgb, uvY), fogAmount);
  let alpha = meshParams.opacity;
  return vec4f(color * alpha, alpha);
}

struct GlowVarying {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec3f,
};

@vertex
fn vsGlow(@builtin(vertex_index) vertexIndex: u32, @location(0) centerRadius: vec4f, @location(1) atom: u32) -> GlowVarying {
  let corner = QUAD[vertexIndex];
  let size = centerRadius.w * (2.8 + frame.params.y * 5.0);
  let world = centerRadius.xyz + (frame.right.xyz * corner.x + frame.up.xyz * corner.y) * size;
  var out: GlowVarying;
  out.position = frame.viewProj * vec4f(world, 1.0);
  out.uv = corner;
  out.color = applyFlags(atomColors[atom].rgb, atomFlags[atom]);
  return out;
}

@fragment
fn fsGlow(in: GlowVarying) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) {
    discard;
  }
  let feather = pow(1.0 - r2, 2.2);
  let strength = feather * feather * 0.02 * frame.params.y;
  return vec4f(in.color * strength, strength);
}
`;

const FULLSCREEN_WGSL = /* wgsl */ `
struct FullscreenVarying {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsFullscreen(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVarying {
  let positions = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  let p = positions[vertexIndex];
  var out: FullscreenVarying;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}
`;

const POST_WGSL = /* wgsl */ `
${COMMON_WGSL}
${FULLSCREEN_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var depthTex: texture_depth_2d;

fn viewPosition(px: vec2i, depth: f32) -> vec3f {
  let uv = (vec2f(px) + 0.5) * frame.viewport.zw;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let v = frame.invProj * vec4f(ndc, depth, 1.0);
  return v.xyz / v.w;
}

fn clampPixel(px: vec2i) -> vec2i {
  return clamp(px, vec2i(0), vec2i(frame.viewport.xy) - vec2i(1));
}
`;

const SSAO_WGSL = /* wgsl */ `
${POST_WGSL}
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> kernel: array<vec4f, ${AO_KERNEL_SIZE}>;

@fragment
fn fsSSAO(in: FullscreenVarying) -> @location(0) vec4f {
  let px = vec2i(in.position.xy);
  let depth = textureLoad(depthTex, px, 0);
  if (depth <= 0.0) {
    return vec4f(1.0);
  }
  let p = viewPosition(px, depth);
  let n = normalize(textureLoad(normalTex, px, 0).xyz * 2.0 - 1.0);
  let noise = f32((px.x & 3) + (px.y & 3) * 4);
  let angle = noise * 0.3926991 + 0.7;
  var randomVector = vec3f(cos(angle), sin(angle), 0.0);
  var tangent = randomVector - n * dot(randomVector, n);
  if (dot(tangent, tangent) < 0.0001) {
    tangent = vec3f(0.0, 0.0, 1.0) - n * n.z;
  }
  tangent = normalize(tangent);
  let bitangent = cross(n, tangent);
  let radius = frame.post.y;
  let bias = frame.post2.x;
  var occlusion = 0.0;
  for (var index = 0u; index < ${AO_KERNEL_SIZE}u; index += 1u) {
    let k = kernel[index].xyz;
    let samplePosition = p + (tangent * k.x + bitangent * k.y + n * k.z) * radius;
    let clip = frame.proj * vec4f(samplePosition, 1.0);
    let ndc = clip.xy / clip.w;
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x >= 1.0 || uv.y >= 1.0) {
      continue;
    }
    let samplePixel = clampPixel(vec2i(uv * frame.viewport.xy));
    let sampleDepth = textureLoad(depthTex, samplePixel, 0);
    if (sampleDepth <= 0.0) {
      continue;
    }
    let scene = viewPosition(samplePixel, sampleDepth);
    let range = smoothstep(0.0, 1.0, radius / max(abs(p.z - scene.z), 0.0001));
    if (scene.z >= samplePosition.z + bias) {
      occlusion += range;
    }
  }
  let ao = pow(clamp(1.0 - occlusion * 1.35 / f32(${AO_KERNEL_SIZE}), 0.0, 1.0), 1.7);
  return vec4f(ao, ao, ao, 1.0);
}
`;

const BLUR_WGSL = /* wgsl */ `
${POST_WGSL}
@group(0) @binding(2) var aoTex: texture_2d<f32>;

@fragment
fn fsBlur(in: FullscreenVarying) -> @location(0) vec4f {
  let px = vec2i(in.position.xy);
  let depth = textureLoad(depthTex, px, 0);
  if (depth <= 0.0) {
    return vec4f(1.0);
  }
  let centerZ = viewPosition(px, depth).z;
  let falloff = 1.0 / max(frame.post.y * 0.35, 0.05);
  var sum = 0.0;
  var weight = 0.0;
  for (var y = -2; y <= 1; y += 1) {
    for (var x = -2; x <= 1; x += 1) {
      let q = clampPixel(px + vec2i(x, y));
      let d = textureLoad(depthTex, q, 0);
      if (d <= 0.0) {
        continue;
      }
      let z = viewPosition(q, d).z;
      let w = exp(-abs(z - centerZ) * falloff);
      sum += textureLoad(aoTex, q, 0).r * w;
      weight += w;
    }
  }
  let ao = select(1.0, sum / weight, weight > 0.0001);
  return vec4f(ao, ao, ao, 1.0);
}
`;

const COMPOSITE_WGSL = /* wgsl */ `
${POST_WGSL}
@group(0) @binding(2) var colorTex: texture_2d<f32>;
@group(0) @binding(3) var aoTex: texture_2d<f32>;

fn backgroundColor(uvY: f32) -> vec3f {
  return mix(frame.bgTop.rgb, frame.bgBottom.rgb, clamp(uvY, 0.0, 1.0));
}

fn linearDepthAt(px: vec2i) -> f32 {
  let d = textureLoad(depthTex, clampPixel(px), 0);
  if (d <= 0.0) {
    return 1.0e9;
  }
  return -viewPosition(clampPixel(px), d).z;
}

@fragment
fn fsComposite(in: FullscreenVarying) -> @location(0) vec4f {
  let px = vec2i(in.position.xy);
  let depth = textureLoad(depthTex, px, 0);
  let background = backgroundColor(in.uv.y);
  let bgAlpha = frame.bgTop.a;
  if (depth <= 0.0) {
    return vec4f(background * bgAlpha, bgAlpha);
  }
  var color = textureLoad(colorTex, px, 0).rgb;
  let ao = textureLoad(aoTex, px, 0).r;
  color = color * mix(1.0, ao, frame.post.x);
  let z = -viewPosition(px, depth).z;
  if (frame.post.z > 0.0) {
    let width = i32(max(1.0, round(frame.post.w)));
    let threshold = max(frame.post2.y, z * 0.018);
    var edge = 0.0;
    let offsets = array<vec2i, 4>(vec2i(width, 0), vec2i(-width, 0), vec2i(0, width), vec2i(0, -width));
    for (var index = 0; index < 4; index += 1) {
      let nz = linearDepthAt(px + offsets[index]);
      if (nz - z > threshold) {
        edge = 1.0;
      }
    }
    color = mix(color, vec3f(0.0), edge * frame.post.z);
  }
  let fogAmount = clamp((z - frame.fog.x) / max(frame.fog.y - frame.fog.x, 0.001), 0.0, 1.0) * frame.fog.z;
  color = mix(color, background, fogAmount);
  return vec4f(color, 1.0);
}
`;

const FXAA_WGSL = /* wgsl */ `
${COMMON_WGSL}
${FULLSCREEN_WGSL}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

fn luma(color: vec4f) -> f32 {
  return dot(color.rgb, vec3f(0.299, 0.587, 0.114)) + color.a * 0.05;
}

@fragment
fn fsFXAA(in: FullscreenVarying) -> @location(0) vec4f {
  let texel = frame.viewport.zw;
  let uv = in.position.xy * texel;
  let center = textureSampleLevel(sourceTex, sourceSampler, uv, 0.0);
  if (frame.post2.z < 0.5) {
    return center;
  }
  let nw = textureSampleLevel(sourceTex, sourceSampler, uv + vec2f(-1.0, -1.0) * texel, 0.0);
  let ne = textureSampleLevel(sourceTex, sourceSampler, uv + vec2f(1.0, -1.0) * texel, 0.0);
  let sw = textureSampleLevel(sourceTex, sourceSampler, uv + vec2f(-1.0, 1.0) * texel, 0.0);
  let se = textureSampleLevel(sourceTex, sourceSampler, uv + vec2f(1.0, 1.0) * texel, 0.0);
  let lumaNW = luma(nw);
  let lumaNE = luma(ne);
  let lumaSW = luma(sw);
  let lumaSE = luma(se);
  let lumaM = luma(center);
  let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  if (lumaMax - lumaMin < max(0.0312, lumaMax * 0.125)) {
    return center;
  }
  var dir = vec2f(-((lumaNW + lumaNE) - (lumaSW + lumaSE)), (lumaNW + lumaSW) - (lumaNE + lumaSE));
  let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.125, 1.0 / 128.0);
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2f(-8.0), vec2f(8.0)) * texel;
  let a = 0.5 * (
    textureSampleLevel(sourceTex, sourceSampler, uv + dir * (1.0 / 3.0 - 0.5), 0.0) +
    textureSampleLevel(sourceTex, sourceSampler, uv + dir * (2.0 / 3.0 - 0.5), 0.0)
  );
  let b = a * 0.5 + 0.25 * (
    textureSampleLevel(sourceTex, sourceSampler, uv + dir * -0.5, 0.0) +
    textureSampleLevel(sourceTex, sourceSampler, uv + dir * 0.5, 0.0)
  );
  let lumaB = luma(b);
  if (lumaB < lumaMin || lumaB > lumaMax) {
    return a;
  }
  return b;
}
`;

const DOWNSAMPLE_WGSL = /* wgsl */ `
${FULLSCREEN_WGSL}
@group(0) @binding(0) var sourceTex: texture_2d<f32>;

@fragment
fn fsDownsample(in: FullscreenVarying) -> @location(0) vec4f {
  let px = vec2i(in.position.xy) * 2;
  let sum = textureLoad(sourceTex, px, 0) +
    textureLoad(sourceTex, px + vec2i(1, 0), 0) +
    textureLoad(sourceTex, px + vec2i(0, 1), 0) +
    textureLoad(sourceTex, px + vec2i(1, 1), 0);
  return sum * 0.25;
}
`;

export async function createRenderer(canvas, options = {}) {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const adapter = await withTimeout(
    navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }),
    options.timeout ?? 2500,
    'No WebGPU adapter responded.',
  );
  if (!adapter) throw new Error('No WebGPU adapter was found.');
  const requiredLimits = {};
  for (const key of ['maxStorageBufferBindingSize', 'maxBufferSize']) {
    if (adapter.limits?.[key]) requiredLimits[key] = adapter.limits[key];
  }
  const device = await withTimeout(adapter.requestDevice({ requiredLimits }), options.timeout ?? 2500, 'No WebGPU device responded.');
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  device.lost.then((info) => options.onDeviceLost?.(info));

  const frameData = new Float32Array(FRAME_FLOATS);
  const frameBuffer = device.createBuffer({
    label: 'frame uniforms',
    size: FRAME_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const kernelBuffer = device.createBuffer({
    label: 'ao kernel',
    size: AO_KERNEL_SIZE * 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(kernelBuffer, 0, aoKernel(AO_KERNEL_SIZE));
  const pickBuffer = device.createBuffer({
    label: 'pick readback',
    size: 256 * (PICK_RADIUS * 2 + 1),
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  const geometryLayout = device.createBindGroupLayout({
    label: 'geometry',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const meshLayout = device.createBindGroupLayout({
    label: 'mesh params',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
  });
  const depthOnlyLayoutEntries = [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
  ];
  const ssaoLayout = device.createBindGroupLayout({
    label: 'ssao',
    entries: [
      ...depthOnlyLayoutEntries,
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const blurLayout = device.createBindGroupLayout({
    label: 'blur',
    entries: [...depthOnlyLayoutEntries, { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }],
  });
  const compositeLayout = device.createBindGroupLayout({
    label: 'composite',
    entries: [
      ...depthOnlyLayoutEntries,
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ],
  });
  const fxaaLayout = device.createBindGroupLayout({
    label: 'fxaa',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const downsampleLayout = device.createBindGroupLayout({
    label: 'downsample',
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }],
  });

  const geometryModule = device.createShaderModule({ label: 'geometry', code: GEOMETRY_WGSL });
  const ssaoModule = device.createShaderModule({ label: 'ssao', code: SSAO_WGSL });
  const blurModule = device.createShaderModule({ label: 'ao blur', code: BLUR_WGSL });
  const compositeModule = device.createShaderModule({ label: 'composite', code: COMPOSITE_WGSL });
  const fxaaModule = device.createShaderModule({ label: 'fxaa', code: FXAA_WGSL });
  const downsampleModule = device.createShaderModule({ label: 'downsample', code: DOWNSAMPLE_WGSL });

  const gbufferTargets = [
    { format: 'rgba16float' },
    { format: 'rgba8unorm' },
    { format: 'r32uint' },
  ];
  const opaqueDepth = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' };
  const geometryPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [geometryLayout] });
  const meshPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [geometryLayout, meshLayout] });
  const sphereBuffers = [{
    arrayStride: SPHERE_STRIDE,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' },
      { shaderLocation: 1, offset: 16, format: 'uint32' },
    ],
  }];
  const cylinderBuffers = [{
    arrayStride: CYLINDER_STRIDE,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x4' },
      { shaderLocation: 1, offset: 16, format: 'float32x3' },
      { shaderLocation: 2, offset: 28, format: 'uint32' },
      { shaderLocation: 3, offset: 32, format: 'uint32' },
      { shaderLocation: 4, offset: 36, format: 'uint32' },
      { shaderLocation: 5, offset: 40, format: 'unorm8x4' },
    ],
  }];
  const meshBuffers = [{
    arrayStride: MESH_VERTEX_STRIDE,
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 12, format: 'float32x3' },
      { shaderLocation: 2, offset: 24, format: 'uint32' },
      { shaderLocation: 3, offset: 28, format: 'unorm8x4' },
    ],
  }];

  const pipelines = {
    sphere: device.createRenderPipeline({
      label: 'spheres',
      layout: geometryPipelineLayout,
      vertex: { module: geometryModule, entryPoint: 'vsSphere', buffers: sphereBuffers },
      fragment: { module: geometryModule, entryPoint: 'fsSphere', targets: gbufferTargets },
      primitive: { topology: 'triangle-list' },
      depthStencil: opaqueDepth,
    }),
    cylinder: device.createRenderPipeline({
      label: 'cylinders',
      layout: geometryPipelineLayout,
      vertex: { module: geometryModule, entryPoint: 'vsCylinder', buffers: cylinderBuffers },
      fragment: { module: geometryModule, entryPoint: 'fsCylinder', targets: gbufferTargets },
      primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
      depthStencil: opaqueDepth,
    }),
    mesh: device.createRenderPipeline({
      label: 'meshes',
      layout: meshPipelineLayout,
      vertex: { module: geometryModule, entryPoint: 'vsMesh', buffers: meshBuffers },
      fragment: { module: geometryModule, entryPoint: 'fsMesh', targets: gbufferTargets },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: opaqueDepth,
    }),
    meshDepth: device.createRenderPipeline({
      label: 'transparent mesh depth',
      layout: meshPipelineLayout,
      vertex: { module: geometryModule, entryPoint: 'vsMesh', buffers: meshBuffers },
      fragment: { module: geometryModule, entryPoint: 'fsMeshDepth', targets: [{ format: 'rgba8unorm', writeMask: 0 }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    }),
    meshTransparent: device.createRenderPipeline({
      label: 'transparent mesh color',
      layout: meshPipelineLayout,
      vertex: { module: geometryModule, entryPoint: 'vsMesh', buffers: meshBuffers },
      fragment: {
        module: geometryModule,
        entryPoint: 'fsMeshTransparent',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
    }),
    glow: device.createRenderPipeline({
      label: 'glow',
      layout: geometryPipelineLayout,
      vertex: { module: geometryModule, entryPoint: 'vsGlow', buffers: sphereBuffers },
      fragment: {
        module: geometryModule,
        entryPoint: 'fsGlow',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
    }),
    ssao: fullscreenPipeline(device, 'ssao', ssaoLayout, ssaoModule, 'fsSSAO', 'r8unorm'),
    blur: fullscreenPipeline(device, 'ao blur', blurLayout, blurModule, 'fsBlur', 'r8unorm'),
    composite: fullscreenPipeline(device, 'composite', compositeLayout, compositeModule, 'fsComposite', 'rgba8unorm'),
    fxaaScreen: fullscreenPipeline(device, 'fxaa screen', fxaaLayout, fxaaModule, 'fsFXAA', format),
    fxaaExport: fullscreenPipeline(device, 'fxaa export', fxaaLayout, fxaaModule, 'fsFXAA', 'rgba8unorm'),
    downsample: fullscreenPipeline(device, 'downsample', downsampleLayout, downsampleModule, 'fsDownsample', 'rgba8unorm'),
  };

  const scene = {
    atomCapacity: 0,
    atomColors: null,
    atomFlags: null,
    geometryBindGroup: null,
    spheres: null,
    sphereCount: 0,
    cylinders: null,
    cylinderCount: 0,
    meshes: new Map(),
  };
  let screenTargets = null;
  let pickChain = Promise.resolve();

  function ensureAtomCapacity(count) {
    if (scene.atomCapacity >= count && scene.atomColors) return;
    const capacity = Math.max(64, Math.ceil(count * 1.25));
    scene.atomColors?.destroy();
    scene.atomFlags?.destroy();
    scene.atomColors = device.createBuffer({
      label: 'atom colors',
      size: capacity * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    scene.atomFlags = device.createBuffer({
      label: 'atom flags',
      size: capacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    scene.atomCapacity = capacity;
    scene.geometryBindGroup = device.createBindGroup({
      layout: geometryLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: { buffer: scene.atomColors } },
        { binding: 2, resource: { buffer: scene.atomFlags } },
      ],
    });
  }

  function setAtomData(colors, flags) {
    const count = flags.length;
    ensureAtomCapacity(count);
    if (count) {
      device.queue.writeBuffer(scene.atomColors, 0, colors, 0, count * 4);
      device.queue.writeBuffer(scene.atomFlags, 0, flags, 0, count);
    }
  }

  function updateAtomColors(colors) {
    ensureAtomCapacity(colors.length / 4);
    if (colors.length) device.queue.writeBuffer(scene.atomColors, 0, colors);
  }

  function updateAtomFlags(flags) {
    ensureAtomCapacity(flags.length);
    if (flags.length) device.queue.writeBuffer(scene.atomFlags, 0, flags);
  }

  function uploadVertexData(previous, data, label) {
    previous?.destroy();
    if (!data || !data.byteLength) return null;
    const buffer = device.createBuffer({ label, size: align4(data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  function setSpheres(data, count) {
    scene.spheres = uploadVertexData(scene.spheres, data, 'sphere instances');
    scene.sphereCount = scene.spheres ? count : 0;
  }

  function setCylinders(data, count) {
    scene.cylinders = uploadVertexData(scene.cylinders, data, 'cylinder instances');
    scene.cylinderCount = scene.cylinders ? count : 0;
  }

  function setMesh(id, mesh) {
    const previous = scene.meshes.get(id);
    if (previous) {
      previous.vertexBuffer?.destroy();
      previous.indexBuffer?.destroy();
      previous.paramsBuffer?.destroy();
      scene.meshes.delete(id);
    }
    if (!mesh || !mesh.indices?.length) return;
    const vertexBuffer = device.createBuffer({ label: `${id} vertices`, size: align4(mesh.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);
    const indexBuffer = device.createBuffer({ label: `${id} indices`, size: align4(mesh.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(indexBuffer, 0, mesh.indices);
    const paramsBuffer = device.createBuffer({ label: `${id} params`, size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const entry = {
      vertexBuffer,
      indexBuffer,
      paramsBuffer,
      indexCount: mesh.indices.length,
      opacity: mesh.opacity ?? 1,
      atomOffset: mesh.atomOffset ?? 0,
      bindGroup: device.createBindGroup({ layout: meshLayout, entries: [{ binding: 0, resource: { buffer: paramsBuffer } }] }),
    };
    writeMeshParams(entry);
    scene.meshes.set(id, entry);
  }

  function setMeshOpacity(id, opacity) {
    const entry = scene.meshes.get(id);
    if (!entry) return;
    entry.opacity = opacity;
    writeMeshParams(entry);
  }

  // Mesh vertices carry atom indices local to their structure; the offset places them in the
  // shared atom color/flag buffers when several structures are drawn together.
  function setMeshAtomOffset(id, atomOffset) {
    const entry = scene.meshes.get(id);
    if (!entry || entry.atomOffset === atomOffset) return;
    entry.atomOffset = atomOffset;
    writeMeshParams(entry);
  }

  function writeMeshParams(entry) {
    const params = new ArrayBuffer(16);
    new Float32Array(params, 0, 1)[0] = entry.opacity;
    new Uint32Array(params, 8, 1)[0] = entry.atomOffset >>> 0;
    device.queue.writeBuffer(entry.paramsBuffer, 0, params);
  }

  function meshIds() {
    return [...scene.meshes.keys()];
  }

  function createTargets(width, height, exportTarget = false) {
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const targets = {
      width,
      height,
      color: device.createTexture({ label: 'gbuffer color', size: [width, height], format: 'rgba16float', usage }),
      normal: device.createTexture({ label: 'gbuffer normal', size: [width, height], format: 'rgba8unorm', usage }),
      id: device.createTexture({ label: 'gbuffer id', size: [width, height], format: 'r32uint', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }),
      depth: device.createTexture({ label: 'depth', size: [width, height], format: 'depth32float', usage }),
      ao: device.createTexture({ label: 'ao', size: [width, height], format: 'r8unorm', usage }),
      aoBlur: device.createTexture({ label: 'ao blurred', size: [width, height], format: 'r8unorm', usage }),
      composite: device.createTexture({ label: 'composite', size: [width, height], format: 'rgba8unorm', usage }),
    };
    targets.views = Object.fromEntries(Object.entries(targets)
      .filter(([, value]) => value instanceof GPUTexture)
      .map(([key, texture]) => [key, texture.createView()]));
    targets.ssaoBindGroup = device.createBindGroup({
      layout: ssaoLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: targets.views.depth },
        { binding: 2, resource: targets.views.normal },
        { binding: 3, resource: { buffer: kernelBuffer } },
      ],
    });
    targets.blurBindGroup = device.createBindGroup({
      layout: blurLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: targets.views.depth },
        { binding: 2, resource: targets.views.ao },
      ],
    });
    targets.compositeBindGroup = device.createBindGroup({
      layout: compositeLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: targets.views.depth },
        { binding: 2, resource: targets.views.color },
        { binding: 3, resource: targets.views.aoBlur },
      ],
    });
    targets.fxaaBindGroup = device.createBindGroup({
      layout: fxaaLayout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: targets.views.composite },
        { binding: 2, resource: linearSampler },
      ],
    });
    if (exportTarget) {
      targets.downsampleBindGroup = device.createBindGroup({
        layout: downsampleLayout,
        entries: [{ binding: 0, resource: targets.views.composite }],
      });
    }
    return targets;
  }

  function destroyTargets(targets) {
    if (!targets) return;
    for (const value of Object.values(targets)) {
      if (value instanceof GPUTexture) value.destroy();
    }
  }

  function ensureScreenTargets() {
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    if (screenTargets && screenTargets.width === width && screenTargets.height === height) return screenTargets;
    destroyTargets(screenTargets);
    screenTargets = createTargets(width, height);
    return screenTargets;
  }

  function writeFrame(view, settings, width, height) {
    const data = frameData;
    data.fill(0);
    data.set(view.viewProj, 0);
    data.set(view.view, 16);
    data.set(view.proj, 32);
    data.set(view.invProj, 48);
    data.set([...view.eye, view.orthographic ? 1 : 0], 64);
    data.set([...view.right, 0], 68);
    data.set([...view.up, 0], 72);
    data.set([...view.forward, 0], 76);
    data.set([width, height, 1 / width, 1 / height], 80);
    const clip = settings.clip ?? {};
    data.set([clip.near ?? 0, clip.far ?? 0, clip.nearEnabled ? 1 : 0, clip.farEnabled ? 1 : 0], 84);
    data.set([...(settings.lightDirection ?? view.forward.map((value) => -value)), 0], 88);
    const material = settings.material ?? {};
    data.set([material.ambient ?? 0.4, material.diffuse ?? 0.62, material.specular ?? 0.22, material.shininess ?? 36], 92);
    data.set([...(settings.highlightColor ?? [0.35, 1.0, 0.55]), settings.highlightStrength ?? 0.55], 96);
    data.set([...(settings.hoverColor ?? [1.0, 0.95, 0.55]), settings.hoverStrength ?? 0.35], 100);
    data.set([settings.time ?? 0, settings.glow ?? 0, settings.flat ? 1 : 0, settings.dashPeriod ?? 0.42], 104);
    const fog = settings.fog ?? {};
    data.set([fog.start ?? 0, fog.end ?? 1, fog.strength ?? 0, settings.pixelRatio ?? 1], 108);
    const background = settings.background ?? { top: [0, 0, 0], bottom: [0, 0, 0], alpha: 1 };
    data.set([...background.top, background.alpha ?? 1], 112);
    data.set([...background.bottom, background.alpha ?? 1], 116);
    const ao = settings.ao ?? {};
    const outline = settings.outline ?? {};
    data.set([
      ao.enabled ? ao.strength ?? 0.8 : 0,
      ao.radius ?? 4,
      outline.enabled ? outline.strength ?? 0.8 : 0,
      outline.width ?? 1,
    ], 120);
    data.set([ao.bias ?? 0.08, outline.threshold ?? 1.2, settings.fxaa === false ? 0 : 1, 0], 124);
    device.queue.writeBuffer(frameBuffer, 0, data);
  }

  function encodeScene(encoder, targets, settings) {
    const geometryPass = encoder.beginRenderPass({
      label: 'geometry',
      colorAttachments: [
        { view: targets.views.color, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: targets.views.normal, clearValue: { r: 0.5, g: 0.5, b: 1, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: targets.views.id, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
      depthStencilAttachment: { view: targets.views.depth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    if (scene.geometryBindGroup) {
      geometryPass.setBindGroup(0, scene.geometryBindGroup);
      const opaqueMeshes = [...scene.meshes.values()].filter((mesh) => mesh.opacity >= 0.999);
      if (opaqueMeshes.length) {
        geometryPass.setPipeline(pipelines.mesh);
        for (const mesh of opaqueMeshes) drawMesh(geometryPass, mesh);
      }
      if (scene.cylinderCount) {
        geometryPass.setPipeline(pipelines.cylinder);
        geometryPass.setVertexBuffer(0, scene.cylinders);
        geometryPass.draw(36, scene.cylinderCount);
      }
      if (scene.sphereCount) {
        geometryPass.setPipeline(pipelines.sphere);
        geometryPass.setVertexBuffer(0, scene.spheres);
        geometryPass.draw(6, scene.sphereCount);
      }
    }
    geometryPass.end();

    if (settings.ao?.enabled) {
      fullscreenPass(encoder, 'ssao', targets.views.ao, pipelines.ssao, targets.ssaoBindGroup);
      fullscreenPass(encoder, 'ao blur', targets.views.aoBlur, pipelines.blur, targets.blurBindGroup);
    }
    fullscreenPass(encoder, 'composite', targets.views.composite, pipelines.composite, targets.compositeBindGroup);

    const transparentMeshes = [...scene.meshes.values()].filter((mesh) => mesh.opacity < 0.999);
    const glow = (settings.glow ?? 0) > 0.001 && scene.sphereCount > 0;
    if ((transparentMeshes.length || glow) && scene.geometryBindGroup) {
      const overlayPass = encoder.beginRenderPass({
        label: 'overlay',
        colorAttachments: [{ view: targets.views.composite, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: targets.views.depth, depthLoadOp: 'load', depthStoreOp: 'store' },
      });
      overlayPass.setBindGroup(0, scene.geometryBindGroup);
      if (transparentMeshes.length) {
        overlayPass.setPipeline(pipelines.meshDepth);
        for (const mesh of transparentMeshes) drawMesh(overlayPass, mesh);
        overlayPass.setPipeline(pipelines.meshTransparent);
        for (const mesh of transparentMeshes) drawMesh(overlayPass, mesh);
      }
      if (glow) {
        overlayPass.setPipeline(pipelines.glow);
        overlayPass.setVertexBuffer(0, scene.spheres);
        overlayPass.draw(6, scene.sphereCount);
      }
      overlayPass.end();
    }
  }

  function drawMesh(pass, mesh) {
    pass.setBindGroup(1, mesh.bindGroup);
    pass.setVertexBuffer(0, mesh.vertexBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, 'uint32');
    pass.drawIndexed(mesh.indexCount);
  }

  function fullscreenPass(encoder, label, view, pipeline, bindGroup) {
    const pass = encoder.beginRenderPass({
      label,
      colorAttachments: [{ view, clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  function render(view, settings) {
    const targets = ensureScreenTargets();
    writeFrame(view, settings, targets.width, targets.height);
    const encoder = device.createCommandEncoder({ label: 'frame' });
    encodeScene(encoder, targets, settings);
    fullscreenPass(encoder, 'present', context.getCurrentTexture().createView(), pipelines.fxaaScreen, targets.fxaaBindGroup);
    device.queue.submit([encoder.finish()]);
  }

  // Reads a small window of the ID buffer and returns the hit nearest the cursor, so thin
  // bonds and small atoms remain easy to click.
  function pick(x, y, radius = PICK_RADIUS) {
    const run = async () => {
      const targets = screenTargets;
      if (!targets) return -1;
      const px = Math.floor(x);
      const py = Math.floor(y);
      if (px < 0 || py < 0 || px >= targets.width || py >= targets.height) return -1;
      const x0 = Math.max(0, px - radius);
      const y0 = Math.max(0, py - radius);
      const width = Math.min(targets.width, px + radius + 1) - x0;
      const height = Math.min(targets.height, py + radius + 1) - y0;
      const encoder = device.createCommandEncoder({ label: 'pick' });
      encoder.copyTextureToBuffer(
        { texture: targets.id, origin: { x: x0, y: y0 } },
        { buffer: pickBuffer, bytesPerRow: 256 },
        { width, height },
      );
      device.queue.submit([encoder.finish()]);
      await pickBuffer.mapAsync(GPUMapMode.READ);
      const values = new Uint32Array(pickBuffer.getMappedRange());
      let best = 0;
      let bestDistance = Infinity;
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const value = values[row * 64 + column];
          if (!value) continue;
          const dx = x0 + column - px;
          const dy = y0 + row - py;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = value;
          }
        }
      }
      pickBuffer.unmap();
      return best > 0 ? best - 1 : -1;
    };
    const result = pickChain.then(run, run);
    pickChain = result.catch(() => -1);
    return result;
  }

  async function capture(view, settings, width, height, supersample = 2) {
    const maxDimension = device.limits.maxTextureDimension2D;
    const factor = width * supersample <= maxDimension && height * supersample <= maxDimension ? supersample : 1;
    const renderWidth = width * factor;
    const renderHeight = height * factor;
    const targets = createTargets(renderWidth, renderHeight, true);
    const output = device.createTexture({
      label: 'capture output',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const readback = device.createBuffer({ label: 'capture readback', size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    try {
      const captureSettings = {
        ...settings,
        fxaa: factor === 1,
        outline: settings.outline ? { ...settings.outline, width: (settings.outline.width ?? 1) * factor } : settings.outline,
      };
      writeFrame(view, captureSettings, renderWidth, renderHeight);
      const encoder = device.createCommandEncoder({ label: 'capture' });
      encodeScene(encoder, targets, captureSettings);
      if (factor > 1) {
        fullscreenPass(encoder, 'downsample', output.createView(), pipelines.downsample, targets.downsampleBindGroup);
      } else {
        fullscreenPass(encoder, 'capture fxaa', output.createView(), pipelines.fxaaExport, targets.fxaaBindGroup);
      }
      encoder.copyTextureToBuffer({ texture: output }, { buffer: readback, bytesPerRow }, { width, height });
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const source = new Uint8Array(readback.getMappedRange());
      const pixels = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const from = row * bytesPerRow + column * 4;
          const to = (row * width + column) * 4;
          const alpha = source[from + 3];
          const scaleAlpha = alpha > 0 ? 255 / alpha : 0;
          pixels[to] = Math.min(255, source[from] * scaleAlpha);
          pixels[to + 1] = Math.min(255, source[from + 1] * scaleAlpha);
          pixels[to + 2] = Math.min(255, source[from + 2] * scaleAlpha);
          pixels[to + 3] = alpha;
        }
      }
      readback.unmap();
      return { width, height, data: pixels };
    } finally {
      readback.destroy();
      output.destroy();
      destroyTargets(targets);
    }
  }

  return {
    kind: 'webgpu',
    label: adapter.info?.description || adapter.info?.vendor || 'WebGPU',
    device,
    maxTextureDimension: device.limits.maxTextureDimension2D,
    setAtomData,
    updateAtomColors,
    updateAtomFlags,
    setSpheres,
    setCylinders,
    setMesh,
    setMeshOpacity,
    setMeshAtomOffset,
    meshIds,
    render,
    pick,
    capture,
  };
}

function fullscreenPipeline(device, label, bindGroupLayout, module, entryPoint, format) {
  return device.createRenderPipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    vertex: { module, entryPoint: 'vsFullscreen' },
    fragment: { module, entryPoint, targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
}

function aoKernel(size) {
  const data = new Float32Array(size * 4);
  let seed = 1234567;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < size; index += 1) {
    const u = random();
    const v = random();
    const theta = 2 * Math.PI * u;
    const z = 0.15 + 0.85 * v;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    let scaleFactor = (index + 1) / size;
    scaleFactor = 0.2 + 0.8 * scaleFactor * scaleFactor;
    data[index * 4] = r * Math.cos(theta) * scaleFactor;
    data[index * 4 + 1] = r * Math.sin(theta) * scaleFactor;
    data[index * 4 + 2] = z * scaleFactor;
  }
  return data;
}

function align4(size) {
  return Math.max(16, Math.ceil(size / 4) * 4);
}

export function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export function packColor(color, alpha = 1) {
  const r = Math.round(Math.min(1, Math.max(0, color[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, color[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, color[2])) * 255);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

export function createInstanceWriter(stride, capacity) {
  let buffer = new ArrayBuffer(Math.max(1, capacity) * stride);
  let floats = new Float32Array(buffer);
  let uints = new Uint32Array(buffer);
  let count = 0;
  const words = stride / 4;
  return {
    get count() {
      return count;
    },
    next() {
      if ((count + 1) * stride > buffer.byteLength) {
        const grown = new ArrayBuffer(buffer.byteLength * 2);
        new Uint8Array(grown).set(new Uint8Array(buffer));
        buffer = grown;
        floats = new Float32Array(buffer);
        uints = new Uint32Array(buffer);
      }
      const offset = count * words;
      count += 1;
      return offset;
    },
    get floats() {
      return floats;
    },
    get uints() {
      return uints;
    },
    finish() {
      return buffer.slice(0, count * stride);
    },
  };
}
