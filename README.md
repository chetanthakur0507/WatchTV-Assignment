# WatchParty — YouTube Watch Party System (Next.js + MongoDB Edition)

Watch YouTube videos together in real time. Create a room, share the link, and
everyone's playback (play / pause / seek / video changes) stays locked together
via WebSockets. Rooms support roles — **Host**, **Moderator**, **Participant** —
with server-side permission enforcement, plus live chat, emoji reactions, a
shared video queue with auto-advance, and typing indicators.

Built for the **Web3Task Full Stack Intern assessment**
(Intern Assignment: YouTube Watch Party System).

**Live demo:** _(paste your deployed URL here after deploying)_
`https://your-app.onrender.com`

---

## Tech stack

| Layer     | Technology                                              |
|-----------|---------------------------------------------------------|
| Framework | Next.js 14 (App Router) + TypeScript + React 18         |
| Real-time | Socket.IO (custom `server.js`: Next + Socket.IO, one port) |
| Backend   | Node.js (custom server), Mongoose ODM                   |
| Database  | MongoDB (rooms, video queue, chat history — persistent) |
| Video     | YouTube IFrame Player API                               |

One `node server.js` runs everything — the Next.js app, the Socket.IO server
and the MongoDB connection. One deploy, one URL.

## Project structure

```
watch-party-next/
├── server.js                 # custom server: Next + Socket.IO + MongoDB boot
├── .env / .env.example       # MONGODB_URI, PORT, NEXT_PUBLIC_APP_URL
├── server/
│   ├── db.js                 # mongoose connection + Room / Chat schemas
│   ├── roomManager.js        # OOP: Participant, Room, RoomManager (+ persistence)
│   └── socketHandler.js      # all Socket.IO events + permission checks
└── src/
    ├── app/
    │   ├── page.tsx          # landing: create / join room
    │   ├── room/[code]/page.tsx  # the watch party room
    │   ├── layout.tsx
    │   └── globals.css
    ├── components/
    │   └── YouTubePlayer.tsx # IFrame API wrapper + sync logic
    └── lib/
        ├── socket.ts         # Socket.IO singleton
        └── types.ts          # shared types + YouTube URL parser
```

---

## Run locally

**Prerequisites:** Node.js 18+, and MongoDB running locally
(`mongod --dbpath /data/db`, or MongoDB Compass / Atlas — just set the URI).

```bash
# 1. env
cp .env.example .env
# .env already has: MONGODB_URI=mongodb://localhost:27017/watchparty

# 2. install + dev
npm install
npm run dev            # http://localhost:3000

# production build
npm run build
npm start              # NODE_ENV=production node server.js
```

Open `http://localhost:3000`, create a room, copy the link, open it in a second
browser / incognito window with another name — both players stay in sync.
Refresh the page: the room, chat and queue are restored from MongoDB.

---

## Deploy (Render)

