/**
 * Creates the first ADMIN (the API never grants ADMIN), or makes an existing
 * user ADMIN. Reads ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_NAME from the
 * environment or `.env`.
 *
 *   npm run seed:admin
 *
 * An existing user's password is left unchanged.
 */
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type Env, validateEnv } from '../config/env.js';
import { DatabaseModule } from '../database/database.module.js';
import { createUserSchema } from '../users/dto/create-user.schema.js';
import { hashPassword } from '../users/password.js';
import { UsersModule } from '../users/users.module.js';
import { UsersRepository } from '../users/users.repository.js';

interface SeedEnv extends Env {
  ADMIN_EMAIL?: string;
  ADMIN_NAME?: string;
  ADMIN_PASSWORD?: string;
}

/**
 * With a `validate` function, @nestjs/config exposes only what it returns
 * (in ConfigService and in process.env). The app's validateEnv returns just
 * the app's settings, so the seed adds its own ADMIN_* variables here.
 */
function validateSeedEnv(raw: Record<string, unknown>): SeedEnv {
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    ...validateEnv(raw),
    ADMIN_EMAIL: text(raw.ADMIN_EMAIL),
    ADMIN_NAME: text(raw.ADMIN_NAME),
    ADMIN_PASSWORD: text(raw.ADMIN_PASSWORD),
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateSeedEnv }),
    DatabaseModule,
    UsersModule,
  ],
})
class SeedModule {}

/** Maps a schema field to the variable the user sets, for error messages. */
const VAR_FOR_FIELD: Record<string, string> = {
  email: 'ADMIN_EMAIL',
  fullName: 'ADMIN_NAME',
  password: 'ADMIN_PASSWORD',
};

async function main(): Promise<void> {
  const logger = new Logger('SeedAdmin');
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn', 'log'] });
  app.enableShutdownHooks();
  try {
    const config = app.get<ConfigService<SeedEnv, true>>(ConfigService);

    // Reuse the sign-up rules so the admin's email and password meet the same standard.
    const result = createUserSchema.safeParse({
      email: config.get('ADMIN_EMAIL', { infer: true }),
      fullName: config.get('ADMIN_NAME', { infer: true }) ?? 'Administrator',
      password: config.get('ADMIN_PASSWORD', { infer: true }),
    });
    if (!result.success) {
      const problems = result.error.issues.map((i) => {
        const field = String(i.path[0] ?? '');
        return `${VAR_FOR_FIELD[field] ?? field} ${i.message}`;
      });
      throw new Error(`Cannot seed admin:\n  - ${problems.join('\n  - ')}`);
    }
    const dto = result.data;

    const { user, created } = await app.get(UsersRepository).ensureAdmin({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash: await hashPassword(dto.password),
    });
    logger.log(
      created
        ? `Created admin ${user.email} (id ${user.id})`
        : `${user.email} already existed; it is now an active ADMIN (password unchanged)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
