const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const platform = require('../src/platform');

test('config directory per platform', () => {
  assert.equal(
    platform.configDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, home: 'C:\\Users\\me' }),
    path.join('C:\\Users\\me\\AppData\\Roaming', 'MouseRemapper'),
  );
  assert.equal(
    platform.configDir({ platform: 'win32', env: {}, home: '/home/me' }),
    path.join('/home/me', 'AppData', 'Roaming', 'MouseRemapper'),
    'falls back when %APPDATA% is missing',
  );
  assert.equal(
    platform.configDir({ platform: 'darwin', env: {}, home: '/Users/me' }),
    path.join('/Users/me', 'Library', 'Application Support', 'MouseRemapper'),
  );
  assert.equal(platform.configDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/x' }, home: '/h' }), path.join('/x', 'MouseRemapper'));
});

test('helper binary path: name, dev location and packaged location', () => {
  const base = { projectRoot: '/proj', resourcesPath: '/app/resources' };
  assert.equal(platform.helperPath({ ...base, platform: 'darwin', packaged: false }), path.join('/proj', 'native', 'MouseRemapHelper'));
  assert.equal(platform.helperPath({ ...base, platform: 'win32', packaged: false }), path.join('/proj', 'native', 'windows', 'MouseRemapHelper.exe'));
  assert.equal(platform.helperPath({ ...base, platform: 'darwin', packaged: true }), path.join('/app/resources', 'MouseRemapHelper'));
  assert.equal(platform.helperPath({ ...base, platform: 'win32', packaged: true }), path.join('/app/resources', 'MouseRemapHelper.exe'));
});

test('tray icon: template on macOS, coloured elsewhere', () => {
  assert.deepEqual(platform.trayIcon('darwin'), { file: 'trayTemplate.png', template: true });
  assert.deepEqual(platform.trayIcon('win32'), { file: 'trayWin.png', template: false });
  for (const icon of ['trayTemplate.png', 'trayWin.png']) {
    assert.ok(require('node:fs').existsSync(path.join(__dirname, '..', 'src', 'assets', icon)), `${icon} exists`);
  }
});

test('only macOS needs the accessibility permission', () => {
  assert.equal(platform.needsAccessibilityPermission('darwin'), true);
  assert.equal(platform.needsAccessibilityPermission('win32'), false);
});

test('a console helper spawned on Windows must not flash a window', () => {
  assert.equal(platform.spawnOptions('win32', ['ignore']).windowsHide, true);
  assert.equal(platform.spawnOptions('darwin', ['ignore']).windowsHide, false);
  assert.deepEqual(platform.spawnOptions('darwin', ['a', 'b']).stdio, ['a', 'b']);
});
