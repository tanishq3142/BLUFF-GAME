# 🃏 BLUFF (Cheat / I Doubt It)

> The classic party card game of deception, wildcards, and high-stakes calls — playable online with **2 to 16 players** with integrated **live voice chat**.

*Developed with ❤️ by **Tanishq__***

---

## 📖 Overview

**Bluff** (also widely known as *Cheat*, *I Doubt It*, or *BS*) is a social deception card game where players attempt to discard all the cards in their hand. The catch: cards are played face down, and players can lie about what they are playing — unless an opponent calls **"BLUFF!"** to challenge them.

This web version brings the experience online with real-time peer-to-peer voice chat, customizable decks, wild Jokers, and responsive gameplay optimized for both mobile phones and desktops.

---

## 🌟 Features

- **Dynamic Player Count (2 to 16 Players)**: Play 1-on-1 duels or host massive 16-player party rooms. The oval poker table automatically adjusts its geometry and seats dynamically.
- **🎙️ Real-time WebRTC Voice Chat**: Talk with opponents directly in your browser. Features live microphone mute/unmute and glowing audio visualizer rings around the player avatar when speaking.
- **💬 In-Game Chat & Quick Emotes**: Send text messages and express yourself with quick reaction buttons (`🤨 Sus`, `🤥 Liar!`, `🔥 Bluff!`, `🃏 Master`, `👏 GG`).
- **🃏 Customizable Card Decks & Wild Jokers**:
  - Choose between 1 Deck (52 cards), 2 Decks (104 cards), 3 Decks (156 cards), or Auto-deck scaling based on player count.
  - Optional **Jokers (0, 2, 4)**: Jokers act as wild cards and are **always considered truthful matches** for any claimed rank.
- **🚨 Dramatic Bluff Reveal**:
  - Pulsating challenge button with a real-time countdown timer.
  - 3D card-flip reveal animation showing the played cards one-by-one.
  - Instant visual and audio verdicts (`🚨 BLUFF CAUGHT!` or `🛡️ INNOCENT!`).
  - Penalty cards are picked up into the loser's hand automatically.
- **🛡️ Mid-Game Disconnect Protection**: If a player leaves mid-game, their cards are cleanly deposited into the center pile, and turns automatically advance so the game never freezes.
- **🔊 Procedural Sound Effects**: Dynamic audio synthesizer using Web Audio API for card dealing, card sliding, siren alerts, and victory fanfares.
- **📱 Mobile & Desktop Optimized**: Responsive touch controls, horizontal swipeable card tray, and scalable table felt designed for screens from small smartphones to large monitors.

---

## 🎯 Game Rules & Setup

### 1. Setup & Deal
- **Players**: 2 to 16 players.
- **Dealing**: Cards are shuffled and dealt out as evenly as possible to all players. Hands are kept hidden.

### 2. Playing a Turn
- On your turn, select between **1 and 4 cards** from your hand and place them face down into the center discard pile.
- Declare the rank of the cards you played (e.g., *"Three Aces"* or *"Two Kings"*).
- You can tell the truth if you have those cards, or you can bluff and play any other cards!

### 3. Wild Jokers
- If Jokers are included in the room settings, they act as universal wildcards.
- A Joker is **always counted as a truthful match** for whatever rank was declared.

### 4. Calling Bluff
- During the challenge countdown after a card is played, any other player can press **"CALL BLUFF!"**.
- The played cards are flipped face up for everyone to see:
  - **If the player was bluffing**: The liar must take all the cards in the center discard pile into their hand!
  - **If the player told the truth**: The challenger must take all the cards in the center discard pile as a penalty!
- If nobody calls Bluff, the cards remain face down in the pile, and the next player takes their turn.

### 5. Winning the Game
- The first player to successfully discard all the cards from their hand wins the match (1st Place).
- Subsequent rankings (2nd, 3rd) are tracked on the victory podium until the game concludes.

---

## 🎨 Watermark & Credits

- **Game**: Bluff (Cheat / I Doubt It) Multiplayer
- **Developer**: **Tanishq__**
- **License**: MIT
