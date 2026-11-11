/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  isServerModdedLoader,
  DEFAULT_AUTH_URL
} = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const { generateStartScripts } = require('../services/runtime.js');
const {
  validateMinecraftVersion,
  validateAndResolveLoader,
  checkJavaCompatibility,
  compareMcVersions
} = require('../services/installer.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, yellow, red, gray } = require('../utils/colors.js');

const LOADER_CHOICES = {
  '1': 'neoforge',
  neoforge: 'neoforge',
  '2': 'forge',
  forge: 'forge',
  '3': 'fabric',
  fabric: 'fabric',
  '4': 'paper',
  paper: 'paper',
  papermc: 'paper',
  '5': 'vanilla',
  vanilla: 'vanilla'
};

function normalizeLoaderChoice(input, fallback = 'neoforge') {
  const key = String(input || '').trim().toLowerCase();
  return LOADER_CHOICES[key] || fallback;
}

function normalizeRamJavaArgs(input, fallback = ['-Xms2G', '-Xmx4G']) {
  const raw = String(input || '').trim().toUpperCase();
  if (!raw) return fallback;
  const normalized = /^\d+$/.test(raw) ? `${raw}G` : raw;
  if (!/^\d+[GM]$/.test(normalized)) return fallback;
  return ['-Xms1G', `-Xmx${normalized}`];
}

function slugifyName(name) {
  return String(name || 'serveur-modey')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'serveur-modey';
}

async function ask(rl, question, defaultValue) {
  const prompt = defaultValue ? `${question} ${gray(`(${defaultValue})`)}: ` : `${question}: `;
  const answer = await rl.question(prompt);
  return answer.trim() || defaultValue;
}

function isYes(answer, defaultYes = false) {
  const clean = String(answer || '').trim().toLowerCase();
  if (!clean) return defaultYes;
  return /^(o|oui|y|yes|1)$/i.test(clean);
}

async function promptValidatedServerAndVersion(rl, existing) {
  let mcVersion = existing?.identity?.minecraft_version || '1.21.1';
  let loader = existing?.identity?.loader || 'neoforge';
  let loaderVersion = '';

  while (true) {
    mcVersion = await ask(rl, 'Version Minecraft', mcVersion);
    logger.info(`Vérification de Minecraft ${mcVersion}...`);
    const mcCheck = await validateMinecraftVersion(mcVersion);
    if (!mcCheck.valid) {
      logger.warn(red(`✖ ${mcCheck.reason}`));
      if (mcCheck.latestRelease) mcVersion = mcCheck.latestRelease;
      continue;
    }
    if (mcCheck.warning) {
      logger.warn(mcCheck.warning);
    }

    const javaCheck = checkJavaCompatibility(mcVersion);
    if (!javaCheck.ok) {
      logger.warn(yellow(`⚠ ${javaCheck.reason} (vérifié à l'étape d'installation).`));
    }

    console.log('');
    console.log(`  ${bold('Type de serveur à installer :')}`);
    console.log(`    ${cyan('1)')} NeoForge  ${gray('(serveur moddé moderne — MC 1.20.1+)')}`);
    console.log(`    ${cyan('2)')} Forge     ${gray('(serveur moddé classique — toutes versions : 1.12.2, 1.16.5, 1.20.1...)')}`);
    console.log(`    ${cyan('3)')} Fabric    ${gray('(serveur moddé léger — MC 1.14+)')}`);
    console.log(`    ${cyan('4)')} PaperMC   ${gray('(plugins / haute performance — sans mods serveur)')}`);
    console.log(`    ${cyan('5)')} Vanilla   ${gray('(Minecraft officiel Mojang — sans mod ni plugin)')}`);

    const defaultIdx = loader === 'forge' ? '2' : loader === 'fabric' ? '3' : loader === 'paper' ? '4' : loader === 'vanilla' ? '5' : '1';
    const loaderInput = await ask(rl, 'Votre choix [1-5 ou nom]', defaultIdx);
    loader = normalizeLoaderChoice(loaderInput, 'neoforge');

    logger.info(`Vérification de compatibilité ${loader.toUpperCase()} × Minecraft ${mcVersion}...`);
    const compatCheck = await validateAndResolveLoader(loader, mcVersion, '');
    if (!compatCheck.valid) {
      logger.warn(red(`✖ ${compatCheck.reason}`));
      console.log(gray('  → Corrigez la version Minecraft ou choisissez un moteur compatible.'));
      console.log('');
      continue;
    }

    if (['neoforge', 'forge', 'fabric'].includes(loader)) {
      const existingMatch = existing?.identity?.loader === loader && existing?.identity?.minecraft_version === mcVersion
        ? existing?.identity?.loader_version
        : '';
      const suggested = existingMatch || compatCheck.recommended || compatCheck.loaderVersion;
      const customVer = await ask(rl, `Version ${loader === 'neoforge' ? 'NeoForge' : loader === 'forge' ? 'Forge' : 'Fabric Loader'}`, suggested);
      const exactCheck = await validateAndResolveLoader(loader, mcVersion, customVer);
      if (!exactCheck.valid) {
        logger.warn(red(`✖ ${exactCheck.reason}`));
        console.log(gray('  → Recommençons avec une version existante et valide.'));
        console.log('');
        continue;
      }
      loaderVersion = exactCheck.loaderVersion;
    } else {
      loaderVersion = '';
    }

    logger.success(`Configuration valide : ${bold(`${loader.toUpperCase()} ${loaderVersion}`.trim())} sur Minecraft ${bold(mcVersion)}.`);
    break;
  }

  return { mcVersion, loader, loaderVersion };
}

async function promptClientProfileConfig(rl, { mcVersion, serverLoader, serverLoaderVersion }) {
  if (isServerModdedLoader(serverLoader)) {
    let presetToInstall = null;
    let presetSlot = 'optional';
    if (serverLoader === 'fabric' || serverLoader === 'neoforge' || serverLoader === 'forge') {
      const addShaders = await ask(
        rl,
        'Ajouter automatiquement le support Shaders côté client (optionnel activable en 1 clic dans le Launcher) ? [o/N]',
        'n'
      );
      if (isYes(addShaders, false)) {
        presetToInstall = serverLoader === 'fabric'
          ? 'fabric-shaders'
          : (serverLoader === 'neoforge' ? 'neoforge-shaders' : 'forge-shaders');
        presetSlot = 'optional';
      }
    }
    return {
      client: {
        mode: 'mirror',
        loader: serverLoader,
        loader_version: serverLoaderVersion,
        allow_client_choice: false,
        available_presets: [],
        default_preset: serverLoader,
        preset_slot: presetSlot,
        has_mods: true,
        pending_preset_install: presetToInstall
      },
      updaterEnabled: true
    };
  }

  // Serveur non moddé (PaperMC ou Vanilla)
  console.log('');
  logger.info(gray(`Serveur non moddé (${serverLoader.toUpperCase()}) : aucun dossier mods/ ne sera créé sur le serveur.`));
  console.log(`  ${bold('Comment les joueurs doivent-ils lancer leur jeu depuis Modey Launcher ?')}`);
  console.log(`    ${cyan('1)')} Laisser le joueur choisir  ${gray('(Vanilla pur, Fabric Optimisé, ou Fabric + Shaders Iris via Modrinth)')}`);
  console.log(`    ${cyan('2)')} Vanilla pur uniquement     ${gray('(zéro mod, zéro dossier mods/, uniquement Minecraft officiel)')}`);
  console.log(`    ${cyan('3)')} Shaders/Opti hébergés ici  ${gray('(votre serveur sert client-files/ avec Fabric + Iris + Sodium)')}`);
  console.log(`    ${cyan('4)')} Modpack client manuel      ${gray('(vous choisissez Fabric/Forge/NeoForge pour vos propres mods client-only)')}`);

  const clientChoice = await ask(rl, 'Profil client Launcher [1-4]', '1');

  if (clientChoice === '2' || clientChoice.toLowerCase() === 'vanilla') {
    const enableUpdater = isYes(
      await ask(rl, 'Activer le petit serveur HTTP local (port 3008) pour héberger icône/bannière ou packs optionnels ? [o/N]', 'n'),
      false
    );
    return {
      client: {
        mode: 'vanilla',
        loader: 'vanilla',
        loader_version: '',
        allow_client_choice: false,
        available_presets: [],
        default_preset: 'vanilla',
        preset_slot: 'optional',
        has_mods: false
      },
      updaterEnabled: enableUpdater
    };
  }

  if (clientChoice === '3' || clientChoice.toLowerCase() === 'shaders') {
    const hasFabric = compareMcVersions(mcVersion, '1.14') >= 0;
    const clientLoader = hasFabric ? 'fabric' : 'forge';
    const compat = await validateAndResolveLoader(clientLoader, mcVersion, '');
    const clientLoaderVer = compat.valid ? compat.loaderVersion : '';
    const slotAns = await ask(rl, 'Rendre les Shaders/Opti [1] Optionnels (activables en 1 clic) ou [2] Requis pour tous ? [1-2]', '1');
    const slot = slotAns === '2' ? 'required' : 'optional';

    return {
      client: {
        mode: 'preset',
        loader: clientLoader,
        loader_version: clientLoaderVer,
        allow_client_choice: false,
        available_presets: [hasFabric ? 'fabric-shaders' : 'forge-shaders'],
        default_preset: hasFabric ? 'fabric-shaders' : 'forge-shaders',
        preset_slot: slot,
        has_mods: true,
        pending_preset_install: hasFabric ? 'fabric-shaders' : 'forge-shaders'
      },
      updaterEnabled: true
    };
  }

  if (clientChoice === '4' || clientChoice.toLowerCase() === 'custom') {
    console.log(`    ${cyan('1)')} Fabric   ${cyan('2)')} NeoForge   ${cyan('3)')} Forge`);
    const clIn = await ask(rl, 'Loader client à utiliser [1-3]', '1');
    const clLoader = clIn === '2' || clIn.toLowerCase() === 'neoforge'
      ? 'neoforge'
      : clIn === '3' || clIn.toLowerCase() === 'forge'
        ? 'forge'
        : 'fabric';
    const compat = await validateAndResolveLoader(clLoader, mcVersion, '');
    const clVer = compat.valid ? await ask(rl, `Version ${clLoader} client`, compat.loaderVersion) : '';
    return {
      client: {
        mode: 'custom',
        loader: clLoader,
        loader_version: clVer,
        allow_client_choice: false,
        available_presets: [],
        default_preset: clLoader,
        preset_slot: 'required',
        has_mods: true
      },
      updaterEnabled: true
    };
  }

  // Option 1 (Recommandée) : Libre choix du joueur dans Modey Launcher (zéro hébergement côté serveur / zéro port supplémentaire requis si pas de client-files)
  const fabricCompat = await validateAndResolveLoader('fabric', mcVersion, '').catch(() => ({ valid: false }));
  const availablePresets = fabricCompat.valid
    ? ['vanilla', 'fabric-opti', 'fabric-shaders']
    : ['vanilla'];
  if (!fabricCompat.valid) {
    logger.info(gray(`Note : Fabric n'est pas disponible sur MC ${mcVersion}, seul Vanilla pur sera proposé côté client.`));
  }
  const wantUpdater = isYes(
    await ask(rl, 'Activer le serveur HTTP Files-Updater (port 3008) pour héberger icône/bannière ou packs locaux ? [o/N]', 'n'),
    false
  );

  return {
    client: {
      mode: 'choice',
      loader: 'vanilla',
      loader_version: '',
      allow_client_choice: availablePresets.length > 1,
      available_presets: availablePresets,
      default_preset: 'vanilla',
      preset_slot: 'optional',
      has_mods: false
    },
    updaterEnabled: wantUpdater
  };
}

async function initCommand(args = {}) {
  if (!args.skipBanner) {
    logger.banner();
  }
  const existing = await loadConfig();

  if (existing && !args.force && !args.nonInteractive) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const overwrite = await ask(rl, yellow('Un fichier modey-server.json existe déjà. Écraser ? [o/N]'), 'n');
    rl.close();
    if (!isYes(overwrite, false)) {
      logger.info('Configuration existante conservée.');
      return existing;
    }
  }

  let configData = {};

  if (args.nonInteractive) {
    const loader = normalizeLoaderChoice(args.loader, 'neoforge');
    const mcVersion = args.mcVersion || '1.21.1';
    let loaderVersion = args.loaderVersion || (loader === 'neoforge' ? '21.1.265' : loader === 'fabric' ? '0.16.9' : '');
    if (!args.skipRemoteValidation) {
      const check = await validateAndResolveLoader(loader, mcVersion, args.loaderVersion || '');
      if (!check.valid) {
        throw new Error(check.reason);
      }
      loaderVersion = check.loaderVersion || loaderVersion;
    }
    configData = {
      name: args.name || 'Serveur Modey',
      slug: args.slug || 'modey-server',
      minecraftVersion: mcVersion,
      loader,
      loaderVersion,
      port: Number(args.port) || 25565,
      publicIp: args.publicIp || '',
      apiUrl: args.apiUrl || DEFAULT_AUTH_URL,
      nodeToken: args.nodeToken || '',
      standalone: Boolean(args.standalone),
      javaArgs: args.ram ? normalizeRamJavaArgs(args.ram) : null,
      updaterEnabled: args.updaterEnabled,
      client: args.client || null
    };
  } else {
    logger.step('Étape 1 · Configuration du serveur Modey');
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
      const folderDefaultName = path.basename(process.cwd()) || 'Mon Serveur Modey';
      const name = await ask(rl, 'Nom du serveur', existing?.identity?.name || folderDefaultName);
      const defaultSlug = existing?.identity?.slug || slugifyName(name);
      const slug = slugifyName(await ask(rl, 'Identifiant unique (slug)', defaultSlug));

      const { mcVersion, loader, loaderVersion } = await promptValidatedServerAndVersion(rl, existing);
      const { client: clientConfig, updaterEnabled } = await promptClientProfileConfig(rl, {
        mcVersion,
        serverLoader: loader,
        serverLoaderVersion: loaderVersion
      });

      const port = await ask(rl, 'Port de jeu Minecraft', String(existing?.network?.port || 25565));
      const publicIp = await ask(rl, 'IP publique ou domaine (Entrée pour garder local)', existing?.network?.public_ip || '');
      const ramInput = await ask(rl, 'Mémoire RAM max allouée (ex: 4G, 2G)', '4G');
      const javaArgs = normalizeRamJavaArgs(ramInput);

      configData = {
        name,
        slug,
        minecraftVersion: mcVersion,
        loader,
        loaderVersion,
        port: Number(port) || 25565,
        publicIp,
        apiUrl: existing?.auth?.api_url || DEFAULT_AUTH_URL,
        nodeToken: existing?.auth?.node_token || '',
        linked: Boolean(existing?.auth?.linked || existing?.auth?.node_token),
        standalone: false,
        javaArgs,
        updaterEnabled,
        client: clientConfig
      };
    } finally {
      rl.close();
    }
  }

  const newConfig = createDefaultConfig(configData);

  if (!newConfig.auth.standalone && newConfig.auth.node_token && newConfig.auth.api_url) {
    logger.info('Validation du jeton auprès de l\'API Modey...');
    try {
      const client = new ModeyApiClient(newConfig.auth.api_url, newConfig.auth.node_token);
      await client.sendHeartbeat({
        server_slug: newConfig.identity.slug,
        status: 'OFFLINE',
        mc_version: newConfig.identity.minecraft_version,
        loader_type: newConfig.identity.loader,
        loader_version: newConfig.identity.loader_version,
        public_ip: newConfig.network.public_ip,
        public_port: newConfig.network.port
      });
      logger.success('Nœud reconnu avec succès par l\'API Modey !');
    } catch (err) {
      logger.warn(`Impossible de joindre l'API avec ce jeton (${err.message}). Synchronisez plus tard via: modey-server sync`);
    }
  }

  await saveConfig(newConfig);
  logger.success('Configuration écrite dans modey-server.json.');

  const scripts = await generateStartScripts(process.cwd());
  if (scripts.length > 0) {
    logger.info(`Scripts générés : ${bold(cyan(scripts.join(', ')))}`);
  }
  return newConfig;
}

module.exports = {
  initCommand,
  normalizeLoaderChoice,
  normalizeRamJavaArgs,
  slugifyName
};
