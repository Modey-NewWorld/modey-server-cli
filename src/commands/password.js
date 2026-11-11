/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const {
  loadConfig,
  saveConfig,
  hashAccessPassword,
  generatePasswordVersion
} = require('../config.js');
const logger = require('../utils/logger.js');
const { cyan, gray, yellow } = require('../utils/colors.js');

async function promptNewPassword(rl) {
  while (true) {
    const raw = (await rl.question(`  ${cyan('?')} Nouveau mot de passe d'accès ${gray('(min 4 caractères)')} : `)).trim();
    if (raw.length < 4) {
      logger.warn('Le mot de passe doit contenir au moins 4 caractères.');
      continue;
    }
    return raw;
  }
}

async function passwordCommand(options = {}) {
  const config = await loadConfig();
  if (!config) {
    throw new Error('Aucun fichier modey-server.json trouvé dans ce dossier. Lancez d\'abord : modey-server init');
  }

  let newPassword = typeof options.password === 'string' ? options.password.trim() : '';

  if (!newPassword) {
    if (!stdin.isTTY) {
      throw new Error('Utilisez : modey-server password <nouveau_mot_de_passe>');
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      logger.step('Configuration du mot de passe d\'accès serveur');
      console.log(`  ${gray('Les joueurs déjà connectés devront ressaisir ce nouveau mot de passe au prochain lancement.')}`);
      newPassword = await promptNewPassword(rl);
    } finally {
      rl.close();
    }
  }

  if (newPassword.length < 4) {
    throw new Error('Le mot de passe doit contenir au moins 4 caractères.');
  }

  const version = generatePasswordVersion();
  config.auth = config.auth || {};
  config.auth.require_password = true;
  config.auth.private_password_hash = hashAccessPassword(newPassword);
  config.auth.private_password_version = version;

  await saveConfig(config);
  logger.success(`Mot de passe d'accès mis à jour (version ${version}).`);
  console.log(`  ${yellow('!')} Si le serveur est actuellement démarré, redémarrez-le pour appliquer le nouveau mot de passe sur le port 3008.`);
}

module.exports = {
  passwordCommand
};
