/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

/**
 * Service de communication HTTP vers la plateforme centrale Modey
 */
class ModeyApiClient {
  constructor(baseUrl, nodeToken = '') {
    this.baseUrl = (baseUrl || 'https://auth.modey.fr').replace(/\/+$/, '');
    this.nodeToken = nodeToken;
  }

  /**
   * Envoi du heartbeat de télémétrie vers /api/nodes/heartbeat
   */
  async sendHeartbeat(payload) {
    const url = `${this.baseUrl}/api/nodes/heartbeat`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.nodeToken ? { 'x-node-token': this.nodeToken } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erreur Heartbeat HTTP ${res.status}`);
    }
    return data;
  }

  /**
   * Synchronisation du manifeste modey-server.json vers /api/nodes/sync-metadata
   */
  async syncMetadata(serverSlug, manifest) {
    const url = `${this.baseUrl}/api/nodes/sync-metadata`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.nodeToken ? { 'x-node-token': this.nodeToken } : {})
      },
      body: JSON.stringify({
        server_slug: serverSlug,
        node_token: this.nodeToken,
        manifest
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
