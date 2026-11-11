/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { bold, cyan, green, yellow, red, gray, blue } = require('./colors.js');
const pkg = require('../../package.json');

let outputSink = null;

function timestamp() {
  const d = new Date();
  return gray(`[${d.toTimeString().split(' ')[0]}]`);
}

function formatArgs(args) {
  return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

const logger = {
  setOutputSink(fn) {
    outputSink = typeof fn === 'function' ? fn : null;
  },
  banner() {
    const ver = `v${pkg.version}`;
    const line1 = `  ${bold(cyan('◆ MODEY SERVER'))}  ${gray(ver)}`.padEnd(56);
    const top = gray('  ╭' + '─'.repeat(58) + '╮');
    const mid1 = `${gray('  │')}  ${bold(cyan('◆ MODEY SERVER CLI'))} ${gray(ver)}${' '.repeat(Math.max(1, 35 - ver.length))}${gray('FlowCreativeStudio')}  ${gray('│')}`;
    const mid2 = `${gray('  │')}  ${gray('Serveurs Minecraft · SSO Modey · Files-Updater · Zéro Docker')} ${gray('│')}`;
    const bot = gray('  ╰' + '─'.repeat(58) + '╯');
    console.log('');
    console.log(top);
    console.log(mid1);
    console.log(mid2);
    console.log(bot);
    console.log('');
  },
  info(...args) {
    const line = `${timestamp()} ${blue('ℹ')} ${formatArgs(args)}`;
    if (outputSink) return outputSink(line);
    console.log(line);
  },
  success(...args) {
    const line = `${timestamp()} ${green('✔')} ${formatArgs(args)}`;
    if (outputSink) return outputSink(line);
    console.log(line);
  },
  warn(...args) {
    const line = `${timestamp()} ${yellow('⚠')} ${formatArgs(args)}`;
    if (outputSink) return outputSink(line);
    console.log(line);
  },
  error(...args) {
    const line = `${timestamp()} ${red('✖')} ${formatArgs(args)}`;
    if (outputSink) return outputSink(line);
    console.error(line);
  },
  step(title) {
    const line = `\n  ${cyan('◆')} ${bold(title)}`;
    if (outputSink) return outputSink(`${cyan('◆')} ${bold(title)}`);
    console.log(line);
  }
};

module.exports = logger;
