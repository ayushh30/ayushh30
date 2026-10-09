// Minimal Periskope client. Docs: https://docs.periskope.app/api-reference/message/send-message
const BASE = "https://api.periskope.app/v1";

export function createPeriskope({ apiKey, phone, dryRun = true } = {}) {
  if (!dryRun && (!apiKey || !phone)) throw new Error("PERISKOPE_API_KEY and PERISKOPE_PHONE are required for live sends");
  const headers = { Authorization: `Bearer ${apiKey}`, "x-phone": phone, "Content-Type": "application/json" };

  return {
    // media is optional (for the future "send with images" button)
    async sendMessage({ chatId, message, media }) {
      if (dryRun) return { dryRun: true, chatId, message, media };
      const res = await fetch(`${BASE}/message/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chat_id: chatId, message, ...(media && { media }) }),
      });
      if (!res.ok) throw new Error(`Periskope ${res.status}: ${await res.text()}`);
      return res.json(); // contains queue_id; delivery is asynchronous
    },
  };
}
