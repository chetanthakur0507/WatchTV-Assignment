
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');
const { connectDB } = require('./server/db');
const { registerSocketHandlers } = require('./server/socketHandler');

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(async () => {
    await connectDB();

    const httpServer = createServer((req, res) => {
      const parsedUrl = parse(req.url, true);
      handle(req, res, parsedUrl);
    });

    const io = new Server(httpServer, {
      cors: { origin: process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${port}` },
    });
    
    registerSocketHandlers(io);

    httpServer.listen(port, () => {
      console.log(`🚀 WatchParty ready on http://localhost:${port} (${dev ? 'dev' : 'prod'})`);
    });

  })
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
