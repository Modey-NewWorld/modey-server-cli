/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fs = require('fs/promises');
const path = require('path');
const { loadConfig } = require('../config.js');
const {
  downloadFile,
  acceptEula,
  resolvePaperDownloadUrl,
  resolveFabricServerJarUrl,
  resolveNeoForgeInstallerUrl
} = require('../services/installer.js');
const logger = require('../utils/logger.js');
const { bold, cyan } = require('../utils/colors.js');

async function installCommand(args = {}) {
  logger.banner();
  const config = await loadConfig();

  if (!config) {
    throw new Error('Aucun fichier modey-server.json trouvé. Exécutez d\'abord: modey-server init');
  }

  const { minecraft_version, loader, loader_version } = config.identity;
  logger.step(`Installation du Serveur [${loader.toUpperCase()} ${loader_version || ''} pour MC ${minecraft_version}]`);

  // 1. Préparation des dossiers
  await fs.mkdir(path.resolve(process.cwd(), 'mods'), { recursive: true });
  await fs.mkdir(path.resolve(process.cwd(), 'config'), { recursive: true });
  logger.info('Dossiers /mods et /config initialisés.');

  // 2. Acceptation du contrat EULA
  await acceptEula();
  logger.success('Contrat eula.txt accepté (eula=true).');

  // 3. Téléchargement selon le loader
  const targetJar = config.runtime?.server_jar || 'server.jar';
  const destPath = path.resolve(process.cwd(), targetJar);

  if (loader === 'paper') {
    logger.info(`Recherche du dernier build PaperMC pour ${minecraft_version}...`);
    const paperUrl = await resolvePaperDownloadUrl(minecraft_version);
    logger.info(`Téléchargement de PaperMC : ${paperUrl}`);
    await downloadFile(paperUrl, destPath);
    logger.success(`PaperMC installé sous ${bold(cyan(targetJar))}.`);
  } else if (loader === 'fabric') {
    logger.info(`Téléchargement du serveur Fabric (${loader_version || 'dernière version'})...`);
    const fabricUrl = resolveFabricServerJarUrl(minecraft_version, loader_version || '0.16.9');
    await downloadFile(fabricUrl, destPath);
    logger.success(`Fabric Server installé sous ${bold(cyan(targetJar))}.`);
  } else if (loader === 'neoforge') {
    const installerFile = 'neoforge-installer.jar';
    const installerPath = path.resolve(process.cwd(), installerFile);
    logger.info(`Téléchargement de l'installeur NeoForge ${loader_version}...`);
    const neoUrl = resolveNeoForgeInstallerUrl(loader_version);
    await downloadFile(neoUrl, installerPath);
    logger.success(`Installeur NeoForge téléchargé (${installerFile}).`);
    logger.info(`Pour finaliser l'installation NeoForge, lancez: ${bold(`java -jar ${installerFile} --install-server`)}`);
  } else {
    logger.info(`Loader personnalisé ou ${loader} détecté. Veuillez placer votre jar sous ${bold(cyan(targetJar))}.`);
  }

  logger.success(`Installation terminée ! Vous pouvez maintenant lancer le serveur via ${bold('modey-server run')}.`);
}

module.exports = { installCommand };
