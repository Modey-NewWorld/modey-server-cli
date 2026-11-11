/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { parseArgs } = require('../src/index.js');
const { createDefaultConfig, loadConfig, saveConfig, calculateFlowCache } = require('../src/config.js');
const { ModeyApiClient } = require('../src/services/api.js');
const { resolveJavaLaunchSpec, generateStartScripts } = require('../src/services/runtime.js');
const { normalizeLoaderChoice, normalizeRamJavaArgs, slugifyName } = require('../src/commands/init.js');
const { getNeoForgePrefixForMc, resolvePaperDownloadUrl } = require('../src/services/installer.js');

test('CLI: parseArgs analyse correctement les arguments et flags', () => {
  const args = ['init', '--slug', 'valkyrie', '--port=25570', '--non-interactive', '-v'];
  const res = parseArgs(args);

  assert.equal(res._[0], 'init');
  assert.equal(res.slug, 'valkyrie');
  assert.equal(res.port, '25570');
  assert.equal(res['non-interactive'], true);
  assert.equal(res.v, true);
});

test('Config: createDefaultConfig produit un manifeste complet et valide', () => {
  const conf = createDefaultConfig({
    name: 'Valkyrie SMP',
    slug: 'valkyrie-smp',
    minecraftVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.9',
    port: 25580
  });

  assert.equal(conf.schema_version, '1.0');
  assert.equal(conf.identity.name, 'Valkyrie SMP');
  assert.equal(conf.identity.slug, 'valkyrie-smp');
  assert.equal(conf.identity.loader, 'fabric');
  assert.equal(conf.network.port, 25580);
  assert.equal(conf.auth.api_url, 'https://api.modey.flowcrea.fr');
  assert.equal(typeof conf.launcherOptions, 'object');
  assert.equal(conf.launcherOptions.account_policy, 'modey');
});

test('Config: loadConfig et saveConfig gèrent correctement les fichiers JSON', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modey-test-'));
  try {
    const sample = createDefaultConfig({ slug: 'test-node' });
    const saved = await saveConfig(sample, tmpDir);
    assert.ok(saved.endsWith('modey-server.json'));

    const loaded = await loadConfig(tmpDir);
    assert.deepEqual(loaded.identity.slug, 'test-node');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Security & Signature: le getter FlowCreativeStudio est bien présent', () => {
  const author = calculateFlowCache();
  assert.equal(author, 'FlowCreativeStudio');
});

test('API Client: ModeyApiClient instanciation et format d\'URL', () => {
  const client = new ModeyApiClient('https://api.modey.flowcrea.fr/', 'secret-node-token');
  assert.equal(client.baseUrl, 'https://api.modey.flowcrea.fr');
  assert.equal(client.nodeToken, 'secret-node-token');
});

test('Config: mode standalone vide api_url et node_token proprement', () => {
  const conf = createDefaultConfig({ slug: 'local-srv', standalone: true });
  assert.equal(conf.auth.standalone, true);
  assert.equal(conf.auth.api_url, '');
  assert.equal(conf.auth.node_token, '');
});

