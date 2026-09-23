import {
  add,
  cross,
  dot,
  lerpVec,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4Orthographic,
  mat4Perspective,
  normalize,
  quatFromAxisAngle,
  quatFromBasis,
  quatMultiply,
  quatNormalize,
  quatRotate,
  quatSlerp,
  scale,
  sub,
  symmetricEigen3,
} from './math3d.js';

export function createCamera() {
  return {
    target: [0, 0, 0],
    distance: 80,
    rotation: [0, 0, 0, 1],
    fov: Math.PI / 4.2,
    orthographic: false,
    near: 0.1,
    far: 2000,
    offset: [0, 0],
    sceneRadius: 40,
  };
}

export function cloneCamera(camera) {
  return {
    ...camera,
    target: [...camera.target],
    rotation: [...camera.rotation],
    offset: [...camera.offset],
  };
}

export function cameraBasis(camera) {
  const right = quatRotate(camera.rotation, [1, 0, 0]);
  const up = quatRotate(camera.rotation, [0, 1, 0]);
  const back = quatRotate(camera.rotation, [0, 0, 1]);
  const eye = add(camera.target, scale(back, camera.distance));
  return { eye, right, up, forward: scale(back, -1) };
}

export function updateClipRange(camera) {
  const radius = Math.max(1, camera.sceneRadius);
  const span = camera.distance + radius * 2.5;
  camera.far = Math.max(50, span);
  camera.near = Math.max(0.05, Math.min(camera.distance - radius * 1.5, camera.distance * 0.5), span / 20000);
}

export function cameraMatrices(camera, aspect) {
  updateClipRange(camera);
  const basis = cameraBasis(camera);
  const view = mat4LookAt(basis.eye, camera.target, basis.up);
  const proj = camera.orthographic
    ? mat4Orthographic(
      orthoHalfHeight(camera) * aspect,
      orthoHalfHeight(camera),
      camera.near,
      camera.far,
      camera.offset[0],
      camera.offset[1],
    )
    : mat4Perspective(camera.fov, aspect, camera.near, camera.far, camera.offset[0], camera.offset[1]);
  const viewProj = mat4Multiply(proj, view);
  return { ...basis, view, proj, viewProj, invProj: mat4Invert(proj) };
}

export function orthoHalfHeight(camera) {
  return camera.distance * Math.tan(camera.fov / 2);
}

export function orbitCamera(camera, dx, dy, speed = 0.006) {
  const basis = cameraBasis(camera);
  const yaw = quatFromAxisAngle(basis.up, -dx * speed);
  const pitch = quatFromAxisAngle(basis.right, -dy * speed);
  camera.rotation = quatNormalize(quatMultiply(yaw, quatMultiply(pitch, camera.rotation)));
}

export function rollCamera(camera, angle) {
  const basis = cameraBasis(camera);
  camera.rotation = quatNormalize(quatMultiply(quatFromAxisAngle(basis.forward, angle), camera.rotation));
}

export function spinCamera(camera, angle) {
  const basis = cameraBasis(camera);
  camera.rotation = quatNormalize(quatMultiply(quatFromAxisAngle(basis.up, angle), camera.rotation));
}

export function panCamera(camera, dx, dy, viewportHeight) {
  const basis = cameraBasis(camera);
  const worldPerPixel = (2 * orthoHalfHeight(camera)) / Math.max(1, viewportHeight);
  camera.target = add(camera.target, add(scale(basis.right, -dx * worldPerPixel), scale(basis.up, dy * worldPerPixel)));
}

export function zoomCamera(camera, factor) {
  camera.distance = Math.min(Math.max(camera.distance * factor, 1.2), Math.max(4000, camera.sceneRadius * 40));
}

export function lookFrom(camera, direction, up = [0, 1, 0]) {
  const back = normalize(scale(direction, -1));
  let right = normalize(cross(up, back));
  if (dot(right, right) < 0.5) right = normalize(cross([1, 0, 0], back));
  const trueUp = cross(back, right);
  camera.rotation = quatFromBasis(right, trueUp, back);
}

