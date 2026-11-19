#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/67c67e3b38b12fed938cc526516f69895e2811ecbce7b2438fb5505d620c971b/contract';
import startContract from '../../snapshots/67c67e3b38b12fed938cc526516f69895e2811ecbce7b2438fb5505d620c971b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f42c904d49a2ef9a09d560527f5193165d01cb4236e7d55376ef53f8b425f6c0/contract';
import endContract from '../../snapshots/f42c904d49a2ef9a09d560527f5193165d01cb4236e7d55376ef53f8b425f6c0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'sessions',
        column: col('remember', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
