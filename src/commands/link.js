/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { loadConfig, saveConfig, DEFAULT_AUTH_URL } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, yellow } = require('../utils/colors.js');

async function linkCommand(args = {}) {
  logger.banner();
  const token = String(args.token || '').trim();
  if (!token) {
    throw new Error('Jeton requis. Utilisation : modey-server link <node_token>');
  }

  const config = await loadConfig();
  if (!config) {
    throw new Error('Aucun fichier modey-server.json trouvé. Exécutez d\'abord : modey-server install');
  }

  const apiUrl = args.apiUrl || config.auth?.api_url || DEFAULT_AUTH_URL;
  const updaterPort = Number(config.modpack?.updater_port || 3008);
  const publicIp = config.network?.public_ip || '';
  const updaterUrl = config.modpack?.public_updater_url
    || (publicIp ? `http://${publicIp}:${updaterPort}/api/files-updater` : '');

  logger.step('Confirmation de liaison avec la plateforme Modey');
  logger.info(`API cible : ${apiUrl}`);

  const client = new ModeyApiClient(apiUrl, token);
  const res = await client.linkNode(token, {
    slug: config.identity?.slug,
    name: config.identity?.name,
    mcVersion: config.identity?.minecraft_version,
    loader: config.identity?.loader,
    loaderVersion: config.identity?.loader_version,
    port: config.network?.port || 25565,
    publicIp,
    updaterUrl
  });

  if (res.server?.slug && res.server.slug !== config.identity?.slug) {
    logger.info(`Slug aligné sur la fiche Auth : ${bold(cyan(res.server.slug))}`);
    config.id = res.server.slug;
    config.slug = res.server.slug;
    if (config.identity) config.identity.slug = res.server.slug;
  }

  config.auth = {
    ...(config.auth || {}),
    standalone: false,
    linked: true,
    api_url: apiUrl,
    node_token: token
  };

  await saveConfig(config);
  logger.success(`Serveur "${bold(res.server?.name || config.identity?.slug)}" lié et confirmé !`);
  logger.info(`Visibilité Launcher actuelle : ${yellow(res.server?.visibility || 'PUBLIC')} (gérée par l'équipe Modey).`);
  logger.info(`Démarrez le serveur (${bold('start.bat')} / ${bold('modey-server run')}) pour apparaître en ligne.`);
}

module.exports = { linkCommand };
