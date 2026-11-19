import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { hashPassword, verifyPassword } from '../users/password.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth-user.js';
import type { LoginDto } from './dto/login.schema.js';
import { SessionsRepository } from './sessions.repository.js';
import { generateToken, hashToken } from './token.js';

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: Date;
  user: Omit<AuthUser, 'sessionId'>;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionTtlMs: number;
  /** Hash checked when the email is unknown, so both cases take the same time. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    config: ConfigService<Env, true>,
  ) {
    this.sessionTtlMs = config.get('SESSION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000;
  }

  /**
   * `replacedToken` is the session cookie the browser already had, if any.
   * A browser holds one session at a time, so a successful login ends that
   * session instead of leaving it valid but unreachable.
   */
  async login(
    dto: LoginDto,
    meta: { userAgent?: string; ipAddress?: string },
    replacedToken?: string,
  ): Promise<LoginResult> {
    const creds = await this.users.findCredentialsByEmail(dto.email);
    if (!creds) {
      // Spend the same time as a real check, so response time doesn't reveal
      // which emails are registered.
      this.dummyHash ??= hashPassword('timing-equaliser-not-a-real-password');
      await verifyPassword(dto.password, await this.dummyHash);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!(await verifyPassword(dto.password, creds.passwordHash))) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!creds.isActive) throw new ForbiddenException('Account is deactivated');

    const token = generateToken();
    const session = await this.sessions.create({
      userId: creds.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.sessionTtlMs),
      ...meta,
    });
    await this.users.touchLastLogin(creds.id);
    if (replacedToken) await this.sessions.revokeByTokenHash(hashToken(replacedToken));

    const user = await this.users.findById(creds.id);
    this.logger.log(`User ${creds.id} logged in (session ${session.id})`);
    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresAt: session.expiresAt,
      user: { id: user!.id, email: user!.email, fullName: user!.fullName, role: user!.role },
    };
  }

  /** Resolves a bearer token to its user, or null if the token is unknown, expired, revoked or the user is deactivated. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const session = await this.sessions.findActive(hashToken(token), new Date());
    const user = session?.user;
    if (!session || !user || !user.isActive) return null;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sessionId: session.id,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
