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
const {
  createDefaultConfig,
  loadConfig,
  saveConfig,
  calculateFlowCache,
  isServerModdedLoader,
  resolveEffectiveClientConfig,
  hashAccessPassword,
  verifyAccessPassword,
  generatePasswordVersion
} = require('../src/config.js');
const { ModeyApiClient } = require('../src/services/api.js');
const { resolveJavaLaunchSpec, generateStartScripts } = require('../src/services/runtime.js');
const { normalizeLoaderChoice, normalizeRamJavaArgs, slugifyName } = require('../src/commands/init.js');
const { getDirectoriesToPrepare } = require('../src/commands/install.js');
const {
  getNeoForgePrefixForMc,
  getMinimumJavaVersionForMc,
  validateAndResolveLoader,
  resolvePaperDownloadUrl,
  resolveAuthlibInjectorUrl
} = require('../src/services/installer.js');
const { buildServerMetaPayload, buildClientFilesManifest } = require('../src/services/updaterServer.js');
const { formatMinecraftLine, fitVisible, stripAnsi, wrapLine, ServerTui } = require('../src/services/tui.js');

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

  assert.equal(conf.schema_version, '1.1');
  assert.equal(conf.identity.name, 'Valkyrie SMP');
  assert.equal(conf.identity.slug, 'valkyrie-smp');
  assert.equal(conf.identity.loader, 'fabric');
  assert.equal(conf.network.port, 25580);
  assert.equal(conf.auth.api_url, 'https://api.modey.flowcrea.fr');
  assert.equal(typeof conf.launcherOptions, 'object');
  assert.equal(conf.launcherOptions.account_policy, 'microsoft_required');
  assert.equal(conf.auth.requires_minecraft, true);
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

