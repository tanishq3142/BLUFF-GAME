// Core Bluff Game Engine
// Shared by both server.js (WebSocket server) and api/game.js (Vercel Serverless)

const SUITS = [
  { symbol: '♠', name: 'spades', color: 'black' },
  { symbol: '♥', name: 'hearts', color: 'red' },
  { symbol: '♦', name: 'diamonds', color: 'red' },
  { symbol: '♣', name: 'clubs', color: 'black' }
];

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function generateDeck(deckCount = 1, jokerCount = 2) {
  const cards = [];
  let cardId = 1;

  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `c_${cardId++}`,
          suit: suit.symbol,
          suitName: suit.name,
          color: suit.color,
          rank: rank,
          isJoker: false
        });
      }
    }
  }

  for (let j = 0; j < jokerCount; j++) {
    cards.push({
      id: `j_${cardId++}`,
      suit: '★',
      suitName: 'joker',
      color: j % 2 === 0 ? 'red' : 'black',
      rank: 'JOKER',
      isJoker: true
    });
  }

  // Fisher-Yates Shuffle
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function getNextRank(currentRank) {
  if (!currentRank) return 'A';
  const idx = RANKS.indexOf(currentRank);
  if (idx === -1 || idx === RANKS.length - 1) return RANKS[0];
  return RANKS[idx + 1];
}

class Room {
  constructor(code, hostId, hostName, settings = {}) {
    this.code = code;
    this.hostId = hostId;
    this.players = []; // Array of Player objects
    this.state = 'LOBBY'; // LOBBY, PLAYING, GAME_OVER
    this.lastActivity = Date.now();

    this.settings = {
      maxPlayers: Math.max(2, Math.min(16, Number(settings.maxPlayers) || 16)),
      deckCountMode: settings.deckCountMode || 'auto',
      jokers: Number(settings.jokers) ?? 2,
      ruleMode: settings.ruleMode || 'sequential',
      turnTimeLimit: Number(settings.turnTimeLimit) ?? 30,
      challengeWindow: Number(settings.challengeWindow) ?? 7
    };

    this.pile = [];
    this.currentTurnIndex = 0;
    this.currentRequiredRank = 'A';
    this.lastPlay = null;
    this.turnEndsAt = 0;
    this.challengeEndsAt = 0;
    this.consecutivePasses = 0;
    this.passedPlayerIds = new Set();
    this.roundNumber = 1;
    this.winners = [];
    this.messages = [];
    this.revealEvent = null;

    // WebRTC signaling mailbox: peerId -> array of signals
    this.signals = new Map();
  }

  touch() {
    this.lastActivity = Date.now();
  }

  getEffectiveDeckCount() {
    if (this.settings.deckCountMode === 'auto') {
      const count = this.players.length;
      if (count <= 5) return 1;
      if (count <= 10) return 2;
      return 3;
    }
    return Math.max(1, Math.min(3, Number(this.settings.deckCountMode) || 1));
  }

  addPlayer(player) {
    this.touch();
    if (this.players.length >= this.settings.maxPlayers) {
      return { success: false, message: `Room is full (max ${this.settings.maxPlayers} players)` };
    }
    if (this.state !== 'LOBBY') {
      return { success: false, message: 'Game has already started in this room' };
    }
    this.players.push(player);
    this.broadcastSystemMessage(`👋 ${player.name} joined the room!`);
    return { success: true };
  }

  removePlayer(playerId) {
    this.touch();
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx === -1) return null;

    const removedPlayer = this.players[idx];
    this.players.splice(idx, 1);

    if (this.hostId === playerId && this.players.length > 0) {
      this.hostId = this.players[0].id;
    }

    if (this.state === 'PLAYING') {
      this.handleMidGamePlayerDeparture(removedPlayer, idx);
    } else {
      this.broadcastSystemMessage(`${removedPlayer.name} left the room.`);
    }

