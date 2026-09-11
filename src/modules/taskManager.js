import confetti from 'canvas-confetti';
import { peerManager } from './peerManager.js';
import { playCelebration } from './soundEffects.js';

class TaskManager {
  constructor() {
    this.currentRoomCode = '';
    this.currentUserName = '';
    this.myTasks = [];
    // Coworker tasks map: peerId -> { userName, avatar, tasks: [] }
    this.coworkerTasks = new Map();
    this.listeners = new Map();

    this.clearLegacyStorage();
    this.setupNetworkListeners();
  }

  clearLegacyStorage() {
    try {
      localStorage.removeItem('bored_tasks');
    } catch (e) {}
  }

  initRoom(roomCode, userName) {
    this.currentRoomCode = roomCode || '';
    this.currentUserName = userName || '';
    this.coworkerTasks.clear();

    if (roomCode) {
      const storageKey = `bored_tasks_${roomCode}_${(userName || 'user').trim().toLowerCase()}`;
      try {
        const sessionRaw = sessionStorage.getItem(storageKey);
        if (sessionRaw) {
          this.myTasks = JSON.parse(sessionRaw);
        } else {
          this.myTasks = [];
        }
      } catch (e) {
        this.myTasks = [];
      }
    } else {
      this.myTasks = [];
    }

    this.saveTasks();
    this.emit('my_tasks_updated', { tasks: this.myTasks });
    this.emit('coworker_tasks_updated', { tasks: [] });
    this.broadcastMyTasks();
  }

  saveTasks() {
    if (!this.currentRoomCode) return;
    try {
      const key = `bored_tasks_${this.currentRoomCode}_${(this.currentUserName || 'user').trim().toLowerCase()}`;
      sessionStorage.setItem(key, JSON.stringify(this.myTasks));
    } catch (e) {
      console.warn('Could not save tasks to sessionStorage', e);
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

  setupNetworkListeners() {
    // When connected or joined, broadcast our tasks
    peerManager.on('peer_connected', () => {
      this.broadcastMyTasks();
      setTimeout(() => this.broadcastMyTasks(), 500);
    });

    peerManager.on('room_joined', ({ roomCode }) => {
      if (roomCode && roomCode !== this.currentRoomCode) {
        this.initRoom(roomCode, peerManager.userName);
      } else {
        this.broadcastMyTasks();
        setTimeout(() => this.broadcastMyTasks(), 500);
      }
    });

    peerManager.on('tasks_update', (data) => {
      if (!data || !data.peerId || data.peerId === peerManager.myPeerId) return;
      const isNew = !this.coworkerTasks.has(data.peerId);
      this.coworkerTasks.set(data.peerId, {
        userName: data.userName,
        avatar: data.avatar,
        tasks: data.tasks || []
      });
      this.emit('coworker_tasks_updated', { peerId: data.peerId, tasks: data.tasks });
      if (isNew) {
        this.broadcastMyTasks();
      }
    });

    peerManager.on('task_completed', (data) => {
      this.emit('peer_task_celebration', data);
    });

    peerManager.on('peer_left', ({ peerId }) => {
      this.coworkerTasks.delete(peerId);
      this.emit('coworker_tasks_updated', { peerId, tasks: [] });
    });

    peerManager.on('left_room', () => {
      this.currentRoomCode = '';
      this.currentUserName = '';
      this.myTasks = [];
      this.coworkerTasks.clear();
      this.emit('my_tasks_updated', { tasks: [] });
      this.emit('coworker_tasks_updated', { tasks: [] });
    });
  }

  addTask(title) {
    const trimmed = title.trim();
    if (!trimmed) return null;

    const newTask = {
      id: 'task-' + Math.random().toString(36).substring(2, 9),
      title: trimmed,
      completed: false,
      isFocus: this.myTasks.length === 0, // Make first task focus by default
      createdAt: Date.now()
    };

    this.myTasks.unshift(newTask);
    this.saveTasks();
    this.broadcastMyTasks();
    this.emit('my_tasks_updated', { tasks: this.myTasks });
    return newTask;
  }

  toggleTask(taskId) {
    const task = this.myTasks.find(t => t.id === taskId);
    if (!task) return;

    task.completed = !task.completed;
    if (task.completed) {
      if (task.isFocus) task.isFocus = false;
      // Trigger confetti and celebration chime!
      this.triggerConfetti();
      playCelebration();

      peerManager.broadcast({
        type: 'task_completed',
        peerId: peerManager.myPeerId,
        userName: peerManager.userName,
        taskTitle: task.title
      });

      this.emit('my_task_completed', { task });
    }

    this.saveTasks();
    this.broadcastMyTasks();
    this.emit('my_tasks_updated', { tasks: this.myTasks });
  }

  deleteTask(taskId) {
    this.myTasks = this.myTasks.filter(t => t.id !== taskId);
    this.saveTasks();
    this.broadcastMyTasks();
    this.emit('my_tasks_updated', { tasks: this.myTasks });
  }

  setFocusTask(taskId) {
    this.myTasks.forEach(t => {
      t.isFocus = (t.id === taskId && !t.completed) ? !t.isFocus : false;
    });

    this.saveTasks();
    this.broadcastMyTasks();
    this.emit('my_tasks_updated', { tasks: this.myTasks });
  }

  getFocusTask() {
    return this.myTasks.find(t => t.isFocus && !t.completed) || null;
  }

  getCoworkerTasksForPeer(peerId) {
    if (!peerId) return { tasks: [] };
    return this.coworkerTasks.get(peerId) || { tasks: [] };
  }

  getCoworkerFocusTask(peerId) {
    const peerData = this.getCoworkerTasksForPeer(peerId);
    if (!peerData || !peerData.tasks) return null;
    return peerData.tasks.find(t => t.isFocus && !t.completed) || null;
  }

  getCoworkerProgress(peerId) {
    const peerData = this.getCoworkerTasksForPeer(peerId);
    if (!peerData || !peerData.tasks || peerData.tasks.length === 0) return { completed: 0, total: 0, percent: 0 };
    const completed = peerData.tasks.filter(t => t.completed).length;
    const total = peerData.tasks.length;
    return { completed, total, percent: Math.round((completed / total) * 100) };
  }

  broadcastMyTasks() {
    if (!peerManager.myPeerId) return;

    peerManager.broadcast({
      type: 'tasks_update',
      peerId: peerManager.myPeerId,
      userName: peerManager.userName,
      avatar: peerManager.userAvatar,
      tasks: this.myTasks
    });
  }

  triggerConfetti() {
    try {
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#6366f1', '#10b981', '#ec4899', '#f59e0b', '#3b82f6']
      });
    } catch (e) {
      console.warn('Confetti error:', e);
    }
  }
}

export const taskManager = new TaskManager();
