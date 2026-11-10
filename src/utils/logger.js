/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const { bold, cyan, green, yellow, red, gray, blue } = require('./colors.js');

function timestamp() {
  const d = new Date();
  return gray(`[${d.toTimeString().split(' ')[0]}]`);
}

const logger = {
  banner() {
    console.log(bold(cyan('\n  🎮 MODEY SERVER CLI · Infrastructure Décentralisée')));
    console.log(gray('  https://github.com/Modey-NewWorld/modey-server-cli\n'));
  },
  info(...args) {
    console.log(timestamp(), blue('ℹ'), ...args);
  },
  success(...args) {
    console.log(timestamp(), green('✔'), ...args);
  },
  warn(...args) {
    console.log(timestamp(), yellow('⚠'), ...args);
  },
  error(...args) {
    console.error(timestamp(), red('✖'), ...args);
  },
  step(title) {
    console.log('\n' + bold(cyan('▶ ' + title)));
  }
};

module.exports = logger;
