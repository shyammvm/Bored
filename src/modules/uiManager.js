import { peerManager, cleanRoomCode, getRoomHostPeerId } from './peerManager.js';
import { mediaManager } from './mediaManager.js';
import { taskManager } from './taskManager.js';
import { pomodoroManager, DEFAULT_POMODORO_SETTINGS } from './pomodoroManager.js';
import { chatManager } from './chatManager.js';
import { youtubeManager } from './youtubeManager.js';
import { codeshareManager } from './codeshareManager.js';
import { playClick, playPomodoroSound } from './soundEffects.js';
import { getInitials, getAvatarGradient } from './avatarHelper.js';
import { renderIcons } from './iconHelper.js';

class UIManager {
  constructor() {
    this.localVideoEl = null;
    this.videoGridEl = null;
    this.stageSectionEl = null;
    this.presentationStageEl = null;
    this.screensContainerEl = null;
    this.peerTiles = new Map(); // peerId -> DOMElement
    this.activeScreenIds = []; // Array of screen IDs in order
    this.screenTiles = new Map(); // screenId -> DOMElement
    this.stagedScreenIds = []; // Array of up to 2 screen IDs on stage
    this.codeshareFsFontSize = 14;
    this.isInternalCodeshareSync = false;
    this.copyToastTimer = null;
  }

  init() {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('bored_theme');
    document.documentElement.removeAttribute('data-theme');
    this.cacheElements();
    this.bindEvents();
    this.renderMyTasks();
    this.checkUrlForRoomInvite();
    this.updatePomodoroDisplay();
    this.initCodeshare();
    this.initSidebarResize();
    this.initMobileBlocker();
    renderIcons();
  }

  cacheElements() {
    this.localVideoEl = document.getElementById('local-video');
    this.videoGridEl = document.getElementById('video-grid');
    this.stageSectionEl = document.getElementById('stage-section');
    this.presentationStageEl = document.getElementById('presentation-stage');
    this.screensContainerEl = document.getElementById('screens-container');
  }

