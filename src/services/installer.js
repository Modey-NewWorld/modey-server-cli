/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const { spawnSync } = require('child_process');

const AUTHLIB_LATEST_API_URL = 'https://authlib-injector.yushi.moe/artifact/latest.json';
const AUTHLIB_GITHUB_API_URL = 'https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest';
const MOJANG_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER_API_BASE = 'https://fill.papermc.io/v3/projects/paper';
const FABRIC_GAME_VERSIONS_URL = 'https://meta.fabricmc.net/v2/versions/game';
const FABRIC_LOADER_VERSIONS_URL = 'https://meta.fabricmc.net/v2/versions/loader';
const NEOFORGE_RELEASES_URL = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const NEOFORGE_LEGACY_1201_URL = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge';
const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN_META_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const MODRINTH_API_BASE = 'https://api.modrinth.com/v2';

const USER_AGENT = 'ModeyServerCLI/1.4 (+https://github.com/Modey-NewWorld/modey-server-cli)';

const CLIENT_PRESETS = {
  vanilla: {
    id: 'vanilla',
    label: 'Vanilla pur (aucun mod)',
    loader: 'vanilla',
    projects: []
  },
  'fabric-opti': {
    id: 'fabric-opti',
    label: 'Fabric Optimisé (Sodium + Lithium + FerriteCore)',
    loader: 'fabric',
    projects: ['fabric-api', 'sodium', 'lithium', 'ferrite-core']
  },
  'fabric-shaders': {
    id: 'fabric-shaders',
    label: 'Fabric Optimisé + Shaders (Iris + Sodium + Lithium)',
    loader: 'fabric',
    projects: ['fabric-api', 'sodium', 'iris', 'lithium']
  },
  'neoforge-shaders': {
    id: 'neoforge-shaders',
    label: 'NeoForge Shaders & Optimisation (Iris/Oculus + Sodium/Embeddium)',
    loader: 'neoforge',
    projects: ['sodium', 'iris', 'embeddium', 'oculus']
  },
  'forge-shaders': {
    id: 'forge-shaders',
    label: 'Forge Shaders & Optimisation (Embeddium + Oculus)',
    loader: 'forge',
    projects: ['embeddium', 'oculus']
  }
};

async function fetchJson(url, timeoutMs = 8000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} (${url})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchText(url, timeoutMs = 8000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} (${url})`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

/**
 * Télécharge un fichier depuis une URL vers un chemin local avec stream
 */
async function downloadFile(url, destPath) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Échec du téléchargement (${res.status} ${res.statusText}) : ${url}`);
  }
  const fileStream = createWriteStream(destPath);
  // @ts-ignore
  await pipeline(res.body, fileStream);
  return destPath;
}

/**
 * Compare deux versions Minecraft (ex: "1.20.1" vs "1.21.1" -> -1, 0, 1)
 */
function compareMcVersions(a, b) {
  const pa = String(a || '').trim().split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').trim().split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va !== vb) return va > vb ? 1 : -1;
  }
  return 0;
}

/**
 * Retourne la version Java majeure minimale/recommandée selon la version Minecraft
 */
function getMinimumJavaVersionForMc(minecraftVersion = '1.21.1') {
  if (compareMcVersions(minecraftVersion, '1.20.5') >= 0) return 21;
  if (compareMcVersions(minecraftVersion, '1.18') >= 0) return 17;
  if (compareMcVersions(minecraftVersion, '1.17') >= 0) return 16;
  return 8;
}

