import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkerModule } from './worker/worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    RealtimeModule,
    RequestsModule,
    WorkerModule,
  ],
})
export class AppModule {}
