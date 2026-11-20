import { Injectable } from '@nestjs/common';
import { RealtimeGateway, STAFF_ROOM, userRoom } from './realtime.gateway.js';

/** Server → client event names. Keep in sync with frontend/src/lib/realtime.ts. */
export const EVENTS = {
  /** A request was created or changed. Payload: `{ request, event }`. */
  requestChanged: 'request.changed',
  /** The user's role or session changed: get a fresh access token. */
  sessionChanged: 'session.changed',
} as const;

/** What the rest of the app uses to push live updates. */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  /** To every supervisor and admin, and to the operator who submitted the request. */
  requestChanged(operatorId: string, payload: { request: unknown; event: unknown }): void {
    this.gateway.server?.to([STAFF_ROOM, userRoom(operatorId)]).emit(EVENTS.requestChanged, payload);
  }

  /**
   * After a promotion or demotion: tell that user's tabs, then drop their
   * sockets. They reconnect with a fresh token, so they join (or leave) the
   * staff room according to their new role.
   */
  userRoleChanged(userId: string): void {
    const room = userRoom(userId);
    this.gateway.server?.to(room).emit(EVENTS.sessionChanged);
    this.gateway.server?.in(room).disconnectSockets(true);
  }

  /**
   * After a deactivation: the same notice and disconnect. Their sessions are
   * already revoked, so the tabs' token renewal fails and they are signed out.
   */
  userDeactivated(userId: string): void {
    this.userRoleChanged(userId);
  }
}
