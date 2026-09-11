# Bored? 🥱

> A peer-to-peer virtual coworking space. No servers. No sign-ups. Just open a room and get to work.

**[🚀 Live Demo →](https://shyammvm.github.io/Bored/)**

---

## What is this?

**Bored?** is a browser-native coworking app that lets you work alongside friends or teammates in a shared virtual space — with video, audio, chat, tasks, synchronized timers, music, and a collaborative code pad — all running entirely in-browser over WebRTC with zero backend.

---

## Features

### 🎥 Video & Audio
- Peer-to-peer video/audio via **PeerJS (WebRTC)** — no media server
- Toggle mic, camera, and screen share individually
- **Deafen mode** — mutes all incoming audio so you can focus without disconnecting
- Per-device audio input/output selector
- Speaking indicator rings and animated wave badges on active tiles

### 📋 Tasks
- Personal task list with add, complete, and delete
- Progress bar tracking across your tasks
- **Room view** — see what your coworkers are currently working on
- Active task pinned to your video tile so everyone knows what you're on

### 💬 Chat
- Real-time room-wide text chat
- Unread badge counter on the tab

### ⏱️ Pomodoro Timer
- **Dual timers**: a shared room timer (synced across all peers) and a private personal one
- Modes: Focus · Short Break · Long Break
- Presets: Classic (25/5), Deep Work (50/10), Ultradian (90/20), Sprint (15/3)
- Customizable durations, long-break interval, auto-start toggles
- Alarm sounds: Tibetan Singing Bowl, Marimba Chime, Digital Beep, or mute
- Desktop notifications on session completion
- Round tracker with 🍅 tally

### 🎵 Music
- Paste any YouTube URL to load a track
- **DJ mode**: room host controls playback, all peers stay in sync
- Personal volume slider (local only) and room volume slider (universal)
- Mini playback widget in the control dock
- Audio wave visualiser animation

### 💻 Codeshare Pad
- Collaborative real-time text/code pad synced across all room peers
- Syntax mode selector: Plain Text, JavaScript, TypeScript, Python, HTML, CSS, JSON, Markdown, SQL, C++
- Line numbers, copy, download, fullscreen, and clear
- Live typing indicator showing who's editing

### 🧑‍💻 General
- Dark-mode UI out of the box (JetBrains Mono + Outfit fonts)
- Shareable room codes — copy an invite link in one click
- Custom status badges: Bored · Deep Work · Focus · Coding · Reading · Break · Ideating · or set your own with emoji
- Header glance chip shows current timer state at all times
- Resizable sidebar

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI | Vanilla HTML + CSS (no framework) |
| Logic | Vanilla JavaScript (ES modules) |
| Peer comms | [PeerJS](https://peerjs.com/) (WebRTC) |
| Icons | [Lucide](https://lucide.dev/) |
| Confetti | [canvas-confetti](https://github.com/catdad/canvas-confetti) |
| Build | [Vite](https://vitejs.dev/) |
| Deploy | GitHub Pages via GitHub Actions |

---

## Getting Started

### Prerequisites
- Node.js 18+ and npm

### Run locally

```bash
git clone https://github.com/shyammvm/Bored.git
cd Bored
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

### Build for production

```bash
npm run build
```

Output goes to `dist/`. Deployed automatically to GitHub Pages on every push to `main`.

---

## How It Works

Bored? uses **WebRTC** (via PeerJS) for all peer-to-peer communication — video, audio, and data channels. When you create a room:

1. A random room code is generated and registered as a PeerJS ID
2. Share the code or invite link with coworkers
3. Joinees connect directly to you (and through you, to each other)
4. All app state (tasks, chat, timer, music, codeshare) is broadcast over data channels

No data ever touches a server beyond the PeerJS signalling handshake.

---

## Project Structure

```
Bored/
├── index.html          # Entire app UI (single page)
├── src/
│   ├── main.js         # Entry point
│   ├── style.css       # All styles
│   └── modules/        # Feature modules (peer, tasks, chat, timer, music, codeshare…)
├── public/
│   └── logo/           # App logo
├── .github/
│   └── workflows/
│       └── deploy.yml  # GitHub Actions → GitHub Pages
└── vite.config.js
```

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `M` | Toggle microphone |
| `V` | Toggle camera |

---

## License

MIT — do whatever you want with it.!
Fun coworking platform
