import { peerManager } from './peerManager.js';

class YouTubeManager {
  constructor() {
    this.player = null;
    this.isReady = false;
    this.currentVideoId = null;
    this.currentTitle = '';
    this.isPlaying = false;
    this.universalVolume = 50; // Universal room volume (synced across peers)
    try {
      const savedPersonal = localStorage.getItem('bored_personal_music_vol');
      this.personalVolume = savedPersonal !== null ? Math.max(0, Math.min(100, parseInt(savedPersonal, 10))) : 100;
    } catch (e) {
      this.personalVolume = 100;
    }
    this.isSyncEnabled = true; // Sync with room DJ
    this.isDeafened = false;
    this.wasPlayingBeforeDeafen = false;
    this.listeners = new Map();

    this.initYouTubeAPI();
    this.setupNetwork();
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) list.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
  }

  initYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      this.createPlayer();
      return;
    }

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    window.onYouTubeIframeAPIReady = () => {
      this.createPlayer();
    };
  }

  createPlayer() {
    const container = document.getElementById('youtube-player-hidden');
    if (!container) {
      setTimeout(() => this.createPlayer(), 300);
      return;
    }

    try {
      const config = {
        height: '360',
        width: '640',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            this.isReady = true;
            this.applyPlayerVolume();
            this.emit('ready', { currentVideoId: this.currentVideoId, title: this.currentTitle });
          },
          onStateChange: (event) => {
            // YT.PlayerState: PLAYING = 1, PAUSED = 2, ENDED = 0
            if (event.data === 1) {
              this.isPlaying = true;
              this.applyPlayerVolume();
              try {
                const data = this.player.getVideoData();
                if (data && data.title) this.currentTitle = data.title;
              } catch (e) {}
              this.emit('state_changed', { isPlaying: true, title: this.currentTitle });
            } else if (event.data === 2 || event.data === 0) {
              this.isPlaying = false;
              this.emit('state_changed', { isPlaying: false, title: this.currentTitle });
            }
          },
          onError: (err) => {
            console.warn('[YouTubeManager] Player error:', err);
          }
        }
      };

      if (this.currentVideoId) {
        config.videoId = this.currentVideoId;
      }

      this.player = new window.YT.Player('youtube-player-hidden', config);
    } catch (e) {
      console.warn('[YouTubeManager] Init error:', e);
    }
  }

  applyPlayerVolume() {
    if (!this.player) return;
    try {
      const effectiveVol = this.isDeafened
        ? 0
        : Math.round((this.universalVolume * this.personalVolume) / 100);
      if (typeof this.player.setVolume === 'function') {
        this.player.setVolume(effectiveVol);
      }
      if (effectiveVol === 0 || this.isDeafened) {
        if (typeof this.player.mute === 'function') this.player.mute();
      } else {
        if (typeof this.player.unMute === 'function') this.player.unMute();
      }
    } catch (e) {
      console.warn('[YouTubeManager] applyPlayerVolume error:', e);
    }
  }

  setupNetwork() {
    peerManager.on('music_sync', (data) => {
      if (!this.isSyncEnabled) return;
      if (!this.isReady || !this.player) return;

      console.log('[YouTubeManager] Received music sync from peer:', data);
      this.currentTitle = data.title || 'YouTube Audio';

      if (typeof data.volume === 'number') {
        this.universalVolume = Math.max(0, Math.min(100, data.volume));
        this.emit('universal_volume_changed', { volume: this.universalVolume });
      }

      if (data.videoId && data.videoId !== this.currentVideoId) {
        this.currentVideoId = data.videoId;
        try {
          this.player.loadVideoById({
            videoId: data.videoId,
            startSeconds: data.currentTime || 0,
            suggestedQuality: 'hd720'
          });
        } catch (e) {}
        this.applyPlayerVolume();
        if (data.isPlaying && !this.isDeafened) {
          try { this.player.playVideo(); } catch (e) {}
          this.isPlaying = true;
        } else {
          try { this.player.pauseVideo(); } catch (e) {}
          this.isPlaying = false;
          if (data.isPlaying && this.isDeafened) {
            this.wasPlayingBeforeDeafen = true;
          }
        }
      } else {
        if (data.isPlaying && !this.isPlaying) {
          if (!this.isDeafened) {
            if (data.currentTime && typeof this.player.seekTo === 'function') {
              this.player.seekTo(data.currentTime, true);
            }
            try { this.player.playVideo(); } catch (e) {}
            this.isPlaying = true;
          } else {
            this.wasPlayingBeforeDeafen = true;
          }
        } else if (!data.isPlaying && this.isPlaying) {
          try { this.player.pauseVideo(); } catch (e) {}
          this.isPlaying = false;
          this.wasPlayingBeforeDeafen = false;
        }
        this.applyPlayerVolume();
      }

      this.emit('track_changed', { videoId: this.currentVideoId, title: this.currentTitle });
    });

    peerManager.on('music_volume_sync', (data) => {
      if (!this.isSyncEnabled) return;
      if (typeof data.volume === 'number') {
        this.universalVolume = Math.max(0, Math.min(100, data.volume));
        this.applyPlayerVolume();
        this.emit('universal_volume_changed', { volume: this.universalVolume });
      }
    });

    peerManager.on('peer_connected', () => {
      if (this.isPlaying && this.isSyncEnabled && !this.isDeafened) {
        this.broadcastMusicSync();
      }
    });
  }

  togglePlay() {
    if (!this.currentVideoId) {
      return { success: false, reason: 'no_track' };
    }
    if (!this.isReady || !this.player) {
      return { success: false, reason: 'not_ready' };
    }

    if (this.isDeafened) {
      return { success: false, reason: 'deafened' };
    }

    if (this.isPlaying) {
      try { this.player.pauseVideo(); } catch (e) {}
      this.isPlaying = false;
    } else {
      this.applyPlayerVolume();
      try { this.player.playVideo(); } catch (e) {}
      this.isPlaying = true;
    }

    if (this.isSyncEnabled) {
      this.broadcastMusicSync();
    }

    this.emit('state_changed', { isPlaying: this.isPlaying, title: this.currentTitle });
    return { success: true, isPlaying: this.isPlaying };
  }


  pauseForDeafen() {
    this.isDeafened = true;
    // Mute YouTube locally so the buffer stays live and in sync with zero stutter
    this.applyPlayerVolume();
  }

  resumeFromDeafen() {
    this.isDeafened = false;
    // Instantly unmute at the exact live room timestamp with zero lag or re-buffering
    this.applyPlayerVolume();
  }

  playCustomUrl(urlOrId) {
    const videoId = this.extractVideoId(urlOrId);
    if (!videoId) return false;

    this.currentVideoId = videoId;
    this.currentTitle = 'YouTube Audio';

    if (this.isReady && this.player) {
      try {
        this.player.loadVideoById({
          videoId: videoId,
          suggestedQuality: 'hd720'
        });
        this.applyPlayerVolume();
        if (!this.isDeafened) {
          this.player.playVideo();
          this.isPlaying = true;
        } else {
          this.player.pauseVideo();
          this.isPlaying = false;
          this.wasPlayingBeforeDeafen = true;
        }
      } catch (e) {
        console.warn('[YouTubeManager] loadVideoById error:', e);
      }

      setTimeout(() => {
        try {
          const data = this.player.getVideoData();
          if (data && data.title) {
            this.currentTitle = data.title;
            this.emit('track_changed', { videoId: this.currentVideoId, title: this.currentTitle });
          }
        } catch (e) {}
      }, 1000);
    }

    if (this.isSyncEnabled && !this.isDeafened) {
      this.broadcastMusicSync();
    }

    this.emit('track_changed', { videoId: this.currentVideoId, title: this.currentTitle });
    this.emit('state_changed', { isPlaying: this.isPlaying, title: this.currentTitle });
    return true;
  }

  extractVideoId(input) {
    if (!input) return null;
    const clean = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;

    try {
      const url = new URL(clean);
      if (url.hostname.includes('youtube.com')) {
        if (url.pathname.startsWith('/live/')) {
          return url.pathname.replace('/live/', '').split('/')[0].split('?')[0];
        }
        if (url.pathname.startsWith('/embed/')) {
          return url.pathname.replace('/embed/', '').split('/')[0].split('?')[0];
        }
        if (url.pathname.startsWith('/shorts/')) {
          return url.pathname.replace('/shorts/', '').split('/')[0].split('?')[0];
        }
        return url.searchParams.get('v');
      }
      if (url.hostname.includes('youtu.be')) {
        return url.pathname.slice(1).split('/')[0].split('?')[0];
      }
    } catch (e) {}
    return null;
  }

  // Universal volume (in music menu: room-wide, synced across all peers)
  setUniversalVolume(vol) {
    this.universalVolume = Math.max(0, Math.min(100, parseInt(vol, 10) || 0));
    this.applyPlayerVolume();
    this.emit('universal_volume_changed', { volume: this.universalVolume });

    if (this.isSyncEnabled && !this.isDeafened) {
      peerManager.broadcast({
        type: 'music_volume_sync',
        volume: this.universalVolume,
        timestamp: Date.now()
      });
    }
  }

  // Alias for backward compatibility
  setVolume(vol) {
    this.setUniversalVolume(vol);
  }

  // Personal volume (in bottom dock: specific to current user, stored locally, never broadcast)
  setPersonalVolume(vol) {
    this.personalVolume = Math.max(0, Math.min(100, parseInt(vol, 10) || 0));
    try {
      localStorage.setItem('bored_personal_music_vol', this.personalVolume);
    } catch (e) {}
    this.applyPlayerVolume();
    this.emit('personal_volume_changed', { volume: this.personalVolume });
  }

  setSyncEnabled(enabled) {
    this.isSyncEnabled = enabled;
    this.emit('sync_toggle', { isSyncEnabled: this.isSyncEnabled });
  }

  broadcastMusicSync() {
    let currentTime = 0;
    try {
      if (this.player && typeof this.player.getCurrentTime === 'function') {
        currentTime = this.player.getCurrentTime();
      }
    } catch (e) {}

    peerManager.broadcast({
      type: 'music_sync',
      videoId: this.currentVideoId,
      title: this.currentTitle,
      isPlaying: this.isPlaying,
      currentTime,
      volume: this.universalVolume,
      timestamp: Date.now()
    });
  }
}

export const youtubeManager = new YouTubeManager();
