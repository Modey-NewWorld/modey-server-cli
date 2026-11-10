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
 * Écrit un entier au format Minecraft VarInt
 */
function writeVarInt(value) {
  const bytes = [];
  let current = value;
  while (true) {
    if ((current & ~0x7f) === 0) {
      bytes.push(current);
      break;
    }
    bytes.push((current & 0x7f) | 0x80);
    current >>>= 7;
  }
  return Buffer.from(bytes);
}

/**
 * Ping Minecraft TCP SLP (Server List Ping) officiel
 * Compatible Minecraft 1.7 à 1.21+
 * @param {string} host 
 * @param {number} port 
 * @param {number} [timeoutMs=3500] 
 */
function pingMinecraftServer(host = '127.0.0.1', port = 25565, timeoutMs = 3500) {
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

    socket.connect(port, host, () => {
      try {
        const hostBuf = Buffer.from(host, 'utf-8');

        // 1. Handshake Packet (ID 0x00)
        const handshakePayload = Buffer.concat([
          writeVarInt(0x00),        // Packet ID 0x00
          writeVarInt(767),         // Protocol version (1.21.1)
          writeVarInt(hostBuf.length),
          hostBuf,
          Buffer.from([(port >> 8) & 0xff, port & 0xff]), // Port Big-Endian
          writeVarInt(1)            // Next state = Status (1)
        ]);
        const handshakePacket = Buffer.concat([
          writeVarInt(handshakePayload.length),
          handshakePayload
        ]);

        // 2. Status Request Packet (ID 0x00)
        const requestPayload = writeVarInt(0x00);
        const requestPacket = Buffer.concat([
          writeVarInt(requestPayload.length),
          requestPayload
        ]);

        socket.write(Buffer.concat([handshakePacket, requestPacket]));
      } catch (err) {
        cleanup();
        resolve({ online: false, latency: -1, playersOnline: 0, playersMax: 0, error: err.message });
      }
    });

    let dataBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      dataBuffer = Buffer.concat([dataBuffer, chunk]);
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
        // En attente du buffer complet
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
  writeVarInt,
  pingMinecraftServer
};
