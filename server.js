// Bluff (Cheat / I Doubt It) - Game Server
// Zero-dependency pure Node.js HTTP & RFC-6455 WebSocket Server
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Room } = require('./engine');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// HTTP Static File Server
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle serverless /api/game request locally if called
  if (req.url.startsWith('/api/game')) {
    const apiHandler = require('./api/game');
    let rawBody = '';
    req.on('data', chunk => rawBody += chunk);
    req.on('end', () => {
      req.body = rawBody;
      const resWrapper = {
        statusCode: 200,
        headers: {},
        setHeader: (k, v) => res.setHeader(k, v),
        status: function(code) { this.statusCode = code; return this; },
        json: function(data) {
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        },
        end: function(data) {
          res.writeHead(this.statusCode);
          res.end(data);
        }
      };
      apiHandler(req, resWrapper);
    });
    return;
  }

  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);

  // If not found in public, try root directory
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, safePath);
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
        ? path.join(PUBLIC_DIR, 'index.html')
        : path.join(__dirname, 'index.html');
      fs.readFile(indexPath, (err2, content) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server Error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

// RFC-6455 WebSocket Implementation
class WebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._onClose());
    socket.on('error', () => this._onClose());
  }

  _onClose() {
    if (this.onclose) this.onclose();
  }

  send(data) {
    if (this.socket.destroyed) return;
    const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
    const length = payload.length;

    let header;
    if (length <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x81;
      header[1] = length;
    } else if (length <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) {}
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const firstByte = this.buffer[0];
      const secondByte = this.buffer[1];
      const opcode = firstByte & 0x0F;
      const isMasked = (secondByte & 0x80) !== 0;
      let payloadLength = secondByte & 0x7F;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      let maskKey = null;
      if (isMasked) {
        if (this.buffer.length < offset + 4) return;
        maskKey = this.buffer.slice(offset, offset + 4);
        offset += 4;
      }

      if (this.buffer.length < offset + payloadLength) return;

      const payload = this.buffer.slice(offset, offset + payloadLength);
      this.buffer = this.buffer.slice(offset + payloadLength);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x8) {
        this.socket.end();
        return;
      } else if (opcode === 0x9) {
        const pongHeader = Buffer.from([0x8A, 0x00]);
        this.socket.write(pongHeader);
      } else if (opcode === 0x1) {
        const text = payload.toString('utf8');
        if (this.onmessage) this.onmessage(text);
      }
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ].join('\r\n');

  socket.write(responseHeaders);

  const ws = new WebSocketConnection(socket);
  handleWsConnection(ws);
});

const rooms = global._bluffRooms || new Map();
global._bluffRooms = rooms;
const clientMap = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastRoom(room, message) {
  for (const player of room.players) {
    if (player.ws && player.ws.send) {
      player.ws.send(message);
    }
  }
}

function broadcastState(room) {
  for (const player of room.players) {
    if (player.ws && player.ws.send) {
      const state = room.getPublicState(player.id);
      player.ws.send({
        type: 'ROOM_STATE',
        payload: state
      });
    }
  }
}

