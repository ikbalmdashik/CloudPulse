export const ROLES = ["OPERATOR", "SUPERVISOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** The signed-in user, from `GET /auth/me`. */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

/** A user as the API returns it (never includes the password hash). */
export interface User extends SessionUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
