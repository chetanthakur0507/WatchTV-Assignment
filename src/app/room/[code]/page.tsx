'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSocket, disconnectSocket } from '../../../lib/socket';
import YouTubePlayer, { type PlayerHandle } from '../../../components/YouTubePlayer';
import {
  REACTION_EMOJIS,
  extractVideoId,
  formatTime,
  type ChatMessage,
  type ControlRequest,
  type JoinAck,
  type ParticipantInfo,
  type PlaybackState,
  type QueueItem,
  type Reaction,
  type Role,
} from '../../../lib/types';

interface Toast {
  id: number;
  text: string;
}
interface FloatReaction {
  id: number;
  emoji: string;
  x: number;
}

let toastId = 0;
let floatId = 0;
const NAME_KEY = 'watchparty_username';

const ROLE_LABEL: Record<Role, string> = {
  host: 'Host',
  moderator: 'Moderator',
  participant: 'Participant',
};

function RoleBadge({ role }: { role: Role }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABEL[role]}</span>;
}

export default function RoomPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { name?: string };
}) {
  const code = params.code.toUpperCase();
  const router = useRouter();
  const presetName = searchParams.name ?? '';

  const [nameInput, setNameInput] = useState(presetName);
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [online, setOnline] = useState(true);

  const [me, setMe] = useState<ParticipantInfo | null>(null);
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [requests, setRequests] = useState<ControlRequest[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [floats, setFloats] = useState<FloatReaction[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'people' | 'queue' | 'chat'>('people');

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasVideo, setHasVideo] = useState(false);
  const [roomState, setRoomState] = useState<PlaybackState | null>(null);
  const roomStateRef = useRef<PlaybackState | null>(null);

  /** Single place that stores the authoritative room state (state + ref). */
  const setRoomStateBoth = useCallback((s: PlaybackState) => {
    roomStateRef.current = s;
    setRoomState(s);
    setHasVideo(!!s.videoId);
  }, []);

  const [chatInput, setChatInput] = useState('');
  const [videoInput, setVideoInput] = useState('');
  const [queueInput, setQueueInput] = useState('');
  const [showVideoInput, setShowVideoInput] = useState(false);

  const playerRef = useRef<PlayerHandle>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meRef = useRef<ParticipantInfo | null>(null);
  meRef.current = me;

  const pushToast = useCallback((text: string) => {
    const id = ++toastId;
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const showFloat = useCallback((emoji: string) => {
    const id = ++floatId;
    const x = 8 + Math.random() * 80;
    setFloats((f) => [...f.slice(-11), { id, emoji, x }]);
    setTimeout(() => setFloats((f) => f.filter((r) => r.id !== id)), 2500);
  }, []);

  const canControl = me?.role === 'host' || me?.role === 'moderator';
  const isHost = me?.role === 'host';

  // ---------- join ----------
  const doJoin = useCallback(
    (username: string) => {
      const socket = getSocket();
      setJoinError('');
      socket.emit('join_room', { roomCode: code, username }, (ack: JoinAck) => {
        if (!ack.ok) {
          setJoinError(ack.error || 'Could not join room');
          return;
        }
        try {
          localStorage.setItem(NAME_KEY, username);
        } catch { /* noop */ }
        setMe(ack.you!);
        setParticipants(ack.participants!);
        setChat(ack.chat ?? []);
        setQueue(ack.queue ?? []);
        setRoomStateBoth(ack.state!);
        // If the player is already mounted, apply immediately.
        // Otherwise onReady() applies it once the YouTube player is ready.
        playerRef.current?.applyState(ack.state!);
        setJoined(true);
        pushToast(`Joined room ${code}`);
      });
    },
    [code, pushToast, setRoomStateBoth],
  );

  useEffect(() => {
    const saved = presetName || (() => {
      try {
        return localStorage.getItem(NAME_KEY) ?? '';
      } catch {
        return '';
      }
    })();
    if (saved) {
      setNameInput(saved);
      doJoin(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- connection status ----------
  useEffect(() => {
    const s = getSocket();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    s.on('connect', on);
    s.on('disconnect', off);
    setOnline(s.connected);
    return () => {
      s.off('connect', on);
      s.off('disconnect', off);
    };
  }, []);

  // ---------- socket listeners ----------
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    const onSync = (state: PlaybackState) => {
      setRoomStateBoth(state);
      // No-op if the player isn't mounted yet — onReady() covers that case.
      playerRef.current?.applyState(state);
    };
    const onUserJoined = ({ user, participants: list }: { user: ParticipantInfo; participants: ParticipantInfo[] }) => {
      setParticipants(list);
      if (user.id !== meRef.current?.id) pushToast(`${user.username} joined`);
    };
    const onUserLeft = ({ username, participants: list }: { username: string; participants: ParticipantInfo[] }) => {
      setParticipants(list);
      pushToast(`${username} left`);
    };
    const onRoleAssigned = ({ username, role, participants: list }: { username: string; role: Role; participants: ParticipantInfo[] }) => {
      setParticipants(list);
      setMe((m) => (m ? list.find((p) => p.id === m.id) ?? m : m));
      pushToast(`${username} is now ${ROLE_LABEL[role]}`);
    };
    const onParticipantRemoved = ({ username, participants: list }: { username: string; participants: ParticipantInfo[] }) => {
      setParticipants(list);
      pushToast(`${username} was removed`);
    };
    const onRemoved = () => {
      pushToast('You were removed by the host');
      setTimeout(() => router.push('/'), 1200);
    };
    const onChatMessage = (msg: ChatMessage) => setChat((c) => [...c.slice(-99), msg]);
    const onQueueUpdated = ({ queue: q }: { queue: QueueItem[] }) => setQueue(q);
    const onReaction = (r: Reaction) => showFloat(r.emoji);
    const onUserTyping = ({ userId, username, isTyping }: { userId: string; username: string; isTyping: boolean }) => {
      setTypingUsers((t) => {
        const next = { ...t };
        if (isTyping) next[userId] = username;
        else delete next[userId];
        return next;
      });
    };
    const onControlRequested = (req: ControlRequest) => {
      setRequests((r) => [...r, req]);
      pushToast(`${req.from.username} requested: ${req.action.replace('_', ' ')}`);
    };
    const onControlResolved = ({ requestId, approved }: { requestId: string; approved: boolean }) => {
      setRequests((r) => r.filter((x) => x.id !== requestId));
      const myRole = meRef.current?.role;
      if (myRole !== 'host' && myRole !== 'moderator') {
        pushToast(approved ? 'Your request was approved ✅' : 'Your request was declined');
      }
    };
    const onError = ({ message }: { message: string }) => {
      pushToast(message);
      socket.emit('get_state', (ack: { ok: boolean; state?: PlaybackState }) => {
        if (ack.ok && ack.state) playerRef.current?.applyState(ack.state);
      });
    };

    socket.on('sync_state', onSync);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('role_assigned', onRoleAssigned);
    socket.on('participant_removed', onParticipantRemoved);
    socket.on('removed', onRemoved);
    socket.on('chat_message', onChatMessage);
    socket.on('queue_updated', onQueueUpdated);
    socket.on('reaction', onReaction);
    socket.on('user_typing', onUserTyping);
    socket.on('control_requested', onControlRequested);
    socket.on('control_resolved', onControlResolved);
    socket.on('error', onError);

    return () => {
      socket.off('sync_state', onSync);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('role_assigned', onRoleAssigned);
      socket.off('participant_removed', onParticipantRemoved);
      socket.off('removed', onRemoved);
      socket.off('chat_message', onChatMessage);
      socket.off('queue_updated', onQueueUpdated);
      socket.off('reaction', onReaction);
      socket.off('user_typing', onUserTyping);
      socket.off('control_requested', onControlRequested);
      socket.off('control_resolved', onControlResolved);
      socket.off('error', onError);
    };
  }, [joined, router, pushToast, showFloat, setRoomStateBoth]);

  useEffect(() => {
    return () => {
      getSocket().emit('leave_room');
    };
  }, []);

  // ---------- player clock ----------
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setTime(p.getTime());
      setDuration(p.getDuration());
      setPlaying(p.isPlaying());
    }, 500);
    return () => clearInterval(id);
  }, [joined]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  // ---------- playback ----------
  const resync = () => {
    getSocket().emit('get_state', (ack: { ok: boolean; state?: PlaybackState }) => {
      if (ack.ok && ack.state) playerRef.current?.applyState(ack.state);
    });
  };

  /**
   * The YouTube IFrame API loads async, so the player isn't usable the moment
   * it mounts. When it's ready, apply the latest authoritative room state —
   * this is what makes the FIRST video in an empty room actually start playing.
   */
  const handlePlayerReady = useCallback(() => {
    const s = roomStateRef.current;
    if (s?.videoId) {
      setTimeout(() => playerRef.current?.applyState(s), 300);
    }
  }, []);

  const handleTogglePlay = () => {
    if (!canControl) {
      const t = playerRef.current?.getTime() ?? 0;
      getSocket().emit(
        'control_request',
        { action: playing ? 'pause' : 'play', payload: playing ? { time: t } : {}, note: '' },
        (ack: { ok: boolean; error?: string }) => pushToast(ack.ok ? 'Request sent to host' : ack.error || 'Request failed'),
      );
      return;
    }
    if (playing) {
      const t = playerRef.current?.getTime() ?? 0;
      playerRef.current?.pause();
      getSocket().emit('pause', { time: t });
    } else {
      playerRef.current?.play();
      getSocket().emit('play');
    }
  };

  const handleUserPlay = () => {
    if (canControl) getSocket().emit('play');
    else resync();
  };
  const handleUserPause = (t: number) => {
    if (canControl) getSocket().emit('pause', { time: t });
    else resync();
  };
  const handleUserSeek = (t: number) => {
    if (canControl) getSocket().emit('seek', { time: t });
  };
  const handleVideoEnded = () => {
    // Server auto-advances to the next queued video (host/mod only)
    if (meRef.current?.role === 'host' || meRef.current?.role === 'moderator') {
      getSocket().emit('video_ended');
    }
  };

  const handleSliderChange = (t: number) => {
    setTime(t);
    if (canControl) playerRef.current?.seekTo(t);
  };
  const handleSliderCommit = (t: number) => {
    if (canControl) getSocket().emit('seek', { time: t });
  };

  const handleChangeVideo = () => {
    const videoId = extractVideoId(videoInput);
    if (!videoId) {
      pushToast('That does not look like a YouTube link');
      return;
    }
    if (canControl) getSocket().emit('change_video', { videoId });
    else
      getSocket().emit(
        'control_request',
        { action: 'change_video', payload: { videoId }, note: videoInput.slice(0, 60) },
        (ack: { ok: boolean; error?: string }) => pushToast(ack.ok ? 'Video change requested' : ack.error || 'Request failed'),
      );
    setVideoInput('');
    setShowVideoInput(false);
  };

  // ---------- queue ----------
  const addToQueue = () => {
    const videoId = extractVideoId(queueInput);
    if (!videoId) {
      pushToast('That does not look like a YouTube link');
      return;
    }
    getSocket().emit('queue_add', { videoId }, (ack: { ok: boolean; error?: string }) => {
      if (!ack.ok) pushToast(ack.error || 'Could not add to queue');
      else pushToast(canControl ? 'Added to queue' : 'Suggested! The host can play it next');
    });
    setQueueInput('');
  };

  // ---------- reactions ----------
  const sendReaction = (emoji: string) => {
    getSocket().emit('reaction', { emoji });
    showFloat(emoji);
  };

  // ---------- host / mod actions ----------
  const assignRole = (userId: string, role: Role) => {
    getSocket().emit('assign_role', { userId, role }, (ack: { ok: boolean; error?: string }) => {
      if (!ack.ok) pushToast(ack.error || 'Could not assign role');
    });
  };
  const removeUser = (userId: string, username: string) => {
    if (!window.confirm(`Remove ${username} from the room?`)) return;
    getSocket().emit('remove_participant', { userId }, (ack: { ok: boolean; error?: string }) => {
      if (!ack.ok) pushToast(ack.error || 'Could not remove user');
    });
  };
  const transferHost = (userId: string, username: string) => {
    if (!window.confirm(`Make ${username} the host? You will become a moderator.`)) return;
    getSocket().emit('transfer_host', { userId }, (ack: { ok: boolean; error?: string }) => {
      if (!ack.ok) pushToast(ack.error || 'Could not transfer host');
    });
  };
  const decideRequest = (requestId: string, approved: boolean) => {
    getSocket().emit('control_decision', { requestId, approved });
    setRequests((r) => r.filter((x) => x.id !== requestId));
  };

  // ---------- chat ----------
  const emitTyping = (isTyping: boolean) => getSocket().emit('typing', { isTyping });

  const handleChatInput = (v: string) => {
    setChatInput(v);
    emitTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitTyping(false), 1500);
  };

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    emitTyping(false);
    getSocket().emit('chat_message', { text });
    setChatInput('');
  };

  // ---------- misc ----------
  const copyLink = async () => {
    const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${base}/room/${code}`);
      pushToast('Room link copied');
    } catch {
      pushToast('Could not copy link');
    }
  };

  const leave = () => {
    getSocket().emit('leave_room');
    disconnectSocket();
    router.push('/');
  };

  const typingNames = Object.values(typingUsers);
  const typingText =
    typingNames.length === 0
      ? ''
      : typingNames.length === 1
        ? `${typingNames[0]} is typing…`
        : `${typingNames.slice(0, 2).join(', ')}${typingNames.length > 2 ? ` +${typingNames.length - 2}` : ''} are typing…`;

  // ---------- name gate ----------
  if (!joined) {
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="logo">
            <span className="logo-play">▶</span> WatchParty
          </div>
          <h2>Join room {code}</h2>
          <p className="muted">Pick a display name to enter the watch party.</p>
          <input
            className="input"
            placeholder="Your name"
            value={nameInput}
            maxLength={24}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && nameInput.trim() && doJoin(nameInput.trim())}
            autoFocus
          />
          {joinError && <p className="error">{joinError}</p>}
          <button className="btn btn-primary" disabled={!nameInput.trim()} onClick={() => doJoin(nameInput.trim())}>
            Join Room
          </button>
          <button className="btn btn-ghost" onClick={() => router.push('/')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="room">
      <header className="room-header">
        <div className="logo small">
          <span className="logo-play">▶</span> WatchParty
        </div>
        <div className="room-code" onClick={copyLink} title="Copy room link">
          <span className={`status-dot ${online ? 'on' : 'off'}`} title={online ? 'Connected' : 'Disconnected'} />
          <span className="muted">ROOM</span>
          <strong>{code}</strong>
          <span className="copy-hint">⧉ copy link</span>
        </div>
        <div className="header-right">
          {me && <RoleBadge role={me.role} />}
          <button className="btn btn-ghost" onClick={leave}>
            Leave
          </button>
        </div>
      </header>

      <div className="room-body">
        <main className="room-main">
          <div className="video-card">
            {hasVideo ? (
              <YouTubePlayer
                ref={playerRef}
                initialVideoId={roomState?.videoId ?? null}
                onReady={handlePlayerReady}
                onUserPlay={handleUserPlay}
                onUserPause={handleUserPause}
                onUserSeek={handleUserSeek}
                onVideoEnded={handleVideoEnded}
              />
            ) : (
              <div className="no-video">
                <div className="no-video-icon">🎬</div>
                <h3>No video yet</h3>
                <p className="muted">
                  {canControl ? 'Paste a YouTube link below to start the party.' : 'Waiting for the host to pick a video…'}
                </p>
              </div>
            )}
            <div className="reaction-layer">
              {floats.map((f) => (
                <span key={f.id} className="reaction-float" style={{ left: `${f.x}%` }}>
                  {f.emoji}
                </span>
              ))}
            </div>
          </div>

          <div className="reactions-bar">
            <span className="label">React:</span>
            {REACTION_EMOJIS.map((e) => (
              <button key={e} className="reaction-btn" onClick={() => sendReaction(e)} title={`Send ${e}`}>
                {e}
              </button>
            ))}
          </div>

          <div className="controls">
            <button
              className="btn btn-play"
              onClick={handleTogglePlay}
              title={canControl ? (playing ? 'Pause' : 'Play') : 'Request play/pause'}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <span className="time">{formatTime(time)}</span>
            <input
              type="range"
              className="seek"
              min={0}
              max={Math.max(duration, 1)}
              step={0.1}
              value={Math.min(time, Math.max(duration, 1))}
              disabled={!canControl || !hasVideo}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              onMouseUp={(e) => handleSliderCommit(Number((e.target as HTMLInputElement).value))}
              onTouchEnd={(e) => handleSliderCommit(Number((e.target as HTMLInputElement).value))}
              onKeyUp={(e) => handleSliderCommit(Number((e.target as HTMLInputElement).value))}
            />
            <span className="time">{formatTime(duration)}</span>
            <button
              className="btn btn-ghost"
              onClick={() => setShowVideoInput((s) => !s)}
              title={canControl ? 'Change video' : 'Request video change'}
            >
              🎞 Change video
            </button>
          </div>
          {!canControl && (
            <p className="muted control-note">
              🔒 Playback is controlled by the host{participants.some((p) => p.role === 'moderator') ? ' and moderators' : ''}.
              Use the buttons to send them a request — or suggest the next video in the Queue tab.
            </p>
          )}
          {showVideoInput && (
            <div className="video-input-row">
              <input
                className="input"
                placeholder="Paste a YouTube link…"
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleChangeVideo()}
                autoFocus
              />
              <button className="btn btn-primary" onClick={handleChangeVideo}>
                {canControl ? 'Play' : 'Request'}
              </button>
            </div>
          )}

          {canControl && requests.length > 0 && (
            <div className="requests">
              <h4>Control requests</h4>
              {requests.map((r) => (
                <div key={r.id} className="request-row">
                  <span>
                    <strong>{r.from.username}</strong> wants to <em>{r.action.replace('_', ' ')}</em>
                    {r.note && <span className="muted"> — {r.note}</span>}
                  </span>
                  <span>
                    <button className="btn btn-primary btn-sm" onClick={() => decideRequest(r.id, true)}>
                      Approve
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => decideRequest(r.id, false)}>
                      Decline
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </main>

        <aside className="sidebar">
          <div className="tabs">
            <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
              People ({participants.length})
            </button>
            <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
              Queue ({queue.length})
            </button>
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
              Chat
            </button>
          </div>

          {tab === 'people' && (
            <div className="people-list">
              {participants.map((p) => (
                <div key={p.id} className="person">
                  <div className="person-info">
                    <span className="avatar">{p.username.charAt(0).toUpperCase()}</span>
                    <span className="person-name">
                      {p.username}
                      {p.id === me?.id && <span className="muted"> (you)</span>}
                    </span>
                    <RoleBadge role={p.role} />
                  </div>
                  {isHost && p.id !== me?.id && (
                    <div className="person-actions">
                      {p.role === 'participant' ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => assignRole(p.id, 'moderator')}>
                          Make mod
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={() => assignRole(p.id, 'participant')}>
                          Demote
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => transferHost(p.id, p.username)}>
                        Make host
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeUser(p.id, p.username)}>
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'queue' && (
            <div className="queue-pane">
              <div className="queue-add">
                <input
                  className="input"
                  placeholder="Suggest a YouTube link…"
                  value={queueInput}
                  onChange={(e) => setQueueInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addToQueue()}
                />
                <button className="btn btn-primary" onClick={addToQueue}>
                  Add
                </button>
              </div>
              <div className="queue-list">
                {queue.length === 0 && (
                  <p className="muted queue-empty">
                    Queue is empty. Suggest the next video above 👆
                    <br />
                    When a video ends, the next one plays automatically.
                  </p>
                )}
                {queue.map((q, i) => (
                  <div key={q.id} className="queue-item">
                    <img
                      className="queue-thumb"
                      src={`https://i.ytimg.com/vi/${q.videoId}/mqdefault.jpg`}
                      alt=""
                      loading="lazy"
                    />
                    <div className="queue-meta">
                      <div className="queue-title">
                        #{i + 1} · {q.videoId}
                      </div>
                      <div className="queue-by">suggested by {q.addedByName}</div>
                    </div>
                    {canControl && (
                      <div className="queue-actions">
                        <button className="btn btn-primary btn-sm" onClick={() => getSocket().emit('queue_play', { queueId: q.id })}>
                          Play
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => getSocket().emit('queue_remove', { queueId: q.id })}>
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'chat' && (
            <div className="chat">
              <div className="chat-messages">
                {chat.length === 0 && <p className="muted">No messages yet. Say hi! 👋</p>}
                {chat.map((m) => (
                  <div key={m.id} className="chat-msg">
                    <span className="chat-user">
                      {m.username} <RoleBadge role={m.role} />
                    </span>
                    <span className="chat-text">{m.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="typing-indicator">{typingText}</div>
              <div className="chat-input-row">
                <input
                  className="input"
                  placeholder="Message…"
                  value={chatInput}
                  maxLength={500}
                  onChange={(e) => handleChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                />
                <button className="btn btn-primary" onClick={sendChat}>
                  Send
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
