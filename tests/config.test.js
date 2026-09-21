const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG, migrateConfig, sanitizeConfig } = require('../src/config');

const button = (n) => ({ type: 'button', button: n });
const mute = { type: 'system', id: 'mute' };

test('a valid config survives, and the exported wrapper is understood', () => {
  const cfg = { defaultProfile: { enabled: true, mappings: [{ id: 'a', enabled: true, trigger: button(3), action: mute }] }, appProfiles: {}, theme: 'light' };
  for (const input of [cfg, { app: 'mouse-remapper', version: 1, config: cfg }]) {
    const { config, dropped } = sanitizeConfig(input);
    assert.equal(dropped, 0);
    assert.deepEqual(config.defaultProfile.mappings[0].action, mute);
    assert.ok(!('theme' in config), 'the theme is a local preference and is never imported');
  }
});

test('hostile input is cleaned up, not trusted', () => {
  const { config, dropped } = sanitizeConfig({
    defaultProfile: { mappings: [
      { trigger: button(3), action: { type: 'system', id: 'rm -rf /' } },
      { trigger: button(99), action: { type: 'key', keyCode: 1 } },
      { trigger: { type: 'evil' }, action: { type: 'none' } },
      { trigger: button(5), action: { type: 'key', keyCode: 1, flags: 0xffffffff } },
      { trigger: button(5), action: { type: 'none' } },
      'garbage', null,
    ] },
    scroll: { speed: 99, acceleration: -3, smoothing: 7, invert: 'yes' },
    scrollThreshold: 'abc',
  });
  assert.equal(config.defaultProfile.mappings.length, 1);
  assert.equal(dropped, 6);
  assert.equal(config.defaultProfile.mappings[0].action.flags, 0x1E0000, 'flags are limited to the four modifier bits');
  assert.deepEqual(config.scroll, { invert: false, speed: 4, acceleration: 0, smoothing: 1 });
  assert.equal(config.scrollThreshold, DEFAULT_CONFIG.scrollThreshold);
});

test('gestures are validated, duplicates and bad directions dropped', () => {
  const g = (b, d) => ({ trigger: { type: 'gesture', button: b, direction: d }, action: { type: 'none' } });
  const { config, dropped } = sanitizeConfig({ defaultProfile: { mappings: [g(3, 'left'), g(3, 'left'), g(3, 'diagonal'), g(1, 'up'), g(4, 'up')] } });
  assert.deepEqual(config.defaultProfile.mappings.map((m) => `${m.trigger.button}:${m.trigger.direction}`), ['3:left', '4:up']);
  assert.equal(dropped, 3);
});

test('an open-app action keeps its executable path (Windows launches by path)', () => {
  const app = (extra) => sanitizeConfig({ defaultProfile: { mappings: [{ trigger: button(3), action: { type: 'app', bundleId: 'notepad.exe', ...extra } }] } }).config.defaultProfile.mappings[0].action;
  assert.deepEqual(app({ path: 'C:\\Windows\\notepad.exe' }), { type: 'app', bundleId: 'notepad.exe', path: 'C:\\Windows\\notepad.exe' });
  assert.deepEqual(app({}), { type: 'app', bundleId: 'notepad.exe' });
  assert.deepEqual(app({ path: 42 }), { type: 'app', bundleId: 'notepad.exe' });
});

test('things that are not configs are rejected', () => {
  for (const bad of [null, 'text', [], {}, { foo: 1 }, 42]) assert.throws(() => sanitizeConfig(bad), /não|arquivo/i, JSON.stringify(bad));
  assert.equal(({}).polluted, undefined);
  sanitizeConfig({ defaultProfile: { mappings: [] }, appProfiles: JSON.parse('{"__proto__": {"polluted": true}}') });
  assert.equal(({}).polluted, undefined, 'a __proto__ key must not pollute Object.prototype');
});

test('migration: old formats become profiles, and it is idempotent', () => {
  const v1 = { scrollUp: { enabled: true, keyCode: 126, flags: 0 }, middleClick: { enabled: false, keyCode: 49, flags: 0 }, targetApps: ['a.b', 'c.d'], scrollThreshold: 6 };
  const once = migrateConfig(v1);
  assert.equal(once.defaultProfile.enabled, false, 'the default profile starts disabled, keeping the old behavior');
  assert.deepEqual(Object.keys(once.appProfiles), ['a.b', 'c.d']);
  assert.equal(once.appProfiles['a.b'].mappings.length, 1, 'untouched disabled defaults are dropped');
  assert.ok(!('scrollUp' in once) && !('targetApps' in once));
  assert.equal(once.scrollThreshold, 6);
  assert.deepEqual(migrateConfig(once), once);
});

test('the UI, the validator and the Windows planner agree on the system action ids', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings.js'), 'utf8');
  const uiIds = new Set([...ui.matchAll(/'system:([a-z_]+)'/g)].map((m) => m[1]));
  const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'config.js'), 'utf8');
  const listed = cfg.match(/const SYSTEM_ACTIONS = \[([\s\S]*?)\];/)[1];
  const validated = new Set([...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...uiIds].sort(), [...validated].sort(), 'settings.js and config.js list different system actions');
  const plan = fs.readFileSync(path.join(__dirname, '..', 'native', 'windows', 'plan.go'), 'utf8');
  for (const id of validated) assert.ok(plan.includes(`"${id}"`), `native/windows/plan.go does not plan "${id}"`);
  const swift = fs.readFileSync(path.join(__dirname, '..', 'native', 'MouseRemapHelper.swift'), 'utf8');
  for (const id of validated) assert.ok(swift.includes(`"${id}"`), `MouseRemapHelper.swift does not handle "${id}"`);
});

test('the factory defaults are valid: "Restaurar padrões" writes them as they are', () => {
  const { theme, ...portable } = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const { config, dropped } = sanitizeConfig(portable);
  assert.equal(dropped, 0);
  assert.deepEqual(config, portable, 'the validator must not change a default value');
  assert.equal(theme, 'system');
  assert.equal(DEFAULT_CONFIG.defaultProfile.enabled, true);
  assert.deepEqual(DEFAULT_CONFIG.appProfiles, {});
  assert.deepEqual(DEFAULT_CONFIG.scroll, { invert: false, speed: 1, acceleration: 0, smoothing: 0 });
});
