/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const logger = require('../utils/logger.js');
const { bold, cyan, yellow, gray } = require('../utils/colors.js');

function helpCommand() {
  logger.banner();
  console.log(`${bold('UTILISATION :')}
  modey-server <commande> [options]

${bold('COMMANDES DISPONIBLES :')}
  ${cyan('init')}      Lance l'assistant interactif pour configurer modey-server.json
  ${cyan('install')}   Télécharge le loader (Paper, Fabric, NeoForge) et accepte l'EULA
  ${cyan('sync')}      Synchronise le manifeste local avec l'Admin Panel et l'API centrale
  ${cyan('run')}       Lance le serveur Minecraft avec la télémétrie Heartbeat en arrière-plan
  ${cyan('status')}    Affiche le statut en direct de votre nœud vu par le réseau Modey
  ${cyan('help')}      Affiche ce message d'aide

${bold('OPTIONS GLOBALES & PAR COMMANDE :')}
  ${yellow('--help, -h')}             Affiche l'aide
  ${yellow('--version, -v')}          Affiche la version du CLI
  ${yellow('--slug <slug>')}          Identifiant unique du serveur
  ${yellow('--api-url <url>')}        URL de l'API centrale Modey (défaut: https://auth.modey.fr)
  ${yellow('--token <jeton>')}        Jeton de sécurité du nœud (node_token)
  ${yellow('--daemon-only')}          (Avec run) Exécute uniquement l'émetteur de télémétrie sans lancer Java
  ${yellow('--non-interactive')}      (Avec init) Génère la configuration sans poser de questions

${bold('EXEMPLES :')}
  ${gray('# 1. Initialiser un nouveau serveur')}
  modey-server init

  ${gray('# 2. Installer les fichiers du loader')}
  modey-server install

  ${gray('# 3. Démarrer le serveur et la télémétrie')}
  modey-server run

  ${gray('# 4. Si le serveur tourne déjà sous systemd ou Pterodactyl')}
  modey-server run --daemon-only
`);
}

module.exports = { helpCommand };
