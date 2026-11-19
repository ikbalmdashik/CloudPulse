import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../config/env.js';
import type { AuthUser } from './auth-user.js';
import { AuthService, type LoginResult } from './auth.service.js';
import { CurrentUser, Public } from './decorators.js';
import { type LoginDto, loginSchema } from './dto/login.schema.js';
import { readSessionCookie, SESSION_COOKIE, sessionCookieOptions } from './session-cookie.js';

@Controller('auth')
export class AuthController {
  private readonly production: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  /**
   * POST /auth/login — exchange email + password for a session. 200 · 400 · 401 · 403
   * Sets the httpOnly `cp_session` cookie for browsers, and also returns the
   * token for API clients (send it as `Authorization: Bearer <token>`).
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const result = await this.auth.login(
      dto,
      { userAgent: req.headers['user-agent']?.slice(0, 512), ipAddress: req.ip },
      readSessionCookie(req),
    );
    res.cookie(SESSION_COOKIE, result.accessToken, sessionCookieOptions(result.expiresAt, this.production));
    return result;
  }

  /** POST /auth/logout — revoke the current session and clear the cookie. 204 · 401 */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    const { expires: _expires, ...options } = sessionCookieOptions(new Date(0), this.production);
    res.clearCookie(SESSION_COOKIE, options);
  }

  /** GET /auth/me — the signed-in user. 200 · 401 */
  @Get('me')
  me(@CurrentUser() user: AuthUser): Omit<AuthUser, 'sessionId'> {
    const { sessionId: _sessionId, ...profile } = user;
    return profile;
  }
}
