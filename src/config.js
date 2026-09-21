const crypto = require('crypto');

const THEMES = ['system', 'light', 'dark'];

const DEFAULT_CONFIG = {
  defaultProfile: { enabled: true, mappings: [] },
  appProfiles: {}, // { [bundleId]: { mappings } }
  scrollThreshold: 4.0, // accumulated delta needed for one *remapped* scroll step
  suppressOriginalScroll: true,
  scroll: { invert: false, speed: 1, acceleration: 0, smoothing: 0 }, // adjusts un-remapped mouse-wheel scrolling
  theme: 'system',
};

// Fixed per-trigger fields used by older configs, and the key each one defaulted to.
const LEGACY_MAPPINGS = {
  scrollUp: { trigger: { type: 'scroll', direction: 'up' }, defaultKey: 126 },
  scrollDown: { trigger: { type: 'scroll', direction: 'down' }, defaultKey: 125 },
  middleClick: { trigger: { type: 'button', button: 2 }, defaultKey: 49 },
  sideBack: { trigger: { type: 'button', button: 3 }, defaultKey: 123 },
  sideForward: { trigger: { type: 'button', button: 4 }, defaultKey: 124 },
};

// Older configs had one fixed field per trigger ({ enabled, keyCode, flags } or { enabled, action });
// they become entries of the generic `mappings` list. Untouched, disabled defaults are dropped.
function migrateToMappings(cfg) {
  if (Array.isArray(cfg.mappings) || cfg.defaultProfile) return cfg;
  const mappings = [];
  for (const [key, { trigger, defaultKey }] of Object.entries(LEGACY_MAPPINGS)) {
    const m = cfg[key];
    if (!m) continue;
    const action = m.action || { type: 'key', keyCode: m.keyCode, flags: m.flags || 0 };
    const untouched = action.type === 'key' && action.keyCode === defaultKey && !action.flags;
    if (!m.enabled && untouched) continue;
    mappings.push({ id: crypto.randomUUID(), enabled: !!m.enabled, trigger, action });
  }
  const { scrollUp, scrollDown, middleClick, sideBack, sideForward, suppressOriginalMiddleClick, ...rest } = cfg;
  return { ...rest, mappings };
}

// The single `mappings` list + `targetApps` allowlist become profiles. To keep behavior identical, every
// allowlisted app gets its own copy of the mappings and the default profile starts disabled and empty;
// with no allowlist the mappings were inactive before, so they land in the (disabled) default profile.
function migrateToProfiles(cfg) {
  if (cfg.defaultProfile) return cfg;
  const { mappings = [], targetApps = [], ...rest } = cfg;
  const appProfiles = {};
  for (const bundleId of targetApps) {
    appProfiles[bundleId] = { mappings: mappings.map((m) => ({ ...structuredClone(m), id: crypto.randomUUID() })) };
  }
  return {
    ...rest,
    defaultProfile: { enabled: false, mappings: targetApps.length ? [] : mappings },
    appProfiles,
  };
}

function migrateConfig(cfg) {
  return migrateToProfiles(migrateToMappings(cfg));
}

// ---- Validation of untrusted input (imported files) ----

// Ids must match performSystem() in native/MouseRemapHelper.swift.
const SYSTEM_ACTIONS = [
  'mission_control', 'space_left', 'space_right',
  'screenshot_full', 'screenshot_area', 'screenshot_menu',
  'play_pause', 'next_track', 'previous_track', 'volume_up', 'volume_down', 'mute',
];
const CLICK_ACTIONS = ['left', 'right', 'double'];
const DIRECTIONS = ['left', 'right', 'up', 'down'];
const MODIFIER_MASK = 0x20000 | 0x40000 | 0x80000 | 0x100000; // shift | control | option | command

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const clamp = (n, min, max, fallback) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback);

function sanitizeTrigger(t) {
  if (!t || typeof t !== 'object') return null;
  if (t.type === 'scroll' && (t.direction === 'up' || t.direction === 'down')) return { type: 'scroll', direction: t.direction };
  if (t.type === 'button' && isInt(t.button, 2, 31)) return { type: 'button', button: t.button };
  if (t.type === 'gesture' && isInt(t.button, 2, 31) && DIRECTIONS.includes(t.direction)) {
    return { type: 'gesture', button: t.button, direction: t.direction };
  }
  return null;
}

