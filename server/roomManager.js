/**
 * OOP room layer.
 *
 *   Participant - one live user: id, username, role, socketId, canControl()
 *   Room        - in-memory live state for one watch party: participants,
 *                 playback state, video queue, control requests, broadcast helpers
 *   RoomManager - loads/saves Room state to MongoDB (persistent rooms),
 *                 debounced so rapid seeks don't hammer the database
 */
const { v4: uuidv4 } = require('uuid');
const { RoomModel, ChatModel } = require('./db');

const ROLES = ['host', 'moderator', 'participant'];
const CHAT_KEEP = 100; // per-room cap in the DB

class Participant {
  constructor({ username, role = 'participant', socketId }) {
    this.id = uuidv4();
    this.username = (username || 'Guest').slice(0, 24);
    this.role = role === 'viewer' ? 'participant' : role; // viewer = participant alias
    this.socketId = socketId;
    this.joinedAt = Date.now();
  }
  canControl() {
    return this.role === 'host' || this.role === 'moderator';
  }
  isHost() {
    return this.role === 'host';
  }
  setRole(role) {
    if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
    this.role = role;
  }
  toJSON() {
    return { id: this.id, username: this.username, role: this.role, joinedAt: this.joinedAt };
  }
}

class Room {
  constructor(code, persisted) {
    this.code = code;
    this.participants = new Map();
    // Hydrate from MongoDB when the room already existed (persistent rooms)
    this.videoId = persisted?.videoId ?? null;
    this.playState = persisted?.playState ?? 'paused';
    this.currentTime = persisted?.currentTime ?? 0;
    this.updatedAt = persisted?.updatedAt ? new Date(persisted.updatedAt).getTime() : Date.now();
    this.hostUserId = persisted?.hostUserId ?? null;
    this.queue = (persisted?.queue ?? []).map((q) => ({
      id: String(q._id),
      videoId: q.videoId,
      addedBy: q.addedBy,
      addedByName: q.addedByName,
      addedAt: q.addedAt,
    }));
    this.controlRequests = new Map();
    this._saveTimer = null;
  }

  // ----- participants -----
  addParticipant(p) {
    this.participants.set(p.id, p);
    // First participant ever becomes host if the room has no host yet
    if (!this.hostUserId) {
      p.setRole('host');
      this.hostUserId = p.id;
    }
    return p;
  }
  removeParticipant(id) {
    const removed = this.participants.get(id);
    this.participants.delete(id);
    if (removed?.isHost()) {
      const next =
        [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)
          .find((p) => p.role === 'moderator') ||
        [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) {
        next.setRole('host');
        this.hostUserId = next.id;
      } else {
        this.hostUserId = null;
      }
    }
    return removed;
  }
  getParticipant(id) {
    return this.participants.get(id);
  }
  listParticipants() {
    return [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.toJSON());
  }
  isEmpty() {
    return this.participants.size === 0;
  }

  // ----- playback state (drift-corrected) -----
  getState() {
    let t = this.currentTime;
    if (this.playState === 'playing') t += (Date.now() - this.updatedAt) / 1000;
    return { videoId: this.videoId, playState: this.playState, currentTime: Math.max(0, t) };
  }
  setPlaying() {
    this.playState = 'playing';
    this.updatedAt = Date.now();
  }
  setPaused(atTime) {
    this.playState = 'paused';
    this.currentTime = Math.max(0, atTime);
    this.updatedAt = Date.now();
  }
  setSeek(atTime) {
    this.currentTime = Math.max(0, atTime);
    this.updatedAt = Date.now();
  }
  setVideo(videoId) {
    this.videoId = videoId;
    this.playState = 'playing';
    this.currentTime = 0;
    this.updatedAt = Date.now();
  }

  // ----- video queue ("Up next") -----
  addToQueue({ videoId, addedBy, addedByName }) {
    const item = { id: uuidv4(), videoId, addedBy, addedByName, addedAt: new Date() };
    this.queue.push(item);
    return item;
  }
  removeFromQueue(queueId) {
    const i = this.queue.findIndex((q) => q.id === queueId);
    if (i === -1) return null;
    return this.queue.splice(i, 1)[0];
  }
  /** Pop the next queued video and start playing it. Returns the item or null. */
  playNext() {
    const next = this.queue.shift();
    if (!next) return null;
    this.setVideo(next.videoId);
    return next;
  }
  listQueue() {
    return this.queue;
  }

  // ----- broadcast helpers -----
  broadcast(io, event, payload) {
    io.to(this.code).emit(event, payload);
  }
  broadcastToPrivileged(io, event, payload) {
    for (const p of this.participants.values()) {
      if (p.canControl()) io.to(p.socketId).emit(event, payload);
    }
  }

  // ----- persistence snapshot -----
  toDoc() {
    return {
      code: this.code,
      videoId: this.videoId,
      playState: this.playState,
      currentTime: this.playState === 'playing' ? this.getState().currentTime : this.currentTime,
      updatedAt: new Date(),
      hostUserId: this.hostUserId,
      queue: this.queue.map((q) => ({
        videoId: q.videoId,
        addedBy: q.addedBy,
        addedByName: q.addedByName,
        addedAt: q.addedAt,
      })),
      lastActiveAt: new Date(),
    };
  }
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> Room (live)
  }

  /** Load a room from MongoDB into memory, or create it if new. */
  async getOrCreate(code) {
    let room = this.rooms.get(code);
    if (room) return room;
    const doc = await RoomModel.findOne({ code }).lean();
    room = new Room(code, doc);
    if (!doc) {
      await RoomModel.create({ code });
    }
    this.rooms.set(code, room);
    return room;
  }

  /** Debounced persist — rapid seeks won't hammer MongoDB. */
  schedulePersist(room) {
    clearTimeout(room._saveTimer);
    room._saveTimer = setTimeout(() => {
      RoomModel.updateOne({ code: room.code }, { $set: room.toDoc() }).exec().catch((e) => {
        console.error('persist failed:', e.message);
      });
    }, 800);
  }

  /** Flush immediately (used when the last user leaves). */
  async persistNow(room) {
    clearTimeout(room._saveTimer);
    await RoomModel.updateOne({ code: room.code }, { $set: room.toDoc() }).exec();
  }

  /** Drop the in-memory copy; the DB document stays (persistent room). */
  unload(code) {
    const room = this.rooms.get(code);
    if (room) clearTimeout(room._saveTimer);
    this.rooms.delete(code);
  }

  async loadChat(code, limit = 50) {
    const docs = await ChatModel.find({ roomCode: code }).sort({ at: -1 }).limit(limit).lean();
    return docs.reverse().map((d) => ({
      id: String(d._id),
      userId: d.userId,
      username: d.username,
      role: d.role,
      text: d.text,
      at: new Date(d.at).getTime(),
    }));
  }

  async saveChat(roomCode, message) {
    await ChatModel.create({
      roomCode,
      userId: message.userId,
      username: message.username,
      role: message.role,
      text: message.text,
    });
    // Trim: keep only the newest CHAT_KEEP messages per room
    const count = await ChatModel.countDocuments({ roomCode });
    if (count > CHAT_KEEP) {
      const old = await ChatModel.find({ roomCode }).sort({ at: 1 }).limit(count - CHAT_KEEP).select('_id');
      await ChatModel.deleteMany({ _id: { $in: old.map((d) => d._id) } });
    }
  }
}

module.exports = { Participant, Room, RoomManager, ROLES };
