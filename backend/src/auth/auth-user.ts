import type { Role } from '../users/role.js';

/** The signed-in user, attached to the request by AuthGuard from the access token. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

/** Claims carried in an access token (JWT). `sub` is the user id, `sid` the session id. */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: Role;
  email: string;
  name: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
