const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { buildClientFilesManifest, startUpdaterServer } = require('../src/services/updaterServer.js');

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
