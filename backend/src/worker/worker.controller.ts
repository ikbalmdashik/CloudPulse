import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { RequestsRepository } from '../requests/requests.repository.js';
import { JobsRepository } from './jobs.repository.js';
import { WorkerService, type WorkerStatus } from './worker.service.js';

export interface QueueStats {
  /** Requests by status (PENDING, IN_PROGRESS, …). */
  requests: Record<string, number>;
  /** Processing jobs by status (QUEUED, RUNNING, SUCCEEDED, …), including retries. */
  jobs: Record<string, number>;
  /** This server's worker pool. */
  workers: WorkerStatus;
}

@Roles('SUPERVISOR', 'ADMIN')
@Controller('queue')
export class WorkerController {
  constructor(
    private readonly workers: WorkerService,
    private readonly requests: RequestsRepository,
    private readonly jobs: JobsRepository,
  ) {}

  /** GET /queue/stats — request and job counts plus worker activity. Supervisors and admins. 200 · 401 · 403 */
  @Get('stats')
  async stats(): Promise<QueueStats> {
    const [requests, jobs] = await Promise.all([this.requests.countByStatus(), this.jobs.countByStatus()]);
    return { requests, jobs, workers: this.workers.status() };
  }
}
