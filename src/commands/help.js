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
  ${cyan('setup')}     Assistant tout-en-un : configure, installe et propose le démarrage
  ${cyan('install')}   Installe le serveur (lance la config si modey-server.json absent)
  ${cyan('init')}      Génère ou met à jour uniquement modey-server.json
  ${cyan('sync')}      Synchronise le manifeste local avec l'API centrale Modey (optionnel)
  ${cyan('run')}       Lance le serveur Minecraft, Files-Updater et la télémétrie
  ${cyan('updater')}   Démarre uniquement le serveur HTTP Files-Updater (dossier client-files/)
  ${cyan('status')}    Affiche le statut en direct de votre nœud vu par le réseau Modey
  ${cyan('help')}      Affiche ce message d'aide

${bold('OPTIONS GLOBALES & PAR COMMANDE :')}
  ${yellow('--help, -h')}             Affiche l'aide
  ${yellow('--version, -v')}          Affiche la version du CLI
  ${yellow('--slug <slug>')}          Identifiant unique du serveur
  ${yellow('--ram <taille>')}         Mémoire max Java (ex: 4G, 6G)
  ${yellow('--api-url <url>')}        URL de l'API centrale Modey (défaut: https://api.modey.flowcrea.fr)
  ${yellow('--token <jeton>')}        Jeton de sécurité du nœud (node_token)
  ${yellow('--standalone')}           Mode privé/local sans connexion API centrale
  ${yellow('--daemon-only')}          (Avec run) Exécute uniquement l'émetteur de télémétrie sans lancer Java
  ${yellow('--non-interactive')}      Génère la configuration sans poser de questions

${bold('EXEMPLES :')}
  ${gray('# Installation guidée complète en 1 commande (dossier vide)')}
  npx github:Modey-NewWorld/modey-server-cli

  ${gray('# Ou directement via install (configure auto si besoin)')}
  modey-server install

  ${gray('# Démarrer le serveur + Files-Updater')}
  modey-server run

  ${gray('# 4. Si le serveur tourne déjà sous systemd ou Pterodactyl')}
  modey-server run --daemon-only
`);
}

module.exports = { helpCommand };