function parseJavaMajorFromOutput(outputText = '') {
  const match = String(outputText).match(/version\s+"(\d+)(?:\.(\d+))?/i);
  if (!match) return null;
  const first = parseInt(match[1], 10);
  const second = parseInt(match[2] || '0', 10);
  if (first === 1 && second > 0) return second; // "1.8.0_xxx" -> 8
  return Number.isFinite(first) ? first : null;
}

/**
 * Détecte Java installé (PATH ou runtime local .java/) et vérifie la compatibilité avec MC
 */
function checkJavaCompatibility(minecraftVersion = '1.21.1', serverDir = process.cwd()) {
  const requiredMajor = getMinimumJavaVersionForMc(minecraftVersion);
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java';

  // Priorité à un JRE portable éventuellement installé dans .java/jre-<requiredMajor>
  const localPortable = path.join(serverDir, '.java', `jre-${requiredMajor}`, 'bin', exeName);
  const javaCmd = fsSync.existsSync(localPortable) ? localPortable : 'java';

  const probe = spawnSync(javaCmd, ['-version'], { encoding: 'utf8', timeout: 4000 });
  const combined = `${probe.stderr || ''}\n${probe.stdout || ''}`.trim();
  if (probe.error && probe.error.code === 'ENOENT') {
    return {
      ok: false,
      found: false,
      command: javaCmd,
      installedMajor: null,
      requiredMajor,
      reason: `Java introuvable dans le PATH. Java ${requiredMajor} est requis pour Minecraft ${minecraftVersion}.`
    };
  }

  const installedMajor = parseJavaMajorFromOutput(combined);
  if (!installedMajor) {
    return {
      ok: true,
      found: true,
      command: javaCmd,
      installedMajor: null,
      requiredMajor,
      reason: ''
    };
  }

  // Java 21 bloque souvent Forge <= 1.16.5 et inversement Java 8/17 échoue sur 1.20.5+
  if (requiredMajor >= 21 && installedMajor < 21) {
    return {
      ok: false,
      found: true,
      command: javaCmd,
      installedMajor,
      requiredMajor,
      reason: `Java ${installedMajor} détecté, mais Minecraft ${minecraftVersion} exige Java ${requiredMajor}+.`
    };
  }
  if (requiredMajor === 8 && installedMajor >= 17) {
    return {
      ok: false,
      found: true,
      command: javaCmd,
      installedMajor,
      requiredMajor,
      reason: `Java ${installedMajor} est trop récent pour Minecraft ${minecraftVersion} (Forge/anciens serveurs requièrent Java 8 ou 11).`
    };
  }
  if (requiredMajor === 17 && installedMajor < 17) {
    return {
      ok: false,
      found: true,
      command: javaCmd,
      installedMajor,
      requiredMajor,
      reason: `Java ${installedMajor} détecté, mais Minecraft ${minecraftVersion} requiert Java 17+.`
    };
  }

  return {
    ok: true,
    found: true,
    command: javaCmd,
    installedMajor,
    requiredMajor,
    reason: ''
  };
}

/**
 * Installe un JRE portable Eclipse Temurin dans <serverDir>/.java/jre-<major> (optionnel si Java incompatible)
 */
async function installPortableJava(majorVersion, serverDir = process.cwd()) {
  const osMap = { win32: 'windows', linux: 'linux', darwin: 'mac' };
  const archMap = { x64: 'x64', arm64: 'aarch64' };
  const osKey = osMap[process.platform];
  const archKey = archMap[process.arch];
  if (!osKey || !archKey) {
    throw new Error(`Architecture non prise en charge pour l'installation auto Java (${process.platform}/${process.arch}).`);
  }

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${majorVersion}/hotspot?architecture=${archKey}&image_type=jre&os=${osKey}`;
  const assets = await fetchJson(apiUrl, 12000);
  const pkgInfo = Array.isArray(assets) ? assets[0]?.binary?.package : null;
  if (!pkgInfo?.link || !pkgInfo?.name) {
    throw new Error(`Aucun package Adoptium JRE ${majorVersion} trouvé pour ${osKey}/${archKey}.`);
  }

  const javaRoot = path.join(serverDir, '.java');
  const targetDir = path.join(javaRoot, `jre-${majorVersion}`);
  const archivePath = path.join(javaRoot, pkgInfo.name);
  await fs.mkdir(javaRoot, { recursive: true });
  await downloadFile(pkgInfo.link, archivePath);

  const extractTmp = path.join(javaRoot, `extract-${majorVersion}-${Date.now()}`);
  await fs.mkdir(extractTmp, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const res = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractTmp}' -Force`], { encoding: 'utf8' });
      if (res.status !== 0) throw new Error(res.stderr || 'Extraction ZIP Java échouée.');
    } else {
      const res = spawnSync('unzip', ['-q', archivePath, '-d', extractTmp], { encoding: 'utf8' });
      if (res.status !== 0) throw new Error(res.stderr || 'Extraction ZIP Java échouée.');
    }
  } else {
    const res = spawnSync('tar', ['-xzf', archivePath, '-C', extractTmp], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(res.stderr || 'Extraction tar.gz Java échouée.');
  }

  const extractedEntries = await fs.readdir(extractTmp, { withFileTypes: true });
  const rootFolder = extractedEntries.find((e) => e.isDirectory());
  if (!rootFolder) {
    throw new Error('Archive JRE extraite vide ou inattendue.');
  }

  if (fsSync.existsSync(targetDir)) {
    await fs.rm(targetDir, { recursive: true, force: true });
  }
  await fs.rename(path.join(extractTmp, rootFolder.name), targetDir);
  await fs.rm(extractTmp, { recursive: true, force: true }).catch(() => {});
  await fs.rm(archivePath, { force: true }).catch(() => {});

  const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
  const binPath = path.join(targetDir, 'bin', exeName);
  if (!fsSync.existsSync(binPath)) {
    throw new Error(`Exécutable Java introuvable après extraction (${binPath}).`);
  }
  return { major: majorVersion, javaPath: binPath, relativePath: `.java/jre-${majorVersion}/bin/${exeName}` };
}

