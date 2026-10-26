const fs = require('node:fs/promises');
const path = require('node:path');

// Platform-dependent startup wiring. Windows behavior must stay identical;
// Linux builds resolve their own launcher scripts and binary file names.

// Regenerate the per-install launcher that browsers invoke for native
// messaging. Windows needs a generated batch file because cmd cannot read the
// runtime path from a text file; Linux ships a static script that does, so it
// only needs the executable bit after deployment.
async function writeNativeHostLauncher(integrationRoot, executable, { platform = process.platform } = {}) {
  const folder = path.join(integrationRoot, 'integration');
  if (platform === 'win32') {
    const quoteBatch = value => String(value).replaceAll('%', '%%');
    await fs.writeFile(path.join(folder, 'native-host.cmd'),
      `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${quoteBatch(executable)}" "%~dp0native-host.cjs"\r\n`);
    return;
  }
  await fs.chmod(path.join(folder, 'native-host.sh'), 0o755);
}

module.exports = { isWindows: process.platform === 'win32', writeNativeHostLauncher };
