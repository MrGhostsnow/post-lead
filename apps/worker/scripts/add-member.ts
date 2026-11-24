/**
 * Gives a panel user access to an agency, creating the agency if needed.
 * The user must exist in Supabase Auth first (Authentication > Users > Invite).
 *
 *   npm run add-member -w @post-lead/worker -- --email voce@agencia.com.br --agency "Minha Agência"
 *   npm run add-member -w @post-lead/worker -- --user-id <uuid> --agency "Minha Agência"
 */
import { parseArgs } from "node:util";
import { agencies, agencyMembers, createDb, eq, sql } from "@post-lead/db";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "user-id": { type: "string" },
    agency: { type: "string" },
    role: { type: "string", default: "admin" },
  },
});

if (!values.agency || (!values.email && !values["user-id"])) {
  console.error('Usage: add-member (--email <email> | --user-id <uuid>) --agency "<name>"');
  process.exit(1);
}

const db = createDb();

let userId = values["user-id"];
if (!userId) {
  const rows = await db.execute<{ id: string }>(sql`select id from auth.users where lower(email) = lower(${values.email!}) limit 1`);
  userId = rows[0]?.id;
  if (!userId) {
    console.error(`No Supabase Auth user with email ${values.email}. Invite them in the Supabase dashboard first.`);
    process.exit(1);
  }
}

let [agency] = await db.select().from(agencies).where(eq(agencies.name, values.agency));
if (!agency) {
  [agency] = await db.insert(agencies).values({ name: values.agency }).returning();
  console.log(`Created agency "${values.agency}"`);
}

await db
  .insert(agencyMembers)
  .values({ agencyId: agency!.id, userId, role: values.role! })
  .onConflictDoNothing();

console.log(`User ${userId} is a member of "${agency!.name}" (${agency!.id})`);
process.exit(0);