1. Push this repo to GitHub (**do not commit `.env`** — `.env.example` is the template).
2. Create a MongoDB database: [MongoDB Atlas](https://www.mongodb.com/atlas) free
   tier works (whitelist `0.0.0.0/0` or use Render's outbound IPs), or Render's
   managed MongoDB.
3. On [Render](https://render.com) → **New → Web Service** → connect the repo:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Environment variables:**
     - `MONGODB_URI` = your Atlas connection string
     - `NEXT_PUBLIC_APP_URL` = `https://<your-service>.onrender.com`
4. Deploy → live at `https://<your-service>.onrender.com`. Paste it at the top of
   this README.

---

## How it works (architecture overview)

```
┌──────────────┐  join_room / play / pause / seek / change_video     ┌───────────────────┐
│  Next.js     │  queue_add / chat / reaction / typing / assign_role │  server.js        │
│  (App Router)│ ─────────────────────────────────────────────────▶  │  Next + Socket.IO │
│              │ ◀─────────────────────────────────────────────────  │                   │
│  YouTube     │  sync_state / queue_updated / chat_message /         │  RoomManager      │
│  IFrame API  │  reaction / user_typing / role_assigned              │  (OOP + MongoDB)  │
└──────────────┘                                                     └────────┬──────────┘
                                                                              │ persist
                                                                     ┌────────▼──────────┐
                                                                     │     MongoDB       │
                                                                     │ rooms · chats     │
                                                                     └───────────────────┘
```

1. **Boot:** `server.js` connects to MongoDB, then serves Next.js and Socket.IO
   on the same HTTP server / port.
2. **Join:** client emits `join_room { roomCode, username }`. `RoomManager`
   loads the room from MongoDB (or creates it); the first joiner becomes **Host**,
   others become **Participant**. The ack carries `{ you, participants, state,
   queue, chat }` so late joiners and refreshers instantly catch up.
3. **Control:** Host/Moderator actions are **validated on the server**
   (`Participant.canControl()`) before `Room` updates state and broadcasts
   `sync_state { videoId, playState, currentTime }`. Unauthorized attempts are
   rejected and the client resyncs via `get_state`.
4. **Sync:** each client applies the state to its YouTube player — loads a new
   video id, seeks if drift > 1.5 s, plays/pauses. A `suppressUntil` guard stops
   applied changes from echoing back (no feedback loops). The server stores
   `(currentTime, updatedAt)` and extrapolates while playing, so joiners land at
   the right position.
5. **Persistence:** room state + queue persist to MongoDB on a debounce (800 ms);
   chat messages are saved per message (trimmed to the newest 100 per room).
   When the last user leaves, the final state is flushed — the room survives
   restarts (bonus: *persistent rooms*).
6. **Roles:** Host can `assign_role` (Participant ↔ Moderator),
   `remove_participant`, `transfer_host`. If the host disconnects, the role
   auto-transfers to the oldest moderator (else oldest participant).
7. **Control requests:** a Participant sends `control_request { action, payload }`;
   Host/Mods approve/decline in the UI. On approval the **server** executes the
   action itself — permissions are never bypassed.
8. **Queue ("Up next"):** anyone can `queue_add` (participants = suggestions);
   host/mod can `queue_play` / `queue_remove`. When a video ends, the host
   client emits `video_ended` and the server auto-advances the queue.
9. **Reactions & typing:** ephemeral broadcasts — floating emoji animations over
   the player, and "X is typing…" in chat.

### WebSocket events

| Event | Direction | Purpose |
|---|---|---|
| `join_room` | C→S | `{ roomCode, username }` — create or join (persistent) |
| `leave_room` | C→S | leave the room |
| `play` / `pause` / `seek` / `change_video` | C→S | host/mod playback control |
| `video_ended` | C→S | host/mod: auto-advance the queue |
| `queue_add` / `queue_remove` / `queue_play` | C→S | shared "Up next" queue |
| `assign_role` | C→S | host: `{ userId, role }` |
| `transfer_host` | C→S | host passes the host role |
| `remove_participant` | C→S | host: `{ userId }` |
| `chat_message` | C→S | everyone (persisted) |
| `typing` | C→S | typing indicator |
| `reaction` | C→S | emoji reaction (ephemeral) |
| `control_request` / `control_decision` | C→S | participant asks, host/mod approves |
| `sync_state` | S→C | `{ videoId, playState, currentTime }` broadcast |
| `queue_updated` | S→C | `{ queue }` broadcast |
| `user_joined` / `user_left` | S→C | participant list updates |
| `role_assigned` / `participant_removed` | S→C | role/removal updates |
| `removed` | S→C | sent to the removed socket only |
| `chat_message` | S→C | broadcast chat |
| `user_typing` | S→C | typing indicator |
| `reaction` | S→C | broadcast emoji |
| `control_requested` / `control_resolved` | S→C | request lifecycle |
| `error` | S→C | rejection reason (client resyncs) |

---

## Code walkthrough notes (for the review)

- **Why a custom `server.js`?** Next.js API routes can't hold a long-lived
  Socket.IO server cleanly in App Router; one custom server keeps Next +
  WebSockets on a single port, which also makes Render deployment trivial.
- **Socket.IO rooms:** `socket.join(roomCode)` puts each connection in a
  room-scoped channel; `io.to(roomCode).emit(...)` broadcasts to exactly that room.
- **OOP:** `Participant` (role + `canControl()`), `Room` (participants, playback
  state, queue, broadcast helpers), `RoomManager` (MongoDB load/save, debounced
  persistence). The handler file only wires events to these methods.
- **Role enforcement:** the UI disables buttons for participants, but the real
  gate is server-side — every control event is permission-checked.
- **YouTube sync:** the IFrame API has no seek event, so the player polls every
  500 ms; a jump > 2 s while playing counts as a user scrub.
- **MongoDB schema:** `rooms` (one doc per room code: video, playState,
  currentTime, queue, hostUserId), `chats` (one doc per message, trimmed to 100
  per room). Participants stay in memory — they're live socket sessions.
- **Trade-offs:** debounced persistence means a crash within ~1 s of a seek could
  lose that exact position (chat is always safe — saved immediately). Horizontal
  scaling would need Redis pub/sub between server instances (noted as next step).

## Tests

`next build` passes (webpack + `tsc --noEmit` clean). The WebSocket + MongoDB
flow was verified against a real MongoDB with an automated script: 14 checks —
join/roles, sync broadcast, role rejection, queue suggest/play/auto-advance,
reactions, typing, persisted chat, promote, control-request approval, host
auto-transfer, landing page serve, and **room state surviving a server restart**.
#   W a t c h T V - A s s i g n m e n t  
 