function handleWsConnection(ws) {
  let player = null;

  ws.onmessage = (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage);
      const { type, payload } = data;

      switch (type) {
        case 'HOST_ROOM': {
          const { name, avatar, settings } = payload;
          const playerId = 'p_' + crypto.randomBytes(6).toString('hex');
          const roomCode = generateRoomCode();

          player = {
            id: playerId,
            name: name || 'Host',
            avatar: avatar || '🦊',
            ws: ws,
            hand: [],
            hasWon: false,
            rank: null,
            isMuted: false,
            isSpeaking: false,
            roomCode: roomCode
          };

          clientMap.set(ws, player);
          const room = new Room(roomCode, playerId, player.name, settings);
          room.addPlayer(player);
          rooms.set(roomCode, room);

          ws.send({ type: 'ROOM_CREATED', payload: { roomCode, playerId } });
          broadcastState(room);
          break;
        }

        case 'JOIN_ROOM': {
          const { roomCode, name, avatar } = payload;
          const cleanCode = (roomCode || '').trim().toUpperCase();
          const room = rooms.get(cleanCode);

          if (!room) {
            ws.send({ type: 'ERROR', payload: { message: `Room "${cleanCode}" not found.` } });
            return;
          }

          const playerId = 'p_' + crypto.randomBytes(6).toString('hex');
          player = {
            id: playerId,
            name: name || 'Player',
            avatar: avatar || '🦊',
            ws: ws,
            hand: [],
            hasWon: false,
            rank: null,
            isMuted: false,
            isSpeaking: false,
            roomCode: cleanCode
          };

          const joinResult = room.addPlayer(player);
          if (!joinResult.success) {
            ws.send({ type: 'ERROR', payload: { message: joinResult.message } });
            return;
          }

          clientMap.set(ws, player);
          ws.send({ type: 'ROOM_JOINED', payload: { roomCode: cleanCode, playerId } });
          broadcastState(room);
          break;
        }

        case 'START_GAME': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room || room.hostId !== player.id) return;
          const res = room.startGame();
          if (res.success) {
            broadcastState(room);
          } else {
            ws.send({ type: 'ERROR', payload: { message: res.message } });
          }
          break;
        }

        case 'PLAY_CARDS': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room || room.state !== 'PLAYING') return;

          const { cardIds, claimedRank } = payload;
          const res = room.processPlay(player.id, cardIds, claimedRank);
          if (res.success) {
            broadcastState(room);
          } else {
            ws.send({ type: 'ERROR', payload: { message: res.message } });
          }
          break;
        }

        case 'PASS_TURN': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room || room.state !== 'PLAYING') return;

          const res = room.processPass(player.id);
          if (res.success) {
            broadcastState(room);
          } else {
            ws.send({ type: 'ERROR', payload: { message: res.message } });
          }
          break;
        }

        case 'CALL_BLUFF': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room || room.state !== 'PLAYING') return;

          const res = room.processChallenge(player.id);
          if (res.success) {
            broadcastRoom(room, { type: 'BLUFF_REVEAL', payload: res.reveal });
            setTimeout(() => {
              room.startTurn();
              broadcastState(room);
            }, 4500);
          } else {
            ws.send({ type: 'ERROR', payload: { message: res.message } });
          }
          break;
        }

        case 'CHAT_MESSAGE': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room) return;

          const text = (payload.text || '').trim();
          if (!text) return;

          const msg = room.addChatMessage(player.id, player.name, player.avatar, text);
          broadcastRoom(room, { type: 'CHAT_MESSAGE', payload: msg });
          break;
        }

        case 'RTC_SIGNAL': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room) return;

          const { targetId, signal } = payload;
          const targetPlayer = room.players.find(p => p.id === targetId);
          if (targetPlayer && targetPlayer.ws) {
            targetPlayer.ws.send({
              type: 'RTC_SIGNAL',
              payload: {
                senderId: player.id,
                senderName: player.name,
                signal: signal
              }
            });
          }
          break;
        }

        case 'VOICE_STATE': {
          if (!player || !player.roomCode) return;
          const room = rooms.get(player.roomCode);
          if (!room) return;

          player.isMuted = !!payload.isMuted;
          player.isSpeaking = !!payload.isSpeaking;

          broadcastRoom(room, {
            type: 'VOICE_STATE_UPDATE',
            payload: {
              playerId: player.id,
              isMuted: player.isMuted,
              isSpeaking: player.isSpeaking
            }
          });
          break;
        }

        case 'LEAVE_ROOM': {
          handleDisconnect(ws, player);
          break;
        }
      }
    } catch (err) {
      console.error('Error in WS message:', err);
    }
  };

  ws.onclose = () => {
    handleDisconnect(ws, player);
  };
}

function handleDisconnect(ws, player) {
  if (!player) player = clientMap.get(ws);
  if (!player) return;

  clientMap.delete(ws);
  if (player.roomCode) {
    const room = rooms.get(player.roomCode);
    if (room) {
      broadcastRoom(room, {
        type: 'RTC_PEER_LEFT',
        payload: { peerId: player.id }
      });
      room.removePlayer(player.id);
      if (room.players.length === 0) {
        rooms.delete(player.roomCode);
      } else {
        broadcastState(room);
      }
    }
  }
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`🃏 Bluff Multiplayer Game Server running at:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`===============================================`);
  });
}

module.exports = server;
