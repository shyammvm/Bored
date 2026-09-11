import { peerManager } from './peerManager.js';
import { playPop } from './soundEffects.js';

class ChatManager {
  constructor() {
    this.messages = [];
    this.unreadCount = 0;
    this.isChatOpen = false;
    this.listeners = new Map();

    this.setupListeners();
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(cb);
  }

  emit(event, data) {
    const list = this.listeners.get(event);
    if (list) list.forEach(cb => { try { cb(data); } catch (e) { console.error(e); } });
  }

  setupListeners() {
    peerManager.on('chat_message', (msg) => {
      this.messages.push(msg);
      if (!this.isChatOpen) {
        this.unreadCount++;
      }
      playPop();
      this.emit('message_received', { message: msg, unreadCount: this.unreadCount });
    });

    peerManager.on('room_created', ({ roomCode }) => {
      this.addSystemMessage(`Room ${roomCode} created.`);
    });

    peerManager.on('room_joined', ({ roomCode }) => {
      this.addSystemMessage(`You joined room ${roomCode}.`);
    });

    peerManager.on('peer_joined', ({ userName }) => {
      if (!userName) return;
      const joinText = `${userName} joined.`;
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && lastMsg.text === joinText && (Date.now() - (lastMsg.timestamp || 0) < 3000)) {
        return;
      }
      this.addSystemMessage(joinText);
      playPop();
    });

    peerManager.on('peer_left', ({ userName }) => {
      if (!userName) return;
      const leaveText = `${userName} left.`;
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg && (lastMsg.text === leaveText || (lastMsg.text.endsWith('left.') && userName === 'Coworker')) && (Date.now() - (lastMsg.timestamp || 0) < 4000)) {
        return;
      }
      this.addSystemMessage(leaveText);
    });

    peerManager.on('task_completed', ({ userName, taskTitle }) => {
      this.addSystemMessage(`${userName} finished: ${taskTitle}`);
    });
  }

  sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const message = {
      id: 'msg-' + Math.random().toString(36).substring(2, 9),
      senderId: peerManager.myPeerId,
      senderName: peerManager.userName,
      avatar: peerManager.userAvatar,
      text: trimmed,
      timestamp: Date.now(),
      isMe: true
    };

    this.messages.push(message);

    // Broadcast to peers
    peerManager.broadcast({
      type: 'chat_message',
      ...message,
      isMe: false
    });

    this.emit('message_received', { message, unreadCount: this.unreadCount });
    return message;
  }

  addSystemMessage(text) {
    const sysMsg = {
      id: 'sys-' + Math.random().toString(36).substring(2, 9),
      senderId: 'system',
      senderName: 'Bored!',
      avatar: 'B',
      text,
      timestamp: Date.now(),
      isSystem: true
    };
    this.messages.push(sysMsg);
    this.emit('message_received', { message: sysMsg, unreadCount: this.unreadCount });
  }

  setChatOpen(isOpen) {
    this.isChatOpen = isOpen;
    if (isOpen) {
      this.unreadCount = 0;
      this.emit('unread_cleared', { unreadCount: 0 });
    }
  }

  getMessages() {
    return this.messages;
  }
}

export const chatManager = new ChatManager();
