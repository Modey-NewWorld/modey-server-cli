#!/usr/bin/env node

/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

/*fcs:Flow*/
const { main } = require('../src/index.js');

main(process.argv.slice(2)).catch((err) => {
  console.error('\n\x1b[31m[Modey CLI] Erreur fatale:\x1b[0m', err.message || err);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