/**
 * Résout l'URL de téléchargement officielle de authlib-injector (API officielle + fallback GitHub Releases)
 */
async function resolveAuthlibInjectorUrl() {
  try {
    const data = await fetchJson(AUTHLIB_LATEST_API_URL, 5000);
    if (data?.download_url) return data.download_url;
  } catch {}

  const ghData = await fetchJson(AUTHLIB_GITHUB_API_URL, 5000);
  const asset = Array.isArray(ghData?.assets)
    ? ghData.assets.find((a) => String(a.name || '').endsWith('.jar'))
    : null;
  if (asset?.browser_download_url) return asset.browser_download_url;

  throw new Error('Impossible de résoudre l\'URL de téléchargement authlib-injector.');
}

async function ensureAuthlibInjector(dir = process.cwd(), { force = false } = {}) {
  const jarPath = path.resolve(dir, 'authlib-injector.jar');
  if (!force && fsSync.existsSync(jarPath)) {
    try {
      const stat = fsSync.statSync(jarPath);
      if (stat.size > 50 * 1024) return { path: jarPath, downloaded: false };
    } catch {}
  }
  const url = await resolveAuthlibInjectorUrl();
  await downloadFile(url, jarPath);
  const stat = fsSync.statSync(jarPath);
  if (stat.size < 50 * 1024) {
    throw new Error('Fichier authlib-injector.jar téléchargé invalide ou incomplet.');
  }
  return { path: jarPath, downloaded: true, url };
}

