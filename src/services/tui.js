/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const readline = require('readline');
const { Writable } = require('stream');
const { bold, cyan, green, yellow, red, gray, magenta } = require('../utils/colors.js');

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(str = '') {
  return String(str).replace(ANSI_REGEX, '');
}

function fitVisible(str, maxWidth) {
  const plain = stripAnsi(str);
  if (plain.length <= maxWidth) {
    return str + ' '.repeat(Math.max(0, maxWidth - plain.length));
  }
  // Troncature sûre sur texte brut si dépassement
  return plain.slice(0, Math.max(0, maxWidth - 1)) + '…';
}

function formatMinecraftLine(rawLine) {
  const line = String(rawLine || '').replace(/\r/g, '');
  if (!line.trim()) return null;

  // Filtrer le bruit technique répétitif du démarrage Java
  if (line.includes('WARNING: sun.misc.Unsafe') || line.includes('Use --enable-native-access')) {
    return null;
  }

  if (/\[.*\/ERROR\]|Exception|FATAL|Failed to verify/i.test(line)) {
    return red(line);
  }
  if (/\[.*\/WARN\]/i.test(line)) {
    return yellow(line);
  }
  if (/Done \(.*\)|Listening on|Successfully initialized/i.test(line)) {
    return green(line);
  }
  if (/\[.*\]: <[^>]+>/.test(line)) {
    return cyan(line);
  }
  return line;
}

/**
 * Interface terminal personnalisée façon Claude Code :
 * - En-tête fixe avec statut live (joueurs, RAM, Auth, Files-Updater, SSO)
 * - Zone de logs scrollable au centre
 * - Invite de commande interactive en bas ("❯ modey > ")
 */
class ServerTui {
  constructor(options = {}) {
    this.state = {
      name: options.name || 'Serveur Modey',
      slug: options.slug || 'modey-server',
      mcVersion: options.mcVersion || '1.21.1',
      loader: options.loader || 'neoforge',
      loaderVersion: options.loaderVersion || '',
      port: options.port || 25565,
      cliVersion: options.cliVersion || '1.3.0',
      status: 'starting',
      playersOnline: 0,
      playersMax: 20,
      ramUsedMb: 0,
      updaterUrl: options.updaterUrl || '',
      yggdrasilActive: Boolean(options.yggdrasilActive),
      authStatus: options.authStatus || 'En attente Auth'
    };

    this.onCommand = options.onCommand || (() => {});
    this.onStop = options.onStop || (() => {});
    this.headerHeight = 5;
    this.footerHeight = 2;
    this.started = false;
    this.rl = null;
    this.promptPrefix = `${cyan('❯')} ${bold('modey')} ${gray('>')} `;
    this.promptPrefixLen = 10;
    this._onResize = () => this.renderLayout();
  }

  getSize() {
    return {
      cols: Math.max(60, process.stdout.columns || 100),
      rows: Math.max(14, process.stdout.rows || 30)
    };
  }