function sanitizeAction(a) {
  if (!a || typeof a !== 'object') return null;
  switch (a.type) {
    case 'key':
      return isInt(a.keyCode, 0, 127) ? { type: 'key', keyCode: a.keyCode, flags: (Number(a.flags) || 0) & MODIFIER_MASK } : null;
    case 'system':
      return SYSTEM_ACTIONS.includes(a.id) ? { type: 'system', id: a.id } : null;
    case 'click':
      return CLICK_ACTIONS.includes(a.id) ? { type: 'click', id: a.id } : null;
    case 'app':
      return typeof a.bundleId === 'string' && a.bundleId.length <= 256 ? { type: 'app', bundleId: a.bundleId } : null;
    case 'none':
      return { type: 'none' };
    default:
      return null;
  }
}

// Keeps only well-formed mappings, one per trigger (the first wins), and reports how many were dropped.
function sanitizeProfile(p) {
  const out = { mappings: [] };
  let dropped = 0;
  const seen = new Set();
  for (const m of Array.isArray(p && p.mappings) ? p.mappings : []) {
    const trigger = sanitizeTrigger(m && m.trigger);
    const action = sanitizeAction(m && m.action);
    const key = trigger && JSON.stringify(trigger);
    if (!trigger || !action || seen.has(key)) { dropped++; continue; }
    seen.add(key);
    out.mappings.push({
      id: typeof m.id === 'string' && m.id ? m.id.slice(0, 64) : crypto.randomUUID(),
      enabled: m.enabled !== false,
      trigger,
      action,
    });
  }
  return { profile: out, dropped };
}

// Turns arbitrary parsed JSON (a bare config or an exported wrapper, old or new format) into a safe config.
// The theme is a local preference and is never imported. Throws when the input isn't a config at all.
function sanitizeConfig(raw) {
  const input = raw && typeof raw === 'object' && raw.config && typeof raw.config === 'object' ? raw.config : raw;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('O arquivo não é uma configuração válida.');

  // Checked before migrating: migration always fabricates a default profile, so `{}` would look valid after it.
  const known = ['defaultProfile', 'appProfiles', 'mappings', ...Object.keys(LEGACY_MAPPINGS)];
  if (!known.some((key) => key in input)) throw new Error('O arquivo não contém perfis nem mapeamentos.');
  const cfg = migrateConfig(input);

  let dropped = 0;
  const def = sanitizeProfile(cfg.defaultProfile);
  dropped += def.dropped;
  const appProfiles = {};
  const rawApps = cfg.appProfiles && typeof cfg.appProfiles === 'object' && !Array.isArray(cfg.appProfiles) ? cfg.appProfiles : {};
  for (const [bundleId, profile] of Object.entries(rawApps)) {
    if (!bundleId || bundleId.length > 256 || bundleId === '__proto__') { dropped++; continue; }
    const res = sanitizeProfile(profile);
    dropped += res.dropped;
    appProfiles[bundleId] = res.profile;
  }

  const scroll = cfg.scroll && typeof cfg.scroll === 'object' ? cfg.scroll : {};
  return {
    dropped,
    config: {
      defaultProfile: { enabled: !(cfg.defaultProfile && cfg.defaultProfile.enabled === false), mappings: def.profile.mappings },
      appProfiles,
      scrollThreshold: clamp(Number(cfg.scrollThreshold), 0.5, 30, DEFAULT_CONFIG.scrollThreshold),
      suppressOriginalScroll: cfg.suppressOriginalScroll !== false,
      scroll: {
        invert: scroll.invert === true,
        speed: clamp(Number(scroll.speed), 0.5, 4, 1),
        acceleration: clamp(Number(scroll.acceleration), 0, 1, 0),
        smoothing: clamp(Number(scroll.smoothing), 0, 1, 0),
      },
    },
  };
}

module.exports = { DEFAULT_CONFIG, THEMES, migrateConfig, sanitizeConfig };
