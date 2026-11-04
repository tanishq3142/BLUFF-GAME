// PeerJS WebRTC P2P Multiplayer & Voice Mesh for Bluff
// Zero serverless dependencies, zero room drops, real-time WebRTC DataChannel & Audio Stream

class P2PManager {
  constructor(app) {
    this.app = app;
    this.peer = null;
    this.isHost = false;
    this.roomCode = null;
    this.myId = null;
    this.hostConn = null; // for guests: connection to host
    this.connections = new Map(); // for host: guestId -> DataConnection
    this.calls = new Map(); // peerId -> MediaConnection
    this.localAudioStream = null;
    this.isMuted = true;
    this.gameRoom = null; // only on host
    this.audioContext = null;
    this.analyser = null;
    this.speakingInterval = null;
    this.tickerInterval = null;
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  getPeerIdForRoom(roomCode) {
    return `bluff-v2-${roomCode.trim().toLowerCase()}`;
  }

  // --- HOSTING A ROOM ---
  hostRoom(roomCode, hostName, avatar, settings) {
    this.isHost = true;
    this.roomCode = roomCode.toUpperCase().trim();
    this.myId = 'host_' + Math.random().toString(36).substr(2, 8);

    const peerId = this.getPeerIdForRoom(this.roomCode);

    if (this.peer) this.peer.destroy();

    this.peer = new Peer(peerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', (id) => {
      console.log('Host registered on P2P network with Peer ID:', id);

      // Create host's game room
      this.gameRoom = new BluffEngine.GameRoom(this.roomCode, this.myId, hostName, settings);
      this.gameRoom.addPlayer({
        id: this.myId,
        name: hostName,
        avatar: avatar,
        hand: [],
        hasWon: false,
        rank: null,
        isMuted: this.isMuted,
        isSpeaking: false
      });

      this.app.onRoomCreated(this.roomCode, this.myId);
      this.broadcastState();

      // Start tick loop for timers
      this.startHostTicker();
    });

    this.peer.on('connection', (conn) => {
      this.setupHostConnection(conn);
    });

    this.peer.on('call', (call) => {
      this.handleIncomingCall(call);
    });

    this.peer.on('error', (err) => {
      console.error('Peer error (host):', err);
      if (err.type === 'unavailable-id') {
        // Room code already taken, regenerate
        const newCode = this.generateRoomCode();
        this.hostRoom(newCode, hostName, avatar, settings);
      } else {
        this.app.showToast('P2P connection notice: ' + (err.message || err.type));
      }
    });
  }

  setupHostConnection(conn) {
    let guestId = null;

    conn.on('open', () => {
      console.log('Guest connected data channel:', conn.peer);
    });

    conn.on('data', (data) => {
      this.handleHostReceivedData(conn, data);
    });

    conn.on('close', () => {
      console.log('Guest disconnected:', conn.peer);
      // Find guestId for this connection
      for (const [id, c] of this.connections.entries()) {
        if (c === conn) {
          guestId = id;
          this.connections.delete(id);
          break;
        }
      }

      if (guestId && this.gameRoom) {
        this.gameRoom.removePlayer(guestId);
        this.broadcastState();
      }
    });

    conn.on('error', (err) => {
      console.warn('Connection error with peer:', err);
    });
  }

