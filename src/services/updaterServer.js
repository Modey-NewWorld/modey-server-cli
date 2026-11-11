/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  resolveEffectiveClientConfig,
  verifyAccessPassword,
  isPasswordRequiredForConfig
} = require('../config.js');

const sha1Cache = new Map(); // fullPath -> { size, mtimeMs, sha1 }

function computeSha1Cached(filePath, stats) {
  const cached = sha1Cache.get(filePath);
  if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
    return cached.sha1;
  }
  const buf = fs.readFileSync(filePath);
  const sha1 = crypto.createHash('sha1').update(buf).digest('hex');
  sha1Cache.set(filePath, { size: stats.size, mtimeMs: stats.mtimeMs, sha1 });
  return sha1;
}

function detectFileType(relPath, filename) {
  const lowerPath = relPath.toLowerCase();
  const lowerName = filename.toLowerCase();
  if (lowerPath.includes('optional-mods') || lowerPath.includes('optional_mods')) return 'OPTIONAL_MOD';
  if (lowerPath.includes('mods')) return 'MOD';
  if (lowerPath.includes('config') || lowerPath.includes('defaultconfigs')) return 'CONFIG';
  if (lowerPath.includes('shaderpacks')) return 'SHADERPACK';
  if (lowerPath.includes('resourcepacks')) return 'RESOURCEPACK';
  if (lowerName.endsWith('.jar')) return 'MOD';
  if (lowerName.endsWith('.json') || lowerName.endsWith('.toml') || lowerName.endsWith('.txt')) return 'CONFIG';
  if (lowerName.endsWith('.zip')) return 'ARCHIVE';
  return 'FILE';
}

