const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { DEFAULT_CONFIG, THEMES, migrateConfig, sanitizeConfig } = require('./config');
const platform = require('./platform');

const CONFIG_DIR = platform.configDir();
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// macOS reports whether the app was started by its login item; on Windows the login item is registered with an
// extra argument instead, and its presence is the signal.
const LOGIN_ARGS = ['--hidden'];
const loginQuery = () => (process.platform === 'win32' ? { args: LOGIN_ARGS } : {});
const openedAtLogin = () => (process.platform === 'win32'
  ? process.argv.includes(LOGIN_ARGS[0])
  : app.getLoginItemSettings().wasOpenedAtLogin);

function ensureConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function readConfig() {
  ensureConfig();
  try {
    const cfg = migrateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    return { ...DEFAULT_CONFIG, ...cfg, scroll: { ...DEFAULT_CONFIG.scroll, ...cfg.scroll } };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function writeConfig(cfg) {
  ensureConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function helperBinaryPath() {
  return platform.helperPath({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    projectRoot: path.join(__dirname, '..'),
  });
}

// Runs the helper with arguments and returns what it printed ('' on any failure).
function runHelper(args) {
  return new Promise((resolve) => {
    const child = spawn(helperBinaryPath(), args, platform.spawnOptions(process.platform, ['ignore', 'pipe', 'ignore']));
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', () => resolve(out));
    child.on('error', () => resolve(''));
  });
}

let helperProcess = null;
let tray = null;
let settingsWindow = null;

function startHelper() {
  if (helperProcess) return;
  const bin = helperBinaryPath();
  helperProcess = spawn(bin, [], platform.spawnOptions(process.platform, ['ignore', 'pipe', 'pipe']));
  helperProcess.stdout.on('data', (d) => console.log(`[helper] ${d}`));
  helperProcess.stderr.on('data', (d) => console.log(`[helper] ${d}`));
  helperProcess.on('error', (err) => {
    console.log(`[helper] failed to start: ${err.message}`);
    helperProcess = null;
  });
  helperProcess.on('exit', (code) => {
    console.log(`[helper] exited with code ${code}`);
    helperProcess = null;
  });
}

// Whether the helper binary (the process that taps mouse events) may do so. Only macOS has such a permission.
async function checkAccessibility() {
  if (!platform.needsAccessibilityPermission()) return true;
  return (await runHelper(['--check-permission'])).trim() === 'true';
}

// Without the permission the helper exits right away; retry once it has been granted.
function watchHelper() {
  setInterval(async () => {
    if (helperProcess) return;
    if (await checkAccessibility()) startHelper();
  }, 3000);
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
    autoHideMenuBar: true, // Windows only: no File/Edit/View bar over a settings window
    ...(process.platform !== 'darwin' && { icon: path.join(__dirname, '..', 'build', 'icon.png') }),
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
  const { file, template } = platform.trayIcon();
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (template) icon.setTemplateImage(true);
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
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null); // the default menu is macOS-shaped
  ensureConfig();
  writeConfig(readConfig()); // persist the migrated shape before the helper starts
  const { theme } = readConfig();
  nativeTheme.themeSource = THEMES.includes(theme) ? theme : 'system';
  createTray();
  startHelper();
  watchHelper();
  // Launched by the login item: stay in the tray instead of popping up the window.
  if (!openedAtLogin()) createSettingsWindow();
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
// Back to a factory state: every value of the config (mappings, app profiles, scroll settings, appearance) and the
// login item, which is an operating-system registration rather than a config value.
ipcMain.handle('config:reset', () => {
  const defaults = structuredClone(DEFAULT_CONFIG);
  writeConfig(defaults);
  nativeTheme.themeSource = 'system';
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: false, ...loginQuery() });
  return defaults;
});

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

// The theme is a local preference, so exported files never carry it.
ipcMain.handle('config:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(settingsWindow || undefined, {
    title: 'Exportar configuração',
    defaultPath: 'mouse-remapper-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const { theme, ...portable } = readConfig();
  fs.writeFileSync(filePath, JSON.stringify({ app: 'mouse-remapper', version: 1, config: portable }, null, 2));
  return { ok: true, path: filePath };
});

// Imported files are untrusted: everything goes through sanitizeConfig before it can reach config.json,
// which the helper reads.
ipcMain.handle('config:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow || undefined, {
    title: 'Importar configuração',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };

  try {
    if (fs.statSync(filePaths[0]).size > MAX_IMPORT_BYTES) return { error: 'O arquivo é grande demais para ser uma configuração.' };
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      return { error: 'O arquivo não é um JSON válido.' };
    }
    const { config, dropped } = sanitizeConfig(raw);
    const merged = { ...config, theme: readConfig().theme };
    writeConfig(merged);
    return { ok: true, config: merged, dropped };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('theme:set', (_evt, theme) => {
  if (!THEMES.includes(theme)) return false;
  nativeTheme.themeSource = theme;
  writeConfig({ ...readConfig(), theme });
  return true;
});
ipcMain.handle('permission:status', () => checkAccessibility());
// Registering the dev Electron binary as a login item would be wrong, so only the packaged app can.
ipcMain.handle('login:get', () => ({
  supported: app.isPackaged,
  enabled: app.isPackaged && app.getLoginItemSettings(loginQuery()).openAtLogin,
}));
ipcMain.handle('login:set', (_evt, enabled) => {
  if (!app.isPackaged) return false;
  app.setLoginItemSettings({ openAtLogin: !!enabled, ...loginQuery() });
  return true;
});
ipcMain.handle('prefs:accessibility', () => {
  if (!platform.needsAccessibilityPermission()) return;
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
});

// The Windows helper only reports where an app's executable is; the icon comes from Electron.
async function withIcons(apps) {
  if (process.platform !== 'win32') return apps;
  return Promise.all(apps.map(async (a) => {
    if (!a.path || a.iconBase64) return a;
    try {
      const image = await app.getFileIcon(a.path, { size: 'normal' });
      return { ...a, iconBase64: image.toPNG().toString('base64') };
    } catch {
      return a;
    }
  }));
}

// Paths of apps seen while running, so a profile for an app that is closed still gets its icon and name.
const APP_CACHE_PATH = path.join(CONFIG_DIR, 'apps.json');

function readAppCache() {
  try {
    return JSON.parse(fs.readFileSync(APP_CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function rememberApps(apps) {
  const cache = readAppCache();
  let changed = false;
  for (const a of apps) {
    if (a.path && cache[a.bundleIdentifier] !== a.path) {
      cache[a.bundleIdentifier] = a.path;
      changed = true;
    }
  }
  if (changed) {
    try {
      fs.writeFileSync(APP_CACHE_PATH, JSON.stringify(cache, null, 2));
    } catch { /* a cache that cannot be written only costs some icons */ }
  }
}

function parseApps(out) {
  try {
    return JSON.parse(out);
  } catch {
    return [];
  }
}

ipcMain.handle('apps:list', async () => {
  const apps = parseApps(await runHelper(['--list-apps']));
  if (process.platform === 'win32') rememberApps(apps);
  return withIcons(apps);
});

ipcMain.handle('apps:resolve', async (_evt, bundleIds) => {
  if (!bundleIds || bundleIds.length === 0) return [];
  const apps = parseApps(await runHelper([`--resolve-apps=${bundleIds.join(',')}`]));
  if (process.platform === 'win32') {
    const cache = readAppCache();
    for (const a of apps) if (!a.path && cache[a.bundleIdentifier]) a.path = cache[a.bundleIdentifier];
  }
  return withIcons(apps);
});
