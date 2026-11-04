// Bluff Multiplayer Frontend Engine
// Dual-transport engine: High-performance WebSockets with automatic Vercel Serverless HTTP fallback

class BluffApp {
  constructor() {
    this.ws = null;
    this.transportMode = 'ws'; // 'ws' or 'http'
    this.pollInterval = null;
    this.lastRevealId = null;
    this.lastProcessedMsgCount = 0;

    this.roomCode = null;
    this.myId = null;
    this.myName = '';
    this.myAvatar = '🦊';
    this.isHost = false;
    this.gameState = null;
    this.selectedCardIds = new Set();
    this.sortMode = 'rank';

    this.voiceManager = null;
    this.challengeTimerInterval = null;

    this.init();
  }

  init() {
    this.setupAvatarPicker();
    this.loadSavedProfile();
    this.checkUrlForRoomCode();

    // Voice manager init
    this.voiceManager = new VoiceChatManager(this);
    this.voiceManager.onLocalSpeaking = (speaking) => {
      this.updateAvatarSpeaking(this.myId, speaking);
    };

    this.connectTransport();
  }

  setupAvatarPicker() {
    const opts = document.querySelectorAll('.avatar-opt');
    opts.forEach(opt => {
      opt.addEventListener('click', () => {
        opts.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        this.myAvatar = opt.getAttribute('data-avatar');
        localStorage.setItem('bluff_avatar', this.myAvatar);
      });
    });
  }

  loadSavedProfile() {
    const savedName = localStorage.getItem('bluff_name');
    if (savedName) {
      document.getElementById('input-player-name').value = savedName;
      this.myName = savedName;
    } else {
      const randomNames = ['AceHunter', 'CardShark', 'RoyalFlush', 'BluffKing', 'ShadowRogue', 'MysticFox'];
      const defaultName = randomNames[Math.floor(Math.random() * randomNames.length)];
      document.getElementById('input-player-name').value = defaultName;
      this.myName = defaultName;
    }

    const savedAvatar = localStorage.getItem('bluff_avatar');
    if (savedAvatar) {
      this.myAvatar = savedAvatar;
      const opt = document.querySelector(`.avatar-opt[data-avatar="${savedAvatar}"]`);
      if (opt) {
        document.querySelectorAll('.avatar-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      }
    }
  }

  checkUrlForRoomCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) {
      const cleanCode = code.trim().toUpperCase();
      document.getElementById('join-room-code').value = cleanCode;
      setTimeout(() => {
        openJoinModal();
      }, 400);
    }
  }

  connectTransport() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    let wsHandshakeFailed = false;
    const wsTimeout = setTimeout(() => {
      if (this.transportMode === 'ws' && (!this.ws || this.ws.readyState !== WebSocket.OPEN)) {
        console.log('Switching to Vercel Serverless HTTP transport mode.');
        this.switchToHttpMode();
      }
    }, 1800);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        clearTimeout(wsTimeout);
        this.transportMode = 'ws';
        console.log('Connected via WebSocket');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onerror = () => {
        if (!wsHandshakeFailed) {
          wsHandshakeFailed = true;
          clearTimeout(wsTimeout);
          this.switchToHttpMode();
        }
      };

