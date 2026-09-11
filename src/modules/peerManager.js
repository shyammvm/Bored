import { Peer } from 'peerjs';

export function cleanRoomCode(code) {
  if (!code) return '';
  let s = String(code).trim();
  if (s.startsWith('http://') || s.startsWith('https://') || s.includes('?room=')) {
    try {
      const url = new URL(s.startsWith('http') ? s : `http://dummy.com/${s}`);
      s = url.searchParams.get('room') || s;
    } catch (e) {}
  }
  s = s.split('?')[0].split('#')[0].trim().toLowerCase();
  return s.replace(/[^a-z0-9_-]/g, '');
}

export function getRoomHostPeerId(roomCode) {
  const clean = cleanRoomCode(roomCode);
  return `bored-host-${clean}`;
}

class PeerManager {
  constructor() {
    this.peer = null;
    this.myPeerId = null;
    this.userName = '';
    this.userAvatar = '';
    this.roomCode = '';
    this.hostPeerId = null;
    this.isHost = false;

    // Rendezvous peer for host migration
    this.rendezvousPeer = null;
    this.joinTimeout = null;
    this.isConnectedToHost = false;

    // Connections map: peerId -> DataConnection
    this.connections = new Map();
    // Known peers metadata: peerId -> { userName, avatar, focusStatus, isDeafened, isMuted, isCamOff }
    this.peerMetadata = new Map();
    // Heartbeat tracking: peerId -> lastSeenTimestamp
    this.lastSeen = new Map();
    this.recentlyLeftPeers = new Set();
    this.knownJoinedPeers = new Set();
    this.initialPeers = new Set();
    this.heartbeatInterval = null;
    this.watchdogInterval = null;

    // Event listeners: eventName -> [callbacks]
    this.listeners = new Map();

    this.setupWindowUnload();
  }