async function acceptEula(dir = process.cwd()) {
  const filePath = path.resolve(dir, 'eula.txt');
  const content = `# Par modey-server-cli (${new Date().toISOString()})\neula=true\n`;
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Valide qu'une version Minecraft existe officiellement chez Mojang
 */
async function validateMinecraftVersion(minecraftVersion) {
  const clean = String(minecraftVersion || '').trim();
  if (!clean) {
    return { valid: false, reason: 'Version Minecraft vide.' };
  }
  try {
    const manifest = await fetchJson(MOJANG_MANIFEST_URL, 8000);
    const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
    const latestRelease = manifest?.latest?.release || '1.21.1';
    const entry = versions.find((v) => v.id === clean);
    if (!entry) {
      const releases = versions.filter((v) => v.type === 'release').slice(0, 6).map((v) => v.id);
      return {
        valid: false,
        offline: false,
        latestRelease,
        suggestions: releases,
        reason: `La version Minecraft "${clean}" n'existe pas chez Mojang. Dernières versions stables : ${releases.join(', ')}.`
      };
    }
    return {
      valid: true,
      offline: false,
      latestRelease,
      entry
    };
  } catch (err) {
    return {
      valid: true,
      offline: true,
      warning: `Vérification Mojang impossible hors ligne (${err.message}).`
    };
  }
}

async function resolvePaperDownloadUrl(minecraftVersion) {
  const builds = await fetchJson(`${PAPER_API_BASE}/versions/${encodeURIComponent(minecraftVersion)}/builds`, 8000)
    .catch((err) => {
      throw new Error(`Version PaperMC ${minecraftVersion} introuvable (${err.message}).`);
    });
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error(`Aucun build PaperMC disponible pour Minecraft ${minecraftVersion}.`);
  }
  const preferred = builds.find((b) => b.channel === 'STABLE' && b.downloads?.['server:default']?.url)
    || builds.find((b) => b.downloads?.['server:default']?.url);
  const url = preferred?.downloads?.['server:default']?.url;
  if (!url) {
    throw new Error(`URL de téléchargement PaperMC introuvable pour ${minecraftVersion}.`);
  }
  return url;
}

async function resolveVanillaDownloadUrl(minecraftVersion) {
  const manifest = await fetchJson(MOJANG_MANIFEST_URL, 8000);
  const entry = (manifest.versions || []).find((v) => v.id === minecraftVersion);
  if (!entry?.url) {
    throw new Error(`Version Vanilla "${minecraftVersion}" introuvable chez Mojang.`);
  }
  const detail = await fetchJson(entry.url, 8000);
  const serverUrl = detail?.downloads?.server?.url;
  if (!serverUrl) {
    throw new Error(`Aucun server.jar disponible pour la version Vanilla "${minecraftVersion}".`);
  }
  return serverUrl;
}

/**
 * Résout le préfixe NeoForge attendu pour une version Minecraft (ex: 1.21.1 -> "21.1.", 1.20.1 -> "47.1.")
 */
function getNeoForgePrefixForMc(minecraftVersion = '1.21.1') {
  const parts = String(minecraftVersion).trim().split('.');
  if (parts.length >= 2 && parts[0] === '1') {
    if (minecraftVersion.trim() === '1.20.1') return '47.1.';
    const minor = parts[1];
    const patch = parts[2] || '0';
    return `${minor}.${patch}.`;
  }
  return '';
}

async function resolveNeoForgeVersionsForMc(minecraftVersion = '1.21.1') {
  if (compareMcVersions(minecraftVersion, '1.20.1') < 0) {
    return [];
  }
  const prefix = getNeoForgePrefixForMc(minecraftVersion);
  if (!prefix) return [];

  const endpoint = minecraftVersion.trim() === '1.20.1' ? NEOFORGE_LEGACY_1201_URL : NEOFORGE_RELEASES_URL;
  const data = await fetchJson(endpoint, 8000);
  return (data?.versions || []).filter(
    (v) => v.startsWith(prefix) && !v.includes('beta') && !v.includes('alpha')
  );
}

async function resolveLatestNeoForgeVersion(minecraftVersion = '1.21.1') {
  const fallback = minecraftVersion === '1.21.1' ? '21.1.265' : '';
  try {
    const matches = await resolveNeoForgeVersionsForMc(minecraftVersion);
    return matches.length > 0 ? matches[matches.length - 1] : fallback;
  } catch {
    return fallback;
  }
}

