/**
 * MongoDB connection + Mongoose schemas.
 *
 * Collections:
 *   rooms     - persistent room state (video, playback, queue, host)
 *   chats     - chat history per room (trimmed to last 100)
 *
 * Participants are intentionally NOT persisted: they are live socket-bound
 * sessions. Rooms themselves survive restarts (bonus: "persistent rooms").
 */
const mongoose = require('mongoose');

let connected = false;

async function connectDB() {
  if (connected) return mongoose;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set — copy .env.example to .env first');
  }
  await mongoose.connect(uri);
  connected = true;
  console.log('✅ MongoDB connected');
  return mongoose;
}

const queueItemSchema = new mongoose.Schema(
  {
    videoId: { type: String, required: true },
    addedBy: { type: String, required: true }, // participant userId
    addedByName: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const roomSchema = new mongoose.Schema({
  code: { type: String, unique: true, index: true },
  videoId: { type: String, default: null },
  playState: { type: String, enum: ['playing', 'paused'], default: 'paused' },
  currentTime: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
  hostUserId: { type: String, default: null },
  queue: { type: [queueItemSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  lastActiveAt: { type: Date, default: Date.now },
});

const chatSchema = new mongoose.Schema({
  roomCode: { type: String, index: true },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  role: { type: String, required: true },
  text: { type: String, required: true },
  at: { type: Date, default: Date.now },
});

const RoomModel = mongoose.models.Room || mongoose.model('Room', roomSchema);
const ChatModel = mongoose.models.Chat || mongoose.model('Chat', chatSchema);

module.exports = { connectDB, RoomModel, ChatModel };
