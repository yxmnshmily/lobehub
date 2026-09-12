// One-off recovery of this run's proven pre-provider failure. Dry-run by default.
// Uses the ledger's guarded transitions; never modifies balance or usage charges.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { PlatformCreditModel } from '../packages/database/src/models/platformCredit';
import type { LobeChatDatabase } from '../packages/database/src/type';

const owner = 'user_rij0hRsCpZAiRcQTs7NCRS2t0WA';
const budgetId = '652fcd14-7c33-4e48-8d9e-9d53830ccd73';
const reservationId = '8de0e4ba-7f76-493d-aab6-25f4039c326d';
const operationIds = [
  'op_1788880228600_agt_tczVqFc9gmKp_tpc_y0m4Pb0HygaK_Ot4g3POj',
  'op_1788880244592_agt_DoPfw09fNiV9_tpc_y0m4Pb0HygaK_ywIx9R5U',
];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, statement_timeout: 5000 });
const db = drizzle(pool);
try {
  await db.transaction(async (tx) => {
    const operations = await tx.execute(sql`
      SELECT id, status FROM agent_operations
      WHERE id IN (${sql.join(
        operationIds.map((id) => sql`${id}`),
        sql`, `,
      )})
        AND user_id = ${owner} AND topic_id = 'tpc_y0m4Pb0HygaK' FOR UPDATE
    `);
    if (operations.rows.length !== 2 || operations.rows.some((row) => row.status !== 'error'))
      throw new Error('Run identity or terminal state changed; no recovery applied.');
    const ledger = new PlatformCreditModel(tx as unknown as LobeChatDatabase, owner);
    const reservation = await ledger.getReservation(reservationId);
    if (
      !reservation ||
      reservation.budgetId !== budgetId ||
      reservation.leaseVersion !== 1 ||
      reservation.status !== 'reserved' ||
      reservation.providerRequestId !== null ||
      reservation.settledCredits !== 0 ||
      reservation.reservedCredits !== 1490109 ||
      reservation.model !== 'deepseek-v4-pro' ||
      reservation.provider !== 'deepseek'
    )
      throw new Error('Unclaimed reservation proof changed; no recovery applied.');
    if (!process.argv.includes('--apply')) {
      console.log(
        JSON.stringify({ dryRun: true, budgetId, reservationId, status: reservation.status }),
      );
      return;
    }
    await ledger.releaseReservation({ reservationId, leaseVersion: 1 });
    // This refuses completion if any other reservation is still active or unknown.
    const budget = await ledger.completeBudget(budgetId);
    console.log(
      JSON.stringify({ budgetId, status: budget.status, consumedCredits: budget.consumedCredits }),
    );
  });
} finally {
  await pool.end();
}