      this.ws.onclose = () => {
        if (this.transportMode === 'ws') {
          console.warn('WebSocket disconnected. Falling back to HTTP sync...');
          this.switchToHttpMode();
        }
      };
    } catch (err) {
      this.switchToHttpMode();
    }
  }

  switchToHttpMode() {
    this.transportMode = 'http';
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
      this.ws = null;
    }
    this.startHttpPolling();
  }

  startHttpPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    this.pollInterval = setInterval(async () => {
      if (!this.roomCode || !this.myId) return;

      try {
        const res = await fetch(`/api/game?action=SYNC&roomCode=${encodeURIComponent(this.roomCode)}&playerId=${encodeURIComponent(this.myId)}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data.success && data.state) {
          this.updateRoomState(data.state);

          // Handle incoming WebRTC signals over HTTP
          if (Array.isArray(data.state.queuedSignals)) {
            for (const item of data.state.queuedSignals) {
              this.voiceManager.handleSignal(item.senderId, item.signal);
            }
          }

          // Handle reveal events
          if (data.state.revealEvent && data.state.revealEvent.id !== this.lastRevealId) {
            this.lastRevealId = data.state.revealEvent.id;
            this.showBluffReveal(data.state.revealEvent);
          }

          // Sync messages
          if (Array.isArray(data.state.messages)) {
            const newCount = data.state.messages.length;
            if (newCount !== this.lastProcessedMsgCount) {
              const messagesContainer = document.getElementById('chat-messages-container');
              messagesContainer.innerHTML = '';
              data.state.messages.forEach(m => this.appendChatMessage(m));
              this.lastProcessedMsgCount = newCount;
            }
          }
        }
      } catch (err) {
        // quiet polling error
      }
    }, 450);
  }

  async send(data) {
    const { type, payload } = data;

    if (this.transportMode === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return;
    }

    // HTTP Mode Request
    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: type,
          roomCode: this.roomCode,
          playerId: this.myId,
          ...(payload || {})
        })
      });

      const result = await res.json();
      if (!result.success) {
        if (result.message) this.showToast(result.message);
        return;
      }

      if (type === 'HOST_ROOM' || type === 'JOIN_ROOM') {
        this.roomCode = result.roomCode;
        this.myId = result.playerId;
        this.voiceManager.setMyId(this.myId);

        const url = new URL(window.location);
        url.searchParams.set('room', this.roomCode);
        window.history.pushState({}, '', url);

        document.getElementById('nav-room-badge').style.display = 'flex';
        document.getElementById('nav-room-code').textContent = this.roomCode;
        document.getElementById('btn-mic').style.display = 'flex';
        document.getElementById('btn-chat-toggle').style.display = 'flex';

        closeAllModals();
        this.voiceManager.initMicrophone();

        if (result.state) {
          this.updateRoomState(result.state);
        }
      } else if (result.state) {
        this.updateRoomState(result.state);
        if (result.reveal) {
          this.showBluffReveal(result.reveal);
        }
      }
    } catch (err) {
      console.error('HTTP send error:', err);
      this.showToast('Network error communicating with server.');
    }
  }

  handleServerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'ROOM_CREATED':
      case 'ROOM_JOINED': {
        this.roomCode = payload.roomCode;
        this.myId = payload.playerId;
        this.voiceManager.setMyId(this.myId);

        const url = new URL(window.location);
        url.searchParams.set('room', this.roomCode);
        window.history.pushState({}, '', url);

        document.getElementById('nav-room-badge').style.display = 'flex';
        document.getElementById('nav-room-code').textContent = this.roomCode;
        document.getElementById('btn-mic').style.display = 'flex';
        document.getElementById('btn-chat-toggle').style.display = 'flex';

        closeAllModals();
        this.voiceManager.initMicrophone();
        break;
      }

      case 'ROOM_STATE': {
        this.updateRoomState(payload);
        break;
      }

      case 'BLUFF_REVEAL': {
        this.showBluffReveal(payload);
        break;
      }

      case 'CHAT_MESSAGE': {
        this.appendChatMessage(payload);
        break;
      }

      case 'VOICE_STATE_UPDATE': {
        this.updatePlayerVoiceState(payload.playerId, payload.isMuted, payload.isSpeaking);
        break;
      }

      case 'RTC_SIGNAL': {
        this.voiceManager.handleSignal(payload.senderId, payload.signal);
        break;
      }

      case 'RTC_PEER_LEFT': {
        this.voiceManager.removePeer(payload.peerId);
        break;
      }

      case 'GAME_OVER': {
        this.showGameOverModal(payload.winners);
        break;
      }

      case 'ERROR': {
        this.showToast(payload.message || 'An error occurred');
        break;
      }
    }
  }

  updateRoomState(state) {
    this.gameState = state;
    this.isHost = state.hostId === this.myId;

    for (const p of state.players) {
      if (p.id !== this.myId) {
        this.voiceManager.connectToPeer(p.id);
      }
    }

    if (state.state === 'LOBBY') {
      this.renderLobby(state);
    } else if (state.state === 'PLAYING') {
      this.renderGame(state);
    }
  }

  renderLobby(state) {
    document.getElementById('view-landing').style.display = 'none';
    document.getElementById('view-lobby').style.display = 'block';
    document.getElementById('view-game').style.display = 'none';

    document.getElementById('lobby-code-display').textContent = state.code;
    document.getElementById('summary-max-players').textContent = state.settings.maxPlayers;
    document.getElementById('summary-decks').textContent = state.settings.deckCountMode === 'auto' ? 'Auto Dynamic' : `${state.settings.deckCountMode} Decks`;
    document.getElementById('summary-jokers').textContent = `${state.settings.jokers} Jokers (Wild)`;
    document.getElementById('summary-mode').textContent = state.settings.ruleMode === 'sequential' ? 'Sequential (A-K)' : 'Free Rank';
    document.getElementById('summary-timer').textContent = state.settings.turnTimeLimit > 0 ? `${state.settings.turnTimeLimit}s` : 'No limit';

    document.getElementById('player-count-lobby').textContent = state.players.length;
    document.getElementById('player-max-lobby').textContent = state.settings.maxPlayers;

    const grid = document.getElementById('lobby-players-grid');
    grid.innerHTML = '';

    for (const p of state.players) {
      const isHost = p.id === state.hostId;
      const isMe = p.id === this.myId;

      const badge = document.createElement('div');
      badge.className = `player-lobby-badge ${isHost ? 'is-host' : ''}`;
      badge.innerHTML = `
        <div class="lobby-avatar">
          ${p.avatar}
          ${isHost ? '<span class="crown-icon">👑</span>' : ''}
        </div>
        <div class="lobby-player-info">
          <div class="lobby-player-name">${this.escapeHtml(p.name)} ${isMe ? '(You)' : ''}</div>
          <div class="lobby-player-status">${isHost ? 'Host' : 'Ready'}</div>
        </div>
      `;
      grid.appendChild(badge);
    }

    const hostControls = document.getElementById('lobby-host-controls');
    const guestNotice = document.getElementById('lobby-guest-notice');
    if (this.isHost) {
      hostControls.style.display = 'block';
      guestNotice.style.display = 'none';
      const startBtn = document.getElementById('btn-start-game');
      startBtn.disabled = state.players.length < 2;
      startBtn.textContent = state.players.length < 2 ? 'Need 2+ Players to Start' : 'START GAME 🚀';
    } else {
      hostControls.style.display = 'none';
      guestNotice.style.display = 'block';
    }
  }

  renderGame(state) {
    document.getElementById('view-landing').style.display = 'none';
    document.getElementById('view-lobby').style.display = 'none';
    document.getElementById('view-game').style.display = 'flex';

    const rankEl = document.getElementById('table-current-rank');
    const rankNameMap = {
      'A': 'ACES (A)', '2': 'TWOS (2)', '3': 'THREES (3)', '4': 'FOURS (4)',
      '5': 'FIVES (5)', '6': 'SIXES (6)', '7': 'SEVENS (7)', '8': 'EIGHTS (8)',
      '9': 'NINES (9)', '10': 'TENS (10)', 'J': 'JACKS (J)', 'Q': 'QUEENS (Q)', 'K': 'KINGS (K)'
    };
    rankEl.textContent = rankNameMap[state.currentRequiredRank] || `${state.currentRequiredRank}s`;

    document.getElementById('center-pile-count').textContent = `Pile: ${state.pileCount} cards`;

    const lastPlayBanner = document.getElementById('last-play-banner');
    if (state.lastPlay) {
      lastPlayBanner.style.display = 'block';
      const countStr = state.lastPlay.count === 1 ? '1 card' : `${state.lastPlay.count} cards`;
      document.getElementById('last-play-text').textContent = `${state.lastPlay.playerName} claimed ${countStr} as ${state.lastPlay.claimedRank}s`;
    } else {
      lastPlayBanner.style.display = 'none';
    }

    const challengeControls = document.getElementById('challenge-controls');
    const btnBluff = document.getElementById('btn-call-bluff');

    if (state.challengeEndsAt && state.challengeEndsAt > Date.now()) {
      challengeControls.style.display = 'flex';
      const amILastPlayer = state.lastPlay && state.lastPlay.playerId === this.myId;
      const myPlayerObj = state.players.find(p => p.id === this.myId);
      const haveIWon = myPlayerObj && myPlayerObj.hasWon;

      btnBluff.disabled = amILastPlayer || haveIWon;
      btnBluff.style.opacity = (amILastPlayer || haveIWon) ? '0.5' : '1';

      this.startChallengeCountdown(state.challengeEndsAt);
    } else {
      challengeControls.style.display = 'none';
      if (this.challengeTimerInterval) {
        clearInterval(this.challengeTimerInterval);
        this.challengeTimerInterval = null;
      }
    }

    this.renderTableSeats(state);
    this.renderPlayerHand(state.yourHand || [], state);
  }

  renderTableSeats(state) {
    const container = document.getElementById('table-seats-container');
    container.innerHTML = '';

    const players = state.players;
    const count = players.length;
    if (count === 0) return;

    const myIndex = players.findIndex(p => p.id === this.myId);
    const rotationOffset = myIndex !== -1 ? myIndex : 0;

    const rx = 44;
    const ry = 42;

    for (let i = 0; i < count; i++) {
      const relativeIndex = (i - rotationOffset + count) % count;
      const angle = (relativeIndex / count) * 2 * Math.PI + (Math.PI / 2);

      const leftPercent = 50 + rx * Math.cos(angle);
      const topPercent = 50 + ry * Math.sin(angle);

      const p = players[i];
      const isTurn = state.currentTurnPlayerId === p.id;
      const isMe = p.id === this.myId;

      const seatNode = document.createElement('div');
      seatNode.className = `seat-node ${isTurn ? 'is-active' : ''} ${p.isSpeaking ? 'speaking' : ''}`;
      seatNode.id = `seat-player-${p.id}`;
      seatNode.style.left = `${leftPercent}%`;
      seatNode.style.top = `${topPercent}%`;

      let statusBadge = '';
      if (p.hasWon) {
        statusBadge = `<div class="seat-status-tag won">#${p.rank} Place 🏆</div>`;
      } else if (isTurn) {
        statusBadge = `<div class="seat-status-tag">Thinking...</div>`;
      }

      seatNode.innerHTML = `
        <div class="seat-avatar-wrap">
          ${p.avatar}
          <div class="seat-card-count">${p.cardCount}</div>
        </div>
        <div class="seat-name">${this.escapeHtml(p.name)} ${isMe ? '(You)' : ''}</div>
        ${statusBadge}
      `;

      container.appendChild(seatNode);
    }
  }

  renderPlayerHand(hand, state) {
    const container = document.getElementById('player-cards-scroll');
    const yourCountEl = document.getElementById('your-cards-count');
    yourCountEl.textContent = hand.length;

    const sortedHand = [...hand];
    if (this.sortMode === 'rank') {
      const rankOrder = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'JOKER': 14 };
      sortedHand.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
    } else {
      const suitOrder = { '♠': 1, '♥': 2, '♦': 3, '♣': 4, '★': 5 };
      sortedHand.sort((a, b) => (suitOrder[a.suit] || 0) - (suitOrder[b.suit] || 0));
    }

    container.innerHTML = '';

    for (const card of sortedHand) {
      const isSelected = this.selectedCardIds.has(card.id);
      const cardEl = document.createElement('div');
      cardEl.className = `playing-card ${card.color} ${card.isJoker ? 'joker-card' : ''} ${isSelected ? 'selected' : ''}`;
      cardEl.setAttribute('data-id', card.id);

      if (card.isJoker) {
        cardEl.innerHTML = `
          <div class="card-top">
            <span class="card-rank">★</span>
            <span class="card-suit-sm">JOKER</span>
          </div>
          <div class="card-center-suit">🃏</div>
          <div class="card-bottom">
            <span class="card-rank">★</span>
            <span class="card-suit-sm">WILD</span>
          </div>
        `;
      } else {
        cardEl.innerHTML = `
          <div class="card-top">
            <span class="card-rank">${card.rank}</span>
            <span class="card-suit-sm">${card.suit}</span>
          </div>
          <div class="card-center-suit">${card.suit}</div>
          <div class="card-bottom">
            <span class="card-rank">${card.rank}</span>
            <span class="card-suit-sm">${card.suit}</span>
          </div>
        `;
      }

      cardEl.addEventListener('click', () => {
        this.toggleCardSelection(card.id);
      });

      container.appendChild(cardEl);
    }

    const isMyTurn = state.currentTurnPlayerId === this.myId;
    const btnPlay = document.getElementById('btn-play-cards');
    const btnPass = document.getElementById('btn-pass-turn');
    const freeRankSelect = document.getElementById('free-rank-select');

    const selectedCount = this.selectedCardIds.size;
    const canPlay = isMyTurn && selectedCount >= 1 && selectedCount <= 4 && !state.challengeEndsAt;

    btnPlay.disabled = !canPlay;

    if (state.settings.ruleMode === 'sequential') {
      freeRankSelect.style.display = 'none';
      btnPass.style.display = 'none';
      btnPlay.textContent = isMyTurn 
        ? `Play ${selectedCount} as ${state.currentRequiredRank}s` 
        : `Waiting for turn (${selectedCount} selected)`;
    } else {
      const isLead = !state.lastPlay || state.pileCount === 0;
      if (isLead && isMyTurn) {
        freeRankSelect.style.display = 'inline-block';
      } else {
        freeRankSelect.style.display = 'none';
      }
      btnPass.style.display = isMyTurn && !isLead ? 'inline-block' : 'none';

      const targetRank = isLead ? freeRankSelect.value : state.currentRequiredRank;
      btnPlay.textContent = isMyTurn ? `Play ${selectedCount} as ${targetRank}s` : `Wait for turn`;
    }
  }

  toggleCardSelection(cardId) {
    if (this.selectedCardIds.has(cardId)) {
      this.selectedCardIds.delete(cardId);
      window.soundManager.playCardSlide();
    } else {
      if (this.selectedCardIds.size >= 4) {
        this.showToast('You can select a maximum of 4 cards per turn.');
        return;
      }
      this.selectedCardIds.add(cardId);
      window.soundManager.playCardSlide();
    }
    if (this.gameState) {
      this.renderPlayerHand(this.gameState.yourHand || [], this.gameState);
    }
  }

  startChallengeCountdown(endTime) {
    if (this.challengeTimerInterval) clearInterval(this.challengeTimerInterval);

    const progressBar = document.getElementById('challenge-progress-bar');
    const totalDuration = (this.gameState && this.gameState.settings.challengeWindow ? this.gameState.settings.challengeWindow : 7) * 1000;

    this.challengeTimerInterval = setInterval(() => {
      const remaining = endTime - Date.now();
      if (remaining <= 0) {
        progressBar.style.width = '0%';
        clearInterval(this.challengeTimerInterval);
        this.challengeTimerInterval = null;
      } else {
        const percent = Math.max(0, Math.min(100, (remaining / totalDuration) * 100));
        progressBar.style.width = `${percent}%`;
      }
    }, 50);
  }

  showBluffReveal(data) {
    const modal = document.getElementById('modal-reveal');
    const banner = document.getElementById('reveal-banner');
    const summary = document.getElementById('reveal-summary-text');
    const cardsRow = document.getElementById('reveal-cards-container');
    const penaltyText = document.getElementById('reveal-penalty-text');

    cardsRow.innerHTML = '';

    if (data.isBluff) {
      banner.className = 'reveal-verdict-banner caught';
      banner.textContent = '🚨 BLUFF CAUGHT!';
      window.soundManager.playCaught();
      summary.innerHTML = `<strong>${this.escapeHtml(data.targetName)}</strong> was caught bluffing by <strong>${this.escapeHtml(data.challengerName)}</strong>!`;
      penaltyText.textContent = `💥 ${data.penaltyPlayerName} picks up all ${data.pileCount} cards!`;
    } else {
      banner.className = 'reveal-verdict-banner innocent';
      banner.textContent = '🛡️ TRUTHFUL PLAY!';
      window.soundManager.playInnocent();
      summary.innerHTML = `<strong>${this.escapeHtml(data.targetName)}</strong> was telling the truth! <strong>${this.escapeHtml(data.challengerName)}</strong> made a false accusation.`;
      penaltyText.textContent = `💥 ${data.penaltyPlayerName} picks up all ${data.pileCount} cards as penalty!`;
    }

    data.playedCards.forEach((c, idx) => {
      const cardContainer = document.createElement('div');
      cardContainer.className = 'flip-card-container';

      const inner = document.createElement('div');
      inner.className = 'flip-card-inner';

      const front = document.createElement('div');
      front.className = 'flip-card-front';

      const back = document.createElement('div');
      back.className = `flip-card-back ${c.color || 'black'}`;
      if (c.isJoker) {
        back.innerHTML = `
          <div style="font-size:12px; font-weight:800; color:#8e44ad;">★ JOKER</div>
          <div style="font-size:30px; text-align:center;">🃏</div>
          <div style="font-size:10px; font-weight:700; color:#8e44ad; text-align:right;">WILD TRUTH</div>
        `;
      } else {
        back.innerHTML = `
          <div style="font-size:14px; font-weight:800; line-height:1;">${c.rank}<br><span style="font-size:12px;">${c.suit}</span></div>
          <div style="font-size:28px; text-align:center;">${c.suit}</div>
          <div style="font-size:14px; font-weight:800; line-height:1; transform:rotate(180deg); text-align:left;">${c.rank}<br><span style="font-size:12px;">${c.suit}</span></div>
        `;
      }

      inner.appendChild(front);
      inner.appendChild(back);
      cardContainer.appendChild(inner);
      cardsRow.appendChild(cardContainer);

      setTimeout(() => {
        inner.classList.add('flipped');
        window.soundManager.playCardSlide();
      }, 300 + (idx * 250));
    });

    modal.classList.add('active');

    setTimeout(() => {
      modal.classList.remove('active');
    }, 4200);
  }

  showGameOverModal(winners) {
    const modal = document.getElementById('modal-gameover');
    const podiumList = document.getElementById('podium-list');
    podiumList.innerHTML = '';

    window.soundManager.playVictory();

    winners.forEach((w) => {
      const item = document.createElement('div');
      const medals = ['🥇', '🥈', '🥉'];
      const medal = medals[w.place - 1] || '🏅';
      item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-radius:12px; background:rgba(255,255,255,0.06); font-weight:700;';
      item.innerHTML = `
        <span style="font-size:20px;">${medal} ${this.escapeHtml(w.name)}</span>
        <span style="color:var(--accent-gold);">${w.place}${this.getOrdinal(w.place)} Place</span>
      `;
      podiumList.appendChild(item);
    });

    modal.classList.add('active');
  }

  getOrdinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  }

  updatePlayerVoiceState(playerId, isMuted, isSpeaking) {
    this.updateAvatarSpeaking(playerId, isSpeaking);
  }

  updateAvatarSpeaking(playerId, isSpeaking) {
    const seat = document.getElementById(`seat-player-${playerId}`);
    if (seat) {
      if (isSpeaking) {
        seat.classList.add('speaking');
      } else {
        seat.classList.remove('speaking');
      }
    }
  }

  appendChatMessage(msg) {
    const container = document.getElementById('chat-messages-container');
    const div = document.createElement('div');

    if (msg.isSystem) {
      div.className = 'chat-msg is-system';
      div.textContent = msg.text;
    } else {
      const isMe = msg.playerId === this.myId;
      div.className = 'chat-msg';
      div.innerHTML = `
        <div class="chat-msg-user">${this.escapeHtml(msg.playerName)} ${isMe ? '(You)' : ''}</div>
        <div class="chat-msg-bubble">${this.escapeHtml(msg.text)}</div>
      `;
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  showToast(text) {
    const toast = document.getElementById('toast');
    toast.textContent = text;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }
}

// Global App Instance
window.bluffApp = new BluffApp();

// Global UI Action Handlers
function openHostModal() {
  const nameInput = document.getElementById('input-player-name');
  if (!nameInput.value.trim()) {
    window.bluffApp.showToast('Please enter your nickname first!');
    nameInput.focus();
    return;
  }
  document.getElementById('modal-host').classList.add('active');
}

function openJoinModal() {
  const nameInput = document.getElementById('input-player-name');
  if (!nameInput.value.trim()) {
    window.bluffApp.showToast('Please enter your nickname first!');
    nameInput.focus();
    return;
  }
  document.getElementById('modal-join').classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function confirmHostRoom() {
  const name = document.getElementById('input-player-name').value.trim() || 'Host';
  const avatar = window.bluffApp.myAvatar;
  localStorage.setItem('bluff_name', name);

  const settings = {
    maxPlayers: Number(document.getElementById('host-max-players').value),
    deckCountMode: document.getElementById('host-deck-mode').value,
    jokers: Number(document.getElementById('host-jokers').value),
    ruleMode: document.getElementById('host-rule-mode').value,
    turnTimeLimit: Number(document.getElementById('host-turn-timer').value),
    challengeWindow: Number(document.getElementById('host-challenge-window').value)
  };

  window.bluffApp.myName = name;
  window.bluffApp.send({
    type: 'HOST_ROOM',
    payload: { name, avatar, settings }
  });
}

function confirmJoinRoom() {
  const name = document.getElementById('input-player-name').value.trim() || 'Player';
  const roomCode = document.getElementById('join-room-code').value.trim().toUpperCase();
  const avatar = window.bluffApp.myAvatar;

  if (!roomCode) {
    window.bluffApp.showToast('Please enter a room code');
    return;
  }

  localStorage.setItem('bluff_name', name);
  window.bluffApp.myName = name;

  window.bluffApp.send({
    type: 'JOIN_ROOM',
    payload: { roomCode, name, avatar }
  });
}

function copyInviteLink() {
  if (!window.bluffApp.roomCode) return;
  const link = `${window.location.origin}/?room=${window.bluffApp.roomCode}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(() => {
      window.bluffApp.showToast('🔗 Invite link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this invite link:', link);
    });
  } else {
    prompt('Copy this invite link:', link);
  }
}

function startGame() {
  window.bluffApp.send({ type: 'START_GAME' });
}

function playSelectedCards() {
  const cardIds = Array.from(window.bluffApp.selectedCardIds);
  if (cardIds.length === 0 || cardIds.length > 4) {
    window.bluffApp.showToast('Select between 1 and 4 cards to play.');
    return;
  }

  let claimedRank = null;
  if (window.bluffApp.gameState && window.bluffApp.gameState.settings.ruleMode === 'free') {
    const isLead = !window.bluffApp.gameState.lastPlay || window.bluffApp.gameState.pileCount === 0;
    if (isLead) {
      claimedRank = document.getElementById('free-rank-select').value;
    }
  }

  window.bluffApp.send({
    type: 'PLAY_CARDS',
    payload: { cardIds, claimedRank }
  });

  window.soundManager.playCardDeal();
  window.bluffApp.selectedCardIds.clear();
}

function passTurn() {
  window.bluffApp.send({ type: 'PASS_TURN' });
}

function callBluff() {
  window.soundManager.playBluffAlert();
  window.bluffApp.send({ type: 'CALL_BLUFF' });
}

function sortHand(mode) {
  window.bluffApp.sortMode = mode;
  if (window.bluffApp.gameState) {
    window.bluffApp.renderPlayerHand(window.bluffApp.gameState.yourHand || [], window.bluffApp.gameState);
  }
}

function toggleMicrophone() {
  const isEnabledNow = window.bluffApp.voiceManager.toggleMute();
  const micBtn = document.getElementById('btn-mic');
  const micIcon = document.getElementById('mic-icon');

  if (isEnabledNow) {
    micBtn.className = 'btn-icon active';
    micBtn.title = 'Microphone Active (Speaking Enabled)';
    micIcon.textContent = '🎙️';
    window.bluffApp.showToast('Microphone unmuted 🎙️');
  } else {
    micBtn.className = 'btn-icon muted';
    micBtn.title = 'Microphone Muted';
    micIcon.textContent = '🎤';
    window.bluffApp.showToast('Microphone muted 🔇');
  }
}

function toggleSound() {
  const isMuted = window.soundManager.toggleMute();
  const btn = document.getElementById('btn-sound');
  const icon = document.getElementById('sound-icon');

  if (isMuted) {
    btn.className = 'btn-icon muted';
    icon.textContent = '🔇';
    window.bluffApp.showToast('Sound effects muted');
  } else {
    btn.className = 'btn-icon';
    icon.textContent = '🔊';
    window.soundManager.playTurnChime();
    window.bluffApp.showToast('Sound effects enabled');
  }
}

function toggleChatDrawer() {
  const drawer = document.getElementById('chat-drawer');
  drawer.classList.toggle('open');
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  window.bluffApp.send({
    type: 'CHAT_MESSAGE',
    payload: { text }
  });

  input.value = '';
}

function sendQuickChat(emoteText) {
  window.bluffApp.send({
    type: 'CHAT_MESSAGE',
    payload: { text: emoteText }
  });
}

function returnToLobby() {
  document.getElementById('modal-gameover').classList.remove('active');
  window.bluffApp.send({ type: 'LEAVE_ROOM' });
  window.location.reload();
}
