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
  generatePasswordVersion,
  generateRandomAccessPassword,
  isPasswordRequiredForConfig
} = require('../config.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, gray, yellow } = require('../utils/colors.js');

async function promptNewPassword(rl, { allowAutoGenerate = false } = {}) {
  while (true) {
    const promptLabel = allowAutoGenerate
      ? `  ${cyan('?')} Mot de passe d'accès privé ${gray('(min 4 car., Entrée = générer aléatoirement)')} : `
      : `  ${cyan('?')} Nouveau mot de passe d'accès ${gray('(min 4 caractères)')} : `;
    const raw = (await rl.question(promptLabel)).trim();
    if (!raw && allowAutoGenerate) {
      return { password: generateRandomAccessPassword(), generated: true };
    }
    if (raw.length < 4) {
      logger.warn('Le mot de passe doit contenir au moins 4 caractères.');
      continue;
    }
    return { password: raw, generated: false };
  }
}

/**
 * Vérifie qu'un serveur exigeant un mot de passe possède bien un hash configuré.
 * Sinon, demande à l'administrateur d'en créer un ou en génère un aléatoirement et met à jour modey-server.json.
 */
async function ensureRequiredServerPassword(config, {
  serverDir = process.cwd(),
  interactive = Boolean(stdin.isTTY && stdout.isTTY),
  password = '',
  quiet = false
} = {}) {
  if (!config || !isPasswordRequiredForConfig(config)) {
    return { updated: false, generated: false, password: '', config };
  }

  if (String(config.auth?.private_password_hash || '').trim()) {
    if (config.auth.require_password !== true) {
      config.auth.require_password = true;
      await saveConfig(config, serverDir);
    }
    return {
      updated: false,
      generated: false,
      password: String(config.auth?.private_password || ''),
      config
    };
  }

  let chosenPassword = typeof password === 'string' ? password.trim() : '';
  let generated = false;

  if (chosenPassword) {
    if (chosenPassword.length < 4) {
      throw new Error('Le mot de passe d\'accès privé doit contenir au moins 4 caractères.');
    }
  } else if (interactive) {
    if (!quiet) {
      logger.warn('Ce serveur privé/protégé exige un mot de passe d\'accès mais aucun mot de passe n\'est configuré.');
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const choice = await promptNewPassword(rl, { allowAutoGenerate: true });
      chosenPassword = choice.password;
      generated = choice.generated;
    } finally {
      rl.close();
    }
  } else {
    chosenPassword = generateRandomAccessPassword();
    generated = true;
  }

  const version = generatePasswordVersion();
  config.auth = config.auth || {};
  config.auth.require_password = true;
  config.auth.private_password = chosenPassword;
  config.auth.private_password_hash = hashAccessPassword(chosenPassword);
  config.auth.private_password_version = version;

  await saveConfig(config, serverDir);

  if (!quiet) {
    if (generated) {
      logger.warn(`Mot de passe privé généré automatiquement : ${bold(green(chosenPassword))}`);
      logger.info(`Notez ce mot de passe (modifiez-le plus tard avec : ${cyan('modey-server password')}).`);
    } else {
      logger.success(`Mot de passe privé configuré et enregistré dans modey-server.json (version ${version}).`);
    }
  }

  return { updated: true, generated, password: chosenPassword, version, config };
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
      const res = await promptNewPassword(rl, { allowAutoGenerate: false });
      newPassword = res.password;
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
  config.auth.private_password = newPassword;
  config.auth.private_password_hash = hashAccessPassword(newPassword);
  config.auth.private_password_version = version;

  await saveConfig(config);
  logger.success(`Mot de passe d'accès mis à jour (version ${version}).`);
  console.log(`  ${yellow('!')} Si le serveur est actuellement démarré, redémarrez-le pour appliquer le nouveau mot de passe sur le port 3008.`);
}

module.exports = {
  passwordCommand,
  ensureRequiredServerPassword
};
