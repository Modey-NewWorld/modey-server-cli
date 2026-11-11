/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
      if (entry.name === 'distribution.json' || entry.name === '.modey-manifest.json') continue;
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

function buildClientFilesManifest(clientFilesDir, publicBaseUrl, slug = 'server') {
  const cleanBase = String(publicBaseUrl || '').replace(/\/+$/, '');
  const emptyManifest = {
    success: true,
    slug,
    slots: ['mods', 'config', 'shaderpacks', 'resourcepacks', 'saves', 'defaultconfigs', 'optional-mods'],
    defaultFolders: ['mods', 'config', 'shaderpacks', 'resourcepacks', 'saves', 'defaultconfigs'],
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
    url: f.url,
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

  return {
    success: true,
    slug,
    version: distConfig.version || '1.0.0',
    slots: emptyManifest.slots,
    defaultFolders: emptyManifest.defaultFolders,
    cleaningIgnored: Array.isArray(distConfig.cleaningIgnored) ? distConfig.cleaningIgnored : [],
    count: requiredFiles.length,
    files: requiredFiles,
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
  const host = req?.headers?.host || '127.0.0.1:3008';
  const proto = req?.headers?.['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function createUpdaterRequestHandler({ serverDir = process.cwd(), slug = 'server', publicUrl = '' } = {}) {
  const clientFilesDir = path.resolve(serverDir, 'client-files');

  return (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');

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

    const reqPath = (req.url || '/').split('?')[0];

    if (reqPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'modey-files-updater', slug }));
      return;
    }

    if (reqPath === '/files-updater' || reqPath.startsWith('/files-updater/')) {
      const baseUrl = normalizePublicBaseUrl(publicUrl, req);
      const manifest = buildClientFilesManifest(clientFilesDir, baseUrl, slug);
      const payload = JSON.stringify(manifest);
      const hash = crypto.createHash('md5').update(payload).digest('hex');
      const etag = `"${hash}"`;

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      const clientEtag = req.headers['if-none-match'];
      if (clientEtag && (clientEtag === etag || clientEtag === `W/${etag}` || clientEtag === hash)) {
        res.writeHead(304);
        res.end();
        return;
      }

      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : payload);
      return;
    }

    if (reqPath.startsWith('/files/')) {
      let decodedRel = '';
      try {
        decodedRel = decodeURIComponent(reqPath.slice('/files/'.length));
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid path encoding' }));
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

      const stats = fs.statSync(resolvedFile);
      if (!stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not a file' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stats.size,
        'Last-Modified': stats.mtime.toUTCString(),
        'Cache-Control': 'public, max-age=300'
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(resolvedFile);
      stream.on('error', () => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Not Found' }));
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
  createUpdaterRequestHandler,
  startUpdaterServer
};