  start() {
    if (this.started) return;
    this.started = true;

    const sinkStream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    });

    this.rl = readline.createInterface({
      input: process.stdin,
      output: sinkStream,
      terminal: true
    });

    this.rl.on('line', (line) => {
      const trimmed = String(line || '').trim();
      this.redrawPrompt('');
      if (trimmed) {
        Promise.resolve(this.onCommand(trimmed)).catch((err) => {
          this.log(red(`✖ Erreur commande : ${err.message}`));
        });
      }
    });

    this.rl.on('SIGINT', () => {
      this.onStop();
    });

    // Rafraîchir l'invite pendant la frappe utilisateur
    if (process.stdin.isTTY) {
      process.stdin.on('keypress', () => {
        if (this.started && this.rl) {
          setImmediate(() => this.redrawPrompt(this.rl.line || '', this.rl.cursor || 0));
        }
      });
    }

    process.stdout.on('resize', this._onResize);
    process.stdout.write('\x1b[2J\x1b[H');
    this.renderLayout();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    process.stdout.off('resize', this._onResize);
    try {
      const { rows } = this.getSize();
      // Restaurer la zone de défilement complète et placer le curseur proprement en bas
      process.stdout.write(`\x1b[r\x1b[${rows};1H\n\x1b[?25h`);
    } catch {}
    if (this.rl) {
      try { this.rl.close(); } catch {}
      this.rl = null;
    }
  }

  updateState(patch = {}) {
    Object.assign(this.state, patch);
    if (this.started) {
      this.renderHeader();
      this.redrawPrompt(this.rl?.line || '', this.rl?.cursor || 0);
    }
  }

  renderLayout() {
    if (!this.started) return;
    const { rows } = this.getSize();
    const scrollBottom = Math.max(this.headerHeight + 1, rows - this.footerHeight);
    // Définir la zone scrollable entre header et footer
    process.stdout.write(`\x1b[${this.headerHeight + 1};${scrollBottom}r`);
    this.renderHeader();
    this.renderFooter();
    this.redrawPrompt(this.rl?.line || '', this.rl?.cursor || 0);
  }

  renderHeader() {
    const { cols } = this.getSize();
    const innerWidth = Math.max(40, cols - 4);
    const s = this.state;

    const statusLabel = s.status === 'online'
      ? green('● EN LIGNE')
      : (s.status === 'blocked' ? red('⛔ BLOQUÉ') : yellow('◐ DÉMARRAGE'));
    const ssoBadge = s.yggdrasilActive ? green('✓ Yggdrasil SSO') : yellow('○ SSO off');
    const updaterTxt = s.updaterUrl ? cyan(s.updaterUrl) : gray('Inactif');

    const titleRaw = ` ◆ MODEY SERVER · ${s.name} (${s.slug}) `;
    const topDashes = Math.max(0, cols - 3 - titleRaw.length);
    const topLine = `${gray('╭─')}${bold(cyan(titleRaw))}${gray('─'.repeat(topDashes) + '╮')}`;

    const line1 = fitVisible(
      `Etat: ${statusLabel}   Joueurs: ${bold(`${s.playersOnline}/${s.playersMax}`)}   RAM: ${bold(`${s.ramUsedMb || 0} Mo`)}   Loader: ${s.loader} ${s.loaderVersion} (${s.mcVersion}) · :${s.port}`,
      innerWidth
    );
    const line2 = fitVisible(
      `SSO: ${ssoBadge}   Updater: ${updaterTxt}   Auth: ${s.authStatus}   CLI: ${magenta('v' + s.cliVersion)}`,
      innerWidth
    );
    const botLine = gray('╰' + '─'.repeat(cols - 2) + '╯');
    const hintLine = gray(fitVisible('  Logs serveur en direct · Tapez une commande Minecraft (list, say, stop) ou /help', cols - 2));

    const out = [
      `\x1b[1;1H\x1b[2K${topLine}`,
      `\x1b[2;1H\x1b[2K${gray('│')} ${line1} ${gray('│')}`,
      `\x1b[3;1H\x1b[2K${gray('│')} ${line2} ${gray('│')}`,
      `\x1b[4;1H\x1b[2K${botLine}`,
      `\x1b[5;1H\x1b[2K${hintLine}`
    ].join('');

    process.stdout.write(out);
  }

  renderFooter() {
    const { cols, rows } = this.getSize();
    const sep = gray('─'.repeat(Math.max(10, cols)));
    process.stdout.write(`\x1b[${rows - 1};1H\x1b[2K${sep}`);
  }

  redrawPrompt(lineText = '', cursorPos = lineText.length) {
    if (!this.started) return;
    const { cols, rows } = this.getSize();
    const maxInput = Math.max(10, cols - this.promptPrefixLen - 1);
    const visibleInput = lineText.length > maxInput ? lineText.slice(lineText.length - maxInput) : lineText;
    const col = Math.min(cols, this.promptPrefixLen + Math.min(cursorPos, maxInput) + 1);
    process.stdout.write(`\x1b[${rows};1H\x1b[2K${this.promptPrefix}${visibleInput}\x1b[${rows};${col}H`);
  }

  log(formattedLine) {
    if (!formattedLine) return;
    if (!this.started) {
      console.log(formattedLine);
      return;
    }
    const { rows } = this.getSize();
    const scrollBottom = Math.max(this.headerHeight + 1, rows - this.footerHeight);
    process.stdout.write(`\x1b[${scrollBottom};1H\n${formattedLine}`);
    this.redrawPrompt(this.rl?.line || '', this.rl?.cursor || 0);
  }

  logMinecraft(rawLine) {
    const formatted = formatMinecraftLine(rawLine);
    if (formatted) this.log(formatted);
  }
}

module.exports = {
  ServerTui,
  formatMinecraftLine,
  stripAnsi,
  fitVisible
};
