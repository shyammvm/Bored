import { peerManager } from './peerManager.js';

const DEFAULT_STARTER_CODE = `🚀 Bored! Collaborative Codeshare
Type raw text, paste code, or brainstorm together.
Everything syncs in real-time with everyone in the room!
`;

const EXTENSION_MAP = {
  text: 'txt',
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  html: 'html',
  css: 'css',
  json: 'json',
  markdown: 'md',
  sql: 'sql',
  cpp: 'cpp'
};

class CodeshareManager {
  constructor() {
    this.currentRoomCode = '';
    this.currentUserName = '';
    this.content = DEFAULT_STARTER_CODE;
    this.language = 'text';
    this.version = 1;
    this.lastModifiedBy = null;

    // Active typing tracking: peerId -> { userName, timeoutId }
    this.activeTypers = new Map();
    this.lastTypingBroadcast = 0;
    this.broadcastDebounceTimer = null;
    this.listeners = new Map();

    this.setupNetworkListeners();
  }

  on(event, cb) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(cb);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) {
      list.forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error(`[CodeshareManager] Error in listener for ${event}:`, e);
        }
      });
    }
  }

  initRoom(roomCode, userName) {
    this.currentRoomCode = roomCode || '';
    this.currentUserName = userName || '';
    this.activeTypers.clear();

    if (roomCode) {
      const storageKey = `bored_codeshare_${roomCode}`;
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.content === 'string') {
            this.content = parsed.content;
            this.language = parsed.language || 'text';
            this.version = parsed.version || 1;
          }
        }
      } catch (e) {
        console.warn('[CodeshareManager] Storage read error:', e);
      }
    }

    this.emit('sync_received', {
      content: this.content,
      language: this.language,
      version: this.version
    });

    // Request up-to-date state from peers
    this.requestSync();

    // Broadcast our state if we have content
    setTimeout(() => {
      this.broadcastSync();
    }, 600);
  }

  saveStorage() {
    if (!this.currentRoomCode) return;
    try {
      const storageKey = `bored_codeshare_${this.currentRoomCode}`;
      sessionStorage.setItem(storageKey, JSON.stringify({
        content: this.content,
        language: this.language,
        version: this.version
      }));
    } catch (e) {
      console.warn('[CodeshareManager] Storage write error:', e);
    }
  }

  setupNetworkListeners() {
    peerManager.on('peer_connected', () => {
      // Whenever another peer connects, share our document state
      setTimeout(() => {
        this.broadcastSync();
      }, 400);
    });

    peerManager.on('room_joined', ({ roomCode }) => {
      if (roomCode && roomCode !== this.currentRoomCode) {
        this.initRoom(roomCode, peerManager.userName);
      } else {
        this.requestSync();
      }
    });

    peerManager.on('codeshare_edit', (data) => {
      if (!data || data.senderId === peerManager.myPeerId) return;

      // Update active typers list (user finished keystroke burst)
      this.removeTyper(data.senderId);

      this.content = data.content || '';
      if (data.language) this.language = data.language;
      this.version = Math.max(this.version, data.version || 0) + 1;
      this.lastModifiedBy = {
        peerId: data.senderId,
        userName: data.senderName || 'Coworker',
        timestamp: data.timestamp || Date.now()
      };

      this.saveStorage();

      this.emit('content_updated', {
        content: this.content,
        language: this.language,
        version: this.version,
        senderId: data.senderId,
        senderName: data.senderName,
        cursor: data.cursor,
        lastModifiedBy: this.lastModifiedBy
      });
    });

    peerManager.on('codeshare_sync', (data) => {
      if (!data || data.senderId === peerManager.myPeerId) return;

      // Only adopt if remote version is newer or our content is default starter
      const isOurContentDefault = this.content === DEFAULT_STARTER_CODE;
      const isRemoteNewer = (data.version || 0) >= this.version;

      if (isOurContentDefault || isRemoteNewer) {
        this.content = data.content || '';
        if (data.language) this.language = data.language;
        this.version = data.version || this.version;
        this.lastModifiedBy = data.lastModifiedBy || null;

        this.saveStorage();

        this.emit('sync_received', {
          content: this.content,
          language: this.language,
          version: this.version,
          lastModifiedBy: this.lastModifiedBy
        });
      }
    });

    peerManager.on('codeshare_request_sync', (data) => {
      if (!data || data.senderId === peerManager.myPeerId) return;
      this.broadcastSync();
    });

    peerManager.on('codeshare_language', (data) => {
      if (!data || data.senderId === peerManager.myPeerId) return;
      this.language = data.language;
      this.saveStorage();
      this.emit('language_updated', {
        language: this.language,
        senderId: data.senderId,
        senderName: data.senderName
      });
    });

    peerManager.on('codeshare_typing', (data) => {
      if (!data || data.senderId === peerManager.myPeerId) return;
      this.handleIncomingTyping(data.senderId, data.senderName || 'Coworker');
    });

    peerManager.on('peer_left', ({ peerId }) => {
      this.removeTyper(peerId);
    });

    peerManager.on('left_room', () => {
      this.reset();
    });
  }

  handleIncomingTyping(peerId, userName) {
    if (this.activeTypers.has(peerId)) {
      clearTimeout(this.activeTypers.get(peerId).timeoutId);
    }

    const timeoutId = setTimeout(() => {
      this.removeTyper(peerId);
    }, 2500);

    this.activeTypers.set(peerId, { userName, timeoutId });
    this.emitTypingUpdate();
  }

  removeTyper(peerId) {
    if (this.activeTypers.has(peerId)) {
      clearTimeout(this.activeTypers.get(peerId).timeoutId);
      this.activeTypers.delete(peerId);
      this.emitTypingUpdate();
    }
  }

  emitTypingUpdate() {
    const typers = Array.from(this.activeTypers.values()).map(t => t.userName);
    this.emit('typing_updated', { typers });
  }

  notifyTyping() {
    const now = Date.now();
    if (now - this.lastTypingBroadcast > 1200) {
      this.lastTypingBroadcast = now;
      peerManager.broadcast({
        type: 'codeshare_typing',
        senderId: peerManager.myPeerId,
        senderName: peerManager.userName
      });
    }
  }

  updateContent(newContent, cursor = null, isImmediate = false) {
    this.content = newContent;
    this.version++;
    this.lastModifiedBy = {
      peerId: peerManager.myPeerId,
      userName: peerManager.userName,
      timestamp: Date.now()
    };

    this.saveStorage();
    this.notifyTyping();

    if (this.broadcastDebounceTimer) {
      clearTimeout(this.broadcastDebounceTimer);
      this.broadcastDebounceTimer = null;
    }

    const broadcastPayload = () => {
      peerManager.broadcast({
        type: 'codeshare_edit',
        content: this.content,
        language: this.language,
        version: this.version,
        senderId: peerManager.myPeerId,
        senderName: peerManager.userName,
        cursor: cursor,
        timestamp: Date.now()
      });
    };

    if (isImmediate) {
      broadcastPayload();
    } else {
      this.broadcastDebounceTimer = setTimeout(broadcastPayload, 75);
    }
  }

  setLanguage(newLang) {
    if (this.language === newLang) return;
    this.language = newLang;
    this.saveStorage();

    peerManager.broadcast({
      type: 'codeshare_language',
      language: this.language,
      senderId: peerManager.myPeerId,
      senderName: peerManager.userName
    });

    this.emit('language_updated', {
      language: this.language,
      senderId: peerManager.myPeerId,
      senderName: peerManager.userName
    });
  }

  clearContent() {
    this.updateContent('', null, true);
    this.emit('content_updated', {
      content: '',
      language: this.language,
      version: this.version,
      senderId: peerManager.myPeerId,
      senderName: peerManager.userName,
      isClear: true
    });
  }

  requestSync() {
    peerManager.broadcast({
      type: 'codeshare_request_sync',
      senderId: peerManager.myPeerId
    });
  }

  broadcastSync() {
    if (!peerManager.myPeerId) return;
    peerManager.broadcast({
      type: 'codeshare_sync',
      content: this.content,
      language: this.language,
      version: this.version,
      senderId: peerManager.myPeerId,
      senderName: peerManager.userName,
      lastModifiedBy: this.lastModifiedBy
    });
  }

  calculateStats(text = this.content) {
    if (!text) {
      return { lines: 1, words: 0, chars: 0 };
    }
    const lines = text.split('\n').length;
    const trimmed = text.trim();
    const words = trimmed ? trimmed.split(/\s+/).length : 0;
    const chars = text.length;
    return { lines, words, chars };
  }

  async copyToClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(this.content);
        return true;
      }
    } catch (e) {
      console.warn('[CodeshareManager] Clipboard API failed, fallback to execCommand', e);
    }

    // Fallback
    try {
      const textarea = document.createElement('textarea');
      textarea.value = this.content;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      return successful;
    } catch (err) {
      console.error('[CodeshareManager] Copy failed', err);
      return false;
    }
  }

  downloadSnippet() {
    const ext = EXTENSION_MAP[this.language] || 'txt';
    const room = this.currentRoomCode || 'snippet';
    const filename = `codeshare-${room}.${ext}`;

    const blob = new Blob([this.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  reset() {
    this.currentRoomCode = '';
    this.currentUserName = '';
    this.content = DEFAULT_STARTER_CODE;
    this.language = 'text';
    this.version = 1;
    this.lastModifiedBy = null;
    this.activeTypers.clear();
    if (this.broadcastDebounceTimer) {
      clearTimeout(this.broadcastDebounceTimer);
      this.broadcastDebounceTimer = null;
    }
  }
}

export const codeshareManager = new CodeshareManager();
