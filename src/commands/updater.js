/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, resolveEffectiveClientConfig } = require('../config.js');
const { startUpdaterServer } = require('../services/updaterServer.js');
const { ensureRequiredServerPassword } = require('./password.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, yellow } = require('../utils/colors.js');

async function updaterCommand(args = {}) {
  logger.banner();
  const config = await loadConfig();
  if (config) {
    await ensureRequiredServerPassword(config, {
      serverDir: process.cwd(),
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    });
  }
  const slug = args.slug || config?.identity?.slug || config?.slug || 'server';
  const port = Number(args.port || config?.modpack?.updater_port || 3008);
  const publicUrl = args.publicUrl || config?.modpack?.public_updater_url || '';
  const clientCfg = resolveEffectiveClientConfig(config || {});

  const clientDir = path.resolve(process.cwd(), 'client-files');
  if (!fs.existsSync(clientDir)) {
    if (clientCfg.has_mods) {
      fs.mkdirSync(path.join(clientDir, 'required', 'mods'), { recursive: true });
      fs.mkdirSync(path.join(clientDir, 'optional', 'mods'), { recursive: true });
      logger.info(`Dossier ${cyan('client-files/required')} et ${cyan('client-files/optional')} créés automatiquement.`);
    } else {
      fs.mkdirSync(path.join(clientDir, 'optional', 'shaderpacks'), { recursive: true });
      fs.mkdirSync(path.join(clientDir, 'optional', 'resourcepacks'), { recursive: true });
      logger.info(`Dossier ${cyan('client-files/optional')} (shaderpacks/resourcepacks) créé sans dossier mods/ inutile.`);
    }
  }

  const instance = await startUpdaterServer({
    serverDir: process.cwd(),
    port,
    slug,
    publicUrl
  });

  logger.step(`Serveur Files-Updater décentralisé démarré pour [${bold(cyan(slug))}]`);
  logger.info(`Écoute HTTP : ${green(`http://0.0.0.0:${instance.port}/files-updater`)}`);
  if (publicUrl) {
    logger.info(`URL publique configurée : ${bold(publicUrl)}`);
  } else {
    logger.info(yellow('Astuce : définissez modpack.public_updater_url dans modey-server.json avant `modey-server sync`.'));
  }

  const stop = async () => {
    logger.info('Arrêt du serveur Files-Updater...');
    await instance.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { updaterCommand };
