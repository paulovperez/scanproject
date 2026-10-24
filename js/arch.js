/*
 * Intraoral Scanner Challenge — dental arch geometry (adult and pediatric), 3D crown meshes,
 * per-surface scan points, occlusion proxies, and the 2D illustration used on the start screen.
 * All geometry is in millimetres. 2D plane: x to the patient's left, y towards the back.
 * 3D: X = x, Y = height (crowns point up), Z = -y (front of the mouth towards +Z).
 * Tooth-local frame: u along the arch (positive = distal), v towards the cheek/lip, h height.
 */
(function () {
  'use strict';

  const ISC = (window.ISC = window.ISC || {});

  const GUM_WIDTH = 15;       // mm, 2D illustration only
  const MAX_DPR = 2;
  const RING = 28;            // vertices around each crown ring
  const TAU = Math.PI * 2;
  const SAMPLE_SPACING = 1.25; // mm between scan points on one surface
  const PROXIMAL_SPACING = 0.85; // mm between scan points on mesial and distal surfaces
  const BITE_SPACING = 1.7;    // mm between bite-registration points
  const GUM_LINE = 1.3;        // mm: crown surface above this height is exposed (scannable)

  /*
   * Dentitions. Widths are mesiodistal, depths buccolingual, heights the visible crown (mm),
   * from the central incisor backwards. `turn` is how far the arch curves from the midline to
   * the last tooth (radians) and `spread` how concentrated that turn is at the front: a wide,
   * rounded U with posterior segments that open slightly, instead of a narrow V.
   */
  const DENTITIONS = {
    adult: {
      fill: 0.975,              // tooth share of its slot (rest = contact gap): adult teeth touch
      posteriorFrom: 3,         // premolars and molars
      anchor: 5, anchorShift: 2.0, // first molars: upper sits half a cusp distal (Class I)
      regionKeys: ['rm', 'rpm', 'ant', 'lpm', 'lm'],
      regionOfPos: [2, 2, 2, 1, 1, 0, 0], // for the screen-left side (patient's right)
      quadrants: { upper: [1, 2], lower: [4, 3] },
      names: ['central', 'lateral', 'canine', 'pm1', 'pm2', 'm1', 'm2'],
      primary: false,
      arches: {
        upper: {
          widths: [8.6, 6.6, 7.6, 7.1, 6.7, 10.3, 9.5],
          depths: [7.1, 6.2, 8.1, 9.2, 9.2, 11.3, 11.0],
          heights: [8.6, 7.6, 8.8, 6.2, 5.8, 5.4, 5.0],
          kinds: ['incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar'],
          turn: 1.38, spread: 27, tilt: 1
        },
        lower: {
          widths: [5.4, 5.9, 6.9, 7.0, 7.2, 11.0, 10.5],
          depths: [6.0, 6.3, 7.7, 7.7, 8.2, 10.3, 10.0],
          heights: [7.2, 7.4, 8.4, 6.0, 5.6, 5.2, 5.0],
          kinds: ['incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar'],
          turn: 1.34, spread: 23, tilt: 0.45
        }
      }
    },
    pediatric: {
      fill: 0.86,               // primary teeth are spaced
      posteriorFrom: 3,         // primary molars
      anchor: 4, anchorShift: 0, // flush terminal plane
      regionKeys: ['rm', 'ant', 'lm'],
      regionOfPos: [1, 1, 1, 0, 0],
      quadrants: { upper: [5, 6], lower: [8, 7] },
      names: ['central', 'lateral', 'canine', 'dm1', 'dm2'],
      primary: true,
      arches: {
        upper: {
          widths: [6.5, 5.2, 7.0, 7.3, 8.8],
          depths: [5.2, 4.8, 6.4, 8.6, 9.6],
          heights: [5.6, 5.2, 6.2, 4.4, 4.2],
          kinds: ['incisor', 'incisor', 'canine', 'dmolar', 'dmolar'],
          turn: 1.06, spread: 16, tilt: 0.5
        },
        lower: {
          widths: [4.2, 4.7, 5.8, 7.8, 9.9],
          depths: [3.9, 4.1, 5.6, 7.2, 8.8],
          heights: [5.0, 5.0, 5.6, 4.2, 4.0],
          kinds: ['incisor', 'incisor', 'canine', 'dmolar', 'dmolar'],
          turn: 1.0, spread: 12, tilt: 0.3
        }
      }
    }
  };

  // Super-ellipse outline used for back teeth and the 2D start-screen drawing.
  const SHAPES = {
    incisor: { n: 2.6, taper: 0.32 },
    canine: { n: 2.2, taper: 0.22 },
    premolar: { n: 2.4, taper: 0.05 },
    molar: { n: 3.1, taper: 0.06 },
    dmolar: { n: 2.7, taper: 0.08 }
  };

  /*
   * Anterior crown anatomy, as profiles along the crown height z (0 = cervical line, 1 = incisal):
   *  aCerv      mesiodistal width at the cervix relative to the widest point (crowns narrow at the neck)
   *  cutM/cutD  rounding of the mesial / distal incisal angle (distal is rounder)
   *  edgeM/D    drop of the incisal edge towards mesial / distal; `peak` = cusp tip position (canine)
   *  pow        sharpness of that drop (incisors: flat edge with defined angles; canine: sloped ridges)
   *  bL / bP    labial / lingual extent (share of crown depth) at the cervix and at the edge
   *  fossa      lingual (palatal) concavity between the marginal ridges
   *  ridge      labial ridge (canine) — gives the convex, robust labial face
   *  tilt       labial inclination of the crown (mm of labial shift per mm of height)
   */
  const ANTERIOR = {
    central: { n: 2.7, aCerv: 0.8, cutM: 0.03, cutD: 0.13, edgeM: 0.05, edgeD: 0.16, peak: 0, pow: 3, bL: [0.46, 0.06], bP: [0.6, 0.05], fossa: 0.42, ridge: 0.03, tilt: 0.2 },
    lateral: { n: 2.5, aCerv: 0.78, cutM: 0.07, cutD: 0.24, edgeM: 0.1, edgeD: 0.26, peak: 0, pow: 2.6, bL: [0.46, 0.07], bP: [0.58, 0.06], fossa: 0.36, ridge: 0.02, tilt: 0.18 },
    canine: { n: 2.2, aCerv: 0.76, cutM: 0, cutD: 0, edgeM: 0.3, edgeD: 0.38, peak: -0.12, pow: 1.35, bL: [0.55, 0.2], bP: [0.6, 0.17], fossa: 0.16, ridge: 0.14, tilt: 0.1 }
  };
  const ANTERIOR_RINGS = [-0.3, 0, 0.14, 0.28, 0.42, 0.56, 0.68, 0.78, 0.86, 0.92, 0.97, 1.0];

  // Back-tooth crown: side wall rows [ring scale, height share] then occlusal rings from topHeight().
  const SIDE_ROWS = [[0.8, -0.3], [0.92, 0.06], [0.98, 0.32], [1.0, 0.55], [0.985, 0.72]];
  const TOP_RINGS = [0.9, 0.74, 0.55, 0.36, 0.18];

  const MOLAR_CUSPS = [[-0.45, 0.42], [0.45, 0.42], [-0.42, -0.42], [0.42, -0.4]];
  const CUSPS = {
    molar: MOLAR_CUSPS,
    dmolar: MOLAR_CUSPS,
    premolar: [[0, 0.45], [0, -0.42]],
    canine: [[0, 0.12]],
    incisor: [[0, 0.3]]
  };
  const MOLAR_FISSURES = [[[-0.62, 0.05], [-0.2, -0.02], [0.2, 0.04], [0.62, -0.02]], [[0.02, 0.62], [0, 0.02], [-0.03, -0.6]]];
  const FISSURES = {
    molar: MOLAR_FISSURES,
    dmolar: MOLAR_FISSURES,
    premolar: [[[-0.55, 0], [0, 0.05], [0.55, 0]]],
    canine: [[[-0.6, -0.18], [0, 0.12], [0.6, -0.18]]],
    incisor: [[[-0.7, 0.36], [0.7, 0.36]]]
  };

  const FACE_KEYS = ['top', 'buccal', 'lingual', 'mesial', 'distal'];

  const smooth = (a, b, x) => {
    const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };

  /* ---------- Arch curve ---------- */

  // Integrates a curvature that fades from the midline backwards: round front, open sides.
  function buildCurve(total, turn, spread) {
    const ds = 0.05;
    const n = Math.ceil((total + 4) / ds);
    let G = 0;
    for (let s = ds / 2; s < total; s += ds) G += Math.exp(-((s / spread) ** 2)) * ds;
    const k0 = turn / G;
    const xs = new Float64Array(n + 1), ys = new Float64Array(n + 1), th = new Float64Array(n + 1);
    let x = 0, y = 0, t = 0;
    for (let i = 0; i <= n; i++) {
      xs[i] = x; ys[i] = y; th[i] = t;
      const s = (i + 0.5) * ds;
      const kap = s < total ? k0 * Math.exp(-((s / spread) ** 2)) : 0;
      const mid = t + (kap * ds) / 2;
      t += kap * ds;
      x += Math.cos(mid) * ds;
      y += Math.sin(mid) * ds;
    }
    return { ds, n, xs, ys, th };
  }

  function curveAt(c, s) {
    const f = Math.max(0, Math.min(c.n, s / c.ds));
    const i = Math.min(c.n - 1, Math.floor(f)), r = f - i;
    return {
      x: c.xs[i] + (c.xs[i + 1] - c.xs[i]) * r,
      y: c.ys[i] + (c.ys[i + 1] - c.ys[i]) * r,
      th: c.th[i] + (c.th[i + 1] - c.th[i]) * r
    };
  }

  /* ---------- Tooth shape ---------- */

  function toWorld(t, u, v) {
    return [t.cx + u * t.tx + v * t.nx, t.cy + u * t.ty + v * t.ny];
  }

  function local3(t, u, v, h) {
    return [t.cx + u * t.tx + v * t.nx, h, -(t.cy + u * t.ty + v * t.ny)];
  }

  function ringUV(t, s, th) {
    const c = Math.cos(th), sn = Math.sin(th);
    const v = t.b * s * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / t.n);
    const u = t.a * s * Math.sign(c) * Math.pow(Math.abs(c), 2 / t.n) * (1 - t.taper * Math.max(0, -v / t.b));
    return [u, v];
  }

  function gauss(dx, dy, s) {
    return Math.exp(-(dx * dx + dy * dy) / s);
  }

  // Occlusal surface height of back teeth with cusps and grooves (lu, lv normalised to [-1, 1]).
  function topHeight(t, lu, lv) {
    const H = t.h;
    if (t.kind === 'premolar') {
      return 0.8 * H + 0.17 * H * gauss(lu, lv - 0.45, 0.08) + 0.12 * H * gauss(lu, lv + 0.42, 0.08) -
        0.06 * H * Math.exp(-(lv * lv) / 0.015);
    }
    let h = 0.8 * H;
    MOLAR_CUSPS.forEach(([cu, cv]) => { h += 0.15 * H * gauss(lu - cu, lv - cv, 0.09); });
    return h - 0.06 * H * Math.exp(-(lv * lv) / 0.015) * (1 - 0.5 * lu * lu);
  }

  // Incisal edge height (share of crown height) along the mesiodistal position lu (-1 mesial … 1 distal).
  function edgeRel(A, lu) {
    const p = A.peak;
    return lu < p
      ? 1 - A.edgeM * Math.pow((p - lu) / (1 + p), A.pow)
      : 1 - A.edgeD * Math.pow((lu - p) / (1 - p), A.pow);
  }

  // Anterior crown surface point at height z and angle th (local u, v, h).
  function anteriorVertex(t, z, th) {
    const A = t.anat, c = Math.cos(th), s = Math.sin(th), ex = 2 / A.n;
    let aM, aD;
    // Convex proximal outlines converging towards the cervix (no "tulip" waist).
    const rise = (top) => Math.sin((Math.min(1, Math.max(0, z) / top) * Math.PI) / 2);
    if (t.kind === 'canine') {
      const base = A.aCerv + (1 - A.aCerv) * rise(0.55);
      aM = base - 0.34 * smooth(0.62, 1, z);          // shorter mesial cusp ridge
      aD = base * 1.03 - 0.28 * smooth(0.66, 1, z);   // fuller, more convex distal contour
    } else {
      const base = A.aCerv + (1 - A.aCerv) * rise(0.72);
      aM = base * (1 - A.cutM * smooth(0.8, 1, z));
      aD = base * (1 - A.cutD * smooth(0.72, 1, z));
    }
    const zc = Math.max(0, Math.min(1, z)), zp = Math.pow(zc, 1.4);
    const bL = A.bL[0] * (1 - zp) + A.bL[1] * zp;
    const bP = A.bP[0] * Math.pow(1 - zc, 0.9) + A.bP[1];
    const ub = Math.sign(c) * Math.pow(Math.abs(c), ex), vb = Math.pow(Math.abs(s), ex);
    const D = 2 * t.b;
    const u = t.a * (c >= 0 ? aD : aM) * ub;
    let v;
    if (s >= 0) v = D * bL * vb * (1 + A.ridge * smooth(0.15, 0.9, z) * Math.exp(-(ub * ub) / 0.16));
    else v = -D * bP * vb * (1 - A.fossa * smooth(0.2, 0.45, z) * (1 - smooth(0.82, 0.98, z)) * (1 - ub * ub));
    const H = t.h;
    const h = z <= 0.8 ? z * H : H * (0.8 + ((z - 0.8) / 0.2) * (edgeRel(A, ub) - 0.8));
    return [u, v + A.tilt * t.tiltK * Math.max(0, h), h];
  }

  function anatomyFor(name, primary) {
    const A = Object.assign({}, ANTERIOR[name]);
    if (primary) {
      // Primary incisors and canines: bulbous neck, rounder angles, shallower lingual anatomy.
      A.aCerv += 0.07; A.edgeM += 0.05; A.edgeD += 0.06; A.cutD *= 0.7;
      A.fossa *= 0.55; A.ridge *= 0.6;
      A.bL = [A.bL[0] + 0.03, A.bL[1] + 0.04];
      A.bP = [A.bP[0], A.bP[1] + 0.04];
    }
    return A;
  }

  function outline(t) {
    const pts = [], steps = 56;
    for (let i = 0; i < steps; i++) {
      const [u, v] = ringUV(t, 1, (i / steps) * TAU);
      pts.push(toWorld(t, u, v));
    }
    return pts;
  }

  function pathFrom(pts) {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
  }

  /* ---------- 3D meshes ---------- */

  // Builds the crown as stacked rings plus a closing vertex. Records per-vertex local
  // coordinates and a relative height (zr, 1 = incisal/occlusal) for surface classification.
  function buildToothMesh(t, out) {
    const vStart = out.pos.length / 3;
    const rows = [];
    if (t.anterior) {
      ANTERIOR_RINGS.forEach((z) => rows.push((th) => anteriorVertex(t, z, th)));
    } else {
      SIDE_ROWS.forEach(([s, hs]) => rows.push((th) => {
        const [u, v] = ringUV(t, s, th);
        return [u, v, hs * t.h];
      }));
      TOP_RINGS.forEach((s) => rows.push((th) => {
        const [u, v] = ringUV(t, s, th);
        return [u, v, topHeight(t, u / t.a, v / t.b)];
      }));
    }
    const R = rows.length;
    const push = (u, v, h, zr) => {
      const p = local3(t, u, v, h);
      out.pos.push(p[0], p[1], p[2]);
      out.local.push(u, v, h);
      out.zr.push(zr);
      out.tooth.push(t.index);
    };
    const last = [];
    rows.forEach((fn, r) => {
      const zr = t.anterior ? ANTERIOR_RINGS[r] : (r >= SIDE_ROWS.length ? 1 : SIDE_ROWS[r][1]);
      for (let i = 0; i < RING; i++) {
        const q = fn((i / RING) * TAU);
        push(q[0], q[1], q[2], zr);
        if (r === R - 1) last.push(q);
      }
    });
    if (t.anterior) {
      const m = [0, 1, 2].map((k) => last.reduce((a, q) => a + q[k], 0) / last.length);
      push(m[0], m[1], t.h * edgeRel(t.anat, 0), 1);
    } else {
      push(0, 0, topHeight(t, 0, 0), 1);
    }

    const idx = (r, i) => vStart + r * RING + (i % RING);
    const triStart = out.tri.length, lineStart = out.lines.length;
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < RING; i++) {
        const a = idx(r, i), b = idx(r + 1, i), c = idx(r + 1, i + 1), d = idx(r, i + 1);
        out.tri.push(a, b, c, a, c, d);
        if (r >= 1) out.lines.push(a, d, a, b, a, c);
      }
    }
    const center = vStart + R * RING;
    for (let i = 0; i < RING; i++) {
      out.tri.push(idx(R - 1, i), center, idx(R - 1, i + 1));
      out.lines.push(idx(R - 1, i), idx(R - 1, i + 1), idx(R - 1, i), center);
    }
    t.mesh = {
      triStart, triCount: out.tri.length - triStart,
      lineStart, lineCount: out.lines.length - lineStart,
      vStart, vCount: R * RING + 1, rows: R
    };
  }

  function computeNormals(pos, idx) {
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      [a, b, c].forEach((k) => { nrm[k] += nx; nrm[k + 1] += ny; nrm[k + 2] += nz; });
    }
    for (let i = 0; i < nrm.length; i += 3) {
      const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }
    return nrm;
  }

  // Crown normals must point outwards (visibility tests depend on it): flip a tooth whose
  // normals mostly point towards its own axis.
  function orientNormals(t, pos, nrm, local) {
    let score = 0;
    for (let v = t.mesh.vStart; v < t.mesh.vStart + t.mesh.vCount; v++) {
      const h = local[v * 3 + 2];
      const c = local3(t, 0, 0, Math.max(0.2 * t.h, Math.min(0.55 * t.h, h)));
      score += (pos[v * 3] - c[0]) * nrm[v * 3] + (pos[v * 3 + 1] - c[1]) * nrm[v * 3 + 1] + (pos[v * 3 + 2] - c[2]) * nrm[v * 3 + 2];
    }
    if (score < 0) {
      for (let k = t.mesh.vStart * 3; k < (t.mesh.vStart + t.mesh.vCount) * 3; k++) nrm[k] = -nrm[k];
    }
  }

  // Surface of a crown point from its tooth-local normal: occlusal/incisal, buccal (labial),
  // lingual (palatal), mesial or distal.
  function classify(t, nu, nv, nh, zr) {
    if (t.anterior ? nh > 0.65 || zr >= 0.96 : nh > 0.6) return 'top';
    if (Math.abs(nu) > Math.abs(nv) * 1.4) return nu > 0 ? 'distal' : 'mesial';
    return nv > 0 ? 'buccal' : 'lingual';
  }

  function localNormal(t, nrm, v) {
    const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
    return [nx * t.tx - nz * t.ty, nx * t.nx - nz * t.ny, ny]; // (n·T, n·N, n·up) with T=(tx,0,-ty), N=(nx,0,-ny)
  }

  function makePoint(t, pos, nrm, local, v, face) {
    return {
      x: pos[v * 3], y: pos[v * 3 + 1], z: pos[v * 3 + 2],
      nx: nrm[v * 3], ny: nrm[v * 3 + 1], nz: nrm[v * 3 + 2],
      u: local[v * 3], v: local[v * 3 + 1], h: local[v * 3 + 2],
      tooth: t, face, index: 0,
      // world copies (set for the instance the point is scanned in) and simulation state
      wx: 0, wy: 0, wz: 0, wnx: 0, wny: 0, wnz: 0,
      reachable: true, required: false, exp: 0, qual: 0, cap: false, seen: -1
    };
  }

  function makeFace(t, key) {
    return { key, tooth: t, points: [], req: [], total: 0, captured: 0, done: false, required: false };
  }

  // Exposed crown vertices become scan points, thinned per surface so each face keeps its own set.
  function samplePoints(t, pos, nrm, local, zr) {
    t.faces = {};
    FACE_KEYS.forEach((k) => { t.faces[k] = makeFace(t, k); });
    t.biteFace = makeFace(t, 'bite');
    t.points = [];
    t.bitePoints = [];
    const s2 = SAMPLE_SPACING * SAMPLE_SPACING, b2 = BITE_SPACING * BITE_SPACING;
    const p2 = PROXIMAL_SPACING * PROXIMAL_SPACING; // proximal faces are narrow strips: sample them finer
    const far = (list, v, lim) => list.every((p) => (p.u - local[v * 3]) ** 2 + (p.v - local[v * 3 + 1]) ** 2 + (p.h - local[v * 3 + 2]) ** 2 >= lim);
    for (let v = t.mesh.vStart; v < t.mesh.vStart + t.mesh.vCount; v++) {
      const h = local[v * 3 + 2];
      if (h < gumTopAt(t, local[v * 3]) + 0.25) continue; // hidden under the gum or a papilla
      const [nu, nv, nh] = localNormal(t, nrm, v);
      const key = classify(t, nu, nv, nh, zr[v]);
      const face = t.faces[key];
      if (far(face.points, v, key === 'mesial' || key === 'distal' ? p2 : s2)) {
        const p = makePoint(t, pos, nrm, local, v, face);
        face.points.push(p);
        t.points.push(p);
      }
      // Bite registration: separate points on the cheek side of back teeth, mid-crown.
      if (t.posterior && key === 'buccal' && h > 0.3 * t.h && h < 0.85 * t.h && far(t.biteFace.points, v, b2)) {
        const p = makePoint(t, pos, nrm, local, v, t.biteFace);
        t.biteFace.points.push(p);
        t.bitePoints.push(p);
      }
    }
  }

  // Coarse copy of the crown (every other ring vertex) used for ray tests: line of sight and reach.
  function buildProxy(t, pos) {
    const R = t.mesh.rows, step = 2, n = RING / step, tris = [];
    const at = (r, i) => (t.mesh.vStart + r * RING + ((i * step) % RING)) * 3;
    const put = (k) => tris.push(pos[k], pos[k + 1], pos[k + 2]);
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < n; i++) {
        const a = at(r, i), b = at(r + 1, i), c = at(r + 1, i + 1), d = at(r, i + 1);
        put(a); put(b); put(c); put(a); put(c); put(d);
      }
    }
    const center = (t.mesh.vStart + R * RING) * 3;
    for (let i = 0; i < n; i++) { put(at(R - 1, i)); put(center); put(at(R - 1, i + 1)); }
    let cx = 0, cy = 0, cz = 0;
    const vs = t.mesh.vStart, vc = t.mesh.vCount;
    for (let v = vs; v < vs + vc; v++) { cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2]; }
    cx /= vc; cy /= vc; cz /= vc;
    let r = 0;
    for (let v = vs; v < vs + vc; v++) r = Math.max(r, Math.hypot(pos[v * 3] - cx, pos[v * 3 + 1] - cy, pos[v * 3 + 2] - cz));
    t.proxy = { tris: new Float32Array(tris), cx, cy, cz, r: r + 0.2 };
    t.center3 = [cx, cy, cz];
  }

  // Interdental papilla height (mm above the gum crest) between this tooth and its neighbour.
  function papillaHeight(t) {
    const p = t.anterior ? 2.4 : t.kind === 'premolar' ? 1.7 : 1.3;
    return t.primary ? p * 0.7 : p;
  }

  // Gum height next to a crown at tooth-local u: the crest plus the papillae at both contacts.
  function gumTopAt(t, u) {
    const half = (t.slot[1] - t.slot[0]) / 2;
    return 1.0 + papillaHeight(t) * Math.exp(-(((half - Math.abs(u)) / 1.1) ** 2));
  }

  // Gum (gingiva) band swept along the arch, with papillae filling the spaces between crowns.
  // A removed tooth leaves a healed, slightly lower ridge and flattened papillae.
  function buildGum(model, removed) {
    const end = model.total - 0.6, step = 0.5;
    const gone = (t) => !!(t && removed && removed.has(t.id));
    // Contacts: between the two central incisors (s = 0) and between neighbours on each side.
    const contacts = [];
    [-1, 1].forEach((side) => {
      const row = model.teeth.filter((t) => t.side === side).sort((a, b) => a.pos - b.pos);
      if (side > 0) {
        const other = model.teeth.find((t) => t.side < 0 && t.pos === 0);
        contacts.push({ s: 0, side: 0, h: papillaHeight(row[0]) * (gone(row[0]) || gone(other) ? 0.25 : 1) });
      }
      for (let i = 0; i < row.length - 1; i++) {
        contacts.push({ s: row[i].slot[1], side, h: papillaHeight(row[i]) * (gone(row[i]) || gone(row[i + 1]) ? 0.25 : 1) });
      }
    });
    const papillaAt = (side, s) => contacts.reduce((m, k) => (k.side === 0 || k.side === side ? Math.max(m, k.h * Math.exp(-(((s - k.s) / 1.1) ** 2))) : m), 0);
    const pos = [], idx = [];
    const depthAt = (side, s) => {
      const teeth = model.teeth.filter((t) => t.side === side);
      if (s <= teeth[0].sMid) return teeth[0].b * 2;
      for (let i = 1; i < teeth.length; i++) {
        if (s <= teeth[i].sMid) {
          const a = teeth[i - 1], b = teeth[i], f = (s - a.sMid) / (b.sMid - a.sMid);
          return (a.b + (b.b - a.b) * f) * 2;
        }
      }
      return teeth[teeth.length - 1].b * 2;
    };
    const samples = [];
    for (let s = -end; s <= end + 1e-6; s += step) samples.push(s);
    samples.forEach((ss) => {
      const side = ss < 0 ? -1 : 1, s = Math.abs(ss);
      const c = model.place(side, s);
      const hw = depthAt(side, s) / 2 + 2;
      const t = model.teeth.find((k) => k.side === side && s >= k.slot[0] && s < k.slot[1]);
      let dip = 0;
      if (gone(t)) dip = -0.9 * Math.sin((Math.PI * (s - t.slot[0])) / (t.slot[1] - t.slot[0]));
      const pap = papillaAt(side, s);
      [[-hw, -5], [-hw - 0.4, -2.2], [-hw + 0.7, 0.3 + pap * 0.5], [-hw * 0.45, 0.9 + dip + pap], [0, 1.0 + dip + pap],
        [hw * 0.45, 0.9 + dip + pap], [hw - 0.7, 0.3 + pap * 0.5], [hw + 0.4, -2.2], [hw, -5]].forEach(([v, h]) => {
        pos.push(c.x + v * c.nx, h, -(c.y + v * c.ny));
      });
    });
    const P = 9, rings = samples.length;
    for (let k = 0; k < rings - 1; k++) {
      for (let i = 0; i < P; i++) {
        const a = k * P + i, b = (k + 1) * P + i, c = (k + 1) * P + ((i + 1) % P), d = k * P + ((i + 1) % P);
        idx.push(a, b, c, a, c, d);
      }
    }
    [0, rings - 1].forEach((k) => {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < P; i++) { cx += pos[(k * P + i) * 3]; cy += pos[(k * P + i) * 3 + 1]; cz += pos[(k * P + i) * 3 + 2]; }
      const ci = pos.length / 3;
      pos.push(cx / P, cy / P, cz / P);
      for (let i = 0; i < P; i++) idx.push(k * P + i, ci, k * P + ((i + 1) % P));
    });
    const p = new Float32Array(pos);
    return { pos: p, nrm: computeNormals(p, idx), idx: new Uint16Array(idx) };
  }

  /* ---------- Model ---------- */

  function buildArch(dentKey, archKey) {
    const dent = DENTITIONS[dentKey], spec = dent.arches[archKey];
    const total = spec.widths.reduce((a, b) => a + b, 0);
    const curve = buildCurve(total, spec.turn, spec.spread);

    // Point on the arch at arc length s; side -1 is the screen-left (patient's right) half.
    function place(side, s) {
      const c = curveAt(curve, s), cs = Math.cos(c.th), sn = Math.sin(c.th);
      return { x: side * c.x, y: c.y, tx: side * cs, ty: sn, nx: side * sn, ny: -cs };
    }

    const teeth = [];
    [-1, 1].forEach((side) => {
      let s = 0;
      spec.widths.forEach((w, i) => {
        const c = place(side, s + w / 2);
        const kind = spec.kinds[i], shape = SHAPES[kind];
        const ri = dent.regionOfPos[i];
        const name = dent.names[i];
        const t = {
          index: teeth.length,
          id: String(dent.quadrants[archKey][side < 0 ? 0 : 1] * 10 + i + 1),
          arch: archKey, pos: i, side, kind, name,
          posterior: i >= dent.posteriorFrom,
          anterior: i < dent.posteriorFrom,
          region: side < 0 ? ri : dent.regionKeys.length - 1 - ri,
          cx: c.x, cy: c.y, tx: c.tx, ty: c.ty, nx: c.nx, ny: c.ny,
          a: (w * dent.fill) / 2, b: spec.depths[i] / 2, h: spec.heights[i],
          n: shape.n, taper: shape.taper, tiltK: spec.tilt, primary: dent.primary,
          slot: [s, s + w], sMid: s + w / 2,
          removed: false
        };
        if (t.anterior) t.anat = anatomyFor(name, dent.primary);
        s += w;
        t.radius = Math.max(t.a, t.b);
        t.outline = outline(t);
        t.path = pathFrom(t.outline);
        teeth.push(t);
      });
    });

    // 2D gum and bounds (start-screen illustration).
    const gumEnd = total - 1.5;
    const gum = [];
    for (let s = gumEnd; s >= 0; s -= 1) { const c = place(-1, s); gum.push([c.x, c.y]); }
    for (let s = 0; s <= gumEnd; s += 1) { const c = place(1, s); gum.push([c.x, c.y]); }
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const grow = (x, y, r) => {
      bounds.minX = Math.min(bounds.minX, x - r); bounds.maxX = Math.max(bounds.maxX, x + r);
      bounds.minY = Math.min(bounds.minY, y - r); bounds.maxY = Math.max(bounds.maxY, y + r);
    };
    teeth.forEach((t) => t.outline.forEach(([x, y]) => grow(x, y, 0.6)));
    gum.forEach(([x, y]) => grow(x, y, GUM_WIDTH / 2));

    // 3D crowns.
    const out = { pos: [], local: [], zr: [], tooth: [], tri: [], lines: [] };
    teeth.forEach((t) => buildToothMesh(t, out));
    const pos = new Float32Array(out.pos);
    const count = pos.length / 3;
    const nrm = computeNormals(pos, out.tri);
    teeth.forEach((t) => orientNormals(t, pos, nrm, out.local));

    const points = [], bites = [];
    teeth.forEach((t) => {
      samplePoints(t, pos, nrm, out.local, out.zr);
      buildProxy(t, pos);
      t.points.forEach((p) => { p.index = points.length; points.push(p); });
      t.bitePoints.forEach((p) => { p.index = bites.length; bites.push(p); });
    });

    // Each vertex takes its look (captured, quality) from the nearest scan point of the same
    // surface of its tooth, so every face lights up on its own.
    const vPoint = new Int32Array(count), vBite = new Int32Array(count).fill(-1), vTooth = new Uint16Array(out.tooth);
    for (let v = 0; v < count; v++) {
      const t = teeth[out.tooth[v]];
      const u = out.local[v * 3], w = out.local[v * 3 + 1], h = out.local[v * 3 + 2];
      const [nu, nv, nh] = localNormal(t, nrm, v);
      const key = classify(t, nu, nv, nh, out.zr[v]);
      const pool = h >= GUM_LINE - 0.3 && t.faces[key].points.length ? t.faces[key].points : t.points;
      let best = Infinity;
      pool.forEach((p) => {
        const d = (p.u - u) ** 2 + (p.v - w) ** 2 + (p.h - h) ** 2;
        if (d < best) { best = d; vPoint[v] = p.index; }
      });
      if (t.posterior && key === 'buccal' && h > 0.15 * t.h) {
        best = 9;
        t.bitePoints.forEach((p) => {
          const d = (p.u - u) ** 2 + (p.v - w) ** 2 + (p.h - h) ** 2;
          if (d < best) { best = d; vBite[v] = p.index; }
        });
      }
    }

    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
    cx /= count; cy /= count; cz /= count;
    let radius = 0;
    for (let i = 0; i < pos.length; i += 3) radius = Math.max(radius, Math.hypot(pos[i] - cx, pos[i + 1] - cy, pos[i + 2] - cz));

    return {
      dentition: dentKey, key: archKey, dent, teeth, total, curve, place,
      gum, bounds, points, bitePoints: bites,
      mesh: {
        pos, nrm, tri: new Uint16Array(out.tri), lines: new Uint16Array(out.lines),
        vPoint, vBite, vTooth, count
      },
      dyn: new Float32Array(count * 4),
      center3: [cx, cy, cz],
      radius3: radius + 2
    };
  }

  // Places the upper arch over the lower one in occlusion (crowns meeting, upper mirrored).
  function biteMatrix(upper, lower) {
    const top = (m) => Math.max(...m.teeth.filter((t) => t.posterior).map((t) => t.h)) * 0.95;
    const gapY = top(upper) + top(lower) - 0.9;
    const anchor = upper.dent.anchor;
    const zU = -upper.teeth.find((t) => t.pos === anchor).cy;
    const zL = -lower.teeth.find((t) => t.pos === anchor).cy;
    const dz = zL - upper.dent.anchorShift - zU;
    return new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, gapY, dz, 1]);
  }

  /* ---------- 2D illustration (start screen) ---------- */

  function hash(i, j) {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s) - 0.5;
  }

  // Jittered triangular lattice: the "digital mesh" look of captured surfaces.
  function drawMesh(c, b, m, color, lw) {
    const h = m * 0.866;
    const cols = Math.ceil((b.maxX - b.minX) / m) + 3;
    const rows = Math.ceil((b.maxY - b.minY) / h) + 3;
    const P = (i, j) => [
      b.minX - m + i * m + (j & 1 ? m / 2 : 0) + hash(i, j) * 0.3 * m,
      b.minY - h + j * h + hash(j + 17, i + 5) * 0.3 * h
    ];
    c.beginPath();
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const [x, y] = P(i, j);
        if (i + 1 < cols) { c.moveTo(x, y); c.lineTo(...P(i + 1, j)); }
        if (j + 1 < rows) {
          const a = j & 1 ? i : i - 1, bb = j & 1 ? i + 1 : i;
          if (a >= 0) { c.moveTo(x, y); c.lineTo(...P(a, j + 1)); }
          if (bb < cols) { c.moveTo(x, y); c.lineTo(...P(bb, j + 1)); }
        }
      }
    }
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.stroke();
  }

  function strokeGum(c, gum, color, width) {
    c.beginPath();
    gum.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.strokeStyle = color;
    c.stroke();
  }

  function drawFissures(c, t, color, lw) {
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    FISSURES[t.kind].forEach((line) => {
      c.beginPath();
      line.forEach(([u, v], i) => {
        const [x, y] = toWorld(t, u * t.a, v * t.b);
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.stroke();
    });
  }

  function drawToothSolid(c, t, view) {
    const g = c.createLinearGradient(t.cx - t.a, t.cy - t.b, t.cx + t.a, t.cy + t.b);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.55, '#F2F3F5');
    g.addColorStop(1, '#D3D8DF');
    c.fillStyle = g;
    c.fill(t.path);

    c.save();
    c.clip(t.path);
    const r = Math.min(t.a, t.b);
    CUSPS[t.kind].forEach(([cu, cv]) => {
      const [x, y] = toWorld(t, cu * t.a, cv * t.b);
      const rg = c.createRadialGradient(x - r * 0.12, y - r * 0.18, 0, x, y, r * 0.7);
      rg.addColorStop(0, 'rgba(255,255,255,0.95)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg;
      c.fillRect(x - r, y - r, 2 * r, 2 * r);
    });
    // Soft inner shadow along the rim gives the crown volume.
    c.lineWidth = r * 0.55;
    c.strokeStyle = 'rgba(120,130,146,0.16)';
    c.stroke(t.path);
    drawFissures(c, t, 'rgba(105,114,128,0.55)', Math.max(0.22, view.px(1)));
    c.restore();

    c.lineWidth = view.px(0.9);
    c.strokeStyle = 'rgba(115,125,140,0.6)';
    c.stroke(t.path);
  }

  function makeLayer() {
    const canvas = document.createElement('canvas');
    return { canvas, ctx: canvas.getContext('2d') };
  }

  // Top-down 2D drawing of one arch with two cached layers: ghost (not scanned) and scanned.
  class ArchView {
    constructor(canvas, padding) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.padding = padding;
      this.model = null;
      this.w = 0; this.h = 0; this.dpr = 1;
      this.scale = 1; this.ox = 0; this.oy = 0;
      this.ghost = makeLayer();
      this.scanned = makeLayer();
      this.teethTmp = makeLayer();
    }

    resize() {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (w === this.w && h === this.h && dpr === this.dpr) return true;
      this.w = w; this.h = h; this.dpr = dpr;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      [this.canvas, this.ghost.canvas, this.scanned.canvas, this.teethTmp.canvas].forEach((c) => {
        c.width = pw;
        c.height = ph;
      });
      this.fit();
      this.render();
      return true;
    }

    setModel(model) {
      this.model = model;
      this.fit();
      this.render();
    }

    fit() {
      if (!this.model || !this.w) return;
      const b = this.model.bounds, p = this.padding;
      const aw = Math.max(10, this.w - p.left - p.right), ah = Math.max(10, this.h - p.top - p.bottom);
      const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
      this.scale = Math.min(aw / bw, ah / bh);
      this.ox = p.left + (aw - bw * this.scale) / 2 - b.minX * this.scale;
      this.oy = p.top + (ah - bh * this.scale) / 2 - b.minY * this.scale;
    }

    render() {
      if (!this.model || !this.w) return;
      this.renderGhost();
      this.renderScanned();
    }

    worldTransform(c) {
      const s = this.scale * this.dpr;
      c.setTransform(s, 0, 0, s, this.ox * this.dpr, this.oy * this.dpr);
    }

    toScreen(x, y) {
      return { x: this.ox + x * this.scale, y: this.oy + y * this.scale };
    }

    screenBounds() {
      const b = this.model.bounds;
      const a = this.toScreen(b.minX, b.minY), z = this.toScreen(b.maxX, b.maxY);
      return { minX: a.x, minY: a.y, maxX: z.x, maxY: z.y };
    }

    // CSS pixels -> world units, for hairlines that should stay crisp at any zoom.
    px(n) {
      return n / this.scale;
    }

    clear(c) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    }

    renderGhost() {
      const c = this.ghost.ctx, m = this.model;
      this.clear(c);
      this.worldTransform(c);
      strokeGum(c, m.gum, 'rgba(160,168,180,0.35)', GUM_WIDTH + this.px(1.5));
      strokeGum(c, m.gum, 'rgba(255,255,255,0.8)', GUM_WIDTH);
      m.teeth.forEach((t) => {
        c.fillStyle = 'rgba(255,255,255,0.92)';
        c.fill(t.path);
        c.setLineDash([this.px(3.5), this.px(2.5)]);
        c.lineWidth = this.px(1.2);
        c.strokeStyle = '#9EA5B0';
        c.stroke(t.path);
        c.setLineDash([]);
        drawFissures(c, t, 'rgba(150,158,170,0.35)', this.px(1));
      });
    }

    renderScanned() {
      const c = this.scanned.ctx, tc = this.teethTmp.ctx, m = this.model;
      this.clear(c);
      this.clear(tc);

      this.worldTransform(c);
      strokeGum(c, m.gum, '#D9DDE3', GUM_WIDTH + this.px(1));
      strokeGum(c, m.gum, '#E8EAEE', GUM_WIDTH - 1.5);
      c.globalCompositeOperation = 'source-atop';
      // Mesh density follows the zoom so it reads as a fine mesh, not a tint.
      drawMesh(c, m.bounds, Math.max(1.6, this.px(13)), 'rgba(110,118,130,0.22)', this.px(0.6));
      c.globalCompositeOperation = 'source-over';

      c.save();
      c.shadowColor = 'rgba(30,36,46,0.28)';
      c.shadowBlur = 6 * this.dpr;
      c.shadowOffsetY = 2 * this.dpr;
      c.fillStyle = '#FFFFFF';
      m.teeth.forEach((t) => c.fill(t.path));
      c.restore();

      this.worldTransform(tc);
      m.teeth.forEach((t) => drawToothSolid(tc, t, this));
      tc.globalCompositeOperation = 'source-atop';
      drawMesh(tc, m.bounds, Math.max(1.1, this.px(9)), 'rgba(255,106,19,0.3)', this.px(0.55));
      tc.globalCompositeOperation = 'source-over';

      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.teethTmp.canvas, 0, 0);
    }

    // Start-screen animation: everything left of sweepX (css px) looks scanned.
    drawHome(sweepX, alpha) {
      const c = this.ctx;
      this.clear(c);
      c.drawImage(this.ghost.canvas, 0, 0);
      if (sweepX > 0 && alpha > 0) {
        c.save();
        c.globalAlpha = alpha;
        c.beginPath();
        c.rect(0, 0, sweepX * this.dpr, this.canvas.height);
        c.clip();
        c.drawImage(this.scanned.canvas, 0, 0);
        c.restore();
      }
    }
  }

  ISC.DENTITIONS = DENTITIONS;
  ISC.FACE_KEYS = FACE_KEYS;
  ISC.buildArch = buildArch;
  ISC.buildGum = buildGum;
  ISC.biteMatrix = biteMatrix;
  ISC.ArchView = ArchView;
})();
