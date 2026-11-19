import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CreateUserDto } from './dto/create-user.schema.js';
import type { ListUsersQuery } from './dto/list-users.schema.js';
import { ROLE_TRANSITIONS, type UpdateRoleDto } from './dto/update-role.schema.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { hashPassword } from './password.js';
import { EmailAlreadyExistsError, type PublicUser, UsersRepository } from './users.repository.js';

/** Business logic for users. Knows nothing about HTTP requests or SQL. */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly realtime: RealtimeService,
  ) {}

  /** Registers a new user. Every new user starts as an OPERATOR. */
  async create(dto: CreateUserDto): Promise<PublicUser> {
    const passwordHash = await hashPassword(dto.password);
    try {
      const user = await this.users.create({
        email: dto.email,
        fullName: dto.fullName,
        role: 'OPERATOR',
        passwordHash,
      });
      this.logger.log(`Created user ${user.id}`);
      return user;
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }

  list(query: ListUsersQuery) {
    return this.users.list(query);
  }

  /**
   * Promotes an active OPERATOR to SUPERVISOR, or demotes an active SUPERVISOR
   * to OPERATOR. Called by an admin.
   */
  async changeRole(id: string, dto: UpdateRoleDto, actorId: string): Promise<PublicUser> {
    const from = ROLE_TRANSITIONS[dto.role];
    const updated = await this.users.changeRoleIf(id, from, dto.role);
    if (updated) {
      this.logger.log(`User ${actorId} changed role of ${id} from ${from} to ${dto.role}`);
      // Their open tabs get a fresh token now, and their live feed follows the new role.
      this.realtime.userRoleChanged(id);
      return updated;
    }

    // Nothing matched: work out why, for a precise error.
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (!user.isActive) throw new ConflictException('User is deactivated');
    if (user.role === dto.role) throw new ConflictException(`User is already ${dto.role}`);
    throw new ConflictException(
      `Only ${from} users can be changed to ${dto.role}; this user is ${user.role}`,
    );
  }
}
