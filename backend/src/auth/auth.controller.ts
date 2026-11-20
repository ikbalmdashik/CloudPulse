import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { RateLimited } from '../common/rate-limit/rate-limit.js';
import type { Env } from '../config/env.js';
import { UsersRepository } from '../users/users.repository.js';
import type { AuthUser } from './auth-user.js';
import { AuthService, type IssuedTokens, type SessionUser } from './auth.service.js';
import { CurrentUser, Public } from './decorators.js';
import { type LoginDto, loginSchema } from './dto/login.schema.js';
import { type RefreshDto, refreshSchema } from './dto/refresh.schema.js';
import { type SwitchAccountDto, switchAccountSchema } from './dto/switch-account.schema.js';
import {
  ACCESS_COOKIE,
  ACCOUNTS_COOKIE,
  cookieOptions,
  isUserId,
  LEGACY_REFRESH_COOKIE,
  MAX_SAVED_ACCOUNTS,
  readAccessToken,
  readCookie,
  readSavedAccounts,
  refreshCookieName,
  type SavedAccounts,
  sessionCookieOptions,
} from './session-cookie.js';

/** Response body of login, refresh and switch. Browsers can ignore the tokens: they are also in httpOnly cookies. */
export interface TokenResponse {
  user: SessionUser;
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  sessionExpiresAt: Date;
  rememberMe: boolean;
}

/** One account saved in this browser, as `GET /auth/accounts` lists it. */
export interface SavedAccount extends SessionUser {
  /** The account the browser is currently using (the most recently used one). */
  active: boolean;
}

/** The saved-accounts cookie outlives any one session; dead entries are pruned as they are found. */
const ACCOUNTS_COOKIE_DAYS = 30;

/**
 * Login and sessions. A browser can keep up to MAX_SAVED_ACCOUNTS accounts
 * signed in at once and switch between them without a password. Each saved
 * account has its own session (its refresh token in its own httpOnly cookie);
 * the access token always belongs to the active account, which is the most
 * recently used one, so that is the account the app opens with.
 */
@Controller('auth')
export class AuthController {
  private readonly production: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersRepository,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /**
   * POST /auth/login — email + password → access token (JWT) + refresh token.
   * Adds the account to this browser's saved accounts and makes it active;
   * other saved accounts stay signed in. Rate-limited.
   * 200 · 400 · 401 · 403 · 429 too many attempts
   */
  @Public()
  @RateLimited()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const tokens = await this.auth.login(dto, {
      userAgent: req.headers['user-agent']?.slice(0, 512),
      ipAddress: req.ip,
    });
    const saved = readSavedAccounts(req.headers.cookie);
    // Logging in again as an already-saved account replaces its old session.
    const previous = saved.tokens.get(tokens.user.id);
    if (previous) await this.auth.logoutByRefreshToken(previous);
    // Pre-multi-account cookie: end that session too, rather than orphan it.
    const legacy = readCookie(req.headers.cookie, LEGACY_REFRESH_COOKIE);
    if (legacy) await this.auth.logoutByRefreshToken(legacy);

