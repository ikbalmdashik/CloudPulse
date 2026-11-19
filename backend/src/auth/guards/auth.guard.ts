import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AuthService } from '../auth.service.js';
import { IS_PUBLIC_KEY } from '../decorators.js';
import { readSessionToken, SESSION_COOKIE } from '../session-cookie.js';

/**
 * Global guard: every route needs a session (bearer token or `cp_session`
 * cookie) unless it is marked `@Public()`. Secure by default — a new route
 * can't be left open by accident.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = readSessionToken(req);
    if (!token) throw new UnauthorizedException('Not logged in');

    const user = await this.auth.authenticate(token);
    if (!user) {
      // Drop a dead cookie so the browser stops presenting it.
      if (!req.headers.authorization && req.headers.cookie?.includes(SESSION_COOKIE)) {
        ctx.switchToHttp().getResponse<Response>().clearCookie(SESSION_COOKIE, { path: '/' });
      }
      throw new UnauthorizedException('Invalid or expired session');
    }
    req.user = user;
    return true;
  }
}
