'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { makeRoomCode } from '../lib/types';

const NAME_KEY = 'watchparty_username';

export default function Landing() {
  const router = useRouter();
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');



  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) {
      setCreateName(saved);
      setJoinName(saved);
    }
  }, []);



    const remember = (name: string) => localStorage.setItem(NAME_KEY, name);



  const createRoom = () => {
    const name = createName.trim();
    if (!name) return;
    remember(name);
    router.push(`/room/${makeRoomCode()}?name=${encodeURIComponent(name)}`);
  };



  const joinRoom = () => {
    const name = joinName.trim();
    const code = joinCode.trim().toUpperCase();
    if (!name || !code) return;

    remember(name);
    router.push(`/room/${code}?name=${encodeURIComponent(name)}`);
  };



  return (
    <div className="landing">

      <header className="landing-header">
        <div className="logo">
          <span className="logo-play">▶</span> WatchParty
        </div>
      </header>

      <main className="hero">

        <h1>
          Watch YouTube <span className="accent">together</span>,
          <br />
          in perfect sync.
        </h1>

        <p className="muted hero-sub">
          Create a room, share the link, and everyone watches the same video —
          play, pause and seek stay locked together in real time. Rooms, chat and
          the video queue are saved, so the party survives refreshes.
        </p>



        <div className="cards">

          <div className="card">

            <h3>🎬 Create a room</h3>

            <p className="muted">You&apos;ll join as the host with full control.</p>

            <input
              className="input"
              placeholder="Your name"
              value={createName}
              maxLength={24}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createRoom()}
            />

            <button className="btn btn-primary btn-block" disabled={!createName.trim()} onClick={createRoom}>
              Create Room
            </button>

          </div>

          <div className="card">

            <h3>🔗 Join a room</h3>

            <p className="muted">Got a room code? Jump straight in.</p>

            <input
              className="input"
              placeholder="Your name"
              value={joinName}
              maxLength={24}
              onChange={(e) => setJoinName(e.target.value)}
            />

            <input
              className="input code-input"
              placeholder="Room code (e.g. KX7Q2P)"
              value={joinCode}
              maxLength={6}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />

            <button
              className="btn btn-primary btn-block"
              disabled={!joinName.trim() || !joinCode.trim()}
              onClick={joinRoom}
            >
              Join Room
            </button>

          </div>
        </div>


        <div className="features">

          <div className="feature">
            <span>⚡</span>
            <strong>Real-time sync</strong>
            <p className="muted">WebSocket-powered play, pause &amp; seek for everyone.</p>
          </div>

          <div className="feature">
            <span>🛡</span>
            <strong>Roles &amp; moderation</strong>
            <p className="muted">Host, moderators and viewers with server-enforced permissions.</p>
          </div>

          <div className="feature">

            <span>💾</span>
            <strong>Persistent rooms</strong>
            <p className="muted">Rooms, chat and the video queue live in MongoDB.</p>
            
          </div>

          <div className="feature">
            <span>🎞</span>
            <strong>Video queue</strong>
            <p className="muted">Anyone can suggest the next video; the host lines it up.</p>
          </div>
        </div>
      </main>

      <footer className="landing-footer muted">
        Built with Next.js + Socket.IO + MongoDB · Web3Task Full Stack Intern assessment
      </footer>
    </div>
  );
}
