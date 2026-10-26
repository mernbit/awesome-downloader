const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

const HOST = 'com.awesome.downloader';

// Linux browsers read the manifest JSON directly from these per-user
// directories instead of consulting the Windows registry.
function linuxManifestDirectory(browser, home) {
  if (browser === 'Firefox') return path.join(home, '.mozilla', 'native-messaging-hosts');
  return path.join(home, '.config', { Chrome: 'google-chrome', Edge: 'microsoft-edge' }[browser], 'NativeMessagingHosts');
}

async function writeLinuxManifest(browser, content, home) {
  const directory = linuxManifestDirectory(browser, home);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${HOST}.json`), content, 'utf8');
}

async function registerBrowser({ browser, extensionId }, { dataDirectory, integrationRoot, platform = process.platform, home = os.homedir() }) {
  if (!['Chrome', 'Edge', 'Firefox'].includes(browser)) throw new Error('Choose Chrome, Edge, or Firefox.');
  if (typeof extensionId !== 'string' || !(browser === 'Firefox' ? /^[A-Za-z0-9@._{}-]{1,128}$/ : /^[a-p]{32}$/).test(extensionId)) throw new Error('Copy the extension ID from your browser’s extensions page.');
  const host = HOST;
  // The launcher name follows the requested platform, not the running one, so
  // cross-platform registration logic stays testable on either OS.
  const launcher = path.join(integrationRoot, 'integration', platform === 'win32' ? 'native-host.exe' : 'native-host.sh');
  const folder = path.join(dataDirectory, 'NativeMessaging');
  const manifestPath = path.join(folder, `${browser}.json`);
  const manifest = { name: host, description: 'Awesome Downloader browser bridge', path: launcher, type: 'stdio' };
  if (browser === 'Firefox') manifest.allowed_extensions = [extensionId];
  else manifest.allowed_origins = [`chrome-extension://${extensionId}/`];
  const content = JSON.stringify(manifest, null, 2);
  await fs.access(launcher);
  if (platform !== 'win32') await fs.chmod(launcher, 0o755);
  await fs.mkdir(folder, { recursive: true });
  let previous;
  try { previous = await fs.readFile(manifestPath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  if (previous && previous !== content) await fs.writeFile(`${manifestPath}.${stamp}.bak`, previous);
  if (platform === 'win32') {
    const roots = { Chrome: 'Google\\Chrome', Edge: 'Microsoft\\Edge', Firefox: 'Mozilla' };
    const key = `HKCU\\Software\\${roots[browser]}\\NativeMessagingHosts\\${host}`;
    let registry = null;
    try { registry = (await exec('reg.exe', ['QUERY', key, '/ve'], { windowsHide: true })).stdout; }
    catch (error) { if (error.code !== 1) throw error; }
    const previousPath = registry?.match(/REG_SZ\s+(.+)\r?\n?/)?.[1]?.trim();
    if (registry && previousPath !== manifestPath) await fs.writeFile(path.join(folder, `${browser}.${stamp}.registry-backup.txt`), registry);
    if (previous !== content) await fs.writeFile(manifestPath, content, 'utf8');
    if (previousPath !== manifestPath) await exec('reg.exe', ['ADD', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], { windowsHide: true });
  } else {
    if (previous !== content) await fs.writeFile(manifestPath, content, 'utf8');
    // Written unconditionally: a browser may be installed after the shared
    // manifest was first created, so its directory copy may not exist yet.
    await writeLinuxManifest(browser, content, home);
  }
  let extensionPath = path.join(integrationRoot, 'extension');
  if (browser === 'Firefox') {
    extensionPath = path.join(folder, 'firefox-extension');
    await fs.cp(path.join(integrationRoot, 'extension'), extensionPath, { recursive: true });
    await fs.copyFile(path.join(extensionPath, 'manifest.firefox.json'), path.join(extensionPath, 'manifest.json'));
  }
  return { ok: true, manifestPath, extensionPath };
}
// Read only extension registrations, never browser history, cookies, or page data.
async function connectInstalledBrowsers({ dataDirectory, integrationRoot, localAppData = process.env.LOCALAPPDATA, platform = process.platform, home = os.homedir() }) {
  const results = [];
  const scanRoot = localAppData ?? (platform === 'win32' ? process.env.LOCALAPPDATA : path.join(home, '.config'));
  const relatives = platform === 'win32'
    ? [['Chrome', 'Google/Chrome/User Data'], ['Edge', 'Microsoft/Edge/User Data']]
    : [['Chrome', 'google-chrome'], ['Edge', 'microsoft-edge']];
  for (const [browser, relative] of relatives) {
    const root = path.join(scanRoot, relative);
    let profiles;
    try { profiles = await fs.readdir(root, { withFileTypes: true }); } catch { continue; }
    const ids = new Set();
    for (const profile of profiles.filter(p => p.isDirectory() && /^(Default|Profile \d+)$/.test(p.name))) {
      for (const file of ['Preferences', 'Secure Preferences']) {
        try {
          const settings = JSON.parse(await fs.readFile(path.join(root, profile.name, file), 'utf8')).extensions?.settings || {};
          for (const [id, entry] of Object.entries(settings)) {
            if (!/^[a-p]{32}$/.test(id) || !entry.path || !path.isAbsolute(entry.path)) continue;
            const installed = await fs.realpath(entry.path).catch(() => null);
            const expected = await fs.realpath(path.join(integrationRoot, 'extension'));
            // Windows compares case-insensitively because drive-letter and
            // component casing vary; Linux paths are compared exactly.
            const samePath = platform === 'win32' ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
            let ownExtension = installed != null && samePath(installed, expected);
            if(installed&&!ownExtension){
              const manifest=JSON.parse(await fs.readFile(path.join(installed,'manifest.json'),'utf8'));
              const background=await fs.readFile(path.join(installed,'background.js'),'utf8');
              ownExtension=manifest.name==='Awesome Downloader Integration'&&manifest.background?.service_worker==='background.js'&&background.includes("const HOST = 'com.awesome.downloader'");
            }
            if (ownExtension) ids.add(id);
          }
        } catch { /* A running browser can temporarily replace a preference file. */ }
      }
    }
    if (ids.size) {
      const result = await registerBrowser({ browser, extensionId: [...ids][0] }, { dataDirectory, integrationRoot, platform, home });
      // Multiple profiles may assign different IDs to this same unpacked extension.
      const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
      manifest.allowed_origins = [...ids].map(id => `chrome-extension://${id}/`);
      const content = JSON.stringify(manifest, null, 2);
      await fs.writeFile(result.manifestPath, content);
      if (platform !== 'win32') await writeLinuxManifest(browser, content, home);
      results.push({ browser, connected: true });
    }
  }
  return results;
}
async function prepareNativeHost(integrationRoot, executable, { platform = process.platform } = {}) {
  const folder = path.join(integrationRoot, 'integration');
  if (platform === 'win32') {
    const target = path.join(folder, 'native-host.exe');
    try { await fs.access(target); }
    catch {
      const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
      await exec(compiler, ['/nologo', '/target:exe', `/out:${target}`, path.join(folder, 'NativeHostLauncher.cs')], { windowsHide: true });
    }
  } else {
    // No compiler is needed on Linux: the launcher is a shell script that
    // only has to be executable.
    await fs.chmod(path.join(folder, 'native-host.sh'), 0o755);
  }
  await fs.writeFile(path.join(folder, 'runtime-path.txt'), executable, 'utf8');
}
module.exports = { registerBrowser, connectInstalledBrowsers, prepareNativeHost };
