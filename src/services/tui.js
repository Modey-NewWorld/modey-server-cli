/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const readline = require('readline');
const { Writable } = require('stream');
const { bold, cyan, green, yellow, red, gray, magenta } = require('../utils/colors.js');
const { getAsciiLogoLines } = require('../utils/logger.js');

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;
const MAX_STORED_LOGS = 600;

function stripAnsi(str = '') {
  return String(str).replace(ANSI_REGEX, '');
}

function fitVisible(str, maxWidth) {
  const plain = stripAnsi(str);
  if (maxWidth <= 0) return '';
  if (plain.length <= maxWidth) {
    return str + ' '.repeat(maxWidth - plain.length);
  }
  return plain.slice(0, Math.max(0, maxWidth - 1)) + '…';
}

/**
 * Découpe une ligne (potentiellement colorée ANSI) en tranches d'au plus maxWidth colonnes visibles
 */
function wrapLine(str, maxWidth) {
  const raw = String(str || '');
  if (maxWidth < 12) return [raw];
  const plain = stripAnsi(raw);
  if (plain.length <= maxWidth) return [raw];

  // Pour les lignes qui dépassent, re-trancher proprement en préservant la couleur dominante
  const colorMatch = raw.match(/^\x1b\[[0-9;]*m/);
  const prefix = colorMatch ? colorMatch[0] : '';
  const suffix = prefix ? '\x1b[39m' : '';
  const chunks = [];
  for (let i = 0; i < plain.length; i += maxWidth) {
    chunks.push(prefix + plain.slice(i, i + maxWidth) + suffix);
  }
  return chunks;
}

function formatMinecraftLine(rawLine) {
  const line = String(rawLine || '').replace(/\r/g, '');
  if (!line.trim()) return null;

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
 * Interface terminal plein écran (Alternate Screen Buffer + Buffer virtuel) :
 * - Redessin complet et atomique sans artefacts lors du redimensionnement CMD/Terminal
 * - En-tête adaptatif avec logo ASCII Modey Server + carte statut live
 * - Invite épurée style Claude Code : " > "
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

    this.logs = [];
    this.scrollOffset = 0;
    this.onCommand = options.onCommand || (() => {});
    this.onStop = options.onStop || (() => {});
    this.started = false;
    this.rl = null;
    this.promptPrefix = `${cyan(' >')} `;
    this.promptPrefixLen = 3;

    this._renderTimer = null;
    this._resizeTimer = null;
    this._onResize = () => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.renderFrame(), 25);
    };
  }

  getSize() {
    return {
      cols: Math.max(40, process.stdout.columns || 100),
      rows: Math.max(12, process.stdout.rows || 30)
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
      this.scrollOffset = 0;
      this.renderFrame();
      if (trimmed) {
        Promise.resolve(this.onCommand(trimmed)).catch((err) => {
          this.log(red(`✖ Erreur commande : ${err.message}`));
        });
      }
    });

    this.rl.on('SIGINT', () => {
      this.onStop();
    });

    if (process.stdin.isTTY) {
      process.stdin.on('keypress', (_str, key) => {
        if (!this.started) return;
        if (key?.name === 'pageup') {
          this.scrollOffset = Math.min(Math.max(0, this.logs.length - 5), this.scrollOffset + 8);
          this.renderFrame();
          return;
        }
        if (key?.name === 'pagedown') {
          this.scrollOffset = Math.max(0, this.scrollOffset - 8);
          this.renderFrame();
          return;
        }
        setImmediate(() => this.renderPromptOnly());
      });
    }

    process.stdout.on('resize', this._onResize);
    // Entrer dans le Alternate Screen Buffer pour éviter toute trace dans le scrollback lors du resize
    process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
    this.renderFrame();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    if (this._renderTimer) clearTimeout(this._renderTimer);
    if (this._resizeTimer) clearTimeout(this._resizeTimer);
    process.stdout.off('resize', this._onResize);

    try {
      // Quitter le Alternate Screen Buffer proprement
      process.stdout.write('\x1b[?1049l\x1b[?25h');
    } catch {}
    if (this.rl) {
      try { this.rl.close(); } catch {}
      this.rl = null;
    }
  }

  updateState(patch = {}) {
    Object.assign(this.state, patch);
    if (this.started) this.scheduleRender();
  }

  scheduleRender() {
    if (!this.started || this._renderTimer) return;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      this.renderFrame();
    }, 35);
  }

  buildHeaderLines(cols, rows) {
    const s = this.state;
    const innerWidth = Math.max(20, cols - 4);
    const statusLabel = s.status === 'online'
      ? green('● EN LIGNE')
      : (s.status === 'blocked' ? red('⛔ BLOQUÉ') : yellow('◐ DÉMARRAGE'));
    const ssoBadge = s.yggdrasilActive ? green('✓ SSO Modey') : yellow('○ SSO off');
    const updaterTxt = s.updaterUrl ? cyan(s.updaterUrl) : gray('Inactif');

    const lines = [];
    const showAscii = cols >= 74 && rows >= 20;
    if (showAscii) {
      for (const art of getAsciiLogoLines(s.cliVersion)) {
        lines.push(fitVisible(art, cols - 1));
      }
    }

    const titleRaw = ` ◆ ${s.name} (${s.slug}) `;
    const topDashes = Math.max(0, cols - 3 - titleRaw.length);
    lines.push(`${gray('╭─')}${bold(cyan(titleRaw))}${gray('─'.repeat(topDashes) + '╮')}`);
    lines.push(`${gray('│')} ${fitVisible(
      `Etat: ${statusLabel}   Joueurs: ${bold(`${s.playersOnline}/${s.playersMax}`)}   RAM: ${bold(`${s.ramUsedMb || 0} Mo`)}   ${s.loader} ${s.loaderVersion} (${s.mcVersion}) :${s.port}`,
      innerWidth
    )} ${gray('│')}`);
    lines.push(`${gray('│')} ${fitVisible(
      `SSO: ${ssoBadge}   Updater: ${updaterTxt}   Auth: ${s.authStatus}`,
      innerWidth
    )} ${gray('│')}`);
    lines.push(gray('╰' + '─'.repeat(Math.max(10, cols - 2)) + '╯'));

    return lines;
  }

  renderFrame() {
    if (!this.started) return;
    const { cols, rows } = this.getSize();
    const headerLines = this.buildHeaderLines(cols, rows);
    const footerRows = 3; // barre haut + prompt " > " + barre bas (style Claude Code)
    const logHeight = Math.max(1, rows - headerLines.length - footerRows);

    // Envelopper toutes les lignes loggées selon la largeur actuelle de la fenêtre
    const wrapped = [];
    const startIdx = Math.max(0, this.logs.length - 200);
    for (let i = startIdx; i < this.logs.length; i++) {
      const parts = wrapLine(this.logs[i], Math.max(20, cols - 2));
      for (const p of parts) wrapped.push(p);
    }

    const maxOffset = Math.max(0, wrapped.length - logHeight);
    const clampedOffset = Math.min(this.scrollOffset, maxOffset);
    const end = Math.max(0, wrapped.length - clampedOffset);
    const begin = Math.max(0, end - logHeight);
    const visibleLogs = wrapped.slice(begin, end);

    const buf = ['\x1b[?25l']; // masquer curseur pendant le redraw
    let rowIdx = 1;

    // 1. Header
    for (const hl of headerLines) {
      if (rowIdx > rows) break;
      buf.push(`\x1b[${rowIdx};1H\x1b[2K${hl}`);
      rowIdx++;
    }

    // 2. Logs centrés / scrollables
    for (let i = 0; i < logHeight && rowIdx <= rows - footerRows; i++) {
      const logLine = visibleLogs[i] ? ` ${visibleLogs[i]}` : '';
      buf.push(`\x1b[${rowIdx};1H\x1b[2K${logLine}`);
      rowIdx++;
    }

    // 3. Footer style Claude Code (lignes fixes + invite " > ")
    const sep = gray('─'.repeat(Math.max(10, cols)));
    const hint = clampedOffset > 0
      ? yellow(` [Défilement +${clampedOffset} · PgDn pour revenir] `)
      : gray(' /help · /status · /stop ');
    const hintRow = Math.max(rowIdx, rows - 2);
    const promptRow = Math.min(rows, hintRow + 1);
    const bottomRow = Math.min(rows, promptRow + 1);

    buf.push(`\x1b[${hintRow};1H\x1b[2K${sep}`);
    const lineText = this.rl?.line || '';
    const cursorPos = this.rl?.cursor ?? lineText.length;
    const maxInput = Math.max(8, cols - this.promptPrefixLen - 1);
    const visibleInput = lineText.length > maxInput ? lineText.slice(lineText.length - maxInput) : lineText;
    const col = Math.min(cols, this.promptPrefixLen + Math.min(cursorPos, maxInput) + 1);

    buf.push(`\x1b[${promptRow};1H\x1b[2K${this.promptPrefix}${visibleInput}`);
    if (bottomRow > promptRow) {
      const hintPlain = stripAnsi(hint);
      const rightPad = Math.max(0, cols - hintPlain.length - 1);
      buf.push(`\x1b[${bottomRow};1H\x1b[2K${gray('─'.repeat(rightPad))}${hint}${gray('─')}`);
    }
    buf.push(`\x1b[${promptRow};${col}H\x1b[?25h`);

    process.stdout.write(buf.join(''));
  }

  renderPromptOnly() {
    if (!this.started) return;
    const { cols, rows } = this.getSize();
    const promptRow = Math.max(1, rows - 1);
    const lineText = this.rl?.line || '';
    const cursorPos = this.rl?.cursor ?? lineText.length;
    const maxInput = Math.max(8, cols - this.promptPrefixLen - 1);
    const visibleInput = lineText.length > maxInput ? lineText.slice(lineText.length - maxInput) : lineText;
    const col = Math.min(cols, this.promptPrefixLen + Math.min(cursorPos, maxInput) + 1);
    process.stdout.write(`\x1b[${promptRow};1H\x1b[2K${this.promptPrefix}${visibleInput}\x1b[${promptRow};${col}H`);
  }

  log(formattedLine) {
    if (!formattedLine) return;
    if (!this.started) {
      console.log(formattedLine);
      return;
    }
    this.logs.push(formattedLine);
    if (this.logs.length > MAX_STORED_LOGS) {
      this.logs.splice(0, this.logs.length - MAX_STORED_LOGS);
    }
    this.scheduleRender();
  }

  logMinecraft(rawLine) {
    const formatted = formatMinecraftLine(rawLine);
    if (formatted) this.log(formatted);
  }

  clearLogs() {
    this.logs = [];
    this.scrollOffset = 0;
    this.renderFrame();
  }
}

module.exports = {
  ServerTui,
  formatMinecraftLine,
  stripAnsi,
  fitVisible,
  wrapLine
};
