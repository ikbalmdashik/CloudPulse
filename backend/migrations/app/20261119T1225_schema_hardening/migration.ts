#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/67c67e3b38b12fed938cc526516f69895e2811ecbce7b2438fb5505d620c971b/contract';
import endContract from '../../snapshots/67c67e3b38b12fed938cc526516f69895e2811ecbce7b2438fb5505d620c971b/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6ff142948963248a810d7920cc7e54a230eaecb717bed61a04adafd006ba4a67/contract';
import startContract from '../../snapshots/6ff142948963248a810d7920cc7e54a230eaecb717bed61a04adafd006ba4a67/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'requests',
        column: col('cancel_requested_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.alterColumnType({
        schema: 'public',
        table: 'request_events',
        column: 'metadata',
        type: 'jsonb',
      }),
      this.createIndex({
        schema: 'public',
        table: 'execution_jobs',
        index: 'jobs_one_active_per_request_b6e24aec',
        columns: ['request_id'],
        extras: { where: sql`status IN ('QUEUED', 'RUNNING')`, unique: true },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
