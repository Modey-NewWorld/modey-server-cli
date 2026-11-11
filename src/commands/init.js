/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const path = require('path');
const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { loadConfig, saveConfig, createDefaultConfig, DEFAULT_AUTH_URL } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const { generateStartScripts } = require('../services/runtime.js');
const { resolveLatestNeoForgeVersion, resolveLatestFabricVersion } = require('../services/installer.js');
const logger = require('../utils/logger.js');
const { bold, cyan, yellow, gray } = require('../utils/colors.js');

const LOADER_CHOICES = {
  '1': 'neoforge',
  neoforge: 'neoforge',
  '2': 'fabric',
  fabric: 'fabric',
  '3': 'paper',
  paper: 'paper',
  papermc: 'paper',
  '4': 'vanilla',
  vanilla: 'vanilla',
  forge: 'forge'
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

async function initCommand(args = {}) {
  if (!args.skipBanner) {
    logger.banner();
  }
  const existing = await loadConfig();

  if (existing && !args.force && !args.nonInteractive) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const overwrite = await ask(rl, yellow('Un fichier modey-server.json existe déjà. Écraser ? [o/N]'), 'n');
    rl.close();
    if (overwrite.toLowerCase() !== 'o' && overwrite.toLowerCase() !== 'y') {
      logger.info('Configuration existante conservée.');
      return existing;
    }
  }

  let configData = {};

  if (args.nonInteractive) {
    const loader = normalizeLoaderChoice(args.loader, 'neoforge');
    configData = {
      name: args.name || 'Serveur Modey',
      slug: args.slug || 'modey-server',
      minecraftVersion: args.mcVersion || '1.21.1',
      loader,
      loaderVersion: args.loaderVersion || (loader === 'neoforge' ? '21.1.265' : loader === 'fabric' ? '0.16.9' : ''),
      port: Number(args.port) || 25565,
      publicIp: args.publicIp || '',
      apiUrl: args.apiUrl || DEFAULT_AUTH_URL,
      nodeToken: args.nodeToken || '',
      standalone: Boolean(args.standalone),
      javaArgs: args.ram ? normalizeRamJavaArgs(args.ram) : null
    };
  } else {
    logger.step('Étape 1 · Configuration du serveur Modey');
    const rl = readline.createInterface({ input: stdin, output: stdout });

    try {
      const folderDefaultName = path.basename(process.cwd()) || 'Mon Serveur Modey';
      const name = await ask(rl, 'Nom du serveur', existing?.identity?.name || folderDefaultName);
      const defaultSlug = existing?.identity?.slug || slugifyName(name);
      const slug = slugifyName(await ask(rl, 'Identifiant unique (slug)', defaultSlug));
      const mcVersion = await ask(rl, 'Version Minecraft', existing?.identity?.minecraft_version || '1.21.1');

      console.log('');
      console.log(`  ${bold('Type de serveur à installer :')}`);
      console.log(`    ${cyan('1)')} NeoForge  ${gray('(serveur moddé — le plus courant)')}`);
      console.log(`    ${cyan('2)')} Fabric    ${gray('(serveur moddé léger)')}`);
      console.log(`    ${cyan('3)')} PaperMC   ${gray('(plugins / performance)')}`);
      console.log(`    ${cyan('4)')} Vanilla   ${gray('(Minecraft officiel Mojang)')}`);

      const loaderInput = await ask(rl, 'Votre choix [1-4 ou nom]', existing?.identity?.loader || '1');
      const loader = normalizeLoaderChoice(loaderInput, 'neoforge');

      let loaderVersion = '';
      if (loader === 'neoforge') {
        logger.info(`Recherche de la version recommandée NeoForge pour ${mcVersion}...`);
        const recommended = existing?.identity?.loader === 'neoforge' && existing?.identity?.loader_version
          ? existing.identity.loader_version
          : await resolveLatestNeoForgeVersion(mcVersion);
        loaderVersion = await ask(rl, 'Version NeoForge', recommended || '21.1.265');
      } else if (loader === 'fabric') {
        const recommended = existing?.identity?.loader === 'fabric' && existing?.identity?.loader_version
          ? existing.identity.loader_version
          : await resolveLatestFabricVersion();
        loaderVersion = await ask(rl, 'Version Fabric Loader', recommended || '0.16.9');
      } else if (loader === 'forge') {
        loaderVersion = await ask(rl, 'Version Forge', existing?.identity?.loader_version || '');
      }

      const port = await ask(rl, 'Port de jeu Minecraft', String(existing?.network?.port || 25565));
      const publicIp = await ask(rl, 'IP publique ou domaine (Entrée pour garder local)', existing?.network?.public_ip || '');
      const ramInput = await ask(rl, 'Mémoire RAM max allouée (ex: 4G, 2G)', '4G');
      const javaArgs = normalizeRamJavaArgs(ramInput);

      console.log('');
      console.log(`  ${bold('Mode réseau :')}`);
      console.log(`    ${cyan('1)')} Privé / Local     ${gray('(autonome sur votre PC, sans API externe)')}`);
      console.log(`    ${cyan('2)')} Réseau Modey      ${gray('(connecté à https://api.modey.flowcrea.fr)')}`);
      const netMode = await ask(rl, 'Mode [1-2]', existing?.auth?.standalone === false ? '2' : '1');
      const standalone = netMode.trim() !== '2' && !/^o(ui)?$/i.test(netMode.trim());

      let apiUrl = '';
      let nodeToken = '';
      if (!standalone) {
        apiUrl = await ask(rl, 'URL de l\'API Modey', existing?.auth?.api_url || DEFAULT_AUTH_URL);
        nodeToken = await ask(rl, 'Token du nœud (optionnel — Entrée si aucun)', existing?.auth?.node_token || '');
      }

      configData = {
        name,
        slug,
        minecraftVersion: mcVersion,
        loader,
        loaderVersion,
        port: Number(port) || 25565,
        publicIp,
        apiUrl,
        nodeToken,
        standalone,
        javaArgs
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
        status: 'offline',
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

  const savedPath = await saveConfig(newConfig);
  const scripts = await generateStartScripts(process.cwd());
  logger.success(`Configuration enregistrée : ${bold(cyan(savedPath))}`);
  if (scripts.length > 0) {
    logger.info(`Scripts créés : ${bold(scripts.join(', '))} (sans Docker).`);
  }
  if (!args.skipNextStepHint) {
    logger.info(`Prochaine étape : lancez ${bold('modey-server install')} pour télécharger le serveur.`);
  }

  return newConfig;
}

module.exports = {
  initCommand,
  normalizeLoaderChoice,
  normalizeRamJavaArgs,
  slugifyName
};
