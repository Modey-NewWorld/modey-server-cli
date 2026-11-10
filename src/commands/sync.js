/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { loadConfig } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const logger = require('../utils/logger.js');
const { bold, cyan } = require('../utils/colors.js');

async function syncCommand() {
  logger.banner();
  const config = await loadConfig();

  if (!config) {
    throw new Error('Aucun fichier modey-server.json trouvé. Exécutez d\'abord: modey-server init');
  }

  const slug = config.identity?.slug;
  const token = config.auth?.node_token;
  const apiUrl = config.auth?.api_url;

  if (!slug) {
    throw new Error('Le champ identity.slug est manquant dans modey-server.json');
  }

  logger.step(`Synchronisation du manifeste [${bold(cyan(slug))}] avec la plateforme centrale`);
  logger.info(`Cible : ${apiUrl}`);

  const client = new ModeyApiClient(apiUrl, token);
  const result = await client.syncMetadata(slug, config);

  if (result.success) {
    logger.success('Manifeste et options Launcher synchronisés avec succès !');
    if (result.node_token && !token) {
      config.auth.node_token = result.node_token;
      const { saveConfig } = require('../config.js');
      await saveConfig(config);
      logger.info('Nouveau jeton node_token généré et sauvegardé dans modey-server.json.');
    }
  } else {
    logger.error('La synchronisation a échoué :', result.error || 'Erreur inconnue');
  }
}

module.exports = { syncCommand };
