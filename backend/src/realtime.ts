import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { Auth, hashSecret } from './auth.js';
import type { DomainEvent } from './contracts.js';

export function createRealtime(server: HttpServer, auth: Auth, origins: string[]) {
  const io = new Server(server, {
    cors: { origin: origins, credentials: false },
    allowRequest: (req, done) => done(null, !req.headers.origin || origins.includes(req.headers.origin)),
  });
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token as unknown;
      if (token !== undefined && typeof token !== 'string') return next(new Error('INVALID_SESSION'));
      socket.data.token = token;
      socket.data.actor = auth.resolve(token);
      next();
    } catch {
      next(new Error('SESSION_EXPIRED'));
    }
  });
  io.on('connection', (socket) => {
    socket.join('public');
    if (socket.data.actor) {
      socket.join(`user:${socket.data.actor.id}`);
      socket.join(`session:${hashSecret(socket.data.token)}`);
    }
    socket.emit('sync.required', {
      reason: 'connected',
      refetch: ['bootstrap', 'catalog', 'dashboard', 'scoreboard'],
    });
  });
  const timer = setInterval(() => {
    for (const socket of io.sockets.sockets.values()) {
      try {
        auth.resolve(socket.data.token);
      } catch {
        socket.disconnect(true);
      }
    }
  }, 30000);
  timer.unref();
  return {
    io,
    emit(event: DomainEvent) {
      const rooms = event.visibility === 'public' ? ['public'] : event.userIds.map((id) => `user:${id}`);
      const data = {
        type: event.type,
        taskId: event.taskId,
        entityId: event.entityId,
        version: event.version,
        invalidate: event.invalidate,
      };
      io.to(rooms).emit('invalidate', data);
      io.to(rooms).emit(event.type, data);
    },
    revoke(token: string) {
      io.in(`session:${hashSecret(token)}`).disconnectSockets(true);
    },
    async close() {
      clearInterval(timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
