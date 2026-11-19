import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import type { Role } from '../users/role.js';
import { hashPassword, verifyPassword } from '../users/password.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AccessTokenClaims, AuthUser } from './auth-user.js';
import type { LoginDto } from './dto/login.schema.js';
import { SessionsRepository } from './sessions.repository.js';
import { generateToken, hashToken } from './token.js';

export const JWT_ISSUER = 'cloudpulse';
export const JWT_AUDIENCE = 'cloudpulse-api';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
}

/** What login and refresh hand back. The controller puts the tokens in cookies. */
export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  sessionExpiresAt: Date;
  /** "Remember me": the cookies should survive browser restarts. */
  remember: boolean;
  user: SessionUser;
}

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly sessionTtlMs: number;
  private readonly rememberTtlMs: number;
  private readonly accessTtlMs: number;
  /** Hash checked when the email is unknown, so both cases take the same time. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.sessionTtlMs = config.get('SESSION_TTL_HOURS', { infer: true }) * 3_600_000;
    this.rememberTtlMs = config.get('REMEMBER_ME_DAYS', { infer: true }) * 86_400_000;
    this.accessTtlMs = config.get('ACCESS_TOKEN_TTL_MINUTES', { infer: true }) * 60_000;
  }

  /**
   * Checks the password and starts a new session. A browser can keep several
   * accounts signed in (one session each); the controller decides which
   * existing sessions this one replaces.
   */
  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedTokens> {
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

    const refreshToken = generateToken();
    const session = await this.sessions.create({
      userId: creds.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + (dto.rememberMe ? this.rememberTtlMs : this.sessionTtlMs)),
      remember: dto.rememberMe,
      ...meta,
    });
    await this.users.touchLastLogin(creds.id);

    const user = (await this.users.findById(creds.id))!;
    this.logger.log(`User ${user.id} logged in (session ${session.id})`);
    return this.issue(toSessionUser(user), session.id, refreshToken, session.expiresAt, session.remember);
  }

  /**
   * Exchanges a refresh token for a new access token and a new refresh token
   * (rotation: each refresh token works once). The new access token carries the
   * user's current role, so a promotion or demotion shows up here.
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const currentHash = hashToken(refreshToken);
    const session = await this.sessions.findActiveByRefreshHash(currentHash, new Date());
    const user = session?.user;
    if (!session || !user) throw new UnauthorizedException('Session expired. Please log in again.');
    if (!user.isActive) {
      await this.sessions.revoke(session.id);
      throw new UnauthorizedException('Account is deactivated');
    }

    const nextRefreshToken = generateToken();
    if (!(await this.sessions.rotate(session.id, currentHash, hashToken(nextRefreshToken)))) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    // The session keeps its absolute expiry and its "Remember me" choice.
    return this.issue(toSessionUser(user), session.id, nextRefreshToken, session.expiresAt, session.remember);
  }

  /** Verifies an access token's signature, expiry, issuer and audience. Null if invalid. */
  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: ['HS256'],
      });
      return { id: claims.sub, sessionId: claims.sid, role: claims.role, email: claims.email, fullName: claims.name };
    } catch {
      return null;
    }
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  /**
   * Who a saved refresh token belongs to, without using it up (no rotation).
   * Null if the session has ended or the user was deactivated.
   */
  async describeSession(refreshToken: string): Promise<SessionUser | null> {
    const session = await this.sessions.findActiveByRefreshHash(hashToken(refreshToken), new Date());
    const user = session?.user;
    return user?.isActive ? toSessionUser(user) : null;
  }

  async logoutByRefreshToken(refreshToken: string): Promise<void> {
    await this.sessions.revokeByRefreshHash(hashToken(refreshToken));
  }

  private async issue(
    user: SessionUser,
    sessionId: string,
    refreshToken: string,
    sessionExpiresAt: Date,
    remember: boolean,
  ): Promise<IssuedTokens> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      sid: sessionId,
      role: user.role,
      email: user.email,
      name: user.fullName,
    };
    const accessToken = await this.jwt.signAsync(claims, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithm: 'HS256',
      expiresIn: Math.floor(this.accessTtlMs / 1000),
    });
    return {
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + this.accessTtlMs),
      refreshToken,
      sessionExpiresAt,
      remember,
      user,
    };
  }
}

function toSessionUser(u: SessionUser): SessionUser {
  return { id: u.id, email: u.email, fullName: u.fullName, role: u.role };
}
