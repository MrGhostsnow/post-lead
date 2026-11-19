/**
 * Creates one agency, one operation and one seller for local development,
 * and prints the intake URL and key. Usage (from the repo root):
 *
 *   npm run seed:dev -w @post-lead/worker -- --phone-number-id 123 --seller 5577999998888
 *
 * --phone-number-id: Cloud API phone number id (the test number works).
 * --seller: WhatsApp number that receives the notifications, digits only.
 */
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { agencies, createDb, operations, people } from "@post-lead/db";

const { values } = parseArgs({
  options: {
    "phone-number-id": { type: "string" },
    seller: { type: "string" },
    name: { type: "string", default: "Cliente de teste" },
  },
});

if (!values["phone-number-id"] || !values.seller) {
  console.error("Usage: seed-dev --phone-number-id <id> --seller <digits>");
  process.exit(1);
}

const db = createDb();
const intakeKey = randomBytes(24).toString("base64url");

const [agency] = await db.insert(agencies).values({ name: "Agência de teste" }).returning();
const [operation] = await db
  .insert(operations)
  .values({
    agencyId: agency!.id,
    name: values.name!,
    mode: "team",
    phoneNumberId: values["phone-number-id"],
    intakeKeyHash: createHash("sha256").update(intakeKey).digest("hex"),
    firstResponseMinutes: 5,
    staleDays: 3,
    cadence: {
      // The Cloud API test number ships with an approved "hello_world"
      // template, in English and without variables.
      firstContactTemplate: "hello_world",
      languageCode: "en_US",
      firstNameParam: false,
      followUps: [],
    },
  })
  .returning();
await db.insert(people).values({
  operationId: operation!.id,
  name: "Vendedor de teste",
  whatsappNumber: values.seller,
  role: "seller",
});

console.log(`operation id: ${operation!.id}`);
console.log(`intake URL:   /api/intake/${operation!.id}`);
console.log(`intake key:   ${intakeKey}  (shown once; only its hash is stored)`);
process.exit(0);