async function resolveForgePromotions(minecraftVersion) {
  const data = await fetchJson(FORGE_PROMOTIONS_URL, 8000);
  const promos = data?.promos || {};
  const recommended = promos[`${minecraftVersion}-recommended`] || '';
  const latest = promos[`${minecraftVersion}-latest`] || '';

  const supportedMc = [...new Set(
    Object.keys(promos)
      .map((k) => k.replace(/-(recommended|latest)$/, ''))
      .filter(Boolean)
  )];

  return { recommended, latest, defaultVersion: recommended || latest, supportedMc };
}

async function resolveLatestForgeVersion(minecraftVersion = '1.20.1') {
  try {
    const info = await resolveForgePromotions(minecraftVersion);
    return info.defaultVersion || '';
  } catch {
    return '';
  }
}

function resolveForgeInstallerUrl(minecraftVersion, forgeVersion) {
  const full = `${minecraftVersion}-${forgeVersion}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
}

async function resolveLatestFabricVersion() {
  const fallback = '0.16.9';
  try {
    const data = await fetchJson(FABRIC_LOADER_VERSIONS_URL, 8000);
    const stable = Array.isArray(data) ? data.find((x) => x.stable) || data[0] : null;
    return stable?.version || fallback;
  } catch {
    return fallback;
  }
}

function resolveFabricServerJarUrl(minecraftVersion, loaderVersion = '0.16.9', installerVersion = '1.0.1') {
  return `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}/${loaderVersion}/${installerVersion}/server/jar`;
}

function resolveNeoForgeInstallerUrl(loaderVersion = '21.1.265', minecraftVersion = '') {
  if (minecraftVersion === '1.20.1' || String(loaderVersion).startsWith('47.1.')) {
    return `https://maven.neoforged.net/releases/net/neoforged/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`;
  }
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
}

/**
 * Valide rigoureusement la compatibilité (loader × version Minecraft × version de loader)
 * Contredit clairement l'utilisateur si le couple n'existe pas !
 */