test('Runtime: generateStartScripts génère start.bat et start.sh sans Docker et supprime run.bat/run.sh', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modey-scripts-'));
  try {
    await fs.writeFile(path.join(tmpDir, 'run.bat'), '@echo neoforge');
    await fs.writeFile(path.join(tmpDir, 'run.sh'), '#!/bin/sh\nneoforge');
    const created = await generateStartScripts(tmpDir);
    assert.deepEqual(created.sort(), ['start.bat', 'start.sh']);
    const files = await fs.readdir(tmpDir);
    assert.equal(files.includes('run.bat'), false);
    assert.equal(files.includes('run.sh'), false);
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

test('Wizard helpers: choix loader (incl. Forge), RAM, slug et préfixe NeoForge', () => {
  assert.equal(normalizeLoaderChoice('1'), 'neoforge');
  assert.equal(normalizeLoaderChoice('2'), 'forge');
  assert.equal(normalizeLoaderChoice('3'), 'fabric');
  assert.equal(normalizeLoaderChoice('4'), 'paper');
  assert.equal(normalizeLoaderChoice('5'), 'vanilla');
  assert.equal(normalizeLoaderChoice('PaperMC'), 'paper');
  assert.equal(normalizeLoaderChoice('Forge'), 'forge');

  assert.deepEqual(normalizeRamJavaArgs('6'), ['-Xms1G', '-Xmx6G']);
  assert.deepEqual(normalizeRamJavaArgs('4G'), ['-Xms1G', '-Xmx4G']);
  assert.equal(slugifyName('Mon Serveur Athéna !'), 'mon-serveur-athena');
  assert.equal(getNeoForgePrefixForMc('1.21.1'), '21.1.');
  assert.equal(getNeoForgePrefixForMc('1.21'), '21.0.');
  assert.equal(getNeoForgePrefixForMc('1.20.1'), '47.1.');
});

test('Java & Loader compatibility: validation stricte par version Minecraft', async () => {
  assert.equal(getMinimumJavaVersionForMc('1.12.2'), 8);
  assert.equal(getMinimumJavaVersionForMc('1.16.5'), 8);
  assert.equal(getMinimumJavaVersionForMc('1.19.4'), 17);
  assert.equal(getMinimumJavaVersionForMc('1.20.4'), 17);
  assert.equal(getMinimumJavaVersionForMc('1.20.5'), 21);
  assert.equal(getMinimumJavaVersionForMc('1.21.1'), 21);

  const rejected = await validateAndResolveLoader('neoforge', '1.16.5');
  assert.equal(rejected.valid, false);
  assert.match(rejected.reason, /NeoForge/);
});

test('Config & Install: séparation serveur/client et suppression mods/ inutile sur Vanilla/Paper', () => {
  assert.equal(isServerModdedLoader('neoforge'), true);
  assert.equal(isServerModdedLoader('forge'), true);
  assert.equal(isServerModdedLoader('fabric'), true);
  assert.equal(isServerModdedLoader('paper'), false);
  assert.equal(isServerModdedLoader('vanilla'), false);

  const paperChoiceConf = createDefaultConfig({
    slug: 'hub-paper',
    minecraftVersion: '1.21.1',
    loader: 'paper',
    client: {
      mode: 'choice',
      loader: 'vanilla',
      allow_client_choice: true,
      available_presets: ['vanilla', 'fabric-opti', 'fabric-shaders'],
      default_preset: 'fabric-opti',
      has_mods: false
    }
  });
  const effective = resolveEffectiveClientConfig(paperChoiceConf);
  assert.equal(effective.loader, 'vanilla');
  assert.equal(effective.allow_client_choice, true);
  assert.equal(effective.has_mods, false);

  const paperDirs = getDirectoriesToPrepare('paper', effective, true);
  assert.ok(paperDirs.includes('plugins'));
  assert.equal(paperDirs.includes('mods'), false);
  assert.equal(paperDirs.includes('client-files/required/mods'), false);

  const vanillaNoUpdater = getDirectoriesToPrepare('vanilla', { has_mods: false }, false);
  assert.deepEqual(vanillaNoUpdater, []);
});

test('UpdaterServer: /server-meta et /files-updater exposent clientConfig sans créer mods/ sur un serveur Vanilla', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'modey-updater-meta-'));
  try {
    const conf = createDefaultConfig({
      name: 'Pure Vanilla',
      slug: 'pure-vanilla',
      minecraftVersion: '1.21.1',
      loader: 'vanilla',
      client: {
        mode: 'choice',
        loader: 'vanilla',
        allow_client_choice: true,
        available_presets: ['vanilla', 'fabric-opti', 'fabric-shaders'],
        default_preset: 'vanilla',
        has_mods: false
      }
    });
    await saveConfig(conf, tmpDir);
    const meta = buildServerMetaPayload(tmpDir, 'http://127.0.0.1:3008', 'pure-vanilla');
    assert.equal(meta.serverLoader, 'vanilla');
    assert.equal(meta.loader, 'vanilla');
    assert.equal(meta.allowClientChoice, true);
    assert.deepEqual(meta.availableClientPresets, ['vanilla', 'fabric-opti', 'fabric-shaders']);
    assert.equal(meta.hasClientMods, false);

    const manifest = buildClientFilesManifest(path.join(tmpDir, 'client-files'), 'http://127.0.0.1:3008', 'pure-vanilla', meta);
    assert.equal(manifest.allowClientChoice, true);
    assert.equal(manifest.slots.includes('mods'), false);
    assert.equal(manifest.defaultFolders.includes('mods'), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
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

test('Installer: resolveAuthlibInjectorUrl utilise latest.json officiel puis fallback GitHub', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('yushi.moe')) {
      return new Response(JSON.stringify({
        version: '1.2.8',
        download_url: 'https://authlib-injector.yushi.moe/artifact/56/authlib-injector-1.2.8.jar'
      }), { status: 200 });
    }
    throw new Error('Unexpected URL ' + url);
  };
  try {
    const url = await resolveAuthlibInjectorUrl();
    assert.equal(url, 'https://authlib-injector.yushi.moe/artifact/56/authlib-injector-1.2.8.jar');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('TUI Helpers: formatMinecraftLine filtre le bruit JVM et fitVisible ajuste la largeur', () => {
  assert.equal(formatMinecraftLine('WARNING: sun.misc.Unsafe::objectFieldOffset'), null);
  assert.ok(stripAnsi(formatMinecraftLine('[12:00:00] [Server thread/INFO]: Done (4.2s)!')).includes('Done'));
  const padded = fitVisible('Modey', 10);
  assert.equal(stripAnsi(padded).length, 10);
});

test('TUI Helpers: wrapLine et ServerTui adaptent le prompt " > " et le logo ASCII selon la fenêtre', () => {
  const parts = wrapLine('ABCDEFGHIJKLMNOPQRSTUVWXYZ01', 12);
  assert.deepEqual(parts, ['ABCDEFGHIJKL', 'MNOPQRSTUVWX', 'YZ01']);

  const tui = new ServerTui({ name: 'TestNode', slug: 'test-node', cliVersion: '1.3.0' });
  assert.equal(stripAnsi(tui.promptPrefix), ' > ');
  assert.equal(stripAnsi(tui.promptPrefix).includes('modey'), false);

  const wideHeader = tui.buildHeaderLines(100, 30).map(stripAnsi).join('\n');
  assert.ok(wideHeader.includes('Dedicated Node Engine v1.3.0'));
  assert.ok(wideHeader.includes('TestNode (test-node)'));

  const narrowHeader = tui.buildHeaderLines(60, 15).map(stripAnsi).join('\n');
  assert.equal(narrowHeader.includes('Dedicated Node Engine'), false);
  assert.ok(narrowHeader.includes('TestNode (test-node)'));
});

test('Security: hashAccessPassword, verifyAccessPassword et rotation private_password_version', () => {
  const hash = hashAccessPassword('secret1234');
  assert.ok(hash.startsWith('scrypt$'));
  assert.equal(verifyAccessPassword('secret1234', hash), true);
  assert.equal(verifyAccessPassword('wrongpass', hash), false);

  const v1 = generatePasswordVersion();
  const v2 = generatePasswordVersion();
  assert.ok(v1 && v2 && v1 !== v2);

  const conf = createDefaultConfig({
    slug: 'private-test',
    standalone: true,
    privatePassword: 'mon-mdp-prive'
  });
  assert.equal(conf.auth.require_password, true);
  assert.equal(verifyAccessPassword('mon-mdp-prive', conf.auth.private_password_hash), true);
  assert.ok(conf.auth.private_password_version);
});
