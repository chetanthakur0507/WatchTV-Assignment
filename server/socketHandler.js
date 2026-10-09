/**
 * Socket.IO event handlers.
 *
 * Client -> Server: join_room, leave_room, play, pause, seek, change_video,
 *   assign_role, transfer_host, remove_participant, chat_message,
 *   control_request, control_decision, queue_add, queue_remove, queue_play,
 *   video_ended, reaction, typing, get_state
 * Server -> Client: room_joined(ack), sync_state, user_joined, user_left,
 *   role_assigned, participant_removed, removed, chat_message, queue_updated,
 *   reaction, user_typing, control_requested, control_resolved, error
 *
 * Permission checks happen HERE on the server — the UI disabling buttons is
 * only cosmetic. Room state is persisted to MongoDB via RoomManager.
 */
const { v4: uuidv4 } = require('uuid');
const { Participant, RoomManager } = require('./roomManager');

function registerSocketHandlers(io) {
  const manager = new RoomManager(io);

  const resolveParticipant = (socket) => {
    const { roomCode, participantId } = socket.data;
    if (!roomCode || !participantId) return null;
    const room = manager.rooms.get(roomCode);
    if (!room) return null;
    const participant = room.getParticipant(participantId);
    if (!participant) return null;
    return { room, participant };
  };

  const socketIdOf = (room, participantId) => room.getParticipant(participantId)?.socketId ?? null;

  async function leaveRoom(socket) {
    const { roomCode, participantId } = socket.data;
    if (!roomCode || !participantId) return;
    const room = manager.rooms.get(roomCode);
    if (!room) return;
    const prevHostId = room.hostUserId;
    const left = room.removeParticipant(participantId);
    socket.leave(roomCode);
    socket.data.roomCode = null;
    socket.data.participantId = null;
    if (room.isEmpty()) {
      await manager.persistNow(room); // room survives in MongoDB (persistent rooms)
      manager.unload(roomCode);
    } else if (left) {
      manager.schedulePersist(room);
      room.broadcast(io, 'user_left', { userId: left.id, username: left.username, participants: room.listParticipants() });
      if (prevHostId !== room.hostUserId) {
        room.broadcast(io, 'role_assigned', {
          userId: room.hostUserId,
          username: room.getParticipant(room.hostUserId)?.username,
          role: 'host',
          participants: room.listParticipants(),
        });
      }
    }
  }

  io.on('connection', (socket) => {
    // ---------------- join / leave ----------------
    socket.on('join_room', async ({ roomCode, username }, ack = () => {}) => {
      try {
        if (!roomCode || !username?.trim()) return ack({ ok: false, error: 'roomCode and username are required' });
        const code = String(roomCode).toUpperCase();
        const room = await manager.getOrCreate(code);
        const role = room.participants.size === 0 && !room.hostUserId ? 'host' : 'participant';
        const participant = new Participant({ username, role, socketId: socket.id });
        room.addParticipant(participant);

        socket.data.roomCode = code;
        socket.data.participantId = participant.id;
        socket.join(code);
        manager.schedulePersist(room);

        const chat = await manager.loadChat(code);
        ack({
          ok: true,
          roomCode: code,
          you: participant.toJSON(),
          participants: room.listParticipants(),
          state: room.getState(),
          queue: room.listQueue(),
          chat,
        });
        socket.to(code).emit('user_joined', { user: participant.toJSON(), participants: room.listParticipants() });
      } catch (e) {
        console.error('join_room failed:', e.message);
        ack({ ok: false, error: 'Could not join room' });
      }
    });

    socket.on('leave_room', () => leaveRoom(socket));
    socket.on('disconnect', () => leaveRoom(socket));

    // ---------------- permission gate ----------------
    const requireControl = (socket, ack) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) {
        ack?.({ ok: false, error: 'Not in a room' });
        return null;
      }
      if (!ctx.participant.canControl()) {
        ack?.({ ok: false, error: 'Only host or moderator can control playback' });
        socket.emit('error', { message: 'Only host or moderator can control playback' });
        return null;
      }
      return ctx;
    };

    // ---------------- playback ----------------
    socket.on('play', (maybeAck, maybeAck2) => {
      const ack = typeof maybeAck === 'function' ? maybeAck : maybeAck2 || (() => {});
      const ctx = requireControl(socket, ack);
      if (!ctx) return;
      ctx.room.setPlaying();
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
      ack({ ok: true });
    });

    socket.on('pause', ({ time } = {}, ack = () => {}) => {
      const ctx = requireControl(socket, ack);
      if (!ctx) return;
      ctx.room.setPaused(typeof time === 'number' ? time : ctx.room.getState().currentTime);
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
      ack({ ok: true });
    });

    socket.on('seek', ({ time }, ack = () => {}) => {
      const ctx = requireControl(socket, ack);
      if (!ctx || typeof time !== 'number') return;
      ctx.room.setSeek(time);
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
      ack({ ok: true });
    });

    socket.on('change_video', ({ videoId }, ack = () => {}) => {
      const ctx = requireControl(socket, ack);
      if (!ctx || !videoId) return;
      ctx.room.setVideo(videoId);
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
      ack({ ok: true });
    });

    // Auto-advance: when the video ends, play the next queued video.
    // Accepts both emit('video_ended') and emit('video_ended', {}).
    socket.on('video_ended', (maybeAck, maybeAck2) => {
      const ack = typeof maybeAck === 'function' ? maybeAck : maybeAck2 || (() => {});
      const ctx = requireControl(socket, ack);
      if (!ctx) return;
      const next = ctx.room.playNext();
      manager.schedulePersist(ctx.room);
      if (next) {
        ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
        ctx.room.broadcast(io, 'queue_updated', { queue: ctx.room.listQueue() });
      }
      ack({ ok: true, advanced: !!next });
    });

    // ---------------- video queue ("Up next") ----------------
    // Anyone (even participants) can suggest videos; only host/mod can play/remove.
    socket.on('queue_add', ({ videoId }, ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx || !videoId) return ack({ ok: false, error: 'Not in a room' });
      const item = ctx.room.addToQueue({
        videoId,
        addedBy: ctx.participant.id,
        addedByName: ctx.participant.username,
      });
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'queue_updated', { queue: ctx.room.listQueue() });
      ack({ ok: true, item });
    });

    socket.on('queue_remove', ({ queueId }, ack = () => {}) => {
      const ctx = requireControl(socket, ack);
      if (!ctx) return;
      const removed = ctx.room.removeFromQueue(queueId);
      if (!removed) return ack({ ok: false, error: 'Not in queue' });
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'queue_updated', { queue: ctx.room.listQueue() });
      ack({ ok: true });
    });

    socket.on('queue_play', ({ queueId }, ack = () => {}) => {
      const ctx = requireControl(socket, ack);
      if (!ctx) return;
      const item = ctx.room.removeFromQueue(queueId);
      if (!item) return ack({ ok: false, error: 'Not in queue' });
      ctx.room.setVideo(item.videoId);
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
      ctx.room.broadcast(io, 'queue_updated', { queue: ctx.room.listQueue() });
      ack({ ok: true });
    });

    // ---------------- roles ----------------
    socket.on('assign_role', ({ userId, role }, ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (!ctx.participant.isHost()) return ack({ ok: false, error: 'Only the host can assign roles' });
      if (userId === ctx.participant.id) return ack({ ok: false, error: 'You cannot change your own role' });
      const target = ctx.room.getParticipant(userId);
      if (!target) return ack({ ok: false, error: 'User not found' });
      if (!['moderator', 'participant'].includes(role)) return ack({ ok: false, error: 'Invalid role' });
      target.setRole(role);
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'role_assigned', {
        userId: target.id, username: target.username, role: target.role,
        participants: ctx.room.listParticipants(),
      });
      ack({ ok: true });
    });

    socket.on('transfer_host', ({ userId }, ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (!ctx.participant.isHost()) return ack({ ok: false, error: 'Only the host can transfer host' });
      const target = ctx.room.getParticipant(userId);
      if (!target || target.id === ctx.participant.id) return ack({ ok: false, error: 'Invalid target' });
      target.setRole('host');
      ctx.participant.setRole('moderator');
      ctx.room.hostUserId = target.id;
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'role_assigned', {
        userId: target.id, username: target.username, role: 'host',
        participants: ctx.room.listParticipants(),
      });
      ack({ ok: true });
    });

    socket.on('remove_participant', ({ userId }, ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (!ctx.participant.isHost()) return ack({ ok: false, error: 'Only the host can remove participants' });
      if (userId === ctx.participant.id) return ack({ ok: false, error: 'You cannot remove yourself' });
      const removed = ctx.room.removeParticipant(userId);
      if (!removed) return ack({ ok: false, error: 'User not found' });
      io.to(removed.socketId).emit('removed', { reason: 'Removed by host' });
      const targetSocket = io.sockets.sockets.get(removed.socketId);
      if (targetSocket) {
        targetSocket.leave(ctx.room.code);
        targetSocket.data.roomCode = null;
        targetSocket.data.participantId = null;
      }
      manager.schedulePersist(ctx.room);
      ctx.room.broadcast(io, 'participant_removed', {
        userId: removed.id, username: removed.username, participants: ctx.room.listParticipants(),
      });
      ack({ ok: true });
    });

    // ---------------- chat (persisted) ----------------
    socket.on('chat_message', async ({ text }, ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx || !text?.trim()) return ack({ ok: false });
      const message = {
        id: uuidv4(),
        userId: ctx.participant.id,
        username: ctx.participant.username,
        role: ctx.participant.role,
        text: text.trim().slice(0, 500),
        at: Date.now(),
      };
      await manager.saveChat(ctx.room.code, message).catch((e) => console.error('chat save failed:', e.message));
      ctx.room.broadcast(io, 'chat_message', message);
      ack({ ok: true });
    });

    socket.on('typing', ({ isTyping }) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) return;
      socket.to(ctx.room.code).emit('user_typing', {
        userId: ctx.participant.id,
        username: ctx.participant.username,
        isTyping: !!isTyping,
      });
    });

    // ---------------- emoji reactions (ephemeral, broadcast only) ----------------
    socket.on('reaction', ({ emoji }) => {
      const ctx = resolveParticipant(socket);
      if (!ctx || !emoji) return;
      socket.to(ctx.room.code).emit('reaction', {
        id: uuidv4(),
        emoji: String(emoji).slice(0, 8),
        username: ctx.participant.username,
        userId: ctx.participant.id,
      });
    });

    // ---------------- control requests ----------------
    socket.on('control_request', ({ action, payload, note }, ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) return ack({ ok: false, error: 'Not in a room' });
      if (ctx.participant.canControl()) return ack({ ok: false, error: 'You can already control playback' });
      if (!['play', 'pause', 'seek', 'change_video'].includes(action)) return ack({ ok: false, error: 'Invalid action' });
      const request = {
        id: uuidv4(), action, payload: payload || {},
        note: (note || '').slice(0, 120), from: ctx.participant.toJSON(), at: Date.now(),
      };
      ctx.room.controlRequests.set(request.id, request);
      ctx.room.broadcastToPrivileged(io, 'control_requested', request);
      ack({ ok: true, requestId: request.id });
    });

    socket.on('control_decision', ({ requestId, approved }, ack = () => {}) => {
      const ctx = requireControl(socket, ack);
      if (!ctx) return;
      const request = ctx.room.controlRequests.get(requestId);
      if (!request) return ack({ ok: false, error: 'Request not found' });
      ctx.room.controlRequests.delete(requestId);
      if (approved) {
        const { action, payload } = request;
        if (action === 'play') ctx.room.setPlaying();
        else if (action === 'pause') ctx.room.setPaused(payload.time ?? ctx.room.getState().currentTime);
        else if (action === 'seek' && typeof payload.time === 'number') ctx.room.setSeek(payload.time);
        else if (action === 'change_video' && payload.videoId) ctx.room.setVideo(payload.videoId);
        manager.schedulePersist(ctx.room);
        ctx.room.broadcast(io, 'sync_state', ctx.room.getState());
      }
      ctx.room.broadcastToPrivileged(io, 'control_resolved', { requestId, approved: !!approved, from: request.from });
      const requesterSocketId = socketIdOf(ctx.room, request.from.id);
      if (requesterSocketId) io.to(requesterSocketId).emit('control_resolved', { requestId, approved: !!approved });
      ack({ ok: true });
    });

    // ---------------- state pull ----------------
    socket.on('get_state', (ack = () => {}) => {
      const ctx = resolveParticipant(socket);
      if (!ctx) return ack({ ok: false });
      ack({ ok: true, state: ctx.room.getState(), participants: ctx.room.listParticipants(), queue: ctx.room.listQueue() });
    });
  });
}

module.exports = { registerSocketHandlers };
