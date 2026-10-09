// Run: node scripts/preview.js   (never sends anything unless DRY_RUN=false)
import { createPeriskope } from "../lib/periskope.js";
import { buildPropertyMessage } from "../lib/message.js";
import { normalizeIndianNumber } from "../lib/phone.js";

const dryRun = process.env.DRY_RUN !== "false";
const client = createPeriskope({ apiKey: process.env.PERISKOPE_API_KEY, phone: process.env.PERISKOPE_PHONE, dryRun });

const property = { title: "3 BHK Apartment, Sector 62", location: "Noida", price: "₹1.45 Cr", size: "1650 sq ft", link: "https://example.com/p/1" };
const brokers = [{ name: "Test Broker", phone: "98765 43210" }];

for (const b of brokers) {
  const out = await client.sendMessage({ chatId: normalizeIndianNumber(b.phone), message: buildPropertyMessage(property, b.name) });
  console.log(dryRun ? "[PREVIEW]" : "[SENT]", JSON.stringify(out, null, 2));
}
