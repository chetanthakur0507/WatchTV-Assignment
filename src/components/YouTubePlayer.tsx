'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { PlaybackState } from '../lib/types';

export interface PlayerHandle {
  /** Apply a server-broadcast state (remote change) without echoing it back. */
  applyState: (s: PlaybackState) => void;
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  getTime: () => number;
  getDuration: () => number;
  isPlaying: () => boolean;
}

interface Props {
  initialVideoId: string | null;
  /** Fired when the *user* presses play inside the YouTube player itself. */
  onUserPlay: () => void;
  /** Fired when the *user* pauses inside the player. */
  onUserPause: (time: number) => void;
  /** Fired when the *user* scrubs inside the player. */
  onUserSeek: (time: number) => void;
  /** Fired when the video finishes playing. */
  onVideoEnded: () => void;
  onReady?: () => void;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Load the YouTube IFrame API exactly once per page load.
let apiPromise: Promise<void> | null = null;
function loadYouTubeAPI(): Promise<void> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}

const SUPPRESS_MS = 900; // ignore player events right after a programmatic call

const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { initialVideoId, onUserPlay, onUserPause, onUserSeek, onVideoEnded, onReady },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const suppressUntil = useRef(0);
  const lastPollTime = useRef(0);
  const callbacks = useRef({ onUserPlay, onUserPause, onUserSeek, onVideoEnded, onReady });
  callbacks.current = { onUserPlay, onUserPause, onUserSeek, onVideoEnded, onReady };

  const suppressed = () => Date.now() < suppressUntil.current;
  const bumpSuppress = () => {
    suppressUntil.current = Date.now() + SUPPRESS_MS;
  };

  useImperativeHandle(ref, () => ({
    applyState(s: PlaybackState) {
      const p = playerRef.current;
      if (!p?.loadVideoById) return;
      bumpSuppress();
      const currentId = p.getVideoData?.()?.video_id;
      if (s.videoId && s.videoId !== currentId) {
        p.loadVideoById({ videoId: s.videoId, startSeconds: Math.max(0, s.currentTime) });
        if (s.playState === 'paused') {
          setTimeout(() => {
            if (!suppressed()) return;
            try {
              p.pauseVideo();
            } catch { /* noop */ }
          }, 1200);
        }
        lastPollTime.current = s.currentTime;
        return;
      }
      if (!s.videoId) return;
      const drift = Math.abs((p.getCurrentTime?.() ?? 0) - s.currentTime);
      if (drift > 1.5) {
        try {
          p.seekTo(s.currentTime, true);
        } catch { /* noop */ }
      }
      try {
        if (s.playState === 'playing') p.playVideo();
        else p.pauseVideo();
      } catch { /* noop */ }
      lastPollTime.current = s.currentTime;
    },
    play() {
      bumpSuppress();
      playerRef.current?.playVideo?.();
    },
    pause() {
      bumpSuppress();
      playerRef.current?.pauseVideo?.();
    },
    seekTo(t: number) {
      bumpSuppress();
      try {
        playerRef.current?.seekTo?.(t, true);
      } catch { /* noop */ }
      lastPollTime.current = t;
    },
    getTime() {
      try {
        return playerRef.current?.getCurrentTime?.() ?? 0;
      } catch {
        return 0;
      }
    },
    getDuration() {
      try {
        return playerRef.current?.getDuration?.() ?? 0;
      } catch {
        return 0;
      }
    },
    isPlaying() {
      try {
        return playerRef.current?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;
      } catch {
        return false;
      }
    },
  }), []);

  useEffect(() => {
    let disposed = false;
    let poll: ReturnType<typeof setInterval> | null = null;

    loadYouTubeAPI().then(() => {
      if (disposed || !mountRef.current) return;
      const player = new window.YT.Player(mountRef.current, {
        width: '100%',
        height: '100%',
        videoId: initialVideoId ?? undefined,
        playerVars: { rel: 0, modestbranding: 1, autoplay: 0 },
        events: {
          onReady: () => callbacks.current.onReady?.(),
          onStateChange: (e: any) => {
            if (suppressed()) return;
            const YTState = window.YT.PlayerState;
            if (e.data === YTState.PLAYING) callbacks.current.onUserPlay();
            else if (e.data === YTState.PAUSED) {
              const t = playerRef.current?.getCurrentTime?.() ?? 0;
              lastPollTime.current = t;
              callbacks.current.onUserPause(t);
            } else if (e.data === YTState.ENDED) {
              callbacks.current.onVideoEnded();
            }
          },
        },
      });
      playerRef.current = player;

      // YouTube has no "seek" event, so poll for user scrubbing.
      poll = setInterval(() => {
        const p = playerRef.current;
        if (!p?.getCurrentTime || suppressed()) {
          try {
            lastPollTime.current = p?.getCurrentTime?.() ?? lastPollTime.current;
          } catch { /* noop */ }
          return;
        }
        let t = 0;
        let playing = false;
        try {
          t = p.getCurrentTime();
          playing = p.getPlayerState() === window.YT.PlayerState.PLAYING;
        } catch { /* noop */ }
        if (playing && Math.abs(t - lastPollTime.current) > 2) {
          lastPollTime.current = t;
          callbacks.current.onUserSeek(t);
        } else {
          lastPollTime.current = t;
        }
      }, 500);
    });

    return () => {
      disposed = true;
      if (poll) clearInterval(poll);
      try {
        playerRef.current?.destroy?.();
      } catch { /* noop */ }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="player-wrap">
      <div ref={mountRef} className="player-mount" />
    </div>
  );
});

export default YouTubePlayer;
