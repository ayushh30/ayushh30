// Builds the plain-text WhatsApp message for one property.
// Field names are placeholders; map them to the dashboard's real fields later.
export function buildPropertyMessage(p, brokerName = "") {
  const lines = [
    brokerName ? `Hi ${brokerName},` : "Hi,",
    "",
    `*${p.title}*`,
    p.location && `📍 ${p.location}`,
    p.price && `💰 ${p.price}`,
    p.size && `📐 ${p.size}`,
    p.details && `\n${p.details}`,
    p.link && `\n🔗 ${p.link}`,
    "\n– Propico",
  ];
  return lines.filter((l) => l !== undefined && l !== false).join("\n");
}
