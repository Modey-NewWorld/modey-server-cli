/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig, saveConfig, DEFAULT_AUTH_URL } = require('../config.js');
const { ModeyApiClient } = require('../services/api.js');
const { getSystemMemory, pingMinecraftServer } = require('../services/monitor.js');
const { startUpdaterServer, resolveLocalVisualUrls } = require('../services/updaterServer.js');
const { resolveJavaLaunchSpec } = require('../services/runtime.js');
const { ensureAuthlibInjector } = require('../services/installer.js');
const { ensureRequiredServerPassword } = require('./password.js');
const { ServerTui } = require('../services/tui.js');
const logger = require('../utils/logger.js');
const { bold, cyan, green, yellow, red, gray } = require('../utils/colors.js');
const pkg = require('../../package.json');

const HEARTBEAT_INTERVAL_MS = 30 * 1000;

function pipeLines(stream, onLine) {
  if (!stream) return;
  let buffer = '';
  stream.setEncoding('utf-8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) onLine(buffer);
  });
}

async function runCommand(args = {}) {
  const useTui = Boolean(process.stdout.isTTY && process.stdin.isTTY && !args.raw && !args.daemonOnly);
  if (!useTui) logger.banner();

  const config = await loadConfig();
  if (!config) {
    throw new Error('Aucun fichier modey-server.json trouvé. Exécutez d\'abord : modey-server install');
  }

  const pwdEnsure = await ensureRequiredServerPassword(config, {
    serverDir: process.cwd(),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.daemonOnly)
  });

  const slug = config.identity?.slug;
  const serverName = config.identity?.name || slug;
  const token = config.auth?.node_token || '';
  const apiUrl = config.auth?.standalone === true ? '' : (config.auth?.api_url || DEFAULT_AUTH_URL);
  const port = config.network?.port || 25565;
  const mcVersion = config.identity?.minecraft_version || '1.21.1';
  const loader = config.identity?.loader || 'neoforge';
  const loaderVersion = config.identity?.loader_version || '';
  const publicIp = config.network?.public_ip || '';

  const client = apiUrl ? new ModeyApiClient(apiUrl, token) : null;

  // Vérification préalable de la politique CLI Modey (blocage / mise à jour obligatoire)
  if (client) {
    try {
      const policy = await client.getCliPolicy(slug);
      if (policy?.blocked) {
        logger.error(red(`Lancement refusé par Modey : ${policy.blockReason || 'Serveur bloqué.'}`));
        if (policy.updateRequired && policy.updateCommand) {
          logger.info(`Mettez à jour avec : ${bold(cyan(policy.updateCommand))}`);
        }
        process.exit(1);
      }
      if (policy?.updateRequired) {
        logger.warn(yellow(`Mise à jour CLI obligatoire recommandée : v${pkg.version} -> v${policy.minVersion}`));
        logger.info(`Commande : ${bold(cyan(policy.updateCommand || 'modey-server update'))}`);
      }
    } catch {
      // Hors ligne : ne pas bloquer le démarrage local
    }
  }

  // Téléchargement garanti de authlib-injector.jar avant le lancement Java
  if (config.auth?.yggdrasil_enabled !== false) {
    try {
      const authRes = await ensureAuthlibInjector(process.cwd());
      if (authRes.downloaded && !useTui) {
        logger.success('Agent Modey Yggdrasil SSO (authlib-injector.jar) installé.');
      }
    } catch (err) {
      logger.error(red(`Impossible de télécharger authlib-injector.jar : ${err.message}`));
      logger.warn(yellow('Sans authlib-injector.jar, les joueurs Launcher Modey peuvent recevoir "Failed to verify username!".'));
    }
  }

  // Files-Updater HTTP local
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
      if (!useTui) logger.info(`Files-Updater actif : ${green(updaterHandle.url)}`);
    } catch (updErr) {
      logger.warn(`Impossible de démarrer Files-Updater local : ${updErr.message}`);
    }
  }

  // Préparation du TUI personnalisé façon Claude Code si terminal interactif
  let tui = null;
  let serverProc = null;
  let isShuttingDown = false;
  let heartbeatTimer = null;

  const launchSpec = args.daemonOnly ? null : resolveJavaLaunchSpec(process.cwd(), config);
  let didSyncMetadata = false;

  const sendTick = async (overrideStatus = null) => {
    try {
      const mem = getSystemMemory();
      let ping = await pingMinecraftServer('127.0.0.1', port, 2500);
      if (!ping.online && publicIp && publicIp !== '127.0.0.1' && publicIp !== 'localhost') {
        ping = await pingMinecraftServer(publicIp, port, 2500);
      }

      const status = overrideStatus ? String(overrideStatus).toUpperCase() : (ping.online ? 'ONLINE' : 'STARTING');
      const isOnlineNow = status === 'ONLINE';

      if (tui) {
        tui.updateState({
          status: isOnlineNow ? 'online' : 'starting',
          playersOnline: ping.playersOnline || 0,
          playersMax: ping.playersMax || 20,
          ramUsedMb: mem.usedMb || 0
        });
      }

      if (!client) return;

      const heartbeatData = {
        server_slug: slug,
        name: serverName,
        status,
        playersOnline: ping.playersOnline,
        players_online: ping.playersOnline,
        playersMax: ping.playersMax,
        players_max: ping.playersMax,
        tps: 20.0,
        ramUsedMb: mem.usedMb,
        ram_used_mb: mem.usedMb,
        ramTotalMb: mem.totalMb,
        ram_total_mb: mem.totalMb,
        pingMs: ping.latency > 0 ? ping.latency : 0,
        ping_ms: ping.latency > 0 ? ping.latency : 0,
        mcVersion,
        mc_version: mcVersion,
        loaderType: loader,
        loader_type: loader,
        loaderVersion,
        loader_version: loaderVersion,
        publicIp,
        public_ip: publicIp,
        publicPort: port,
        public_port: port,
        updaterUrl: updaterHandle?.url || config.modpack?.public_updater_url || ''
      };

      const res = await client.sendHeartbeat(heartbeatData);
      const returnedToken = res.node_token || res.token;
      if (returnedToken && !config.auth?.node_token) {
        config.auth = { ...(config.auth || {}), node_token: returnedToken, linked: false };
        client.nodeToken = returnedToken;
        await saveConfig(config).catch(() => {});
      }

      // Synchronisation automatique unique des métadonnées (nom, description, tags, visuels) au démarrage
      if (!didSyncMetadata && overrideStatus !== 'offline') {
        didSyncMetadata = true;
        const effectiveUpdaterUrl = updaterHandle?.url || config.modpack?.public_updater_url || '';
        const visualUrls = resolveLocalVisualUrls(process.cwd(), effectiveUpdaterUrl, config);
        const manifestToSync = {
          ...config,
          visuals: {
            ...(config.visuals || {}),
            ...(visualUrls.bannerUrl ? { banner_url: visualUrls.bannerUrl } : {}),
            ...(visualUrls.iconUrl ? { icon_url: visualUrls.iconUrl } : {})
          },
          modpack: {
            ...(config.modpack || {}),
            ...(effectiveUpdaterUrl ? { public_updater_url: effectiveUpdaterUrl } : {})
          }
        };
        await client.syncMetadata(slug, manifestToSync).catch(() => {
          didSyncMetadata = false;
        });
      }

      if (tui) {
        tui.updateState({
          status: isOnlineNow ? 'online' : 'starting',
          playersOnline: ping.playersOnline || 0,
          playersMax: ping.playersMax || 20,
          ramUsedMb: mem.usedMb || 0,
          authStatus: config.auth?.linked ? green('✓ Lié Auth') : green('✓ Enregistré (Tiers)')
        });
      } else {
        logger.info(
          `Heartbeat envoyé [${isOnlineNow ? green('ONLINE') : yellow(status)}] · ` +
          `Joueurs: ${ping.playersOnline}/${ping.playersMax} · RAM: ${mem.usedMb}Mo`
        );
      }

      if (res.cliPolicy?.updateRequired && !res.cliPolicy?.blocked) {
        logger.warn(yellow(`Mise à jour CLI requise : v${pkg.version} -> v${res.cliPolicy.minVersion} (${res.cliPolicy.updateCommand || 'modey-server update'})`));
      }
    } catch (err) {
      if (err.blocked || err.status === 403) {
        if (tui) tui.updateState({ status: 'blocked', authStatus: red('⛔ Bloqué') });
        logger.error(red(`Arrêt forcé par Modey : ${err.message}`));
        await shutdown();
        process.exit(1);
      }
      if (tui) {
        tui.updateState({ authStatus: yellow('○ Hors ligne / local') });
      } else {
        logger.warn(`Erreur émission Heartbeat : ${err.message}`);
      }
    }
  };

  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    logger.info('Arrêt du serveur en cours...');
    if (serverProc && !serverProc.killed) {
      try {
        if (serverProc.stdin && serverProc.stdin.writable) {
          serverProc.stdin.write('stop\n');
        } else {
          serverProc.kill('SIGINT');
        }
      } catch {}
    }
    if (updaterHandle) await updaterHandle.close().catch(() => {});
    await sendTick('offline');
    if (tui) {
      tui.stop();
      logger.setOutputSink(null);
    }
  };

  // Mode Daemon Seul (Docker / systemd externe)
  if (args.daemonOnly) {
    logger.step(`Démarrage du Daemon de Télémétrie seul pour [${bold(cyan(slug))}]`);
    logger.info(`Port surveillé : ${port} · Intervalle : 30s`);
    await sendTick();
    heartbeatTimer = setInterval(sendTick, HEARTBEAT_INTERVAL_MS);
    process.on('SIGINT', async () => { await shutdown(); process.exit(0); });
    process.on('SIGTERM', async () => { await shutdown(); process.exit(0); });
    return;
  }

  // Initialisation TUI si interactif
  if (useTui) {
    tui = new ServerTui({
      name: serverName,
      slug,
      mcVersion,
      loader,
      loaderVersion,
      port,
      cliVersion: pkg.version,
      updaterUrl: updaterHandle?.url || '',
      yggdrasilActive: launchSpec.yggdrasilInjected,
      authStatus: client ? (config.auth?.linked ? green('✓ Lié Auth') : yellow('◐ Connexion Auth...')) : gray('Hors ligne'),
      onStop: async () => {
        await shutdown();
        setTimeout(() => process.exit(0), 2500);
      },
      onCommand: async (input) => {
        if (input === '/help') {
          logger.info(`${bold('Commandes Modey :')} /status, /link <token>, /clear, /stop — Sinon tapez toute commande Minecraft (ex: list, op, say).`);
          return;
        }
        if (input === '/clear') {
          tui.clearLogs();
          return;
        }
        if (input === '/status') {
          logger.info(
            `Serveur=${bold(slug)} · Port=${port} · Updater=${updaterHandle?.url || 'inactif'} · ` +
            `SSO=${launchSpec.yggdrasilInjected ? 'actif' : 'off'} · Auth=${client ? apiUrl : 'off'}`
          );
          return;
        }
        if (input.startsWith('/link ')) {
          const linkTok = input.slice(6).trim();
          if (!linkTok || !client) {
            logger.warn('Utilisation : /link <node_token>');
            return;
          }
          const res = await client.linkNode(linkTok, { slug, name: serverName, mcVersion, loader, loaderVersion, port, publicIp });
          config.auth = { ...(config.auth || {}), linked: true, node_token: linkTok };
          client.nodeToken = linkTok;
          await saveConfig(config);
          tui.updateState({ authStatus: green('✓ Lié Auth') });
          logger.success(`Serveur confirmé et lié avec Auth (${res.server?.slug || slug}) !`);
          return;
        }
        if (input === '/stop') {
          await shutdown();
          setTimeout(() => process.exit(0), 2500);
          return;
        }
        if (serverProc && serverProc.stdin && serverProc.stdin.writable) {
          serverProc.stdin.write(input + '\n');
        } else {
          logger.warn('Le serveur Minecraft n\'accepte pas encore d\'entrée.');
        }
      }
    });
    tui.start();
    logger.setOutputSink((line) => tui.log(line));
    if (pwdEnsure?.updated) {
      if (pwdEnsure.generated) {
        logger.warn(`Mot de passe privé généré : ${bold(green(pwdEnsure.password))} (modifiable via: modey-server password)`);
      } else {
        logger.success('Mot de passe privé configuré et actif sur le port 3008.');
      }
    }
  } else {
    logger.step(`Démarrage du Serveur Minecraft [${bold(cyan(slug))}]`);
    if (launchSpec.yggdrasilInjected) {
      logger.info(green(`Authentification Modey Yggdrasil active (${config.auth?.yggdrasil_url || 'https://api.modey.flowcrea.fr/api/yggdrasil'})`));
    }
    logger.info(`Binaire : ${launchSpec.displayCommand}`);
  }

  serverProc = spawn(launchSpec.command, launchSpec.args, {
    cwd: process.cwd(),
    stdio: useTui ? ['pipe', 'pipe', 'pipe'] : 'inherit'
  });

  if (useTui) {
    let triggeredDoneTick = false;
    pipeLines(serverProc.stdout, (line) => {
      tui.logMinecraft(line);
      if (!triggeredDoneTick && /Done \([^)]+\)!/i.test(line)) {
        triggeredDoneTick = true;
        setTimeout(() => { void sendTick(); }, 400);
      }
    });
    pipeLines(serverProc.stderr, (line) => tui.logMinecraft(line));
  }

  serverProc.on('error', async (err) => {
    logger.error(`Impossible de démarrer Java (${err.message}). Vérifiez que Java 21+ est installé dans le PATH.`);
    if (tui) {
      tui.stop();
      logger.setOutputSink(null);
    }
    if (updaterHandle) await updaterHandle.close().catch(() => {});
    process.exit(1);
  });

  logger.success('Processus serveur lancé (PID: ' + (serverProc.pid || 'en cours') + ')');

  // Premier tick 'starting' puis toutes les 30s (même en standalone pour le TUI)
  await sendTick('starting');
  heartbeatTimer = setInterval(sendTick, HEARTBEAT_INTERVAL_MS);

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
    if (tui) {
      tui.stop();
      logger.setOutputSink(null);
    }
    logger.info(`Le serveur Minecraft s'est arrêté avec le code ${code}.`);
    if (updaterHandle) await updaterHandle.close().catch(() => {});
    await sendTick('offline');
    process.exit(code || 0);
  });
}

module.exports = { runCommand };
