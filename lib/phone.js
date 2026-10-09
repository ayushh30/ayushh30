// Turns whatever a broker's number looks like into the WhatsApp format: 91XXXXXXXXXX
export function normalizeIndianNumber(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return "91" + d;
  throw new Error(`Invalid Indian mobile number: "${raw}"`);
}
