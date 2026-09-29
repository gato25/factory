import type postgres from 'postgres';

/**
 * A ticket reference nobody has used.
 *
 * The specs used to draw six random digits and insert. The database they share
 * keeps every ticket every earlier run made — 1,900 of them after a few runs,
 * and `tickets.reference` is unique — so each insert had roughly a one in five
 * hundred chance of colliding, and a spec that seeds a dozen tickets failed
 * with a duplicate key about once in every four runs. Drawing until the
 * reference is free costs one lookup and makes that failure impossible.
 *
 * The suite runs on one worker, so nothing else takes the reference between
 * the lookup and the insert.
 */
export async function freeReference(sql: postgres.Sql): Promise<string> {
  for (;;) {
    const reference = `#${Math.floor(Math.random() * 900_000) + 100_000}`;
    const [taken] = await sql`select 1 from tickets where reference = ${reference}`;
    if (!taken) return reference;
  }
}