  setupWindowUnload() {
    const handleUnload = () => {
      this.leaveRoom();
      if (this.peer && !this.peer.destroyed) {
        try { this.peer.destroy(); } catch (e) {}
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
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
        try { cb(data); } catch (e) { console.error(`Error in listener for ${event}:`, e); }
      });
    }
  }

  init(userName, avatar, customPeerId = undefined) {
    this.userName = userName;
    this.userAvatar = avatar;

    if (this.peer && !this.peer.destroyed) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;

      // Free public peerjs broker with custom or auto-generated peer ID
      this.peer = new Peer(customPeerId || undefined, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        }
      });

      this.peer.on('open', (id) => {
        this.myPeerId = id;
        console.log('[PeerManager] Connected with ID:', id);
        this.peerMetadata.set(id, {
          userName: this.userName,
          avatar: this.userAvatar,
          focusStatus: 'Bored',
          isDeafened: false,
          isMuted: false,
          isCamOff: false
        });
        this.emit('ready', { myPeerId: id });
        if (!isSettled) {
          isSettled = true;
          resolve(id);
        }
      });

      this.peer.on('connection', (conn) => {
        this.handleIncomingDataConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('[PeerManager] Peer error:', err);
        this.emit('error', err);

        // Detect peer unavailable error when joining room
        if (err && err.type === 'peer-unavailable') {
          if (this.joinTimeout) {
            clearTimeout(this.joinTimeout);
            this.joinTimeout = null;
          }
          this.emit('join_error', {
            type: 'peer-unavailable',
            roomCode: this.roomCode,
            message: `Room "${this.roomCode}" was not found or the host is offline.`
          });
        }

        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });

      this.peer.on('disconnected', () => {
        console.warn('[PeerManager] Disconnected from server, attempting reconnect...');
        this.peer.reconnect();
      });
    });
  }

  createRoom(roomName = '') {
    this.isHost = true;
    this.hostPeerId = this.myPeerId;
    const code = cleanRoomCode(roomName) || 
      'flow-' + Math.random().toString(36).substring(2, 7);
    this.roomCode = code;
    this.isConnectedToHost = true;
    this.emit('room_created', { roomCode: this.roomCode, hostPeerId: this.myPeerId });
    return { roomCode: this.roomCode, hostPeerId: this.myPeerId };
  }

  joinRoom(roomCode, hostPeerId) {
    const cleanCode = cleanRoomCode(roomCode);
    this.roomCode = cleanCode;
    const targetHostId = hostPeerId || getRoomHostPeerId(cleanCode);
    this.hostPeerId = targetHostId;
    this.isHost = (this.hostPeerId === this.myPeerId);
    this.isConnectedToHost = this.isHost;

    if (!this.isHost) {
      console.log(`[PeerManager] Connecting to host: ${targetHostId}`);

      if (this.joinTimeout) clearTimeout(this.joinTimeout);
      this.joinTimeout = setTimeout(() => {
        if (!this.isConnectedToHost) {
          console.warn('[PeerManager] Join room timed out');
          this.emit('join_error', {
            type: 'timeout',
            roomCode: this.roomCode,
            message: `Connecting to room "${this.roomCode}" timed out. Please check the code and try again.`
          });
        }
      }, 9000);

      const conn = this.peer.connect(targetHostId, {
        reliable: true,
        metadata: {
          userName: this.userName,
          avatar: this.userAvatar,
          roomCode: this.roomCode
        }
      });
      this.setupDataConnection(conn);
    }
  }

  connectToPeer(targetPeerId) {
    if (targetPeerId === this.myPeerId || this.connections.has(targetPeerId)) return;
    console.log(`[PeerManager] Mesh connecting to peer: ${targetPeerId}`);
    const conn = this.peer.connect(targetPeerId, {
      reliable: true,
      metadata: {
        userName: this.userName,
        avatar: this.userAvatar,
        roomCode: this.roomCode
      }
    });
    this.setupDataConnection(conn);
  }

  handleIncomingDataConnection(conn) {
    console.log(`[PeerManager] Incoming connection from: ${conn.peer}`);
    this.setupDataConnection(conn);
  }

  setupDataConnection(conn) {
    conn.on('open', () => {
      console.log(`[PeerManager] DataChannel opened with: ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      this.lastSeen.set(conn.peer, Date.now());

      if (conn.peer === this.hostPeerId) {
        this.isConnectedToHost = true;
        if (this.joinTimeout) {
          clearTimeout(this.joinTimeout);
          this.joinTimeout = null;
        }
      }

      // Monitor underlying WebRTC peerConnection states
      if (conn.peerConnection) {
        conn.peerConnection.addEventListener('connectionstatechange', () => {
          const state = conn.peerConnection?.connectionState;
          console.log(`[PeerManager] conn peerConnection state with ${conn.peer}: ${state}`);
          if (['disconnected', 'failed', 'closed'].includes(state)) {
            this.handlePeerLeft(conn.peer);
          }
        });

        conn.peerConnection.addEventListener('iceconnectionstatechange', () => {
          const iceState = conn.peerConnection?.iceConnectionState;
          console.log(`[PeerManager] conn iceConnection state with ${conn.peer}: ${iceState}`);
          if (['disconnected', 'failed', 'closed'].includes(iceState)) {
            this.handlePeerLeft(conn.peer);
          }
        });
      }

      // Start heartbeat broadcast and watchdog if not started
      this.startHeartbeat();

      // Send local handshake metadata
      conn.send({
        type: 'handshake',
        peerId: this.myPeerId,
        userName: this.userName,
        avatar: this.userAvatar,
        focusStatus: this.peerMetadata.get(this.myPeerId)?.focusStatus || 'Bored',
        isDeafened: this.peerMetadata.get(this.myPeerId)?.isDeafened || false,
        isMuted: this.peerMetadata.get(this.myPeerId)?.isMuted || false,
        isCamOff: this.peerMetadata.get(this.myPeerId)?.isCamOff || false
      });

      // If host, welcome the new peer and broadcast to other peers
      if (this.isHost && conn.peer !== this.myPeerId) {
        // Collect existing peers
        const peerList = Array.from(this.connections.keys()).filter(id => id !== conn.peer);
        peerList.push(this.myPeerId);

        conn.send({
          type: 'welcome',
          roomCode: this.roomCode,
          hostPeerId: this.hostPeerId,
          peers: peerList,
          metadata: Array.from(this.peerMetadata.entries())
        });

        // Tell existing peers about new joiner
        this.broadcast({
          type: 'peer_joined',
          peerId: conn.peer,
          userName: conn.metadata?.userName || 'Coworker',
          avatar: conn.metadata?.avatar || 'CO'
        }, [conn.peer]);
      }

      this.emit('peer_connected', { peerId: conn.peer });
    });

    conn.on('data', (data) => {
      this.handleIncomingData(conn.peer, data);
    });

    conn.on('close', () => {
      console.log(`[PeerManager] DataChannel closed: ${conn.peer}`);
      this.handlePeerLeft(conn.peer);
    });

    conn.on('error', (err) => {
      console.warn(`[PeerManager] Connection error with ${conn.peer}:`, err);
      this.handlePeerLeft(conn.peer);
    });
  }

  startHeartbeat() {
    if (this.heartbeatInterval) return;

    // Send heartbeat to all peers every 3 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.connections.size > 0 && this.myPeerId) {
        this.broadcast({
          type: 'heartbeat',
          peerId: this.myPeerId,
          timestamp: Date.now()
        });
      }
    }, 3000);

    // Watchdog check every 2 seconds: if peer silent > 7 seconds, remove them
    this.watchdogInterval = setInterval(() => {
      const now = Date.now();
      const deadPeers = [];

      this.connections.forEach((conn, peerId) => {
        const last = this.lastSeen.get(peerId);
        if (last && now - last > 7500) {
          console.warn(`[PeerManager] Heartbeat timed out for peer ${peerId}, removing.`);
          deadPeers.push(peerId);
        }
      });

      deadPeers.forEach(id => this.handlePeerLeft(id));
    }, 2000);
  }

  handleIncomingData(senderPeerId, data) {
    if (!data || !data.type) return;

    // Refresh liveness on every message
    this.lastSeen.set(senderPeerId, Date.now());

    if (data.type === 'heartbeat') {
      return;
    }

    switch (data.type) {
      case 'handshake': {
        this.peerMetadata.set(senderPeerId, {
          userName: data.userName,
          avatar: data.avatar,
          focusStatus: data.focusStatus,
          isDeafened: data.isDeafened,
          isMuted: data.isMuted,
          isCamOff: data.isCamOff
        });
        this.emit('peer_metadata_updated', { peerId: senderPeerId, metadata: this.peerMetadata.get(senderPeerId) });

        // If this is a newly connected peer who joined after us, emit peer_joined
        if (!this.knownJoinedPeers.has(senderPeerId)) {
          this.knownJoinedPeers.add(senderPeerId);
          if (!this.initialPeers.has(senderPeerId)) {
            console.log(`[PeerManager] New peer joined: ${senderPeerId} (${data.userName})`);
            this.emit('peer_joined', {
              peerId: senderPeerId,
              userName: data.userName || 'Coworker',
              avatar: data.avatar || 'CO'
            });
          }
        }
        break;
      }

      case 'welcome': {
        // We are a guest receiving the room roster from the host
        this.isConnectedToHost = true;
        if (this.joinTimeout) {
          clearTimeout(this.joinTimeout);
          this.joinTimeout = null;
        }

        this.roomCode = data.roomCode;
        this.hostPeerId = data.hostPeerId;

        // Remember existing peers who were already present when we joined
        if (Array.isArray(data.peers)) {
          data.peers.forEach(id => {
            if (id !== this.myPeerId) {
              this.initialPeers.add(id);
              this.knownJoinedPeers.add(id);
            }
          });
        }

        // Restore peer metadata
        if (Array.isArray(data.metadata)) {
          data.metadata.forEach(([id, meta]) => {
            this.peerMetadata.set(id, meta);
          });
        }

        // Connect to every other peer in the room mesh
        if (Array.isArray(data.peers)) {
          data.peers.forEach(peerId => {
            if (peerId !== this.myPeerId && !this.connections.has(peerId)) {
              this.connectToPeer(peerId);
            }
          });
        }

        this.emit('room_joined', {
          roomCode: this.roomCode,
          hostPeerId: this.hostPeerId,
          peers: data.peers
        });
        break;
      }

      case 'peer_joined': {
        console.log(`[PeerManager] peer_joined received for ${data.peerId}`);
        this.peerMetadata.set(data.peerId, {
          userName: data.userName,
          avatar: data.avatar,
          focusStatus: 'Bored'
        });
        // Establish connection with the new peer
        if (data.peerId !== this.myPeerId && !this.connections.has(data.peerId)) {
          this.connectToPeer(data.peerId);
        }
        if (!this.knownJoinedPeers.has(data.peerId)) {
          this.knownJoinedPeers.add(data.peerId);
          this.emit('peer_joined', data);
        }
        break;
      }

      case 'peer_left': {
        this.handlePeerLeft(data.peerId);
        break;
      }

      case 'chat_message': {
        this.emit('chat_message', data);
        break;
      }

      case 'tasks_update': {
        this.emit('tasks_update', data);
        break;
      }

      case 'task_completed': {
        this.emit('task_completed', data);
        break;
      }

      case 'status_update': {
        const meta = this.peerMetadata.get(data.peerId) || {};
        Object.assign(meta, data);
        this.peerMetadata.set(data.peerId, meta);
        this.emit('peer_metadata_updated', { peerId: data.peerId, metadata: meta });
        break;
      }

      case 'pomodoro_sync': {
        this.emit('pomodoro_sync', data);
        break;
      }

      case 'music_sync': {
        this.emit('music_sync', data);
        break;
      }

      case 'music_volume_sync': {
        this.emit('music_volume_sync', data);
        break;
      }

      case 'screen_share_started': {
        this.emit('screen_share_started', data);
        break;
      }

      case 'screen_share_stopped': {
        this.emit('screen_share_stopped', data);
        break;
      }

      case 'codeshare_edit':
      case 'codeshare_sync':
      case 'codeshare_request_sync':
      case 'codeshare_language':
      case 'codeshare_typing': {
        this.emit(data.type, data);
        break;
      }

      default:
        this.emit(data.type, data);
    }
  }

  handlePeerLeft(peerId) {
    if (!peerId) return;

    // Idempotency guard: if peer is already removed or not in metadata/connections, do not process again
    if (!this.connections.has(peerId) && !this.peerMetadata.has(peerId)) {
      return;
    }

    if (this.recentlyLeftPeers.has(peerId)) {
      return;
    }
    this.recentlyLeftPeers.add(peerId);
    setTimeout(() => this.recentlyLeftPeers.delete(peerId), 5000);

    if (this.connections.has(peerId)) {
      try {
        this.connections.get(peerId).close();
      } catch (e) {}
      this.connections.delete(peerId);
    }
    this.lastSeen.delete(peerId);

    const meta = this.peerMetadata.get(peerId);
    const userName = meta?.userName || 'Coworker';
    this.peerMetadata.delete(peerId);
    this.knownJoinedPeers.delete(peerId);
    this.initialPeers.delete(peerId);

    console.log(`[PeerManager] Peer left: ${peerId} (${userName})`);
    this.emit('peer_left', { peerId, userName });

    // Host migration if host left
    if (peerId === this.hostPeerId) {
      const remainingPeers = Array.from(this.connections.keys());
      remainingPeers.push(this.myPeerId);
      remainingPeers.sort();
      this.hostPeerId = remainingPeers[0];
      this.isHost = (this.hostPeerId === this.myPeerId);
      console.log(`[PeerManager] Host migrated to: ${this.hostPeerId}, amHost: ${this.isHost}`);
      this.emit('host_changed', { hostPeerId: this.hostPeerId, isHost: this.isHost });
      if (this.isHost) {
        this.claimHostRendezvousId();
      }
    }
  }

  claimHostRendezvousId(retries = 3) {
    if (!this.isHost || !this.roomCode) return;
    const targetHostId = getRoomHostPeerId(this.roomCode);
    if (this.myPeerId === targetHostId) return; // already primary host

    if (this.rendezvousPeer && !this.rendezvousPeer.destroyed) {
      try { this.rendezvousPeer.destroy(); } catch (e) {}
      this.rendezvousPeer = null;
    }

    const tryClaim = () => {
      if (!this.isHost || !this.roomCode) return;
      console.log(`[PeerManager] Attempting to claim host rendezvous ID: ${targetHostId}`);
      const rPeer = new Peer(targetHostId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
          ]
        }
      });

      rPeer.on('open', () => {
        console.log(`[PeerManager] Successfully claimed host rendezvous ID: ${targetHostId}`);
        this.rendezvousPeer = rPeer;

        // Listen for new joiners who connect to the room's host ID
        rPeer.on('connection', (conn) => {
          console.log(`[PeerManager] Rendezvous received incoming connection from ${conn.peer}`);
          conn.on('open', () => {
            const peerList = Array.from(this.connections.keys()).filter(id => id !== conn.peer);
            peerList.push(this.myPeerId);

            conn.send({
              type: 'welcome',
              roomCode: this.roomCode,
              hostPeerId: this.myPeerId,
              peers: peerList,
              metadata: Array.from(this.peerMetadata.entries())
            });

            // Connect our primary peer to the joiner
            this.connectToPeer(conn.peer);

            // Broadcast to other peers in room
            this.broadcast({
              type: 'peer_joined',
              peerId: conn.peer,
              userName: conn.metadata?.userName || 'Coworker',
              avatar: conn.metadata?.avatar || 'CO'
            }, [conn.peer]);
          });
        });
      });

      rPeer.on('error', (err) => {
        console.warn(`[PeerManager] Rendezvous peer attempt failed (${err.type}):`, err);
        try { rPeer.destroy(); } catch (e) {}
        if (retries > 0 && err.type === 'unavailable-id') {
          setTimeout(() => this.claimHostRendezvousId(retries - 1), 2000);
        }
      });
    };

    setTimeout(tryClaim, 1500);
  }

  broadcast(message, excludePeerIds = []) {
    const json = typeof message === 'string' ? message : message;
    this.connections.forEach((conn, peerId) => {
      if (!excludePeerIds.includes(peerId) && conn.open) {
        try {
          conn.send(json);
        } catch (e) {
          console.warn(`Failed to send data to ${peerId}:`, e);
        }
      }
    });
  }

  updateMyStatus(statusObj) {
    const myMeta = this.peerMetadata.get(this.myPeerId) || {};
    Object.assign(myMeta, statusObj);
    this.peerMetadata.set(this.myPeerId, myMeta);

    this.broadcast({
      type: 'status_update',
      peerId: this.myPeerId,
      ...statusObj
    });
    this.emit('peer_metadata_updated', { peerId: this.myPeerId, metadata: myMeta });
  }

  getPeerMetadata(peerId) {
    return this.peerMetadata.get(peerId) || null;
  }

  getAllPeers() {
    const list = Array.from(this.peerMetadata.entries()).map(([id, meta]) => ({
      id,
      ...meta,
      isMe: id === this.myPeerId
    }));

    // Deduplicate peers by userName if a peer reconnected
    const byUser = new Map();
    list.forEach(p => {
      if (p.isMe) {
        byUser.set('__me__', p);
        return;
      }
      const key = p.userName ? p.userName.trim().toLowerCase() : p.id;
      const existing = byUser.get(key);
      if (!existing) {
        byUser.set(key, p);
      } else {
        // Keep the one that has an active connection in this.connections
        if (this.connections.has(p.id) && !this.connections.has(existing.id)) {
          byUser.set(key, p);
        }
      }
    });

    return Array.from(byUser.values());
  }

  leaveRoom() {
    if (this.joinTimeout) clearTimeout(this.joinTimeout);
    this.joinTimeout = null;
    this.isConnectedToHost = false;

    if (this.rendezvousPeer && !this.rendezvousPeer.destroyed) {
      try { this.rendezvousPeer.destroy(); } catch (e) {}
      this.rendezvousPeer = null;
    }

    this.recentlyLeftPeers.clear();
    this.knownJoinedPeers.clear();
    this.initialPeers.clear();

    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);
    this.heartbeatInterval = null;
    this.watchdogInterval = null;

    try {
      this.broadcast({
        type: 'peer_left',
        peerId: this.myPeerId
      });
    } catch (e) {}

    this.connections.forEach(conn => {
      try { conn.close(); } catch (e) {}
    });
    this.connections.clear();
    this.peerMetadata.clear();
    this.lastSeen.clear();
    this.roomCode = '';
    this.hostPeerId = null;
    this.isHost = false;
    this.emit('left_room');
  }
}

export const peerManager = new PeerManager();
