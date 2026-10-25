/*
 * Intraoral Scanner Challenge — minimal WebGL renderer (no library).
 * Orbit camera with smooth rotation and zoom, crown + gum materials, captured-surface mesh lines,
 * and a scan-quality heatmap mode. Per-vertex state comes from the game through `model.dyn`:
 * [captured 0/1, quality 0..1 (-1 = not evaluated), highlight 0/1, bite captured 0/1].
 */
(function () {
  'use strict';

  const ISC = (window.ISC = window.ISC || {});

  const FOVY = 0.6; // ~34 degrees
  const PITCH_MIN = -1.25, PITCH_MAX = 1.5;
  const ZOOM_MIN = 0.65, ZOOM_MAX = 2.8;
  const MAX_DPR = 2;
  const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  // Identity of a set of removed teeth by content (the set is edited in place by the setup screen).
  const removedKey = (s) => (s && s.size ? [...s].sort().join(',') : '');

  const VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec4 aDyn;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform float uShift;
varying vec3 vW;
varying vec3 vN;
varying vec4 vDyn;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = (uModel * vec4(aNrm, 0.0)).xyz;
  vDyn = aDyn;
  gl_Position = uViewProj * w;
  gl_Position.y += uShift * gl_Position.w;
}`;

  const FS = `
precision mediump float;
varying vec3 vW;
varying vec3 vN;
varying vec4 vDyn;
uniform vec3 uEye;
uniform vec3 uShade;
uniform float uMaterial;
uniform float uHeat;
uniform float uPreview;
uniform float uResult;
uniform float uTime;
const vec3 ORANGE = vec3(1.0, 0.416, 0.075);
vec3 heat(float q) {
  vec3 red = vec3(0.86, 0.20, 0.17);
  vec3 orange = vec3(0.96, 0.49, 0.10);
  vec3 yellow = vec3(0.98, 0.80, 0.18);
  vec3 lgreen = vec3(0.56, 0.80, 0.32);
  vec3 green = vec3(0.13, 0.62, 0.31);
  if (q < 0.3) return mix(red, orange, smoothstep(0.24, 0.3, q));
  if (q < 0.5) return mix(orange, yellow, smoothstep(0.44, 0.5, q));
  if (q < 0.7) return mix(yellow, lgreen, smoothstep(0.64, 0.7, q));
  if (q < 0.85) return mix(lgreen, green, smoothstep(0.8, 0.85, q));
  return green;
}
void main() {
  // Scan result view: only surfaces that were really captured exist in the digital model.
  if (uResult > 0.5 && (uMaterial < 0.5 || uMaterial > 1.5) && vDyn.x < 0.5) discard;
  if (uMaterial > 1.5) {
    float a = uHeat > 0.5 ? 0.16 * step(0.0, vDyn.y) : max(vDyn.x * 0.42, vDyn.w * 0.8);
    a *= 1.0 - 0.6 * uResult; // digital model: surface first, mesh as a fine overlay
    if (uPreview > 0.5 || a < 0.01) discard;
    vec3 c = uHeat > 0.5 ? vec3(0.1, 0.12, 0.15) : ORANGE;
    gl_FragColor = vec4(c * a, a);
    return;
  }
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 l = normalize(vec3(0.35, 1.0, 0.55));
  float diff = 0.5 * max(dot(n, l), 0.0) + 0.5 * max(dot(n, v), 0.0);
  float amb = 0.42 + 0.1 * n.y;
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), 36.0);
  vec3 base;
  float specK;
  if (uMaterial < 0.5) {
    float cap = uPreview > 0.5 ? 1.0 : vDyn.x;
    if (uHeat > 0.5 && uPreview < 0.5) {
      base = vDyn.y < 0.0 ? vec3(0.74, 0.76, 0.79) : heat(vDyn.y);
      specK = 0.12;
    } else {
      base = mix(vec3(0.79, 0.81, 0.84), uShade, cap);
      specK = mix(0.05, 0.32, cap);
    }
    // Next-region glow; off on the quality map so it cannot be read as a quality colour.
    // z = 1: pending surface of the next tooth (pulsing glow, off on the quality map so it cannot be
    // read as a quality colour). z = 2: surface inside the scanner field right now (steady tint).
    float pending = step(0.5, vDyn.z) * (1.0 - step(1.5, vDyn.z));
    float inField = step(1.5, vDyn.z);
    base = mix(base, ORANGE, pending * (1.0 - uHeat) * (0.3 + 0.25 * sin(uTime * 5.5)));
    base = mix(base, vec3(1.0, 0.8, 0.62), inField * 0.45);
  } else {
    base = uHeat > 0.5 ? vec3(0.80, 0.77, 0.77) : vec3(0.91, 0.67, 0.66);
    specK = 0.1;
  }
  gl_FragColor = vec4(base * (amb + diff * 0.7) + vec3(spec * specK), 1.0);
}`;

  function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function lookAt(e, t) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = zz, xy = 0, xz = -zx; // up (0,1,0) x z
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1
    ]);
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Renderer {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gl-canvas';
      this.w = 0; this.h = 0; this.dpr = 1;
      this.view = { yaw: 0, pitch: 1, zoom: 1, tx: 0, ty: 0, tz: 0, radius: 30, shift: 0 };
      this.cam = Object.assign({}, this.view);
      this.goal = Object.assign({}, this.view);
      this.viewProj = IDENTITY;
      this.eye = [0, 0, 1];
      this.gpu = new Map();
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
      this.canvas.addEventListener('webglcontextrestored', () => this.init());
      this.init();
    }

    init() {
      const opts = { antialias: true, alpha: true, premultipliedAlpha: true, depth: true };
      let gl = null;
      try { gl = this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts); } catch (e) { gl = null; }
      this.gl = gl;
      this.ok = false;
      this.gpu.clear();
      if (!gl) return;
      try {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        this.prog = p;
        this.a = { pos: gl.getAttribLocation(p, 'aPos'), nrm: gl.getAttribLocation(p, 'aNrm'), dyn: gl.getAttribLocation(p, 'aDyn') };
        this.u = {};
        ['uViewProj', 'uModel', 'uShift', 'uEye', 'uShade', 'uMaterial', 'uHeat', 'uPreview', 'uResult', 'uTime'].forEach((n) => {
          this.u[n] = gl.getUniformLocation(p, n);
        });
        this.ok = true;
      } catch (e) {
        console.error('WebGL setup failed:', e);
      }
    }

    attach(container) {
      if (this.canvas.parentNode !== container) container.insertBefore(this.canvas, container.firstChild);
      this.resize();
    }

    resize() {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (!w || !h) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (w !== this.w || h !== this.h || dpr !== this.dpr) {
        this.w = w; this.h = h; this.dpr = dpr;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
      }
      return true;
    }

    /* ---------- Camera ---------- */

    // The view a stage starts from (and returns to with recenter).
    setView(view, instant) {
      this.view = Object.assign({ zoom: 1, shift: 0 }, view);
      this.goal = Object.assign({}, this.view);
      this.cam.yaw = this.goal.yaw + wrap(this.cam.yaw - this.goal.yaw);
      if (instant) this.cam = Object.assign({}, this.goal);
    }

    recenter() {
      this.cam.yaw = this.view.yaw + wrap(this.cam.yaw - this.view.yaw);
      this.goal = Object.assign({}, this.view);
    }

    // Direct manipulation (mouse / fingers): applied immediately, no easing, so the model follows
    // the hand. Only programmatic moves (recenter, next step, guided view) are eased.
    orbit(dx, dy) {
      const yaw = this.goal.yaw - dx * 0.0085;
      const pitch = clamp(this.goal.pitch + dy * 0.0075, PITCH_MIN, PITCH_MAX);
      this.cam.yaw += yaw - this.goal.yaw;
      this.cam.pitch += pitch - this.goal.pitch;
      this.goal.yaw = yaw;
      this.goal.pitch = pitch;
    }

    setZoom(z, eased) {
      this.goal.zoom = clamp(z, ZOOM_MIN, ZOOM_MAX);
      if (!eased) this.cam.zoom = this.goal.zoom;
    }

    zoomBy(f, eased) {
      this.setZoom(this.goal.zoom * f, eased);
    }

    // Eased move to a view (guided "next surface" view).
    moveTo(view) {
      const g = Object.assign({}, this.goal, view);
      this.cam.yaw = g.yaw + wrap(this.cam.yaw - g.yaw);
      this.goal = g;
    }

    update(dt) {
      const k = 1 - Math.exp(-dt * 11);
      Object.keys(this.goal).forEach((key) => { this.cam[key] += (this.goal[key] - this.cam[key]) * k; });
      this.computeMatrices();
    }

    computeMatrices() {
      if (!this.w) return;
      const c = this.cam, aspect = this.w / this.h;
      const fovx = 2 * Math.atan(Math.tan(FOVY / 2) * aspect);
      const dist = c.radius / Math.sin(Math.min(FOVY, fovx) / 2) / c.zoom;
      const cp = Math.cos(c.pitch);
      this.eye = [c.tx + dist * Math.sin(c.yaw) * cp, c.ty + dist * Math.sin(c.pitch), c.tz + dist * Math.cos(c.yaw) * cp];
      const view = lookAt(this.eye, [c.tx, c.ty, c.tz]);
      this.viewProj = multiply(perspective(FOVY, aspect, dist * 0.05, dist * 5), view);
      // Camera basis (world) for picking rays: rows of the view matrix.
      this.right = [view[0], view[4], view[8]];
      this.up = [view[1], view[5], view[9]];
      this.fwd = [-view[2], -view[6], -view[10]];
      this.tanY = Math.tan(FOVY / 2);
      this.tanX = this.tanY * aspect;
    }

    // World ray through a point of the canvas (CSS px): origin at the eye, unit direction.
    ray(x, y) {
      const nx = (x / this.w) * 2 - 1;
      const ny = 1 - (y / this.h) * 2 - this.cam.shift;
      const d = [0, 1, 2].map((k) => this.fwd[k] + this.right[k] * nx * this.tanX + this.up[k] * ny * this.tanY);
      const l = Math.hypot(d[0], d[1], d[2]);
      return { o: this.eye.slice(), d: [d[0] / l, d[1] / l, d[2] / l] };
    }

    /* ---------- Projection helpers (CSS pixels) ---------- */

    mvp(model) {
      return model === IDENTITY ? this.viewProj : multiply(this.viewProj, model);
    }

    project(m, x, y, z) {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.001) return null;
      const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w + this.cam.shift;
      return { x: (nx * 0.5 + 0.5) * this.w, y: (0.5 - ny * 0.5) * this.h };
    }

    // Cosine between a point's surface normal and the direction to the camera.
    facing(model, p) {
      const m = model;
      const wx = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
      const wy = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
      const wz = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
      const nx = m[0] * p.nx + m[4] * p.ny + m[8] * p.nz;
      const ny = m[1] * p.nx + m[5] * p.ny + m[9] * p.nz;
      const nz = m[2] * p.nx + m[6] * p.ny + m[10] * p.nz;
      const vx = this.eye[0] - wx, vy = this.eye[1] - wy, vz = this.eye[2] - wz;
      return (nx * vx + ny * vy + nz * vz) / (Math.hypot(vx, vy, vz) || 1);
    }

    pxPerMm() {
      const c = this.cam, m = this.viewProj;
      const a = this.project(m, c.tx, c.ty, c.tz);
      const b = this.project(m, c.tx + Math.cos(c.yaw), c.ty, c.tz - Math.sin(c.yaw));
      return a && b ? Math.max(0.5, Math.hypot(b.x - a.x, b.y - a.y)) : 5;
    }

    /* ---------- Geometry ---------- */

    buffers(model) {
      let g = this.gpu.get(model);
      // Each view (main, SCAN RESULT, zoom) keeps its own copy: follow the current removals.
      if (g && g.removedKey !== removedKey(model.removedSet)) this.setRemoved(model, model.removedSet || new Set());
      if (g || !this.ok) return g;
      const gl = this.gl, mk = (target, data, usage) => {
        const b = gl.createBuffer();
        gl.bindBuffer(target, b);
        gl.bufferData(target, data, usage || gl.STATIC_DRAW);
        return b;
      };
      g = {
        pos: mk(gl.ARRAY_BUFFER, model.mesh.pos),
        nrm: mk(gl.ARRAY_BUFFER, model.mesh.nrm),
        dyn: mk(gl.ARRAY_BUFFER, model.dyn, gl.DYNAMIC_DRAW),
        tri: gl.createBuffer(), lines: gl.createBuffer(), triCount: 0, lineCount: 0,
        gumPos: gl.createBuffer(), gumNrm: gl.createBuffer(), gumIdx: gl.createBuffer(), gumCount: 0
      };
      this.gpu.set(model, g);
      this.setRemoved(model, model.removedSet || new Set());
      return g;
    }

    // Rebuilds the crown index lists and the gum ridge for the teeth that are present.
    setRemoved(model, removed) {
      model.removedSet = removed;
      const g = this.gpu.get(model);
      if (!g) return;
      g.removedKey = removedKey(removed);
      const gl = this.gl, tri = [], lines = [];
      model.teeth.forEach((t) => {
        if (removed.has(t.id)) return;
        for (let i = 0; i < t.mesh.triCount; i++) tri.push(model.mesh.tri[t.mesh.triStart + i]);
        for (let i = 0; i < t.mesh.lineCount; i++) lines.push(model.mesh.lines[t.mesh.lineStart + i]);
      });
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.tri);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tri), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.lines);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines), gl.STATIC_DRAW);
      g.triCount = tri.length;
      g.lineCount = lines.length;

      const gum = ISC.buildGum(model, removed);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.gumPos);
      gl.bufferData(gl.ARRAY_BUFFER, gum.pos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.gumNrm);
      gl.bufferData(gl.ARRAY_BUFFER, gum.nrm, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.gumIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gum.idx, gl.STATIC_DRAW);
      g.gumCount = gum.idx.length;
    }

    // data: per-vertex state for this view (defaults to the shared model.dyn).
    uploadDyn(model, data) {
      const g = this.buffers(model);
      if (!g) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.dyn);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data || model.dyn);
    }

    // Copies another renderer's camera (scan result view following the original).
    follow(other) {
      this.cam = Object.assign({}, other.cam);
      this.goal = Object.assign({}, other.goal);
      this.view = Object.assign({}, other.view);
    }

    /* ---------- Draw ---------- */

    // items: [{ model, matrix }]; opts: { shade:[r,g,b], heat, preview, result, time }
    // result: digital-model view — captured surfaces only, no gum.
    draw(items, opts) {
      if (!this.ok || !this.w) return;
      const gl = this.gl, u = this.u, a = this.a;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.useProgram(this.prog);
      gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
      gl.uniform1f(u.uShift, this.cam.shift);
      gl.uniform3fv(u.uEye, this.eye);
      gl.uniform3fv(u.uShade, opts.shade);
      gl.uniform1f(u.uHeat, opts.heat ? 1 : 0);
      gl.uniform1f(u.uPreview, opts.preview ? 1 : 0);
      gl.uniform1f(u.uResult, opts.result ? 1 : 0);
      gl.uniform1f(u.uTime, opts.time || 0);

      const attr = (loc, buf, size) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };

      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      items.forEach((it) => {
        const g = this.buffers(it.model);
        if (!g) return;
        gl.uniformMatrix4fv(u.uModel, false, it.matrix);
        attr(a.pos, g.pos, 3);
        attr(a.nrm, g.nrm, 3);
        attr(a.dyn, g.dyn, 4);
        gl.uniform1f(u.uMaterial, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.tri);
        gl.drawElements(gl.TRIANGLES, g.triCount, gl.UNSIGNED_SHORT, 0);
        if (opts.result) return;

        attr(a.pos, g.gumPos, 3);
        attr(a.nrm, g.gumNrm, 3);
        gl.disableVertexAttribArray(a.dyn);
        gl.vertexAttrib4f(a.dyn, 0, -1, 0, 0);
        gl.uniform1f(u.uMaterial, 1);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.gumIdx);
        gl.drawElements(gl.TRIANGLES, g.gumCount, gl.UNSIGNED_SHORT, 0);
      });
      gl.disable(gl.POLYGON_OFFSET_FILL);

      if (!opts.preview) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.uniform1f(u.uMaterial, 2);
        items.forEach((it) => {
          const g = this.buffers(it.model);
          if (!g) return;
          gl.uniformMatrix4fv(u.uModel, false, it.matrix);
          attr(a.pos, g.pos, 3);
          attr(a.nrm, g.nrm, 3);
          attr(a.dyn, g.dyn, 4);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.lines);
          gl.drawElements(gl.LINES, g.lineCount, gl.UNSIGNED_SHORT, 0);
        });
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
  }

  ISC.IDENTITY = IDENTITY;
  ISC.Renderer = Renderer;
})();
