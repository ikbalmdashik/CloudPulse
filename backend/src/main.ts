import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import type { Env } from './config/env.js';
import { SocketIoAdapter } from './realtime/socket-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Only trusted proxies (the Next.js server) may set the client's IP via
  // X-Forwarded-For; rate limits and session records use it.
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // WebSockets share the HTTP port; only the web app's origin may connect.
  app.useWebSocketAdapter(new SocketIoAdapter(app, config.get('FRONTEND_ORIGIN', { infer: true })));
  app.enableShutdownHooks();

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
