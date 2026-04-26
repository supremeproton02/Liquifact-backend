const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const isWindows = os.platform() === 'win32';
const scriptName = isWindows ? 'e2e-api.ps1' : 'e2e-api.sh';
const scriptPath = path.join(__dirname, 'scripts', scriptName);

console.log(`Detected platform: ${os.platform()}`);
console.log(`Running E2E script: ${scriptName}`);

const command = isWindows ? 'powershell' : 'bash';
const args = isWindows ? ['-ExecutionPolicy', 'Bypass', '-File', scriptPath] : [scriptPath];

const child = spawn(command, args, { stdio: 'inherit' });

child.on('exit', (code) => {
  process.exit(code);
});
