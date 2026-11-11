/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fs = require('fs/promises');
const path = require('path');

const _fcs = typeof window !== 'undefined' ? window.atob('Rmxvd0NyZWF0aXZlU3R1ZGlvIC0gRmxvcmlhbg==') : 'FlowCreativeStudio';
function calculateFlowCache() { return _fcs; }

const DEFAULT_CONFIG_FILENAME = 'modey-server.json';
const DEFAULT_AUTH_URL = 'https://api.modey.flowcrea.fr';
const DEFAULT_YGGDRASIL_URL = 'https://api.modey.flowcrea.fr/api/yggdrasil';

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

function isServerModdedLoader(loader) {
  return ['neoforge', 'forge', 'fabric', 'quilt'].includes(String(loader || '').toLowerCase());
}

function resolveEffectiveClientConfig(config = {}) {
  const serverLoader = String(config.game?.loader || config.identity?.loader || 'neoforge').toLowerCase();
  const serverLoaderVersion = config.game?.loader_version || config.identity?.loader_version || '';
  const rawClient = config.client || {};
  const isModdedServer = isServerModdedLoader(serverLoader);

  if (isModdedServer) {
    return {
      mode: rawClient.mode || 'mirror',
      loader: serverLoader,
      loader_version: serverLoaderVersion,
      allow_client_choice: false,
      available_presets: Array.isArray(rawClient.available_presets) ? rawClient.available_presets : [],
      default_preset: rawClient.default_preset || serverLoader,
      preset_slot: rawClient.preset_slot || 'optional',
      has_mods: true
    };
  }

  const mode = rawClient.mode || 'vanilla';
  const rawLoader = String(rawClient.loader || '').toLowerCase();
  const safeLoader = ['fabric', 'forge', 'neoforge', 'quilt', 'vanilla'].includes(rawLoader)
    ? rawLoader
    : 'vanilla';
  const defaultPresets = ['vanilla', 'fabric-opti', 'fabric-shaders'];

  return {
    mode,
    loader: mode === 'vanilla' ? 'vanilla' : safeLoader,
    loader_version: mode === 'vanilla' ? '' : (rawClient.loader_version || ''),
    allow_client_choice: Boolean(rawClient.allow_client_choice ?? (mode === 'choice')),
    available_presets: Array.isArray(rawClient.available_presets) && rawClient.available_presets.length > 0
      ? rawClient.available_presets
      : (mode === 'choice' ? defaultPresets : []),
    default_preset: rawClient.default_preset || (mode === 'preset' ? rawClient.default_preset || 'fabric-shaders' : 'vanilla'),
    preset_slot: rawClient.preset_slot || 'required',
    has_mods: Boolean(rawClient.has_mods ?? (mode === 'preset' || mode === 'custom'))
  };
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
  yggdrasilUrl = DEFAULT_YGGDRASIL_URL,
  yggdrasilEnabled = true,
  nodeToken = '',
  linked = false,
  standalone = false,
  javaArgs = null,
  updaterEnabled = undefined,
  updaterPort = 3008,
  client = null
} = {}) {
  const p = Number(port) || 25565;
  const isStandalone = Boolean(standalone);
  const resolvedToken = isStandalone ? '' : (nodeToken || '');
  const cleanServerLoader = String(loader || 'neoforge').toLowerCase();
  const isModdedServer = isServerModdedLoader(cleanServerLoader);

  const normalizedClient = resolveEffectiveClientConfig({
    identity: { loader: cleanServerLoader, loader_version: loaderVersion },
    client: client || (isModdedServer
      ? { mode: 'mirror', loader: cleanServerLoader, loader_version: loaderVersion, allow_client_choice: false, has_mods: true }
      : { mode: 'choice', loader: 'vanilla', loader_version: '', allow_client_choice: true, available_presets: ['vanilla', 'fabric-opti', 'fabric-shaders'], default_preset: 'vanilla', has_mods: false })
  });

  const effectiveUpdaterEnabled = updaterEnabled !== undefined
    ? Boolean(updaterEnabled)
    : (isModdedServer || normalizedClient.has_mods);

  return {
    schema_version: '1.1',
    id: slug,
    slug,
    name,
    identity: {
      name,
      slug,
      minecraft_version: minecraftVersion,
      loader: cleanServerLoader,
      loader_version: loaderVersion,
      motd: `Bienvenue sur ${name} (Modey Network)`
    },
    game: {
      minecraft_version: minecraftVersion,
      loader: cleanServerLoader,
      loader_version: loaderVersion,
      public_host: publicIp,
      port: p
    },
    client: normalizedClient,
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
      standalone: isStandalone,
      linked: Boolean(!isStandalone && (linked || resolvedToken)),
      api_url: isStandalone ? '' : (apiUrl || DEFAULT_AUTH_URL),
      yggdrasil_url: yggdrasilUrl || DEFAULT_YGGDRASIL_URL,
      yggdrasil_enabled: yggdrasilEnabled !== false,
      node_token: resolvedToken
    },
    modpack: {
      enabled: effectiveUpdaterEnabled,
      updater_port: Number(updaterPort) || 3008,
      public_updater_url: ''
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
      java_args: Array.isArray(javaArgs) && javaArgs.length > 0 ? javaArgs : ['-Xms2G', '-Xmx4G'],
      server_jar: 'server.jar'
    }
  };
}

module.exports = {
  DEFAULT_CONFIG_FILENAME,
  DEFAULT_AUTH_URL,
  DEFAULT_YGGDRASIL_URL,
  loadConfig,
  saveConfig,
  createDefaultConfig,
  calculateFlowCache,
  isServerModdedLoader,
  resolveEffectiveClientConfig
};
