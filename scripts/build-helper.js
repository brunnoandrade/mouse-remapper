// Builds the native helper for the platform this runs on: Swift on macOS, Go on Windows.
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    const hint = command === 'go' ? ' Install Go from https://go.dev/dl/ and make sure it is on the PATH.' : '';
    console.error(`Could not run "${command}": ${result.error.message}.${hint}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

if (process.platform === 'darwin') {
  run('swiftc', ['-O', 'MouseRemapHelper.swift', '-o', 'MouseRemapHelper'], path.join(root, 'native'));
} else if (process.platform === 'win32') {
  run('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', 'MouseRemapHelper.exe', '.'], path.join(root, 'native', 'windows'));
} else {
  console.error('Mouse Remapper supports macOS and Windows only.');
  process.exit(1);
}
