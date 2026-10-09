'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

/**
 * Singleton Socket.IO client.
 * The custom Next server (server.js) serves Socket.IO on the same origin,
 * so in both dev and production we just connect to window.location.origin.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
