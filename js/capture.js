/*
 * Intraoral Scanner Challenge — scanner visibility.
 *
 * The virtual scanner looks into the screen through the point under the finger: its axis is the
 * camera ray, and its window sits WORK_DIST millimetres in front of the first crown the ray hits.
 * A surface point is captured only when it is
 *   - inside the capture cone (FIELD_RADIUS wide at the working distance) and the depth range,
 *   - facing the scanner within ANGLE_TOL,
 *   - not seen from below the gum line (arch scans), and
 *   - not hidden: a ray from the point to the scanner window must not hit another crown.
 * Rays are tested against a coarse copy of each crown (`tooth.proxy`) with a bounding-sphere
 * pre-check, so only the few crowns near the scanner cost anything.
 */
(function () {
  'use strict';

  const ISC = (window.ISC = window.ISC || {});

  // Tunable capture parameters (millimetres / degrees).
  const CONFIG = {
    WORK_DIST: 10,        // scanner window to the aimed surface
    FIELD_RADIUS: 8,      // capture radius at the working distance (generous: easy for first-time players)
    DEPTH_MIN: 2,         // nearest capturable distance from the window
    DEPTH_MAX: 21,        // farthest capturable distance (depth of field)
    ANGLE_TOL: 63,        // max angle between surface normal and the direction to the scanner
    PROXIMAL_ANGLE_TOL: 50, // stricter for mesial/distal faces: they need a deliberate oblique view,
                            // so a labial or lingual pass does not complete them through the embrasure
    MIN_ELEV: -0.05,      // arch scans: the scanner cannot look up from below the gum line
    AIM_TOLERANCE: 1.0    // share of the field radius in which a near miss still finds a tooth
  };
  const isProximal = (p) => p.face.key === 'mesial' || p.face.key === 'distal';
  // Cosine of the largest capture angle for this point's surface (margin in degrees, e.g. for hints).
  const cosTolFor = (p, margin) => Math.cos((((isProximal(p) ? CONFIG.PROXIMAL_ANGLE_TOL : CONFIG.ANGLE_TOL) - (margin || 0)) * Math.PI) / 180);
  const EPS = 1e-7;
  const NO_HIT = 1e9;
  const SIGHT = 200; // mm: "out of the arch" for line-of-sight tests

  // Möller–Trumbore ray / triangle intersection; returns the ray distance or -1.
  function rayTri(T, i, ox, oy, oz, dx, dy, dz) {
    const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2];
    const e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) return -1;
    const inv = 1 / det;
    const sx = ox - T[i], sy = oy - T[i + 1], sz = oz - T[i + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  /*
   * Occluder: a crown proxy placed in the scene. Instances are the identity or the mirrored
   * upper arch of the bite view: world = (x + tx, s * y + ty, z + tz).
   */
  function occluder(t, M) {
    const s = M ? M[5] : 1, tx = M ? M[12] : 0, ty = M ? M[13] : 0, tz = M ? M[14] : 0;
    const p = t.proxy;
    return { tooth: t, tris: p.tris, cx: p.cx, cy: p.cy, cz: p.cz, r: p.r, s, tx, ty, tz,
      wx: p.cx + tx, wy: s * p.cy + ty, wz: p.cz + tz };
  }

  // Nearest crown hit along a ray (any = true: stop at the first hit before maxT).
  function cast(occs, ox, oy, oz, dx, dy, dz, maxT, skip, any) {
    let best = maxT;
    for (let k = 0; k < occs.length; k++) {
      const o = occs[k];
      if (o.tooth === skip) continue;
      const mox = ox - o.tx, moy = (oy - o.ty) * o.s, moz = oz - o.tz, mdy = dy * o.s;
      const lx = o.cx - mox, ly = o.cy - moy, lz = o.cz - moz;
      const tca = lx * dx + ly * mdy + lz * dz;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      if (d2 > o.r * o.r) continue;
      const thc = Math.sqrt(o.r * o.r - d2);
      if (tca + thc < 0 || tca - thc > best) continue;
      const T = o.tris;
      for (let i = 0; i < T.length; i += 9) {
        const t = rayTri(T, i, mox, moy, moz, dx, mdy, dz);
        if (t > 0.05 && t < best) {
          if (any) return t;
          best = t;
        }
      }
    }
    return best < maxT ? best : NO_HIT;
  }

  const firstHit = (occs, o, d) => cast(occs, o[0], o[1], o[2], d[0], d[1], d[2], NO_HIT, null, false);
  const blocked = (occs, ox, oy, oz, dx, dy, dz, maxT, skip) => cast(occs, ox, oy, oz, dx, dy, dz, maxT, skip, true) < NO_HIT;

  // Directions a scanner could plausibly look from at a point: the normal and two cones around it.
  function directionsAround(nx, ny, nz) {
    const dirs = [[nx, ny, nz]];
    let ax = Math.abs(ny) < 0.9 ? 0 : 1, ay = Math.abs(ny) < 0.9 ? 1 : 0;
    // tangent basis
    let t1x = ay * nz, t1y = -ax * nz, t1z = ax * ny - ay * nx;
    const l1 = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= l1; t1y /= l1; t1z /= l1;
    const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
    [30, 52].forEach((deg) => {
      const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      for (let k = 0; k < 8; k++) {
        const b = (k / 8) * Math.PI * 2, cb = Math.cos(b) * sa, sb = Math.sin(b) * sa;
        dirs.push([nx * ca + t1x * cb + t2x * sb, ny * ca + t1y * cb + t2y * sb, nz * ca + t1z * cb + t2z * sb]);
      }
    });
    return dirs;
  }

  // Marks points no scanner position can see (e.g. tight contact areas) as not required. A point
  // counts only if some plausible direction has a clear line of sight all the way out of the arch
  // (so the player can also see and aim at it); that direction is kept for the guided view.
  function computeReach(points, occs, minElev) {
    points.forEach((p) => {
      p.reachDir = null;
      p.reachable = directionsAround(p.wnx, p.wny, p.wnz).some((d) => {
        if (minElev !== null && d[1] < Math.max(minElev, 0.02)) return false;
        if (p.wnx * d[0] + p.wny * d[1] + p.wnz * d[2] < cosTolFor(p, 2)) return false; // must be a capturable angle
        if (blocked(occs, p.wx + p.wnx * 0.25, p.wy + p.wny * 0.25, p.wz + p.wnz * 0.25, d[0], d[1], d[2], SIGHT, p.tooth)) return false;
        p.reachDir = d;
        return true;
      });
    });
  }

  function setWorld(p, M) {
    const s = M ? M[5] : 1, ty = M ? M[13] : 0, tz = M ? M[14] : 0;
    p.wx = p.x; p.wy = s * p.y + ty; p.wz = p.z + tz;
    p.wnx = p.nx; p.wny = s * p.ny; p.wnz = p.nz;
  }

  // Required surfaces: a face needs at least this many reachable points to be a capture target.
  const MIN_FACE_POINTS = 3;

  function finishFace(face) {
    face.req = face.points.filter((p) => p.reachable);
    face.required = face.req.length >= MIN_FACE_POINTS;
    face.total = face.required ? face.req.length : 0;
    face.points.forEach((p) => { p.required = face.required && p.reachable; });
  }

  // One-time preparation of a dentition (both arches + bite): world coordinates, occluders,
  // reachability and the required points of every surface.
  function prepare(dm) {
    if (dm.prepared) return;
    const M = dm.biteMatrix;
    ['upper', 'lower'].forEach((a) => {
      const m = dm[a];
      m.teeth.forEach((t) => {
        t.occA = occluder(t, null);
        t.occB = occluder(t, a === 'upper' ? M : null);
        t.points.forEach((p) => setWorld(p, null));
        t.bitePoints.forEach((p) => setWorld(p, a === 'upper' ? M : null));
      });
      const occs = m.teeth.map((t) => t.occA);
      computeReach(m.points, occs, CONFIG.MIN_ELEV);
      m.teeth.forEach((t) => ISC.FACE_KEYS.forEach((k) => finishFace(t.faces[k])));
    });
    const biteOccs = dm.upper.teeth.concat(dm.lower.teeth).map((t) => t.occB);
    computeReach(dm.upper.bitePoints.concat(dm.lower.bitePoints), biteOccs, null);
    dm.upper.teeth.concat(dm.lower.teeth).forEach((t) => finishFace(t.biteFace));
    dm.prepared = true;
  }

  /*
   * Evaluates the scanner for one frame.
   *   teeth     candidate crowns (present teeth of the stage)
   *   occs      occluders of the stage (same crowns)
   *   o, d      camera ray through the finger (world)
   *   pointsOf  tooth -> scan points of the current step
   *   centerOf  tooth -> world centre of the crown in this step
   *   minElev   lowest allowed vertical component of the view direction (null = any)
   * Returns { state, hitT, scanner, visible: [{ p, weight, cosA }], inCone }.
   * state: 'out' (nothing to aim at), 'blocked' (surfaces in the field are hidden or turned
   * away), 'ok' (at least one visible surface point).
   */
  function evaluate(teeth, occs, o, d, pointsOf, centerOf, minElev) {
    const cfg = CONFIG;
    let hitT = firstHit(occs, o, d);
    if (hitT >= NO_HIT) {
      // Near miss (gum, gap between teeth): aim at the closest surface point near the axis.
      let best = cfg.FIELD_RADIUS * cfg.AIM_TOLERANCE;
      teeth.forEach((t) => pointsOf(t).forEach((p) => {
        const wx = p.wx - o[0], wy = p.wy - o[1], wz = p.wz - o[2];
        const along = wx * d[0] + wy * d[1] + wz * d[2];
        if (along <= 0) return;
        const perp = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - along * along));
        if (perp < best && p.wnx * d[0] + p.wny * d[1] + p.wnz * d[2] < 0) { best = perp; hitT = along; }
      }));
    }
    const res = { state: 'out', hitT, scanner: null, visible: [], inCone: 0 };
    if (hitT >= NO_HIT) return res;

    const sx = o[0] + d[0] * (hitT - cfg.WORK_DIST);
    const sy = o[1] + d[1] * (hitT - cfg.WORK_DIST);
    const sz = o[2] + d[2] * (hitT - cfg.WORK_DIST);
    res.scanner = [sx, sy, sz];
    const tanFov = cfg.FIELD_RADIUS / cfg.WORK_DIST;
    const rCap = cfg.FIELD_RADIUS * 1.35;

    for (let k = 0; k < teeth.length; k++) {
      const t = teeth[k], c = centerOf(t);
      const cx = c[0] - sx, cy = c[1] - sy, cz = c[2] - sz;
      const ca = cx * d[0] + cy * d[1] + cz * d[2];
      const cp = Math.sqrt(Math.max(0, cx * cx + cy * cy + cz * cz - ca * ca));
      const tr = t.proxy.r;
      if (ca < cfg.DEPTH_MIN - tr || ca > cfg.DEPTH_MAX + tr || cp > rCap + tr) continue;
      const pts = pointsOf(t);
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j];
        const wx = p.wx - sx, wy = p.wy - sy, wz = p.wz - sz;
        const along = wx * d[0] + wy * d[1] + wz * d[2];
        if (along < cfg.DEPTH_MIN || along > cfg.DEPTH_MAX) continue;
        const dist = Math.sqrt(wx * wx + wy * wy + wz * wz);
        const radial = Math.sqrt(Math.max(0, dist * dist - along * along));
        const rMax = Math.min(rCap, along * tanFov);
        if (radial > rMax) continue;
        res.inCone++;
        const vx = -wx / dist, vy = -wy / dist, vz = -wz / dist; // point -> scanner
        const cosA = p.wnx * vx + p.wny * vy + p.wnz * vz;
        if (cosA < cosTolFor(p)) continue;
        if (minElev !== null && vy < minElev) continue;
        if (blocked(occs, p.wx + p.wnx * 0.25, p.wy + p.wny * 0.25, p.wz + p.wnz * 0.25, vx, vy, vz, dist - 0.3, t)) continue;
        const rr = radial / rMax;
        res.visible.push({ p, weight: (1 - 0.5 * rr * rr), cosA });
      }
    }
    res.state = res.visible.length ? 'ok' : res.inCone ? 'blocked' : 'out';
    return res;
  }

  ISC.Capture = { CONFIG, SIGHT, cosTolFor, prepare, evaluate, firstHit, blocked, occluder, directionsAround };
})();
