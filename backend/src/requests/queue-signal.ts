import { Injectable } from '@nestjs/common';

/**
 * Lets the requests module wake idle workers the moment a job is queued,
 * without depending on the worker module (workers also poll, as a fallback
 * and for jobs queued by other server instances).
 */
@Injectable()
export class QueueSignal {
  private readonly listeners = new Set<() => void>();

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
