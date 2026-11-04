# 🃏 BLUFF (Cheat / I Doubt It) - Multiplayer Card & Voice Game

*Developed with ❤️ by **Tanishq__***

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Players](https://img.shields.io/badge/players-2%20to%2016-gold.svg)
![Voice](https://img.shields.io/badge/voice-WebRTC%20Mesh-blue.svg)
![Mobile & Desktop](https://img.shields.io/badge/platform-Mobile%20%7C%20Desktop-purple.svg)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

An online multiplayer adaptation of the classic social deception card party game **Bluff** (also known as *Cheat*, *I Doubt It*, or *BS*), supporting **2 to 16 players** with **integrated WebRTC voice chat**, real-time text chat, customizable decks, wild Jokers, and automated disconnect handling.

Fully optimized and responsive across **mobile phones, tablets, and desktop computers**.

Built to be **100% ready for instant deployment to Vercel in a single commit**, with zero external npm dependencies.

---

## 🌟 Key Features

- **2 to 16 Players Supported**: Smoothly accommodates party groups from intimate 2-4 player duels to large 16-player games with dynamic trigonometric table seating.
- **🎙️ Real-time Voice Chat**: Peer-to-peer WebRTC audio mesh with microphone mute/unmute, speaking visualizer rings around avatars, and zero external voice servers.
- **💬 Live Text Chat & Emotes**: In-game drawer for messaging, game log notifications, and quick reaction buttons (`🤨 Sus`, `🤥 Liar!`, `🔥 Bluff!`, `🃏 Master`, `👏 GG`).
- **👑 Dynamic Room Hosting & Joining**:
  - **HOST**: Configure max players (2-16), deck counts (1, 2, 3, or Auto), Joker wildcards (0, 2, 4), game modes, and timers.
  - **JOIN**: Enter a 6-character room code or join directly via shareable invite links (`?room=XYZ123`).
  - **🔗 1-Click Link Sharing**: Copy invite links with automatic clipboard copy and toast notifications.
- **🃏 Authentic Card Rules & Jokers**:
  - Cards dealt evenly to all players with hands kept strictly hidden server-side.
  - **Jokers as Wildcards**: Jokers count as wildcards and are always considered a truthful match for any claimed rank!
  - **Rule Modes**: Classic Sequential rank mode (`A -> 2 -> 3 ... K -> A`) or Free Rank mode (lead player chooses the rank).
- **🚨 Dramatic Bluff Challenge**:
  - Pulsating "CALL BLUFF!" button during the challenge countdown.
  - 3D card flip reveal animation showing played cards with instant verdict banners (`CAUGHT!` or `INNOCENT!`).
  - Liar or false challenger picks up the entire center discard pile!
- **🛡️ Mid-Game Player Departure Handling**:
  - If a player disconnects or leaves mid-game, their cards are cleanly deposited into the center pile or cleared.
  - Turns and active challenges automatically advance without stalling or breaking the room.
- **🔊 Procedural Sound Synthesizer**: Web Audio API generates realistic card dealing, card sliding, bluff sirens, and victory fanfare without needing external audio files.
- **⚡ Dual-Transport Architecture**: Works seamlessly on both **Vercel Serverless** (auto HTTP sync) and **Node.js WebSockets** for local / VPS hosting.

---

## 🎮 How to Play Bluff

1. **The Deal**: All cards from the chosen deck(s) are distributed evenly among all players.
2. **The Play**: On your turn, place 1 to 4 cards face down into the center discard pile and declare what rank they are (e.g., *"Three Kings"*).
3. **The Bluff**: You may tell the truth, or you may lie and play cards of any other rank!
4. **Wild Jokers**: If Jokers are included, they act as wild cards and are **always considered truthful**.
5. **The Challenge**: Any other player can call **"BLUFF!"** during the challenge window.
   - If the player was **bluffing**: The liar takes the entire center discard pile into their hand.
   - If the player was **truthful**: The challenger takes the entire center discard pile as penalty!
6. **Winning the Game**: The first player to successfully discard all cards from their hand wins!

---

## 🚀 Deploy to Vercel (1-Click)

### Method 1: Via Vercel Web Dashboard (Recommended)

1. Push this repository to your GitHub / GitLab account:
   ```bash
   git remote add origin https://github.com/<your-username>/bluff-game.git
   git branch -M main
   git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Keep the default settings (Framework Preset: **Other**, Root Directory: `./`).
4. Click **Deploy**! Vercel will deploy the site in ~30 seconds.

### Method 2: Via Vercel CLI

```bash
npm install -g vercel
vercel
```

Follow the prompts and select the defaults.

---

## 💻 Running Locally

You can run the game server locally using standard Node.js:

```bash
# Start server
npm start
```

Or on Windows, simply double-click **`start.bat`**.

Then open your browser at:
```
http://localhost:3000
```

---

## 📁 Repository Structure

```
.
├── api/
│   └── game.js         # Vercel Serverless Function (game state, sync & signaling)
├── public/
│   ├── index.html      # Game interface (Landing, Lobby, 16-player Table, Modals)
│   ├── style.css       # Luxury casino felt theme & responsive dynamic seating
│   ├── app.js          # Client game engine & dual WebSocket/HTTP transport
│   ├── webrtc.js       # WebRTC peer-to-peer voice mesh & speaking detection
│   └── audio.js        # Procedural Web Audio API sound effect synthesizer
├── engine.js           # Core Bluff game engine (cards, rules, room management)
├── server.js           # Zero-dependency Node.js HTTP & WebSocket server
├── package.json        # Project metadata and start scripts
├── vercel.json         # Vercel serverless routing configuration
├── start.bat           # Windows 1-click launcher
├── start.ps1           # PowerShell launcher
└── README.md           # Documentation
```

---

## 📜 License

MIT License. Free to play, modify, and host.
