import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module.js';
import { JobsRepository } from './jobs.repository.js';
import { WorkerController } from './worker.controller.js';
import { WorkerService } from './worker.service.js';

/** Background processing of service requests (see WorkerService). */
@Module({
  imports: [RequestsModule],
  controllers: [WorkerController],
  providers: [WorkerService, JobsRepository],
})
export class WorkerModule {}
