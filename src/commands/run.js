/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const { getSystemMemory, pingMinecraftServer } = require('../services/monitor.js');
const { startUpdaterServer } = require('../services/updaterServer.js');
const { resolveJavaLaunchSpec } = require('../services/runtime.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, yellow, red, gray } = require('../utils/colors.js');

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

async function runCommand(args = {}) {
  logger.banner();
  const config = await loadConfig();

  if (!config) {
    throw new Error('Aucun fichier modey-server.json trouvé. Exécutez d\'abord: modey-server init');
  }

  const slug = config.identity?.slug;
  const token = config.auth?.node_token;
  const apiUrl = config.auth?.api_url;
  const port = config.network?.port || 25565;
  const mcVersion = config.identity?.minecraft_version || '1.21.1';
  const loader = config.identity?.loader || 'neoforge';
  const loaderVersion = config.identity?.loader_version || '';
  const publicIp = config.network?.public_ip || '';

  const isStandalone = config.auth?.standalone === true || !apiUrl;
  const client = isStandalone ? null : new ModeyApiClient(apiUrl, token);

  let updaterHandle = null;
  const clientFilesDir = path.resolve(process.cwd(), 'client-files');
  const shouldStartUpdater = config.modpack?.enabled === true ||
    (config.modpack?.enabled !== false && fs.existsSync(clientFilesDir));
  if (shouldStartUpdater) {
    try {
      const updaterPort = Number(config.modpack?.updater_port || 3008);
      updaterHandle = await startUpdaterServer({
        serverDir: process.cwd(),
        port: updaterPort,
        slug,
        publicUrl: config.modpack?.public_updater_url || ''
      });
      logger.info(`Files-Updater actif : ${green(updaterHandle.url)}`);
    } catch (updErr) {
      logger.warn(`Impossible de démarrer Files-Updater local : ${updErr.message}`);
    }
  }

  // Fonction pour envoyer un heartbeat (ignoré proprement en mode autonome)
  const sendTick = async (overrideStatus = null) => {
    if (!client) return;
    try {
      const mem = getSystemMemory();
      let ping = await pingMinecraftServer('127.0.0.1', port, 2500);
      if (!ping.online && publicIp && publicIp !== '127.0.0.1' && publicIp !== 'localhost') {
        ping = await pingMinecraftServer(publicIp, port, 2500);
      }

      const status = overrideStatus || (ping.online ? 'online' : 'starting');

      const heartbeatData = {
        server_slug: slug,
        status,
        players_online: ping.playersOnline,
        players_max: ping.playersMax,
        tps: 20.0,
        ram_used_mb: mem.usedMb,
        ram_total_mb: mem.totalMb,
        ping_ms: ping.latency > 0 ? ping.latency : 0,
        mc_version: mcVersion,
        loader_type: loader,
        loader_version: loaderVersion,
        public_ip: publicIp,
        public_port: port
      };

      const res = await client.sendHeartbeat(heartbeatData);
      if (res.node_token && !config.auth?.node_token) {
        config.auth.node_token = res.node_token;
        const { saveConfig } = require('../config.js');
        await saveConfig(config).catch(() => {});
      }
      logger.info(
        `Heartbeat envoyé [${status === 'online' ? green('ONLINE') : yellow(status.toUpperCase())}] · ` +
        `Joueurs: ${ping.playersOnline}/${ping.playersMax} · RAM: ${mem.usedMb}Mo`
      );
    } catch (err) {
      logger.warn(`Erreur émission Heartbeat : ${err.message}`);
    }
  };

  // Mode Daemon Seul (le serveur tourne déjà via un autre gestionnaire)
  if (args.daemonOnly) {
    logger.step(`Démarrage du Daemon de Télémétrie seul pour [${bold(cyan(slug))}]`);
    logger.info(`Port surveillé : ${port} · Intervalle : 30s`);
    await sendTick();
    const interval = setInterval(sendTick, HEARTBEAT_INTERVAL_MS);

    const cleanup = async () => {
      clearInterval(interval);
      logger.info('Arrêt du daemon...');
      if (updaterHandle) await updaterHandle.close().catch(() => {});
      await sendTick('offline');
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    return;
  }

  // Lancement complet avec le processus Java Minecraft (NeoForge @args ou -jar server.jar)
  const launchSpec = resolveJavaLaunchSpec(process.cwd(), config);

  logger.step(`Démarrage du Serveur Minecraft [${bold(cyan(slug))}]`);
  if (isStandalone) {
    logger.info(gray('Mode autonome (privé / local) : aucune télémétrie envoyée vers une API externe.'));
  }
  logger.info(`Binaire : ${launchSpec.displayCommand}`);

  const serverProc = spawn(launchSpec.command, launchSpec.args, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  serverProc.on('error', async (err) => {
    logger.error(`Impossible de démarrer Java (${err.message}). Vérifiez que Java 21+ est installé dans le PATH.`);
    if (updaterHandle) await updaterHandle.close().catch(() => {});
    process.exit(1);
  });

  logger.success('Processus serveur lancé (PID: ' + (serverProc.pid || 'en cours') + ')');

  // Premier heartbeat 'starting' (si connecté à l'API centrale)
  await sendTick('starting');
  const heartbeatTimer = client ? setInterval(sendTick, HEARTBEAT_INTERVAL_MS) : null;

  const shutdown = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    logger.info('Arrêt du serveur en cours...');
    if (updaterHandle) await updaterHandle.close().catch(() => {});
    await sendTick('offline');
    try {
      serverProc.kill('SIGINT');
    } catch {}
  };

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  serverProc.on('exit', async (code) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    logger.info(`Le serveur Minecraft s'est arrêté avec le code ${code}.`);
    if (updaterHandle) await updaterHandle.close().catch(() => {});
    await sendTick('offline');
    process.exit(code || 0);
  });
}

module.exports = { runCommand };
