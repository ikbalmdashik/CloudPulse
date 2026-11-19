import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

/** Creates a Prisma client. The app gets its URL from ConfigService (see DatabaseModule). */
export function createDb(url: string) {
  return postgres({ contract, url });
}

export type Db = ReturnType<typeof createDb>;
