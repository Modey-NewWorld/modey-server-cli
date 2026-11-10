/**
 * @author Flow (Florian) — FlowCreativeStudio
 * @see https://github.com/NayrolfRdgs
 */

const os = require('os');
const net = require('net');

/**
 * Lit l'état mémoire du système
 */
function getSystemMemory() {
  const total = Math.round(os.totalmem() / (1024 * 1024));
  const free = Math.round(os.freemem() / (1024 * 1024));
  const used = total - free;
  return { totalMb: total, usedMb: used, freeMb: free };
}

/**
 * Ping Minecraft TCP SLP (Server List Ping) standard
 * @param {string} host 
 * @param {number} port 
 * @param {number} [timeoutMs=3000] 
 */
function pingMinecraftServer(host = '127.0.0.1', port = 25565, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
      }
    };

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      // Handshake packet (protocol 47 / 767, state 1 = status)
      const hostBuf = Buffer.from(host, 'utf-8');
      const handshake = Buffer.concat([
        Buffer.from([0x00]), // Packet ID 0x00 Handshake
        Buffer.from([0x04]), // Protocol version (varint dummy)
        Buffer.from([hostBuf.length]),
        hostBuf,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        Buffer.from([0x01]) // Next state: Status (1)
      ]);

      const handshakeWithLen = Buffer.concat([
        Buffer.from([handshake.length]),
        handshake
      ]);

      // Request packet (ID 0x00)
      const requestPacket = Buffer.from([0x01, 0x00]);

      socket.write(Buffer.concat([handshakeWithLen, requestPacket]));
    });

    let dataBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      dataBuffer = Buffer.concat([dataBuffer, chunk]);
      // Tentative de parsing JSON de la réponse
      try {
        const text = dataBuffer.toString('utf-8');
        const jsonStart = text.indexOf('{');
        const jsonEnd = text.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          const jsonStr = text.substring(jsonStart, jsonEnd + 1);
          const parsed = JSON.parse(jsonStr);
          const latency = Date.now() - startTime;
          cleanup();
          return resolve({
            online: true,
            latency,
            version: parsed.version?.name || '',
            protocol: parsed.version?.protocol || 0,
            playersOnline: parsed.players?.online || 0,
            playersMax: parsed.players?.max || 20,
            motd: typeof parsed.description === 'string' ? parsed.description : parsed.description?.text || ''
          });
        }
      } catch {
        // En attente d'autres paquets
      }
    });

    socket.on('timeout', () => {
      cleanup();
      resolve({ online: false, latency: -1, playersOnline: 0, playersMax: 0 });
    });

    socket.on('error', () => {
      cleanup();
      resolve({ online: false, latency: -1, playersOnline: 0, playersMax: 0 });
    });

    socket.on('close', () => {
      if (!resolved) {
        resolve({ online: false, latency: -1, playersOnline: 0, playersMax: 0 });
      }
    });
  });
}

module.exports = {
  getSystemMemory,
  pingMinecraftServer
};
