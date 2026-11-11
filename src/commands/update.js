/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { spawnSync } = require('child_process');
const { loadConfig, DEFAULT_AUTH_URL } = require('../config.js');
const { ensureAuthlibInjector } = require('../services/installer.js');
const { generateStartScripts } = require('../services/runtime.js');
const { ModeyApiClient } = require('../services/api.js');
const logger = require('../utils/logger.js');
const { bold, cyan, yellow } = require('../utils/colors.js');
const pkg = require('../../package.json');

async function updateCommand() {
  logger.banner();
  logger.step(`Mise à jour de Modey Server CLI (actuelle : v${pkg.version})`);

  const config = await loadConfig().catch(() => null);
  const apiUrl = config?.auth?.api_url || DEFAULT_AUTH_URL;
  try {
    const client = new ModeyApiClient(apiUrl, config?.auth?.node_token || '');
    const policy = await client.getCliPolicy(config?.identity?.slug || '');
    if (policy?.latestVersion) {
      logger.info(`Dernière version publiée par Modey : ${bold(cyan('v' + policy.latestVersion))}`);
    }
  } catch {}

  // 1. Vérifier si modey-server est installé globalement et le mettre à jour
  const checkCmd = process.platform === 'win32' ? 'where' : 'which';
  const hasGlobal = spawnSync(checkCmd, ['modey-server'], { stdio: 'ignore' }).status === 0;
  if (hasGlobal) {
    logger.info('Mise à jour de la commande globale modey-server via GitHub...');
    const res = spawnSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '-g', 'git+https://github.com/Modey-NewWorld/modey-server-cli.git'],
      { stdio: 'inherit' }
    );
    if (res.status === 0) {
      logger.success('CLI global mis à jour avec succès !');
    } else {
      logger.warn('Impossible de mettre à jour globalement (droits ou réseau).');
    }
  } else {
    logger.info(
      `Vous utilisez npx : relancez avec ${bold('npx --yes github:Modey-NewWorld/modey-server-cli#main')} pour forcer le téléchargement de la dernière version.`
    );
  }

  // 2. Si on est dans un dossier serveur, rafraîchir authlib-injector.jar et scripts
  if (config) {
    try {
      await ensureAuthlibInjector(process.cwd(), { force: true });
      logger.success('authlib-injector.jar mis à jour.');
    } catch (err) {
      logger.warn(`Impossible de rafraîchir authlib-injector.jar : ${err.message}`);
    }
    const scripts = await generateStartScripts(process.cwd(), { overwrite: true });
    if (scripts.length > 0) {
      logger.info(`Scripts rafraîchis : ${yellow(scripts.join(', '))}`);
    }
  }
}

module.exports = { updateCommand };
