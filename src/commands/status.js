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

  if (data.error || !data.slug) {
    logger.error('Erreur :', data.error || 'Serveur introuvable.');
    return;
  }

  const isOnline = String(data.status).toUpperCase() === 'ONLINE' || data.isOnline === true;
  console.log(`  Nom affiché     : ${bold(data.name || data.slug)} (${data.slug})`);
  console.log(`  Statut Central  : ${isOnline ? green('● EN LIGNE') : red('○ HORS LIGNE')}`);
  console.log(`  Version MC      : ${data.mcVersion || data.minecraftVersion || '1.21.1'} (${data.loaderType || data.loader || 'NeoForge'} ${data.loaderVersion || ''})`);
  
  // Badges
  const badges = [];
  if (data.isOfficial) badges.push(yellow('🏆 Officiel Modey'));
  if (data.isVerified) badges.push(cyan('🛡️ Partenaire Vérifié'));
  if (data.enforceHashIntegrity) badges.push(green('🔒 Protégé (Launch Guard)'));
  if (badges.length > 0) {
    console.log(`  Certifications  : ${badges.join('  ')}`);
  }

  console.log(gray('  ─'.repeat(25)));
  console.log(`  Joueurs en ligne: ${bold(data.playersOnline || 0)} / ${data.playersMax || 20}`);
  console.log(`  TPS             : ${(data.tps || 20) >= 19 ? green(data.tps || 20) : yellow(data.tps || 20)}`);
  if (data.ramUsedMb) {
    console.log(`  RAM Utilisée    : ${data.ramUsedMb} Mo / ${data.ramTotalMb || 0} Mo`);
  }
  if (data.lastHeartbeat) {
    console.log(`  Dernier battement: ${new Date(data.lastHeartbeat).toLocaleString()} ${isOnline ? green('(Actif)') : yellow('(Expiré)')}`);
  } else {
    console.log(gray('  Aucun battement de cœur (heartbeat) récent enregistré.'));
  }
  console.log('');
}

module.exports = { statusCommand };
