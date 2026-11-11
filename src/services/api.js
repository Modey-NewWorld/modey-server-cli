/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const pkg = require('../../package.json');

/**
 * Service de communication HTTP vers la plateforme centrale Modey
 */
class ModeyApiClient {
  constructor(baseUrl, nodeToken = '') {
    this.baseUrl = (baseUrl || 'https://api.modey.flowcrea.fr').replace(/\/+$/, '');
    this.nodeToken = nodeToken;
    this.cliVersion = pkg.version;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'x-modey-cli-version': this.cliVersion,
      ...(this.nodeToken ? { 'x-node-token': this.nodeToken } : {})
    };
  }

  /**
   * Récupère la politique de version CLI & état de blocage depuis Modey
   */
  async getCliPolicy(slug = '', timeoutMs = 3500) {
    const qs = new URLSearchParams({
      version: this.cliVersion,
      ...(slug ? { slug } : {})
    });
    const res = await fetch(`${this.baseUrl}/api/nodes/cli-policy?${qs.toString()}`, {
      headers: { 'x-modey-cli-version': this.cliVersion },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erreur politique CLI HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Confirme la liaison du serveur avec Auth via le jeton fourni par l'administration Modey
   */
  async linkNode(token, payload = {}) {
    const res = await fetch(`${this.baseUrl}/api/nodes/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-modey-cli-version': this.cliVersion,
        'x-node-token': token
      },
      body: JSON.stringify({
        token,
        cliVersion: this.cliVersion,
        ...payload
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Erreur liaison HTTP ${res.status}`);
      err.status = res.status;
      err.cliPolicy = data.cliPolicy;
      err.blocked = Boolean(data.blocked);
      throw err;
    }
    return data;
  }

  /**
   * Envoi du heartbeat de télémétrie vers /api/nodes/heartbeat
   */
  async sendHeartbeat(payload) {
    const url = `${this.baseUrl}/api/nodes/heartbeat`;
    const cleanPayload = {
      ...payload,
      slug: payload.slug || payload.server_slug,
      server_slug: payload.server_slug || payload.slug,
      token: payload.token || this.nodeToken,
      node_token: payload.node_token || this.nodeToken,
      cliVersion: this.cliVersion,
      cli_version: this.cliVersion
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(cleanPayload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Erreur Heartbeat HTTP ${res.status}`);
      err.status = res.status;
      err.blocked = Boolean(data.blocked);
      err.cliPolicy = data.cliPolicy;
      throw err;
    }
    return data;
  }

  /**
   * Synchronisation du manifeste modey-server.json vers /api/nodes/sync-metadata
   */
  async syncMetadata(serverSlug, manifest) {
    const url = `${this.baseUrl}/api/nodes/sync-metadata`;
    const modpack = manifest?.modpack || {};
    const updaterPort = modpack.enabled !== false ? Number(modpack.updater_port || 0) || undefined : undefined;
    const updaterUrl = modpack.public_updater_url ? String(modpack.public_updater_url).trim() : undefined;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.nodeToken ? { 'x-node-token': this.nodeToken } : {})
      },
      body: JSON.stringify({
        slug: serverSlug,
        server_slug: serverSlug,
        token: this.nodeToken,
        node_token: this.nodeToken,
        updater_port: updaterPort,
        updater_url: updaterUrl,
        manifest: {
          ...manifest,
          id: serverSlug,
          slug: serverSlug,
          updater_port: updaterPort,
          updater_url: updaterUrl
        }
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erreur Sync Métadonnées HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Consultation du statut live d'un nœud
   */
  async getStatus(serverSlug) {
    const url = `${this.baseUrl}/api/nodes/status/${encodeURIComponent(serverSlug)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erreur Statut HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Vérification de session joueur (Launch Guard)
   */
  async verifySession(serverSlug, { username, uuid, clientHash }) {
    const url = `${this.baseUrl}/api/nodes/verify-session`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.nodeToken ? { 'x-node-token': this.nodeToken } : {})
      },
      body: JSON.stringify({
        server_slug: serverSlug,
        node_token: this.nodeToken,
        username,
        uuid,
        client_hash: clientHash
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erreur Vérification Session HTTP ${res.status}`);
    }
    return data;
  }
}

module.exports = {
  ModeyApiClient
};
