const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { buildClientFilesManifest, startUpdaterServer } = require('../src/services/updaterServer.js');
const { hashAccessPassword } = require('../src/config.js');

test('buildClientFilesManifest scanne required et optional avec hash SHA-1', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modey-updater-'));
  try {
    const reqMods = path.join(tmpDir, 'client-files', 'required', 'mods');
    const optMods = path.join(tmpDir, 'client-files', 'optional', 'mods');
    fs.mkdirSync(reqMods, { recursive: true });
    fs.mkdirSync(optMods, { recursive: true });

    const reqPayload = Buffer.from('required-mod-content');
    const optPayload = Buffer.from('optional-mod-content');
    fs.writeFileSync(path.join(reqMods, 'core.jar'), reqPayload);
    fs.writeFileSync(path.join(optMods, 'iris.jar'), optPayload);

    const manifest = buildClientFilesManifest(
      path.join(tmpDir, 'client-files'),
      'https://cdn.example.fr',
      'alpha'
    );

    assert.equal(manifest.success, true);
    assert.equal(manifest.count, 1);
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].name, 'core.jar');
    assert.equal(manifest.files[0].path, 'mods/');
    assert.equal(manifest.files[0].url, 'https://cdn.example.fr/files/required/mods/core.jar');
    assert.equal(manifest.files[0].sha1, crypto.createHash('sha1').update(reqPayload).digest('hex'));

    assert.equal(manifest.optionalMods.length, 1);
    assert.equal(manifest.optionalMods[0].id, 'iris');
    assert.equal(manifest.optionalMods[0].url, 'https://cdn.example.fr/files/optional/mods/iris.jar');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startUpdaterServer sert le manifeste ETag 304, les fichiers et bloque path traversal', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modey-updater-http-'));
  const reqDir = path.join(tmpDir, 'client-files', 'required', 'config');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, 'client.toml'), 'difficulty = "hard"\n', 'utf-8');

  const srv = await startUpdaterServer({
    serverDir: tmpDir,
    port: 0,
    host: '127.0.0.1',
    slug: 'demo'
  });

  try {
    const manifestResp = await fetch(`http://127.0.0.1:${srv.port}/files-updater`);
    assert.equal(manifestResp.status, 200);
    const etag = manifestResp.headers.get('etag');
    assert.ok(etag);
    const manifest = await manifestResp.json();
    assert.equal(manifest.files.length, 1);

    const notModifiedResp = await fetch(`http://127.0.0.1:${srv.port}/files-updater`, {
      headers: { 'If-None-Match': etag }
    });
    assert.equal(notModifiedResp.status, 304);

    const fileResp = await fetch(manifest.files[0].url);
    assert.equal(fileResp.status, 200);
    assert.equal(await fileResp.text(), 'difficulty = "hard"\n');

    const traversalStatus = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.port, path: '/files/../../secret.txt' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(traversalStatus, 403);
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('startUpdaterServer sert /server-meta et les images locales /assets/banner et /assets/icon', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modey-updater-meta-'));
  const visualsDir = path.join(tmpDir, 'visuals');
  fs.mkdirSync(visualsDir, { recursive: true });
  fs.writeFileSync(path.join(visualsDir, 'banner.png'), Buffer.from('fake-png-banner'));
  fs.writeFileSync(path.join(tmpDir, 'server-icon.png'), Buffer.from('fake-png-icon'));
  fs.writeFileSync(path.join(tmpDir, 'modey-server.json'), JSON.stringify({
    identity: { name: 'Mon Serveur Créateur', slug: 'mon-serveur', minecraft_version: '1.21.1', loader: 'neoforge', loader_version: '21.1.265' },
    game: { port: 25565 },
    launcher: { display_name: 'Mon Serveur Créateur', description: 'Un monde survie moddé unique.', tags: ['Survie', 'RP'] },
    visuals: { banner_url: '', icon_url: '' },
    modpack: { updater_port: 3008, public_updater_url: '' }
  }));

  const srv = await startUpdaterServer({
    serverDir: tmpDir,
    port: 0,
    host: '127.0.0.1',
    slug: 'mon-serveur'
  });

  try {
    const metaResp = await fetch(`http://127.0.0.1:${srv.port}/server-meta`);
    assert.equal(metaResp.status, 200);
    const meta = await metaResp.json();
    assert.equal(meta.name, 'Mon Serveur Créateur');
    assert.equal(meta.description, 'Un monde survie moddé unique.');
    assert.deepEqual(meta.tags, ['Survie', 'RP']);
    assert.equal(meta.bannerUrl, `http://127.0.0.1:${srv.port}/assets/banner`);
    assert.equal(meta.iconUrl, `http://127.0.0.1:${srv.port}/assets/icon`);

    const bannerResp = await fetch(meta.bannerUrl);
    assert.equal(bannerResp.status, 200);
    assert.equal(bannerResp.headers.get('content-type'), 'image/png');
    assert.equal(await bannerResp.text(), 'fake-png-banner');

    const iconResp = await fetch(meta.iconUrl);
    assert.equal(iconResp.status, 200);
    assert.equal(await iconResp.text(), 'fake-png-icon');
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Security hardening: port 3008 bloque méthodes écriture, dotfiles, null-byte et extensions non-images', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modey-updater-sec-'));
  const reqDir = path.join(tmpDir, 'client-files', 'required', 'mods');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, '.hidden-secret'), 'secret');
  fs.writeFileSync(path.join(reqDir, 'mod.jar'), 'jarbytes');
  fs.writeFileSync(path.join(tmpDir, 'modey-server.json'), JSON.stringify({
    identity: { slug: 'sec-test' },
    auth: { node_token: 'SUPER_SECRET_TOKEN' },
    visuals: { banner_path: 'modey-server.json' }
  }));

  const srv = await startUpdaterServer({
    serverDir: tmpDir,
    port: 0,
    host: '127.0.0.1',
    slug: 'sec-test'
  });

  try {
    const manifest = await (await fetch(`http://127.0.0.1:${srv.port}/files-updater`, {
      headers: { 'X-Forwarded-Proto': 'javascript' }
    })).json();
    assert.equal(manifest.count, 1);
    assert.equal(manifest.files[0].name, 'mod.jar');
    assert.ok(manifest.files[0].url.startsWith('http://'));

    const postResp = await fetch(`http://127.0.0.1:${srv.port}/files/required/mods/mod.jar`, { method: 'POST' });
    assert.equal(postResp.status, 405);

    const dotResp = await fetch(`http://127.0.0.1:${srv.port}/files/required/mods/.hidden-secret`);
    assert.equal(dotResp.status, 403);

    const nullResp = await fetch(`http://127.0.0.1:${srv.port}/files/required/mods/mod%00.jar`);
    assert.equal(nullResp.status, 403);

    const assetSecretResp = await fetch(`http://127.0.0.1:${srv.port}/assets/banner`);
    assert.equal(assetSecretResp.status, 404);

    const metaText = await (await fetch(`http://127.0.0.1:${srv.port}/server-meta`)).text();
    assert.equal(metaText.includes('SUPER_SECRET_TOKEN'), false);

    const jarResp = await fetch(`http://127.0.0.1:${srv.port}/files/required/mods/mod.jar`);
    assert.equal(jarResp.status, 200);
    assert.equal(jarResp.headers.get('x-content-type-options'), 'nosniff');
    assert.match(jarResp.headers.get('content-security-policy') || '', /sandbox/);
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Private password protection: /server-meta masque les détails, /files-updater et /files/* bloquent sans mot de passe puis déverrouillent avec ?token=', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modey-updater-pwd-'));
  const reqDir = path.join(tmpDir, 'client-files', 'required', 'mods');
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, 'secret-mod.jar'), 'modpayload');
  const pngTiny = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  fs.writeFileSync(path.join(tmpDir, 'banner.png'), pngTiny);

  const writeConfig = (pwd, version) => {
    fs.writeFileSync(path.join(tmpDir, 'modey-server.json'), JSON.stringify({
      identity: { slug: 'priv-srv', name: 'Serveur Privé Test', loader: 'fabric', minecraft_version: '1.21.1' },
      launcher: { display_name: 'Serveur Privé Test', description: 'Secret desc' },
      auth: {
        standalone: true,
        require_password: true,
        private_password_hash: hashAccessPassword(pwd),
        private_password_version: version
      }
    }));
  };
  writeConfig('pass1234', 'ver-1');

  const srv = await startUpdaterServer({ serverDir: tmpDir, port: 0, host: '127.0.0.1', slug: 'priv-srv' });
  try {
    // 1. /server-meta sans mdp -> payload minimal verrouillé
    const lockedMeta = await (await fetch(`http://127.0.0.1:${srv.port}/server-meta`)).json();
    assert.equal(lockedMeta.requiresPassword, true);
    assert.equal(lockedMeta.unlocked, false);
    assert.equal(lockedMeta.passwordVersion, 'ver-1');
    assert.equal(lockedMeta.name, 'Serveur Privé Test');
    assert.equal(lockedMeta.description, undefined);
    assert.equal(lockedMeta.bannerUrl, undefined);

    // 2. /files-updater et /files/* sans mdp -> 401
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/files-updater`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/files/required/mods/secret-mod.jar`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/assets/banner`)).status, 401);

    // 3. Mauvais mdp -> toujours verrouillé / 401
    assert.equal((await fetch(`http://127.0.0.1:${srv.port}/files-updater`, {
      headers: { 'X-Modey-Server-Password': 'wrong' }
    })).status, 401);

    // 4. Bon mdp -> déverrouillé + manifest signé ?token=
    const unlockedMeta = await (await fetch(`http://127.0.0.1:${srv.port}/server-meta`, {
      headers: { 'X-Modey-Server-Password': 'pass1234' }
    })).json();
    assert.equal(unlockedMeta.unlocked, true);
    assert.equal(unlockedMeta.description, 'Secret desc');
    assert.match(unlockedMeta.bannerUrl, /\?token=/);

    const manifestRes = await fetch(`http://127.0.0.1:${srv.port}/files-updater`, {
      headers: { 'X-Modey-Server-Password': 'pass1234' }
    });
    assert.equal(manifestRes.status, 200);
    const manifest = await manifestRes.json();
    assert.equal(manifest.files.length, 1);
    assert.match(manifest.files[0].url, /\?token=/);

    // 5. Téléchargement direct via URL signée ?token= sans header (compat eml-lib / <img>)
    const fileRes = await fetch(manifest.files[0].url);
    assert.equal(fileRes.status, 200);
    assert.equal(await fileRes.text(), 'modpayload');
    const bannerRes = await fetch(unlockedMeta.bannerUrl);
    assert.equal(bannerRes.status, 200);

    // 6. Rotation de mot de passe -> ancien ?token= immédiatement invalidé, nouvelle version exposée
    writeConfig('newpass99', 'ver-2');
    assert.equal((await fetch(manifest.files[0].url)).status, 401);
    const rotatedMeta = await (await fetch(`http://127.0.0.1:${srv.port}/server-meta`, {
      headers: { 'X-Modey-Server-Password': 'pass1234' }
    })).json();
    assert.equal(rotatedMeta.unlocked, false);
    assert.equal(rotatedMeta.passwordVersion, 'ver-2');
  } finally {
    await srv.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
