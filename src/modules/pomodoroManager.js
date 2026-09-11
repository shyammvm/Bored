import { peerManager } from './peerManager.js';
import { playBell, playPomodoroSound } from './soundEffects.js';

export const DEFAULT_POMODORO_SETTINGS = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundAlert: 'singingBowl', // 'singingBowl' | 'digitalBeep' | 'gentleChime' | 'none'
  desktopNotification: false
};

function sendDesktopNotification(title, body) {
  try {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/public/favicon.ico'
      });
    }
  } catch (e) {
    console.warn('Desktop notification error:', e);
  }
}

class PomodoroManager {
  constructor() {
    this.privateSettings = this.loadStoredSettings();
    this.roomSettings = { ...DEFAULT_POMODORO_SETTINGS };

    // Shared Room Timer State
    this.roomTimer = {
      mode: 'focus', // 'focus' | 'shortBreak' | 'longBreak'
      duration: this.roomSettings.focus * 60,
      remaining: this.roomSettings.focus * 60,
      isRunning: false,
      round: 1,
      completedCount: 0,
      lastUpdated: Date.now()
    };

    // Private Personal Timer State
    this.privateTimer = {
      mode: 'focus',
      duration: this.privateSettings.focus * 60,
      remaining: this.privateSettings.focus * 60,
      isRunning: false,
      round: 1,
      completedCount: 0,
      showOnBadge: true
    };

    this.activeTab = 'room'; // 'room' | 'private'
    this.intervalId = null;
    this.listeners = new Map();

    this.init();
  }

