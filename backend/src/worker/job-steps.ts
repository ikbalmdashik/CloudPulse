import { randomInt } from 'node:crypto';
import type { Json } from '../requests/requests.repository.js';
import type { Category } from '../requests/request-rules.js';

/**
 * Simulated processing. A real deployment would call a cloud API or run an
 * automation playbook in each step; here each step takes a while (so it is a
 * genuinely long-running, non-blocking operation) and may fail, which
 * exercises progress reporting, retries and cancellation end to end.
 */
export const STEPS: Record<Category, readonly string[]> = {
  VM_PROVISIONING: [
    'Validating request',
    'Checking hypervisor capacity',
    'Allocating compute',
    'Creating disk from image',
    'Configuring network',
    'Running smoke tests',
  ],
  HEALTH_DIAGNOSTIC: [
    'Resolving target',
    'Checking connectivity',
    'Collecting CPU, memory and disk metrics',
    'Checking service endpoints',
    'Analysing logs for errors',
  ],
  CONFIG_UPDATE: [
    'Validating new configuration',
    'Taking a configuration backup',
    'Applying change',
    'Restarting affected services',
    'Verifying health after change',
  ],
  AUDIT_REPORT: [
    'Collecting inventory',
    'Checking access policies',
    'Checking patch levels',
    'Compiling findings',
    'Publishing report',
  ],
  ACCESS_RESET: ['Verifying account', 'Revoking active sessions', 'Issuing temporary credentials', 'Notifying the user'],
};

const FAILURES: Record<Category, readonly string[]> = {
  VM_PROVISIONING: ['Hypervisor capacity check timed out', 'Image registry returned 503', 'IP address pool exhausted'],
  HEALTH_DIAGNOSTIC: ['Target host unreachable', 'Metrics endpoint timed out'],
  CONFIG_UPDATE: ['Configuration backup failed: disk full', 'Service did not restart in time'],
  AUDIT_REPORT: ['Inventory API rate limit exceeded', 'Policy store unavailable'],
  ACCESS_RESET: ['Directory service unavailable', 'Session store timed out'],
};

export function failureReason(category: Category): string {
  const options = FAILURES[category];
  return options[randomInt(options.length)]!;
}

const hex = (n: number) => Array.from({ length: n }, () => randomInt(16).toString(16)).join('');

/** What a finished job reports back; shown on the request page. */
export function resultFor(category: Category, target: string | undefined): { [key: string]: Json } {
  switch (category) {
    case 'VM_PROVISIONING':
      return { vmId: `vm-${hex(8)}`, hostname: target ?? `vm-${hex(4)}`, ipAddress: `10.20.${randomInt(256)}.${randomInt(2, 255)}`, vcpus: 4, memoryGb: 16 };
    case 'HEALTH_DIAGNOSTIC':
      return { overall: 'healthy', checksPassed: 12, checksWarned: randomInt(3), p95LatencyMs: randomInt(40, 220) };
    case 'CONFIG_UPDATE':
      return { changeId: `chg-${hex(6)}`, rollbackId: `bak-${hex(6)}`, servicesRestarted: randomInt(1, 4) };
    case 'AUDIT_REPORT':
      return { reportId: `rpt-${hex(6)}`, findings: randomInt(0, 9), critical: randomInt(0, 2) };
    case 'ACCESS_RESET':
      return { account: target ?? 'user', sessionsRevoked: randomInt(1, 6), temporaryCredentialExpiresInHours: 24 };
  }
}
