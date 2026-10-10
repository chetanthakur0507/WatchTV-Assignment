# 🎬 WatchParty — YouTube Watch Party System 

Watch YouTube videos together in real time! Create a room, share the link, and enjoy synchronized playback across all participants. Play, pause, seek, and change videos while everyone stays in sync using WebSockets.

Rooms support three roles — **Host, Moderator, and Participant** — with server-side permission enforcement, live chat, emoji reactions, a shared video queue, automatic video advancement, and typing indicators.

Built using **Next.js, Socket.IO, Node.js, and MongoDB**.

**Live Demo:** [WatchParty Application](https://watchtv-assignment.onrender.com/)

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Framework | Next.js 14 (App Router) |
| Frontend | React 18 + TypeScript |
| Real-Time Communication | Socket.IO |
| Backend | Node.js + Custom Server |
| Database | MongoDB |
| ODM | Mongoose |
| Video Player | YouTube IFrame Player API |
| Deployment | Render |

The application uses a custom Node.js server to run Next.js and Socket.IO on the same HTTP server. MongoDB stores room information, video queue data, and chat history.

---

## Project Structure

```text
watch-party-next/
├── server.js
├── package.json
├── .env.example
├── .gitignore
│
├── server/
│   ├── db.js
│   ├── roomManager.js
│   └── socketHandler.js
│
└── src/
    ├── app/
    │   ├── page.tsx
    │   ├── room/
    │   │   └── [code]/
    │   │       └── page.tsx
    │   ├── layout.tsx
    │   └── globals.css
    │
    ├── components/
    │   └── YouTubePlayer.tsx
    │
    └── lib/
        ├── socket.ts
        └── types.ts
```

---

## Run Locally

**Prerequisites:** Node.js 18+ and a running MongoDB instance, either locally or through MongoDB Atlas.

### 1. Clone the Repository

```bash
git clone <https://github.com/chetanthakur0507/WatchTV-Assignment>
cd watch-party-next
```

### 2. Configure Environment Variables

Create a `.env` file in the project root using `.env.example` as a template.

```env
MONGODB_URI=mongodb://localhost:27017/watchparty
PORT=3000
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For MongoDB Atlas, replace the local connection string with your Atlas URI.

**Important:** Never commit `.env` or expose database credentials in a public repository.

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Development Server

```bash
npm run dev
```

Open the application at:

`http://localhost:3000`

### 5. Production Build

```bash
npm run build
npm start
```

The commands assume the corresponding scripts are configured in `package.json`.

Create a room, copy its link, and open it in another browser or an incognito window. Join with a different username to test synchronized playback.

---

## Deploy on Render

1. Push the project to GitHub.
2. Create a database using [MongoDB Atlas](https://www.mongodb.com/atlas).
3. Open [Render](https://render.com) and select **New → Web Service**.
4. Connect your GitHub repository.
5. Configure the build and start commands.

**Build Command**

```bash
npm install && npm run build
```

**Start Command**

```bash
npm start
npm run dev
```

### Environment Variables

Configure these variables in the Render dashboard:

```env
MONGODB_URI=your_mongodb_atlas_connection_string
NEXT_PUBLIC_APP_URL=https://your-app.onrender.com
```

Configure `PORT` only if required by your server setup; Render provides a port through the environment.

Deploy the application and replace the placeholder URL at the top of this README with your actual live URL.

---

## How It Works (Architecture Overview)

```text
┌────────────────────────┐
│       Next.js App      │
│   Landing Page + Room  │
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│       Socket.IO        │
│ Real-Time Communication│
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│  RoomManager           │
│  Roles + Permissions   │
│  Playback + Queue      │
└────────────┬───────────┘
             │
             ▼
┌────────────────────────┐
│        MongoDB         │
│ Rooms + Queue + Chat   │
└────────────────────────┘
```

### 1. Server Initialization

The custom `server.js` initializes the Next.js application, connects to MongoDB, and starts the Socket.IO server on the same HTTP server.

### 2. Room Creation and Joining

Users create or join a room using a unique room code. The first participant becomes the Host, while subsequent participants join with the Participant role.

### 3. Real-Time Playback Synchronization

Playback actions are communicated through Socket.IO events. The server broadcasts the current video, playback state, and position to connected participants.

### 4. Role-Based Permissions

Host and Moderator actions are validated on the server before protected operations are executed. Participants can suggest videos and request permission to control playback.

### 5. Video Queue Management

Participants can suggest videos for the shared queue. Authorized users can play or remove queued videos. The next video can start automatically when the current video ends.

### 6. Live Chat and Reactions

Socket.IO broadcasts chat messages, typing indicators, and emoji reactions to room participants.

### 7. Database Persistence

MongoDB stores room state, queue information, and chat history so saved information can be restored after page refreshes or server restarts.

---

## WebSocket Events

| Event | Direction | Purpose |
| :--- | :--- | :--- |
| `join_room` | Client → Server | Create or join a room |
| `leave_room` | Client → Server | Leave a room |
| `play` / `pause` | Client → Server | Control playback |
| `seek` | Client → Server | Change playback position |
| `change_video` | Client → Server | Switch the current video |
| `video_ended` | Client → Server | Handle video completion |
| `queue_add` | Client → Server | Add a video suggestion |
| `queue_remove` | Client → Server | Remove a queued video |
| `queue_play` | Client → Server | Play a queued video |
| `assign_role` | Client → Server | Assign a participant role |
| `transfer_host` | Client → Server | Transfer host privileges |
| `remove_participant` | Client → Server | Remove a participant |
| `chat_message` | Client ↔ Server | Exchange chat messages |
| `typing` | Client → Server | Send typing status |
| `reaction` | Client ↔ Server | Broadcast emoji reactions |
| `control_request` | Client → Server | Request playback permission |
| `control_decision` | Client → Server | Approve or reject a request |
| `sync_state` | Server → Client | Synchronize playback state |
| `queue_updated` | Server → Client | Update the shared queue |
| `user_joined` / `user_left` | Server → Client | Update participant information |
| `role_assigned` | Server → Client | Notify role changes |
| `error` | Server → Client | Communicate rejected actions |

*Event names and directions should match the actual Socket.IO handlers implemented in the project.*

---

## Code Walkthrough

- **Custom Server:** Combines the Next.js application and Socket.IO server on one HTTP server.
- **Socket.IO Rooms:** Keeps communication scoped to individual watch party rooms.
- **RoomManager:** Coordinates participants, playback state, permissions, and queue management.
- **Role Enforcement:** Validates protected actions on the server rather than relying only on disabled frontend buttons.
- **YouTube Integration:** Uses the YouTube IFrame Player API to load videos and synchronize playback.
- **MongoDB Persistence:** Stores room data, queued videos, and chat messages.
- **Scalability:** A Redis adapter can be considered if the application needs to scale across multiple Socket.IO server instances.

---

## Testing Checklist

- [ ] Create and join a watch party room.
- [ ] Verify synchronized play and pause.
- [ ] Test seeking and video changes.
- [ ] Verify role-based permissions.
- [ ] Test chat messages and typing indicators.
- [ ] Test emoji reactions.
- [ ] Add, play, and remove queued videos.
- [ ] Verify automatic queue advancement.
- [ ] Test host transfer and participant removal.
- [ ] Refresh the page and verify saved room information.
- [ ] Restart the server and verify database persistence.
- [ ] Test the production deployment.

---

## Future Improvements

- User authentication and persistent profiles
- Private rooms with access codes
- Redis-based horizontal scaling
- Improved reconnection and playback recovery
- Automated integration tests
- Enhanced mobile and PWA support

---

## Author

**Chetan Thakur**

- GitHub: [GitHub Profile](https://github.com/chetanthakur0507)
- Github Repo.: [Project Repository](https://github.com/chetanthakur0507/WatchTV-Assignment)
- Live Project: [Live Project](https://watchtv-assignment.onrender.com/)

---

## License

This project is intended for educational and portfolio purposes. Add a `LICENSE` file to define the terms under which the project can be used and distributed.

---

**Built with ❤️ using Next.js, Socket.IO, Node.js, and MongoDB.**
