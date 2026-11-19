import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AuthUser } from '../auth/auth-user.js';
import { AuthService } from '../auth/auth.service.js';
import { readAccessToken } from '../auth/session-cookie.js';
import type { Role } from '../users/role.js';

/** Room every supervisor and admin joins: they see every request. */
export const STAFF_ROOM = 'staff';
export const STAFF_ROLES: readonly Role[] = ['SUPERVISOR', 'ADMIN'];
export const userRoom = (userId: string) => `user:${userId}`;

/** Reason sent with `connect_error` when the access token is missing or expired. */
export const UNAUTHORIZED = 'unauthorized';

interface SocketData {
  user: AuthUser;
  expiryTimer?: NodeJS.Timeout;
}

/**
 * Pushes live updates to browsers over WebSockets (Socket.IO), on the same
 * port as the REST API. Server → client only: clients change things through
 * the REST API, which validates and authorizes every write, and the gateway
 * fans the result out.
 *
 * Who receives what:
 *  - `user:<id>` — every socket of one user (their own requests, session notices)
 *  - `staff`     — supervisors and admins (every request)
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly auth: AuthService) {}

  /** Authenticates each connection with the same access token (JWT) the REST API uses. */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token =
        (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined) ??
        readAccessToken({ headers: socket.handshake.headers });
      if (!token) return next(new Error(UNAUTHORIZED));
      void this.auth.verifyAccessToken(token).then((user) => {
        if (!user) return next(new Error(UNAUTHORIZED));
        (socket.data as SocketData).user = user;
        next();
      }, next);
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SocketData;
    const { user } = data;
    await socket.join(userRoom(user.id));
    if (STAFF_ROLES.includes(user.role)) await socket.join(STAFF_ROOM);

    // A JWT can't be revoked, so don't let a socket outlive its token: when it
    // expires, disconnect; the client refreshes and reconnects with a new one.
    const expiresInMs = this.tokenExpiryMs(socket);
    if (expiresInMs !== undefined) {
      data.expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, expiresInMs));
    }
    this.logger.debug(`Socket ${socket.id} connected for user ${user.id} (${user.role})`);
  }

  handleDisconnect(socket: Socket): void {
    clearTimeout((socket.data as SocketData).expiryTimer);
  }

  private tokenExpiryMs(socket: Socket): number | undefined {
    const token =
      (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined) ??
      readAccessToken({ headers: socket.handshake.headers });
    const payload = token?.split('.')[1];
    if (!payload) return undefined;
    try {
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number };
      return exp ? exp * 1000 - Date.now() : undefined;
    } catch {
      return undefined;
    }
  }
}