async function validateAndResolveLoader(loader, minecraftVersion, requestedVersion = '') {
  const cleanLoader = String(loader || '').trim().toLowerCase();
  const cleanMc = String(minecraftVersion || '').trim();
  const reqVer = String(requestedVersion || '').trim();

  if (cleanLoader === 'vanilla') {
    try {
      await resolveVanillaDownloadUrl(cleanMc);
      return { valid: true, loader: 'vanilla', minecraftVersion: cleanMc, loaderVersion: '', recommended: '' };
    } catch (err) {
      return { valid: false, reason: err.message };
    }
  }

  if (cleanLoader === 'paper') {
    try {
      await resolvePaperDownloadUrl(cleanMc);
      return { valid: true, loader: 'paper', minecraftVersion: cleanMc, loaderVersion: '', recommended: '' };
    } catch (err) {
      let availableHint = '';
      try {
        const proj = await fetchJson(PAPER_API_BASE, 6000);
        const flat = proj?.versions ? Object.values(proj.versions).flat() : [];
        if (flat.length > 0) {
          availableHint = ` Dernières versions PaperMC disponibles : ${flat.slice(0, 6).join(', ')}.`;
        }
      } catch {}
      return { valid: false, reason: `${err.message}${availableHint}` };
    }
  }

  if (cleanLoader === 'fabric') {
    try {
      const [games, loaders] = await Promise.all([
        fetchJson(FABRIC_GAME_VERSIONS_URL, 8000),
        fetchJson(FABRIC_LOADER_VERSIONS_URL, 8000)
      ]);
      const gameOk = Array.isArray(games) && games.some((g) => g.version === cleanMc);
      if (!gameOk) {
        const latestGames = (Array.isArray(games) ? games.filter((g) => g.stable).slice(0, 5).map((g) => g.version) : []);
        return {
          valid: false,
          reason: `Fabric n'existe pas pour Minecraft ${cleanMc} (disponible à partir de 1.14). Exemples supportés : ${latestGames.join(', ')}.`
        };
      }
      const validLoaderList = Array.isArray(loaders) ? loaders.map((l) => l.version) : [];
      const recommended = (Array.isArray(loaders) ? (loaders.find((l) => l.stable) || loaders[0])?.version : '') || '0.16.9';
      if (reqVer && validLoaderList.length > 0 && !validLoaderList.includes(reqVer)) {
        return {
          valid: false,
          recommended,
          reason: `Version Fabric Loader "${reqVer}" introuvable. Recommandée : ${recommended}.`
        };
      }
      return { valid: true, loader: 'fabric', minecraftVersion: cleanMc, loaderVersion: reqVer || recommended, recommended };
    } catch (err) {
      return { valid: true, offline: true, loader: 'fabric', minecraftVersion: cleanMc, loaderVersion: reqVer || '0.16.9', recommended: '0.16.9', warning: err.message };
    }
  }

  if (cleanLoader === 'neoforge') {
    if (compareMcVersions(cleanMc, '1.20.1') < 0) {
      return {
        valid: false,
        reason: `NeoForge n'existe pas pour Minecraft ${cleanMc} (NeoForge commence à partir de 1.20.1). Utilisez Forge classique pour ${cleanMc} !`
      };
    }
    try {
      const matches = await resolveNeoForgeVersionsForMc(cleanMc);
      if (matches.length === 0) {
        return {
          valid: false,
          reason: `Aucune release NeoForge trouvée pour Minecraft ${cleanMc}. Essayez Forge ou une autre version MC (ex: 1.21.1, 1.20.4, 1.20.1).`
        };
      }
      const recommended = matches[matches.length - 1];
      if (reqVer && !matches.includes(reqVer)) {
        return {
          valid: false,
          recommended,
          reason: `La version NeoForge "${reqVer}" n'existe pas pour Minecraft ${cleanMc}. Dernière recommandée : ${recommended} (ex: ${matches.slice(-3).join(', ')}).`
        };
      }
      return { valid: true, loader: 'neoforge', minecraftVersion: cleanMc, loaderVersion: reqVer || recommended, recommended };
    } catch (err) {
      return { valid: true, offline: true, loader: 'neoforge', minecraftVersion: cleanMc, loaderVersion: reqVer || '21.1.265', recommended: '21.1.265', warning: err.message };
    }
  }

  if (cleanLoader === 'forge') {
    try {
      const promoInfo = await resolveForgePromotions(cleanMc);
      if (!promoInfo.defaultVersion) {
        return {
          valid: false,
          reason: `Forge n'a aucune build officielle pour Minecraft ${cleanMc}. Vérifiez le numéro de version (ex: 1.20.1, 1.19.2, 1.16.5, 1.12.2).`
        };
      }
      const targetVer = reqVer || promoInfo.defaultVersion;
      if (reqVer && reqVer !== promoInfo.recommended && reqVer !== promoInfo.latest) {
        // Vérifier dans maven-metadata.xml si une version Forge spécifique saisie à la main existe réellement
        try {
          const metaXml = await fetchText(FORGE_MAVEN_META_URL, 8000);
          const expectedTag = `<version>${cleanMc}-${reqVer}</version>`;
          if (!metaXml.includes(expectedTag)) {
            return {
              valid: false,
              recommended: promoInfo.defaultVersion,
              reason: `Version Forge "${reqVer}" introuvable pour Minecraft ${cleanMc}. Recommandée : ${promoInfo.defaultVersion}${promoInfo.latest && promoInfo.latest !== promoInfo.recommended ? ` (ou latest: ${promoInfo.latest})` : ''}.`
            };
          }
        } catch {}
      }
      return {
        valid: true,
        loader: 'forge',
        minecraftVersion: cleanMc,
        loaderVersion: targetVer,
        recommended: promoInfo.defaultVersion
      };
    } catch (err) {
      if (reqVer) {
        return { valid: true, offline: true, loader: 'forge', minecraftVersion: cleanMc, loaderVersion: reqVer, recommended: reqVer, warning: err.message };
      }
      return { valid: false, reason: `Impossible de contacter les serveurs Forge (${err.message}).` };
    }
  }

  return { valid: false, reason: `Type de serveur "${loader}" inconnu.` };
}

