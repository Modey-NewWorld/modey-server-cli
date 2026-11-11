/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fs = require('fs/promises');
const path = require('path');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');

/**
 * Télécharge un fichier depuis une URL vers un chemin local avec stream
 */
async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Échec du téléchargement (${res.status} ${res.statusText}) : ${url}`);
  }
  const fileStream = createWriteStream(destPath);
  // @ts-ignore
  await pipeline(res.body, fileStream);
  return destPath;
}

/**
 * Écrit le fichier eula.txt
 */
async function acceptEula(dir = process.cwd()) {
  const filePath = path.resolve(dir, 'eula.txt');
  const content = `# Par modey-server-cli (${new Date().toISOString()})\neula=true\n`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Récupère l'URL de téléchargement du dernier build PaperMC (Fill API v3)
 */
async function resolvePaperDownloadUrl(minecraftVersion) {
  const buildsUrl = `https://fill.papermc.io/v3/projects/paper/versions/${minecraftVersion}/builds`;
  const res = await fetch(buildsUrl, {
    headers: { 'User-Agent': 'ModeyServerCLI/1.1 (+https://github.com/Modey-NewWorld/modey-server-cli)' }
  });
  if (!res.ok) {
    throw new Error(`Version PaperMC ${minecraftVersion} introuvable (${res.status}).`);
  }
  const builds = await res.json();
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error(`Aucun build Paper disponible pour la version ${minecraftVersion}.`);
  }
  // Fill v3 renvoie les builds du plus récent au plus ancien ; privilégier channel STABLE
  const preferred = builds.find((b) => b.channel === 'STABLE' && b.downloads?.['server:default']?.url)
    || builds.find((b) => b.downloads?.['server:default']?.url);
  const url = preferred?.downloads?.['server:default']?.url;
  if (!url) {
    throw new Error(`URL de téléchargement PaperMC introuvable pour ${minecraftVersion}.`);
  }
  return url;
}

/**
 * Récupère l'URL officielle Mojang du serveur Vanilla pour une version Minecraft
 */
async function resolveVanillaDownloadUrl(minecraftVersion) {
  const manifestRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  if (!manifestRes.ok) {
    throw new Error(`Impossible de joindre le manifeste Mojang (${manifestRes.status}).`);
  }
  const manifest = await manifestRes.json();
  const entry = (manifest.versions || []).find((v) => v.id === minecraftVersion);
  if (!entry?.url) {
    throw new Error(`Version Vanilla "${minecraftVersion}" introuvable chez Mojang.`);
  }
  const detailRes = await fetch(entry.url);
  if (!detailRes.ok) {
    throw new Error(`Détails de la version Vanilla "${minecraftVersion}" indisponibles (${detailRes.status}).`);
  }
  const detail = await detailRes.json();
  const serverUrl = detail?.downloads?.server?.url;
  if (!serverUrl) {
    throw new Error(`Aucun server.jar disponible pour la version Vanilla "${minecraftVersion}".`);
  }
  return serverUrl;
}

/**
 * Résout le préfixe NeoForge attendu pour une version Minecraft (ex: 1.21.1 -> "21.1.")
 */
function getNeoForgePrefixForMc(minecraftVersion = '1.21.1') {
  const parts = String(minecraftVersion).trim().split('.');
  if (parts.length >= 2 && parts[0] === '1') {
    const minor = parts[1];
    const patch = parts[2] || '0';
    return `${minor}.${patch}.`;
  }
  return '';
}

/**
 * Tente de récupérer la dernière version stable de NeoForge compatible avec la version MC
 */
async function resolveLatestNeoForgeVersion(minecraftVersion = '1.21.1') {
  const fallback = minecraftVersion === '1.21.1' ? '21.1.265' : '';
  const prefix = getNeoForgePrefixForMc(minecraftVersion);
  if (!prefix) return fallback;
  try {
    const res = await fetch('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    if (!res.ok) return fallback;
    const data = await res.json();
    const matches = (data.versions || []).filter(
      (v) => v.startsWith(prefix) && !v.includes('beta') && !v.includes('alpha')
    );
    return matches.length > 0 ? matches[matches.length - 1] : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Tente de récupérer la dernière version de Fabric Loader
 */
async function resolveLatestFabricVersion() {
  const fallback = '0.16.9';
  try {
    const res = await fetch('https://meta.fabricmc.net/v2/versions/loader');
    if (!res.ok) return fallback;
    const data = await res.json();
    const stable = Array.isArray(data) ? data.find((x) => x.stable) || data[0] : null;
    return stable?.version || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Récupère l'URL de l'installeur Fabric
 */
function resolveFabricServerJarUrl(minecraftVersion, loaderVersion = '0.16.9', installerVersion = '1.0.1') {
  return `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}/${loaderVersion}/${installerVersion}/server/jar`;
}

/**
 * Récupère l'URL de l'installeur NeoForge
 */
function resolveNeoForgeInstallerUrl(loaderVersion = '21.1.265') {
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
}

module.exports = {
  downloadFile,
  acceptEula,
  resolvePaperDownloadUrl,
  resolveVanillaDownloadUrl,
  getNeoForgePrefixForMc,
  resolveLatestNeoForgeVersion,
  resolveLatestFabricVersion,
  resolveFabricServerJarUrl,
  resolveNeoForgeInstallerUrl
};