function encodeUrlPath(relUrlPath) {
  return relUrlPath
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function scanDirectory(baseDir, currentRel, baseUrl, urlPrefix = '') {
  const targetDir = path.join(baseDir, currentRel);
  if (!fs.existsSync(targetDir)) return [];

  let results = [];
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  for (const entry of entries) {
    const relItemPath = path.join(currentRel, entry.name).replace(/\\/g, '/');
    const fullItemPath = path.join(baseDir, currentRel, entry.name);

    if (entry.isDirectory()) {
      results = results.concat(scanDirectory(baseDir, relItemPath, baseUrl, urlPrefix));
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.') || entry.name === 'distribution.json' || entry.name === '.modey-manifest.json') continue;
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
      const stats = fs.statSync(fullItemPath);
      const sha1 = computeSha1Cached(fullItemPath, stats);
      const destDir = path.dirname(relItemPath);
      const destPath = destDir === '.' ? '' : `${destDir}/`;
      const subfolder = destDir === '.' ? 'root' : destDir.split('/')[0];
      const downloadPath = urlPrefix ? `${urlPrefix}/${relItemPath}` : relItemPath;

      results.push({
        name: entry.name,
        path: destPath,
        subfolder,
        fullRelPath: downloadPath,
        url: `${baseUrl}/files/${encodeUrlPath(downloadPath)}`,
        sha1,
        size: stats.size,
        type: detectFileType(destPath, entry.name),
        updatedAt: stats.mtime
      });
    }
  }
  return results;
}

function appendQueryToken(url, token) {
  if (!url || !token) return url;
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function buildClientFilesManifest(clientFilesDir, publicBaseUrl, slug = 'server', serverMeta = null, { accessToken = '' } = {}) {
  const cleanBase = String(publicBaseUrl || '').replace(/\/+$/, '');
  const hasModsInMeta = Boolean(serverMeta?.hasClientMods);
  const defaultSlots = hasModsInMeta
    ? ['mods', 'config', 'shaderpacks', 'resourcepacks', 'saves', 'defaultconfigs', 'optional-mods']
    : ['shaderpacks', 'resourcepacks', 'saves'];
  const defaultFolders = hasModsInMeta
    ? ['mods', 'config', 'shaderpacks', 'resourcepacks', 'saves', 'defaultconfigs']
    : ['shaderpacks', 'resourcepacks', 'saves'];

  const metaFields = serverMeta ? {
    ...(serverMeta.minecraftVersion ? { minecraftVersion: serverMeta.minecraftVersion } : {}),
    ...(serverMeta.loader ? { loader: serverMeta.loader } : {}),
    ...(serverMeta.loaderVersion !== undefined ? { loaderVersion: serverMeta.loaderVersion } : {}),
    ...(serverMeta.serverLoader ? { serverLoader: serverMeta.serverLoader } : {}),
    ...(serverMeta.serverLoaderVersion !== undefined ? { serverLoaderVersion: serverMeta.serverLoaderVersion } : {}),
    allowClientChoice: Boolean(serverMeta.allowClientChoice),
    availableClientPresets: serverMeta.availableClientPresets || [],
    defaultClientPreset: serverMeta.defaultClientPreset || 'vanilla',
    hasClientMods: hasModsInMeta
  } : {};

  const emptyManifest = {
    success: true,
    slug,
    ...metaFields,
    slots: defaultSlots,
    defaultFolders,
    cleaningIgnored: [],
    count: 0,
    files: [],
    optional: { mods: [], shaderpacks: [], resourcepacks: [] },
    optionalMods: []
  };

  if (!clientFilesDir || !fs.existsSync(clientFilesDir)) {
    return emptyManifest;
  }

  let distConfig = { version: '1.0.0', cleaningIgnored: [] };
  const distFile = path.join(clientFilesDir, 'distribution.json');
  if (fs.existsSync(distFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(distFile, 'utf-8'));
      distConfig = { ...distConfig, ...parsed };
    } catch (_) {}
  }

  const requiredDir = path.join(clientFilesDir, 'required');
  const optionalDir = path.join(clientFilesDir, 'optional');
  const hasRequired = fs.existsSync(requiredDir) && fs.statSync(requiredDir).isDirectory();
  const hasOptional = fs.existsSync(optionalDir) && fs.statSync(optionalDir).isDirectory();

  let requiredFiles = [];
  const optionalMods = [];
  const optionalShaders = [];
  const optionalResources = [];

  const toOptionalItem = (f, category) => ({
    id: f.name.replace(/\.(jar|zip|disabled)$/i, ''),
    name: f.name,
    category,
    path: `${category}/`,
    subfolder: category,
    fullRelPath: f.fullRelPath,
    url: appendQueryToken(f.url, accessToken),
    sha1: f.sha1,
    size: f.size,
    updatedAt: f.updatedAt
  });

  if (hasRequired) {
    requiredFiles = scanDirectory(requiredDir, '', cleanBase, 'required');
    if (hasOptional) {
      const optFiles = scanDirectory(optionalDir, '', cleanBase, 'optional');
      for (const f of optFiles) {
        if (f.subfolder === 'shaderpacks') optionalShaders.push(toOptionalItem(f, 'shaderpacks'));
        else if (f.subfolder === 'resourcepacks') optionalResources.push(toOptionalItem(f, 'resourcepacks'));
        else optionalMods.push(toOptionalItem(f, f.subfolder === 'mods' ? 'mods' : 'mods'));
      }
    }
  } else {
    const allFiles = scanDirectory(clientFilesDir, '', cleanBase, '');
    for (const f of allFiles) {
      if (f.subfolder === 'optional-mods' || f.subfolder === 'optional_mods') {
        optionalMods.push(toOptionalItem(f, 'mods'));
      } else if (f.subfolder === 'optional-shaderpacks') {
        optionalShaders.push(toOptionalItem(f, 'shaderpacks'));
      } else if (f.subfolder === 'optional-resourcepacks') {
        optionalResources.push(toOptionalItem(f, 'resourcepacks'));
      } else {
        requiredFiles.push(f);
      }
    }
  }

  const signedRequiredFiles = accessToken
    ? requiredFiles.map((f) => ({ ...f, url: appendQueryToken(f.url, accessToken) }))
    : requiredFiles;

  const hasMods = Boolean(serverMeta?.hasClientMods) ||
    signedRequiredFiles.some((f) => String(f.path || '').startsWith('mods') || f.subfolder === 'mods') ||
    optionalMods.length > 0;

  return {
    success: true,
    slug,
    version: distConfig.version || '1.0.0',
    ...(serverMeta?.minecraftVersion ? { minecraftVersion: serverMeta.minecraftVersion } : {}),
    ...(serverMeta?.loader ? { loader: serverMeta.loader } : {}),
    ...(serverMeta?.loaderVersion !== undefined ? { loaderVersion: serverMeta.loaderVersion } : {}),
    ...(serverMeta?.serverLoader ? { serverLoader: serverMeta.serverLoader } : {}),
    ...(serverMeta?.serverLoaderVersion !== undefined ? { serverLoaderVersion: serverMeta.serverLoaderVersion } : {}),
    ...(serverMeta ? {
      allowClientChoice: Boolean(serverMeta.allowClientChoice),
      availableClientPresets: serverMeta.availableClientPresets || [],
      defaultClientPreset: serverMeta.defaultClientPreset || 'vanilla',
      hasClientMods: hasMods
    } : {}),
    slots: emptyManifest.slots,
    defaultFolders: emptyManifest.defaultFolders,
    cleaningIgnored: Array.isArray(distConfig.cleaningIgnored) ? distConfig.cleaningIgnored : [],
    count: signedRequiredFiles.length,
    files: signedRequiredFiles,
    optional: {
      mods: optionalMods,
      shaderpacks: optionalShaders,
      resourcepacks: optionalResources
    },
    optionalMods
  };
}

function normalizePublicBaseUrl(publicUrl, req) {
  if (publicUrl && String(publicUrl).trim()) {
    return String(publicUrl).trim().replace(/\/files-updater\/?$/i, '').replace(/\/+$/, '');
  }
  const rawHost = String(req?.headers?.host || '127.0.0.1:3008').trim();
  const safeHost = /^[a-z0-9.\-:\[\]]+$/i.test(rawHost) ? rawHost : '127.0.0.1:3008';
  const rawProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const safeProto = rawProto === 'https' ? 'https' : 'http';
  return `${safeProto}://${safeHost}`;
}

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

function getImageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'image/png';
}

