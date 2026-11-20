import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { rateLimitOptions } from './common/rate-limit/rate-limit.js';
import { type Env, validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkerModule } from './worker/worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => rateLimitOptions(config),
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    RealtimeModule,
    RequestsModule,
    WorkerModule,
  ],
})
export class AppModule {}