  loadStoredSettings() {
    try {
      const stored = localStorage.getItem('bored_pomodoro_settings');
      if (stored) {
        return { ...DEFAULT_POMODORO_SETTINGS, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn('Could not load stored pomodoro settings:', e);
    }
    return { ...DEFAULT_POMODORO_SETTINGS };
  }

  saveStoredSettings() {
    try {
      localStorage.setItem('bored_pomodoro_settings', JSON.stringify(this.privateSettings));
    } catch (e) {
      console.warn('Could not save pomodoro settings:', e);
    }
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) list.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
  }

  init() {
    this.startTicker();
    this.setupNetwork();
  }

  setupNetwork() {
    // Receive room timer sync from peers
    peerManager.on('pomodoro_sync', (data) => {
      if (!data.timer) return;
      this.applyRoomSync(data.timer);
    });

    // When new peer connects, if we are host, sync our room timer to them
    peerManager.on('peer_connected', () => {
      if (peerManager.isHost) {
        this.broadcastRoomSync();
      }
    });

    peerManager.on('room_joined', () => {
      if (peerManager.isHost) {
        this.broadcastRoomSync();
      }
    });
  }

  startTicker() {
    if (this.intervalId) clearInterval(this.intervalId);

    this.intervalId = setInterval(() => {
      let roomChanged = false;
      let privateChanged = false;

      // Tick Room Timer
      if (this.roomTimer.isRunning) {
        if (this.roomTimer.remaining > 0) {
          this.roomTimer.remaining--;
          roomChanged = true;
        } else {
          this.roomTimer.isRunning = false;
          playPomodoroSound(this.roomSettings.soundAlert);
          if (this.roomSettings.desktopNotification) {
            sendDesktopNotification(
              this.roomTimer.mode === 'focus' ? 'Room Focus Complete!' : 'Room Break Finished!',
              this.roomTimer.mode === 'focus' ? 'Great session! Time for a break.' : 'Break over! Ready to focus again?'
            );
          }
          this.emit('room_timer_completed', { mode: this.roomTimer.mode });
          this.autoAdvanceRoomMode();
          roomChanged = true;
        }
      }

      // Tick Private Timer
      if (this.privateTimer.isRunning) {
        if (this.privateTimer.remaining > 0) {
          this.privateTimer.remaining--;
          privateChanged = true;
        } else {
          this.privateTimer.isRunning = false;
          playPomodoroSound(this.privateSettings.soundAlert);
          if (this.privateSettings.desktopNotification) {
            sendDesktopNotification(
              this.privateTimer.mode === 'focus' ? 'Focus Session Complete!' : 'Break Finished!',
              this.privateTimer.mode === 'focus' ? 'Well done! Take a well-deserved rest.' : 'Break over! Back to work.'
            );
          }
          this.emit('private_timer_completed', { mode: this.privateTimer.mode });
          this.autoAdvancePrivateMode();
          privateChanged = true;
        }
      }

      if (roomChanged) {
        this.emit('room_tick', this.getRoomState());
      }
      if (privateChanged) {
        this.emit('private_tick', this.getPrivateState());
        if (this.privateTimer.showOnBadge) {
          this.updatePrivateTimerBadge();
        }
      }
    }, 1000);
  }

  // --- Shared Room Timer Controls ---
  toggleRoomTimer() {
    this.roomTimer.isRunning = !this.roomTimer.isRunning;
    this.roomTimer.lastUpdated = Date.now();
    this.broadcastRoomSync();
    this.emit('room_tick', this.getRoomState());
  }

  resetRoomTimer() {
    this.roomTimer.isRunning = false;
    const duration = (this.roomSettings[this.roomTimer.mode] || 25) * 60;
    this.roomTimer.duration = duration;
    this.roomTimer.remaining = duration;
    this.roomTimer.lastUpdated = Date.now();
    this.broadcastRoomSync();
    this.emit('room_tick', this.getRoomState());
  }

  setRoomMode(mode, autoStart = false) {
    if (!['focus', 'shortBreak', 'longBreak'].includes(mode)) return;
    const duration = (this.roomSettings[mode] || 25) * 60;
    this.roomTimer.mode = mode;
    this.roomTimer.duration = duration;
    this.roomTimer.remaining = duration;
    this.roomTimer.isRunning = autoStart;
    this.roomTimer.lastUpdated = Date.now();
    this.broadcastRoomSync();
    this.emit('room_tick', this.getRoomState());
  }

  autoAdvanceRoomMode() {
    if (this.roomTimer.mode === 'focus') {
      this.roomTimer.completedCount++;
      if (this.roomTimer.round >= this.roomSettings.longBreakInterval) {
        this.roomTimer.round = 1;
        this.setRoomMode('longBreak', this.roomSettings.autoStartBreaks);
      } else {
        this.roomTimer.round++;
        this.setRoomMode('shortBreak', this.roomSettings.autoStartBreaks);
      }
    } else {
      this.setRoomMode('focus', this.roomSettings.autoStartFocus);
    }
  }

  broadcastRoomSync() {
    peerManager.broadcast({
      type: 'pomodoro_sync',
      timer: {
        mode: this.roomTimer.mode,
        duration: this.roomTimer.duration,
        remaining: this.roomTimer.remaining,
        isRunning: this.roomTimer.isRunning,
        round: this.roomTimer.round,
        completedCount: this.roomTimer.completedCount,
        settings: this.roomSettings,
        timestamp: Date.now()
      }
    });
  }

  applyRoomSync(synced) {
    if (synced.settings) {
      this.roomSettings = { ...this.roomSettings, ...synced.settings };
    }
    if (synced.round !== undefined) {
      this.roomTimer.round = synced.round;
    }
    if (synced.completedCount !== undefined) {
      this.roomTimer.completedCount = synced.completedCount;
    }

    // If running, compensate for network flight time
    let remaining = synced.remaining;
    if (synced.isRunning && synced.timestamp) {
      const elapsedSec = Math.floor((Date.now() - synced.timestamp) / 1000);
      remaining = Math.max(0, remaining - elapsedSec);
    }

    this.roomTimer.mode = synced.mode;
    this.roomTimer.duration = synced.duration;
    this.roomTimer.remaining = remaining;
    this.roomTimer.isRunning = synced.isRunning;
    this.roomTimer.lastUpdated = Date.now();

    this.emit('room_tick', this.getRoomState());
    this.emit('settings_updated', { target: 'room', settings: this.roomSettings });
  }

  getRoomState() {
    const minutes = Math.floor(this.roomTimer.remaining / 60);
    const seconds = this.roomTimer.remaining % 60;
    const progress = this.roomTimer.duration > 0 ? (1 - (this.roomTimer.remaining / this.roomTimer.duration)) : 0;
    return {
      mode: this.roomTimer.mode,
      remaining: this.roomTimer.remaining,
      duration: this.roomTimer.duration,
      isRunning: this.roomTimer.isRunning,
      round: this.roomTimer.round,
      totalRounds: this.roomSettings.longBreakInterval,
      completedCount: this.roomTimer.completedCount,
      timeFormatted: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      progress: Math.min(1, Math.max(0, progress)),
      settings: { ...this.roomSettings }
    };
  }

  // --- Private Personal Timer Controls ---
  togglePrivateTimer() {
    this.privateTimer.isRunning = !this.privateTimer.isRunning;
    this.emit('private_tick', this.getPrivateState());
    this.updatePrivateTimerBadge();
  }

  resetPrivateTimer() {
    this.privateTimer.isRunning = false;
    const duration = (this.privateSettings[this.privateTimer.mode] || 25) * 60;
    this.privateTimer.duration = duration;
    this.privateTimer.remaining = duration;
    this.emit('private_tick', this.getPrivateState());
    this.updatePrivateTimerBadge();
  }

  setPrivateMode(mode, autoStart = false) {
    if (!['focus', 'shortBreak', 'longBreak'].includes(mode)) return;
    const duration = (this.privateSettings[mode] || 25) * 60;
    this.privateTimer.mode = mode;
    this.privateTimer.duration = duration;
    this.privateTimer.remaining = duration;
    this.privateTimer.isRunning = autoStart;
    this.emit('private_tick', this.getPrivateState());
    this.updatePrivateTimerBadge();
  }

  setCustomPrivateDuration(minutes) {
    const mins = Math.max(1, Math.min(180, parseInt(minutes) || 25));
    const sec = mins * 60;
    this.privateSettings.focus = mins;
    this.saveStoredSettings();
    this.privateTimer.duration = sec;
    this.privateTimer.remaining = sec;
    this.privateTimer.isRunning = false;
    this.emit('private_tick', this.getPrivateState());
    this.emit('settings_updated', { target: 'private', settings: this.privateSettings });
  }

  autoAdvancePrivateMode() {
    if (this.privateTimer.mode === 'focus') {
      this.privateTimer.completedCount++;
      if (this.privateTimer.round >= this.privateSettings.longBreakInterval) {
        this.privateTimer.round = 1;
        this.setPrivateMode('longBreak', this.privateSettings.autoStartBreaks);
      } else {
        this.privateTimer.round++;
        this.setPrivateMode('shortBreak', this.privateSettings.autoStartBreaks);
      }
    } else {
      this.setPrivateMode('focus', this.privateSettings.autoStartFocus);
    }
  }

  togglePrivateBadgeSync(enable) {
    this.privateTimer.showOnBadge = enable;
    this.updatePrivateTimerBadge();
  }

  updatePrivateTimerBadge() {
    if (!this.privateTimer.showOnBadge) return;
    const state = this.getPrivateState();
    if (this.privateTimer.isRunning) {
      peerManager.updateMyStatus({
        timerBadge: `${state.mode === 'focus' ? 'Focus' : 'Break'} (${state.timeFormatted})`
      });
    } else {
      peerManager.updateMyStatus({
        timerBadge: ''
      });
    }
  }

  getPrivateState() {
    const minutes = Math.floor(this.privateTimer.remaining / 60);
    const seconds = this.privateTimer.remaining % 60;
    const progress = this.privateTimer.duration > 0 ? (1 - (this.privateTimer.remaining / this.privateTimer.duration)) : 0;
    return {
      mode: this.privateTimer.mode,
      remaining: this.privateTimer.remaining,
      duration: this.privateTimer.duration,
      isRunning: this.privateTimer.isRunning,
      round: this.privateTimer.round,
      totalRounds: this.privateSettings.longBreakInterval,
      completedCount: this.privateTimer.completedCount,
      timeFormatted: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      progress: Math.min(1, Math.max(0, progress)),
      settings: { ...this.privateSettings }
    };
  }

  // --- Settings Customization API ---
  getSettings(target = 'private') {
    return target === 'room' ? { ...this.roomSettings } : { ...this.privateSettings };
  }

  updateSettings(target = 'private', newSettings) {
    const isRoom = target === 'room';
    const targetSettings = isRoom ? this.roomSettings : this.privateSettings;
    const targetTimer = isRoom ? this.roomTimer : this.privateTimer;

    if (newSettings.focus !== undefined) {
      targetSettings.focus = Math.max(1, Math.min(180, parseInt(newSettings.focus) || 25));
    }
    if (newSettings.shortBreak !== undefined) {
      targetSettings.shortBreak = Math.max(1, Math.min(60, parseInt(newSettings.shortBreak) || 5));
    }
    if (newSettings.longBreak !== undefined) {
      targetSettings.longBreak = Math.max(1, Math.min(90, parseInt(newSettings.longBreak) || 15));
    }
    if (newSettings.longBreakInterval !== undefined) {
      targetSettings.longBreakInterval = Math.max(1, Math.min(12, parseInt(newSettings.longBreakInterval) || 4));
    }
    if (typeof newSettings.autoStartBreaks === 'boolean') {
      targetSettings.autoStartBreaks = newSettings.autoStartBreaks;
    }
    if (typeof newSettings.autoStartFocus === 'boolean') {
      targetSettings.autoStartFocus = newSettings.autoStartFocus;
    }
    if (newSettings.soundAlert) {
      targetSettings.soundAlert = newSettings.soundAlert;
    }
    if (typeof newSettings.desktopNotification === 'boolean') {
      targetSettings.desktopNotification = newSettings.desktopNotification;
    }

    // If timer is not currently running, sync the duration & remaining time for current mode
    if (!targetTimer.isRunning) {
      const modeDuration = (targetSettings[targetTimer.mode] || 25) * 60;
      targetTimer.duration = modeDuration;
      targetTimer.remaining = modeDuration;
    }

    if (!isRoom) {
      this.saveStoredSettings();
      this.emit('private_tick', this.getPrivateState());
      this.emit('settings_updated', { target: 'private', settings: this.privateSettings });
    } else {
      this.broadcastRoomSync();
      this.emit('room_tick', this.getRoomState());
      this.emit('settings_updated', { target: 'room', settings: this.roomSettings });
    }
  }

  resetSettings(target = 'private') {
    this.updateSettings(target, { ...DEFAULT_POMODORO_SETTINGS });
  }
}

export const pomodoroManager = new PomodoroManager();
