import { Module } from '@nestjs/common';
import { QueueSignal } from './queue-signal.js';
import { RequestsController } from './requests.controller.js';
import { RequestsRepository } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

@Module({
  controllers: [RequestsController],
  providers: [RequestsService, RequestsRepository, QueueSignal],
  // The worker module processes requests through these.
  exports: [RequestsService, RequestsRepository, QueueSignal],
})
export class RequestsModule {}
