import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { RateLimited } from '../common/rate-limit/rate-limit.js';
import { type CreateUserDto, createUserSchema } from './dto/create-user.schema.js';
import { type ListUsersQuery, listUsersQuerySchema } from './dto/list-users.schema.js';
import { type UpdateRoleDto, updateRoleSchema } from './dto/update-role.schema.js';
import { type UpdateStatusDto, updateStatusSchema } from './dto/update-status.schema.js';
import type { PublicUser } from './users.repository.js';
import { UsersService } from './users.service.js';

/** HTTP layer for users: routing, validation, access rules and status codes only. */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * POST /users — register. Open to anyone; the new user is always an OPERATOR.
   * Rate-limited. 201 · 400 validation · 409 email taken · 429 too many attempts
   */
  @Public()
  @RateLimited()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body({ schema: createUserSchema }) dto: CreateUserDto): Promise<PublicUser> {
    return this.usersService.create(dto);
  }

  /**
   * GET /users?role=&search=&limit=&offset= — list users, newest first. ADMIN only.
   * 200 `{ items, total, limit, offset }` · 400 · 401 · 403
   */
  @Roles('ADMIN')
  @Get()
  list(@Query({ schema: listUsersQuerySchema }) query: ListUsersQuery) {
    return this.usersService.list(query);
  }

  /**
   * PATCH /users/:id/role — ADMIN only.
   * `{ "role": "SUPERVISOR" }` promotes an OPERATOR; `{ "role": "OPERATOR" }` demotes a SUPERVISOR.
   * 200 · 400 validation · 401 not logged in · 403 not admin · 404 no such user
   * · 409 user doesn't have the required current role, or is deactivated
   */
  @Roles('ADMIN')
  @Patch(':id/role')
  changeRole(
    @Param('id') id: string,
    @Body({ schema: updateRoleSchema }) dto: UpdateRoleDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<PublicUser> {
    return this.usersService.changeRole(id, dto, admin.id);
  }

  /**
   * PATCH /users/:id/status — ADMIN only. `{ "active": false }` deactivates an
   * operator or supervisor (no more logins, every session revoked, open tabs
   * signed out); `{ "active": true }` reactivates them.
   * 200 · 400 · 401 · 403 not admin, own account, or an admin account · 404 · 409 already in that state
   */
  @Roles('ADMIN')
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body({ schema: updateStatusSchema }) dto: UpdateStatusDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<PublicUser> {
    return this.usersService.setActive(id, dto, admin.id);
  }
}
