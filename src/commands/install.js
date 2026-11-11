/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { spawn } = require('child_process');
const { loadConfig } = require('../config.js');
const { initCommand } = require('./init.js');
const {
  downloadFile,
  acceptEula,
  resolvePaperDownloadUrl,
  resolveVanillaDownloadUrl,
  resolveFabricServerJarUrl,
  resolveNeoForgeInstallerUrl
} = require('../services/installer.js');
const { generateStartScripts } = require('../services/runtime.js');
const logger = require('../utils/logger.js');
const { bold, cyan } = require('../utils/colors.js');

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Le processus ${command} s'est terminé avec le code ${code}.`));
    });
  });
}

async function installCommand(args = {}) {
  logger.banner();
  let config = await loadConfig();

  // Si modey-server.json est absent, lancer l'assistant de configuration automatiquement
  if (!config) {
    logger.info('Aucun fichier modey-server.json détecté dans ce dossier : lancement de la configuration guidée.');
    config = await initCommand({
      ...args,
      skipBanner: true,
      skipNextStepHint: true
    });
    if (!config) {
      throw new Error('Configuration annulée : installation interrompue.');
    }
  }

  const { minecraft_version, loader, loader_version } = config.identity;
  logger.step(`Étape 2 · Installation du serveur [${loader.toUpperCase()} ${loader_version || ''} · MC ${minecraft_version}]`);

  // 1. Préparation des dossiers serveur & client-files (Files-Updater)
  const dirsToCreate = [
    'mods',
    'config',
    'client-files/required/mods',
    'client-files/required/config',
    'client-files/optional/mods',
    'client-files/optional/shaderpacks',
    'client-files/optional/resourcepacks'
  ];
  for (const rel of dirsToCreate) {
    await fs.mkdir(path.resolve(process.cwd(), rel), { recursive: true });
  }
  logger.info('Dossiers /mods, /config et /client-files prêts.');

  // 2. Acceptation du contrat EULA et server.properties initial
  await acceptEula();
  logger.success('Contrat eula.txt accepté (eula=true).');

  const propsPath = path.resolve(process.cwd(), 'server.properties');
  if (!fsSync.existsSync(propsPath)) {
    const port = Number(config.network?.port || 25565);
    const motd = config.identity?.motd || config.identity?.name || 'Serveur Modey';
    await fs.writeFile(propsPath, `server-port=${port}\nmotd=${motd}\n`, 'utf-8');
    logger.info(`Fichier server.properties créé (port ${port}).`);
  }

  // 3. Téléchargement et installation selon le loader
  const targetJar = config.runtime?.server_jar || 'server.jar';
  const destPath = path.resolve(process.cwd(), targetJar);

  if (loader === 'paper') {
    logger.info(`Recherche du dernier build PaperMC pour ${minecraft_version}...`);
    const paperUrl = await resolvePaperDownloadUrl(minecraft_version);
    logger.info(`Téléchargement de PaperMC : ${paperUrl}`);
    await downloadFile(paperUrl, destPath);
    logger.success(`PaperMC installé sous ${bold(cyan(targetJar))}.`);
  } else if (loader === 'fabric') {
    logger.info(`Téléchargement du serveur Fabric (${loader_version || '0.16.9'})...`);
    const fabricUrl = resolveFabricServerJarUrl(minecraft_version, loader_version || '0.16.9');
    await downloadFile(fabricUrl, destPath);
    logger.success(`Fabric Server installé sous ${bold(cyan(targetJar))}.`);
  } else if (loader === 'vanilla') {
    logger.info(`Recherche du server.jar officiel Vanilla ${minecraft_version}...`);
    const vanillaUrl = await resolveVanillaDownloadUrl(minecraft_version);
    logger.info(`Téléchargement de Vanilla ${minecraft_version}...`);
    await downloadFile(vanillaUrl, destPath);
    logger.success(`Vanilla installé sous ${bold(cyan(targetJar))}.`);
  } else if (loader === 'neoforge') {
    const installerFile = 'neoforge-installer.jar';
    const installerPath = path.resolve(process.cwd(), installerFile);
    logger.info(`Téléchargement de l'installeur NeoForge ${loader_version}...`);
    const neoUrl = resolveNeoForgeInstallerUrl(loader_version);
    await downloadFile(neoUrl, installerPath);
    logger.success(`Installeur NeoForge téléchargé (${installerFile}).`);
    logger.info('Installation des bibliothèques NeoForge en cours (java --install-server)...');
    try {
      await runProcess('java', ['-jar', installerFile, '--install-server'], process.cwd());
      logger.success('Serveur NeoForge installé avec succès.');
    } catch (err) {
      logger.warn(`Installation automatique NeoForge interrompue (${err.message}).`);
      logger.info(`Vérifiez que Java 21+ est installé puis lancez : ${bold(`java -jar ${installerFile} --install-server`)}`);
    }
  } else {
    logger.info(`Loader personnalisé (${loader}) : placez votre exécutable sous ${bold(cyan(targetJar))}.`);
  }

  // 4. Génération des scripts start.bat / start.sh sans Docker
  logger.step('Étape 3 · Finalisation & scripts de démarrage');
  const scripts = await generateStartScripts(process.cwd());
  if (scripts.length > 0) {
    logger.info(`Scripts générés : ${bold(cyan(scripts.join(', ')))}`);
  }

  const starterHint = process.platform === 'win32' ? 'start.bat' : './start.sh';
  logger.success(`Installation terminée ! Démarrez votre serveur avec ${bold(starterHint)} ou ${bold('modey-server run')}.`);

  if (args.offerLaunch && stdin.isTTY) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const launchNow = await rl.question('Démarrer le serveur maintenant ? [o/N]: ');
    rl.close();
    if (/^(o|oui|y|yes)$/i.test(launchNow.trim())) {
      const { runCommand } = require('./run.js');
      await runCommand({});
    }
  }
}

module.exports = { installCommand };