    return removedPlayer;
  }

  handleMidGamePlayerDeparture(player, removedIdx) {
    if (player.hand && player.hand.length > 0) {
      for (const card of player.hand) {
        card.playedBy = player.id;
        this.pile.push(card);
      }
      this.broadcastSystemMessage(`⚠️ ${player.name} left the game. Their ${player.hand.length} card(s) were added to the center pile.`);
    } else {
      this.broadcastSystemMessage(`⚠️ ${player.name} left the game.`);
    }

    const activePlayers = this.players.filter(p => !p.hasWon);
    if (activePlayers.length < 2) {
      this.broadcastSystemMessage(`🏁 Not enough players remaining. Returning to lobby.`);
      this.state = 'LOBBY';
      return;
    }

    if (this.currentTurnIndex >= this.players.length) {
      this.currentTurnIndex = 0;
    }

    if (this.lastPlay && this.lastPlay.playerId === player.id) {
      this.lastPlay = null;
      this.challengeEndsAt = 0;
      this.startTurn();
    } else if (removedIdx === this.currentTurnIndex) {
      this.startTurn();
    }
  }

  startGame() {
    this.touch();
    if (this.players.length < 2) {
      return { success: false, message: 'Need at least 2 players to start Bluff' };
    }

    this.state = 'PLAYING';
    this.winners = [];
    this.pile = [];
    this.lastPlay = null;
    this.revealEvent = null;
    this.consecutivePasses = 0;
    this.passedPlayerIds.clear();

    const deckCount = this.getEffectiveDeckCount();
    const jokerCount = this.settings.jokers;
    const cards = generateDeck(deckCount, jokerCount);

    for (const player of this.players) {
      player.hand = [];
      player.hasWon = false;
      player.rank = null;
    }

    let playerIdx = 0;
    while (cards.length > 0) {
      this.players[playerIdx].hand.push(cards.pop());
      playerIdx = (playerIdx + 1) % this.players.length;
    }

    this.currentTurnIndex = Math.floor(Math.random() * this.players.length);
    this.currentRequiredRank = 'A';
    this.roundNumber = 1;

    this.broadcastSystemMessage(`🎲 Game started! ${deckCount} deck(s) with ${jokerCount} Jokers dealt. ${this.players[this.currentTurnIndex].name} leads with Aces!`);
    this.startTurn();
    return { success: true };
  }

  startTurn() {
    this.touch();
    const activePlayers = this.players.filter(p => !p.hasWon);
    if (activePlayers.length <= 1) {
      this.finishGame();
      return;
    }

    let attempts = 0;
    while (this.players[this.currentTurnIndex].hasWon && attempts < this.players.length) {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
      attempts++;
    }

    if (this.settings.turnTimeLimit > 0) {
      this.turnEndsAt = Date.now() + (this.settings.turnTimeLimit * 1000);
    } else {
      this.turnEndsAt = 0;
    }
  }

  processPlay(playerId, cardIds, claimedRank) {
    this.touch();
    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex !== this.currentTurnIndex) {
      return { success: false, message: "It's not your turn!" };
    }

    if (this.challengeEndsAt && Date.now() < this.challengeEndsAt) {
      return { success: false, message: 'Challenge window in progress!' };
    }

    const player = this.players[playerIndex];
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 4) {
      return { success: false, message: 'You must play between 1 and 4 cards.' };
    }

    const playedCards = [];
    for (const id of cardIds) {
      const cIdx = player.hand.findIndex(c => c.id === id);
      if (cIdx === -1) {
        return { success: false, message: 'Selected card not found in your hand.' };
      }
      playedCards.push(player.hand[cIdx]);
    }

    let effectiveClaimedRank = claimedRank;
    if (this.settings.ruleMode === 'sequential') {
      effectiveClaimedRank = this.currentRequiredRank;
    } else {
      if (!this.lastPlay || this.pile.length === 0) {
        effectiveClaimedRank = claimedRank || 'A';
      } else {
        effectiveClaimedRank = this.currentRequiredRank;
      }
    }

    player.hand = player.hand.filter(c => !cardIds.includes(c.id));
    playedCards.forEach(c => c.playedBy = player.id);

    for (const c of playedCards) {
      this.pile.push(c);
    }

    this.consecutivePasses = 0;
    this.passedPlayerIds.clear();

    this.lastPlay = {
      playerId: player.id,
      playerName: player.name,
      count: playedCards.length,
      claimedRank: effectiveClaimedRank,
      cards: playedCards,
      timestamp: Date.now()
    };

    const countText = playedCards.length === 1 ? '1 card' : `${playedCards.length} cards`;
    this.broadcastSystemMessage(`🃏 ${player.name} played ${countText} as ${effectiveClaimedRank}s.`);

    if (player.hand.length === 0) {
      this.broadcastSystemMessage(`🔥 ${player.name} played their last card! Waiting for challenge...`);
    }

    const challengeSeconds = this.settings.challengeWindow || 7;
    this.challengeEndsAt = Date.now() + (challengeSeconds * 1000);
    return { success: true };
  }

  processPass(playerId) {
    this.touch();
    if (this.settings.ruleMode === 'sequential') {
      return { success: false, message: 'Passing is only allowed in Free Rank mode.' };
    }

    const playerIndex = this.players.findIndex(p => p.id === playerId);
    if (playerIndex !== this.currentTurnIndex) {
      return { success: false, message: "It's not your turn!" };
    }

    if (this.pile.length === 0) {
      return { success: false, message: 'You are leading! You must play at least 1 card.' };
    }

    const player = this.players[playerIndex];
    this.passedPlayerIds.add(player.id);
    this.consecutivePasses++;

    this.broadcastSystemMessage(`⏭️ ${player.name} passed.`);

    const activeCount = this.players.filter(p => !p.hasWon).length;
    if (this.consecutivePasses >= activeCount - 1) {
      this.broadcastSystemMessage(`✨ All players passed! Center pile of ${this.pile.length} cards cleared.`);
      this.pile = [];
      this.lastPlay = null;
      this.consecutivePasses = 0;
      this.passedPlayerIds.clear();
      this.startTurn();
      return { success: true };
    }

    this.advanceTurn();
    return { success: true };
  }

  checkChallengeExpiry() {
    if (this.challengeEndsAt && Date.now() >= this.challengeEndsAt) {
      this.challengeEndsAt = 0;
      if (this.lastPlay) {
        const player = this.players.find(p => p.id === this.lastPlay.playerId);
        if (player && player.hand.length === 0 && !player.hasWon) {
          this.registerWinner(player);
        }

        if (this.settings.ruleMode === 'sequential') {
          this.currentRequiredRank = getNextRank(this.currentRequiredRank);
        }
        this.lastPlay = null;
        this.advanceTurn();
      }
    }
  }

  processChallenge(challengerId) {
    this.touch();
    if (!this.lastPlay) {
      return { success: false, message: 'No active play to challenge!' };
    }

    if (challengerId === this.lastPlay.playerId) {
      return { success: false, message: 'You cannot call Bluff on yourself!' };
    }

    const challenger = this.players.find(p => p.id === challengerId);
    if (!challenger || challenger.hasWon) {
      return { success: false, message: 'Only active players can call Bluff.' };
    }

    const targetPlayer = this.players.find(p => p.id === this.lastPlay.playerId);
    if (!targetPlayer) {
      return { success: false, message: 'Target player not found.' };
    }

    this.challengeEndsAt = 0;

    const playedCards = this.lastPlay.cards;
    const claimedRank = this.lastPlay.claimedRank;

    let isBluff = false;
    for (const card of playedCards) {
      if (card.isJoker) continue;
      if (card.rank !== claimedRank) {
        isBluff = true;
        break;
      }
    }

    const pileCardsCount = this.pile.length;

    const revealData = {
      id: 'rev_' + Date.now(),
      challengerId: challenger.id,
      challengerName: challenger.name,
      targetId: targetPlayer.id,
      targetName: targetPlayer.name,
      claimedRank: claimedRank,
      playedCards: playedCards,
      isBluff: isBluff,
      pileCount: pileCardsCount,
      timestamp: Date.now()
    };

    if (isBluff) {
      this.broadcastSystemMessage(`🚨 BLUFF CAUGHT! ${targetPlayer.name} was lying! ${targetPlayer.name} picks up all ${pileCardsCount} cards!`);
      targetPlayer.hand.push(...this.pile);
      this.pile = [];
      revealData.penaltyPlayerId = targetPlayer.id;
      revealData.penaltyPlayerName = targetPlayer.name;
      this.currentTurnIndex = this.players.findIndex(p => p.id === challenger.id);
    } else {
      this.broadcastSystemMessage(`🛡️ INNOCENT! ${targetPlayer.name} was telling the truth! ${challenger.name} picks up all ${pileCardsCount} cards!`);
      challenger.hand.push(...this.pile);
      this.pile = [];
      revealData.penaltyPlayerId = challenger.id;
      revealData.penaltyPlayerName = challenger.name;

      if (targetPlayer.hand.length === 0 && !targetPlayer.hasWon) {
        this.registerWinner(targetPlayer);
      }
      this.currentTurnIndex = this.players.findIndex(p => p.id === targetPlayer.id);
    }

    if (this.settings.ruleMode === 'sequential') {
      this.currentRequiredRank = getNextRank(this.currentRequiredRank);
    }

    this.lastPlay = null;
    this.revealEvent = revealData;
    return { success: true, reveal: revealData };
  }

  registerWinner(player) {
    player.hasWon = true;
    player.rank = this.winners.length + 1;
    this.winners.push({
      playerId: player.id,
      name: player.name,
      place: player.rank
    });

    const placeSuffix = player.rank === 1 ? '🥇 1st Place' : player.rank === 2 ? '🥈 2nd Place' : '🥉 3rd Place';
    this.broadcastSystemMessage(`🎉 ${player.name} emptied their hand and finished ${placeSuffix}!`);

    const remaining = this.players.filter(p => !p.hasWon);
    if (remaining.length <= 1) {
      if (remaining.length === 1) {
        const lastPlayer = remaining[0];
        lastPlayer.hasWon = true;
        lastPlayer.rank = this.winners.length + 1;
        this.winners.push({
          playerId: lastPlayer.id,
          name: lastPlayer.name,
          place: lastPlayer.rank
        });
      }
      this.finishGame();
    }
  }

  finishGame() {
    this.state = 'GAME_OVER';
    this.broadcastSystemMessage(`🏆 Game Over! All places determined.`);
  }

  advanceTurn() {
    this.currentTurnIndex = (this.currentTurnIndex + 1) % this.players.length;
    this.startTurn();
  }

  getPublicState(forPlayerId) {
    this.checkChallengeExpiry();

    const isPlaying = this.state === 'PLAYING';
    const currentPlayer = isPlaying && this.players[this.currentTurnIndex] ? this.players[this.currentTurnIndex].id : null;
    const playerObj = this.players.find(p => p.id === forPlayerId);

    // Get any queued WebRTC signals for this player
    const queuedSignals = this.signals.get(forPlayerId) || [];
    this.signals.delete(forPlayerId);

    return {
      code: this.code,
      hostId: this.hostId,
      state: this.state,
      settings: this.settings,
      pileCount: this.pile.length,
      currentTurnPlayerId: currentPlayer,
      currentRequiredRank: this.currentRequiredRank,
      turnEndsAt: this.turnEndsAt,
      challengeEndsAt: this.challengeEndsAt,
      lastPlay: this.lastPlay ? {
        playerId: this.lastPlay.playerId,
        playerName: this.lastPlay.playerName,
        count: this.lastPlay.count,
        claimedRank: this.lastPlay.claimedRank,
        timestamp: this.lastPlay.timestamp
      } : null,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        cardCount: p.hand ? p.hand.length : 0,
        hasWon: p.hasWon,
        rank: p.rank,
        isMuted: p.isMuted,
        isSpeaking: p.isSpeaking
      })),
      winners: this.winners,
      yourHand: playerObj && playerObj.hand ? playerObj.hand : [],
      yourId: forPlayerId,
      messages: this.messages.slice(-25),
      revealEvent: this.revealEvent,
      queuedSignals: queuedSignals
    };
  }

  queueSignal(targetId, senderId, senderName, signal) {
    if (!this.signals.has(targetId)) {
      this.signals.set(targetId, []);
    }
    this.signals.get(targetId).push({ senderId, senderName, signal });
  }

  broadcastSystemMessage(text) {
    const msg = {
      id: 'sys_' + Date.now() + Math.random().toString(36).substr(2, 4),
      isSystem: true,
      text: text,
      timestamp: Date.now()
    };
    this.messages.push(msg);
    if (this.messages.length > 50) this.messages.shift();
  }

  addChatMessage(playerId, playerName, avatar, text) {
    this.touch();
    const msg = {
      id: 'msg_' + Date.now() + Math.random().toString(36).substr(2, 4),
      playerId,
      playerName,
      avatar,
      text: text.slice(0, 300),
      timestamp: Date.now()
    };
    this.messages.push(msg);
    if (this.messages.length > 50) this.messages.shift();
    return msg;
  }
}

module.exports = {
  SUITS,
  RANKS,
  generateDeck,
  getNextRank,
  Room
};
