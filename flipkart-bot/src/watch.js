import { chromium } from "playwright";
import readline from "node:readline/promises";
import { mkdirSync } from "node:fs";
import { cfg, PROFILE_DIR } from "./config.js";

mkdirSync("shots", { recursive: true });
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bell = () => process.stdout.write("\x07\x07\x07");

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: cfg.headless,
  viewport: { width: 1280, height: 900 },
});
// Skip images/fonts/media for speed
await ctx.route("**/*", (route) =>
  ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
);
const page = ctx.pages()[0] ?? (await ctx.newPage());
const shot = (name) => page.screenshot({ path: `shots/${Date.now()}-${name}.png` }).catch(() => {});

const textBtn = (re) => page.getByRole("button", { name: re }).or(page.locator("button, a, div[role=button]").filter({ hasText: re })).first();

// --- 1. stock check: returns the size that is buyable, or null -------------
async function findBuyableSize() {
  const body = (await page.locator("body").innerText()).toUpperCase();
  if (!body.includes(cfg.requireText.toUpperCase())) {
    log(`page does not mention ${cfg.requireText} - wrong variant URL? (blocked/captcha?)`);
    await shot("variant-check");
    return null;
  }
  for (const size of cfg.sizes) {
    // Size chips are links/list items whose full text is the size, e.g. "8.5" or "UK 8.5"
    const chip = page.locator("li, a, div").filter({ hasText: new RegExp(`^\\s*(UK\\s*)?${size.replace(".", "\\.")}\\s*$`, "i") }).last();
    if (!(await chip.count())) continue;
    const cls = (await chip.getAttribute("class")) || "";
    if (/disabled|unavailable|oos/i.test(cls) || (await chip.getAttribute("aria-disabled")) === "true") continue;
    await chip.click({ timeout: 1500 }).catch(() => {});
    const body2 = (await page.locator("body").innerText()).toLowerCase();
    if (/sold out|currently unavailable|out of stock/.test(body2)) continue;
    if (await page.getByText(/^\s*buy now\s*$/i).first().isEnabled().catch(() => false)) return size;
  }
  return null;
}

async function priceOk() {
  if (!cfg.maxPrice) return true;
  const txt = await page.locator("body").innerText();
  const prices = [...txt.matchAll(/₹\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const main = prices.find((p) => p > 1000); // first sizeable price on the page
  log(`price seen: ₹${main}`);
  return !main || main <= cfg.maxPrice;
}

// --- 2. checkout ----------------------------------------------------------
async function checkout(size) {
  log(`BUYING size ${size}`);
  await textBtn(/^\s*buy now\s*$/i).click();
  await page.waitForLoadState("domcontentloaded");
  await shot("after-buy-now");

  // Address: use default (already selected after login) -> Deliver Here
  const deliver = textBtn(/deliver here/i);
  if (await deliver.isVisible({ timeout: 5000 }).catch(() => false)) await deliver.click();

  // Order summary -> Continue
  const cont = textBtn(/^\s*continue\s*$/i);
  if (await cont.isVisible({ timeout: 8000 }).catch(() => false)) await cont.click();
  await shot("payment-page");

  // Payment: Credit / Debit card
  await page.getByText(/credit\s*\/\s*debit|debit\s*\/\s*credit|credit card/i).first().click({ timeout: 10000 });
  // Card fields may sit inside an iframe; search the page and every frame
  const fill = async (sel, val) => {
    for (const fr of [page.mainFrame(), ...page.frames()]) {
      const el = fr.locator(sel).first();
      if (await el.count()) { await el.fill(val); return true; }
    }
    log(`could not find field ${sel}`); return false;
  };
  await fill('input[name="cardNumber"], input[placeholder*="Card Number" i]', cfg.card.number);
  await fill('input[placeholder*="MM" i], input[name*="month" i]', cfg.card.mm);
  await fill('input[placeholder*="YY" i], input[name*="year" i]', cfg.card.yy);
  await fill('input[placeholder*="CVV" i], input[name*="cvv" i]', cfg.card.cvv);

  // Verify the ICICI offer is actually applied before paying
  const offerBody = await page.locator("body").innerText();
  const applied = new RegExp(cfg.offerText, "i").test(offerBody) && /(applied|discount|off)/i.test(offerBody);
  log(applied ? `offer "${cfg.offerText}" visible` : `WARNING: offer "${cfg.offerText}" not detected - check screenshot`);
  await shot("card-filled");

  if (cfg.dryRun) { log("DRY_RUN: stopping before Pay. See shots/."); return false; }
  await textBtn(/^\s*(pay|make payment)\b/i).click();
  return true;
}

// --- 3. OTP: the only thing we ask the human for ----------------------------
async function handleOtp() {
  await page.waitForSelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="OTP" i]', { timeout: 60000 }).catch(() => {});
  bell(); await shot("otp");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const otp = (await rl.question("\n>>> Enter the OTP from your bank: ")).trim();
  rl.close();
  const box = page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="OTP" i], input[type="tel"], input[type="text"]').first();
  await box.fill(otp);
  await textBtn(/submit|confirm|verify|proceed/i).click().catch(() => page.keyboard.press("Enter"));
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("final");
  log("Done - check Flipkart orders / your SMS to confirm.");
}

// --- main loop ------------------------------------------------------------
log(`watching ${cfg.url}\nsizes ${cfg.sizes} | variant "${cfg.requireText}" | dryRun=${cfg.dryRun}`);
let n = 0;
for (;;) {
  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const size = cfg.forceBuy ? cfg.sizes[0] : await findBuyableSize();
    if (size && (await priceOk())) {
      if (cfg.forceBuy) await findBuyableSize();
      const paid = await checkout(size);
      if (paid) await handleOtp();
      break;
    }
    if (++n % 15 === 1) log(`still out of stock (check #${n})`);
  } catch (e) {
    log("error:", e.message.split("\n")[0]);
    await shot("error");
  }
  await sleep(cfg.pollMs + Math.random() * cfg.jitterMs);
}
await ctx.close();