    const order = [tokens.user.id, ...saved.order.filter((id) => id !== tokens.user.id)];
    // Over the limit: sign out the least recently used accounts.
    for (const dropped of order.splice(MAX_SAVED_ACCOUNTS)) {
      await this.auth.logoutByRefreshToken(saved.tokens.get(dropped)!);
      this.clearAccount(res, dropped);
    }
    return this.activate(res, tokens, order);
  }

  /**
   * POST /auth/refresh — new access token + new refresh token for the active
   * account (the old refresh token stops working). Browsers send nothing;
   * API clients send `{ "refreshToken": "…" }`. 200 · 401
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    if (dto.refreshToken) return this.body(await this.auth.refresh(dto.refreshToken));

    const saved = readSavedAccounts(req.headers.cookie);
    const active = saved.order[0];
    if (!active) throw new UnauthorizedException('Not logged in');
    try {
      return this.activate(res, await this.auth.refresh(saved.tokens.get(active)!), saved.order);
    } catch (err) {
      // That session is over: forget the account, keep the others saved.
      this.forget(res, saved, active);
      throw err;
    }
  }

  /**
   * GET /auth/accounts — the accounts saved in this browser, most recently
   * used first; the first is active. Accounts whose session has ended are
   * dropped. 200 (an empty list when none are saved)
   */
  @Public()
  @Get('accounts')
  async accounts(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SavedAccount[]> {
    const saved = readSavedAccounts(req.headers.cookie);
    const described = await Promise.all(saved.order.map((id) => this.auth.describeSession(saved.tokens.get(id)!)));

    const live = saved.order.filter((id, i) => described[i]?.id === id);
    if (live.length !== saved.order.length) {
      for (const id of saved.order) if (!live.includes(id)) this.clearAccount(res, id);
      // If the active account was the one that ended, its access token goes too.
      if (live[0] !== saved.order[0]) this.clearAccess(res);
      this.writeOrder(res, live);
    }
    return described.filter((u): u is SessionUser => !!u && live.includes(u.id)).map((u) => ({
      ...u,
      active: u.id === live[0],
    }));
  }

  /**
   * POST /auth/switch — make another saved account active, without its
   * password (its saved session is used). 200 · 400 · 401 session ended · 404 not saved here
   */
  @Public()
  @Post('switch')
  @HttpCode(HttpStatus.OK)
  async switch(
    @Body({ schema: switchAccountSchema }) dto: SwitchAccountDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TokenResponse> {
    const saved = readSavedAccounts(req.headers.cookie);
    const token = saved.tokens.get(dto.userId);
    if (!token) throw new NotFoundException("This account isn't saved in this browser");
    try {
      const tokens = await this.auth.refresh(token);
      return this.activate(res, tokens, [dto.userId, ...saved.order.filter((id) => id !== dto.userId)]);
    } catch (err) {
      this.forget(res, saved, dto.userId);
      throw err;
    }
  }

  /**
   * POST /auth/logout — sign out of the active account. Other saved accounts
   * stay signed in. 204. Public, so it still works when the access token has
   * already expired.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const saved = readSavedAccounts(req.headers.cookie);
    const active = saved.order[0];
    if (active) {
      await this.auth.logoutByRefreshToken(saved.tokens.get(active)!);
      this.forget(res, saved, active);
      return;
    }
    // API client: end the session named in its access token.
    const accessToken = readAccessToken(req);
    const user = accessToken ? await this.auth.verifyAccessToken(accessToken) : null;
    if (user) await this.auth.logout(user.sessionId);
    this.clearAccess(res);
  }

  /** POST /auth/accounts/:userId/logout — sign one saved account out of this browser. 204 */
  @Public()
  @Post('accounts/:userId/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAccount(
    @Param('userId') userId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!isUserId(userId)) throw new BadRequestException('userId must be a user id');
    const saved = readSavedAccounts(req.headers.cookie);
    const token = saved.tokens.get(userId);
    if (!token) return;
    await this.auth.logoutByRefreshToken(token);
    this.forget(res, saved, userId);
  }

  /** POST /auth/logout-all — sign every saved account out of this browser. 204 */
  @Public()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const saved = readSavedAccounts(req.headers.cookie);
    for (const id of saved.order) {
      await this.auth.logoutByRefreshToken(saved.tokens.get(id)!);
      this.clearAccount(res, id);
    }
    this.clearAccess(res);
    res.clearCookie(ACCOUNTS_COOKIE, this.clearOptions());
  }

  /** GET /auth/me — the signed-in (active) user, read fresh from the database. 200 · 401 */
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<SessionUser> {
    const current = await this.users.findById(user.id);
    if (!current?.isActive) throw new UnauthorizedException('Account is deactivated');
    return { id: current.id, email: current.email, fullName: current.fullName, role: current.role };
  }

  /**
   * Sets the cookies for `tokens` and makes that account the first (active)
   * in `order`. With "Remember me" the cookies carry the session's expiry and
   * survive browser restarts; without it they are deleted when the browser
   * closes (the server-side session still ends at its own, shorter expiry).
   */
  private activate(res: Response, t: IssuedTokens, order: string[]): TokenResponse {
    const keep = (expires: Date) =>
      t.remember ? cookieOptions(expires, this.production) : sessionCookieOptions(this.production);
    res.cookie(ACCESS_COOKIE, t.accessToken, keep(t.accessTokenExpiresAt));
    res.cookie(refreshCookieName(t.user.id), t.refreshToken, keep(t.sessionExpiresAt));
    res.clearCookie(LEGACY_REFRESH_COOKIE, this.clearOptions());
    this.writeOrder(res, order);
    return this.body(t);
  }

  /**
   * Removes one account from this browser. If it was the active one, the
   * access token is cleared too; the next most recently used account becomes
   * the default, but the user picks it (no silent switch).
   */
  private forget(res: Response, saved: SavedAccounts, userId: string): void {
    this.clearAccount(res, userId);
    if (saved.order[0] === userId) this.clearAccess(res);
    this.writeOrder(
      res,
      saved.order.filter((id) => id !== userId),
    );
  }

  private writeOrder(res: Response, order: string[]): void {
    if (order.length === 0) {
      res.clearCookie(ACCOUNTS_COOKIE, this.clearOptions());
      return;
    }
    const expires = new Date(Date.now() + ACCOUNTS_COOKIE_DAYS * 86_400_000);
    res.cookie(ACCOUNTS_COOKIE, order.join('.'), cookieOptions(expires, this.production));
  }

  private clearAccount(res: Response, userId: string): void {
    res.clearCookie(refreshCookieName(userId), this.clearOptions());
  }

  private clearAccess(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, this.clearOptions());
  }

  private clearOptions() {
    const { expires: _expires, ...options } = cookieOptions(new Date(0), this.production);
    return options;
  }

  private body(t: IssuedTokens): TokenResponse {
    return {
      user: t.user,
      tokenType: 'Bearer',
      accessToken: t.accessToken,
      accessTokenExpiresAt: t.accessTokenExpiresAt,
      refreshToken: t.refreshToken,
      sessionExpiresAt: t.sessionExpiresAt,
      rememberMe: t.remember,
    };
  }
}
