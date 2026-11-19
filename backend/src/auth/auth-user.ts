import type { Role } from '../users/role.js';

/** The signed-in user, attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
