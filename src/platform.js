// Everything in the main process that depends on the operating system, as pure functions of the platform so it
// can be tested for every platform from any machine.
const os = require('os');
const path = require('path');

// Where config.json lives. The native helper reads the same file: the macOS helper uses the Application Support
// directory, the Windows helper uses os.UserConfigDir(), which is %AppData%.
function configDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'MouseRemapper');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'MouseRemapper');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'MouseRemapper');
}

function helperName(platform) {
  return platform === 'win32' ? 'MouseRemapHelper.exe' : 'MouseRemapHelper';
}

function helperPath({ platform = process.platform, packaged, resourcesPath, projectRoot }) {
  const name = helperName(platform);
  if (packaged) return path.join(resourcesPath, name);
  return platform === 'win32' ? path.join(projectRoot, 'native', 'windows', name) : path.join(projectRoot, 'native', name);
}

// macOS tray icons are "template" images the system recolours; Windows needs a normal coloured icon.
function trayIcon(platform = process.platform) {
  return platform === 'darwin' ? { file: 'trayTemplate.png', template: true } : { file: 'trayWin.png', template: false };
}

// Only macOS asks for a permission (Accessibility) before a process may watch the mouse.
function needsAccessibilityPermission(platform = process.platform) {
  return platform === 'darwin';
}

// A GUI app spawning a console program on Windows would flash a console window without windowsHide.
function spawnOptions(platform = process.platform, stdio) {
  return { stdio, windowsHide: platform === 'win32' };
}

module.exports = { configDir, helperName, helperPath, trayIcon, needsAccessibilityPermission, spawnOptions };