test('Runtime: resolveJavaLaunchSpec détecte NeoForge (win_args/unix_args) et server.jar', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modey-runtime-'));
  try {
    // 1. Aucun exécutable -> erreur claire
    assert.throws(() => resolveJavaLaunchSpec(tmpDir, {}), /modey-server install/);

    // 2. Paper / Fabric server.jar
    await fs.writeFile(path.join(tmpDir, 'server.jar'), 'stub');
    const jarSpec = resolveJavaLaunchSpec(tmpDir, {
      identity: { loader: 'paper' },
      runtime: { java_args: ['-Xmx2G'], server_jar: 'server.jar' }
    });
    assert.equal(jarSpec.mode, 'jar');
    assert.deepEqual(jarSpec.args, ['-Xmx2G', '-jar', 'server.jar', 'nogui']);

    // 3. NeoForge libraries/net/neoforged/neoforge/<ver>/{win,unix}_args.txt + authlib-injector
    const neoDir = path.join(tmpDir, 'libraries', 'net', 'neoforged', 'neoforge', '21.1.265');
    await fs.mkdir(neoDir, { recursive: true });
    await fs.writeFile(path.join(neoDir, 'win_args.txt'), '-cp stub');
    await fs.writeFile(path.join(neoDir, 'unix_args.txt'), '-cp stub');
    await fs.writeFile(path.join(tmpDir, 'authlib-injector.jar'), 'stub');

    const neoWin = resolveJavaLaunchSpec(tmpDir, {
      identity: { loader: 'neoforge', loader_version: '21.1.265' },
      runtime: { java_args: ['-Xms1G', '-Xmx4G'] }
    }, 'win32');
    assert.equal(neoWin.mode, 'args-file');
    assert.equal(neoWin.yggdrasilInjected, true);
    assert.deepEqual(neoWin.args, [
      '-Xms1G',
      '-Xmx4G',
      '-javaagent:authlib-injector.jar=https://api.modey.flowcrea.fr/api/yggdrasil',
      '@libraries/net/neoforged/neoforge/21.1.265/win_args.txt',
      'nogui'
    ]);

    const neoLinux = resolveJavaLaunchSpec(tmpDir, {
      identity: { loader: 'neoforge', loader_version: '21.1.265' },
      auth: { yggdrasil_enabled: false },
      runtime: { java_args: ['-Xms1G', '-Xmx4G'] }
    }, 'linux');
    assert.equal(neoLinux.yggdrasilInjected, false);
    assert.deepEqual(neoLinux.args, [
      '-Xms1G',
      '-Xmx4G',
      '@libraries/net/neoforged/neoforge/21.1.265/unix_args.txt',
      'nogui'
    ]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Runtime: generateStartScripts génère start.bat et start.sh sans Docker', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modey-scripts-'));
  try {
    const created = await generateStartScripts(tmpDir);
    assert.deepEqual(created.sort(), ['start.bat', 'start.sh']);
    const bat = await fs.readFile(path.join(tmpDir, 'start.bat'), 'utf-8');
    const sh = await fs.readFile(path.join(tmpDir, 'start.sh'), 'utf-8');
    assert.match(bat, /call modey-server run/);
    assert.match(bat, /call npx --yes github:Modey-NewWorld\/modey-server-cli run/);
    assert.match(sh, /exec modey-server run/);
    assert.match(sh, /exec npx --yes github:Modey-NewWorld\/modey-server-cli run/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Wizard helpers: choix loader, RAM, slug et préfixe NeoForge', () => {
  assert.equal(normalizeLoaderChoice('1'), 'neoforge');
  assert.equal(normalizeLoaderChoice('2'), 'fabric');
  assert.equal(normalizeLoaderChoice('3'), 'paper');
  assert.equal(normalizeLoaderChoice('4'), 'vanilla');
  assert.equal(normalizeLoaderChoice('PaperMC'), 'paper');

  assert.deepEqual(normalizeRamJavaArgs('6'), ['-Xms1G', '-Xmx6G']);
  assert.deepEqual(normalizeRamJavaArgs('4G'), ['-Xms1G', '-Xmx4G']);
  assert.equal(slugifyName('Mon Serveur Athéna !'), 'mon-serveur-athena');
  assert.equal(getNeoForgePrefixForMc('1.21.1'), '21.1.');
  assert.equal(getNeoForgePrefixForMc('1.21'), '21.0.');
});

test('Installer: resolvePaperDownloadUrl supporte le format PaperMC Fill API v3', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /fill\.papermc\.io\/v3\/projects\/paper\/versions\/1\.21\.1\/builds/);
    return new Response(JSON.stringify([
      {
        id: 133,
        channel: 'STABLE',
        downloads: { 'server:default': { url: 'https://fill-data.papermc.io/v1/objects/abc/paper-1.21.1-133.jar' } }
      }
    ]), { status: 200 });
  };
  try {
    const dlUrl = await resolvePaperDownloadUrl('1.21.1');
    assert.equal(dlUrl, 'https://fill-data.papermc.io/v1/objects/abc/paper-1.21.1-133.jar');
  } finally {
    globalThis.fetch = origFetch;
  }
});
