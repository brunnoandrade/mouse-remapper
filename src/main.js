const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'MouseRemapper');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  mappings: [],
  scrollThreshold: 4.0,
  suppressOriginalScroll: true,
  targetApps: [],
  theme: 'system',
};

const THEMES = ['system', 'light', 'dark'];

function ensureConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

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
function migrateConfig(cfg) {
  if (Array.isArray(cfg.mappings)) return cfg;
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

function readConfig() {
  ensureConfig();
  try {
    return { ...DEFAULT_CONFIG, ...migrateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function writeConfig(cfg) {
  ensureConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function helperBinaryPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'MouseRemapHelper');
  }
  return path.join(__dirname, '..', 'native', 'MouseRemapHelper');
}

let helperProcess = null;
let tray = null;
let settingsWindow = null;

function startHelper() {
  if (helperProcess) return;
  const bin = helperBinaryPath();
  helperProcess = spawn(bin, [], { stdio: ['ignore', 'pipe', 'pipe'] });
  helperProcess.stdout.on('data', (d) => console.log(`[helper] ${d}`));
  helperProcess.stderr.on('data', (d) => console.log(`[helper] ${d}`));
  helperProcess.on('exit', (code) => {
    console.log(`[helper] exited with code ${code}`);
    helperProcess = null;
  });
}

function stopHelper() {
  if (helperProcess) {
    helperProcess.kill();
    helperProcess = null;
  }
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    title: 'Mouse Remapper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Mouse Remapper');
  const menu = Menu.buildFromTemplate([
    { label: 'Configurações...', click: createSettingsWindow },
    { type: 'separator' },
    { label: 'Sair', click: () => { stopHelper(); app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', createSettingsWindow);
}

app.whenReady().then(() => {
  ensureConfig();
  writeConfig(readConfig()); // persist the migrated shape before the helper starts
  const { theme } = readConfig();
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'system';
  createTray();
  startHelper();
  createSettingsWindow();
});

app.on('window-all-closed', (e) => {
  e.preventDefault(); // keep running in tray
});

app.on('before-quit', () => {
  stopHelper();
});

ipcMain.handle('config:get', () => readConfig());
ipcMain.handle('config:set', (_evt, cfg) => {
  writeConfig(cfg);
  return true;
});
ipcMain.handle('theme:set', (_evt, theme) => {
  if (!THEMES.includes(theme)) return false;
  nativeTheme.themeSource = theme;
  writeConfig({ ...readConfig(), theme });
  return true;
});
ipcMain.handle('prefs:accessibility', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
});

ipcMain.handle('apps:list', () => {
  return new Promise((resolve) => {
    const bin = helperBinaryPath();
    const child = spawn(bin, ['--list-apps'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve([]);
      }
    });
    child.on('error', () => resolve([]));
  });
});

ipcMain.handle('apps:resolve', (_evt, bundleIds) => {
  return new Promise((resolve) => {
    if (!bundleIds || bundleIds.length === 0) return resolve([]);
    const bin = helperBinaryPath();
    const child = spawn(bin, [`--resolve-apps=${bundleIds.join(',')}`], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve([]);
      }
    });
    child.on('error', () => resolve([]));
  });
});
