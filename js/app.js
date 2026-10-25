/*
 * Intraoral Scanner Challenge — game flow, patient setup, input, timer, scan quality and personal best.
 * Steps of a round: upper arch → lower arch → right bite → left bite, all inside one time limit.
 * NEXT moves on at any progress; FINISH SCAN ends the session; both keep what was captured.
 * Every crown has five independent surfaces; the scanner only captures what it can see
 * (visibility rules live in capture.js).
 */
(function () {
  'use strict';

  let S = window.ISC_STRINGS; // current language (see setLanguage)
  const ISC = window.ISC;
  const CAP = ISC.Capture.CONFIG;

  /* ---------- Tuning (millimetres and seconds) ---------- */
  const DEFAULT_LIMIT_S = 190;
  const REHEARSAL_LIMIT_S = readRehearsalLimit(); // ?limit=…, or null
  const EXPOSURE_NEEDED = 0.045;    // weighted seconds a surface point must be seen
  const SPEED_FULL = 120;           // mm/s — best capture quality up to this speed
  const SPEED_ZERO = 280;           // mm/s — quality gain reaches zero
  const SPEED_LOST = 420;           // mm/s — scanner loses tracking, nothing is captured
  const QUALITY_RATE = 9;           // quality gained per weighted second at ideal speed
  const QUALITY_TO_CAPTURE = 0.25;  // below this a point is "rescan" (red) and does not count
  // Share of a surface's reachable points needed before its small gaps are filled in: a reasonable
  // coverage, not perfection. Proximal faces stay a little higher so a labial sweep of a neighbour
  // never completes them "for free".
  const FACE_COMPLETE = { top: 0.6, buccal: 0.6, lingual: 0.6, mesial: 0.7, distal: 0.7, bite: 0.6 };
  const FACE_ORDER = ['top', 'buccal', 'lingual', 'mesial', 'distal'];
  const TOUCH_OFFSET = 64;          // css px — the scanner head floats above the fingertip
  const STAGE_SWITCH_MS = 1500;
  const IDLE_HINT_MS = 1500;
  const WARN_REMAINING_MS = 30000;
  const STORAGE_KEY = 'isc.bestTimeMs.v1';
  const TAU = Math.PI * 2;

  const ARCH_VIEW = { yaw: 0, pitch: 0.98, shift: 0.07, zoom: 1.12 };
  const SETUP_VIEW = { yaw: 0, pitch: 1.05, shift: 0, zoom: 1.15 };
  const BITE_YAW = 1.22, BITE_PITCH = 0.1;
  const SHADES = [
    { key: 'natural', rgb: [0.945, 0.92, 0.866], css: '#F1EBDD' },
    { key: 'bright', rgb: [0.985, 0.98, 0.965], css: '#FBFAF6' },
    { key: 'ivory', rgb: [0.93, 0.878, 0.76], css: '#EDE0C2' },
    { key: 'yellow', rgb: [0.89, 0.81, 0.61], css: '#E3CF9C' }
  ];

  // ?limit=20 pre-selects a short custom limit for rehearsals.
  function readRehearsalLimit() {
    try {
      const n = parseInt(new URLSearchParams(window.location.search).get('limit'), 10);
      if (n >= 5 && n < DEFAULT_LIMIT_S) return n;
    } catch (e) { /* default */ }
    return null;
  }

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const screens = { home: $('screen-home'), setup: $('screen-setup'), game: $('screen-game'), result: $('screen-result') };
  const ui = {
    start: $('btn-start'),
    homeBest: $('home-best-value'),
    homeCanvas: $('home-canvas'),
    homePlane: $('home-plane'),
    homeWand: $('home-wand'),

    setupBack: $('btn-setup-back'),
    setupStart: $('btn-setup-start'),
    patientType: $('patient-type'),
    swatches: $('shade-swatches'),
    shadeName: $('shade-name'),
    setupArch: $('setup-arch'),
    timeMode: $('time-mode'),
    customTime: $('custom-time'),
    customSeconds: $('custom-seconds'),
    viewer: $('setup-viewer'),
    setupOverlay: $('setup-overlay'),
    viewerMsg: $('viewer-msg'),
    removedCount: $('removed-count'),
    sheet: $('tooth-sheet'),
    toothName: $('tooth-name'),
    toothMeta: $('tooth-meta'),
    toothToggle: $('btn-tooth-toggle'),
    restoreAll: $('btn-restore-all'),

    stage: $('stage'),
    resultStage: $('result-stage'),
    resultEmpty: $('result-empty'),
    resultSync: $('btn-result-sync'),
    overlay: $('game-overlay'),
    timer: $('timer'),
    timerLimit: $('timer-limit'),
    finish: $('btn-finish'),
    zoomView: $('zoom-view'),
    timerMain: $('timer-main'),
    timerTenths: $('timer-tenths'),
    archLabel: $('arch-label'),
    archStep: $('arch-step'),
    pct: $('progress-pct'),
    bar: $('progress-bar'),
    fill: $('progress-fill'),
    segments: $('segments'),
    faceStrip: $('face-strip'),
    pill: $('region-pill'),
    pillState: $('region-state'),
    pillName: $('region-name'),
    pillPct: $('region-pct'),
    instruction: $('instruction'),
    coach: $('coach'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerText: $('banner-text'),
    biteChipR: $('bite-chip-r'),
    biteChipL: $('bite-chip-l'),
    modeScan: $('mode-scan'),
    modeRotate: $('mode-rotate'),
    heat: $('btn-heat'),
    nextView: $('btn-next-view'),
    nextStep: $('btn-next'),
    nextStepLabel: $('btn-next-label'),
    quit: $('btn-quit'),
    toast: $('toast'),

    result: $('result'),
    ringBar: $('ring-bar'),
    ringPct: $('ring-pct'),
    resultTitle: $('result-title'),
    resultTagline: $('result-tagline'),
    newBest: $('badge-new'),
    statLabels: document.querySelectorAll('.stat__label'),
    statValues: document.querySelectorAll('.stat__value'),
    again: $('btn-again'),
    continueBtn: $('btn-continue'),
    stats: $('stats'),
    resultSteps: $('result-steps'),
    resultModel: $('result-model'),
    resultModelEmpty: $('result-model-empty'),
    change: $('btn-change'),
    home: $('btn-home')
  };

  /* ---------- Text ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function formatClock(ms) {
    const s = Math.floor(ms / 1000);
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }
  function formatPrecise(ms) {
    return formatClock(ms) + '.' + Math.floor((ms % 1000) / 100);
  }
  function fmt(str, vars) {
    return String(str || '').replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? vars[k] : m));
  }
  const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), S);

  const VARS = { seconds: DEFAULT_LIMIT_S, limit: formatClock(DEFAULT_LIMIT_S * 1000) };

  /* ---------- Language (pt-BR, en, fr, es) ---------- */
  // Chosen on the start screen; kept in the address (?lang=) rather than in storage, so the
  // personal best stays the only thing saved on the device. First visit: the phone's language.
  const LOCALES = window.ISC_LOCALES;
  function initialLanguage() {
    try {
      const q = new URLSearchParams(window.location.search).get('lang');
      if (q && LOCALES[q]) return q;
    } catch (e) { /* ignore */ }
    const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
    for (const p of prefs) {
      const l = String(p).toLowerCase();
      if (l.startsWith('pt')) return 'pt-BR';
      if (l.startsWith('fr')) return 'fr';
      if (l.startsWith('es')) return 'es';
      if (l.startsWith('en')) return 'en';
    }
    return 'en';
  }
  let lang = initialLanguage();

  function applyStaticTexts() {
    document.documentElement.lang = lang;
    document.title = S.pageTitle;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = fmt(lookup(n.dataset.i18n), VARS); });
    document.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', fmt(lookup(n.dataset.i18nAria), VARS)); });
  }

  S = LOCALES[lang];
  applyStaticTexts();

  function setText(node, value) {
    if (node._text !== value) { node._text = value; node.textContent = value; }
  }

  function faceName(face) {
    const t = face.tooth, k = face.key;
    if (k === 'bite') return S.faces.bite;
    if (k === 'top') return t.anterior ? S.faces.incisal : S.faces.occlusal;
    if (k === 'buccal') return t.anterior ? S.faces.labial : S.faces.buccal;
    if (k === 'lingual') return t.arch === 'upper' ? S.faces.palatal : S.faces.lingual;
    return S.faces[k];
  }

  let toastTimer = 0;
  function showToast(msg, ms) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), ms || 2800);
  }

  /* ---------- Personal best (the only thing stored on the device) ---------- */
  let memoryBest = null; // fallback when storage is blocked (e.g. some private modes)

  function readBest() {
    let stored = null;
    try {
      const v = parseInt(window.localStorage.getItem(STORAGE_KEY), 10);
      if (v > 0) stored = v;
    } catch (e) { /* storage unavailable */ }
    if (stored === null) return memoryBest;
    return memoryBest === null ? stored : Math.min(stored, memoryBest);
  }

  function saveBest(ms) {
    memoryBest = ms;
    try { window.localStorage.setItem(STORAGE_KEY, String(Math.round(ms))); } catch (e) { /* keep in memory */ }
  }

  /* ---------- Models, configuration and views ---------- */
  const MODELS = {};
  ['adult', 'pediatric'].forEach((d) => {
    MODELS[d] = { upper: ISC.buildArch(d, 'upper'), lower: ISC.buildArch(d, 'lower') };
    MODELS[d].biteMatrix = ISC.biteMatrix(MODELS[d].upper, MODELS[d].lower);
  });

  // Patient configuration for this session (kept in memory only).
  const config = {
    dentition: 'adult',
    shade: 'natural',
    removed: { adult: new Set(), pediatric: new Set() },
    setupArch: 'upper',
    selected: null,
    // Time: '190' | '120' | '60' (seconds), 'custom' (customSeconds) or 'none' (no limit).
    timeMode: REHEARSAL_LIMIT_S ? 'custom' : String(DEFAULT_LIMIT_S),
    customSeconds: REHEARSAL_LIMIT_S || 150
  };

  // Limit chosen in the setup, in ms; null = no time limit.
  function selectedLimitMs() {
    if (config.timeMode === 'none') return null;
    if (config.timeMode === 'custom') return Math.max(10, Math.min(3600, config.customSeconds | 0)) * 1000;
    return parseInt(config.timeMode, 10) * 1000;
  }

  const renderer = new ISC.Renderer();
  // SCAN RESULT panel: a second view showing only the surfaces actually captured. It follows the
  // original camera until the user rotates or zooms it; the link button re-syncs it.
  const resultView = new ISC.Renderer();
  let resultLinked = true;
  // ZOOM window: a third, display-only view centred on the point the scanner aims at.
  const zoomView = new ISC.Renderer();
  const homeView = new ISC.ArchView(ui.homeCanvas, { top: 8, right: 10, bottom: 8, left: 10 });
  homeView.setModel(ISC.buildArch('adult', 'upper'));

  const shadeRgb = () => SHADES.find((s) => s.key === config.shade).rgb;
  const dentModels = () => MODELS[config.dentition];
  const removedSet = () => config.removed[config.dentition];

  function applyRemoval() {
    ['upper', 'lower'].forEach((a) => {
      const m = dentModels()[a];
      m.teeth.forEach((t) => { t.removed = removedSet().has(t.id); });
      m.removedSet = removedSet();
      [renderer, resultView, zoomView].forEach((r) => { if (r.gpu.get(m)) r.setRemoved(m, removedSet()); });
    });
  }

  /* ---------- Overlay canvases ---------- */
  function syncOverlay(canvas) {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  /* ---------- Gestures (shared by the setup viewer and the game stage) ---------- */
  /*
   * Mouse: left button = scan (SCAN mode) or rotate / select; right (or middle) button + drag =
   * rotate the camera, never scans or selects; wheel = zoom.
   * Touch: one finger = scan (SCAN mode) or rotate; two fingers = rotate (drag together) or
   * zoom (pinch). The two-finger intent locks on the cumulative change since the gesture began
   * (browsers deliver each finger's move separately, so per-event jitter must not decide it).
   * Two-finger gestures never move the scanner; when one finger lifts, the remaining one waits
   * until the glass is clear (SCAN mode) so the scanner never jumps.
   */
  const LOCK_PX = 14;      // finger midpoint travel that means "rotate"
  const LOCK_ZOOM = 0.14;  // share of the finger spread change that means "pinch"

  // h.renderer: the camera this surface drives (default: the main view). h.onCamera: called
  // when the user starts moving that camera.
  function bindSurface(el, h) {
    const pts = new Map();
    let mode = null, last = null, start = null, scanId = null, orbitId = null;
    let pinch = null; // { d0, d, m0, lock }
    const view = () => {
      if (h.onCamera) h.onCamera();
      return h.renderer || renderer;
    };
    const pos = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const pair = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };
    const endScan = () => { if (scanId !== null) { scanId = null; h.onScanEnd(); } };

    el.addEventListener('pointerdown', (e) => {
      if (!h.enabled()) return;
      const mouse = e.pointerType === 'mouse';
      if (mouse && e.button > 2) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not critical */ }
      const p = pos(e);
      if (mouse && e.button !== 0) {
        // Right / middle button: camera only.
        endScan();
        pts.clear();
        pts.set(e.pointerId, p);
        mode = 'orbit'; orbitId = e.pointerId; last = p; start = null;
        return;
      }
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        if (h.scanMode && h.scanMode()) {
          scanId = e.pointerId;
          mode = 'scan';
          h.onScanStart(e);
        } else {
          mode = 'orbit'; orbitId = e.pointerId; last = p;
          start = { x: p.x, y: p.y, t: performance.now(), moved: false };
        }
      } else if (pts.size === 2) {
        endScan();
        const q = pair();
        pinch = { d: q.d, m: q.m, d0: q.d, m0: q.m, lock: null };
        mode = 'pinch';
        start = null;
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e);
      pts.set(e.pointerId, p);
      if (mode === 'scan' && e.pointerId === scanId) {
        h.onScanMove(e);
      } else if (mode === 'orbit' && e.pointerId === orbitId) {
        if (start && !start.moved && Math.hypot(p.x - start.x, p.y - start.y) > 6) start.moved = true;
        if (!start || start.moved) view().orbit(p.x - last.x, p.y - last.y);
        last = p;
      } else if (mode === 'pinch' && pts.size === 2) {
        const q = pair();
        if (!pinch.lock) {
          const moved = Math.hypot(q.m.x - pinch.m0.x, q.m.y - pinch.m0.y);
          const spread = Math.abs(q.d - pinch.d0) / Math.max(pinch.d0, 90);
          if (spread > LOCK_ZOOM) pinch.lock = 'zoom';
          else if (moved > LOCK_PX) pinch.lock = 'rotate';
        }
        if (pinch.lock === 'zoom') view().zoomBy(q.d / pinch.d);
        else if (pinch.lock === 'rotate') view().orbit(q.m.x - pinch.m.x, q.m.y - pinch.m.y);
        pinch.d = q.d;
        pinch.m = q.m;
      }
    });

    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (e.pointerId === scanId) { endScan(); mode = null; }
      if (mode === 'orbit' && e.pointerId === orbitId) {
        if (pts.size === 0 && start && !start.moved && performance.now() - start.t < 450 && h.onTap) h.onTap(p);
        mode = null; orbitId = null;
      }
      if (mode === 'pinch' && pts.size === 1) {
        // Re-evaluate: the remaining finger rotates (ROTATE mode / setup) or waits (SCAN mode).
        const [id, rest] = [...pts.entries()][0];
        if (h.scanMode && h.scanMode()) mode = 'hold';
        else { mode = 'orbit'; orbitId = id; last = rest; }
        start = null;
        pinch = null;
      }
      if (pts.size === 0) { mode = null; start = null; pinch = null; orbitId = null; }
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => el.addEventListener(type, end));

    el.addEventListener('wheel', (e) => {
      if (!h.enabled()) return;
      e.preventDefault();
      view().zoomBy(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.0022));
    }, { passive: false });

    // Only inside the 3D area: no page scroll, browser zoom or context menu.
    const block = (e) => { if (!(e.target && e.target.closest && e.target.closest('button'))) e.preventDefault(); };
    el.addEventListener('touchstart', block, { passive: false });
    el.addEventListener('touchmove', block, { passive: false });
    el.addEventListener('contextmenu', block);

    return {
      reset() {
        endScan();
        pts.clear();
        mode = null; start = null; pinch = null; orbitId = null;
      }
    };
  }

  function bindViewTools(root) {
    root.querySelectorAll('[data-action]').forEach((b) => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'zoom-in') renderer.zoomBy(1.25, true);
        else if (a === 'zoom-out') renderer.zoomBy(1 / 1.25, true);
        else if (a === 'recenter') renderer.recenter();
      });
    });
  }

  /* ---------- Screens ---------- */
  let screenName = 'home';

  function showScreen(name) {
    screenName = name;
    Object.keys(screens).forEach((k) => screens[k].classList.toggle('is-active', k === name));
    document.body.classList.toggle('in-game', name === 'game');
    if (name === 'home') { renderHomeBest(); startHome(); } else stopHome();
    if (name === 'setup') startSetupLoop(); else stopSetupLoop();
  }

  function renderHomeBest() {
    const best = readBest();
    ui.homeBest.textContent = best ? formatPrecise(best) : S.noBest;
    ui.homeBest.classList.toggle('is-empty', !best);
  }

  /* ================= PATIENT SETUP ================= */

  SHADES.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.dataset.value = s.key;
    b.innerHTML = '<i style="background:' + s.css + '"></i><span></span>';
    b.querySelector('span').dataset.i18n = 'shades.' + s.key; // re-labelled with the language
    b.querySelector('span').textContent = S.shades[s.key];
    b.addEventListener('click', () => { config.shade = s.key; renderSetupUI(); });
    ui.swatches.appendChild(b);
  });

  // Language picker (start screen).
  const langPicker = $('lang-picker');
  window.ISC_LANGUAGES.forEach((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.value = l.code;
    b.lang = l.code;
    b.title = l.label;
    b.setAttribute('aria-label', l.label);
    b.textContent = l.short;
    b.addEventListener('click', () => setLanguage(l.code));
    langPicker.appendChild(b);
  });

  function setLanguage(code) {
    if (!LOCALES[code]) return;
    lang = code;
    S = LOCALES[code];
    applyStaticTexts();
    setRadio(langPicker, lang);
    renderHomeBest();
    stripKey = '';
    if (screenName === 'setup') renderSetupUI();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', code);
      window.history.replaceState(null, '', url.toString());
    } catch (e) { /* address unchanged */ }
  }
  setRadio(langPicker, lang);

  function setRadio(group, value) {
    group.querySelectorAll('[role="radio"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  }

  function setupModel() {
    return dentModels()[config.setupArch];
  }

  function setupCameraView(instant) {
    const m = setupModel();
    renderer.setView(Object.assign({ tx: m.center3[0], ty: m.center3[1], tz: m.center3[2], radius: m.radius3 }, SETUP_VIEW), instant);
  }

  function toothLabel(t) {
    const arch = t.arch === 'upper' ? S.archUpperShort : S.archLowerShort;
    const side = t.side < 0 ? S.sideRight : S.sideLeft;
    return arch + ' ' + side + ' · ' + S.toothNames[t.name];
  }

  function renderSetupUI() {
    setRadio(ui.patientType, config.dentition);
    setRadio(ui.swatches, config.shade);
    setRadio(ui.setupArch, config.setupArch);
    setRadio(ui.timeMode, config.timeMode);
    ui.customTime.hidden = config.timeMode !== 'custom';
    if (document.activeElement !== ui.customSeconds) ui.customSeconds.value = String(config.customSeconds);
    ui.shadeName.textContent = S.shades[config.shade];
    const n = removedSet().size;
    ui.removedCount.textContent = n ? fmt(S.removedCount, { n }) : S.removedNone;
    ui.restoreAll.disabled = n === 0;

    const t = config.selected && setupModel().teeth.find((k) => k.id === config.selected);
    ui.sheet.classList.toggle('is-selected', !!t);
    ui.toothToggle.hidden = !t;
    if (t) {
      ui.toothName.textContent = S.tooth + ' ' + t.id + (t.removed ? ' · ' + S.toothRemovedTag : '');
      ui.toothMeta.textContent = toothLabel(t);
      ui.toothToggle.textContent = t.removed ? S.restoreTooth : S.removeTooth;
      ui.toothToggle.classList.toggle('is-restore', t.removed);
    } else {
      ui.toothName.textContent = S.selectTooth;
      ui.toothMeta.textContent = '';
    }
    setupDirty = true;
  }

  function openSetup() {
    config.selected = null;
    applyRemoval();
    showScreen('setup');
    if (!renderer.ok) {
      ui.viewerMsg.hidden = false;
      ui.viewerMsg.textContent = S.noWebgl;
      ui.setupStart.disabled = true;
      return;
    }
    renderer.attach(ui.viewer);
    renderer.resize();
    setupCameraView(true);
    renderSetupUI();
  }

  ui.patientType.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b || b.dataset.value === config.dentition) return;
    config.dentition = b.dataset.value;
    config.selected = null;
    applyRemoval();
    setupCameraView(false);
    renderSetupUI();
  });

  ui.timeMode.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    config.timeMode = b.dataset.value;
    renderSetupUI();
  });
  ui.customSeconds.addEventListener('change', () => {
    const n = parseInt(ui.customSeconds.value, 10);
    config.customSeconds = Math.max(10, Math.min(3600, isFinite(n) ? n : 150));
    renderSetupUI();
  });

  ui.setupArch.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b || b.dataset.value === config.setupArch) return;
    config.setupArch = b.dataset.value;
    config.selected = null;
    setupCameraView(false);
    renderSetupUI();
  });

  function canRemove(t) {
    if (!t.posterior) return true;
    return setupModel().teeth.some((k) => k !== t && k.posterior && k.side === t.side && !k.removed);
  }

  ui.toothToggle.addEventListener('click', () => {
    const t = setupModel().teeth.find((k) => k.id === config.selected);
    if (!t) return;
    if (t.removed) removedSet().delete(t.id);
    else if (canRemove(t)) removedSet().add(t.id);
    else { showToast(S.keepPosterior, 3600); return; }
    applyRemoval();
    renderSetupUI();
  });

  ui.restoreAll.addEventListener('click', () => {
    removedSet().clear();
    applyRemoval();
    renderSetupUI();
  });

  ui.setupBack.addEventListener('click', () => showScreen('home'));
  ui.setupStart.addEventListener('click', startGame);
  bindViewTools(ui.viewer);

  // Picks the tooth whose crown (or empty space) projects closest to the tap.
  function pickTooth(p) {
    const m = setupModel(), mvp = renderer.viewProj;
    let best = null, bestD = 36;
    m.teeth.forEach((t) => {
      const s = renderer.project(mvp, t.cx, t.removed ? 1 : t.h * 0.75, -t.cy);
      if (!s) return;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bestD) { bestD = d; best = t; }
    });
    config.selected = best && best.id !== config.selected ? best.id : null;
    renderSetupUI();
  }

  bindSurface(ui.viewer, {
    enabled: () => screenName === 'setup' && renderer.ok,
    onTap: pickTooth
  });

  let setupRaf = 0, setupLast = 0, setupDirty = true;

  function startSetupLoop() {
    if (!setupRaf) { setupLast = 0; setupRaf = requestAnimationFrame(setupFrame); }
  }

  function stopSetupLoop() {
    if (setupRaf) cancelAnimationFrame(setupRaf);
    setupRaf = 0;
  }

  function setupFrame(now) {
    setupRaf = 0;
    if (screenName !== 'setup' || !renderer.ok) return;
    const dt = setupLast ? Math.min((now - setupLast) / 1000, 0.05) : 0;
    setupLast = now;
    renderer.resize();
    renderer.update(dt);
    const m = setupModel();
    if (setupDirty) {
      // Preview look: full shade, only the selected tooth glows.
      const d = m.dyn, vt = m.mesh.vTooth;
      for (let v = 0; v < m.mesh.count; v++) {
        const o = v * 4;
        d[o] = 1; d[o + 1] = -1; d[o + 2] = m.teeth[vt[v]].id === config.selected ? 1 : 0; d[o + 3] = 0;
      }
      renderer.uploadDyn(m);
      setupDirty = false;
    }
    renderer.draw([{ model: m, matrix: ISC.IDENTITY }], { shade: shadeRgb(), preview: true, time: now / 1000 });

    // Removed teeth: dashed outline marking the empty space.
    const ctx = syncOverlay(ui.setupOverlay), mvp = renderer.viewProj;
    m.teeth.forEach((t) => {
      if (!t.removed) return;
      const selected = t.id === config.selected;
      ctx.beginPath();
      t.outline.forEach(([x, y], i) => {
        const s = renderer.project(mvp, x, 1.1, -y);
        if (!s) return;
        if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = selected ? 2.5 : 1.5;
      ctx.strokeStyle = selected ? '#FF6A13' : '#8E959F';
      ctx.stroke();
      ctx.setLineDash([]);
    });
    setupRaf = requestAnimationFrame(setupFrame);
  }

  /* ================= GAME ================= */

  const game = {
    phase: 'idle', // idle | ready | running | transition | ended
    stageIndex: 0,
    stages: [],
    total: 0,
    captured: 0,
    startPerf: 0,
    startDate: 0,
    endMs: 0,
    raf: 0,
    lastFrame: 0,
    limitTimer: 0,
    switchTimer: 0,
    resultTimer: 0,
    flashes: [],
    bursts: [],
    heat: false,
    mode: 'scan',
    segKey: '',
    frame: 0,
    aim: null,        // last scanner evaluation (capture.js)
    status: null,     // capturing | covered | blocked | out | lost
    focusFace: null,  // surface currently in the scanner field
    guideVisible: true,
    limitMs: DEFAULT_LIMIT_S * 1000, // this session's limit; null = no time limit
    result: null,       // how the round ended: 'win' | 'timeout' | 'finish'
    clockStarted: false,
    continued: false,   // resumed after FINISH SCAN (completes normally, but sets no record)
    canContinue: false
  };

  const limited = () => game.limitMs !== null;
  const timeUp = (t) => limited() && t >= game.limitMs;

  const input = {
    id: null,
    type: 'touch',
    active: false,
    tip: null,
    finger: null,
    lastTip: null,
    speed: 0,
    tooFast: false,
    lastMoveAt: 0
  };

  const isLive = () => game.phase === 'running' || game.phase === 'transition';
  const currentStage = () => game.stages[game.stageIndex];
  const isArch = (stage) => stage.type === 'arch';

  // Wall-clock based: animation frames never drive the timer. Taking the larger of the
  // monotonic clock and Date means a suspended tab cannot freeze or rewind the time.
  function elapsedMs() {
    if (game.phase === 'idle' || game.phase === 'ready') return 0;
    if (game.phase === 'ended') return game.endMs;
    return Math.max(performance.now() - game.startPerf, Date.now() - game.startDate, 0);
  }

  function overallPct() {
    if (game.captured >= game.total) return 100;
    return Math.min(99, Math.floor((100 * game.captured) / game.total));
  }

  const toothDone = (stage, t) => (isArch(stage) ? t.doneA : t.doneB);
  const facesOf = (stage, t) => (isArch(stage) ? FACE_ORDER.map((k) => t.faces[k]) : [t.biteFace]);

  function targetRegion(stage) {
    if (isArch(stage)) return stage.regions.find((r) => r.captured < r.total) || null;
    return stage.region.captured < stage.region.total ? stage.region : null;
  }

  function targetTooth(stage) {
    const r = targetRegion(stage);
    return r ? r.teeth.find((t) => !toothDone(stage, t)) || null : null;
  }

  function drawItems(stage) {
    const dm = dentModels();
    if (isArch(stage)) return [{ model: stage.model, matrix: ISC.IDENTITY }];
    return [{ model: dm.lower, matrix: ISC.IDENTITY }, { model: dm.upper, matrix: dm.biteMatrix }];
  }

  function resetSurfaces() {
    ['upper', 'lower'].forEach((a) => {
      dentModels()[a].teeth.forEach((t) => {
        t.doneA = t.doneB = false;
        t.regA = t.regB = null;
        FACE_ORDER.map((k) => t.faces[k]).concat([t.biteFace]).forEach((f) => { f.captured = 0; f.done = !f.required; });
        t.points.concat(t.bitePoints).forEach((p) => { p.exp = 0; p.qual = 0; p.cap = false; p.seen = -1; });
      });
    });
  }

  // Required work for the chosen patient: every reachable surface of the present teeth, then
  // the bite on each side.
  function buildStages() {
    const dm = dentModels();
    const archStage = (model) => {
      const present = model.teeth.filter((t) => !t.removed);
      const regions = model.dent.regionKeys
        .map((key, i) => ({ key, teeth: present.filter((t) => t.region === i).sort((a, b) => a.cx - b.cx), total: 0, captured: 0 }))
        .filter((r) => r.teeth.length);
      regions.forEach((r) => r.teeth.forEach((t) => {
        t.regA = r;
        FACE_ORDER.forEach((k) => { r.total += t.faces[k].total; });
        t.doneA = FACE_ORDER.every((k) => t.faces[k].done);
      }));
      return {
        key: model.key, type: 'arch', model, regions,
        teeth: [].concat(...regions.map((r) => r.teeth)),
        occs: present.map((t) => t.occA),
        pointsOf: (t) => t.points,
        centerOf: (t) => [t.occA.wx, t.occA.wy, t.occA.wz],
        minElev: CAP.MIN_ELEV,
        total: regions.reduce((a, r) => a + r.total, 0), captured: 0
      };
    };
    const present = dm.upper.teeth.concat(dm.lower.teeth).filter((t) => !t.removed);
    const biteRegion = (side) => {
      const teeth = present.filter((t) => t.posterior && t.side === side && t.biteFace.required);
      const r = { key: side < 0 ? 'biteR' : 'biteL', side, teeth, total: 0, captured: 0 };
      teeth.forEach((t) => { t.regB = r; r.total += t.biteFace.total; });
      return r;
    };
    const bR = biteRegion(-1), bL = biteRegion(1);
    const biteStage = (r) => ({
      key: r.key, type: 'bite', side: r.side, region: r, regions: [bR, bL], teeth: r.teeth,
      occs: present.map((t) => t.occB),
      pointsOf: (t) => t.bitePoints,
      centerOf: (t) => [t.occB.wx, t.occB.wy, t.occB.wz],
      minElev: null,
      total: r.total, captured: 0
    });
    return [archStage(dm.upper), archStage(dm.lower), biteStage(bR), biteStage(bL)];
  }

  function stageView(stage) {
    if (isArch(stage)) {
      const m = stage.model;
      return Object.assign({ tx: m.center3[0], ty: m.center3[1], tz: m.center3[2], radius: m.radius3 }, ARCH_VIEW);
    }
    // Bite: look at the back teeth of that side, from the cheek, slightly from the front.
    const pts = [];
    stage.teeth.forEach((t) => t.bitePoints.forEach((p) => pts.push([p.wx, p.wy, p.wz])));
    const c = [0, 1, 2].map((i) => pts.reduce((a, p) => a + p[i], 0) / pts.length);
    const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]))) + 7;
    return { tx: c[0], ty: c[1], tz: c[2], radius, yaw: stage.side < 0 ? -BITE_YAW : BITE_YAW, pitch: BITE_PITCH, shift: 0.02 };
  }

  /* ---------- Round lifecycle ---------- */
  function clearTimers() {
    clearTimeout(game.limitTimer);
    clearTimeout(game.switchTimer);
    clearTimeout(game.resultTimer);
    game.limitTimer = game.switchTimer = game.resultTimer = 0;
  }

  function stopLoop() {
    if (game.raf) cancelAnimationFrame(game.raf);
    game.raf = 0;
  }

  function startLoop() {
    if (game.raf) return;
    game.lastFrame = 0;
    game.raf = requestAnimationFrame(frame);
  }

  function releasePointer() {
    input.id = null;
    input.active = false;
    input.lastTip = null;
    input.speed = 0;
    input.tooFast = false;
    game.aim = null;
    game.status = null;
    game.focusFace = null;
  }

  function setMode(mode) {
    game.mode = mode;
    ui.modeScan.setAttribute('aria-checked', String(mode === 'scan'));
    ui.modeRotate.setAttribute('aria-checked', String(mode === 'rotate'));
  }

  function setHeat(on) {
    game.heat = on;
    ui.heat.setAttribute('aria-pressed', String(on));
    screens.game.classList.toggle('is-heat', on);
  }

  function startGame() {
    if (!renderer.ok) { openSetup(); return; }
    clearTimers();
    stopLoop();
    applyRemoval();
    ISC.Capture.prepare(dentModels());
    resetSurfaces();
    releasePointer();
    stageSurface.reset();
    game.stages = buildStages();
    game.total = game.stages.reduce((a, s) => a + s.total, 0);
    game.captured = 0;
    game.stageIndex = 0;
    game.endMs = 0;
    game.flashes.length = 0;
    game.bursts.length = 0;
    game.segKey = '';
    game.phase = 'ready';
    game.limitMs = selectedLimitMs();
    game.result = null;
    game.clockStarted = false;
    game.continued = false;
    game.canContinue = false;
    setMode('scan');
    setHeat(false);

    showScreen('game');
    screens.game.classList.remove('is-running', 'is-bite');
    ui.coach.classList.remove('is-hidden');
    ui.banner.classList.remove('is-visible');
    ui.timerLimit.textContent = limited() ? '/ ' + formatClock(game.limitMs) : S.noLimitShort;
    attachGameViews();
    renderer.setView(stageView(currentStage()), true);
    updateHud();
    startLoop();
  }

  function attachGameViews() {
    renderer.attach(ui.stage);
    renderer.resize();
    ui.resultStage.hidden = !resultView.ok;
    if (resultView.ok) {
      resultView.attach(ui.resultStage);
      resultView.resize();
      setResultLinked(true);
    }
    if (zoomView.ok) zoomView.attach(ui.zoomView);
  }

  function beginClock() {
    game.startPerf = performance.now();
    game.startDate = Date.now();
    game.phase = 'running';
    game.clockStarted = true;
    screens.game.classList.add('is-running');
    ui.coach.classList.add('is-hidden');
    scheduleLimitCheck();
  }

  // Backup for the frame loop: ends the round on time even if frames are throttled.
  function scheduleLimitCheck() {
    clearTimeout(game.limitTimer);
    if (!limited()) return;
    const remaining = game.limitMs - elapsedMs();
    game.limitTimer = setTimeout(() => {
      if (!isLive()) return;
      if (timeUp(elapsedMs())) endRound('timeout');
      else scheduleLimitCheck();
    }, Math.max(0, remaining) + 15);
  }

  function stageComplete(t) {
    const stage = currentStage();
    // Last step done: a win only if no earlier step was left incomplete (NEXT skips are partial).
    if (game.stageIndex === game.stages.length - 1) { endRound(game.captured >= game.total ? 'win' : 'finish', t); return; }
    const next = game.stages[game.stageIndex + 1];
    game.phase = 'transition';
    input.lastTip = null;
    ui.bannerTitle.textContent = S.stageDone[stage.key];
    ui.bannerText.textContent = S.stageNext[next.key];
    ui.banner.classList.add('is-visible');
    game.switchTimer = setTimeout(() => {
      if (game.phase === 'transition') advanceStage();
    }, STAGE_SWITCH_MS);
  }

  function advanceStage() {
    const next = game.stages[game.stageIndex + 1];
    game.stageIndex++;
    game.flashes.length = 0;
    game.bursts.length = 0;
    renderer.setView(stageView(next), false);
    setResultLinked(true); // the next step starts with both panels on the same view
    screens.game.classList.toggle('is-bite', !isArch(next));
    // Skipped before the first touch: the clock still starts on the first touch of the new step.
    game.phase = game.clockStarted ? 'running' : 'ready';
    input.lastTip = null;
    ui.banner.classList.remove('is-visible');
  }

  /*
   * NEXT: leaves the current step at any progress and moves to the next one (upper → lower →
   * right bite → left bite → results). Everything captured stays as it is: nothing is filled in,
   * and skipped surfaces keep counting as not scanned. FINISH SCAN instead ends the whole session.
   */
  function nextStep() {
    if (game.phase !== 'ready' && !isLive()) return;
    if (game.stageIndex >= game.stages.length - 1) { endRound('finish'); return; }
    clearTimeout(game.switchTimer);
    game.switchTimer = 0;
    const skipped = currentStage().captured < currentStage().total;
    releasePointer();
    stageSurface.reset();
    advanceStage();
    if (skipped) showToast(S.stepAdvanced);
    updateHud();
  }

  // Per-step outcome for the results screen, from what was really captured.
  function stepSummary(stage) {
    if (!stage.total) return { text: '—', cls: '' }; // nothing to scan in this step (teeth removed)
    if (stage.total && stage.captured >= stage.total) return { text: S.stepComplete, cls: 'is-done' };
    if (!stage.captured) return { text: S.stepNotDone, cls: 'is-skipped' };
    return { text: Math.min(99, Math.floor((100 * stage.captured) / stage.total)) + '%', cls: 'is-partial' };
  }

  // Scan quality of the surfaces actually captured (a partial scan is judged on what it has;
  // for a complete scan this is every required surface). null when nothing was captured.
  function averageQuality() {
    let sum = 0, n = 0;
    game.stages.forEach((st) => st.teeth.forEach((t) => facesOf(st, t).forEach((f) => f.req.forEach((p) => {
      if (!f.required || !p.cap) return;
      sum += Math.min(1, p.qual);
      n++;
    }))));
    return n ? Math.round((100 * sum) / n) : null;
  }

  /*
   * Ends the round. kind: 'win' (every required surface of every step, inside the limit),
   * 'timeout' (limit reached) or 'finish' (FINISH SCAN, any progress). Everything captured is
   * kept; only an uninterrupted win can set the personal best.
   */
  function endRound(kind, t) {
    const finishingReady = kind === 'finish' && game.phase === 'ready';
    if (!isLive() && !finishingReady) return;
    const elapsed = elapsedMs();
    game.result = kind;
    game.endMs = kind === 'timeout' ? game.limitMs : kind === 'win' && limited() ? Math.min(t, game.limitMs) : kind === 'win' ? t : elapsed;
    game.phase = 'ended';
    clearTimers();
    stopLoop();
    releasePointer();
    stageSurface.reset();
    screens.game.classList.remove('is-running');
    ui.banner.classList.remove('is-visible');

    const win = kind === 'win';
    const pct = win ? 100 : overallPct();
    const quality = averageQuality();
    let best = readBest();
    let isNewBest = false;
    if (win && !game.continued && (best === null || game.endMs < best)) {
      saveBest(game.endMs);
      best = game.endMs;
      isNewBest = true;
    }
    // A finished (partial) scan can be resumed in the step where it stopped; a timed-out one cannot
    // get extra time, and steps left behind with NEXT are not reopened.
    game.canContinue = kind === 'finish' && currentStage().captured < currentStage().total;

    updateHud();
    draw(performance.now());
    game.resultTimer = setTimeout(() => showResult(kind, game.endMs, pct, quality, best, isNewBest), win ? 900 : kind === 'finish' ? 150 : 700);
  }

  function finishScan() {
    endRound('finish');
  }

  // Resumes a finished scan exactly where it stopped: same surfaces, qualities and progress; the
  // clock continues from the time already used (no time added, none lost).
  function continueScan() {
    if (!game.canContinue || game.phase !== 'ended') return;
    game.canContinue = false;
    game.continued = true;
    game.result = null;
    showScreen('game');
    attachGameViews();
    if (game.clockStarted) {
      game.startPerf = performance.now() - game.endMs;
      game.startDate = Date.now() - game.endMs;
      game.phase = 'running';
      screens.game.classList.add('is-running');
      scheduleLimitCheck();
    } else {
      game.phase = 'ready';
    }
    // Finished during the "step captured" banner: move on to the next step now.
    const stage = currentStage();
    if (stage.captured >= stage.total && game.stageIndex < game.stages.length - 1) advanceStage();
    updateHud();
    startLoop();
  }

  function abortRound() {
    clearTimers();
    stopLoop();
    releasePointer();
    stageSurface.reset();
    game.phase = 'idle';
    showScreen('home');
  }

  /* ---------- Frame loop ---------- */
  function frame(now) {
    game.raf = 0;
    const dt = game.lastFrame ? Math.min((now - game.lastFrame) / 1000, 0.05) : 0;
    game.lastFrame = now;
    renderer.resize();
    renderer.update(dt);

    if (isLive()) {
      const t = elapsedMs();
      if (timeUp(t)) { endRound('timeout'); return; }
      if (game.phase === 'running' && !game.manualTicks) scanStep(dt, t);
      if (game.phase === 'ended') return;
    }
    if (game.phase === 'ready' || isLive()) {
      updateHud();
      draw(now);
      game.raf = requestAnimationFrame(frame);
    }
  }

  function markCaptured(stage, p) {
    p.cap = true;
    if (!p.required) return;
    const f = p.face, t = f.tooth;
    f.captured++;
    (isArch(stage) ? t.regA : t.regB).captured++;
    stage.captured++;
    game.captured++;
  }

  /*
   * Scanner capture for one frame. capture.js decides which surface points the scanner can see;
   * here they gain exposure and quality. Quality grows faster with slow, steady movement, a
   * square-on view and dwell time. Points seen but still below the capture quality are red
   * ("rescan") on the quality map and do not count until scanned again.
   */
  function scanStep(dt, t) {
    const stage = currentStage();
    game.frame++;
    game.aim = null;
    game.status = null;
    game.focusFace = null;
    input.tooFast = false;
    if (!input.active || !input.tip || game.mode !== 'scan') {
      input.lastTip = null;
      input.speed = 0;
      return;
    }

    const ppm = renderer.pxPerMm();
    const tip = input.tip;
    if (input.lastTip && dt > 0) {
      const inst = Math.hypot(tip.x - input.lastTip.x, tip.y - input.lastTip.y) / ppm / dt;
      input.speed = input.speed * 0.65 + inst * 0.35;
    }
    input.lastTip = { x: tip.x, y: tip.y };
    const sq = Math.max(0, Math.min(1, (SPEED_ZERO - input.speed) / (SPEED_ZERO - SPEED_FULL)));
    const lost = input.speed > SPEED_LOST;
    const rate = Math.max(0.3, sq);
    input.tooFast = sq < 0.4;

    const ray = renderer.ray(tip.x, tip.y);
    const res = ISC.Capture.evaluate(stage.teeth, stage.occs, ray.o, ray.d, stage.pointsOf, stage.centerOf, stage.minElev);
    game.aim = { res, ray };

    const fresh = [], touched = new Set(), counts = new Map();
    let pending = 0;
    res.visible.forEach(({ p, weight, cosA }) => {
      p.seen = game.frame;
      if (p.required) counts.set(p.face, (counts.get(p.face) || 0) + 1);
      if (lost || dt <= 0) return;
      const w = dt * weight;
      p.exp += w * rate;
      p.qual = Math.min(1, p.qual + w * QUALITY_RATE * sq * sq * (0.5 + 0.5 * cosA));
      if (!p.cap && p.exp >= EXPOSURE_NEEDED && p.qual >= QUALITY_TO_CAPTURE) {
        markCaptured(stage, p);
        fresh.push(p);
        touched.add(p.face);
      }
      if (!p.cap) pending++;
    });

    touched.forEach((f) => {
      if (f.required && !f.done && f.captured / f.total >= FACE_COMPLETE[f.key]) completeFace(stage, f);
    });

    let best = 0;
    counts.forEach((n, f) => { if (n > best) { best = n; game.focusFace = f; } });

    if (lost) game.status = 'lost';
    else if (res.state !== 'ok') game.status = res.state;
    else game.status = pending || fresh.length ? 'capturing' : 'covered';

    if (fresh.length) {
      const now = performance.now();
      fresh.forEach((p) => game.flashes.push({ p, t: now }));
      if (game.flashes.length > 240) game.flashes.splice(0, game.flashes.length - 240);
    }

    if (stage.captured >= stage.total) stageComplete(t);
  }

  // Gap filling: once most of a surface is captured, its small remaining holes (including spots no
  // scanner angle can reach, like tight contacts) are closed with the surface's average quality.
  function completeFace(stage, f) {
    const caps = f.req.filter((p) => p.cap);
    const mean = caps.reduce((a, p) => a + p.qual, 0) / Math.max(1, caps.length);
    f.points.forEach((p) => {
      if (p.cap) return;
      p.exp = Math.max(p.exp, EXPOSURE_NEEDED);
      p.qual = Math.max(p.qual, mean);
      markCaptured(stage, p);
    });
    f.done = true;
    const t = f.tooth;
    if (isArch(stage)) t.doneA = FACE_ORDER.every((k) => t.faces[k].done);
    else t.doneB = true;
    const c = centroid(f.points, () => true);
    if (c) game.bursts.push({ c, r: 2.2, t: performance.now() });
    // Haptic tick (Android); only after a real tap, so browsers never block or log it.
    const ua = navigator.userActivation;
    if (navigator.vibrate && (!ua || ua.hasBeenActive)) { try { navigator.vibrate(8); } catch (e) { /* ignore */ } }
  }

  // Could the scanner capture this point from the current view? Same rules as capture.js, with the
  // scanner looking along the camera direction: facing it, not from below the gum, not hidden.
  function capturableNow(stage, p) {
    const eye = renderer.eye;
    let vx = eye[0] - p.wx, vy = eye[1] - p.wy, vz = eye[2] - p.wz;
    const l = Math.hypot(vx, vy, vz);
    vx /= l; vy /= l; vz /= l;
    if (p.wnx * vx + p.wny * vy + p.wnz * vz < ISC.Capture.cosTolFor(p, 2)) return false;
    if (stage.minElev !== null && vy < stage.minElev) return false;
    return !ISC.Capture.blocked(stage.occs, p.wx + p.wnx * 0.25, p.wy + p.wny * 0.25, p.wz + p.wnz * 0.25, vx, vy, vz, ISC.Capture.SIGHT, p.tooth);
  }

  function centroid(points, filter) {
    let x = 0, y = 0, z = 0, n = 0;
    points.forEach((p) => {
      if (!filter(p)) return;
      x += p.wx; y += p.wy; z += p.wz; n++;
    });
    return n ? [x / n, y / n, z / n] : null;
  }

  /* ---------- Guided view ---------- */
  // Eases the camera to face the next pending surface (proximal faces from an oblique angle,
  // through the embrasure, never along the contact).
  function guidedView() {
    const stage = currentStage();
    const tooth = targetTooth(stage);
    if (!tooth) return;
    const cur = [renderer.eye[0] - renderer.cam.tx, renderer.eye[1] - renderer.cam.ty, renderer.eye[2] - renderer.cam.tz];
    const cl = Math.hypot(...cur) || 1;
    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
    const buccal = [tooth.nx, 0, -tooth.ny];
    const cosTolFor = (p) => ISC.Capture.cosTolFor(p, 2);
    // How many pending points of the face a scanner looking along -dir would really see.
    const seenFrom = (pend, dir) => pend.filter((p) => {
      if (p.wnx * dir[0] + p.wny * dir[1] + p.wnz * dir[2] < cosTolFor(p)) return false;
      if (stage.minElev !== null && dir[1] < stage.minElev) return false;
      return !ISC.Capture.blocked(stage.occs, p.wx + p.wnx * 0.25, p.wy + p.wny * 0.25, p.wz + p.wnz * 0.25, dir[0], dir[1], dir[2], ISC.Capture.SIGHT, p.tooth);
    }).length;
    let best = null, bestScore = -Infinity;
    facesOf(stage, tooth).forEach((f) => {
      if (!f.required || f.done) return;
      const pend = f.req.filter((p) => !p.cap);
      if (!pend.length) return;
      const n = norm([pend.reduce((a, p) => a + p.wnx, 0), pend.reduce((a, p) => a + p.wny, 0), pend.reduce((a, p) => a + p.wnz, 0)]);
      const candidates = [];
      if (f.key === 'mesial' || f.key === 'distal') {
        // Through the cheek-side or the tongue-side embrasure, never along the contact.
        [1, -1].forEach((side) => [0.25, 0.6].forEach((up) => candidates.push(norm([n[0] + buccal[0] * 0.5 * side, n[1] + up, n[2] + buccal[2] * 0.5 * side]))));
      } else if (f.key === 'top') {
        [0.25, -0.25].forEach((k) => candidates.push(norm([n[0] + buccal[0] * k, n[1] + 0.2, n[2] + buccal[2] * k])));
      } else if (f.key === 'bite') {
        candidates.push(norm([n[0], 0.12, n[2]]));
      } else {
        [0.3, 0.7].forEach((up) => candidates.push(norm([n[0], n[1] + up, n[2]])));
      }
      // Directions proven (by the reach test) to see specific pending points: stragglers are never stuck.
      pend.filter((p) => p.reachDir).slice(0, 6).forEach((p) => candidates.push(p.reachDir));
      candidates.forEach((dir) => {
        // Most points actually visible first, then the least rotation from the current view.
        const seen = seenFrom(pend, dir);
        const score = seen * (1.2 + (dir[0] * cur[0] + dir[1] * cur[1] + dir[2] * cur[2]) / cl);
        if (seen && score > bestScore) { bestScore = score; best = { f, dir, c: centroid(pend, () => true) }; }
      });
    });
    let exact = false;
    if (!best) {
      // Hard spots (deep embrasures): use the direction the reach test proved to see the point.
      const p = [].concat(...facesOf(stage, tooth).filter((f) => f.required && !f.done).map((f) => f.req))
        .find((q) => !q.cap && q.reachDir);
      if (!p) return;
      best = { dir: p.reachDir, c: [p.wx, p.wy, p.wz] };
      exact = true;
    }
    const lo = isArch(stage) && !exact ? 0.02 : -0.35; // arch scans: never from below the gum line
    const pitch = Math.max(lo, Math.min(1.45, Math.asin(Math.max(-1, Math.min(1, best.dir[1])))));
    renderer.moveTo({
      yaw: Math.atan2(best.dir[0], best.dir[2]), pitch,
      tx: best.c[0], ty: best.c[1], tz: best.c[2],
      radius: tooth.anterior ? 14 : 17, zoom: 1, shift: 0.05
    });
  }

  /* ---------- HUD ---------- */
  function renderSegments(stage) {
    const regs = stage.regions;
    const key = stage.key + regs.length;
    if (game.segKey === key) return;
    game.segKey = key;
    ui.segments.innerHTML = '';
    ui.segments.style.gridTemplateColumns = 'repeat(' + regs.length + ', 1fr)';
    regs.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'seg';
      el.appendChild(document.createElement('i'));
      ui.segments.appendChild(el);
      r.segEl = el;
      r.segRatio = -1;
      r.segCls = 'seg';
    });
  }

  function regionLabel(stage, r) {
    if (!isArch(stage)) return r.key === 'biteR' ? S.biteRight : S.biteLeft;
    return (stage.key === 'upper' ? S.archShortUpper : S.archShortLower) + ' · ' + S.regions[r.key];
  }

  const facePct = (f) => (f.total ? Math.floor((100 * Math.min(f.captured, f.total)) / f.total) : 100);

  // Five chips: the state of every surface of the tooth in the scanner (or the next tooth).
  let stripKey = '';
  function renderFaceStrip(stage) {
    const tooth = game.focusFace ? game.focusFace.tooth : targetTooth(stage);
    if (!tooth || !isArch(stage)) {
      if (stripKey !== 'none') { stripKey = 'none'; ui.faceStrip.innerHTML = ''; }
      return;
    }
    const key = tooth.arch + tooth.id;
    if (stripKey !== key) {
      stripKey = key;
      ui.faceStrip.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'face-strip__tooth';
      label.textContent = tooth.id;
      ui.faceStrip.appendChild(label);
      FACE_ORDER.forEach((k) => {
        const f = tooth.faces[k];
        const chip = document.createElement('span');
        chip.className = 'face-chip';
        chip.innerHTML = '<i></i><span></span>';
        chip.lastChild.textContent = faceName(f);
        chip.title = f.required ? faceName(f) : faceName(f) + ' — ' + S.faceNotRequired;
        ui.faceStrip.appendChild(chip);
        f.chip = chip;
        f.chipState = '';
      });
    }
    FACE_ORDER.forEach((k) => {
      const f = tooth.faces[k];
      const live = game.focusFace === f;
      const state = !f.required ? 'na' : f.done ? 'done' : (live ? 'live' : '') + facePct(f);
      if (f.chipState === state) return;
      f.chipState = state;
      f.chip.className = 'face-chip' + (!f.required ? ' is-na' : f.done ? ' is-done' : live ? ' is-live' : '');
      f.chip.style.setProperty('--p', f.required && !f.done ? facePct(f) : 0);
    });
  }

  function updateHud() {
    const t = limited() ? Math.min(elapsedMs(), game.limitMs) : elapsedMs();
    setText(ui.timerMain, formatClock(t));
    setText(ui.timerTenths, '.' + Math.floor((t % 1000) / 100));
    ui.timer.classList.toggle('is-warn', isLive() && limited() && game.limitMs - t <= WARN_REMAINING_MS);

    const pct = game.result === 'win' ? 100 : overallPct();
    setText(ui.pct, pct + '%');
    if (ui.fill._pct !== pct) {
      ui.fill._pct = pct;
      ui.fill.style.transform = 'scaleX(' + pct / 100 + ')';
      ui.bar.setAttribute('aria-valuenow', String(pct));
    }

    const stage = currentStage();
    setText(ui.archLabel, S.stageLabels[stage.key]);
    setText(ui.archStep, game.stageIndex + 1 + '/' + game.stages.length);

    renderSegments(stage);
    const target = targetRegion(stage);
    stage.regions.forEach((r) => {
      const ratio = r.total ? Math.round((100 * r.captured) / r.total) : 100;
      if (r.segRatio !== ratio) { r.segRatio = ratio; r.segEl.firstChild.style.transform = 'scaleX(' + ratio / 100 + ')'; }
      const cls = r.captured >= r.total ? 'seg is-done' : r === target ? 'seg is-target' : 'seg';
      if (r.segCls !== cls) { r.segCls = cls; r.segEl.className = cls; }
    });

    const bites = game.stages.filter((s) => !isArch(s));
    [[ui.biteChipR, bites[0]], [ui.biteChipL, bites[1]]].forEach(([chip, st]) => {
      const done = st.captured >= st.total;
      chip.classList.toggle('is-done', done);
      chip.classList.toggle('is-active', !done && st === stage);
      chip.classList.toggle('is-skipped', !done && game.stages.indexOf(st) < game.stageIndex);
    });

    const last = game.stageIndex >= game.stages.length - 1;
    setText(ui.nextStepLabel, last ? S.nextResults : S.nextStep);
    const nextAria = last ? S.resultsAria : fmt(S.nextAria, { next: S.stageNext[game.stages[game.stageIndex + 1].key] });
    if (ui.nextStep.getAttribute('aria-label') !== nextAria) ui.nextStep.setAttribute('aria-label', nextAria);
    ui.nextStep.disabled = game.phase === 'ended';

    renderFaceStrip(stage);

    const focus = game.phase === 'running' && game.status === 'capturing' ? game.focusFace : null;
    ui.pill.classList.toggle('is-scanning', !!focus);
    if (focus) {
      ui.pill.style.visibility = 'visible';
      setText(ui.pillState, S.regionScanning);
      setText(ui.pillName, S.tooth + ' ' + focus.tooth.id + ' · ' + faceName(focus));
      setText(ui.pillPct, (focus.done ? 100 : facePct(focus)) + '%');
    } else {
      ui.pill.style.visibility = target ? 'visible' : 'hidden';
      if (target) {
        setText(ui.pillState, S.regionNext);
        setText(ui.pillName, regionLabel(stage, target));
        setText(ui.pillPct, Math.floor((100 * target.captured) / target.total) + '%');
      }
    }

    let msg = '', alert = false;
    if (game.phase === 'ready') msg = S.instrReady;
    else if (game.phase === 'transition') msg = S.instrSwitch;
    else if (game.phase === 'running') {
      if (game.mode === 'rotate') msg = S.instrRotate;
      else if (!input.active) msg = !game.guideVisible ? S.instrHidden : isArch(stage) ? S.instrIdle : S.instrBiteIdle;
      else if (game.status === 'lost') { msg = S.instrLost; alert = true; }
      else if (game.status === 'out') { msg = S.instrOut; alert = true; }
      else if (game.status === 'blocked') { msg = S.instrBlocked; alert = true; }
      else if (input.tooFast) { msg = S.instrFast; alert = true; }
      else if (game.status === 'covered') msg = !game.guideVisible ? S.instrHidden : S.instrCovered;
      else if (game.status === 'capturing' && game.focusFace) msg = fmt(S.instrCapturing, { face: faceName(game.focusFace).toLowerCase() });
    }
    setText(ui.instruction, msg);
    ui.instruction.classList.toggle('is-alert', alert);
  }

  /* ---------- Drawing ---------- */
  // Per-vertex look for the renderer: captured, quality (-1 = never seen), highlight
  // (1 = pending surface of the next tooth, 2 = inside the scanner field now), bite captured.
  function refreshDyn(model, stage) {
    const d = model.dyn, mesh = model.mesh, live = game.phase === 'ready' || game.phase === 'running';
    const tgt = live ? targetTooth(stage) : null;
    const frameNo = game.frame;
    for (let v = 0; v < mesh.count; v++) {
      const p = model.points[mesh.vPoint[v]];
      const bi = mesh.vBite[v];
      const bp = bi >= 0 ? model.bitePoints[bi] : null;
      let q = -1;
      if (bp && bp.exp > 0) q = bp.qual; else if (p.exp > 0) q = p.qual;
      let hl = 0;
      if (isArch(stage)) {
        if (p.seen === frameNo && input.active) hl = 2;
        else if (p.tooth === tgt && p.face.required && !p.face.done && !p.cap) hl = 1;
      } else if (bp) {
        if (bp.seen === frameNo && input.active) hl = 2;
        else if (live && bp.tooth.regB === stage.region && !bp.face.done && !bp.cap) hl = 1;
      }
      const o = v * 4;
      d[o] = p.cap ? 1 : 0;
      d[o + 1] = q;
      d[o + 2] = hl;
      d[o + 3] = bp && bp.cap ? 1 : 0;
    }
    renderer.uploadDyn(model);
  }

  // SCAN RESULT data, from the same capture state: a vertex exists in the digital model only if
  // its surface point was captured, and carries that point's quality (bite points for the cheek
  // side once the bite registration captured them). Returns whether anything is captured.
  function refreshResult(model) {
    const mesh = model.mesh;
    const d = model.dynResult || (model.dynResult = new Float32Array(model.dyn.length));
    let any = false;
    for (let v = 0; v < mesh.count; v++) {
      const p = model.points[mesh.vPoint[v]];
      const bi = mesh.vBite[v];
      const bp = bi >= 0 ? model.bitePoints[bi] : null;
      const o = v * 4;
      d[o] = p.cap ? 1 : 0;
      d[o + 1] = bp && bp.cap ? bp.qual : p.cap ? p.qual : -1;
      d[o + 2] = 0;
      d[o + 3] = bp && bp.cap ? 1 : 0;
      if (p.cap) any = true;
    }
    resultView.uploadDyn(model, d);
    return any;
  }

  function setResultLinked(on) {
    resultLinked = on;
    ui.resultSync.setAttribute('aria-pressed', String(on));
    if (on) resultView.follow(renderer);
  }

  function drawResult(items, now) {
    if (!resultView.ok || ui.resultStage.hidden) return;
    resultView.resize();
    if (resultLinked) resultView.follow(renderer);
    resultView.computeMatrices();
    let any = false;
    items.forEach((it) => { if (refreshResult(it.model)) any = true; });
    resultView.draw(items, { shade: shadeRgb(), heat: game.heat, result: true, time: now / 1000 });
    ui.resultEmpty.classList.toggle('is-hidden', any);
  }

  // ZOOM window. Uses the scanner evaluation of this frame (capture.js via scanStep): it shows the
  // aimed spot from the same direction as the main camera, magnified, with the same per-vertex
  // capture state (the tinted area is what the scanner sees now). It never captures or moves anything.
  const ZOOM_RADIUS = 7; // mm of arch shown around the aimed point
  function drawZoom(items, now) {
    if (!zoomView.ok) return;
    const aim = game.aim;
    const valid = isLive() && input.active && game.mode === 'scan' && aim && aim.res.state !== 'out' && aim.res.hitT < 1e8;
    ui.zoomView.classList.toggle('is-empty', !valid);
    if (!valid) return;
    const { o, d } = aim.ray, T = aim.res.hitT;
    zoomView.resize();
    zoomView.cam = Object.assign({}, renderer.cam, {
      tx: o[0] + d[0] * T, ty: o[1] + d[1] * T, tz: o[2] + d[2] * T, radius: ZOOM_RADIUS, zoom: 1, shift: 0
    });
    zoomView.goal = Object.assign({}, zoomView.cam);
    zoomView.computeMatrices();
    items.forEach((it) => zoomView.uploadDyn(it.model));
    zoomView.draw(items, { shade: shadeRgb(), heat: game.heat, time: now / 1000 });
  }

  function draw(now) {
    const stage = currentStage();
    const items = drawItems(stage);
    items.forEach((it) => refreshDyn(it.model, stage));
    renderer.draw(items, { shade: shadeRgb(), heat: game.heat, time: now / 1000 });
    drawResult(items, now);
    drawZoom(items, now);

    const ctx = syncOverlay(ui.overlay);
    const vp = renderer.viewProj;
    const ppm = renderer.pxPerMm();

    // Capture sparks.
    ctx.fillStyle = '#FF6A13';
    game.flashes = game.flashes.filter((f) => {
      const age = (now - f.t) / 450;
      if (age >= 1) return false;
      const s = renderer.project(vp, f.p.wx, f.p.wy, f.p.wz);
      if (s) {
        ctx.globalAlpha = 1 - age;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.4 + age * 2.2, 0, TAU);
        ctx.fill();
      }
      return true;
    });
    ctx.globalAlpha = 1;

    // Ripple when a surface is completed.
    game.bursts = game.bursts.filter((b) => {
      const age = (now - b.t) / 650;
      if (age >= 1) return false;
      const s = renderer.project(vp, b.c[0], b.c[1], b.c[2]);
      if (s) {
        ctx.strokeStyle = 'rgba(255,106,19,' + (1 - age).toFixed(3) + ')';
        ctx.lineWidth = 2.5 * (1 - age) + 0.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, b.r * ppm * (1 + age * 1.2), 0, TAU);
        ctx.stroke();
      }
      return true;
    });

    const live = game.phase === 'ready' || game.phase === 'running';

    // Side label during the bite scan.
    if (!isArch(stage) && live) {
      const c = centroid([].concat(...stage.teeth.map((t) => t.bitePoints)), () => true);
      const s = c && renderer.project(vp, c[0], c[1], c[2]);
      if (s) drawTag(ctx, s.x, Math.max(70, s.y - 90), stage.side < 0 ? S.patientRight : S.patientLeft);
    }

    // "Place the scanner here": pending points of the next tooth the scanner can see from this view.
    const tooth = live ? targetTooth(stage) : null;
    game.guideVisible = true;
    if (tooth) {
      const pts = [].concat(...facesOf(stage, tooth).filter((f) => f.required && !f.done).map((f) => f.req));
      const g = centroid(pts, (p) => !p.cap && capturableNow(stage, p));
      game.guideVisible = !!g;
      const idle = !input.active || performance.now() - input.lastMoveAt > IDLE_HINT_MS;
      if (g && idle && game.mode === 'scan') {
        const s = renderer.project(vp, g[0], g[1], g[2]);
        if (s) {
          const r = CAP.FIELD_RADIUS * ppm;
          const k = (now % 1400) / 1400;
          ctx.strokeStyle = 'rgba(255,106,19,' + (0.9 * (1 - k)).toFixed(3) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, r * (0.6 + k * 0.9), 0, TAU);
          ctx.stroke();
          ctx.fillStyle = '#FF6A13';
          ctx.beginPath();
          ctx.arc(s.x, s.y, 4, 0, TAU);
          ctx.fill();
        }
      }
    }
    ui.nextView.classList.toggle('is-hint', live && !game.guideVisible);

    if (input.active && input.tip && isLive() && game.mode === 'scan') {
      drawReticle(ctx, vp);
      drawScanner(ctx, CAP.FIELD_RADIUS * ppm, now);
    }
  }

  // Direction indicator: the capture disc laid on the aimed surface (an ellipse that flattens as
  // the surface turns away), with its normal. Orange = valid capture angle, grey = not valid.
  function drawReticle(ctx, vp) {
    const aim = game.aim;
    if (!aim || aim.res.hitT >= 1e8) return;
    const { o, d } = aim.ray, T = aim.res.hitT;
    const H = [o[0] + d[0] * T, o[1] + d[1] * T, o[2] + d[2] * T];
    let n = null, best = Infinity;
    const stage = currentStage();
    stage.teeth.forEach((t) => {
      const c = stage.centerOf(t);
      if (Math.hypot(c[0] - H[0], c[1] - H[1], c[2] - H[2]) > t.proxy.r + 3) return;
      stage.pointsOf(t).forEach((p) => {
        const dd = (p.wx - H[0]) ** 2 + (p.wy - H[1]) ** 2 + (p.wz - H[2]) ** 2;
        if (dd < best) { best = dd; n = [p.wnx, p.wny, p.wnz]; }
      });
    });
    if (!n) return;
    const ok = game.status === 'capturing' || game.status === 'covered';
    let a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let t1 = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
    const l = Math.hypot(...t1) || 1;
    t1 = t1.map((x) => x / l);
    const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
    const R = CAP.FIELD_RADIUS * 0.8;
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const ang = (i / 28) * TAU, c = Math.cos(ang) * R, s = Math.sin(ang) * R;
      const q = renderer.project(vp, H[0] + n[0] * 0.15 + t1[0] * c + t2[0] * s, H[1] + n[1] * 0.15 + t1[1] * c + t2[1] * s, H[2] + n[2] * 0.15 + t1[2] * c + t2[2] * s);
      if (!q) return;
      if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    }
    ctx.strokeStyle = ok ? 'rgba(255,106,19,0.95)' : 'rgba(120,128,140,0.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash(ok ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    const a0 = renderer.project(vp, H[0], H[1], H[2]);
    const a1 = renderer.project(vp, H[0] + n[0] * 3, H[1] + n[1] * 3, H[2] + n[2] * 3);
    if (a0 && a1) {
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.stroke();
    }
  }

  function drawTag(ctx, x, y, text) {
    ctx.font = '800 10px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = 'rgba(29,33,39,0.88)';
    roundRect(ctx, x - w / 2, y - 11, w, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawScanner(ctx, r, now) {
    const T = input.tip;
    const ok = game.status === 'capturing' || game.status === 'covered';
    const grey = input.tooFast || !ok;

    // Capture field.
    const g = ctx.createRadialGradient(T.x, T.y, 0, T.x, T.y, r);
    g.addColorStop(0, grey ? 'rgba(120,128,140,0.12)' : 'rgba(255,106,19,0.2)');
    g.addColorStop(1, grey ? 'rgba(120,128,140,0.04)' : 'rgba(255,106,19,0.05)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(T.x, T.y, r, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = grey ? '#8A919C' : '#FF6A13';
    ctx.setLineDash(grey ? [5, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.translate(T.x, T.y);
    ctx.rotate(now / 600);
    ctx.strokeStyle = grey ? 'rgba(138,145,156,0.8)' : 'rgba(255,106,19,0.9)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r + 5, (i * Math.PI) / 2, (i * Math.PI) / 2 + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // Crosshair: the scanner axis goes into the screen here.
    ctx.strokeStyle = grey ? 'rgba(90,97,107,0.9)' : 'rgba(255,106,19,1)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(T.x - 5, T.y); ctx.lineTo(T.x + 5, T.y);
    ctx.moveTo(T.x, T.y - 5); ctx.lineTo(T.x, T.y + 5);
    ctx.stroke();

    if (game.status === 'capturing' && !input.tooFast) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(T.x, T.y, r, 0, TAU);
      ctx.clip();
      const yy = T.y + r * Math.sin(now / 170);
      const lg = ctx.createLinearGradient(T.x - r, 0, T.x + r, 0);
      lg.addColorStop(0, 'rgba(255,106,19,0)');
      lg.addColorStop(0.5, 'rgba(255,106,19,0.95)');
      lg.addColorStop(1, 'rgba(255,106,19,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(T.x - r, yy - 1, 2 * r, 2);
      ctx.restore();
    }

    // Scanner wand, pointing from the field towards the finger.
    const F = input.type === 'mouse' || !input.finger ? { x: T.x + 26, y: T.y + 70 } : input.finger;
    let dx = F.x - T.x, dy = F.y - T.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) { dx = 0.3; dy = 1; } else { dx /= len; dy /= len; }

    ctx.save();
    ctx.translate(T.x, T.y);
    ctx.rotate(Math.atan2(dy, dx) - Math.PI / 2);
    ctx.globalAlpha = 0.94;

    const h0 = r + 6;
    const cone = ctx.createLinearGradient(0, h0 + 6, 0, 0);
    cone.addColorStop(0, grey ? 'rgba(138,145,156,0.35)' : 'rgba(255,106,19,0.4)');
    cone.addColorStop(1, 'rgba(255,106,19,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(-7, h0 + 6);
    ctx.lineTo(7, h0 + 6);
    ctx.lineTo(r * 0.8, 0);
    ctx.lineTo(-r * 0.8, 0);
    ctx.closePath();
    ctx.fill();

    const body = ctx.createLinearGradient(-15, 0, 15, 0);
    body.addColorStop(0, '#5A616B');
    body.addColorStop(0.45, '#2A2F36');
    body.addColorStop(1, '#4A5059');

    ctx.shadowColor = 'rgba(20,24,30,0.3)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = body;
    roundRect(ctx, -15, h0 + 72, 30, 150, 15);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-11, h0 + 44);
    ctx.lineTo(11, h0 + 44);
    ctx.lineTo(13, h0 + 76);
    ctx.lineTo(-13, h0 + 76);
    ctx.closePath();
    ctx.fill();
    roundRect(ctx, -12, h0, 24, 50, 10);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    ctx.fillStyle = '#FF6A13';
    ctx.fillRect(-15, h0 + 94, 30, 5);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, -9, h0 + 80, 3, 130, 1.5);
    ctx.fill();
    ctx.fillStyle = grey ? '#B9BEC6' : '#FFB283';
    roundRect(ctx, -7, h0 + 3, 14, 7, 2.5);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- Input ---------- */
  function movePointer(e) {
    const rect = ui.stage.getBoundingClientRect();
    const fx = e.clientX - rect.left, fy = e.clientY - rect.top;
    const offset = input.type === 'mouse' ? 0 : TOUCH_OFFSET;
    input.finger = { x: fx, y: fy };
    input.tip = {
      x: Math.max(0, Math.min(rect.width, fx)),
      y: Math.max(0, Math.min(rect.height, fy - offset))
    };
    input.active = true;
    input.lastMoveAt = performance.now();
  }

  const stageSurface = bindSurface(ui.stage, {
    enabled: () => game.phase === 'ready' || isLive(),
    scanMode: () => game.mode === 'scan',
    onScanStart(e) {
      input.id = e.pointerId;
      input.type = e.pointerType || 'touch';
      input.lastTip = null;
      input.speed = 0;
      movePointer(e);
      if (game.phase === 'ready') beginClock();
    },
    onScanMove: movePointer,
    onScanEnd: releasePointer
  });

  bindViewTools(screens.game);
  ui.modeScan.addEventListener('click', () => setMode('scan'));
  ui.modeRotate.addEventListener('click', () => { setMode('rotate'); releasePointer(); });
  ui.heat.addEventListener('click', () => setHeat(!game.heat));

  // SCAN RESULT panel: drag (or right-drag) rotates, pinch / wheel zooms — its own camera only, no
  // scanner, no capture. Touching it detaches it from the original view until re-linked.
  bindSurface(ui.resultStage, {
    enabled: () => screenName === 'game' && resultView.ok,
    renderer: resultView,
    onCamera: () => { if (resultLinked) setResultLinked(false); }
  });
  ui.resultSync.addEventListener('pointerdown', (e) => e.stopPropagation());
  ui.resultSync.addEventListener('click', () => setResultLinked(true));
  ui.nextView.addEventListener('click', guidedView);

  document.addEventListener('gesturestart', (e) => { if (screenName === 'game' || screenName === 'setup') e.preventDefault(); });

  ui.start.addEventListener('click', openSetup);
  ui.again.addEventListener('click', startGame);
  ui.continueBtn.addEventListener('click', continueScan);
  ui.finish.addEventListener('click', finishScan);
  ui.nextStep.addEventListener('click', nextStep);
  ui.change.addEventListener('click', () => { game.phase = 'idle'; openSetup(); });
  ui.home.addEventListener('click', () => { game.phase = 'idle'; showScreen('home'); });
  ui.quit.addEventListener('click', () => {
    if (isLive() && !window.confirm(S.quitConfirm)) return;
    abortRound();
  });

  /* ---------- Background tabs ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releasePointer();
      stageSurface.reset();
      stopLoop();
      stopHome();
      stopSetupLoop();
      return;
    }
    if (isLive()) {
      // The clock never stopped; settle the round if the limit passed meanwhile.
      if (timeUp(elapsedMs())) { endRound('timeout'); return; }
      showToast(S.toastBackground);
      scheduleLimitCheck();
      startLoop();
    } else if (game.phase === 'ready' && screenName === 'game') {
      startLoop();
    } else if (screenName === 'home') {
      startHome();
    } else if (screenName === 'setup') {
      startSetupLoop();
    }
  });
  window.addEventListener('blur', () => { releasePointer(); stageSurface.reset(); });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && isLive() && timeUp(elapsedMs())) endRound('timeout');
  });

  window.addEventListener('resize', () => { if (screenName === 'home') homeView.resize(); });
  if ('ResizeObserver' in window) new ResizeObserver(() => { if (screenName === 'home') homeView.resize(); }).observe(ui.homePlane);

  /* ---------- Result ---------- */
  const RING_C = 2 * Math.PI * 70;

  // kind: 'win' | 'timeout' | 'finish' (partial). Same screen and metrics for all three; a partial
  // scan is labelled as such, judged on what was captured, and can be continued.
  function showResult(kind, ms, pct, quality, best, isNewBest) {
    const win = kind === 'win', partial = kind === 'finish';
    ui.result.classList.toggle('result--win', win);
    ui.result.classList.toggle('result--lose', !win);
    ui.result.classList.toggle('result--partial', partial);
    ui.resultTitle.textContent = win ? S.winTitle : partial ? S.finishTitle : S.loseTitle;
    ui.resultTagline.textContent = win ? (game.continued ? S.winPausedNote : S.winTagline)
      : partial ? fmt(S.finishTagline, { pct }) : S.loseTagline;
    const bestText = best ? formatPrecise(best) : '—';
    const qualityText = quality === null ? '—' : quality + '%';
    const stats = win
      ? [[S.finalTime, formatPrecise(ms)], [S.scanQuality, qualityText], [S.personalBest, bestText]]
      : [[S.progressReached, pct + '%'], [S.scanQuality, qualityText],
        partial ? [S.timeUsed, formatPrecise(ms)] : [S.timeLimit, formatClock(game.limitMs)], [S.personalBest, bestText]];
    ui.statLabels.forEach((label, i) => {
      const s = stats[i];
      label.parentNode.hidden = !s;
      if (!s) return;
      label.textContent = s[0];
      ui.statValues[i].textContent = s[1];
    });
    ui.stats.classList.toggle('stats--4', stats.length === 4);
    ui.resultSteps.textContent = '';
    game.stages.forEach((st) => {
      const s = stepSummary(st);
      const li = document.createElement('li');
      li.className = 'result-step ' + s.cls;
      const name = document.createElement('span');
      name.textContent = S.stageLabels[st.key];
      const value = document.createElement('strong');
      value.textContent = s.text;
      li.append(name, value);
      ui.resultSteps.appendChild(li);
    });
    ui.newBest.classList.toggle('is-visible', isNewBest);
    ui.continueBtn.hidden = !game.canContinue;
    ui.again.textContent = win ? S.playAgain : partial ? S.newScan : S.tryAgain;
    showScreen('result');
    animateRing(win ? 100 : pct);
    showResultModel();
  }

  /* ---------- Digital model on the results screen ---------- */
  // Same SCAN RESULT renderer and data: both arches side by side, only captured surfaces.
  let resultModelRaf = 0, resultModelLast = 0;

  function resultModelItems() {
    const dm = dentModels();
    const gap = Math.max(dm.upper.radius3, dm.lower.radius3) * 0.92;
    const shifted = (x) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);
    return [{ model: dm.upper, matrix: shifted(-gap) }, { model: dm.lower, matrix: shifted(gap) }];
  }

  function showResultModel() {
    if (!resultView.ok) { ui.resultModel.hidden = true; return; }
    ui.resultModel.hidden = false;
    resultView.attach(ui.resultModel);
    resultView.resize();
    const dm = dentModels();
    const gap = Math.max(dm.upper.radius3, dm.lower.radius3) * 0.92;
    resultView.setView({ yaw: 0, pitch: 0.95, tx: 0, ty: dm.upper.center3[1], tz: (dm.upper.center3[2] + dm.lower.center3[2]) / 2, radius: gap * 1.55, zoom: 1, shift: 0 }, true);
    if (!resultModelRaf) { resultModelLast = 0; resultModelRaf = requestAnimationFrame(resultModelFrame); }
  }

  function resultModelFrame(now) {
    resultModelRaf = 0;
    if (screenName !== 'result') return;
    const dt = resultModelLast ? Math.min((now - resultModelLast) / 1000, 0.05) : 0;
    resultModelLast = now;
    drawResultModel(dt, now);
    resultModelRaf = requestAnimationFrame(resultModelFrame);
  }

  function drawResultModel(dt, now) {
    resultView.resize();
    resultView.update(dt);
    const items = resultModelItems();
    let any = false;
    items.forEach((it) => { if (refreshResult(it.model)) any = true; });
    resultView.draw(items, { shade: shadeRgb(), heat: game.heat, result: true, time: now / 1000 });
    ui.resultModelEmpty.classList.toggle('is-hidden', any);
  }

  bindSurface(ui.resultModel, {
    enabled: () => screenName === 'result' && resultView.ok,
    renderer: resultView
  });

  function animateRing(target) {
    const bar = ui.ringBar;
    bar.style.transition = 'none';
    bar.style.strokeDashoffset = String(RING_C);
    void bar.getBoundingClientRect();
    requestAnimationFrame(() => {
      bar.style.transition = '';
      bar.style.strokeDashoffset = String(RING_C * (1 - target / 100));
    });
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / 1200);
      const eased = 1 - Math.pow(1 - k, 3);
      ui.ringPct.textContent = Math.round(target * eased) + '%';
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- Start-screen animation ---------- */
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOME_CYCLE = 6400, HOME_SWEEP = 4200, HOME_FADE = 5600;
  let homeRaf = 0, homeActive = false;

  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  function startHome() {
    homeActive = true;
    homeView.resize();
    if (reducedMotion) { homeFrame(HOME_SWEEP + 100, true); return; }
    if (!homeRaf) homeRaf = requestAnimationFrame(homeFrame);
  }

  function stopHome() {
    homeActive = false;
    if (homeRaf) cancelAnimationFrame(homeRaf);
    homeRaf = 0;
  }

  function homeFrame(now, once) {
    homeRaf = 0;
    if (!homeActive) return;
    const v = homeView;
    if (!v.w && !v.resize()) { if (!once) homeRaf = requestAnimationFrame(homeFrame); return; }

    const b = v.screenBounds();
    const ph = once ? now : now % HOME_CYCLE;
    const from = b.minX - 6, to = b.maxX + 6;
    const sweeping = ph < HOME_SWEEP;
    const sweepX = sweeping ? from + (to - from) * ease(ph / HOME_SWEEP) : to;
    const alpha = ph > HOME_FADE ? 1 - (ph - HOME_FADE) / (HOME_CYCLE - HOME_FADE) : 1;
    v.drawHome(sweepX, alpha);

    if (sweeping) {
      const c = v.ctx;
      c.save();
      c.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      const g = c.createLinearGradient(sweepX - 18, 0, sweepX + 2, 0);
      g.addColorStop(0, 'rgba(255,106,19,0)');
      g.addColorStop(1, 'rgba(255,106,19,0.35)');
      c.fillStyle = g;
      c.fillRect(sweepX - 18, b.minY, 20, b.maxY - b.minY);
      c.fillStyle = '#FF6A13';
      c.fillRect(sweepX - 1, b.minY, 2, b.maxY - b.minY);
      c.restore();
    }

    // The wand follows the sweep, then glides back to the start.
    const wandX = sweeping ? sweepX : to + (from - to) * ease(Math.min(1, (ph - HOME_SWEEP) / (HOME_CYCLE - HOME_SWEEP)));
    const plane = ui.homePlane, wand = ui.homeWand;
    const x = plane.offsetLeft + wandX - wand.clientWidth / 2;
    const y = plane.offsetTop + plane.offsetHeight * 0.52 - wand.clientHeight + Math.sin(now / 700) * 4;
    wand.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';

    if (!once) homeRaf = requestAnimationFrame(homeFrame);
  }

  /* ---------- Boot ---------- */
  // Hooks for automated rehearsal tests (?debug=1). Not used by the game itself. tick() runs the
  // same per-frame capture step on demand, for test runners whose page is not being painted.
  if (/[?&]debug=1\b/.test(window.location.search)) {
    window.ISC_DEBUG = {
      renderer, resultView, zoomView, game, config, finishScan, continueScan, input, currentStage, targetTooth, guidedView, facesOf, dentModels, capturableNow, FACE_ORDER,
      draw: () => draw(performance.now()),
      tick(dt) {
        game.manualTicks = true;
        renderer.update(dt);
        if (!isLive()) return;
        const t = elapsedMs();
        if (timeUp(t)) { endRound('timeout'); return; }
        if (game.phase === 'running') scanStep(dt, t);
      }
    };
  }
  setMode('scan');
  showScreen('home');
})();
