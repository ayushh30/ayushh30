import "dotenv/config";

const need = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k} in .env`);
  return v;
};

export const cfg = {
  url: need("PRODUCT_URL"),
  requireText: process.env.REQUIRE_TEXT || "0SG",
  sizes: (process.env.SIZES || "8.5,9").split(",").map((s) => s.trim()),
  maxPrice: Number(process.env.MAX_PRICE || 0),
  pollMs: Number(process.env.POLL_SECONDS || 4) * 1000,
  jitterMs: Number(process.env.POLL_JITTER || 2) * 1000,
  offerText: process.env.OFFER_TEXT || "ICICI",
  dryRun: process.env.DRY_RUN !== "false",
  headless: process.env.HEADLESS === "true",
  forceBuy: process.env.FORCE_BUY === "true", // test mode: skip waiting for stock
  card: {
    number: process.env.CARD_NUMBER,
    mm: process.env.CARD_EXPIRY_MM,
    yy: process.env.CARD_EXPIRY_YY,
    cvv: process.env.CARD_CVV,
  },
};

export const PROFILE_DIR = new URL("../profile", import.meta.url).pathname;
