// Vercel Serverless API Endpoint for Bluff Game
const { Room } = require('../engine');

// Global room cache (persists within serverless worker lifetime)
global._bluffRooms = global._bluffRooms || new Map();
const rooms = global._bluffRooms;

// Clean up idle rooms older than 3 hours
function cleanupIdleRooms() {
  const threeHoursAgo = Date.now() - (3 * 60 * 60 * 1000);
  for (const [code, room] of rooms.entries()) {
    if (room.lastActivity < threeHoursAgo) {
      rooms.delete(code);
    }
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  cleanupIdleRooms();

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    body = body || {};

    const action = body.action || req.query.action;
    const roomCode = (body.roomCode || req.query.roomCode || '').toUpperCase().trim();
    const playerId = body.playerId || req.query.playerId;

    switch (action) {
      case 'HOST_ROOM': {
        const { name, avatar, settings } = body;
        const newPlayerId = 'p_' + Math.random().toString(36).substring(2, 12);
        const newRoomCode = generateRoomCode();

        const player = {
          id: newPlayerId,
          name: name || 'Host',
          avatar: avatar || '🦊',
          hand: [],
          hasWon: false,
          rank: null,
          isMuted: false,
          isSpeaking: false
        };

        const room = new Room(newRoomCode, newPlayerId, player.name, settings);
        room.addPlayer(player);
        rooms.set(newRoomCode, room);

        return res.status(200).json({
          success: true,
          roomCode: newRoomCode,
          playerId: newPlayerId,
          state: room.getPublicState(newPlayerId)
        });
      }

      case 'JOIN_ROOM': {
        const { name, avatar } = body;
        const room = rooms.get(roomCode);
        if (!room) {
          return res.status(404).json({ success: false, message: `Room "${roomCode}" not found.` });
        }

        const newPlayerId = 'p_' + Math.random().toString(36).substring(2, 12);
        const player = {
          id: newPlayerId,
          name: name || 'Player',
          avatar: avatar || '🦊',
          hand: [],
          hasWon: false,
          rank: null,
          isMuted: false,
          isSpeaking: false
        };

        const result = room.addPlayer(player);
        if (!result.success) {
          return res.status(400).json({ success: false, message: result.message });
        }

        return res.status(200).json({
          success: true,
          roomCode,
          playerId: newPlayerId,
          state: room.getPublicState(newPlayerId)
        });
      }

      case 'SYNC': {
        const room = rooms.get(roomCode);
        if (!room) {
          return res.status(404).json({ success: false, message: 'Room not found' });
        }
        return res.status(200).json({
          success: true,
          state: room.getPublicState(playerId)
        });
      }

      case 'START_GAME': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
        if (room.hostId !== playerId) return res.status(403).json({ success: false, message: 'Only host can start' });

        const result = room.startGame();
        if (!result.success) return res.status(400).json({ success: false, message: result.message });

        return res.status(200).json({ success: true, state: room.getPublicState(playerId) });
      }

      case 'PLAY_CARDS': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        const { cardIds, claimedRank } = body;
        const result = room.processPlay(playerId, cardIds, claimedRank);
        if (!result.success) return res.status(400).json({ success: false, message: result.message });

        return res.status(200).json({ success: true, state: room.getPublicState(playerId) });
      }

      case 'PASS_TURN': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        const result = room.processPass(playerId);
        if (!result.success) return res.status(400).json({ success: false, message: result.message });

        return res.status(200).json({ success: true, state: room.getPublicState(playerId) });
      }

      case 'CALL_BLUFF': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        const result = room.processChallenge(playerId);
        if (!result.success) return res.status(400).json({ success: false, message: result.message });

        return res.status(200).json({ success: true, state: room.getPublicState(playerId), reveal: result.reveal });
      }

      case 'CHAT_MESSAGE': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        const player = room.players.find(p => p.id === playerId);
        if (player && body.text) {
          room.addChatMessage(player.id, player.name, player.avatar, body.text);
        }
        return res.status(200).json({ success: true });
      }

      case 'RTC_SIGNAL': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        const { targetId, signal } = body;
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          room.queueSignal(targetId, player.id, player.name, signal);
        }
        return res.status(200).json({ success: true });
      }

      case 'VOICE_STATE': {
        const room = rooms.get(roomCode);
        if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

        const player = room.players.find(p => p.id === playerId);
        if (player) {
          player.isMuted = !!body.isMuted;
          player.isSpeaking = !!body.isSpeaking;
        }
        return res.status(200).json({ success: true });
      }

      case 'LEAVE_ROOM': {
        const room = rooms.get(roomCode);
        if (room) {
          room.removePlayer(playerId);
          if (room.players.length === 0) {
            rooms.delete(roomCode);
          }
        }
        return res.status(200).json({ success: true });
      }

      default:
        return res.status(400).json({ success: false, message: 'Invalid action: ' + action });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
