/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { loadConfig } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, red, yellow, gray } = require('../utils/colors.js');

async function statusCommand(args = {}) {
  logger.banner();
  const config = await loadConfig();
  const slug = args.slug || config?.identity?.slug;
  const apiUrl = args.apiUrl || config?.auth?.api_url || 'https://auth.modey.fr';

  if (!slug) {
    throw new Error('Identifiant serveur introuvable. Spécifiez --slug <nom> ou exécutez la commande dans un dossier avec modey-server.json.');
  }

  logger.step(`Consultation du Statut Réseau pour [${bold(cyan(slug))}]`);
  const client = new ModeyApiClient(apiUrl);
  const data = await client.getStatus(slug);

  if (!data.success) {
    logger.error('Erreur :', data.error || 'Serveur introuvable.');
    return;
  }

  const { server, heartbeat } = data;
  console.log(`  Nom affiché     : ${bold(server.name)} (${server.slug})`);
  console.log(`  Statut Central  : ${server.isOnline ? green('● EN LIGNE') : red('○ HORS LIGNE')}`);
  console.log(`  Version MC      : ${server.minecraftVersion || 'Inconnue'} (${server.loader || 'Vanilla'} ${server.loaderVersion || ''})`);
  
  // Badges
  const badges = [];
  if (server.isOfficial) badges.push(yellow('🏆 Officiel Modey'));
  if (server.isVerified) badges.push(cyan('🛡️ Partenaire Vérifié'));
  if (server.enforceHashIntegrity) badges.push(green('🔒 Protégé (Launch Guard)'));
  if (badges.length > 0) {
    console.log(`  Certifications  : ${badges.join('  ')}`);
  }

  if (heartbeat) {
    console.log(gray('  ─'.repeat(25)));
    console.log(`  Joueurs en ligne: ${bold(heartbeat.players_online)} / ${heartbeat.players_max}`);
    console.log(`  TPS             : ${heartbeat.tps >= 19 ? green(heartbeat.tps) : yellow(heartbeat.tps)}`);
    console.log(`  RAM Utilisée    : ${heartbeat.ram_used_mb} Mo / ${heartbeat.ram_total_mb} Mo`);
    console.log(`  Dernier battement: ${new Date(heartbeat.last_heartbeat).toLocaleString()} ${server.isOnline ? green('(Actif)') : yellow('(Expiré)')}`);
  } else {
    console.log(gray('\n  Aucun battement de cœur (heartbeat) n\'a encore été reçu pour ce nœud.'));
  }
  console.log('');
}

module.exports = { statusCommand };
