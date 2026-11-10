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
  assert.equal(conf.auth.api_url, 'https://auth.modey.fr');
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
  const client = new ModeyApiClient('https://auth.modey.fr/', 'secret-node-token');
  assert.equal(client.baseUrl, 'https://auth.modey.fr');
  assert.equal(client.nodeToken, 'secret-node-token');
});
