export type Role = 'host' | 'moderator' | 'participant';

export interface ParticipantInfo {
  id: string;
  username: string;
  role: Role;
  joinedAt: number;
}

export interface PlaybackState {
  videoId: string | null;
  playState: 'playing' | 'paused';
  currentTime: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  role: Role;
  text: string;
  at: number;
}

export interface QueueItem {
  id: string;
  videoId: string;
  addedBy: string;
  addedByName: string;
  addedAt: string | number;
}

export type ControlAction = 'play' | 'pause' | 'seek' | 'change_video';

export interface ControlRequest {
  id: string;
  action: ControlAction;
  payload: Record<string, unknown>;
  note: string;
  from: ParticipantInfo;
  at: number;
}

export interface Reaction {
  id: string;
  emoji: string;
  username: string;
  userId: string;
}

export interface JoinAck {
  ok: boolean;
  error?: string;
  roomCode?: string;
  you?: ParticipantInfo;
  participants?: ParticipantInfo[];
  state?: PlaybackState;
  queue?: QueueItem[];
  chat?: ChatMessage[];
}

/** Pull a YouTube video id out of any common URL / share-link form. */
export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m) return m[1];
  }
  return null;
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) code += chars[buf[i] % chars.length];
  return code;
}

export const REACTION_EMOJIS = ['❤️', '😂', '😮', '👏', '🔥', '😢', '🎉', '👍'];
