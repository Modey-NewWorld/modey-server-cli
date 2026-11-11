/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Recherche le fichier d'arguments JVM généré par NeoForge ou Forge moderne (win_args.txt / unix_args.txt).
 */
function findModLoaderArgsFile(serverDir, { loader, loaderVersion, platform = process.platform } = {}) {
  const argsFilename = platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const searchRoots = [
    path.join(serverDir, 'libraries', 'net', 'neoforged', 'neoforge'),
    path.join(serverDir, 'libraries', 'net', 'minecraftforge', 'forge')
  ];

  // Si NeoForge ou Forge n'est pas installé en tant qu'arborescence libraries/, ignorer rapidement
  if (loader && !['neoforge', 'forge'].includes(String(loader).toLowerCase())) {
    return null;
  }

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    let versions = [];
    try {
      versions = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse();
    } catch {
      continue;
    }

    if (loaderVersion && versions.includes(loaderVersion)) {
      versions = [loaderVersion, ...versions.filter((v) => v !== loaderVersion)];
    }

    for (const ver of versions) {
      const candidate = path.join(root, ver, argsFilename);
      if (fs.existsSync(candidate)) {
        return path.relative(serverDir, candidate).split(path.sep).join('/');
      }
    }
  }

  return null;
}

/**
 * Détermine la commande Java et les arguments exacts pour lancer le serveur Minecraft
 * (supporte NeoForge/Forge moderne via @unix_args/@win_args ainsi que Paper/Fabric/Vanilla via -jar).
 */
function resolveJavaLaunchSpec(serverDir, config = {}, platform = process.platform) {
  const javaArgs = Array.isArray(config.runtime?.java_args) && config.runtime.java_args.length > 0
    ? config.runtime.java_args
    : ['-Xms2G', '-Xmx4G'];
  const loader = config.identity?.loader || '';
  const loaderVersion = config.identity?.loader_version || '';

  const modLoaderArgsRel = findModLoaderArgsFile(serverDir, { loader, loaderVersion, platform });
  if (modLoaderArgsRel) {
    const args = [...javaArgs, `@${modLoaderArgsRel}`, 'nogui'];
    return {
      mode: 'args-file',
      command: 'java',
      args,
      target: modLoaderArgsRel,
      displayCommand: `java ${args.join(' ')}`
    };
  }

  const jarFile = config.runtime?.server_jar || 'server.jar';
  const jarPath = path.resolve(serverDir, jarFile);
  if (!fs.existsSync(jarPath)) {
    throw new Error(
      `Aucun exécutable serveur trouvé (${jarFile} ou args NeoForge). ` +
      'Exécutez d\'abord "modey-server install" dans ce dossier.'
    );
  }

  const args = [...javaArgs, '-jar', jarFile, 'nogui'];
  return {
    mode: 'jar',
    command: 'java',
    args,
    target: jarFile,
    displayCommand: `java ${args.join(' ')}`
  };
}

/**
 * Génère les scripts de démarrage clés en main start.bat (Windows) et start.sh (Linux/macOS)
 * permettant de lancer le serveur Minecraft + Files-Updater sans Docker.
 */
async function generateStartScripts(serverDir = process.cwd(), { overwrite = false } = {}) {
  const batPath = path.resolve(serverDir, 'start.bat');
  const shPath = path.resolve(serverDir, 'start.sh');

  const batContent = [
    '@echo off',
    'cd /d "%~dp0"',
    'title Modey Server',
    'where modey-server >nul 2>nul',
    'if %errorlevel%==0 (',
    '  call modey-server run %*',
    ') else (',
    '  call npx --yes github:Modey-NewWorld/modey-server-cli run %*',
    ')',
    'if %errorlevel% neq 0 (',
    '  echo.',
    '  echo [ERREUR] Le serveur s\'est arrete avec un code d\'erreur.',
    '  pause',
    ')',
    ''
  ].join('\r\n');

  const shContent = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'cd "$(dirname "$0")"',
    'if command -v modey-server >/dev/null 2>&1; then',
    '  exec modey-server run "$@"',
    'else',
    '  exec npx --yes github:Modey-NewWorld/modey-server-cli run "$@"',
    'fi',
    ''
  ].join('\n');

  const created = [];
  if (overwrite || !fs.existsSync(batPath)) {
    await fsp.writeFile(batPath, batContent, 'utf-8');
    created.push('start.bat');
  }
  if (overwrite || !fs.existsSync(shPath)) {
    await fsp.writeFile(shPath, shContent, 'utf-8');
    if (process.platform !== 'win32') {
      await fsp.chmod(shPath, 0o755).catch(() => {});
    }
    created.push('start.sh');
  }

  return created;
}

module.exports = {
  findModLoaderArgsFile,
  resolveJavaLaunchSpec,
  generateStartScripts
};
