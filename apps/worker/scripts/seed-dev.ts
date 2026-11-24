/**
 * Creates one agency, one operation and one seller for local development.
 * Usage (from the repo root):
 *
 *   npm run seed:dev -w @post-lead/worker -- --phone-number-id 123 --seller 5577999998888
 *
 * --phone-number-id: Cloud API phone number id (the test number works).
 * --seller: WhatsApp number that receives the notifications, digits only.
 *
 * Then write to the test number from any phone: the first message creates the
 * lead and the tool answers with the first reply below.
 */
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

const [agency] = await db.insert(agencies).values({ name: "Agência de teste" }).returning();
const [operation] = await db
  .insert(operations)
  .values({
    agencyId: agency!.id,
    name: values.name!,
    mode: "team",
    phoneNumberId: values["phone-number-id"],
    firstResponseMinutes: 5,
    staleDays: 3,
    cadence: {
      firstReplyMessage: "Oi! Recebemos sua mensagem, já já alguém te responde por aqui.",
      // The Cloud API test number ships with an approved "hello_world"
      // template, in English and without variables.
      languageCode: "en_US",
      firstNameParam: false,
      followUps: [{ afterMinutes: 60, template: "hello_world" }],
      reengagementTemplate: "hello_world",
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
process.exit(0);
