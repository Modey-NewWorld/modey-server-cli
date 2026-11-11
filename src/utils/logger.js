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

function getAsciiLogoLines(version = pkg.version) {
  return [
    cyan('  __  __           _              ____'),
    cyan(' |  \\/  | ___   __| | ___ _   _  / ___|  ___ _ ____   _____ _ __'),
    cyan(' | |\\/| |/ _ \\ / _` |/ _ \\ | | | \\___ \\ / _ \\ \'__\\ \\ / / _ \\ \'__|'),
    cyan(' | |  | | (_) | (_| |  __/ |_| |  ___) |  __/ |   \\ V /  __/ |'),
    cyan(' |_|  |_|\\___/ \\__,_|\\___|\\__, | |____/ \\___|_|    \\_/ \\___|_|'),
    `                          ${cyan('|___/')}   ${gray(`-- Dedicated Node Engine v${version} --`)}`
  ];
}

const logger = {
  setOutputSink(fn) {
    outputSink = typeof fn === 'function' ? fn : null;
  },
  getAsciiLogoLines,
  banner() {
    console.log('');
    for (const line of getAsciiLogoLines(pkg.version)) {
      console.log(line);
    }
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
    const clean = `${cyan('◆')} ${bold(title)}`;
    if (outputSink) return outputSink(clean);
    console.log('\n ' + clean);
  }
};

module.exports = logger;
