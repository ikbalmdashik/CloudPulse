import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../../users/role.js';
import { UsersRepository } from '../../users/users.repository.js';
import { ROLES_KEY } from '../decorators.js';

/**
 * Global guard, runs after AuthGuard: enforces `@Roles(...)` when a route has it.
 *
 * The role is read from the database, not from the JWT. A JWT keeps the role
 * it was issued with until it expires, so trusting it would let a demoted
 * supervisor keep modifying requests for up to ACCESS_TOKEN_TTL_MINUTES.
 * One indexed lookup on privileged routes makes role changes immediate.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) throw new UnauthorizedException('Not logged in');

    const current = await this.users.findById(req.user.id);
    if (!current?.isActive) throw new UnauthorizedException('Account is deactivated');
    req.user.role = current.role; // later code sees the up-to-date role
    if (!roles.includes(current.role)) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    return true;
  }
}
