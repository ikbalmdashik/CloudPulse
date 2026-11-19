import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../auth.service.js';
import { IS_PUBLIC_KEY } from '../decorators.js';
import { readAccessToken } from '../session-cookie.js';

/**
 * Global guard: every route needs a valid access token (JWT, from the
 * `cp_access` cookie or a Bearer header) unless it is marked `@Public()`.
 * Secure by default — a new route can't be left open by accident. Verifying
 * the JWT needs no database query.
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
    const token = readAccessToken(req);
    if (!token) throw new UnauthorizedException('Not logged in');

    const user = await this.auth.verifyAccessToken(token);
    // The browser answers this by calling POST /auth/refresh and retrying.
    if (!user) throw new UnauthorizedException('Access token is invalid or expired');
    req.user = user;
    return true;
  }
}