  handleHostReceivedData(conn, data) {
    if (!this.gameRoom) return;
    const { type, payload } = data;

    switch (type) {
      case 'JOIN': {
        const guestId = payload.playerId || ('p_' + Math.random().toString(36).substr(2, 8));
        this.connections.set(guestId, conn);

        const res = this.gameRoom.addPlayer({
          id: guestId,
          name: payload.name || 'Player',
          avatar: payload.avatar || '🦊',
          hand: [],
          hasWon: false,
          rank: null,
          isMuted: false,
          isSpeaking: false
        });

        if (!res.success) {
          conn.send({ type: 'ERROR', payload: { message: res.message } });
          conn.close();
          return;
        }

        conn.send({
          type: 'JOINED_SUCCESS',
          payload: { roomCode: this.roomCode, playerId: guestId }
        });

        this.broadcastState();

        // Connect voice if audio stream ready
        if (this.localAudioStream && conn.peer) {
          this.callPeerAudio(conn.peer);
        }
        break;
      }

      case 'START_GAME': {
        // Only host can start
        break;
      }

      case 'PLAY_CARDS': {
        const res = this.gameRoom.processPlay(payload.playerId, payload.cardIds, payload.claimedRank);
        if (!res.success) {
          conn.send({ type: 'ERROR', payload: { message: res.message } });
        } else {
          window.soundManager.playCardDeal();
          this.broadcastState();
        }
        break;
      }

      case 'PASS_TURN': {
        const res = this.gameRoom.processPass(payload.playerId);
        if (!res.success) {
          conn.send({ type: 'ERROR', payload: { message: res.message } });
        } else {
          this.broadcastState();
        }
        break;
      }

      case 'CALL_BLUFF': {
        const res = this.gameRoom.processChallenge(payload.playerId);
        if (!res.success) {
          conn.send({ type: 'ERROR', payload: { message: res.message } });
        } else {
          this.broadcastAll({
            type: 'BLUFF_REVEAL',
            payload: res.reveal
          });
          this.app.showBluffReveal(res.reveal);

          setTimeout(() => {
            this.gameRoom.startTurn();
            this.broadcastState();
          }, 4500);
        }
        break;
      }

      case 'CHAT': {
        const msg = this.gameRoom.addChatMessage(payload.playerId, payload.playerName, payload.text);
        this.broadcastAll({ type: 'CHAT_MSG', payload: msg });
        this.app.appendChatMessage(msg);
        break;
      }

      case 'VOICE_STATE': {
        const p = this.gameRoom.players.find(pl => pl.id === payload.playerId);
        if (p) {
          p.isMuted = !!payload.isMuted;
          p.isSpeaking = !!payload.isSpeaking;
          this.broadcastAll({
            type: 'VOICE_UPDATE',
            payload: { playerId: p.id, isMuted: p.isMuted, isSpeaking: p.isSpeaking }
          });
          this.app.updatePlayerVoiceState(p.id, p.isMuted, p.isSpeaking);
        }
        break;
      }
    }
  }

  startHostTicker() {
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this.tickerInterval = setInterval(() => {
      if (!this.gameRoom || this.gameRoom.state !== 'PLAYING') return;

      const expired = this.gameRoom.checkChallengeExpiry();
      if (expired) {
        this.broadcastState();
      }

      // Turn timeout check
      if (this.gameRoom.turnEndsAt && Date.now() >= this.gameRoom.turnEndsAt) {
        const currentP = this.gameRoom.players[this.gameRoom.currentTurnIndex];
        if (currentP) {
          this.gameRoom.addSystemMessage(`⏳ Time's up for ${currentP.name}! Auto-playing.`);
          if (currentP.hand && currentP.hand.length > 0) {
            this.gameRoom.processPlay(currentP.id, [currentP.hand[0].id], this.gameRoom.currentRequiredRank);
          } else {
            this.gameRoom.advanceTurn();
          }
          this.broadcastState();
        }
      }
    }, 1000);
  }

  broadcastState() {
    if (!this.gameRoom) return;

    // Send host their own state
    const hostState = this.gameRoom.getStateForPlayer(this.myId);
    this.app.updateRoomState(hostState);

    // Send each guest their custom sanitized state (their own hand only!)
    for (const [guestId, conn] of this.connections.entries()) {
      if (conn.open) {
        const guestState = this.gameRoom.getStateForPlayer(guestId);
        conn.send({
          type: 'ROOM_STATE',
          payload: guestState
        });
      }
    }
  }

  broadcastAll(message) {
    for (const conn of this.connections.values()) {
      if (conn.open) {
        conn.send(message);
      }
    }
  }

