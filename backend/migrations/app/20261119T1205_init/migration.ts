#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6ff142948963248a810d7920cc7e54a230eaecb717bed61a04adafd006ba4a67/contract';
import endContract from '../../snapshots/6ff142948963248a810d7920cc7e54a230eaecb717bed61a04adafd006ba4a67/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'execution_jobs',
        columns: [
          col('attempt', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('finished_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lock_token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('locked_until', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('logs', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('max_attempts', 'int4', {
            notNull: true,
            default: lit(3),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('progress', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('queued_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('request_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('started_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('QUEUED'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('worker_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'execution_jobs_status_check_ec07928c',
            sql`"status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`,
          ),
          checkExpression(
            'jobs_attempts_positive_91036c8d',
            sql`attempt >= 1 AND max_attempts >= 1`,
          ),
          checkExpression('jobs_progress_range_dda9f613', sql`progress >= 0 AND progress <= 100`),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'request_events',
        columns: [
          col('actor_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('event_type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('from_status', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('message', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('metadata', 'json', { codecRef: { codecId: 'pg/json@1' } }),
          col('progress', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('request_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('to_status', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'events_progress_range_9e569b2c',
            sql`progress IS NULL OR (progress >= 0 AND progress <= 100)`,
          ),
          checkExpression(
            'request_events_from_status_check_2a3631db',
            sql`"from_status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')`,
          ),
          checkExpression(
            'request_events_to_status_check_cba5e467',
            sql`"to_status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')`,
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'requests',
        columns: [
          col('category', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('code', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('completed_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('current_step', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('deleted_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('description', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('error_code', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('error_reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('idempotency_key', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('operator_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('payload', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('priority', 'text', {
            notNull: true,
            default: lit('MEDIUM'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('progress', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('result', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
          col('started_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('title', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('version', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'requests_category_check_fa0b6485',
            sql`"category" IN ('VM_PROVISIONING', 'HEALTH_DIAGNOSTIC', 'CONFIG_UPDATE', 'AUDIT_REPORT', 'ACCESS_RESET')`,
          ),
          checkExpression(
            'requests_priority_check_0838e5f0',
            sql`"priority" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')`,
          ),
          checkExpression(
            'requests_progress_range_dda9f613',
            sql`progress >= 0 AND progress <= 100`,
          ),
          checkExpression(
            'requests_status_check_d01fdbaf',
            sql`"status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')`,
          ),
          checkExpression('requests_version_positive_c2490804', sql`version >= 1`),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'sessions',
        columns: [
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('expires_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('ip_address', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('refresh_token_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('revoked_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('user_agent', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'users',
        columns: [
          col('created_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('email', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('full_name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('is_active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('last_login_at', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('password_hash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', {
            notNull: true,
            default: lit('OPERATOR'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updated_at', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'users_role_check_3771da7d',
            sql`"role" IN ('OPERATOR', 'SUPERVISOR', 'ADMIN')`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'requests',
        constraint: 'requests_code_key',
        columns: ['code'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'requests',
        constraint: 'requests_idempotency_key_key',
        columns: ['idempotency_key'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sessions',
        constraint: 'sessions_refresh_token_hash_key',
        columns: ['refresh_token_hash'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'users',
        constraint: 'users_email_key',
        columns: ['email'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'execution_jobs',
        index: 'execution_jobs_request_id_idx_0aa129e0',
        columns: ['request_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'execution_jobs',
        index: 'jobs_active_leases_4dba4b78',
        columns: ['locked_until'],
        extras: { where: sql`status = 'RUNNING'` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'execution_jobs',
        index: 'jobs_by_request_attempt_bbabeda6',
        columns: ['request_id', 'attempt'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'execution_jobs',
        index: 'jobs_queue_claim_a2797fbe',
        columns: ['status', 'queued_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'request_events',
        index: 'events_by_request_d3e88873',
        columns: ['request_id', 'created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'request_events',
        index: 'events_timeline_225d8c0f',
        columns: ['created_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'request_events',
        index: 'request_events_actor_id_idx_69a2164d',
        columns: ['actor_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'request_events',
        index: 'request_events_request_id_idx_0aa129e0',
        columns: ['request_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_active_queue_11e64146',
        columns: ['status', 'priority', 'created_at'],
        extras: { where: sql`deleted_at IS NULL` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_by_operator_f5ed3a6f',
        columns: ['operator_id', 'created_at'],
        extras: { where: sql`deleted_at IS NULL` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_category_status_4d4e7f9d',
        columns: ['category', 'status'],
        extras: { where: sql`deleted_at IS NULL` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_in_flight_d2f0d1c7',
        columns: ['status'],
        extras: { where: sql`status IN ('PENDING', 'IN_PROGRESS') AND deleted_at IS NULL` },
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_operator_id_idx_f32c33e5',
        columns: ['operator_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'requests',
        index: 'requests_payload_gin_1bc408d4',
        columns: ['payload'],
        extras: { type: 'gin' },
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessions',
        index: 'sessions_user_expires_d5534b1f',
        columns: ['user_id', 'expires_at'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessions',
        index: 'sessions_user_id_idx_6c952402',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'users',
        index: 'users_role_active_ce599d3c',
        columns: ['role', 'is_active'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'execution_jobs',
        foreignKey: {
          name: 'execution_jobs_request_id_fkey',
          columns: ['request_id'],
          references: { schema: 'public', table: 'requests', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'request_events',
        foreignKey: {
          name: 'request_events_request_id_fkey',
          columns: ['request_id'],
          references: { schema: 'public', table: 'requests', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'request_events',
        foreignKey: {
          name: 'request_events_actor_id_fkey',
          columns: ['actor_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'requests',
        foreignKey: {
          name: 'requests_operator_id_fkey',
          columns: ['operator_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'restrict',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sessions',
        foreignKey: {
          name: 'sessions_user_id_fkey',
          columns: ['user_id'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
