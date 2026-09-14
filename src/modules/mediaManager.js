import { peerManager } from './peerManager.js';
import { youtubeManager } from './youtubeManager.js';

class MediaManager {
  constructor() {
    this.localStream = null;
    this.screenStream = null;
    this.isScreenSharing = false;

    this.isAudioMuted = false;
    this.isVideoMuted = false;
    this.isDeafened = false;
    this.savedStatusBeforeDeafen = null;

    // Preferred device IDs
    try {
      this.selectedAudioInputId = localStorage.getItem('preferred_audio_input') || null;
      this.selectedAudioOutputId = localStorage.getItem('preferred_audio_output') || null;
    } catch (e) {
      this.selectedAudioInputId = null;
      this.selectedAudioOutputId = null;
    }

    // Active calls: peerId -> MediaConnection
    this.calls = new Map();
    // Remote media streams: peerId -> MediaStream
    this.remoteStreams = new Map();
    // Remote audio elements: peerId -> HTMLAudioElement
    this.remoteAudioElements = new Map();
    // Remote video elements: peerId -> HTMLVideoElement
    this.remoteVideoElements = new Map();
    // Local volume overrides: peerId -> volume (0.0 to 1.0)
    this.peerVolumes = new Map();
    // Local mute overrides: peerId -> boolean
    this.peerMutedLocally = new Map();

    // Web Audio speech detection
    this.audioContext = null;
    this.audioSources = new Map(); // peerId or 'local' -> MediaStreamAudioSourceNode
    this.analysers = new Map(); // peerId or 'local' -> AnalyserNode
    this.speakingHoldTimes = new Map(); // peerId or 'local' -> timestamp
    this.speechInterval = null;

    // Active screen sharing calls: peerId -> MediaConnection
    this.screenCalls = new Map();
    // Active screen shares: peerId or 'local' -> { stream, userName, isLocal }
    this.activeScreenShares = new Map();

    this.listeners = new Map();
  }