  bindEvents() {
    // Media controls in dock
    document.getElementById('btn-toggle-mic').addEventListener('click', () => {
      playClick();
      const isMuted = mediaManager.toggleAudio();
      this.updateMicUi(isMuted);
    });

    document.getElementById('btn-toggle-cam').addEventListener('click', () => {
      playClick();
      const isOff = mediaManager.toggleVideo();
      this.updateCamUi(isOff);
    });

    document.getElementById('btn-toggle-screen').addEventListener('click', () => {
      playClick();
      mediaManager.toggleScreenShare();
    });

    document.getElementById('btn-toggle-deafen').addEventListener('click', () => {
      playClick();
      const isDeafened = mediaManager.toggleDeafen();
      const restored = mediaManager.savedStatusBeforeDeafen || 'Bored';
      this.updateDeafenUi(isDeafened, restored);
    });

    // Leave room
    document.getElementById('btn-leave-room').addEventListener('click', () => {
      playClick();
      if (confirm('Leave this coworking room?')) {
        peerManager.leaveRoom();
        window.location.href = window.location.pathname;
      }
    });

    // Status picker modal
    const statusModal = document.getElementById('status-modal-backdrop');
    const emojiDropdown = document.getElementById('emoji-picker-dropdown');

    document.getElementById('btn-status-picker').addEventListener('click', () => {
      playClick();
      this.syncStatusModalState();
      statusModal.style.display = 'flex';
      renderIcons(statusModal);
    });

    document.getElementById('btn-close-status-modal').addEventListener('click', () => {
      if (emojiDropdown) emojiDropdown.style.display = 'none';
      statusModal.style.display = 'none';
    });

    document.querySelectorAll('.status-option-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        playClick();
        const status = e.currentTarget.dataset.status;
        document.querySelectorAll('.status-option-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.setUserStatus(status);
        if (emojiDropdown) emojiDropdown.style.display = 'none';
        statusModal.style.display = 'none';
      });
    });

    // Custom emoji picker toggle & selection
    const emojiBtn = document.getElementById('btn-custom-emoji-picker');
    if (emojiBtn && emojiDropdown) {
      emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playClick();
        const isOpen = emojiDropdown.style.display !== 'none';
        emojiDropdown.style.display = isOpen ? 'none' : 'grid';
      });
    }

    document.querySelectorAll('.emoji-opt').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        playClick();
        const chosen = document.getElementById('custom-status-chosen-emoji');
        if (chosen) chosen.textContent = e.currentTarget.textContent.trim();
        if (emojiDropdown) emojiDropdown.style.display = 'none';
      });
    });

    // Set custom status
    const setCustomStatusHandler = () => {
      const input = document.getElementById('input-custom-status');
      const chosen = document.getElementById('custom-status-chosen-emoji');
      const val = input ? input.value.trim() : '';
      if (val) {
        playClick();
        const emoji = chosen ? chosen.textContent.trim() : '🎯';
        const fullStatus = `${emoji} ${val}`;
        document.querySelectorAll('.status-option-btn').forEach(b => b.classList.remove('active'));
        this.setUserStatus(fullStatus);
        input.value = '';
        if (emojiDropdown) emojiDropdown.style.display = 'none';
        statusModal.style.display = 'none';
      }
    };

    document.getElementById('btn-set-custom-status').addEventListener('click', setCustomStatusHandler);
    const customInputEl = document.getElementById('input-custom-status');
    if (customInputEl) {
      customInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') setCustomStatusHandler();
      });
    }

    // Global click listener to dismiss floating dropdowns
    document.addEventListener('click', () => {
      if (emojiDropdown) emojiDropdown.style.display = 'none';
      document.querySelectorAll('.tile-menu-dropdown').forEach(d => {
        d.style.display = 'none';
      });
      document.querySelectorAll('.btn-tile-menu').forEach(b => {
        b.classList.remove('active');
      });
    });

    // Sidebar tab buttons
    document.querySelectorAll('.sidebar-tabs-nav .tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        playClick();
        const tab = e.currentTarget.dataset.tab;
        this.switchSidebarTab(tab);
      });
    });

    // Tasks subtab switcher (My Tasks vs Coworker Boards)
    document.getElementById('subtab-my-tasks').addEventListener('click', () => {
      playClick();
      document.getElementById('subtab-my-tasks').classList.add('active');
      document.getElementById('subtab-coworker-tasks').classList.remove('active');
      document.getElementById('view-my-tasks').style.display = 'block';
      document.getElementById('view-coworker-tasks').style.display = 'none';
    });

    document.getElementById('subtab-coworker-tasks').addEventListener('click', () => {
      playClick();
      document.getElementById('subtab-coworker-tasks').classList.add('active');
      document.getElementById('subtab-my-tasks').classList.remove('active');
      document.getElementById('view-coworker-tasks').style.display = 'block';
      document.getElementById('view-my-tasks').style.display = 'none';
      this.renderCoworkerTasks();
    });

    // Add task
    const taskInput = document.getElementById('input-new-task');
    const addTaskHandler = () => {
      if (taskInput.value.trim()) {
        taskManager.addTask(taskInput.value);
        taskInput.value = '';
      }
    };
    document.getElementById('btn-add-task').addEventListener('click', addTaskHandler);
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTaskHandler();
    });

    // Chat sending
    const chatInput = document.getElementById('chat-input');
    const sendChatHandler = () => {
      if (chatInput.value.trim()) {
        chatManager.sendMessage(chatInput.value);
        chatInput.value = '';
      }
    };
    document.getElementById('btn-send-chat').addEventListener('click', sendChatHandler);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatHandler();
    });

    // Pomodoro tab switcher (Shared vs Private)
    document.getElementById('pomo-switch-room').addEventListener('click', () => {
      playClick();
      pomodoroManager.activeTab = 'room';
      document.getElementById('pomo-switch-room').classList.add('active');
      document.getElementById('pomo-switch-private').classList.remove('active');
      document.getElementById('pomo-view-room').style.display = 'block';
      document.getElementById('pomo-view-private').style.display = 'none';
      this.updateHeaderTimerGlance();
    });

    document.getElementById('pomo-switch-private').addEventListener('click', () => {
      playClick();
      pomodoroManager.activeTab = 'private';
      document.getElementById('pomo-switch-private').classList.add('active');
      document.getElementById('pomo-switch-room').classList.remove('active');
      document.getElementById('pomo-view-private').style.display = 'block';
      document.getElementById('pomo-view-room').style.display = 'none';
      this.updateHeaderTimerGlance();
    });

    // Header timer chip click -> open pomodoro tab
    document.getElementById('header-timer-chip').addEventListener('click', () => {
      this.switchSidebarTab('pomodoro');
    });

    // Shared Room Pomodoro buttons
    document.querySelectorAll('[data-room-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        playClick();
        document.querySelectorAll('[data-room-mode]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        pomodoroManager.setRoomMode(e.currentTarget.dataset.roomMode);
      });
    });

    document.getElementById('btn-room-timer-toggle').addEventListener('click', () => {
      playClick();
      pomodoroManager.toggleRoomTimer();
    });

    document.getElementById('btn-room-timer-reset').addEventListener('click', () => {
      playClick();
      pomodoroManager.resetRoomTimer();
    });

    // Private Personal Pomodoro buttons
    document.querySelectorAll('[data-private-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        playClick();
        document.querySelectorAll('[data-private-mode]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        pomodoroManager.setPrivateMode(e.currentTarget.dataset.privateMode);
      });
    });

    document.getElementById('btn-private-timer-toggle').addEventListener('click', () => {
      playClick();
      pomodoroManager.togglePrivateTimer();
    });

    document.getElementById('btn-private-timer-reset').addEventListener('click', () => {
      playClick();
      pomodoroManager.resetPrivateTimer();
    });

    document.getElementById('check-show-private-badge').addEventListener('change', (e) => {
      pomodoroManager.togglePrivateBadgeSync(e.target.checked);
    });

    // Pomodoro Customization Modal & Steppers
    this.setupPomodoroCustomization();

    // Music controls
    const toggleMusic = () => {
      playClick();
      if (!youtubeManager.currentVideoId) {
        const input = document.getElementById('input-custom-yt');
        if (input && input.value.trim()) {
          if (mediaManager.isDeafened) {
            const isDeafened = mediaManager.toggleDeafen();
            this.updateDeafenUi(isDeafened);
          }
          const success = youtubeManager.playCustomUrl(input.value.trim());
          if (success) {
            input.value = '';
            return;
          }
        }
        this.switchSidebarTab('music');
        if (input) {
          input.focus();
          input.classList.remove('highlight-pulse');
          void input.offsetWidth;
          input.classList.add('highlight-pulse');
        }
        return;
      }

      if (mediaManager.isDeafened) {
        const isDeafened = mediaManager.toggleDeafen();
        this.updateDeafenUi(isDeafened);
      }

      youtubeManager.togglePlay();
    };
    document.getElementById('btn-music-play').addEventListener('click', toggleMusic);
    document.getElementById('dock-music-play-btn').addEventListener('click', toggleMusic);

    const musicVolSlider = document.getElementById('input-music-volume');
    const dockVolSlider = document.getElementById('dock-music-vol');

    // Universal volume slider in sidebar music menu
    if (musicVolSlider) {
      musicVolSlider.value = youtubeManager.universalVolume;
      const volValEl = document.getElementById('music-vol-val');
      if (volValEl) volValEl.textContent = `${youtubeManager.universalVolume}%`;

      musicVolSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        if (volValEl) volValEl.textContent = `${val}%`;
        youtubeManager.setUniversalVolume(val);
      });
    }

    // Personal volume slider in bottom dock (specific to this user)
    if (dockVolSlider) {
      dockVolSlider.value = youtubeManager.personalVolume;
      dockVolSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        youtubeManager.setPersonalVolume(val);
      });
    }

    document.getElementById('dock-open-music-tab').addEventListener('click', () => {
      this.switchSidebarTab('music');
    });

    document.getElementById('check-music-sync-dj').addEventListener('change', (e) => {
      youtubeManager.setSyncEnabled(e.target.checked);
    });

    const playCustomYt = () => {
      const input = document.getElementById('input-custom-yt');
      if (input && input.value.trim()) {
        playClick();
        if (mediaManager.isDeafened) {
          const isDeafened = mediaManager.toggleDeafen();
          this.updateDeafenUi(isDeafened);
        }
        const success = youtubeManager.playCustomUrl(input.value.trim());
        if (success) input.value = '';
      }
    };
    document.getElementById('btn-play-custom-yt').addEventListener('click', playCustomYt);

    const customYtInput = document.getElementById('input-custom-yt');
    if (customYtInput) {
      customYtInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          playCustomYt();
        }
      });
    }

    // Audio devices settings modal
    const audioModal = document.getElementById('audio-settings-backdrop');
    const btnAudio = document.getElementById('btn-audio-settings');
    const btnCloseAudio = document.getElementById('btn-close-audio-settings');

    if (btnAudio && audioModal) {
      btnAudio.addEventListener('click', async () => {
        playClick();
        audioModal.style.display = 'flex';
        renderIcons(audioModal);
        await this.populateAudioDevices();
      });

      if (btnCloseAudio) {
        btnCloseAudio.addEventListener('click', () => {
          playClick();
          audioModal.style.display = 'none';
        });
      }

      audioModal.addEventListener('click', (e) => {
        if (e.target === audioModal) audioModal.style.display = 'none';
      });

      const micSelect = document.getElementById('select-audio-input');
      if (micSelect) {
        micSelect.addEventListener('change', async (e) => {
          await mediaManager.setAudioInputDevice(e.target.value);
        });
      }

      const speakerSelect = document.getElementById('select-audio-output');
      if (speakerSelect) {
        speakerSelect.addEventListener('change', async (e) => {
          await mediaManager.setAudioOutputDevice(e.target.value);
        });
      }

      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => {
          if (audioModal.style.display === 'flex') {
            this.populateAudioDevices();
          }
        });
      }
    }

    // Copy Room Code
    const btnCopyCode = document.getElementById('btn-copy-code');
    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', () => {
        this.copyRoomCode();
      });
    }

    // Copy Invite Link
    document.getElementById('btn-copy-invite').addEventListener('click', () => {
      this.copyInviteLink();
    });

    // Live Initials Avatar Preview in welcome modal
    const nameInput = document.getElementById('input-display-name');
    const previewEl = document.getElementById('welcome-initials-preview');
    const updatePreview = () => {
      const name = nameInput.value.trim();
      // Show '?' placeholder avatar when name is empty
      const initials = name ? getInitials(name) : '?';
      const grad = name ? getAvatarGradient(name) : 'linear-gradient(135deg, #4b5563, #1f2937)';

      if (previewEl) {
        previewEl.textContent = initials;
        previewEl.style.background = grad;
      }

      const headerAvatar = document.getElementById('header-user-avatar');
      if (headerAvatar) {
        headerAvatar.textContent = initials;
        headerAvatar.style.background = grad;
      }

      const localTileAvatar = document.getElementById('local-tile-avatar');
      if (localTileAvatar) {
        localTileAvatar.textContent = initials;
        localTileAvatar.style.background = grad;
      }

      const localFallback = document.getElementById('local-fallback-icon');
      if (localFallback) {
        localFallback.textContent = initials;
        localFallback.style.background = grad;
      }

      const headerName = document.getElementById('header-user-name');
      if (headerName) headerName.textContent = name || 'Guest';
      const localTileName = document.getElementById('local-tile-name');
      if (localTileName) localTileName.textContent = name ? `${name} (Host)` : 'You (Host)';
      const localFallbackName = document.getElementById('local-fallback-name');
      if (localFallbackName) localFallbackName.textContent = name || 'You';
    };
    if (nameInput && previewEl) {
      nameInput.addEventListener('input', updatePreview);
      updatePreview(); // Run once with empty name
    }

    // ── Welcome modal media preview ────────────────────────────────────────
    this._welcomeCamStream = null;
    this._welcomeMicStream = null;
    this._welcomeCamOn = false;
    this._welcomeMicOn = false;
    this._welcomeMicAnalyser = null;
    this._welcomeMicLevelRaf = null;
    this._welcomeSettingsOpen = false;

    // Prefer stored device IDs from mediaManager
    this._welcomeSelectedMicId = localStorage.getItem('preferred_audio_input') || null;
    this._welcomeSelectedCamId = localStorage.getItem('preferred_video_input') || null;
    this._welcomeSelectedSpeakerId = localStorage.getItem('preferred_audio_output') || null;

    const welcomePreviewVid  = document.getElementById('welcome-preview-video');
    const welcomeVideoOff    = document.getElementById('welcome-video-off');
    const welcomeMicBtn      = document.getElementById('btn-welcome-mic-toggle');
    const welcomeCamBtn      = document.getElementById('btn-welcome-cam-toggle');
    const welcomeSettingsBtn = document.getElementById('btn-welcome-settings');
    const welcomeSettingsPanel = document.getElementById('welcome-device-settings');
    const micLevelEl         = document.getElementById('welcome-mic-level');
    const micLevelBars       = micLevelEl ? Array.from(micLevelEl.querySelectorAll('span')) : [];

    // Helper: set mic button visual state
    const setMicBtnState = (on) => {
      if (!welcomeMicBtn) return;
      welcomeMicBtn.querySelector('.icon-mic-on').style.display  = on ? 'inline' : 'none';
      welcomeMicBtn.querySelector('.icon-mic-off').style.display = on ? 'none'   : 'inline';
      welcomeMicBtn.querySelector('.welcome-media-label').textContent = on ? 'Mic On' : 'Mic Off';
      welcomeMicBtn.classList.toggle('media-on', on);
      welcomeMicBtn.classList.toggle('mic-off', !on);
      if (micLevelEl) micLevelEl.classList.toggle('mic-active', on);
    };

    // Helper: set cam button visual state
    const setCamBtnState = (on) => {
      if (!welcomeCamBtn) return;
      welcomeCamBtn.querySelector('.icon-cam-on').style.display  = on ? 'inline' : 'none';
      welcomeCamBtn.querySelector('.icon-cam-off').style.display = on ? 'none'   : 'inline';
      welcomeCamBtn.querySelector('.welcome-media-label').textContent = on ? 'Cam On' : 'Cam Off';
      welcomeCamBtn.classList.toggle('media-on', on);
      welcomeCamBtn.classList.toggle('cam-off', !on);
      if (welcomeVideoOff) welcomeVideoOff.style.display = on ? 'none' : 'flex';
    };

    // Mic level animation
    const animateMicLevel = () => {
      if (!this._welcomeMicAnalyser || !this._welcomeMicOn) return;
      const data = new Uint8Array(this._welcomeMicAnalyser.frequencyBinCount);
      this._welcomeMicAnalyser.getByteFrequencyData(data);
      const avg = data.reduce((s, v) => s + v, 0) / data.length;
      const levels = [0.2, 0.5, 1.0, 0.5, 0.2];
      micLevelBars.forEach((bar, i) => {
        const h = Math.max(2, Math.min(16, avg * levels[i] * 0.22));
        bar.style.height = h + 'px';
      });
      this._welcomeMicLevelRaf = requestAnimationFrame(animateMicLevel);
    };

    // Stop mic preview
    const stopMicPreview = () => {
      if (this._welcomeMicLevelRaf) { cancelAnimationFrame(this._welcomeMicLevelRaf); this._welcomeMicLevelRaf = null; }
      if (this._welcomeMicStream) { this._welcomeMicStream.getTracks().forEach(t => t.stop()); this._welcomeMicStream = null; }
      this._welcomeMicAnalyser = null;
      this._welcomeMicOn = false;
      setMicBtnState(false);
      micLevelBars.forEach(b => { b.style.height = '4px'; });
    };

    // Stop cam preview
    const stopCamPreview = () => {
      if (this._welcomeCamStream) { this._welcomeCamStream.getTracks().forEach(t => t.stop()); this._welcomeCamStream = null; }
      if (welcomePreviewVid) { welcomePreviewVid.srcObject = null; welcomePreviewVid.style.display = 'none'; }
      this._welcomeCamOn = false;
      setCamBtnState(false);
    };

    // Start mic preview
    const startMicPreview = async (deviceId) => {
      stopMicPreview();
      try {
        const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false };
        this._welcomeMicStream = await navigator.mediaDevices.getUserMedia(constraints);
        this._welcomeMicOn = true;
        setMicBtnState(true);
        // Build analyser for level bars
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const src = ctx.createMediaStreamSource(this._welcomeMicStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          src.connect(analyser);
          this._welcomeMicAnalyser = analyser;
          animateMicLevel();
        }
      } catch (err) {
        console.warn('[UIManager] Could not start mic preview:', err);
      }
    };

    // Start cam preview
    const startCamPreview = async (deviceId) => {
      stopCamPreview();
      try {
        const constraints = { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false };
        this._welcomeCamStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (welcomePreviewVid) {
          welcomePreviewVid.srcObject = this._welcomeCamStream;
          welcomePreviewVid.style.display = 'block';
        }
        this._welcomeCamOn = true;
        setCamBtnState(true);
      } catch (err) {
        console.warn('[UIManager] Could not start camera preview:', err);
      }
    };

    // Mic toggle
    if (welcomeMicBtn) {
      welcomeMicBtn.addEventListener('click', async () => {
        if (this._welcomeMicOn) { stopMicPreview(); }
        else { await startMicPreview(this._welcomeSelectedMicId); }
      });
    }

    // Cam toggle
    if (welcomeCamBtn) {
      welcomeCamBtn.addEventListener('click', async () => {
        if (this._welcomeCamOn) { stopCamPreview(); }
        else { await startCamPreview(this._welcomeSelectedCamId); }
      });
    }

    // Settings toggle — populate device dropdowns on first open
    let devicesPopulated = false;
    const populateDevices = async () => {
      if (devicesPopulated) return;
      devicesPopulated = true;
      try {
        // Request permission to get labelled devices
        await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics      = devices.filter(d => d.kind === 'audioinput');
        const cams      = devices.filter(d => d.kind === 'videoinput');
        const speakers  = devices.filter(d => d.kind === 'audiooutput');

        const fillSelect = (selId, list, storedId) => {
          const sel = document.getElementById(selId);
          if (!sel) return;
          sel.innerHTML = '';
          if (!list.length) {
            sel.innerHTML = '<option value="">No devices found</option>';
            return;
          }
          list.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Device ${i + 1}`;
            if (storedId ? d.deviceId === storedId : i === 0) opt.selected = true;
            sel.appendChild(opt);
          });
        };

        fillSelect('select-welcome-mic',     mics,     this._welcomeSelectedMicId);
        fillSelect('select-welcome-cam',     cams,     this._welcomeSelectedCamId);
        fillSelect('select-welcome-speaker', speakers, this._welcomeSelectedSpeakerId);

        // Wire change handlers
        const micSel = document.getElementById('select-welcome-mic');
        const camSel = document.getElementById('select-welcome-cam');
        const spkSel = document.getElementById('select-welcome-speaker');

        if (micSel) micSel.addEventListener('change', async () => {
          this._welcomeSelectedMicId = micSel.value;
          try { localStorage.setItem('preferred_audio_input', micSel.value); } catch(e) {}
          if (this._welcomeMicOn) { await startMicPreview(micSel.value); }
        });
        if (camSel) camSel.addEventListener('change', async () => {
          this._welcomeSelectedCamId = camSel.value;
          try { localStorage.setItem('preferred_video_input', camSel.value); } catch(e) {}
          if (this._welcomeCamOn) { await startCamPreview(camSel.value); }
        });
        if (spkSel) spkSel.addEventListener('change', () => {
          this._welcomeSelectedSpeakerId = spkSel.value;
          try { localStorage.setItem('preferred_audio_output', spkSel.value); } catch(e) {}
        });
      } catch (err) {
        console.warn('[UIManager] Could not enumerate devices:', err);
      }
    };

    if (welcomeSettingsBtn && welcomeSettingsPanel) {
      welcomeSettingsBtn.addEventListener('click', async () => {
        this._welcomeSettingsOpen = !this._welcomeSettingsOpen;
        welcomeSettingsPanel.style.display = this._welcomeSettingsOpen ? 'flex' : 'none';
        welcomeSettingsBtn.classList.toggle('settings-open', this._welcomeSettingsOpen);
        if (this._welcomeSettingsOpen) await populateDevices();
      });
    }


    // Create Room button
    document.getElementById('btn-create-new-room').addEventListener('click', () => {
      this.handleCreateRoom();
    });

    // Join Room button
    document.getElementById('btn-join-room-submit').addEventListener('click', () => {
      this.handleJoinRoom();
    });

    // Enter key handling on room code input
    const joinInput = document.getElementById('input-join-room-code');
    if (joinInput) {
      joinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleJoinRoom();
        }
      });
    }

    // Enter key handling on name input
    if (nameInput) {
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const codeVal = document.getElementById('input-join-room-code')?.value.trim();
          if (codeVal) {
            this.handleJoinRoom();
          } else {
            this.handleCreateRoom();
          }
        }
      });
    }

    // Listen to manager events
    this.bindManagerEvents();
  }

  bindManagerEvents() {
    // Peer join errors
    peerManager.on('join_error', ({ message }) => {
      this.showJoinError(message || 'Failed to connect to room. Please check the code.');
    });
    // Media events
    mediaManager.on('local_stream_ready', ({ stream }) => {
      this.localVideoEl.srcObject = stream;
    });

    mediaManager.on('screen_share_changed', ({ isScreenSharing }) => {
      document.getElementById('btn-toggle-screen').classList.toggle('btn-active-danger', isScreenSharing);
    });

    mediaManager.on('screenshare_added', ({ peerId, stream, userName, isLocal }) => {
      this.handleScreenShareAdded({ peerId, stream, userName, isLocal });
    });

    mediaManager.on('screenshare_removed', ({ peerId }) => {
      this.handleScreenShareRemoved(peerId);
    });

    mediaManager.on('remote_stream_ready', ({ peerId, stream }) => {
      this.renderOrUpdatePeerTile(peerId, stream);
    });

    mediaManager.on('remote_stream_removed', ({ peerId }) => {
      this.removePeerTile(peerId);
      this.updatePeerCount();
    });

    mediaManager.on('speaking_change', ({ peerId, isSpeaking }) => {
      this.updateSpeakingVisualizer(peerId, isSpeaking);
    });

    mediaManager.on('peer_volume_changed', ({ peerId, volume }) => {
      const tile = this.peerTiles.get(peerId);
      if (tile) {
        const slider = tile.querySelector('.peer-vol-slider');
        const valText = tile.querySelector('.tile-vol-val');
        const pct = Math.round(volume * 100);
        if (slider) slider.value = pct;
        if (valText) valText.textContent = `${pct}%`;
      }
    });

    mediaManager.on('peer_local_mute_changed', ({ peerId, isMuted }) => {
      const tile = this.peerTiles.get(peerId);
      if (tile) {
        const muteBtn = tile.querySelector('.btn-peer-local-mute');
        if (muteBtn) {
          muteBtn.classList.toggle('is-muted-locally', isMuted);
          muteBtn.innerHTML = isMuted
            ? '<i data-lucide="volume-x"></i> <span>Unmute for me</span>'
            : '<i data-lucide="volume-2"></i> <span>Mute for me</span>';
          renderIcons(muteBtn);
        }
        const localMuteInd = tile.querySelector('.local-mute-indicator');
        if (localMuteInd) {
          localMuteInd.style.display = isMuted ? 'inline-flex' : 'none';
        }
      }
    });

    // Peer events
    peerManager.on('peer_connected', () => {
      this.updatePeerCount();
      this.renderCoworkerTasks();
    });

    peerManager.on('peer_left', ({ peerId }) => {
      this.removePeerTile(peerId);
      this.updatePeerCount();
      this.renderCoworkerTasks();
    });

    peerManager.on('peer_metadata_updated', ({ peerId, metadata }) => {
      this.updatePeerTileMetadata(peerId, metadata);
      this.renderCoworkerTasks();
    });

    // Task events
    taskManager.on('my_tasks_updated', () => {
      this.renderMyTasks();
      this.updateLocalActiveTaskBadge();
      this.renderCoworkerTasks();
    });

    taskManager.on('coworker_tasks_updated', ({ peerId }) => {
      this.renderCoworkerTasks();
      this.updatePeerActiveTaskBadge(peerId);
    });

    // Chat events
    chatManager.on('message_received', ({ message, unreadCount }) => {
      this.appendChatMessage(message);
      const unreadBadge = document.getElementById('chat-unread-badge');
      if (unreadCount > 0) {
        unreadBadge.textContent = unreadCount;
        unreadBadge.style.display = 'inline-block';
      }
    });

    chatManager.on('unread_cleared', () => {
      document.getElementById('chat-unread-badge').style.display = 'none';
    });

    // Pomodoro events
    pomodoroManager.on('room_tick', (state) => {
      this.renderRoomPomodoro(state);
      this.updateHeaderTimerGlance();
    });

    pomodoroManager.on('private_tick', (state) => {
      this.renderPrivatePomodoro(state);
      this.updateHeaderTimerGlance();
    });

    pomodoroManager.on('settings_updated', () => {
      this.updatePomodoroDisplay();
    });

    // Music events
    youtubeManager.on('state_changed', ({ isPlaying, title }) => {
      document.getElementById('btn-music-play').textContent = isPlaying ? 'Pause' : 'Play';
      const playIcon = document.getElementById('dock-music-play-icon');
      if (playIcon) {
        playIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
        renderIcons();
      }
      document.getElementById('dock-music-title').textContent = title || (youtubeManager.currentVideoId ? 'YouTube Audio' : 'No track');
      document.getElementById('music-now-title').textContent = title || (youtubeManager.currentVideoId ? 'YouTube Audio' : 'No track loaded');
      document.getElementById('music-status-text').textContent = isPlaying ? 'Playing' : (youtubeManager.currentVideoId ? 'Paused' : 'Idle');
      document.getElementById('music-wave-bars').style.opacity = isPlaying ? '1' : '0.2';
    });

    youtubeManager.on('track_changed', ({ title }) => {
      document.getElementById('music-now-title').textContent = title || (youtubeManager.currentVideoId ? 'YouTube Audio' : 'No track loaded');
      document.getElementById('dock-music-title').textContent = title || (youtubeManager.currentVideoId ? 'YouTube Audio' : 'No track');
    });

    youtubeManager.on('ready', ({ currentVideoId, title }) => {
      if (currentVideoId) {
        document.getElementById('music-now-title').textContent = title || 'YouTube Audio';
        document.getElementById('dock-music-title').textContent = title || 'YouTube Audio';
      } else {
        document.getElementById('music-now-title').textContent = 'No track loaded';
        document.getElementById('dock-music-title').textContent = 'No track';
        document.getElementById('music-status-text').textContent = 'Idle';
      }
    });

    youtubeManager.on('universal_volume_changed', ({ volume }) => {
      const musicVolSlider = document.getElementById('input-music-volume');
      if (musicVolSlider) musicVolSlider.value = volume;
      const volValEl = document.getElementById('music-vol-val');
      if (volValEl) volValEl.textContent = `${volume}%`;
    });

    youtubeManager.on('personal_volume_changed', ({ volume }) => {
      const dockVolSlider = document.getElementById('dock-music-vol');
      if (dockVolSlider) dockVolSlider.value = volume;
    });

    mediaManager.on('deafen_changed', ({ isDeafened, restoredStatus }) => {
      this.updateDeafenUi(isDeafened, restoredStatus);
    });
  }

  async populateAudioDevices() {
    const micSelect = document.getElementById('select-audio-input');
    const speakerSelect = document.getElementById('select-audio-output');
    if (!micSelect || !speakerSelect) return;

    const { inputs, outputs } = await mediaManager.getAudioDevices();

    micSelect.innerHTML = '';
    if (inputs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Default Mic';
      micSelect.appendChild(opt);
    } else {
      inputs.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Microphone ${i + 1}`;
        if (mediaManager.selectedAudioInputId === d.deviceId) opt.selected = true;
        micSelect.appendChild(opt);
      });
    }

    speakerSelect.innerHTML = '';
    if (outputs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Default Speaker';
      speakerSelect.appendChild(opt);
    } else {
      outputs.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `Speaker ${i + 1}`;
        if (mediaManager.selectedAudioOutputId === d.deviceId) opt.selected = true;
        speakerSelect.appendChild(opt);
      });
    }
  }

  // --- UI Renderers & Updaters ---

  switchSidebarTab(tabName) {
    document.querySelectorAll('.sidebar-tabs-nav .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.sidebar-content .tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });

    const activePane = document.getElementById(`pane-${tabName}`);
    if (activePane) activePane.classList.add('active');

    if (tabName === 'codeshare') {
      this.refreshCodeshareDisplay();
    }

    chatManager.setChatOpen(tabName === 'chat');
  }

  renderMyTasks() {
    const listEl = document.getElementById('my-task-list');
    listEl.innerHTML = '';

    const tasks = taskManager.myTasks;
    const completedCount = tasks.filter(t => t.completed).length;
    const totalCount = tasks.length;
    const percent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

    document.getElementById('task-stats-text').textContent = `${completedCount}/${totalCount} done`;
    document.getElementById('task-progress-fill').style.width = `${percent}%`;
    document.getElementById('tasks-badge').textContent = totalCount - completedCount;

    if (tasks.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No tasks</div>';
      return;
    }

    tasks.forEach(task => {
      const item = document.createElement('div');
      item.className = `task-item ${task.completed ? 'completed' : ''} ${task.isFocus ? 'is-focus-task' : ''}`;

      item.innerHTML = `
        <div class="task-left">
          <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} />
          <span class="task-text" title="${this.escapeHtml(task.title)}">${this.escapeHtml(task.title)}</span>
        </div>
        <div class="task-actions">
          <button class="btn-task-action btn-pin-focus ${task.isFocus ? 'active' : ''}" title="${task.isFocus ? 'Unpin' : 'Pin'}">
            <i data-lucide="star"></i>
          </button>
          <button class="btn-task-action btn-delete-task" title="Delete">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      `;

      item.querySelector('.task-checkbox').addEventListener('change', () => {
        taskManager.toggleTask(task.id);
      });

      item.querySelector('.btn-pin-focus').addEventListener('click', () => {
        playClick();
        taskManager.setFocusTask(task.id);
      });

      item.querySelector('.btn-delete-task').addEventListener('click', () => {
        playClick();
        taskManager.deleteTask(task.id);
      });

      listEl.appendChild(item);
    });
    renderIcons(listEl);
  }

  renderCoworkerTasks() {
    const container = document.getElementById('coworker-tasks-list');
    if (!container) return;
    container.innerHTML = '';

    // 1. Always render local user's card in Room view
    const myTasks = taskManager.myTasks;
    const myDone = myTasks.filter(t => t.completed).length;
    const myName = peerManager.userName || document.getElementById('header-user-name')?.textContent || 'You';
    const myAvatar = peerManager.userAvatar || getInitials(myName);
    const myGrad = getAvatarGradient(myName);

    const myCard = document.createElement('div');
    myCard.className = 'coworker-task-card my-room-task-card';

    let myTasksHtml = '';
    if (myTasks.length === 0) {
      myTasksHtml = '<div class="empty-state" style="padding:10px 0;">No tasks</div>';
    } else {
      myTasksHtml = myTasks.map(t => `
        <div class="coworker-task-row ${t.completed ? 'done' : ''}">
          <span class="coworker-task-icon">${t.completed ? '<i data-lucide="check" class="icon-sm"></i>' : (t.isFocus ? '<i data-lucide="target" class="icon-sm"></i>' : '<span class="task-bullet"></span>')}</span>
          <span style="flex:1;">${this.escapeHtml(t.title)}</span>
        </div>
      `).join('');
    }

    myCard.innerHTML = `
      <div class="coworker-card-header">
        <div class="coworker-card-user">
          <span class="avatar-badge initials-avatar" style="background: ${myGrad}">${myAvatar}</span>
          <span>${this.escapeHtml(myName)}</span>
          <span class="coworker-you-tag">YOU</span>
        </div>
        <span class="coworker-card-badge">${myDone}/${myTasks.length} done</span>
      </div>
      <div class="coworker-tasks-body">
        ${myTasksHtml}
      </div>
    `;
    container.appendChild(myCard);

    // 2. Render coworker cards
    const peers = peerManager.getAllPeers().filter(p => !p.isMe);
    peers.forEach(peer => {
      const data = taskManager.getCoworkerTasksForPeer(peer.id);
      const tasks = data.tasks || [];
      const stats = taskManager.getCoworkerProgress(peer.id);
      const peerName = peer.userName || data.userName || 'Coworker';
      const peerAvatar = peer.avatar || data.avatar || getInitials(peerName);
      const peerGrad = getAvatarGradient(peerName);

      const card = document.createElement('div');
      card.className = 'coworker-task-card';

      let tasksHtml = '';
      if (tasks.length === 0) {
        tasksHtml = '<div class="empty-state" style="padding:10px 0;">No tasks</div>';
      } else {
        tasksHtml = tasks.map(t => `
          <div class="coworker-task-row ${t.completed ? 'done' : ''}">
            <span class="coworker-task-icon">${t.completed ? '<i data-lucide="check" class="icon-sm"></i>' : (t.isFocus ? '<i data-lucide="target" class="icon-sm"></i>' : '<span class="task-bullet"></span>')}</span>
            <span style="flex:1;">${this.escapeHtml(t.title)}</span>
          </div>
        `).join('');
      }

      card.innerHTML = `
        <div class="coworker-card-header">
          <div class="coworker-card-user">
            <span class="avatar-badge initials-avatar" style="background: ${peerGrad}">${peerAvatar}</span>
            <span>${this.escapeHtml(peerName)}</span>
          </div>
          <span class="coworker-card-badge">${stats.completed}/${stats.total} done</span>
        </div>
        <div class="coworker-tasks-body">
          ${tasksHtml}
        </div>
      `;

      container.appendChild(card);
    });

    renderIcons(container);
  }

  updateLocalActiveTaskBadge() {
    const focusTask = taskManager.getFocusTask();
    const tag = document.getElementById('local-active-task');
    const textEl = document.getElementById('local-task-pin-text');

    if (focusTask) {
      tag.style.display = 'flex';
      textEl.textContent = focusTask.title;
    } else {
      tag.style.display = 'none';
    }
  }

  updatePeerActiveTaskBadge(peerId) {
    const tile = this.peerTiles.get(peerId);
    if (!tile) return;

    const focusTask = taskManager.getCoworkerFocusTask(peerId);
    const tag = tile.querySelector('.tile-active-task');
    const textEl = tile.querySelector('.task-pin-text');

    if (focusTask && tag && textEl) {
      tag.style.display = 'flex';
      textEl.textContent = focusTask.title;
    } else if (tag) {
      tag.style.display = 'none';
    }
  }

  renderOrUpdatePeerTile(peerId, stream) {
    let tile = this.peerTiles.get(peerId);
    const meta = peerManager.getPeerMetadata(peerId) || { userName: 'Coworker' };
    const peerName = meta.userName || 'Coworker';
    const initials = getInitials(peerName);
    const grad = getAvatarGradient(peerName);

    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'video-tile';
      tile.id = `tile-peer-${peerId}`;

      tile.innerHTML = `
        <div class="tile-video-wrapper">
          <video autoplay playsinline muted></video>
          <div class="avatar-fallback">
            <div class="avatar-fallback-icon initials-avatar" style="background: ${grad}">${initials}</div>
            <div class="avatar-fallback-name">${this.escapeHtml(peerName)}</div>
          </div>
          <div class="speaking-indicator-ring"></div>
        </div>

        <div class="tile-overlay-top">
          <div class="tile-user-info">
            <span class="tile-avatar initials-avatar" style="background: ${grad}">${initials}</span>
            <span class="tile-name">${this.escapeHtml(peerName)}</span>
            <div class="speaking-wave" style="display: none;">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div class="tile-status-badges">
            <span class="focus-badge">${this.escapeHtml(meta.focusStatus || 'Bored')}</span>
          </div>
        </div>

        <div class="tile-active-task" style="display: none;">
          <span class="task-pin-icon"><i data-lucide="target"></i></span>
          <span class="task-pin-text">Working on...</span>
        </div>

        <div class="tile-overlay-bottom">
          <div class="stream-indicators">
            <span class="indicator-icon mic-indicator" title="Mic">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </span>
            <span class="indicator-icon local-mute-indicator muted" title="Muted for you" style="display: none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
            </span>
            <span class="indicator-icon cam-indicator" title="Camera">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
            </span>
          </div>

          <!-- Coworker Tile 3-Dot Menu: Sound Sliders & Mute -->
          <div class="tile-menu-container">
            <button class="btn-tile-menu" title="Audio Settings" type="button" aria-label="Audio Settings">
              <i data-lucide="more-vertical"></i>
            </button>
            <div class="tile-menu-dropdown" style="display: none;">
              <div class="tile-menu-item-header">
                <span>Volume</span>
                <span class="tile-vol-val">100%</span>
              </div>
              <div class="tile-menu-slider-row">
                <i data-lucide="volume-2" class="tile-menu-vol-icon"></i>
                <input type="range" class="peer-vol-slider" min="0" max="100" value="100" title="Volume" />
              </div>
              <div class="tile-menu-divider"></div>
              <button class="btn-peer-local-mute tile-menu-btn" title="Mute for me" type="button">
                <i data-lucide="volume-2"></i>
                <span>Mute for me</span>
              </button>
            </div>
          </div>
        </div>
      `;

      // 3-dot dropdown menu toggling
      const menuBtn = tile.querySelector('.btn-tile-menu');
      const menuDropdown = tile.querySelector('.tile-menu-dropdown');
      const volSlider = tile.querySelector('.peer-vol-slider');
      const volVal = tile.querySelector('.tile-vol-val');
      const muteBtn = tile.querySelector('.btn-peer-local-mute');
      const localMuteInd = tile.querySelector('.local-mute-indicator');

      // Sync initial audio state
      const initialAudio = mediaManager.getPeerAudioState(peerId);
      if (initialAudio) {
        const initPct = Math.round(initialAudio.volume * 100);
        volSlider.value = initPct;
        volVal.textContent = `${initPct}%`;
        if (initialAudio.isMutedLocally) {
          muteBtn.classList.add('is-muted-locally');
          muteBtn.innerHTML = '<i data-lucide="volume-x"></i> <span>Unmute for me</span>';
          if (localMuteInd) localMuteInd.style.display = 'inline-flex';
        }
      }

      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playClick();
        const isOpen = menuDropdown.style.display !== 'none';
        // Close other tile dropdowns
        document.querySelectorAll('.tile-menu-dropdown').forEach(d => {
          if (d !== menuDropdown) d.style.display = 'none';
        });
        document.querySelectorAll('.btn-tile-menu').forEach(b => {
          if (b !== menuBtn) b.classList.remove('active');
        });
        menuDropdown.style.display = isOpen ? 'none' : 'flex';
        menuBtn.classList.toggle('active', !isOpen);
      });

      menuDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // Event listener for local volume slider
      volSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (volVal) volVal.textContent = `${val}%`;
        const vol = val / 100;
        mediaManager.setPeerVolume(peerId, vol);
      });

      // Event listener for local mute button
      muteBtn.addEventListener('click', () => {
        playClick();
        const isMuted = mediaManager.toggleMutePeerLocally(peerId);
        muteBtn.classList.toggle('is-muted-locally', isMuted);
        muteBtn.innerHTML = isMuted
          ? '<i data-lucide="volume-x"></i> <span>Unmute for me</span>'
          : '<i data-lucide="volume-2"></i> <span>Mute for me</span>';
        renderIcons(muteBtn);
        if (localMuteInd) localMuteInd.style.display = isMuted ? 'inline-flex' : 'none';
      });

      this.videoGridEl.appendChild(tile);
      this.peerTiles.set(peerId, tile);
      renderIcons(tile);
    }

    // Attach stream to video element
    const videoEl = tile.querySelector('video');
    if (videoEl && stream) {
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream;
        videoEl.muted = true;
        videoEl.play().catch(() => {});
        mediaManager.registerRemoteVideoElement(peerId, videoEl);
      }
    }

    this.updatePeerTileMetadata(peerId, meta);
    this.updatePeerActiveTaskBadge(peerId);
    this.updatePeerCount();
  }

  updatePeerTileMetadata(peerId, metadata) {
    if (peerId === peerManager.myPeerId) {
      const myName = metadata.userName || peerManager.userName || 'You';
      const initials = getInitials(myName);
      const grad = getAvatarGradient(myName);

      const localTileAvatar = document.getElementById('local-tile-avatar');
      if (localTileAvatar) {
        localTileAvatar.textContent = initials;
        localTileAvatar.style.background = grad;
      }
      const localFallback = document.getElementById('local-fallback-icon');
      if (localFallback) {
        localFallback.textContent = initials;
        localFallback.style.background = grad;
      }
      const headerAvatar = document.getElementById('header-user-avatar');
      if (headerAvatar) {
        headerAvatar.textContent = initials;
        headerAvatar.style.background = grad;
      }

      const headerTag = document.getElementById('header-focus-tag');
      if (headerTag) headerTag.textContent = metadata.focusStatus || 'Bored';

      const focusBadge = document.getElementById('local-focus-badge');
      if (focusBadge) {
        focusBadge.textContent = metadata.focusStatus || 'Bored';
        focusBadge.classList.toggle('deafened', !!metadata.isDeafened);
      }
      if (metadata.isCamOff !== undefined) {
        const localCamInd = document.getElementById('local-indicator-cam');
        if (localCamInd) {
          localCamInd.classList.toggle('muted', !!metadata.isCamOff);
          localCamInd.title = metadata.isCamOff ? 'Camera Off' : 'Camera On';
        }
      }
      return;
    }

    const tile = this.peerTiles.get(peerId) || document.getElementById(`tile-peer-${peerId}`);
    if (!tile) return;

    if (metadata.userName) {
      const initials = getInitials(metadata.userName);
      const grad = getAvatarGradient(metadata.userName);

      tile.querySelector('.tile-name').textContent = metadata.userName;
      tile.querySelector('.avatar-fallback-name').textContent = metadata.userName;

      const tileAvatar = tile.querySelector('.tile-avatar');
      if (tileAvatar) {
        tileAvatar.textContent = initials;
        tileAvatar.style.background = grad;
      }

      const fallbackIcon = tile.querySelector('.avatar-fallback-icon');
      if (fallbackIcon) {
        fallbackIcon.textContent = initials;
        fallbackIcon.style.background = grad;
      }
    }
    if (metadata.focusStatus) {
      const badge = tile.querySelector('.focus-badge');
      badge.textContent = metadata.focusStatus;
      badge.classList.toggle('deafened', !!metadata.isDeafened);
    }
    if (metadata.isCamOff !== undefined) {
      tile.classList.toggle('cam-off', metadata.isCamOff);
      const camInd = tile.querySelector('.cam-indicator');
      if (camInd) {
        camInd.classList.toggle('muted', !!metadata.isCamOff);
        camInd.title = metadata.isCamOff ? 'Camera Off' : 'Camera On';
      }
    }
    if (metadata.isMuted !== undefined) {
      const micInd = tile.querySelector('.mic-indicator');
      if (micInd) micInd.classList.toggle('muted', metadata.isMuted);
    }
  }

  removePeerTile(peerId) {
    console.log(`[UIManager] Removing peer tile: ${peerId}`);
    const tile = this.peerTiles.get(peerId) || document.getElementById(`tile-peer-${peerId}`);
    if (tile) {
      const video = tile.querySelector('video');
      if (video) {
        video.srcObject = null;
        try { video.pause(); } catch(e) {}
      }
      tile.remove();
      this.peerTiles.delete(peerId);
    }
    this.handleScreenShareRemoved(peerId);
    this.updatePeerCount();
    this.renderCoworkerTasks();
  }

  handleScreenShareAdded({ peerId, stream, userName, isLocal }) {
    console.log(`[UIManager] Screen share added for ${peerId} (${userName})`);
    const screenKey = peerId;

    let screenTile = this.screenTiles.get(screenKey);
    const displayName = isLocal ? `${userName} (You)` : userName;

    if (!screenTile) {
      screenTile = document.createElement('div');
      screenTile.className = 'video-tile screen-tile';
      screenTile.id = `tile-screen-${screenKey}`;
      screenTile.dataset.screenId = screenKey;

      screenTile.innerHTML = `
        <div class="tile-video-wrapper screen-video-wrapper">
          <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
        </div>
        <div class="tile-overlay-top screen-overlay-top">
          <div class="tile-user-info">
            <span class="screen-indicator-badge">
              <i data-lucide="monitor" class="screen-icon"></i>
              <span class="screen-title-text">${this.escapeHtml(displayName)}'s Screen</span>
            </span>
            <span class="screen-live-tag">PRESENTING</span>
            <div class="speaking-wave screen-presenter-wave" style="display: none;">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div class="screen-tile-actions">
            ${isLocal ? `
              <button class="btn-stop-share-pill" id="btn-stop-screen-tile" title="Stop Sharing Screen">
                <i data-lucide="square" style="width: 13px; height: 13px;"></i>
                <span>Stop Sharing</span>
              </button>
            ` : ''}
            <button class="btn-icon-subtle btn-toggle-fullscreen" title="Full Screen">
              <i data-lucide="maximize-2" style="width: 15px; height: 15px;"></i>
            </button>
          </div>
        </div>
        <div class="screen-tray-badge" style="display: none;">
          <i data-lucide="monitor" style="width: 12px; height: 12px;"></i>
          <span>${this.escapeHtml(displayName)}'s Screen</span>
        </div>
      `;

      if (isLocal) {
        const stopBtn = screenTile.querySelector('#btn-stop-screen-tile');
        if (stopBtn) {
          stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playClick();
            mediaManager.stopScreenShare();
          });
        }
      }

      const fsBtn = screenTile.querySelector('.btn-toggle-fullscreen');
      if (fsBtn) {
        fsBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          playClick();
          if (!document.fullscreenElement) {
            screenTile.requestFullscreen().catch(err => console.warn(err));
          } else {
            document.exitFullscreen().catch(() => {});
          }
        });
      }

      this.screenTiles.set(screenKey, screenTile);
      if (!this.activeScreenIds.includes(screenKey)) {
        this.activeScreenIds.push(screenKey);
      }
      renderIcons(screenTile);
    }

    const video = screenTile.querySelector('video');
    if (video && video.srcObject !== stream) {
      video.srcObject = stream;
      if (isLocal) video.muted = true;
      video.play().catch(() => {});
    }

    this.recalculateScreenStageLayout();
  }

  handleScreenShareRemoved(peerId) {
    console.log(`[UIManager] Screen share removed for ${peerId}`);
    const screenKey = peerId;
    const tile = this.screenTiles.get(screenKey);
    if (tile) {
      const video = tile.querySelector('video');
      if (video) {
        video.srcObject = null;
        try { video.pause(); } catch(e) {}
      }
      tile.remove();
      this.screenTiles.delete(screenKey);
    }

    this.activeScreenIds = this.activeScreenIds.filter(id => id !== screenKey);
    this.stagedScreenIds = this.stagedScreenIds.filter(id => id !== screenKey);
    this.recalculateScreenStageLayout();
  }

  recalculateScreenStageLayout() {
    if (!this.presentationStageEl || !this.screensContainerEl) return;

    if (this.activeScreenIds.length === 0) {
      // No screen shares active: restore standard video mesh grid
      this.presentationStageEl.style.display = 'none';
      if (this.stageSectionEl) this.stageSectionEl.classList.remove('has-screenshare');
      if (this.videoGridEl) this.videoGridEl.classList.remove('tray-mode');
      this.screensContainerEl.innerHTML = '';
      this.stagedScreenIds = [];
      return;
    }

    // Screen shares are active: enter presentation stage mode
    this.presentationStageEl.style.display = 'flex';
    if (this.stageSectionEl) this.stageSectionEl.classList.add('has-screenshare');
    if (this.videoGridEl) this.videoGridEl.classList.add('tray-mode');

    // Keep only currently active IDs in stagedScreenIds
    this.stagedScreenIds = this.stagedScreenIds.filter(id => this.activeScreenIds.includes(id));

    // Fill up to max 2 screens on stage
    for (const id of this.activeScreenIds) {
      if (this.stagedScreenIds.length >= 2) break;
      if (!this.stagedScreenIds.includes(id)) {
        this.stagedScreenIds.push(id);
      }
    }

    // Set stage container class (1 = single full view, 2 = dual split view)
    const stageCount = this.stagedScreenIds.length;
    this.screensContainerEl.className = `screens-container ${stageCount === 2 ? 'stage-layout-dual' : 'stage-layout-single'}`;

    // Place the up to 2 screen tiles into screensContainerEl
    this.stagedScreenIds.forEach(id => {
      const tile = this.screenTiles.get(id);
      if (tile) {
        tile.classList.remove('in-tray');
        const trayBadge = tile.querySelector('.screen-tray-badge');
        if (trayBadge) trayBadge.style.display = 'none';
        tile.onclick = null;
        if (tile.parentElement !== this.screensContainerEl) {
          this.screensContainerEl.appendChild(tile);
        }
      }
    });

    // Any excess screens (3rd, 4th, etc.) go into the bottom tray (#video-grid)
    const trayScreens = this.activeScreenIds.filter(id => !this.stagedScreenIds.includes(id));
    trayScreens.forEach(id => {
      const tile = this.screenTiles.get(id);
      if (tile) {
        tile.classList.add('in-tray');
        const trayBadge = tile.querySelector('.screen-tray-badge');
        if (trayBadge) trayBadge.style.display = 'flex';
        tile.title = 'Click to swap onto stage';
        tile.onclick = () => {
          playClick();
          // Swap this tray screen into stage position 1 (or 0 if only 1 staged)
          const targetSlot = this.stagedScreenIds.length > 1 ? 1 : 0;
          this.stagedScreenIds[targetSlot] = id;
          this.recalculateScreenStageLayout();
        };
        if (tile.parentElement !== this.videoGridEl) {
          this.videoGridEl.appendChild(tile);
        }
      }
    });
  }

  updateSpeakingVisualizer(peerId, isSpeaking) {
    let targetTile = null;
    let waveEl = null;

    if (peerId === 'local' || peerId === peerManager.myPeerId) {
      targetTile = document.getElementById('tile-local');
      waveEl = document.getElementById('local-speaking-wave');
    } else {
      targetTile = this.peerTiles.get(peerId) || document.getElementById(`tile-peer-${peerId}`);
      if (targetTile) {
        waveEl = targetTile.querySelector('.speaking-wave');
      }
    }

    if (targetTile) {
      targetTile.classList.toggle('is-speaking', isSpeaking);
      if (waveEl) {
        waveEl.style.display = isSpeaking ? 'inline-flex' : 'none';
      }
    }

    // Also update screen tile presenter badge if this peer is sharing on stage
    const screenKey = (peerId === 'local' || peerId === peerManager.myPeerId) ? 'local' : peerId;
    const screenTile = this.screenTiles.get(screenKey);
    if (screenTile) {
      const presenterBadge = screenTile.querySelector('.screen-indicator-badge');
      const presenterWave = screenTile.querySelector('.screen-presenter-wave');
      if (presenterBadge) {
        presenterBadge.classList.toggle('is-speaking', isSpeaking);
      }
      if (presenterWave) {
        presenterWave.style.display = isSpeaking ? 'inline-flex' : 'none';
      }
    }
  }

  updateMicUi(isMuted) {
    const btn = document.getElementById('btn-toggle-mic');
    btn.classList.toggle('btn-active-danger', isMuted);
    btn.querySelector('.icon-mic-on').style.display = isMuted ? 'none' : 'block';
    btn.querySelector('.icon-mic-off').style.display = isMuted ? 'block' : 'none';

    const localInd = document.getElementById('local-indicator-mic');
    if (localInd) localInd.classList.toggle('muted', isMuted);
  }

  updateCamUi(isOff) {
    const btn = document.getElementById('btn-toggle-cam');
    btn.classList.toggle('btn-active-danger', isOff);
    btn.querySelector('.icon-cam-on').style.display = isOff ? 'none' : 'block';
    btn.querySelector('.icon-cam-off').style.display = isOff ? 'block' : 'none';

    const localTile = document.getElementById('tile-local');
    if (localTile) localTile.classList.toggle('cam-off', isOff);

    const localCamInd = document.getElementById('local-indicator-cam');
    if (localCamInd) {
      localCamInd.classList.toggle('muted', isOff);
      localCamInd.title = isOff ? 'Camera Off' : 'Camera On';
    }
  }

  updateDeafenUi(isDeafened, restoredStatus = null) {
    const btn = document.getElementById('btn-toggle-deafen');
    btn.classList.toggle('is-deafened', isDeafened);
    document.getElementById('deafen-btn-label').textContent = isDeafened ? 'Deafened' : 'Deafen';

    const statusToSet = isDeafened
      ? 'Deafened'
      : (restoredStatus || mediaManager.savedStatusBeforeDeafen || 'Bored');

    const headerTag = document.getElementById('header-focus-tag');
    if (headerTag) headerTag.textContent = statusToSet;
    const localBadge = document.getElementById('local-focus-badge');
    if (localBadge) {
      localBadge.textContent = statusToSet;
      localBadge.classList.toggle('deafened', isDeafened);
    }

    this.updateMicUi(mediaManager.isAudioMuted);
  }

  syncStatusModalState() {
    const currentStatus = (peerManager.myPeerId && peerManager.getPeerMetadata(peerManager.myPeerId)?.focusStatus)
      || document.getElementById('header-focus-tag')?.textContent?.trim()
      || 'Bored';

    let matched = false;
    const buttons = document.querySelectorAll('.status-option-btn');
    buttons.forEach(btn => {
      const isMatch = btn.dataset.status.trim().toLowerCase() === currentStatus.toLowerCase();
      btn.classList.toggle('active', isMatch);
      if (isMatch) matched = true;
    });

    const customInput = document.getElementById('input-custom-status');
    const emojiChosen = document.getElementById('custom-status-chosen-emoji');
    if (!matched) {
      // Check if currentStatus begins with an emoji
      const emojiMatch = currentStatus.match(/^(\p{Extended_Pictographic}|\p{Emoji})\s*(.*)$/u);
      if (emojiMatch) {
        if (emojiChosen) emojiChosen.textContent = emojiMatch[1];
        if (customInput) customInput.value = emojiMatch[2];
      } else {
        if (customInput) customInput.value = currentStatus;
      }
    } else {
      if (customInput) customInput.value = '';
    }
  }

  setUserStatus(status) {
    if (status !== 'Deafened') {
      mediaManager.savedStatusBeforeDeafen = status;
    }
    peerManager.updateMyStatus({ focusStatus: status });
    const headerTag = document.getElementById('header-focus-tag');
    if (headerTag) headerTag.textContent = status;
    const localBadge = document.getElementById('local-focus-badge');
    if (localBadge) {
      localBadge.textContent = status;
      localBadge.classList.toggle('deafened', status === 'Deafened');
    }
  }

  updateHeaderTimerGlance() {
    const isRoom = pomodoroManager.activeTab === 'room';
    const state = isRoom ? pomodoroManager.getRoomState() : pomodoroManager.getPrivateState();

    document.getElementById('header-timer-type').textContent = isRoom ? 'Room' : 'Private';
    document.getElementById('header-timer-time').textContent = state.timeFormatted;
    document.getElementById('header-timer-mode').textContent = state.mode === 'focus' ? 'Focus' : 'Break';
  }

  updatePomodoroDisplay() {
    this.renderRoomPomodoro(pomodoroManager.getRoomState());
    this.renderPrivatePomodoro(pomodoroManager.getPrivateState());
    this.updateHeaderTimerGlance();
  }

  renderRoomPomodoro(state) {
    const digits = document.getElementById('room-timer-digits');
    const fill = document.getElementById('room-timer-progress-fill');
    const toggleBtn = document.getElementById('btn-room-timer-toggle');
    const modeTag = document.getElementById('room-timer-mode-tag');

    if (digits) digits.textContent = state.timeFormatted;
    if (fill) fill.style.width = `${state.progress * 100}%`;
    if (toggleBtn) toggleBtn.textContent = state.isRunning ? 'Pause' : 'Start';

    // Update mode button labels with configured minutes
    const btnFocus = document.getElementById('btn-room-mode-focus');
    const btnShort = document.getElementById('btn-room-mode-shortBreak');
    const btnLong = document.getElementById('btn-room-mode-longBreak');
    if (btnFocus) btnFocus.textContent = `Focus ${state.settings.focus}m`;
    if (btnShort) btnShort.textContent = `Short ${state.settings.shortBreak}m`;
    if (btnLong) btnLong.textContent = `Long ${state.settings.longBreak}m`;

    if (modeTag) {
      const modeLabel = state.mode === 'focus' ? 'Focus' : (state.mode === 'shortBreak' ? 'Short Break' : 'Long Break');
      modeTag.textContent = `Shared ${modeLabel}`;
    }

    // Update Cycle Tracker
    const cycleText = document.getElementById('room-cycle-text');
    if (cycleText) cycleText.textContent = `${state.round} of ${state.totalRounds}`;

    const cycleDots = document.getElementById('room-cycle-dots');
    if (cycleDots) {
      let html = '';
      for (let i = 1; i <= state.totalRounds; i++) {
        html += `<span class="cycle-dot ${i <= state.round ? 'active' : ''}"></span>`;
      }
      cycleDots.innerHTML = html;
    }

    const tallyCount = document.getElementById('room-completed-count');
    if (tallyCount) tallyCount.textContent = state.completedCount;
  }

  renderPrivatePomodoro(state) {
    const digits = document.getElementById('private-timer-digits');
    const fill = document.getElementById('private-timer-progress-fill');
    const toggleBtn = document.getElementById('btn-private-timer-toggle');
    const modeTag = document.getElementById('private-timer-mode-tag');

    if (digits) digits.textContent = state.timeFormatted;
    if (fill) fill.style.width = `${state.progress * 100}%`;
    if (toggleBtn) toggleBtn.textContent = state.isRunning ? 'Pause' : 'Start';

    // Update mode button labels with configured minutes
    const btnFocus = document.getElementById('btn-private-mode-focus');
    const btnShort = document.getElementById('btn-private-mode-shortBreak');
    const btnLong = document.getElementById('btn-private-mode-longBreak');
    if (btnFocus) btnFocus.textContent = `Focus ${state.settings.focus}m`;
    if (btnShort) btnShort.textContent = `Short ${state.settings.shortBreak}m`;
    if (btnLong) btnLong.textContent = `Long ${state.settings.longBreak}m`;

    if (modeTag) {
      const modeLabel = state.mode === 'focus' ? 'Focus' : (state.mode === 'shortBreak' ? 'Short Break' : 'Long Break');
      modeTag.textContent = `Private ${modeLabel}`;
    }

    // Update Cycle Tracker
    const cycleText = document.getElementById('private-cycle-text');
    if (cycleText) cycleText.textContent = `${state.round} of ${state.totalRounds}`;

    const cycleDots = document.getElementById('private-cycle-dots');
    if (cycleDots) {
      let html = '';
      for (let i = 1; i <= state.totalRounds; i++) {
        html += `<span class="cycle-dot ${i <= state.round ? 'active' : ''}"></span>`;
      }
      cycleDots.innerHTML = html;
    }

    const tallyCount = document.getElementById('private-completed-count');
    if (tallyCount) tallyCount.textContent = state.completedCount;
  }

  setupPomodoroCustomization() {
    let currentModalTarget = pomodoroManager.activeTab || 'private';

    const modalBackdrop = document.getElementById('pomodoro-settings-backdrop');
    const btnOpen = document.getElementById('btn-pomo-customize');
    const btnClose = document.getElementById('btn-close-pomo-settings');
    const btnCancel = document.getElementById('btn-pomo-cancel');
    const btnSave = document.getElementById('btn-pomo-save');
    const btnResetDefaults = document.getElementById('btn-pomo-reset-defaults');
    const btnPreviewSound = document.getElementById('btn-preview-sound');

    const targetTabPrivate = document.getElementById('pomo-target-private');
    const targetTabRoom = document.getElementById('pomo-target-room');

    const inputFocus = document.getElementById('input-pomo-focus');
    const inputShort = document.getElementById('input-pomo-short');
    const inputLong = document.getElementById('input-pomo-long');
    const inputInterval = document.getElementById('input-pomo-interval');
    const checkAutoBreaks = document.getElementById('check-pomo-auto-breaks');
    const checkAutoFocus = document.getElementById('check-pomo-auto-focus');
    const selectSound = document.getElementById('select-pomo-sound');
    const checkDesktopNotif = document.getElementById('check-pomo-desktop-notif');
    const presetPills = document.querySelectorAll('.preset-pill');

    if (!btnOpen || !modalBackdrop) return;

    const updatePresetPillHighlight = () => {
      const f = parseInt(inputFocus.value);
      const s = parseInt(inputShort.value);
      const l = parseInt(inputLong.value);
      presetPills.forEach(pill => {
        const pf = parseInt(pill.dataset.focus);
        const ps = parseInt(pill.dataset.short);
        const pl = parseInt(pill.dataset.long);
        if (pf === f && ps === s && pl === l) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });
    };

    const loadSettingsIntoModal = (target) => {
      currentModalTarget = target;
      if (target === 'room') {
        targetTabRoom.classList.add('active');
        targetTabPrivate.classList.remove('active');
      } else {
        targetTabPrivate.classList.add('active');
        targetTabRoom.classList.remove('active');
      }

      const settings = pomodoroManager.getSettings(target);
      inputFocus.value = settings.focus;
      inputShort.value = settings.shortBreak;
      inputLong.value = settings.longBreak;
      inputInterval.value = settings.longBreakInterval || 4;
      checkAutoBreaks.checked = !!settings.autoStartBreaks;
      checkAutoFocus.checked = !!settings.autoStartFocus;
      selectSound.value = settings.soundAlert || 'singingBowl';
      checkDesktopNotif.checked = !!settings.desktopNotification;

      updatePresetPillHighlight();
    };

    // Open modal
    btnOpen.addEventListener('click', () => {
      playClick();
      currentModalTarget = pomodoroManager.activeTab || 'private';
      loadSettingsIntoModal(currentModalTarget);
      modalBackdrop.style.display = 'flex';
      renderIcons();
    });

    // Close modal
    const closeModal = () => {
      playClick();
      modalBackdrop.style.display = 'none';
    };

    if (btnClose) btnClose.addEventListener('click', closeModal);
    if (btnCancel) btnCancel.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    // Target switcher
    if (targetTabPrivate) {
      targetTabPrivate.addEventListener('click', () => {
        playClick();
        loadSettingsIntoModal('private');
      });
    }
    if (targetTabRoom) {
      targetTabRoom.addEventListener('click', () => {
        playClick();
        loadSettingsIntoModal('room');
      });
    }

    // Steppers
    document.querySelectorAll('[data-step-target]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        playClick();
        const targetId = e.currentTarget.dataset.stepTarget;
        const step = parseInt(e.currentTarget.dataset.step) || 1;
        const input = document.getElementById(targetId);
        if (!input) return;
        const min = parseInt(input.min) || 1;
        const max = parseInt(input.max) || 180;
        const currentVal = parseInt(input.value) || min;
        input.value = Math.max(min, Math.min(max, currentVal + step));
        updatePresetPillHighlight();
      });
    });

    // Manual input updates highlight
    [inputFocus, inputShort, inputLong].forEach(input => {
      if (input) input.addEventListener('input', updatePresetPillHighlight);
    });

    // Preset pills
    presetPills.forEach(pill => {
      pill.addEventListener('click', () => {
        playClick();
        inputFocus.value = pill.dataset.focus;
        inputShort.value = pill.dataset.short;
        inputLong.value = pill.dataset.long;
        updatePresetPillHighlight();
      });
    });

    // Sound preview
    if (btnPreviewSound) {
      btnPreviewSound.addEventListener('click', () => {
        playPomodoroSound(selectSound.value);
      });
    }

    // Reset defaults
    if (btnResetDefaults) {
      btnResetDefaults.addEventListener('click', () => {
        playClick();
        inputFocus.value = DEFAULT_POMODORO_SETTINGS.focus;
        inputShort.value = DEFAULT_POMODORO_SETTINGS.shortBreak;
        inputLong.value = DEFAULT_POMODORO_SETTINGS.longBreak;
        inputInterval.value = DEFAULT_POMODORO_SETTINGS.longBreakInterval;
        checkAutoBreaks.checked = DEFAULT_POMODORO_SETTINGS.autoStartBreaks;
        checkAutoFocus.checked = DEFAULT_POMODORO_SETTINGS.autoStartFocus;
        selectSound.value = DEFAULT_POMODORO_SETTINGS.soundAlert;
        checkDesktopNotif.checked = DEFAULT_POMODORO_SETTINGS.desktopNotification;
        updatePresetPillHighlight();
      });
    }

    // Save
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        playClick();
        const newSettings = {
          focus: parseInt(inputFocus.value) || 25,
          shortBreak: parseInt(inputShort.value) || 5,
          longBreak: parseInt(inputLong.value) || 15,
          longBreakInterval: parseInt(inputInterval.value) || 4,
          autoStartBreaks: checkAutoBreaks.checked,
          autoStartFocus: checkAutoFocus.checked,
          soundAlert: selectSound.value,
          desktopNotification: checkDesktopNotif.checked
        };

        if (newSettings.desktopNotification && typeof Notification !== 'undefined') {
          if (Notification.permission === 'default') {
            Notification.requestPermission();
          }
        }

        pomodoroManager.updateSettings(currentModalTarget, newSettings);
        modalBackdrop.style.display = 'none';
        this.updatePomodoroDisplay();
      });
    }
  }

  updatePeerCount() {
    const total = 1 + this.peerTiles.size;
    document.getElementById('peer-count-num').textContent = total;
    this.updateCodeshareCollaborators();
  }

  appendChatMessage(msg) {
    const container = document.getElementById('chat-messages-container');

    const msgEl = document.createElement('div');
    if (msg.isSystem) {
      msgEl.className = 'chat-msg system';
      msgEl.innerHTML = `<span>${this.escapeHtml(msg.text)}</span>`;
    } else {
      msgEl.className = `chat-msg ${msg.isMe ? 'mine' : 'other'}`;
      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const senderName = msg.senderName || 'Coworker';
      const initials = getInitials(senderName);
      const grad = getAvatarGradient(senderName);

      msgEl.innerHTML = `
        <div class="chat-msg-header">
          <span class="chat-avatar initials-avatar" style="background: ${grad}">${initials}</span>
          <span>${this.escapeHtml(senderName)}</span>
          <span>${timeStr}</span>
        </div>
        <div class="chat-msg-bubble">${this.escapeHtml(msg.text)}</div>
      `;
    }

    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  copyRoomCode() {
    playClick();
    if (!peerManager.roomCode) return;
    navigator.clipboard.writeText(peerManager.roomCode).then(() => {
      const codeEl = document.getElementById('header-room-code');
      if (codeEl) {
        const orig = codeEl.textContent;
        codeEl.textContent = 'Copied!';
        setTimeout(() => { codeEl.textContent = orig; }, 1500);
      }
    }).catch(() => {
      prompt('Copy room code:', peerManager.roomCode);
    });
  }

  copyInviteLink() {
    playClick();
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', peerManager.roomCode);

    navigator.clipboard.writeText(url.toString()).then(() => {
      const textEl = document.getElementById('copy-feedback-text');
      if (textEl) {
        textEl.textContent = 'Copied!';
        setTimeout(() => { textEl.textContent = 'Invite'; }, 2000);
      }
    }).catch(err => {
      prompt('Copy this invite link:', url.toString());
    });
  }

  showJoinError(message) {
    const banner = document.getElementById('join-error-banner');
    if (banner) {
      banner.textContent = message;
      banner.style.display = 'block';
    } else {
      alert(message);
    }
    const statusLabel = document.getElementById('status-label');
    if (statusLabel) statusLabel.textContent = 'Ready';

    // Bring back welcome modal
    const welcomeModal = document.getElementById('welcome-modal');
    if (welcomeModal) welcomeModal.style.display = 'flex';

    // Stop streams and leave
    mediaManager.stopAll();
    peerManager.leaveRoom();
  }

  clearJoinError() {
    const banner = document.getElementById('join-error-banner');
    if (banner) {
      banner.textContent = '';
      banner.style.display = 'none';
    }
  }

  checkUrlForRoomInvite() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');

    if (room) {
      const clean = cleanRoomCode(room);
      const roomInput = document.getElementById('input-join-room-code');
      if (roomInput) roomInput.value = clean;
      const nameInput = document.getElementById('input-display-name');
      if (nameInput && !nameInput.value.trim()) {
        nameInput.placeholder = 'Your Name';
      }
      const subtitle = document.querySelector('.welcome-header p');
      if (subtitle) {
        subtitle.innerHTML = `You've been invited to join room <strong>${this.escapeHtml(clean)}</strong>! Pick your name to enter.`;
      }
    }
  }

  async handleCreateRoom() {
    playClick();
    this.clearJoinError();
    const name = document.getElementById('input-display-name').value.trim();
    if (!name) {
      this.showJoinError('Please enter your name before creating a room!');
      document.getElementById('input-display-name').focus();
      return;
    }
    const avatar = getInitials(name);
    const grad = getAvatarGradient(name);

    // Snapshot welcome toggles BEFORE stopping previews (cleanup resets the flags)
    const wantCam = this._welcomeCamOn;
    const wantMic = this._welcomeMicOn;

    // Stop welcome media previews before starting room stream
    if (this._welcomeCamStream) {
      this._welcomeCamStream.getTracks().forEach(t => t.stop());
      this._welcomeCamStream = null;
      this._welcomeCamOn = false;
    }
    if (this._welcomeMicLevelRaf) { cancelAnimationFrame(this._welcomeMicLevelRaf); this._welcomeMicLevelRaf = null; }
    if (this._welcomeMicStream) {
      this._welcomeMicStream.getTracks().forEach(t => t.stop());
      this._welcomeMicStream = null;
      this._welcomeMicOn = false;
    }

    document.getElementById('header-user-name').textContent = name;
    const headerAvatar = document.getElementById('header-user-avatar');
    headerAvatar.textContent = avatar;
    headerAvatar.style.background = grad;

    document.getElementById('local-tile-name').textContent = `${name} (Host)`;
    const localTileAvatar = document.getElementById('local-tile-avatar');
    localTileAvatar.textContent = avatar;
    localTileAvatar.style.background = grad;

    document.getElementById('local-fallback-name').textContent = name;
    const localFallbackIcon = document.getElementById('local-fallback-icon');
    localFallbackIcon.textContent = avatar;
    localFallbackIcon.style.background = grad;

    document.getElementById('status-label').textContent = 'Connecting...';

    // Generate room code and deterministic host ID
    let roomCode = 'flow-' + Math.random().toString(36).substring(2, 7);
    let hostPeerId = getRoomHostPeerId(roomCode);

    try {
      await peerManager.init(name, avatar, hostPeerId);
    } catch (err) {
      console.warn('[UIManager] Primary host ID taken, retrying with new code...', err);
      roomCode = 'flow-' + Math.random().toString(36).substring(2, 7);
      hostPeerId = getRoomHostPeerId(roomCode);
      try {
        await peerManager.init(name, avatar, hostPeerId);
      } catch (retryErr) {
        this.showJoinError('Could not initialize room. Please try again.');
        return;
      }
    }

    peerManager.createRoom(roomCode);
    taskManager.initRoom(roomCode, name);
    codeshareManager.initRoom(roomCode, name);

    document.getElementById('header-room-code').textContent = roomCode;
    document.getElementById('room-pill-container').style.display = 'block';
    document.getElementById('status-label').textContent = 'Live Room';

    // Always acquire a full video+audio stream so tracks always exist and can
    // be toggled back on later. We just disable the tracks we don't want yet.
    await mediaManager.startLocalStream();

    // Apply the welcome screen toggle state onto the live stream
    if (!wantCam) {
      mediaManager.localStream?.getVideoTracks().forEach(t => { t.enabled = false; });
      mediaManager.isVideoMuted = true;
    }
    if (!wantMic) {
      mediaManager.localStream?.getAudioTracks().forEach(t => { t.enabled = false; });
      mediaManager.isAudioMuted = true;
    }

    // Sync toolbar button states to match what was chosen on the welcome screen
    this.updateCamUi(mediaManager.isVideoMuted);
    this.updateMicUi(mediaManager.isAudioMuted);
    // Notify peers of initial muted state
    peerManager.updateMyStatus({ isMuted: mediaManager.isAudioMuted, isCamOff: mediaManager.isVideoMuted });

    document.getElementById('welcome-modal').style.display = 'none';
  }

  async handleJoinRoom() {
    playClick();
    this.clearJoinError();
    const name = document.getElementById('input-display-name').value.trim();
    if (!name) {
      this.showJoinError('Please enter your name before joining!');
      document.getElementById('input-display-name').focus();
      return;
    }
    const avatar = getInitials(name);
    const grad = getAvatarGradient(name);
    const rawInput = document.getElementById('input-join-room-code').value.trim();

    // Snapshot welcome toggles BEFORE stopping previews (cleanup resets the flags)
    const wantCam = this._welcomeCamOn;
    const wantMic = this._welcomeMicOn;

    // Stop welcome media previews before starting room stream
    if (this._welcomeCamStream) {
      this._welcomeCamStream.getTracks().forEach(t => t.stop());
      this._welcomeCamStream = null;
      this._welcomeCamOn = false;
    }
    if (this._welcomeMicLevelRaf) { cancelAnimationFrame(this._welcomeMicLevelRaf); this._welcomeMicLevelRaf = null; }
    if (this._welcomeMicStream) {
      this._welcomeMicStream.getTracks().forEach(t => t.stop());
      this._welcomeMicStream = null;
      this._welcomeMicOn = false;
    }

    if (!rawInput) {
      this.showJoinError('Please enter a room code or invite link!');
      return;
    }

    const roomCode = cleanRoomCode(rawInput);
    if (!roomCode) {
      this.showJoinError('Invalid room code! Please enter a valid code like flow-abc12');
      return;
    }

    // Check if host parameter was in input or page query
    let hostPeerId = null;
    try {
      if (rawInput.startsWith('http')) {
        const parsed = new URL(rawInput);
        hostPeerId = parsed.searchParams.get('host');
      }
    } catch (e) {}

    if (!hostPeerId) {
      const pageParams = new URLSearchParams(window.location.search);
      if (cleanRoomCode(pageParams.get('room')) === roomCode) {
        hostPeerId = pageParams.get('host');
      }
    }

    // Use deterministic host ID if none was passed
    if (!hostPeerId) {
      hostPeerId = getRoomHostPeerId(roomCode);
    }

    document.getElementById('header-user-name').textContent = name;
    const headerAvatar = document.getElementById('header-user-avatar');
    headerAvatar.textContent = avatar;
    headerAvatar.style.background = grad;

    document.getElementById('local-tile-name').textContent = name;
    const localTileAvatar = document.getElementById('local-tile-avatar');
    localTileAvatar.textContent = avatar;
    localTileAvatar.style.background = grad;

    document.getElementById('local-fallback-name').textContent = name;
    const localFallbackIcon = document.getElementById('local-fallback-icon');
    localFallbackIcon.textContent = avatar;
    localFallbackIcon.style.background = grad;

    document.getElementById('status-label').textContent = 'Connecting...';

    // Unique guest Peer ID
    const guestPeerId = 'bored-guest-' + Math.random().toString(36).substring(2, 10);

    try {
      await peerManager.init(name, avatar, guestPeerId);
    } catch (err) {
      this.showJoinError('Could not connect to signaling service. Please try again.');
      return;
    }

    document.getElementById('header-room-code').textContent = roomCode;
    document.getElementById('room-pill-container').style.display = 'block';

    // Always acquire a full video+audio stream so tracks always exist and can
    // be toggled back on later. We just disable the tracks we don't want yet.
    await mediaManager.startLocalStream();

    // Apply the welcome screen toggle state onto the live stream
    if (!wantCam) {
      mediaManager.localStream?.getVideoTracks().forEach(t => { t.enabled = false; });
      mediaManager.isVideoMuted = true;
    }
    if (!wantMic) {
      mediaManager.localStream?.getAudioTracks().forEach(t => { t.enabled = false; });
      mediaManager.isAudioMuted = true;
    }

    // Sync toolbar button states to match what was chosen on the welcome screen
    this.updateCamUi(mediaManager.isVideoMuted);
    this.updateMicUi(mediaManager.isAudioMuted);
    // Notify peers of initial muted state
    peerManager.updateMyStatus({ isMuted: mediaManager.isAudioMuted, isCamOff: mediaManager.isVideoMuted });

    // Connect to the room host
    peerManager.joinRoom(roomCode, hostPeerId);
    taskManager.initRoom(roomCode, name);
    codeshareManager.initRoom(roomCode, name);

    // Hide welcome modal while connecting
    document.getElementById('welcome-modal').style.display = 'none';
  }

  // --- Codeshare Pad & Fullscreen Collaborative Editor ---

  initCodeshare() {
    this.codeshareTextarea = document.getElementById('codeshare-textarea');
    this.codeshareGutter = document.getElementById('codeshare-gutter');
    this.codeshareLangSelect = document.getElementById('select-codeshare-lang');
    this.codeshareStatLines = document.getElementById('codeshare-stat-lines');
    this.codeshareStatWords = document.getElementById('codeshare-stat-words');
    this.codeshareStatChars = document.getElementById('codeshare-stat-chars');
    this.codeshareTypingIndicator = document.getElementById('codeshare-typing-indicator');
    this.codeshareTypingText = document.getElementById('codeshare-typing-text');
    this.codeshareCollabText = document.getElementById('codeshare-collab-text');
    this.btnCodeshareCopy = document.getElementById('btn-codeshare-copy');
    this.btnCodeshareDownload = document.getElementById('btn-codeshare-download');
    this.btnCodeshareExpand = document.getElementById('btn-codeshare-expand');
    this.btnCodeshareClear = document.getElementById('btn-codeshare-clear');

    // Fullscreen elements
    this.codeshareFsModal = document.getElementById('codeshare-fullscreen-modal');
    this.codeshareFsTextarea = document.getElementById('codeshare-textarea-fs');
    this.codeshareFsGutter = document.getElementById('codeshare-gutter-fs');
    this.codeshareFsLangSelect = document.getElementById('select-codeshare-lang-fs');
    this.codeshareFsStatLines = document.getElementById('codeshare-stat-lines-fs');
    this.codeshareFsStatWords = document.getElementById('codeshare-stat-words-fs');
    this.codeshareFsStatChars = document.getElementById('codeshare-stat-chars-fs');
    this.codeshareFsTypingIndicator = document.getElementById('codeshare-typing-indicator-fs');
    this.codeshareFsTypingText = document.getElementById('codeshare-typing-text-fs');
    this.btnCodeshareCopyFs = document.getElementById('btn-codeshare-copy-fs');
    this.btnCodeshareDownloadFs = document.getElementById('btn-codeshare-download-fs');
    this.btnCodeshareClearFs = document.getElementById('btn-codeshare-clear-fs');
    this.btnCodeshareExitFs = document.getElementById('btn-codeshare-exit-fs');
    this.btnCodeshareFontDec = document.getElementById('btn-codeshare-font-dec');
    this.btnCodeshareFontInc = document.getElementById('btn-codeshare-font-inc');
    this.codeshareFontLabel = document.getElementById('codeshare-font-label');

    // Cursor overlay containers (injected into the editor wrappers)
    this.codeshareOverlay = this.createCursorOverlay('codeshare-cursor-overlay');
    this.codeshareFsOverlay = this.createCursorOverlay('codeshare-cursor-overlay-fs');
    const editorWrapper = this.codeshareTextarea && this.codeshareTextarea.parentElement;
    if (editorWrapper) editorWrapper.appendChild(this.codeshareOverlay);
    const fsEditorWrapper = this.codeshareFsTextarea && this.codeshareFsTextarea.parentElement;
    if (fsEditorWrapper) fsEditorWrapper.appendChild(this.codeshareFsOverlay);

    if (!this.codeshareTextarea) return;

    // Initial values
    this.codeshareTextarea.value = codeshareManager.content;
    if (this.codeshareFsTextarea) this.codeshareFsTextarea.value = codeshareManager.content;
    this.updateCodeshareGutter(this.codeshareTextarea, this.codeshareGutter);
    if (this.codeshareFsTextarea && this.codeshareFsGutter) {
      this.updateCodeshareGutter(this.codeshareFsTextarea, this.codeshareFsGutter);
    }
    this.updateCodeshareStats(codeshareManager.content);

    // Bind textareas
    this.bindCodeshareEditor(this.codeshareTextarea, this.codeshareGutter, false);
    if (this.codeshareFsTextarea && this.codeshareFsGutter) {
      this.bindCodeshareEditor(this.codeshareFsTextarea, this.codeshareFsGutter, true);
    }

    // Language selector sync
    if (this.codeshareLangSelect) {
      this.codeshareLangSelect.value = codeshareManager.language;
      this.codeshareLangSelect.addEventListener('change', (e) => {
        codeshareManager.setLanguage(e.target.value);
        if (this.codeshareFsLangSelect) this.codeshareFsLangSelect.value = e.target.value;
      });
    }

    if (this.codeshareFsLangSelect) {
      this.codeshareFsLangSelect.value = codeshareManager.language;
      this.codeshareFsLangSelect.addEventListener('change', (e) => {
        codeshareManager.setLanguage(e.target.value);
        if (this.codeshareLangSelect) this.codeshareLangSelect.value = e.target.value;
      });
    }

    // Copy actions
    const handleCopy = async () => {
      playClick();
      const success = await codeshareManager.copyToClipboard();
      if (success) {
        this.showCodeshareCopyToast('Snippet copied to clipboard!');
      }
    };
    if (this.btnCodeshareCopy) this.btnCodeshareCopy.addEventListener('click', handleCopy);
    if (this.btnCodeshareCopyFs) this.btnCodeshareCopyFs.addEventListener('click', handleCopy);

    // Download actions
    const handleDownload = () => {
      playClick();
      codeshareManager.downloadSnippet();
    };
    if (this.btnCodeshareDownload) this.btnCodeshareDownload.addEventListener('click', handleDownload);
    if (this.btnCodeshareDownloadFs) this.btnCodeshareDownloadFs.addEventListener('click', handleDownload);

    // Clear actions
    const handleClear = () => {
      playClick();
      if (confirm('Clear the shared pad for everyone in the room?')) {
        codeshareManager.clearContent();
        this.refreshCodeshareDisplay();
      }
    };
    if (this.btnCodeshareClear) this.btnCodeshareClear.addEventListener('click', handleClear);
    if (this.btnCodeshareClearFs) this.btnCodeshareClearFs.addEventListener('click', handleClear);

    // Fullscreen open/close
    if (this.btnCodeshareExpand) {
      this.btnCodeshareExpand.addEventListener('click', () => {
        playClick();
        this.openCodeshareFullscreen();
      });
    }

    if (this.btnCodeshareExitFs) {
      this.btnCodeshareExitFs.addEventListener('click', () => {
        playClick();
        this.closeCodeshareFullscreen();
      });
    }

    // Font size controls
    if (this.btnCodeshareFontDec) {
      this.btnCodeshareFontDec.addEventListener('click', () => {
        if (this.codeshareFsFontSize > 11) {
          this.codeshareFsFontSize -= 1;
          this.applyCodeshareFsFontSize();
        }
      });
    }
    if (this.btnCodeshareFontInc) {
      this.btnCodeshareFontInc.addEventListener('click', () => {
        if (this.codeshareFsFontSize < 24) {
          this.codeshareFsFontSize += 1;
          this.applyCodeshareFsFontSize();
        }
      });
    }

    // Escape hotkey to collapse fullscreen
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.codeshareFsModal && this.codeshareFsModal.style.display !== 'none') {
        this.closeCodeshareFullscreen();
      }
    });

    // Codeshare network events
    codeshareManager.on('content_updated', (data) => {
      this.handleRemoteCodeshareContent(data);
    });

    codeshareManager.on('sync_received', () => {
      this.refreshCodeshareDisplay();
      if (this.codeshareLangSelect) this.codeshareLangSelect.value = codeshareManager.language;
      if (this.codeshareFsLangSelect) this.codeshareFsLangSelect.value = codeshareManager.language;
    });

    codeshareManager.on('language_updated', ({ language }) => {
      if (this.codeshareLangSelect) this.codeshareLangSelect.value = language;
      if (this.codeshareFsLangSelect) this.codeshareFsLangSelect.value = language;
    });

    codeshareManager.on('typing_updated', ({ typers }) => {
      this.renderCodeshareTyping(typers);
    });

    codeshareManager.on('cursor_updated', ({ cursors }) => {
      if (this.codeshareTextarea && this.codeshareOverlay) {
        this.renderCursorOverlays(this.codeshareTextarea, this.codeshareOverlay, cursors);
      }
      if (this.codeshareFsTextarea && this.codeshareFsOverlay) {
        this.renderCursorOverlays(this.codeshareFsTextarea, this.codeshareFsOverlay, cursors);
      }
    });
  }

  bindCodeshareEditor(textarea, gutter, isFullscreen) {
    if (!textarea || !gutter) return;

    // Scroll sync — also re-render overlays on scroll
    textarea.addEventListener('scroll', () => {
      gutter.scrollTop = textarea.scrollTop;
      const overlay = isFullscreen ? this.codeshareFsOverlay : this.codeshareOverlay;
      if (overlay) this.renderCursorOverlays(textarea, overlay, codeshareManager.remoteCursors);
    });

    // Keydown handling: Tab indentation & auto-indent
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (e.shiftKey) {
          // Outdent line
          const lineStart = val.lastIndexOf('\n', start - 1) + 1;
          if (val.startsWith('  ', lineStart)) {
            textarea.value = val.substring(0, lineStart) + val.substring(lineStart + 2);
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          } else if (val.startsWith('\t', lineStart)) {
            textarea.value = val.substring(0, lineStart) + val.substring(lineStart + 1);
            textarea.selectionStart = Math.max(lineStart, start - 1);
            textarea.selectionEnd = Math.max(lineStart, end - 1);
          }
        } else {
          // Indent 2 spaces
          textarea.setRangeText('  ', start, end, 'end');
        }
        textarea.dispatchEvent(new Event('input'));
      } else if (e.key === 'Enter') {
        const start = textarea.selectionStart;
        const currentLine = textarea.value.substring(0, start).split('\n').pop();
        const indentMatch = currentLine.match(/^(\s+)/);
        if (indentMatch && indentMatch[1]) {
          e.preventDefault();
          const indent = indentMatch[1];
          textarea.setRangeText('\n' + indent, start, start, 'end');
          textarea.dispatchEvent(new Event('input'));
        }
      }
    });

    // Broadcast cursor on key/mouse navigation
    const broadcastLocalCursor = () => {
      codeshareManager.broadcastCursor(textarea.selectionStart, textarea.selectionEnd);
    };
    textarea.addEventListener('keyup', broadcastLocalCursor);
    textarea.addEventListener('mouseup', broadcastLocalCursor);
    textarea.addEventListener('click', broadcastLocalCursor);
    textarea.addEventListener('select', broadcastLocalCursor);

    // Input handling
    textarea.addEventListener('input', () => {
      if (this.isInternalCodeshareSync) return;

      const val = textarea.value;
      this.updateCodeshareGutter(textarea, gutter);
      this.updateCodeshareStats(val);

      // Sync the counterpart textarea
      const otherTextarea = isFullscreen ? this.codeshareTextarea : this.codeshareFsTextarea;
      const otherGutter = isFullscreen ? this.codeshareGutter : this.codeshareFsGutter;
      if (otherTextarea && otherTextarea !== textarea) {
        this.isInternalCodeshareSync = true;
        otherTextarea.value = val;
        if (otherGutter) this.updateCodeshareGutter(otherTextarea, otherGutter);
        this.isInternalCodeshareSync = false;
      }

      codeshareManager.updateContent(val, {
        start: textarea.selectionStart,
        end: textarea.selectionEnd
      });

      // Broadcast cursor after typing
      broadcastLocalCursor();
    });
  }

  handleRemoteCodeshareContent(data) {
    const activeEl = document.activeElement;
    const isSidebarActive = activeEl === this.codeshareTextarea;
    const isFsActive = activeEl === this.codeshareFsTextarea;

    const currentText = this.codeshareTextarea ? this.codeshareTextarea.value : '';
    if (currentText === data.content) return;

    this.isInternalCodeshareSync = true;

    // Sidebar update
    if (this.codeshareTextarea) {
      if (isSidebarActive) {
        const selStart = this.codeshareTextarea.selectionStart;
        const selEnd = this.codeshareTextarea.selectionEnd;
        this.codeshareTextarea.value = data.content;
        const diff = data.content.length - currentText.length;
        this.codeshareTextarea.selectionStart = Math.min(selStart + (diff > 0 && data.cursor && data.cursor.start <= selStart ? diff : 0), data.content.length);
        this.codeshareTextarea.selectionEnd = Math.min(selEnd + (diff > 0 && data.cursor && data.cursor.start <= selEnd ? diff : 0), data.content.length);
      } else {
        this.codeshareTextarea.value = data.content;
      }
      if (this.codeshareGutter) this.updateCodeshareGutter(this.codeshareTextarea, this.codeshareGutter);
    }

    // Fullscreen update
    if (this.codeshareFsTextarea) {
      if (isFsActive) {
        const selStart = this.codeshareFsTextarea.selectionStart;
        const selEnd = this.codeshareFsTextarea.selectionEnd;
        this.codeshareFsTextarea.value = data.content;
        const diff = data.content.length - currentText.length;
        this.codeshareFsTextarea.selectionStart = Math.min(selStart + (diff > 0 && data.cursor && data.cursor.start <= selStart ? diff : 0), data.content.length);
        this.codeshareFsTextarea.selectionEnd = Math.min(selEnd + (diff > 0 && data.cursor && data.cursor.start <= selEnd ? diff : 0), data.content.length);
      } else {
        this.codeshareFsTextarea.value = data.content;
      }
      if (this.codeshareFsGutter) this.updateCodeshareGutter(this.codeshareFsTextarea, this.codeshareFsGutter);
    }

    this.isInternalCodeshareSync = false;
    this.updateCodeshareStats(data.content);
  }

  updateCodeshareGutter(textarea, gutter) {
    if (!textarea || !gutter) return;
    const lines = (textarea.value.split('\n')).length || 1;
    let html = '';
    for (let i = 1; i <= lines; i++) {
      html += `<div class="gutter-num">${i}</div>`;
    }
    gutter.innerHTML = html;
    gutter.scrollTop = textarea.scrollTop;
  }

  updateCodeshareStats(text) {
    const stats = codeshareManager.calculateStats(text);
    const lineStr = `${stats.lines} ${stats.lines === 1 ? 'line' : 'lines'}`;
    const wordStr = `${stats.words} ${stats.words === 1 ? 'word' : 'words'}`;
    const charStr = `${stats.chars} ${stats.chars === 1 ? 'char' : 'chars'}`;

    if (this.codeshareStatLines) this.codeshareStatLines.textContent = lineStr;
    if (this.codeshareStatWords) this.codeshareStatWords.textContent = wordStr;
    if (this.codeshareStatChars) this.codeshareStatChars.textContent = charStr;

    if (this.codeshareFsStatLines) this.codeshareFsStatLines.textContent = lineStr;
    if (this.codeshareFsStatWords) this.codeshareFsStatWords.textContent = wordStr;
    if (this.codeshareFsStatChars) this.codeshareFsStatChars.textContent = charStr;
  }

  refreshCodeshareDisplay() {
    if (!this.codeshareTextarea) return;
    this.isInternalCodeshareSync = true;
    this.codeshareTextarea.value = codeshareManager.content;
    if (this.codeshareFsTextarea) this.codeshareFsTextarea.value = codeshareManager.content;
    this.updateCodeshareGutter(this.codeshareTextarea, this.codeshareGutter);
    if (this.codeshareFsTextarea && this.codeshareFsGutter) {
      this.updateCodeshareGutter(this.codeshareFsTextarea, this.codeshareFsGutter);
    }
    this.updateCodeshareStats(codeshareManager.content);
    this.isInternalCodeshareSync = false;
  }

  openCodeshareFullscreen() {
    if (!this.codeshareFsModal) return;
    this.refreshCodeshareDisplay();
    this.codeshareFsModal.style.display = 'flex';
    renderIcons(this.codeshareFsModal);
    this.applyCodeshareFsFontSize();

    if (this.codeshareFsTextarea) {
      setTimeout(() => {
        this.codeshareFsTextarea.focus();
        if (this.codeshareTextarea) {
          this.codeshareFsTextarea.selectionStart = this.codeshareTextarea.selectionStart;
          this.codeshareFsTextarea.selectionEnd = this.codeshareTextarea.selectionEnd;
        }
      }, 50);
    }
  }

  closeCodeshareFullscreen() {
    if (!this.codeshareFsModal) return;
    this.codeshareFsModal.style.display = 'none';
    this.refreshCodeshareDisplay();
    if (this.codeshareTextarea) {
      this.codeshareTextarea.focus();
    }
  }

  applyCodeshareFsFontSize() {
    if (this.codeshareFsTextarea) {
      this.codeshareFsTextarea.style.fontSize = `${this.codeshareFsFontSize}px`;
    }
    if (this.codeshareFsGutter) {
      this.codeshareFsGutter.style.fontSize = `${this.codeshareFsFontSize}px`;
    }
    if (this.codeshareFontLabel) {
      this.codeshareFontLabel.textContent = `${this.codeshareFsFontSize}px`;
    }
  }

  renderCodeshareTyping(typers = []) {
    const hasTypers = typers && typers.length > 0;
    const text = typers.length === 1 ? `${typers[0]} is typing...` : (typers.length > 1 ? `${typers.length} typing...` : '');

    if (this.codeshareTypingIndicator && this.codeshareTypingText) {
      this.codeshareTypingIndicator.style.display = hasTypers ? 'inline-flex' : 'none';
      this.codeshareTypingText.textContent = text;
    }
    if (this.codeshareFsTypingIndicator && this.codeshareFsTypingText) {
      this.codeshareFsTypingIndicator.style.display = hasTypers ? 'inline-flex' : 'none';
      this.codeshareFsTypingText.textContent = text;
    }
  }

  showCodeshareCopyToast(message) {
    let toast = document.getElementById('codeshare-copy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'codeshare-copy-toast';
      toast.className = 'codeshare-copy-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>${message}</span>`;
    toast.classList.add('show');
    if (this.copyToastTimer) clearTimeout(this.copyToastTimer);
    this.copyToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 1800);
  }

  updateCodeshareCollaborators() {
    const count = 1 + (this.peerTiles ? this.peerTiles.size : 0);
    const label = count === 1 ? '1 online' : `${count} online`;
    if (this.codeshareCollabText) this.codeshareCollabText.textContent = label;
  }

  // --- Live Cursor Overlay System ---

  createCursorOverlay(id) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'codeshare-cursor-overlay';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  /**
   * Calculates the pixel position of a character offset inside a textarea,
   * accounting for scroll, padding, font metrics, and line wrapping.
   * Returns { x, y, lineHeight }.
   */
  getCaretPixelPos(textarea, charOffset) {
    const style = getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.6;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;

    // Create a mirror div that matches the textarea's computed style
    const mirror = document.createElement('div');
    mirror.style.cssText = [
      `position:absolute`, `visibility:hidden`, `white-space:pre`,
      `word-break:${style.wordBreak}`, `overflow-wrap:${style.overflowWrap}`,
      `font:${style.font}`, `font-size:${style.fontSize}`,
      `font-family:${style.fontFamily}`, `font-weight:${style.fontWeight}`,
      `letter-spacing:${style.letterSpacing}`,
      `line-height:${style.lineHeight}`,
      `tab-size:${style.tabSize}`,
      `padding-top:${style.paddingTop}`,
      `padding-left:${style.paddingLeft}`,
      `padding-right:${style.paddingRight}`,
      `border-left:${style.borderLeft}`,
      `border-right:${style.borderRight}`,
      `width:${textarea.offsetWidth}px`,
      `box-sizing:border-box`,
    ].join(';');

    const text = textarea.value.substring(0, charOffset);
    const span = document.createElement('span');
    span.textContent = text;
    mirror.appendChild(span);
    // Trailing marker
    const marker = document.createElement('span');
    marker.textContent = '|';
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    document.body.removeChild(mirror);

    // Use span end position as cursor position
    const taRect = textarea.getBoundingClientRect();
    const x = markerRect.left - taRect.left + textarea.scrollLeft;
    const y = markerRect.top - taRect.top + textarea.scrollTop;

    return { x, y, lineHeight };
  }

  /**
   * Render all remote peer cursors onto an overlay element.
   * Shows a blinking cursor line + initials badge, and a translucent
   * selection highlight when the peer has text selected.
   */
  renderCursorOverlays(textarea, overlay, cursors) {
    if (!textarea || !overlay) return;

    // Clear previous overlays
    overlay.innerHTML = '';

    if (!cursors || cursors.size === 0) return;

    const taRect = textarea.getBoundingClientRect();
    const style = getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const fontSize = parseFloat(style.fontSize) || 13;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const content = textarea.value;
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;

    cursors.forEach((cursor, peerId) => {
      const { userName, selectionStart, selectionEnd, color } = cursor;
      const hasSelection = selectionEnd > selectionStart;
      const initials = (userName || '?').trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);

      try {
        // Get caret position
        const pos = this.getCaretPixelPos(textarea, selectionEnd);
        const x = pos.x;
        const y = pos.y;

        // -- Cursor line --
        const cursorLine = document.createElement('div');
        cursorLine.className = 'cs-cursor-line';
        cursorLine.style.cssText = `left:${x}px;top:${y - scrollTop}px;height:${lineHeight}px;border-left-color:${color};`;
        overlay.appendChild(cursorLine);

        // -- Initials badge --
        const badge = document.createElement('div');
        badge.className = 'cs-cursor-badge';
        badge.textContent = initials;
        badge.title = userName;
        badge.style.cssText = `left:${x}px;top:${y - scrollTop - 20}px;background:${color};`;
        overlay.appendChild(badge);

        // -- Selection highlight --
        if (hasSelection) {
          this.renderSelectionHighlight(overlay, textarea, content, selectionStart, selectionEnd, color, lineHeight, scrollTop, scrollLeft, style);
        }
      } catch (err) {
        // Fail silently — caret position can throw on edge cases
      }
    });
  }

  /**
   * Renders per-line selection highlight rectangles for a given char range.
   */
  renderSelectionHighlight(overlay, textarea, content, start, end, color, lineHeight, scrollTop, scrollLeft, taStyle) {
    // Split content into lines and figure out which lines are covered
    const lines = content.split('\n');
    let charCount = 0;
    const paddingLeft = parseFloat(taStyle.paddingLeft) || 0;
    const paddingTop = parseFloat(taStyle.paddingTop) || 0;

    for (let li = 0; li < lines.length; li++) {
      const lineStart = charCount;
      const lineEnd = charCount + lines[li].length;
      charCount = lineEnd + 1; // +1 for the '\n'

      // Does this line overlap with [start, end)?
      if (lineEnd < start || lineStart >= end) continue;

      const selStart = Math.max(start, lineStart);
      const selEnd = Math.min(end, lineEnd);

      // Measure pixel offset of selStart and selEnd within the line
      try {
        const posStart = this.getCaretPixelPos(textarea, selStart);
        const posEnd = this.getCaretPixelPos(textarea, selEnd);

        const rectEl = document.createElement('div');
        rectEl.className = 'cs-selection-rect';
        const x1 = posStart.x;
        const x2 = selEnd >= lineEnd ? posEnd.x + 6 : posEnd.x; // extend slightly at line end
        const width = Math.max(x2 - x1, 4);
        const y = posStart.y - scrollTop;
        rectEl.style.cssText = `left:${x1}px;top:${y}px;width:${width}px;height:${lineHeight}px;background:${color}30;border-top:1px solid ${color}55;border-bottom:1px solid ${color}55;`;
        overlay.appendChild(rectEl);
      } catch (e) {
        // skip
      }
    }
  }

  // --- Expandable & Resizable Sidebar ---

  initSidebarResize() {
    const sidebar = document.getElementById('sidebar-section');
    const resizer = document.getElementById('sidebar-resizer');
    const toggleBtn = document.getElementById('btn-toggle-sidebar-expand');
    const expandIcon = document.getElementById('icon-sidebar-expand');

    if (!sidebar || !resizer) return;

    // Load saved width from localStorage
    const savedWidth = localStorage.getItem('bored_sidebar_width');
    if (savedWidth) {
      const parsed = parseInt(savedWidth, 10);
      if (!isNaN(parsed) && parsed >= 320 && parsed <= 900) {
        document.documentElement.style.setProperty('--sidebar-width', `${parsed}px`);
        sidebar.style.width = `${parsed}px`;
      }
    }

    const updateExpandIcon = (width) => {
      if (!expandIcon) return;
      if (width >= 480) {
        expandIcon.setAttribute('data-lucide', 'chevrons-right');
        if (toggleBtn) toggleBtn.title = 'Collapse sidebar (380px)';
      } else {
        expandIcon.setAttribute('data-lucide', 'chevrons-left');
        if (toggleBtn) toggleBtn.title = 'Expand sidebar (580px)';
      }
      renderIcons(sidebar);
    };

    const currentW = sidebar.getBoundingClientRect().width;
    updateExpandIcon(currentW);

    // Freeform drag to resize
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.getBoundingClientRect().width;

      sidebar.classList.add('is-dragging');
      resizer.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = startX - e.clientX; // Moving left increases width
      const maxW = Math.min(window.innerWidth * 0.75, 880);
      const newWidth = Math.max(340, Math.min(maxW, Math.round(startWidth + dx)));

      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
      sidebar.style.width = `${newWidth}px`;
      updateExpandIcon(newWidth);
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      sidebar.classList.remove('is-dragging');
      resizer.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      const finalWidth = sidebar.getBoundingClientRect().width;
      localStorage.setItem('bored_sidebar_width', Math.round(finalWidth));
    };

    resizer.addEventListener('mousedown', onMouseDown);

    // Touch support for mobile/tablets
    resizer.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      isDragging = true;
      startX = e.touches[0].clientX;
      startWidth = sidebar.getBoundingClientRect().width;
      sidebar.classList.add('is-dragging');
      resizer.classList.add('is-dragging');
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dx = startX - e.touches[0].clientX;
      const maxW = Math.min(window.innerWidth * 0.75, 880);
      const newWidth = Math.max(340, Math.min(maxW, Math.round(startWidth + dx)));
      sidebar.style.width = `${newWidth}px`;
      updateExpandIcon(newWidth);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (!isDragging) return;
      isDragging = false;
      sidebar.classList.remove('is-dragging');
      resizer.classList.remove('is-dragging');
      const finalWidth = sidebar.getBoundingClientRect().width;
      localStorage.setItem('bored_sidebar_width', Math.round(finalWidth));
    });

    const toggleWidth = () => {
      const cur = sidebar.getBoundingClientRect().width;
      sidebar.classList.remove('is-dragging');
      const targetWidth = cur >= 480 ? 380 : 580;
      sidebar.style.width = `${targetWidth}px`;
      document.documentElement.style.setProperty('--sidebar-width', `${targetWidth}px`);
      localStorage.setItem('bored_sidebar_width', targetWidth);
      updateExpandIcon(targetWidth);
    };

    // Double click to toggle preset width
    resizer.addEventListener('dblclick', () => {
      playClick();
      toggleWidth();
    });

    // Quick toggle button
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        playClick();
        toggleWidth();
      });
    }
  }

  isMobileDevice() {
    const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
    const isMobileUa = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|crios/i.test(ua);
    const isTouch = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
    const isNarrow = window.innerWidth <= 768;
    return isMobileUa || (isNarrow && isTouch) || isNarrow;
  }

  initMobileBlocker() {
    const overlay = document.getElementById('mobile-block-overlay');
    if (!overlay) return;

    const checkAndToggle = () => {
      const isMobile = this.isMobileDevice();
      if (isMobile) {
        document.body.classList.add('mobile-blocked');
        overlay.style.display = 'flex';

        // Check for room invite parameter
        const params = new URLSearchParams(window.location.search);
        const room = params.get('room');
        const invitePill = document.getElementById('mobile-invite-pill');
        const roomCodeTag = document.getElementById('mobile-room-code-tag');
        const desc = document.getElementById('mobile-block-desc');

        if (room) {
          const clean = cleanRoomCode(room);
          if (invitePill && roomCodeTag) {
            invitePill.style.display = 'inline-flex';
            roomCodeTag.textContent = clean;
          }
          if (desc) {
            desc.innerHTML = `You've been invited to room <strong>#${this.escapeHtml(clean)}</strong>. Bored? is a desktop virtual coworking space. Open this link on your computer to join your coworkers.`;
          }
        } else {
          if (invitePill) invitePill.style.display = 'none';
        }
      } else {
        document.body.classList.remove('mobile-blocked');
        overlay.style.display = 'none';
      }
    };

    // Initial check
    checkAndToggle();

    // Listen on resize & orientation change
    window.addEventListener('resize', checkAndToggle);
    window.addEventListener('orientationchange', checkAndToggle);

    // Copy link button handler
    const copyBtn = document.getElementById('btn-mobile-copy-link');
    const toast = document.getElementById('mobile-copy-toast');
    const copyText = document.getElementById('mobile-copy-btn-text');

    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        playClick();
        const url = window.location.href;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
          } else {
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
          }
          if (copyText) copyText.textContent = 'Link Copied!';
          if (toast) {
            toast.classList.add('show');
            setTimeout(() => {
              toast.classList.remove('show');
              if (copyText) copyText.textContent = 'Copy Room Link';
            }, 3000);
          }
        } catch (err) {
          window.prompt('Copy this room link to your clipboard:', url);
        }
      });
    }

    // Native Web Share API (supported on iOS Safari, Chrome Android, etc.)
    const shareBtn = document.getElementById('btn-mobile-share-link');
    if (shareBtn && typeof navigator.share === 'function') {
      shareBtn.style.display = 'inline-flex';
      shareBtn.addEventListener('click', async () => {
        playClick();
        try {
          const params = new URLSearchParams(window.location.search);
          const room = params.get('room');
          const clean = room ? cleanRoomCode(room) : '';
          const title = clean ? `Join my Bored! room #${clean}` : 'Join Bored! Coworking';
          await navigator.share({
            title: title,
            text: 'Open this link on your laptop or desktop computer to join the virtual coworking room:',
            url: window.location.href
          });
        } catch (e) {
          // user cancelled share
        }
      });
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

export const uiManager = new UIManager();
