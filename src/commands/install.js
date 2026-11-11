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
const {
  loadConfig,
  saveConfig,
  isServerModdedLoader,
  resolveEffectiveClientConfig
} = require('../config.js');
const { initCommand } = require('./init.js');
const { ensureRequiredServerPassword } = require('./password.js');
const {
  downloadFile,
  checkJavaCompatibility,
  installPortableJava,
  ensureAuthlibInjector,
  acceptEula,
  resolvePaperDownloadUrl,
  resolveVanillaDownloadUrl,
  resolveFabricServerJarUrl,
  resolveNeoForgeInstallerUrl,
  resolveForgeInstallerUrl,
  resolveLatestForgeVersion,
  installModrinthClientPreset
} = require('../services/installer.js');
const { generateStartScripts } = require('../services/runtime.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, yellow, gray } = require('../utils/colors.js');

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

function getDirectoriesToPrepare(serverLoader, clientCfg, updaterEnabled) {
  const dirs = [];
  const lower = String(serverLoader || '').toLowerCase();

  if (isServerModdedLoader(lower)) {
    dirs.push('mods', 'config');
  } else if (lower === 'paper') {
    dirs.push('plugins');
  }
  // Vanilla serveur pur : aucun dossier mods/ ni plugins/ inutile

  if (updaterEnabled !== false) {
    if (clientCfg?.has_mods) {
      dirs.push(
        'client-files/required/mods',
        'client-files/required/config',
        'client-files/optional/mods',
        'client-files/optional/shaderpacks',
        'client-files/optional/resourcepacks'
      );
    } else {
      dirs.push(
        'client-files/optional/shaderpacks',
        'client-files/optional/resourcepacks'
      );
    }
  }

  return dirs;
}

function printConnectionAndShareGuide(config, clientCfg) {
  const port = Number(config.network?.port || 25565);
  const updaterEnabled = config.modpack?.enabled !== false;
  const updaterPort = Number(config.modpack?.updater_port || 3008);
  const publicIp = config.network?.public_ip || 'VOTRE_IP_PUBLIQUE';

  console.log('');
  logger.step('Guide Réseau, Ports & Invitation de vos amis');
  console.log(`  ${bold('1. Ports à ouvrir (Pare-feu Windows/Linux & Box internet NAT) :')}`);
  console.log(`     • ${green(`TCP ${port}`)} ${bold('(Obligatoire)')} : permet aux joueurs extérieurs de se connecter au serveur Minecraft.`);
  if (updaterEnabled) {
    console.log(`     • ${yellow(`TCP ${updaterPort}`)} ${bold('(Files-Updater)')} : à ouvrir si vous distribuez des fichiers dans ${cyan('client-files/')} ou une bannière/icône locale aux joueurs externes.`);
  } else {
    console.log(`     • ${gray(`Aucun autre port requis (Files-Updater désactivé — le serveur reste 100% léger).`)}`);
  }

  if (clientCfg.allow_client_choice) {
    console.log(`  ${bold('2. Profils Client Modey Launcher (Zéro hébergement serveur) :')}`);
    console.log(`     • Vos joueurs peuvent choisir librement dans leur Launcher entre ${cyan(clientCfg.available_presets.join(', '))} (téléchargé directement depuis Modrinth).`);
  }

  console.log(`  ${bold('3. Comment inviter vos amis :')}`);
  console.log(`     • En local sur ce PC / LAN : adresse ${cyan(`127.0.0.1:${port}`)} ou votre IP locale.`);
  console.log(`     • Pour des amis externes : donnez-leur ${cyan(`${publicIp}:${port}`)}.`);
  console.log(`     • Dans ${bold('Modey Launcher → Serveurs → Ajouter un serveur')} : ils saisissent votre IP/domaine et cliquent sur ${green('Jouer')}.`);
  console.log(`     • Grâce à ${cyan('Modey SSO (authlib-injector)')}, leurs comptes Modey sont authentifiés automatiquement !`);
  console.log('');
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
  } else {
    await ensureRequiredServerPassword(config, {
      serverDir: process.cwd(),
      interactive: Boolean(stdin.isTTY && stdout.isTTY && !args.nonInteractive),
      password: typeof args.password === 'string' ? args.password : ''
    });
  }

  const { minecraft_version, loader, loader_version } = config.identity;
  const clientCfg = resolveEffectiveClientConfig(config);
  const updaterEnabled = config.modpack?.enabled !== false;

  logger.step(`Étape 2 · Installation du serveur [${loader.toUpperCase()} ${loader_version || ''} · MC ${minecraft_version}]`);

  // 0. Vérification Java compatible avec la version Minecraft
  let javaCheck = checkJavaCompatibility(minecraft_version, process.cwd());
  if (!javaCheck.ok) {
    logger.warn(yellow(`⚠ ${javaCheck.reason}`));
    if (stdin.isTTY && !args.nonInteractive) {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      const installJavaAns = await rl.question(
        `Voulez-vous installer automatiquement Java ${javaCheck.requiredMajor} portable dans .java/jre-${javaCheck.requiredMajor} ? [O/n]: `
      );
      rl.close();
      if (!installJavaAns.trim() || /^(o|oui|y|yes)$/i.test(installJavaAns.trim())) {
        logger.info(`Téléchargement d'Eclipse Temurin JRE ${javaCheck.requiredMajor}...`);
        const installedJava = await installPortableJava(javaCheck.requiredMajor, process.cwd());
        logger.success(`Java ${installedJava.major} portable prêt dans ${cyan(installedJava.relativePath)} !`);
        javaCheck = checkJavaCompatibility(minecraft_version, process.cwd());
      }
    }
  } else if (javaCheck.installedMajor) {
    logger.info(`Java détecté : v${javaCheck.installedMajor} (compatible avec MC ${minecraft_version}).`);
  }

  // 1. Préparation stricte des dossiers selon le type serveur & client (pas de mods/ si Vanilla/Paper sans mods)
  const dirsToCreate = getDirectoriesToPrepare(loader, clientCfg, updaterEnabled);
  for (const rel of dirsToCreate) {
    await fs.mkdir(path.resolve(process.cwd(), rel), { recursive: true });
  }
  logger.info(
    dirsToCreate.length > 0
      ? `Dossiers préparés : ${gray(dirsToCreate.join(', '))}`
      : 'Aucun dossier mods/ ou plugins/ créé (mode Vanilla pur).'
  );

  // 2. Acceptation du contrat EULA, server.properties et Modey Yggdrasil SSO (authlib-injector)
  await acceptEula();
  logger.success('Contrat eula.txt accepté (eula=true).');

  if (config.auth?.yggdrasil_enabled !== false) {
    try {
      const authRes = await ensureAuthlibInjector(process.cwd());
      logger.success(authRes.downloaded
        ? 'Agent Modey Yggdrasil SSO (authlib-injector.jar) installé.'
        : 'Agent Modey Yggdrasil SSO (authlib-injector.jar) prêt.');
    } catch (authErr) {
      logger.warn(`Impossible de télécharger authlib-injector.jar (${authErr.message}).`);
    }
  }

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
  const javaBin = javaCheck.command || 'java';

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
    const neoUrl = resolveNeoForgeInstallerUrl(loader_version, minecraft_version);
    await downloadFile(neoUrl, installerPath);
    logger.success(`Installeur NeoForge téléchargé (${installerFile}).`);
    logger.info('Installation des bibliothèques NeoForge en cours (--install-server)...');
    try {
      await runProcess(javaBin, ['-jar', installerFile, '--install-server'], process.cwd());
      logger.success('Serveur NeoForge installé avec succès.');
    } catch (err) {
      logger.warn(`Installation automatique NeoForge interrompue (${err.message}).`);
      logger.info(`Vérifiez que Java ${javaCheck.requiredMajor}+ est installé puis lancez : ${bold(`"${javaBin}" -jar ${installerFile} --install-server`)}`);
    }
  } else if (loader === 'forge') {
    const forgeVer = loader_version || await resolveLatestForgeVersion(minecraft_version);
    if (!forgeVer) {
      throw new Error(`Impossible de résoudre une version Forge pour Minecraft ${minecraft_version}.`);
    }
    const installerFile = 'forge-installer.jar';
    const installerPath = path.resolve(process.cwd(), installerFile);
    const forgeUrl = resolveForgeInstallerUrl(minecraft_version, forgeVer);
    logger.info(`Téléchargement de l'installeur Forge ${minecraft_version}-${forgeVer}...`);
    await downloadFile(forgeUrl, installerPath);
    logger.success(`Installeur Forge téléchargé (${installerFile}).`);
    logger.info('Installation des bibliothèques Forge en cours (--installServer)...');
    try {
      await runProcess(javaBin, ['-jar', installerFile, '--installServer'], process.cwd());
      logger.success('Serveur Forge installé avec succès.');
    } catch (err) {
      logger.warn(`Installation automatique Forge interrompue (${err.message}).`);
      logger.info(`Vérifiez que Java ${javaCheck.requiredMajor} est installé puis lancez : ${bold(`"${javaBin}" -jar ${installerFile} --installServer`)}`);
    }
  } else {
    logger.info(`Loader personnalisé (${loader}) : placez votre exécutable sous ${bold(cyan(targetJar))}.`);
  }

  // 4. Installation éventuelle d'un preset client Modrinth hébergé dans client-files/
  const pendingPreset = config.client?.pending_preset_install;
  if (pendingPreset && updaterEnabled) {
    const slot = config.client?.preset_slot === 'required' ? 'required' : 'optional';
    logger.info(`Téléchargement du preset client [${cyan(pendingPreset)}] depuis Modrinth dans ${gray(`client-files/${slot}/mods`)}...`);
    const presetRes = await installModrinthClientPreset({
      serverDir: process.cwd(),
      mcVersion: minecraft_version,
      loader: clientCfg.loader,
      presetId: pendingPreset,
      targetSlot: slot
    });
    if (presetRes.installed.length > 0) {
      logger.success(`Mods client installés (${presetRes.installed.length}) : ${presetRes.installed.map((m) => m.filename).join(', ')}`);
    }
    if (presetRes.skipped.length > 0) {
      logger.warn(`Certains mods du preset n'étaient pas disponibles pour ${clientCfg.loader} ${minecraft_version} : ${presetRes.skipped.map((s) => s.slug).join(', ')}`);
    }
    delete config.client.pending_preset_install;
    await saveConfig(config);
  }

  // 5. Génération des scripts start.bat / start.sh sans Docker (et suppression run.bat/run.sh)
  logger.step('Étape 3 · Finalisation & scripts de démarrage');
  const scripts = await generateStartScripts(process.cwd());
  if (scripts.length > 0) {
    logger.info(`Scripts générés : ${bold(cyan(scripts.join(', ')))}`);
  }

  printConnectionAndShareGuide(config, clientCfg);

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

module.exports = { installCommand, getDirectoriesToPrepare };