  registerRemoteVideoElement(peerId, videoEl) {
    if (!videoEl) return;
    this.remoteVideoElements.set(peerId, videoEl);
    // Mute video element to ensure audio is controlled strictly by audioEl without dual-audio leaks
    videoEl.muted = true;
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) list.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
  }

  getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this.audioContext || this.audioContext.state === 'closed') {
      try {
        // latencyHint: 'playback' gives a stable audio buffer and prevents 128-frame dropouts on macOS
        this.audioContext = new AudioContextClass({ latencyHint: 'playback' });
      } catch (e) {
        this.audioContext = new AudioContextClass();
      }
    }
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  async startLocalStream({ wantVideo = true, wantAudio = true, videoDeviceId = null, audioDeviceId = null } = {}) {
    // Like Google Meet, disable macOS AUVoiceProcessing system audio hijacking
    // (systemAudioEchoCancellation: false) to prevent ducking/static on other tabs,
    // and rely on browser-level software AEC/DSP.
    const resolvedAudioId = audioDeviceId || this.selectedAudioInputId;
    const resolvedVideoId = videoDeviceId || null;

    const buildAudioConstraints = (deviceId) => {
      const c = {
        echoCancellation: true,
        systemAudioEchoCancellation: { ideal: false },
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: true,
        googHighpassFilter: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: { ideal: 1 }
      };
      if (deviceId) c.deviceId = { exact: deviceId };
      return c;
    };

    const buildVideoConstraints = (deviceId) => {
      const c = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
      if (deviceId) c.deviceId = { exact: deviceId };
      return c;
    };

    // Build constraints honouring what the user actually wants.
    // Special case: if BOTH are off we can't call getUserMedia at all — use dummy.
    if (!wantVideo && !wantAudio) {
      this.localStream = this.createDummyStream();
      this.isVideoMuted = true;
      this.isAudioMuted = true;
    } else {
      const constraints = {
        video: wantVideo ? buildVideoConstraints(resolvedVideoId) : false,
        audio: wantAudio ? buildAudioConstraints(resolvedAudioId) : false,
      };

      try {
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        console.warn('[MediaManager] Failed with preferred constraints, trying fallback:', err);
        try {
          // Retry without specific device IDs but preserve audio/video intent
          const fallback = {
            video: wantVideo,
            audio: wantAudio ? buildAudioConstraints(null) : false,
          };
          this.localStream = await navigator.mediaDevices.getUserMedia(fallback);
        } catch (err2) {
          if (wantVideo && wantAudio) {
            // Try audio-only
            try {
              this.localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: buildAudioConstraints(null),
              });
              this.isVideoMuted = true;
            } catch (err3) {
              console.warn('[MediaManager] No media devices found or permission denied. Creating dummy stream:', err3);
              this.localStream = this.createDummyStream();
              this.isVideoMuted = true;
              this.isAudioMuted = true;
            }
          } else if (wantVideo) {
            // Video-only request failed entirely
            console.warn('[MediaManager] No media devices found or permission denied. Creating dummy stream:', err2);
            this.localStream = this.createDummyStream();
            this.isVideoMuted = true;
          } else {
            // Audio-only request failed entirely
            console.warn('[MediaManager] No media devices found or permission denied. Creating dummy stream:', err2);
            this.localStream = this.createDummyStream();
            this.isAudioMuted = true;
          }
        }
      }
    }

    // Reflect the requested muted state on the flags and tracks
    if (!wantVideo) {
      this.isVideoMuted = true;
      this.localStream.getVideoTracks().forEach(t => { t.enabled = false; });
    }
    if (!wantAudio) {
      this.isAudioMuted = true;
      this.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
    }


    this.setupAudioAnalyser('local', this.localStream);
    this.startSpeechDetection();
    this.setupIncomingCallHandler();
    this.emit('local_stream_ready', { stream: this.localStream });

    // Initiate call to any peers that connected while stream was starting
    if (peerManager.connections && peerManager.connections.size > 0) {
      peerManager.connections.forEach((conn, peerId) => {
        if (peerManager.myPeerId && peerManager.myPeerId < peerId && !this.calls.has(peerId)) {
          console.log(`[MediaManager] Calling existing connected peer: ${peerId}`);
          this.callPeer(peerId);
        }
      });
    }

    return this.localStream;
  }

  createDummyStream() {
    // Canvas fallback if camera is blocked/unavailable
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, 0, 640, 480);
    const videoStream = canvas.captureStream(10);

    const actx = this.getAudioContext();
    if (actx) {
      const dst = actx.createMediaStreamDestination();
      const audioTrack = dst.stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        videoStream.addTrack(audioTrack);
      }
    }
    return videoStream;
  }

  setupIncomingCallHandler() {
    if (!peerManager.peer) return;

    peerManager.peer.on('call', (call) => {
      if (call.metadata && call.metadata.type === 'screenshare') {
        console.log(`[MediaManager] Incoming screenshare call from ${call.peer}`);
        // Answer without local camera stream
        call.answer();
        this.handleIncomingScreenCall(call);
      } else {
        console.log(`[MediaManager] Incoming camera call from ${call.peer}`);
        // Answer with local camera/mic stream
        call.answer(this.localStream);
        this.handleCallStream(call);
      }
    });

    // When peer connected in data channel, initiate camera call if lower lexicographically
    peerManager.on('peer_connected', ({ peerId }) => {
      if (peerManager.myPeerId && peerManager.myPeerId < peerId) {
        console.log(`[MediaManager] Initiating outgoing call to ${peerId}`);
        this.callPeer(peerId);
      }
      // If we are already sharing screen, call the new peer with our screen stream
      if (this.isScreenSharing && this.screenStream) {
        console.log(`[MediaManager] Calling new peer ${peerId} with active screen share`);
        this.callPeerScreen(peerId, this.screenStream);
      }
    });

    peerManager.on('peer_left', ({ peerId }) => {
      this.cleanupPeerStream(peerId);
      this.handleScreenShareRemoved(peerId);
      if (this.screenCalls.has(peerId)) {
        try { this.screenCalls.get(peerId).close(); } catch (e) {}
        this.screenCalls.delete(peerId);
      }
    });

    // Handle screen share signaling over data channels
    peerManager.on('screen_share_stopped', (data) => {
      if (data && data.peerId) {
        this.handleScreenShareRemoved(data.peerId);
      }
    });
  }

  callPeer(remotePeerId) {
    if (!peerManager.peer || !this.localStream) return;
    if (this.calls.has(remotePeerId)) return;

    const call = peerManager.peer.call(remotePeerId, this.localStream);
    if (!call) return;
    this.handleCallStream(call);
  }

  handleCallStream(call) {
    const remotePeerId = call.peer;
    this.calls.set(remotePeerId, call);

    // Watch call connection state changes to immediately detect dropped peers
    if (call.peerConnection) {
      call.peerConnection.addEventListener('connectionstatechange', () => {
        const state = call.peerConnection?.connectionState;
        console.log(`[MediaManager] Call connectionState for ${remotePeerId}: ${state}`);
        if (['disconnected', 'failed', 'closed'].includes(state)) {
          this.cleanupPeerStream(remotePeerId);
          peerManager.handlePeerLeft(remotePeerId);
        }
      });

      call.peerConnection.addEventListener('iceconnectionstatechange', () => {
        const iceState = call.peerConnection?.iceConnectionState;
        console.log(`[MediaManager] Call iceConnectionState for ${remotePeerId}: ${iceState}`);
        if (['disconnected', 'failed', 'closed'].includes(iceState)) {
          this.cleanupPeerStream(remotePeerId);
          peerManager.handlePeerLeft(remotePeerId);
        }
      });

      // Boost WebRTC voice sender quality (96 kbps wideband audio)
      const boostAudioSender = () => {
        if (!call.peerConnection?.getSenders) return;
        call.peerConnection.getSenders().forEach(sender => {
          if (sender.track && sender.track.kind === 'audio') {
            try {
              const params = sender.getParameters();
              if (!params.encodings || params.encodings.length === 0) {
                params.encodings = [{}];
              }
              params.encodings[0].maxBitrate = 96000;
              params.encodings[0].priority = 'high';
              params.encodings[0].networkPriority = 'high';
              sender.setParameters(params).catch(() => {});
            } catch (e) {}
          }
        });
      };

      boostAudioSender();
      call.peerConnection.addEventListener('negotiationneeded', () => setTimeout(boostAudioSender, 150));
    }

    call.on('stream', (remoteStream) => {
      console.log(`[MediaManager] Received remote stream from ${remotePeerId}`);
      this.remoteStreams.set(remotePeerId, remoteStream);

      // Create remote audio element in DOM to ensure uninterrupted playback
      let audioEl = this.remoteAudioElements.get(remotePeerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.setAttribute('playsinline', 'true');
        const container = document.getElementById('remote-audio-container') || document.body;
        container.appendChild(audioEl);
        this.remoteAudioElements.set(remotePeerId, audioEl);
      }
      audioEl.srcObject = remoteStream;

      // Apply selected speaker if set
      if (this.selectedAudioOutputId && typeof audioEl.setSinkId === 'function') {
        audioEl.setSinkId(this.selectedAudioOutputId).catch(() => {});
      }

      // Apply initial volume & deafen states
      const savedVol = this.peerVolumes.get(remotePeerId) ?? 1.0;
      const isMutedLocally = this.peerMutedLocally.get(remotePeerId) || this.isDeafened;
      audioEl.volume = isMutedLocally ? 0 : savedVol;
      audioEl.muted = isMutedLocally || (savedVol === 0);

      this.setupAudioAnalyser(remotePeerId, remoteStream);
      this.emit('remote_stream_ready', { peerId: remotePeerId, stream: remoteStream });
    });

    call.on('close', () => {
      this.cleanupPeerStream(remotePeerId);
      peerManager.handlePeerLeft(remotePeerId);
    });

    call.on('error', (err) => {
      console.warn(`[MediaManager] Call error with ${remotePeerId}:`, err);
      this.cleanupPeerStream(remotePeerId);
      peerManager.handlePeerLeft(remotePeerId);
    });
  }

  cleanupPeerStream(peerId) {
    if (this.calls.has(peerId)) {
      try {
        this.calls.get(peerId).close();
      } catch (e) {}
      this.calls.delete(peerId);
    }
    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      try { audioEl.pause(); } catch (e) {}
      audioEl.remove();
      this.remoteAudioElements.delete(peerId);
    }
    const videoEl = this.remoteVideoElements.get(peerId);
    if (videoEl) {
      videoEl.srcObject = null;
      try { videoEl.pause(); } catch (e) {}
      this.remoteVideoElements.delete(peerId);
    }
    this.remoteStreams.delete(peerId);
    this.disconnectAudioAnalyser(peerId);
    this.emit('remote_stream_removed', { peerId });
  }

  disconnectAudioAnalyser(id) {
    const source = this.audioSources.get(id);
    if (source) {
      try { source.disconnect(); } catch (e) {}
      this.audioSources.delete(id);
    }
    const analyser = this.analysers.get(id);
    if (analyser) {
      try { analyser.disconnect(); } catch (e) {}
      this.analysers.delete(id);
    }
    this.speakingHoldTimes.delete(id);
  }

  setupAudioAnalyser(id, stream) {
    try {
      const actx = this.getAudioContext();
      if (!actx) return;

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) return;

      // Clean up existing node if re-attaching
      this.disconnectAudioAnalyser(id);

      const source = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      this.analysers.set(id, analyser);
      this.audioSources.set(id, source);
    } catch (e) {
      console.warn(`[MediaManager] Could not setup analyser for ${id}:`, e);
    }
  }

  ensureAudioContext() {
    this.getAudioContext();
  }

  startSpeechDetection() {
    if (this.speechInterval) clearInterval(this.speechInterval);

    this.speechInterval = setInterval(() => {
      // Don't burn CPU or contend audio thread when tab is hidden
      if (document.hidden) return;
      const now = Date.now();

      this.analysers.forEach((analyser, id) => {
        // If local is muted or deafened, don't flag as speaking
        if (id === 'local' && (this.isAudioMuted || this.isDeafened)) {
          this.speakingHoldTimes.delete('local');
          this.emit('speaking_change', { peerId: id, isSpeaking: false, volume: 0 });
          return;
        }

        // If remote peer is muted locally or by metadata
        if (id !== 'local') {
          if (this.peerMutedLocally.get(id) || peerManager.peerMetadata.get(id)?.isMuted) {
            this.speakingHoldTimes.delete(id);
            this.emit('speaking_change', { peerId: id, isSpeaking: false, volume: 0 });
            return;
          }
        }

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // VAD threshold with hangover/decay to avoid flickering during natural pauses
        if (average > 11) {
          this.speakingHoldTimes.set(id, now + 380);
        }

        const holdUntil = this.speakingHoldTimes.get(id) || 0;
        const isSpeaking = now < holdUntil;

        this.emit('speaking_change', {
          peerId: id,
          isSpeaking,
          volume: Math.min(100, Math.round((average / 255) * 100))
        });
      });
    }, 100);
  }

  toggleAudio() {
    if (!this.localStream) return false;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) return false;

    this.isAudioMuted = !this.isAudioMuted;
    audioTracks.forEach(track => {
      track.enabled = !this.isAudioMuted;
    });

    if (this.isAudioMuted) {
      this.disconnectAudioAnalyser('local');
      this.emit('speaking_change', { peerId: 'local', isSpeaking: false, volume: 0 });
    } else {
      this.setupAudioAnalyser('local', this.localStream);
    }

    peerManager.updateMyStatus({ isMuted: this.isAudioMuted });
    this.emit('local_media_changed', { isAudioMuted: this.isAudioMuted, isVideoMuted: this.isVideoMuted });
    return this.isAudioMuted;
  }

  toggleVideo() {
    if (!this.localStream) return false;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) return false;

    this.isVideoMuted = !this.isVideoMuted;
    videoTracks.forEach(track => {
      track.enabled = !this.isVideoMuted;
    });

    peerManager.updateMyStatus({ isCamOff: this.isVideoMuted });
    this.emit('local_media_changed', { isAudioMuted: this.isAudioMuted, isVideoMuted: this.isVideoMuted });
    return this.isVideoMuted;
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;

    if (this.isDeafened) {
      // Automatically mute mic as well
      if (!this.isAudioMuted) {
        this.toggleAudio();
      }

      // Save previous status before deafening (unless already 'Deafened')
      const myMeta = peerManager.getPeerMetadata(peerManager.myPeerId);
      const currentStatus = myMeta?.focusStatus
        || document.getElementById('header-focus-tag')?.textContent?.trim()
        || 'Bored';
      if (currentStatus !== 'Deafened') {
        this.savedStatusBeforeDeafen = currentStatus;
      }

      // Pause YouTube audio locally (do NOT broadcast pause to peers)
      youtubeManager.pauseForDeafen();
    } else {
      // Resume YouTube audio if it was playing before deafening
      youtubeManager.resumeFromDeafen();
    }

    // Mute/unmute all incoming audio & video elements
    this.remoteAudioElements.forEach((audioEl, peerId) => {
      const isMutedLocally = this.peerMutedLocally.get(peerId);
      const savedVol = this.peerVolumes.get(peerId) ?? 1.0;
      const target = (this.isDeafened || isMutedLocally) ? 0 : savedVol;
      audioEl.volume = target;
      audioEl.muted = (target === 0);
      if (!this.isDeafened && !isMutedLocally && audioEl.paused) {
        audioEl.play().catch(() => {});
      }
    });

    this.remoteVideoElements.forEach((videoEl, peerId) => {
      const isMutedLocally = this.peerMutedLocally.get(peerId);
      const savedVol = this.peerVolumes.get(peerId) ?? 1.0;
      const target = (this.isDeafened || isMutedLocally) ? 0 : savedVol;
      videoEl.volume = target;
      videoEl.muted = true; // Video element stays muted to avoid dual audio
    });

    // Determine restored status: restore previous status, fallback to 'Bored'
    const nextStatus = this.isDeafened
      ? 'Deafened'
      : (this.savedStatusBeforeDeafen || 'Bored');

    peerManager.updateMyStatus({
      isDeafened: this.isDeafened,
      focusStatus: nextStatus
    });

    this.emit('deafen_changed', { isDeafened: this.isDeafened, restoredStatus: nextStatus });
    return this.isDeafened;
  }

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      await this.stopScreenShare();
    } else {
      await this.startScreenShare();
    }
  }

  async startScreenShare() {
    try {
      this.ensureAudioContext();
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: true
      });
      this.isScreenSharing = true;

      const screenTrack = this.screenStream.getVideoTracks()[0];
      screenTrack.onended = () => {
        if (this.isScreenSharing) this.stopScreenShare();
      };

      const myName = peerManager.userName || 'You';
      this.activeScreenShares.set('local', {
        stream: this.screenStream,
        userName: myName,
        isLocal: true
      });

      // Call each currently connected peer with screen stream
      peerManager.connections.forEach((conn, peerId) => {
        this.callPeerScreen(peerId, this.screenStream);
      });

      // Broadcast screen share started over data channel
      peerManager.broadcast({
        type: 'screen_share_started',
        peerId: peerManager.myPeerId,
        userName: myName
      });

      this.emit('screen_share_changed', { isScreenSharing: true, stream: this.screenStream });
      this.emit('screenshare_added', {
        peerId: 'local',
        stream: this.screenStream,
        userName: myName,
        isLocal: true
      });
    } catch (e) {
      console.warn('[MediaManager] Screen share cancelled or failed:', e);
      this.isScreenSharing = false;
      this.emit('screen_share_changed', { isScreenSharing: false, stream: null });
    }
  }

  stopScreenShare() {
    if (!this.isScreenSharing && !this.screenStream) return;
    this.isScreenSharing = false;

    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
      this.screenStream = null;
    }

    // Close all active screen calls
    this.screenCalls.forEach(call => {
      try { call.close(); } catch (e) {}
    });
    this.screenCalls.clear();

    this.activeScreenShares.delete('local');

    // Notify peers via data channel
    peerManager.broadcast({
      type: 'screen_share_stopped',
      peerId: peerManager.myPeerId
    });

    this.emit('screen_share_changed', { isScreenSharing: false, stream: null });
    this.emit('screenshare_removed', { peerId: 'local' });
  }

  callPeerScreen(remotePeerId, screenStream) {
    if (!peerManager.peer || !screenStream) return;
    if (this.screenCalls.has(remotePeerId)) {
      try { this.screenCalls.get(remotePeerId).close(); } catch (e) {}
      this.screenCalls.delete(remotePeerId);
    }

    try {
      const call = peerManager.peer.call(remotePeerId, screenStream, {
        metadata: {
          type: 'screenshare',
          sharerPeerId: peerManager.myPeerId,
          userName: peerManager.userName || 'Coworker'
        }
      });
      if (call) {
        this.screenCalls.set(remotePeerId, call);
        call.on('close', () => {
          this.screenCalls.delete(remotePeerId);
        });
        call.on('error', (err) => {
          console.warn(`[MediaManager] Outgoing screen call error with ${remotePeerId}:`, err);
          this.screenCalls.delete(remotePeerId);
        });
      }
    } catch (err) {
      console.warn(`[MediaManager] Failed to call peer ${remotePeerId} for screenshare:`, err);
    }
  }

  handleIncomingScreenCall(call) {
    const remotePeerId = call.metadata?.sharerPeerId || call.peer;
    const userName = call.metadata?.userName ||
      peerManager.peerMetadata.get(remotePeerId)?.userName || 'Coworker';

    call.on('stream', (screenStream) => {
      console.log(`[MediaManager] Received remote screen stream from ${remotePeerId}`);
      this.activeScreenShares.set(remotePeerId, {
        stream: screenStream,
        userName,
        isLocal: false
      });
      this.emit('screenshare_added', {
        peerId: remotePeerId,
        stream: screenStream,
        userName,
        isLocal: false
      });
    });

    call.on('close', () => {
      this.handleScreenShareRemoved(remotePeerId);
    });

    call.on('error', (err) => {
      console.warn(`[MediaManager] Remote screen call error for ${remotePeerId}:`, err);
      this.handleScreenShareRemoved(remotePeerId);
    });
  }

  handleScreenShareRemoved(peerId) {
    if (this.activeScreenShares.has(peerId)) {
      this.activeScreenShares.delete(peerId);
      this.emit('screenshare_removed', { peerId });
    }
  }

  replaceVideoTrackInCalls(newTrack) {
    if (!newTrack) return;
    this.calls.forEach(call => {
      const sender = call.peerConnection?.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(newTrack);
      }
    });
  }

  replaceAudioTrackInCalls(newTrack) {
    if (!newTrack) return;
    this.calls.forEach(call => {
      const sender = call.peerConnection?.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) {
        sender.replaceTrack(newTrack).catch(e => console.warn('replaceTrack audio error:', e));
      }
    });
  }

  // Audio Device Selection
  async getAudioDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return { inputs: [], outputs: [] };
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      return { inputs, outputs };
    } catch (e) {
      console.warn('[MediaManager] enumerateDevices error:', e);
      return { inputs: [], outputs: [] };
    }
  }

  async setAudioInputDevice(deviceId) {
    if (!deviceId) return false;
    this.selectedAudioInputId = deviceId;
    try {
      localStorage.setItem('preferred_audio_input', deviceId);
    } catch (e) {}

    if (!this.localStream) return false;

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          systemAudioEchoCancellation: { ideal: false },
          googEchoCancellation: true,
          googAutoGainControl: true,
          googNoiseSuppression: true,
          googHighpassFilter: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 }
        },
        video: false
      });

      const newAudioTrack = newStream.getAudioTracks()[0];
      if (!newAudioTrack) return false;

      // Preserve current mute state
      newAudioTrack.enabled = !this.isAudioMuted;

      // Replace old track in localStream
      const oldAudioTrack = this.localStream.getAudioTracks()[0];
      if (oldAudioTrack) {
        this.localStream.removeTrack(oldAudioTrack);
        oldAudioTrack.stop();
      }
      this.localStream.addTrack(newAudioTrack);

      // Replace audio track in all active calls
      this.replaceAudioTrackInCalls(newAudioTrack);

      // Reconnect analyser
      this.setupAudioAnalyser('local', this.localStream);
      this.emit('audio_input_changed', { deviceId });
      return true;
    } catch (err) {
      console.warn('[MediaManager] Failed to switch microphone:', err);
      return false;
    }
  }

  async setAudioOutputDevice(deviceId) {
    this.selectedAudioOutputId = deviceId;
    try {
      localStorage.setItem('preferred_audio_output', deviceId);
    } catch (e) {}

    let success = false;
    this.remoteAudioElements.forEach((audioEl) => {
      if (typeof audioEl.setSinkId === 'function') {
        audioEl.setSinkId(deviceId).catch(e => console.warn('setSinkId error:', e));
        success = true;
      }
    });
    this.emit('audio_output_changed', { deviceId });
    return success;
  }

  // Set individual coworker volume (0.0 to 1.0)
  setPeerVolume(peerId, volume) {
    const clamped = Math.max(0, Math.min(1, volume));
    this.peerVolumes.set(peerId, clamped);

    const isMutedLocally = this.peerMutedLocally.get(peerId) || this.isDeafened;
    const targetVol = isMutedLocally ? 0 : clamped;

    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) {
      audioEl.volume = targetVol;
      audioEl.muted = (targetVol === 0);
    }

    const videoEl = this.remoteVideoElements.get(peerId);
    if (videoEl) {
      videoEl.volume = targetVol;
      videoEl.muted = true; // Video element stays muted, audioEl plays sound
    }

    this.emit('peer_volume_changed', { peerId, volume: clamped });
  }

  // Toggle local mute on a specific coworker
  toggleMutePeerLocally(peerId) {
    const current = this.peerMutedLocally.get(peerId) || false;
    const next = !current;
    this.peerMutedLocally.set(peerId, next);

    const targetVol = (next || this.isDeafened) ? 0 : (this.peerVolumes.get(peerId) ?? 1.0);

    const audioEl = this.remoteAudioElements.get(peerId);
    if (audioEl) {
      audioEl.volume = targetVol;
      audioEl.muted = (targetVol === 0);
    }

    const videoEl = this.remoteVideoElements.get(peerId);
    if (videoEl) {
      videoEl.volume = targetVol;
      videoEl.muted = true;
    }

    this.emit('peer_local_mute_changed', { peerId, isMuted: next });
    return next;
  }

  getPeerAudioState(peerId) {
    return {
      volume: this.peerVolumes.get(peerId) ?? 1.0,
      isMutedLocally: this.peerMutedLocally.get(peerId) || false
    };
  }

  stopAll() {
    if (this.speechInterval) clearInterval(this.speechInterval);
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
    }
    this.screenCalls.forEach(call => { try { call.close(); } catch (e) {} });
    this.screenCalls.clear();
    this.activeScreenShares.clear();
    this.calls.forEach(call => call.close());
    this.calls.clear();
    this.remoteAudioElements.forEach(el => { el.srcObject = null; el.remove(); });
    this.remoteAudioElements.clear();
    this.remoteStreams.clear();
    this.analysers.forEach((_, id) => this.disconnectAudioAnalyser(id));
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try { this.audioContext.close(); } catch (e) {}
      this.audioContext = null;
    }
  }
}

export const mediaManager = new MediaManager();