  // --- JOINING A ROOM AS GUEST ---
  joinRoom(roomCode, playerName, avatar) {
    this.isHost = false;
    this.roomCode = roomCode.toUpperCase().trim();
    this.myId = 'guest_' + Math.random().toString(36).substr(2, 8);

    const hostPeerId = this.getPeerIdForRoom(this.roomCode);

    if (this.peer) this.peer.destroy();

    // Random peer ID for guest
    this.peer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', (guestPeerId) => {
      console.log('Guest registered on P2P network:', guestPeerId);
      this.connectToHost(hostPeerId, playerName, avatar);
    });

    this.peer.on('call', (call) => {
      this.handleIncomingCall(call);
    });

    this.peer.on('error', (err) => {
      console.error('Peer error (guest):', err);
      if (err.type === 'peer-unavailable') {
        this.app.showToast(`Room "${this.roomCode}" not found. Verify code or ask host if room is active.`);
      } else {
        this.app.showToast('Connection error: ' + (err.message || err.type));
      }
    });
  }

  connectToHost(hostPeerId, playerName, avatar) {
    this.hostConn = this.peer.connect(hostPeerId, { reliable: true });

    this.hostConn.on('open', () => {
      console.log('Connected to host data channel!');
      this.hostConn.send({
        type: 'JOIN',
        payload: {
          playerId: this.myId,
          name: playerName,
          avatar: avatar
        }
      });
    });

    this.hostConn.on('data', (data) => {
      this.handleGuestReceivedData(data);
    });

    this.hostConn.on('close', () => {
      this.app.showToast('Disconnected from host room.');
      setTimeout(() => {
        alert('The room host has disconnected or closed the room.');
        window.location.reload();
      }, 1000);
    });

    this.hostConn.on('error', (err) => {
      console.error('Host connection error:', err);
    });
  }

  handleGuestReceivedData(data) {
    const { type, payload } = data;

    switch (type) {
      case 'JOINED_SUCCESS': {
        this.app.onRoomJoined(payload.roomCode, payload.playerId);
        break;
      }

      case 'ROOM_STATE': {
        this.app.updateRoomState(payload);
        break;
      }

      case 'BLUFF_REVEAL': {
        this.app.showBluffReveal(payload);
        break;
      }

      case 'CHAT_MSG': {
        this.app.appendChatMessage(payload);
        break;
      }

      case 'VOICE_UPDATE': {
        this.app.updatePlayerVoiceState(payload.playerId, payload.isMuted, payload.isSpeaking);
        break;
      }

      case 'ERROR': {
        this.app.showToast(payload.message || 'Error occurred');
        break;
      }
    }
  }

  // --- ACTIONS DISPATCH (Host or Guest) ---
  sendAction(type, payload = {}) {
    payload.playerId = this.myId;

    if (this.isHost) {
      // Direct local execution on host
      if (type === 'START_GAME') {
        const res = this.gameRoom.startGame();
        if (res.success) {
          this.broadcastState();
        } else {
          this.app.showToast(res.message);
        }
      } else if (type === 'PLAY_CARDS') {
        const res = this.gameRoom.processPlay(this.myId, payload.cardIds, payload.claimedRank);
        if (!res.success) {
          this.app.showToast(res.message);
        } else {
          window.soundManager.playCardDeal();
          this.broadcastState();
        }
      } else if (type === 'PASS_TURN') {
        const res = this.gameRoom.processPass(this.myId);
        if (!res.success) {
          this.app.showToast(res.message);
        } else {
          this.broadcastState();
        }
      } else if (type === 'CALL_BLUFF') {
        const res = this.gameRoom.processChallenge(this.myId);
        if (!res.success) {
          this.app.showToast(res.message);
        } else {
          this.broadcastAll({ type: 'BLUFF_REVEAL', payload: res.reveal });
          this.app.showBluffReveal(res.reveal);
          setTimeout(() => {
            this.gameRoom.startTurn();
            this.broadcastState();
          }, 4500);
        }
      } else if (type === 'CHAT') {
        const msg = this.gameRoom.addChatMessage(this.myId, this.app.myName, payload.text);
        this.broadcastAll({ type: 'CHAT_MSG', payload: msg });
        this.app.appendChatMessage(msg);
      }
    } else {
      // Guest sends to host over WebRTC DataChannel
      if (this.hostConn && this.hostConn.open) {
        this.hostConn.send({ type, payload });
      } else {
        this.app.showToast('Connection to host is not open.');
      }
    }
  }

  // --- WEBRTC AUDIO & VOICE ---
  async initMicrophone() {
    try {
      this.localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      this.setMicrophoneEnabled(false);
      this.setupSpeakingDetector();

      // If already connected to peers, exchange calls
      if (this.isHost) {
        for (const conn of this.connections.values()) {
          if (conn.peer) this.callPeerAudio(conn.peer);
        }
      } else if (this.hostConn && this.hostConn.peer) {
        this.callPeerAudio(this.hostConn.peer);
      }

      return { success: true };
    } catch (err) {
      console.warn('Microphone not available:', err);
      return { success: false, error: err.message };
    }
  }

  callPeerAudio(remotePeerId) {
    if (!this.peer || !this.localAudioStream || this.calls.has(remotePeerId)) return;
    try {
      const call = this.peer.call(remotePeerId, this.localAudioStream);
      this.handleOutgoingCall(call, remotePeerId);
    } catch (e) {
      console.warn('Call peer audio failed:', e);
    }
  }

  handleOutgoingCall(call, remotePeerId) {
    call.on('stream', (remoteStream) => {
      this.attachRemoteAudio(remotePeerId, remoteStream);
    });
    call.on('close', () => {
      this.detachRemoteAudio(remotePeerId);
      this.calls.delete(remotePeerId);
    });
    this.calls.set(remotePeerId, call);
  }

  handleIncomingCall(call) {
    const remotePeerId = call.peer;
    call.answer(this.localAudioStream || undefined);
    call.on('stream', (remoteStream) => {
      this.attachRemoteAudio(remotePeerId, remoteStream);
    });
    call.on('close', () => {
      this.detachRemoteAudio(remotePeerId);
      this.calls.delete(remotePeerId);
    });
    this.calls.set(remotePeerId, call);
  }

  attachRemoteAudio(peerId, stream) {
    let el = document.getElementById(`audio-remote-${peerId}`);
    if (!el) {
      el = document.createElement('audio');
      el.id = `audio-remote-${peerId}`;
      el.autoplay = true;
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    el.srcObject = stream;
  }

  detachRemoteAudio(peerId) {
    const el = document.getElementById(`audio-remote-${peerId}`);
    if (el) el.remove();
  }

  setMicrophoneEnabled(enabled) {
    this.isMuted = !enabled;
    if (this.localAudioStream) {
      this.localAudioStream.getAudioTracks().forEach(t => t.enabled = enabled);
    }

    this.sendVoiceState(this.isMuted, false);
    return enabled;
  }

  toggleMicrophone() {
    return this.setMicrophoneEnabled(this.isMuted);
  }

  setupSpeakingDetector() {
    if (!this.localAudioStream) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const src = this.audioContext.createMediaStreamSource(this.localAudioStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      let isSpeaking = false;

      if (this.speakingInterval) clearInterval(this.speakingInterval);

      this.speakingInterval = setInterval(() => {
        if (this.isMuted || !this.analyser) {
          if (isSpeaking) {
            isSpeaking = false;
            this.sendVoiceState(this.isMuted, false);
          }
          return;
        }

        this.analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const nowSpeaking = avg > 22;

        if (nowSpeaking !== isSpeaking) {
          isSpeaking = nowSpeaking;
          this.sendVoiceState(this.isMuted, nowSpeaking);
          this.app.updateAvatarSpeaking(this.myId, nowSpeaking);
        }
      }, 150);
    } catch (e) {
      console.warn('Speaking detector setup failed:', e);
    }
  }

  sendVoiceState(isMuted, isSpeaking) {
    const payload = {
      playerId: this.myId,
      isMuted: isMuted,
      isSpeaking: isSpeaking
    };

    if (this.isHost && this.gameRoom) {
      const p = this.gameRoom.players.find(pl => pl.id === this.myId);
      if (p) {
        p.isMuted = isMuted;
        p.isSpeaking = isSpeaking;
      }
      this.broadcastAll({ type: 'VOICE_UPDATE', payload });
      this.app.updatePlayerVoiceState(this.myId, isMuted, isSpeaking);
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send({ type: 'VOICE_STATE', payload });
    }
  }

  leaveRoom() {
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    if (this.speakingInterval) clearInterval(this.speakingInterval);
    if (this.hostConn) this.hostConn.close();
    for (const conn of this.connections.values()) conn.close();
    if (this.peer) this.peer.destroy();
  }
}

window.P2PManager = P2PManager;