export function principalAxes(points) {
  const count = points.length / 3;
  if (count < 3) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let index = 0; index < points.length; index += 3) {
    cx += points[index];
    cy += points[index + 1];
    cz += points[index + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (let index = 0; index < points.length; index += 3) {
    const x = points[index] - cx;
    const y = points[index + 1] - cy;
    const z = points[index + 2] - cz;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  const { vectors } = symmetricEigen3([[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]]);
  const right = normalize(vectors[0]);
  let up = normalize(vectors[1]);
  let back = normalize(cross(right, up));
  if (dot(back, back) < 0.5) return null;
  up = normalize(cross(back, right));
  return { center: [cx, cy, cz], right, up, back };
}

// Fits the camera so the given points fill the unobstructed viewport. Orientation uses the
// principal axes (longest axis horizontal) unless keepRotation is set.
export function fitCameraToPoints(camera, points, viewport, options = {}) {
  const count = points.length / 3;
  if (!count) return;
  const axes = options.keepRotation ? null : principalAxes(points);
  if (axes) {
    const portrait = viewport.height > viewport.width * 1.15;
    camera.rotation = portrait
      ? quatFromBasis(axes.up, axes.right, scale(axes.back, -1))
      : quatFromBasis(axes.right, axes.up, axes.back);
  }
  const basis = cameraBasis(camera);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < points.length; index += 3) {
    const p = [points[index], points[index + 1], points[index + 2]];
    const x = dot(p, basis.right);
    const y = dot(p, basis.up);
    const z = dot(p, basis.forward);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const padding = options.padding ?? 1.5;
  const halfX = (maxX - minX) / 2 + padding;
  const halfY = (maxY - minY) / 2 + padding;
  const halfZ = (maxZ - minZ) / 2 + padding;
  const center = add(
    add(scale(basis.right, (minX + maxX) / 2), scale(basis.up, (minY + maxY) / 2)),
    scale(basis.forward, (minZ + maxZ) / 2),
  );
  const aspect = Math.max(0.2, viewport.width / Math.max(1, viewport.height));
  const fraction = options.fraction ?? 0.9;
  const tanHalf = Math.tan(camera.fov / 2);
  const needY = Math.max(halfY, halfX / aspect) / fraction;
  camera.target = center;
  camera.distance = Math.max(needY / tanHalf + halfZ, 4);
  camera.sceneRadius = Math.max(options.sceneRadius ?? 0, Math.hypot(halfX, halfY, halfZ));
}

export function interpolateCamera(from, to, t) {
  const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return {
    ...to,
    target: lerpVec(from.target, to.target, eased),
    distance: from.distance + (to.distance - from.distance) * eased,
    rotation: quatSlerp(from.rotation, to.rotation, eased),
    offset: [
      from.offset[0] + (to.offset[0] - from.offset[0]) * eased,
      from.offset[1] + (to.offset[1] - from.offset[1]) * eased,
    ],
  };
}

export function projectToScreen(matrices, point, width, height) {
  const m = matrices.viewProj;
  const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
  const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
  if (w <= 0.00001) return null;
  return {
    x: (x / w * 0.5 + 0.5) * width,
    y: (1 - (y / w * 0.5 + 0.5)) * height,
    depth: dot(sub(point, matrices.eye), matrices.forward),
  };
}

export function screenRay(matrices, camera, ndcX, ndcY) {
  const inv = mat4Invert(matrices.viewProj);
  const near = unproject(inv, ndcX, ndcY, 0);
  const far = unproject(inv, ndcX, ndcY, 1);
  return { origin: near, direction: normalize(sub(far, near)) };
}

function unproject(inv, x, y, z) {
  const px = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
  const py = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
  const pz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
  const pw = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
  return [px / pw, py / pw, pz / pw];
}
