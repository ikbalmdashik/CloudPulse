#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2ca20c3836c601b2ffa8e683fc554b3a5c34e9745f9fb09801f4943311a77398/contract';
import endContract from '../../snapshots/2ca20c3836c601b2ffa8e683fc554b3a5c34e9745f9fb09801f4943311a77398/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f42c904d49a2ef9a09d560527f5193165d01cb4236e7d55376ef53f8b425f6c0/contract';
import startContract from '../../snapshots/f42c904d49a2ef9a09d560527f5193165d01cb4236e7d55376ef53f8b425f6c0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'request_events',
        constraint: 'request_events_from_status_check_2a3631db',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'request_events',
        constraint: 'request_events_to_status_check_cba5e467',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'requests',
        constraint: 'requests_status_check_d01fdbaf',
      }),
      this.addColumn({
        schema: 'public',
        table: 'requests',
        column: col('approved_at', 'timestamptz(3)', {
          codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'requests',
        column: col('approved_by_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.setDefault({
        schema: 'public',
        table: 'requests',
        column: col('status', 'text', {
          default: lit('AWAITING_APPROVAL'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'request_events',
        constraint: 'request_events_from_status_check_c2c66663',
        expression: sql`"from_status" IN ('AWAITING_APPROVAL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'request_events',
        constraint: 'request_events_to_status_check_84afe507',
        expression: sql`"to_status" IN ('AWAITING_APPROVAL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED')`,
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'requests',
        constraint: 'requests_status_check_fb2aa1f0',
        expression: sql`"status" IN ('AWAITING_APPROVAL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED')`,
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_approved_by_id_idx_0d5fa022',
        columns: ['approved_by_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'requests',
        foreignKey: {
          name: 'requests_approved_by_id_fkey',
          columns: ['approved_by_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
