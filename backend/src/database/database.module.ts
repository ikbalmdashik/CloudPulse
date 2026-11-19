import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { createDb, type Db } from '../prisma/db.js';

/** Injection token for the Prisma client: `@Inject(DB) private readonly db: Db`. */
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Db =>
        createDb(config.get('DATABASE_URL', { infer: true })),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Lets in-flight queries finish, then closes the connection pool. */
  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}
