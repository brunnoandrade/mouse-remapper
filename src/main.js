const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'MouseRemapper');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  scrollUp: { enabled: false, keyCode: 126, flags: 0 },
  scrollDown: { enabled: false, keyCode: 125, flags: 0 },
  middleClick: { enabled: false, keyCode: 49, flags: 0 },
  scrollThreshold: 4.0,
  suppressOriginalScroll: true,
  suppressOriginalMiddleClick: true,
  targetApps: [],
};

function ensureConfig() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

function readConfig() {
  ensureConfig();
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
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
    width: 480,
    height: 620,
    resizable: false,
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
  app.dock?.hide();
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
