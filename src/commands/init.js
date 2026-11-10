/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const { loadConfig, saveConfig, createDefaultConfig, DEFAULT_AUTH_URL } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const logger = require('../utils/logger.js');
const { bold, cyan, yellow, gray } = require('../utils/colors.js');

async function ask(rl, question, defaultValue) {
  const prompt = defaultValue ? `${question} ${gray(`(${defaultValue})`)}: ` : `${question}: `;
  const answer = await rl.question(prompt);
  return answer.trim() || defaultValue;
}

async function initCommand(args = {}) {
  logger.banner();
  const existing = await loadConfig();

  if (existing && !args.force && !args.nonInteractive) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const overwrite = await ask(rl, yellow('Un fichier modey-server.json existe déjà. Écraser ? [o/N]'), 'n');
    rl.close();
    if (overwrite.toLowerCase() !== 'o' && overwrite.toLowerCase() !== 'y') {
      logger.info('Initialisation annulée.');
      return;
    }
  }

  let configData = {};

  if (args.nonInteractive) {
    configData = {
      name: args.name || 'Serveur Modey',
      slug: args.slug || 'modey-server',
      minecraftVersion: args.mcVersion || '1.21.1',
      loader: args.loader || 'neoforge',
      loaderVersion: args.loaderVersion || '21.1.265',
      port: Number(args.port) || 25565,
      publicIp: args.publicIp || '',
      apiUrl: args.apiUrl || DEFAULT_AUTH_URL,
      nodeToken: args.nodeToken || ''
    };
  } else {
    logger.step('Configuration Interactive du Nœud Serveur');
    const rl = readline.createInterface({ input: stdin, output: stdout });

    const name = await ask(rl, 'Nom d\'affichage du serveur', existing?.identity?.name || 'Serveur Modey');
    const slug = await ask(rl, 'Identifiant unique (slug en minuscules)', existing?.identity?.slug || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-'));
    const mcVersion = await ask(rl, 'Version Minecraft', existing?.identity?.minecraft_version || '1.21.1');
    const loader = await ask(rl, 'Type de Loader [neoforge / fabric / paper / forge / vanilla]', existing?.identity?.loader || 'neoforge');
    const loaderVersion = await ask(rl, 'Version du Loader', existing?.identity?.loader_version || (loader === 'neoforge' ? '21.1.265' : ''));
    const port = await ask(rl, 'Port de jeu Minecraft', String(existing?.network?.port || 25565));
    const publicIp = await ask(rl, 'Adresse IP publique / Domaine (optionnel)', existing?.network?.public_ip || '');
    const apiUrl = await ask(rl, 'URL de la plateforme centrale Modey', existing?.auth?.api_url || DEFAULT_AUTH_URL);
    const nodeToken = await ask(rl, 'Token de sécurité du nœud (si déjà généré via l\'Admin Panel)', existing?.auth?.node_token || '');

    rl.close();

    configData = {
      name,
      slug,
      minecraftVersion: mcVersion,
      loader,
      loaderVersion,
      port: Number(port) || 25565,
      publicIp,
      apiUrl,
      nodeToken
    };
  }

  const newConfig = createDefaultConfig(configData);

  // Tentative de premier contact si un nodeToken est fourni
  if (newConfig.auth.nodeToken) {
    logger.info('Validation du jeton auprès de la centrale Modey...');
    try {
      const client = new ModeyApiClient(newConfig.auth.api_url, newConfig.auth.nodeToken);
      await client.sendHeartbeat({
        server_slug: newConfig.identity.slug,
        status: 'offline',
        mc_version: newConfig.identity.minecraft_version,
        loader_type: newConfig.identity.loader,
        loader_version: newConfig.identity.loader_version,
        public_ip: newConfig.network.public_ip,
        public_port: newConfig.network.port
      });
      logger.success('Nœud reconnu avec succès par la plateforme centrale !');
    } catch (err) {
      logger.warn(`Impossible de joindre la centrale avec ce jeton (${err.message}). Vous pourrez synchroniser plus tard via: modey-server sync`);
    }
  }

  const savedPath = await saveConfig(newConfig);
  logger.success(`Manifeste enregistré avec succès : ${bold(cyan(savedPath))}`);
  logger.info(`Prochaine étape : installez le serveur via ${bold('modey-server install')} ou démarrez-le via ${bold('modey-server run')}.`);
}

module.exports = { initCommand };