function readServerConfigSafe(serverDir) {
  try {
    const cfgPath = path.join(serverDir, 'modey-server.json');
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch (_) {}
  return null;
}

function resolveUpdaterAuthState(cfg = null) {
  const passwordHash = String(cfg?.auth?.private_password_hash || '').trim();
  const passwordRequired = Boolean(passwordHash || isPasswordRequiredForConfig(cfg));
  const passwordVersion = String(cfg?.auth?.private_password_version || '').trim() || (passwordHash ? 'v1' : 'unset');
  return {
    protected: passwordRequired,
    passwordHash,
    passwordVersion
  };
}

function deriveTokenHmacKey(passwordHash, passwordVersion) {
  return crypto.createHash('sha256').update(`modey-updater-token:${passwordHash}:${passwordVersion}`).digest();
}

function createAccessToken(passwordHash, passwordVersion, ttlMs = 3600 * 1000) {
  if (!passwordHash) return '';
  const exp = Date.now() + ttlMs;
  const key = deriveTokenHmacKey(passwordHash, passwordVersion);
  const sig = crypto.createHmac('sha256', key).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function verifyAccessToken(token, passwordHash, passwordVersion) {
  if (!token || !passwordHash) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [expStr, sigHex] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  if (!/^[a-f0-9]+$/i.test(sigHex)) return false;
  const key = deriveTokenHmacKey(passwordHash, passwordVersion);
  const expectedSig = crypto.createHmac('sha256', key).update(expStr).digest('hex');
  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isRequestAuthorized(req, urlObj, cfg, { allowQueryToken = false } = {}) {
  const authState = resolveUpdaterAuthState(cfg);
  if (!authState.protected) {
    return { authorized: true, protected: false, authState, accessToken: '' };
  }

  const headerPwd = String(req?.headers?.['x-modey-server-password'] || '');
  if (headerPwd && verifyAccessPassword(headerPwd, authState.passwordHash)) {
    return {
      authorized: true,
      protected: true,
      authState,
      accessToken: createAccessToken(authState.passwordHash, authState.passwordVersion)
    };
  }

  if (allowQueryToken && urlObj) {
    const token = urlObj.searchParams.get('token') || '';
    if (token && verifyAccessToken(token, authState.passwordHash, authState.passwordVersion)) {
      return {
        authorized: true,
        protected: true,
        authState,
        accessToken: token
      };
    }
  }

  return { authorized: false, protected: true, authState, accessToken: '' };
}

function resolveVisualAssetFile(serverDir, kind, config = null) {
  const cfg = config || readServerConfigSafe(serverDir) || {};
  const visuals = cfg.visuals || {};
  const explicitRaw = kind === 'banner'
    ? (visuals.banner_path || visuals.banner_url || '')
    : (visuals.icon_path || visuals.icon_url || '');

  const cleanExplicit = String(explicitRaw || '').trim();
  if (/^https?:\/\//i.test(cleanExplicit) || cleanExplicit.startsWith('data:')) {
    return null;
  }

  const rootPrefix = path.resolve(serverDir) + path.sep;
  const candidates = [];
  if (cleanExplicit) {
    candidates.push(cleanExplicit);
  }
  if (kind === 'banner') {
    candidates.push(
      'visuals/banner.png', 'visuals/banner.jpg', 'visuals/banner.jpeg', 'visuals/banner.webp',
      'banner.png', 'banner.jpg', 'banner.jpeg', 'banner.webp'
    );
  } else {
    candidates.push(
      'visuals/icon.png', 'visuals/icon.jpg', 'visuals/icon.jpeg', 'visuals/icon.webp',
      'icon.png', 'icon.jpg', 'server-icon.png'
    );
  }

  let realRoot = '';
  try {
    realRoot = fs.realpathSync(serverDir);
  } catch (_) {
    return null;
  }
  const realRootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;

  for (const rel of candidates) {
    if (!rel || String(rel).includes('\0')) continue;
    const ext = path.extname(String(rel)).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) continue;
    const resolved = path.resolve(serverDir, rel);
    if (!resolved.startsWith(rootPrefix)) continue;
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const realAsset = fs.realpathSync(resolved);
        if (!realAsset.startsWith(realRootPrefix)) continue;
        return { path: realAsset, mimeType: getImageMimeType(realAsset) };
      }
    } catch (_) {}
  }
  return null;
}