/**
 * Télécharge directement depuis Modrinth les mods client-only d'un preset dans client-files/<slot>/mods
 * (hébergé localement par le serveur créateur, rien chez Modey).
 */
async function installModrinthClientPreset({
  serverDir = process.cwd(),
  mcVersion = '1.21.1',
  loader = 'fabric',
  presetId = 'fabric-shaders',
  targetSlot = 'required'
} = {}) {
  const preset = CLIENT_PRESETS[presetId];
  if (!preset || !Array.isArray(preset.projects) || preset.projects.length === 0) {
    return { installed: [], skipped: [] };
  }

  const effectiveLoader = loader === 'paper' || loader === 'vanilla' ? preset.loader : loader;
  let slugs = [...preset.projects];

  // Avant MC 1.21 sur Fabric, Iris + Sodium nécessitent Indium
  if (effectiveLoader === 'fabric' && presetId === 'fabric-shaders' && compareMcVersions(mcVersion, '1.21') < 0 && !slugs.includes('indium')) {
    slugs.push('indium');
  }
  // Pour NeoForge shaders : tenter Sodium+Iris en 1.21+ sinon Embeddium+Oculus
  if (effectiveLoader === 'neoforge' && presetId === 'neoforge-shaders') {
    slugs = compareMcVersions(mcVersion, '1.21') >= 0
      ? ['sodium', 'iris']
      : ['embeddium', 'oculus'];
  }

  const destDir = path.resolve(serverDir, 'client-files', targetSlot, 'mods');
  await fs.mkdir(destDir, { recursive: true });

  const installed = [];
  const skipped = [];

  for (const slug of slugs) {
    try {
      const apiUrl = `${MODRINTH_API_BASE}/project/${encodeURIComponent(slug)}/version?game_versions=${encodeURIComponent(JSON.stringify([mcVersion]))}&loaders=${encodeURIComponent(JSON.stringify([effectiveLoader]))}`;
      const versions = await fetchJson(apiUrl, 8000);
      const latest = Array.isArray(versions) ? versions[0] : null;
      const primaryFile = latest?.files?.find((f) => f.primary) || latest?.files?.[0];
      if (!primaryFile?.url || !primaryFile?.filename) {
        skipped.push({ slug, reason: `Aucune build ${effectiveLoader} ${mcVersion}` });
        continue;
      }
      const destFile = path.join(destDir, primaryFile.filename);
      if (!fsSync.existsSync(destFile)) {
        await downloadFile(primaryFile.url, destFile);
      }
      installed.push({ slug, filename: primaryFile.filename, version: latest.version_number });
    } catch (err) {
      skipped.push({ slug, reason: err.message });
    }
  }

  return { installed, skipped, destDir };
}

module.exports = {
  AUTHLIB_LATEST_API_URL,
  AUTHLIB_GITHUB_API_URL,
  CLIENT_PRESETS,
  downloadFile,
  compareMcVersions,
  getMinimumJavaVersionForMc,
  checkJavaCompatibility,
  installPortableJava,
  validateMinecraftVersion,
  validateAndResolveLoader,
  resolveAuthlibInjectorUrl,
  ensureAuthlibInjector,
  acceptEula,
  resolvePaperDownloadUrl,
  resolveVanillaDownloadUrl,
  getNeoForgePrefixForMc,
  resolveLatestNeoForgeVersion,
  resolveLatestForgeVersion,
  resolveForgeInstallerUrl,
  resolveLatestFabricVersion,
  resolveFabricServerJarUrl,
  resolveNeoForgeInstallerUrl,
  installModrinthClientPreset
};
