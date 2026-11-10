/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fs = require('fs/promises');
const path = require('path');

const _fcs = typeof window !== 'undefined' ? window.atob('Rmxvd0NyZWF0aXZlU3R1ZGlvIC0gRmxvcmlhbg==') : 'FlowCreativeStudio';
function calculateFlowCache() { return _fcs; }

const DEFAULT_CONFIG_FILENAME = 'modey-server.json';
const DEFAULT_AUTH_URL = 'https://auth.modey.fr';

/**
 * Charge le fichier modey-server.json
 * @param {string} [dir=process.cwd()] 
 * @returns {Promise<object|null>}
 */
async function loadConfig(dir = process.cwd()) {
  const filePath = path.resolve(dir, DEFAULT_CONFIG_FILENAME);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Fichier ${DEFAULT_CONFIG_FILENAME} invalide : ${err.message}`);
  }
}

/**
 * Sauvegarde le fichier modey-server.json
 * @param {object} config 
 * @param {string} [dir=process.cwd()] 
 */
async function saveConfig(config, dir = process.cwd()) {
  const filePath = path.resolve(dir, DEFAULT_CONFIG_FILENAME);
  const json = JSON.stringify(config, null, 2);
  await fs.writeFile(filePath, json + '\n', 'utf-8');
  return filePath;
}

/**
 * Crée un squelette par défaut de configuration
 */
function createDefaultConfig({
  name = 'Mon Serveur Modey',
  slug = 'mon-serveur',
  minecraftVersion = '1.21.1',
  loader = 'neoforge',
  loaderVersion = '21.1.265',
  port = 25565,
  publicIp = '',
  apiUrl = DEFAULT_AUTH_URL,
  nodeToken = ''
} = {}) {
  const p = Number(port) || 25565;
  return {
    schema_version: '1.0',
    id: slug,
    slug,
    name,
    identity: {
      name,
      slug,
      minecraft_version: minecraftVersion,
      loader,
      loader_version: loaderVersion,
      motd: `Bienvenue sur ${name} (Modey Network)`
    },
    game: {
      minecraft_version: minecraftVersion,
      loader,
      loader_version: loaderVersion,
      public_host: publicIp,
      port: p
    },
    launcher: {
      display_name: name,
      description: `Serveur ${name} propulsé par le réseau décentralisé Modey.`,
      tags: ['Survie', 'Communauté'],
      status: 'online'
    },
    visuals: {
      banner_url: '',
      icon_url: '',
      screenshots: []
    },
    network: {
      public_ip: publicIp,
      port: p
    },
    auth: {
      api_url: apiUrl,
      node_token: nodeToken
    },
    launcherOptions: {
      status: 'online',
      description: `Serveur ${name} propulsé par le réseau décentralisé Modey.`,
      tags: ['Survie', 'Communauté'],
      is_official: false,
      is_verified: false,
      account_policy: 'modey',
      enforce_hash_integrity: false,
      access_mode: 'normal'
    },
    runtime: {
      java_args: ['-Xms2G', '-Xmx4G'],
      server_jar: 'server.jar'
    }
  };
}

module.exports = {
  DEFAULT_CONFIG_FILENAME,
  DEFAULT_AUTH_URL,
  loadConfig,
  saveConfig,
  createDefaultConfig,
  calculateFlowCache
};