function resolveLocalVisualUrls(serverDir, baseUrl, config = null) {
  const cfg = config || readServerConfigSafe(serverDir) || {};
  const visuals = cfg.visuals || {};
  const cleanBase = String(baseUrl || '').replace(/\/files-updater\/?$/i, '').replace(/\/+$/, '');

  const resolveField = (kind, rawVal) => {
    const clean = String(rawVal || '').trim();
    if (/^https?:\/\//i.test(clean) || clean.startsWith('data:')) return clean;
    if (cleanBase && resolveVisualAssetFile(serverDir, kind, cfg)) {
      return `${cleanBase}/assets/${kind}`;
    }
    return clean;
  };

  return {
    bannerUrl: resolveField('banner', visuals.banner_path || visuals.banner_url),
    iconUrl: resolveField('icon', visuals.icon_path || visuals.icon_url)
  };
}

function buildServerMetaPayload(serverDir, baseUrl, fallbackSlug = 'server', { unlocked = true, accessToken = '' } = {}) {
  const cfg = readServerConfigSafe(serverDir) || {};
  const authState = resolveUpdaterAuthState(cfg);
  const slug = cfg.identity?.slug || cfg.slug || fallbackSlug;
  const name = cfg.launcher?.display_name || cfg.identity?.name || cfg.name || slug;
  const cleanBase = String(baseUrl || '').replace(/\/files-updater\/?$/i, '').replace(/\/+$/, '');
  const updaterUrl = cfg.modpack?.public_updater_url || (cleanBase ? `${cleanBase}/files-updater` : '');

  if (authState.protected && !unlocked) {
    return {
      success: true,
      slug,
      name,
      requiresPassword: true,
      unlocked: false,
      passwordVersion: authState.passwordVersion,
      updaterUrl
    };
  }

  const visuals = resolveLocalVisualUrls(serverDir, baseUrl, cfg);
  const serverLoader = cfg.game?.loader || cfg.identity?.loader || 'neoforge';
  const serverLoaderVersion = cfg.game?.loader_version || cfg.identity?.loader_version || '';
  const clientCfg = resolveEffectiveClientConfig(cfg);
  const signVisual = (u) => (u && accessToken && cleanBase && u.startsWith(cleanBase))
    ? appendQueryToken(u, accessToken)
    : (u || '');

  return {
    success: true,
    slug,
    name,
    requiresPassword: authState.protected,
    ...(authState.protected ? { unlocked: true, passwordVersion: authState.passwordVersion } : {}),
    description: cfg.launcher?.description || cfg.launcherOptions?.description || '',
    tags: Array.isArray(cfg.launcher?.tags) ? cfg.launcher.tags : (Array.isArray(cfg.launcherOptions?.tags) ? cfg.launcherOptions.tags : []),
    minecraftVersion: cfg.game?.minecraft_version || cfg.identity?.minecraft_version || '1.21.1',
    serverLoader,
    serverLoaderVersion,
    loader: clientCfg.loader,
    loaderVersion: clientCfg.loader_version,
    clientMode: clientCfg.mode,
    allowClientChoice: Boolean(clientCfg.allow_client_choice),
    availableClientPresets: Array.isArray(clientCfg.available_presets) ? clientCfg.available_presets : [],
    defaultClientPreset: clientCfg.default_preset || 'vanilla',
    hasClientMods: Boolean(clientCfg.has_mods),
    port: Number(cfg.game?.port || cfg.network?.port || 25565),
    motd: cfg.identity?.motd || '',
    bannerUrl: signVisual(visuals.bannerUrl),
    iconUrl: signVisual(visuals.iconUrl),
    updaterUrl,
    ...(authState.protected && accessToken && updaterUrl ? { signedUpdaterUrl: appendQueryToken(updaterUrl, accessToken) } : {})
  };
}

function createUpdaterRequestHandler({ serverDir = process.cwd(), slug = 'server', publicUrl = '' } = {}) {
  const clientFilesDir = path.resolve(serverDir, 'client-files');

  return (req, res) => {
    try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match, X-Modey-Server-Password');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }));
      return;
    }

    const rawUrl = req.url || '/';
    const reqUrl = new URL(rawUrl, 'http://127.0.0.1');
    const reqPath = rawUrl.split('?')[0];
    const cfg = readServerConfigSafe(serverDir) || {};
    const authState = resolveUpdaterAuthState(cfg);

    if (reqPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        service: 'modey-files-updater',
        slug,
        requiresPassword: authState.protected
      }));
      return;
    }

    if (reqPath === '/server-meta') {
      const authCheck = isRequestAuthorized(req, reqUrl, cfg, { allowQueryToken: false });
      const baseUrl = normalizePublicBaseUrl(publicUrl, req);
      const meta = buildServerMetaPayload(serverDir, baseUrl, slug, {
        unlocked: authCheck.authorized,
        accessToken: authCheck.accessToken
      });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': authCheck.protected ? 'private, no-store' : 'public, max-age=15'
      });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(meta));
      return;
    }

    if (reqPath === '/assets/banner' || reqPath === '/assets/icon') {
      const authCheck = isRequestAuthorized(req, reqUrl, cfg, { allowQueryToken: true });
      if (!authCheck.authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
        res.end(JSON.stringify({
          success: false,
          error: 'PASSWORD_REQUIRED',
          requiresPassword: true,
          passwordVersion: authCheck.authState.passwordVersion
        }));
        return;
      }
      const kind = reqPath === '/assets/banner' ? 'banner' : 'icon';
      const asset = resolveVisualAssetFile(serverDir, kind);
      if (!asset) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Asset not found' }));
        return;
      }
      const stats = fs.statSync(asset.path);
      res.writeHead(200, {
        'Content-Type': asset.mimeType,
        'Content-Length': stats.size,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': authCheck.protected ? 'private, no-store' : 'public, max-age=300'
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(asset.path).pipe(res);
      return;
    }

    if (reqPath === '/files-updater' || reqPath.startsWith('/files-updater/')) {
      const authCheck = isRequestAuthorized(req, reqUrl, cfg, { allowQueryToken: true });
      if (!authCheck.authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
        res.end(JSON.stringify({
          success: false,
          error: 'PASSWORD_REQUIRED',
          requiresPassword: true,
          passwordVersion: authCheck.authState.passwordVersion
        }));
        return;
      }
      const baseUrl = normalizePublicBaseUrl(publicUrl, req);
      const serverMeta = buildServerMetaPayload(serverDir, baseUrl, slug, {
        unlocked: true,
        accessToken: authCheck.accessToken
      });
      const manifest = buildClientFilesManifest(clientFilesDir, baseUrl, slug, serverMeta, {
        accessToken: authCheck.accessToken
      });
      const payload = JSON.stringify(manifest);
      const hash = crypto.createHash('md5').update(payload).digest('hex');
      const etag = `"${hash}"`;

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', authCheck.protected ? 'private, no-store' : 'public, max-age=15, stale-while-revalidate=60');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      if (!authCheck.protected) {
        const clientEtag = req.headers['if-none-match'];
        if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}` || clientEtag === hash)) {
          res.writeHead(304);
          res.end();
          return;
        }
      }

      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }

    if (reqPath.startsWith('/files/')) {
      const authCheck = isRequestAuthorized(req, reqUrl, cfg, { allowQueryToken: true });
      if (!authCheck.authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
        res.end(JSON.stringify({
          success: false,
          error: 'PASSWORD_REQUIRED',
          requiresPassword: true,
          passwordVersion: authCheck.authState.passwordVersion
        }));
        return;
      }
      let decodedRel = '';
      try {
        decodedRel = decodeURIComponent(reqPath.slice('/files/'.length));
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid path encoding' }));
        return;
      }

      if (!decodedRel || decodedRel.includes('\0') || decodedRel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
        return;
      }

      const resolvedFile = path.resolve(clientFilesDir, decodedRel);
      const rootPrefix = clientFilesDir.endsWith(path.sep) ? clientFilesDir : clientFilesDir + path.sep;
      if (!resolvedFile.startsWith(rootPrefix)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
        return;
      }

      if (!fs.existsSync(resolvedFile)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'File not found' }));
        return;
      }

      let realClientRoot = '';
      let realTargetFile = '';
      try {
        realClientRoot = fs.realpathSync(clientFilesDir);
        realTargetFile = fs.realpathSync(resolvedFile);
      } catch (_) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'File not found' }));
        return;
      }
      const realRootPrefix = realClientRoot.endsWith(path.sep) ? realClientRoot : realClientRoot + path.sep;
      if (!realTargetFile.startsWith(realRootPrefix)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Forbidden' }));
        return;
      }

      const stats = fs.statSync(realTargetFile);
      if (!stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not a file' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Last-Modified': stats.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=300'
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(realTargetFile);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not Found' }));
    } catch (_) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ success: false, error: 'Internal Server Error' }));
    }
  };
}

function startUpdaterServer({
  serverDir = process.cwd(),
  port = 3008,
  host = '0.0.0.0',
  slug = 'server',
  publicUrl = ''
} = {}) {
  const handler = createUpdaterRequestHandler({ serverDir, slug, publicUrl });
  const server = http.createServer(handler);
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const addr = server.address();
      const boundPort = addr && typeof addr === 'object' ? addr.port : port;
      resolve({
        server,
        port: boundPort,
        url: publicUrl ? `${normalizePublicBaseUrl(publicUrl)}/files-updater` : `http://127.0.0.1:${boundPort}/files-updater`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}

module.exports = {
  buildClientFilesManifest,
  buildServerMetaPayload,
  resolveLocalVisualUrls,
  resolveVisualAssetFile,
  createUpdaterRequestHandler,
  startUpdaterServer
};
