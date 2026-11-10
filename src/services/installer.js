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
 * Récupère le dernier build stable de PaperMC
 */
async function resolvePaperDownloadUrl(minecraftVersion) {
  const buildsUrl = `https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds`;
  const res = await fetch(buildsUrl);
  if (!res.ok) {
    throw new Error(`Version PaperMC ${minecraftVersion} introuvable sur l'API officielle.`);
  }
  const data = await res.json();
  const latestBuild = data.builds[data.builds.length - 1];
  if (!latestBuild) {
    throw new Error(`Aucun build Paper disponible pour la version ${minecraftVersion}.`);
  }
  const downloadName = latestBuild.downloads?.application?.name;
  return `https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds/${latestBuild.build}/downloads/${downloadName}`;
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
  resolveFabricServerJarUrl,
  resolveNeoForgeInstallerUrl
};
