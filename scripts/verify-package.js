// Checks that a packaged build (dist/) really contains what the app needs at run time. It looks at the
// unpacked application of the platform it runs on, so it works the same on a developer's Mac and in CI.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dist = path.join(__dirname, '..', 'dist');
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

// An asar is a JSON header followed by the file contents: read the header to list what is inside.
function asarFiles(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    const names = [];
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files || {})) {
        if (child.files) walk(child, `${prefix}${name}/`);
        else names.push(`${prefix}${name}`);
      }
    };
    walk(JSON.parse(json.toString('utf8')), '');
    return names;
  } finally {
    fs.closeSync(fd);
  }
}

function find(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).map((n) => path.join(dir, n)).find(predicate) || null;
}

let resources;
let helperName;
if (process.platform === 'darwin') {
  const macDir = find(dist, (p) => path.basename(p).startsWith('mac'));
  const app = macDir && find(macDir, (p) => p.endsWith('.app'));
  check('dist/mac*/…app exists', !!app);
  if (!app) process.exit(1);
  resources = path.join(app, 'Contents', 'Resources');
  helperName = 'MouseRemapHelper';

  const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
  check('bundle id is com.brunnoandrade.mouseremapper', plist.includes('com.brunnoandrade.mouseremapper'));
  const version = require('../package.json').version;
  check(`bundle version is ${version}`, plist.includes(`<string>${version}</string>`));
  // CI has no signing certificate, so its builds are unsigned and there is nothing to verify.
  if (process.env.SKIP_SIGNATURE_CHECK) {
    console.log('SKIP  code signature (SKIP_SIGNATURE_CHECK is set)');
  } else {
    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
      check('code signature is intact', true);
    } catch (e) {
      check('code signature is intact', false, String(e.stderr || e.message).trim().split('\n')[0]);
    }
  }
} else if (process.platform === 'win32') {
  const unpacked = path.join(dist, 'win-unpacked');
  check('dist/win-unpacked exists', fs.existsSync(unpacked));
  resources = path.join(unpacked, 'resources');
  helperName = 'MouseRemapHelper.exe';
  check('the app executable exists', fs.existsSync(path.join(unpacked, 'Mouse Remapper.exe')));
} else {
  console.log('Nothing to verify on this platform.');
  process.exit(0);
}

const helper = path.join(resources, helperName);
check(`helper is in resources (${helperName})`, fs.existsSync(helper));
if (fs.existsSync(helper)) {
  const head = fs.readFileSync(helper).subarray(0, 4);
  if (process.platform === 'win32') {
    check('helper is a Windows executable (MZ)', head.subarray(0, 2).toString('latin1') === 'MZ');
  } else {
    const magic = head.readUInt32LE(0);
    check('helper is a Mach-O binary', [0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic));
    check('helper is executable', (fs.statSync(helper).mode & 0o111) !== 0);
  }
}

const asar = path.join(resources, 'app.asar');
check('app.asar exists', fs.existsSync(asar));
if (fs.existsSync(asar)) {
  const files = asarFiles(asar);
  for (const required of [
    'package.json', 'src/main.js', 'src/preload.js', 'src/config.js', 'src/platform.js', 'src/settings.html', 'src/settings.js',
    'src/assets/trayTemplate.png', 'src/assets/trayWin.png', 'build/icon.png',
  ]) check(`asar contains ${required}`, files.includes(required));
  const stray = files.filter((f) => /^(native|tests|scripts|\.github)\//.test(f));
  check('asar does not carry sources, tests or CI files', stray.length === 0, stray.slice(0, 3).join(', '));
  console.log(`      (${files.length} files in app.asar)`);
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nPackage looks right');
process.exit(failures.length ? 1 : 0);
