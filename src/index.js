/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

/*fcs:Flow*/
const { initCommand } = require('./commands/init.js');
const { installCommand } = require('./commands/install.js');
const { syncCommand } = require('./commands/sync.js');
const { runCommand } = require('./commands/run.js');
const { statusCommand } = require('./commands/status.js');
const { updaterCommand } = require('./commands/updater.js');
const { helpCommand } = require('./commands/help.js');
const pkg = require('../package.json');

/**
 * Analyseur d'arguments CLI léger sans dépendances externes
 */
function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key.includes('=')) {
        const [k, v] = key.split('=');
        parsed[k] = v;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        parsed[key] = args[++i];
      } else {
        parsed[key] = true;
      }
    } else if (arg.startsWith('-')) {
      const key = arg.slice(1);
      parsed[key] = true;
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  const command = parsed._[0] || '';

  if (parsed.version || parsed.v) {
    console.log(`v${pkg.version}`);
    return;
  }

  if (parsed.help || parsed.h || !command) {
    helpCommand();
    return;
  }

  switch (command.toLowerCase()) {
    case 'init':
      await initCommand({
        slug: parsed.slug,
        name: parsed.name,
        mcVersion: parsed['mc-version'],
        loader: parsed.loader,
        loaderVersion: parsed['loader-version'],
        port: parsed.port,
        publicIp: parsed['public-ip'],
        apiUrl: parsed['api-url'],
        nodeToken: parsed.token,
        nonInteractive: parsed['non-interactive'],
        force: parsed.force
      });
      break;

    case 'install':
      await installCommand({
        acceptEula: parsed['accept-eula']
      });
      break;

    case 'sync':
      await syncCommand();
      break;

    case 'run':
    case 'start':
      await runCommand({
        daemonOnly: parsed['daemon-only']
      });
      break;

    case 'status':
      await statusCommand({
        slug: parsed.slug,
        apiUrl: parsed['api-url']
      });
      break;

    case 'updater':
      await updaterCommand({
        slug: parsed.slug,
        port: parsed.port || parsed['updater-port'],
        publicUrl: parsed['public-url']
      });
      break;

    case 'help':
      helpCommand();
      break;

    default:
      console.error(`\x1b[31mCommande inconnue :\x1b[0m "${command}"`);
      helpCommand();
      process.exit(1);
  }
}

module.exports = {
  main,
  parseArgs
};
