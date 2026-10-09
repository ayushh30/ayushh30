import { chromium } from "playwright";
import readline from "node:readline/promises";
import { mkdirSync } from "node:fs";
import { cfg, PROFILE_DIR } from "./config.js";

mkdirSync("shots", { recursive: true });
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bell = () => process.stdout.write("\x07\x07\x07");

let ctx, page, stopping = false;
// Ctrl+C / kill must really stop the bot (otherwise the crash-restart below would revive the browser)
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { stopping = true; log("stopping"); ctx?.close().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); });
async function openBrowser() {
  await ctx?.close().catch(() => {});
  ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: cfg.headless,
    executablePath: cfg.chromePath,
    viewport: { width: 1280, height: 900 },
    // Behind a corporate/cloud proxy, Chrome must be told about it explicitly
    ...(process.env.HTTPS_PROXY && { proxy: { server: process.env.HTTPS_PROXY, bypass: process.env.NO_PROXY || "localhost,127.0.0.1" } }),
  });
  // Skip images/fonts/media for speed
  await ctx.route("**/*", (route) =>
    ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  page = ctx.pages()[0] ?? (await ctx.newPage());
}
await openBrowser();
const shot = (name) => page.screenshot({ path: `shots/${Date.now()}-${name}.png` }).catch(() => {});

// Flipkart's buttons are often plain <div>s with no role, so match the visible text itself
const textBtn = (re) => page.getByRole("button", { name: re }).or(page.getByText(re)).filter({ visible: true }).first();
// The real buy button sits in the bottom bar and animates its price like a rolling counter, so its text is
// "Buy at ₹0123456789,..." and won't match exactly. Tag the lowest on-screen element starting with "Buy at ₹" / "Buy now".
const tagBuyButton = () =>
  page.evaluate(() => {
    document.querySelectorAll('[data-bot="buy"]').forEach((e) => e.removeAttribute("data-bot"));
    let best = null, bestY = -1, bestArea = 0;
    for (const el of document.querySelectorAll("body *")) {
      const t = el.textContent.replace(/\s+/g, "");
      if (!/^(buyat₹|buynow)/i.test(t) || t.length > 80) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const area = r.width * r.height;
      if (r.y > bestY + 5 || (Math.abs(r.y - bestY) <= 5 && area > bestArea)) { best = el; bestY = r.y; bestArea = area; }
    }
    if (best) best.setAttribute("data-bot", "buy");
    return !!best;
  });
async function clickBuy() {
  if (!(await tagBuyButton())) throw new Error("buy button not found");
  await page.locator('[data-bot="buy"]').click();
}

// Reads the page in one pass: selected colour + every size link.
// On Flipkart each size is an <a href="...pid=..."> and a sold-out size has a dashed border / strike-through.
const readSizes = () =>
  page.evaluate(() => {
    const leaves = [...document.querySelectorAll("body *")].filter((e) => !e.children.length);
    const colorLabel = leaves.find((e) => /^selected colou?r:?$/i.test(e.textContent.trim()));
    const color = colorLabel ? colorLabel.parentElement.innerText.replace(/selected colou?r:?/i, "").trim() : null;
    const sizes = {};
    for (const leaf of leaves) {
      const m = leaf.textContent.trim().match(/^(?:UK\s*)?(\d{1,2}(?:\.5)?)$/i);
      const link = m && leaf.closest("a[href]");
      // size links point at the same product page (same /p/itm... path), just a different pid
      if (!link || sizes[m[1]] || new URL(link.href).pathname !== location.pathname) continue;
      const parts = [link, ...link.querySelectorAll("*")];
      for (let n = link.parentElement, i = 0; n && i < 2; n = n.parentElement, i++) parts.push(n);
      const soldOut = parts.some((n) => {
        const cs = getComputedStyle(n);
        return cs.borderStyle.includes("dashed") || cs.textDecorationLine.includes("line-through") ||
          n.getAttribute("aria-disabled") === "true" || /disabled|unavailable|sold/i.test(String(n.className));
      });
      sizes[m[1]] = { available: !soldOut, href: link.href };
    }
    return { color, sizes };
  });

// --- 1. stock check: returns the size that is buyable, or null -------------
async function findBuyableSize() {
  const { color, sizes } = await readSizes();
  if (!color || !color.toUpperCase().includes(cfg.requireText.toUpperCase())) {
    log(`selected colour is "${color}", not ${cfg.requireText} - wrong URL, or a captcha/block page`);
    await shot("variant-check");
    return null;
  }
  for (const size of cfg.sizes) {
    const s = sizes[size];
    if (!s?.available) continue;
    // Each size has its own pid: open that size's page so it is the one selected
    if (!page.url().includes(new URL(s.href).searchParams.get("pid"))) {
      await page.goto(s.href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
    }
    if (await tagBuyButton()) return size;
  }
  return null;
}

const rupees = (str) => Number(str.replace(/[^\d.]/g, ""));

// Final amount on the payment page (after bank offer + platform fee).
// Flipkart labels it "Total Amount" / "Amount Payable"; the last one on the page is the post-discount figure.
async function readPayable() {
  const txt = await page.locator("body").innerText();
  const hits = [...txt.matchAll(/(total amount|amount payable|total payable|you pay|pay)\s*[:\n]?\s*₹\s?([\d,]+(?:\.\d+)?)/gi)];
  return hits.length ? rupees(hits.at(-1)[2]) : null;
}

// Did Flipkart actually take off the ICICI discount? Look for a negative bank-offer line.
async function readOfferDiscount() {
  const txt = await page.locator("body").innerText();
  const m = txt.match(new RegExp(`(${cfg.offerText}|bank offer|instant discount)[^₹]{0,80}[-−]\\s?₹\\s?([\\d,]+)`, "i"))
    || txt.match(/(bank offer|instant discount|offer discount)[^₹]{0,40}₹\s?([\d,]+)/i);
  return m ? rupees(m[2]) : 0;
}

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(q)).trim().toLowerCase();
  rl.close();
  return a;
}

// --- 2. checkout ----------------------------------------------------------
async function checkout(size) {
  log(`BUYING size ${size}`);
  // ICICI bank offer: the small "Apply" on the offer card opens a side panel with a big "Apply" button
  const applyBtns = () => page.getByText(/^\s*apply\s*$/i).filter({ visible: true });
  await page.getByText(/^\s*apply\s*$/i).first().waitFor({ timeout: 6000 }).catch(() => {});
  // find the "Apply" inside the small offer card that mentions ICICI, and tag it so we can click it
  const tagged = await page.evaluate((offer) => {
    const re = new RegExp(offer, "i");
    for (const el of document.querySelectorAll("body *")) {
      if (el.children.length || el.textContent.trim().toLowerCase() !== "apply" || !el.getClientRects().length) continue;
      for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++)
        if (n.innerText.length < 200 && re.test(n.innerText)) { el.setAttribute("data-bot", "offer-apply"); return true; }
    }
    return false;
  }, cfg.offerText);
  const iciciApply = page.locator('[data-bot="offer-apply"]').first();
  if (!tagged) log(`no "${cfg.offerText}" offer Apply button on product page`);
  if (await iciciApply.isVisible().catch(() => false)) {
    await iciciApply.click().catch(() => {});
    await page.waitForTimeout(1200);
    const panel = page.getByText(/auto-selected in the payments page/i).first();
    if (await panel.isVisible().catch(() => false)) {
      await applyBtns().last().click().catch(() => {}); // the panel's Apply (rendered last)
      await panel.waitFor({ state: "hidden", timeout: 5000 }).catch(() => page.keyboard.press("Escape"));
    }
    log(`applied ${cfg.offerText} offer`);
    await page.waitForTimeout(1500);
  }
  await shot("offer-applied");
  await clickBuy();
  // Flipkart may open a "Select variant" panel listing only in-stock sizes: pick ours, then Continue
  const variantPanel = page.getByText(/^\s*select variant\s*$/i).first();
  if (await variantPanel.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    // Work inside the panel only (the product page behind it has its own "9.5" chip)
    const found = await page.evaluate((size) => {
      const title = [...document.querySelectorAll("body *")].find((e) => !e.children.length && /^select variant$/i.test(e.textContent.trim()));
      let panel = title;
      while (panel && !/continue/i.test(panel.innerText)) panel = panel.parentElement;
      if (!panel) return "no panel";
      const leaf = [...panel.querySelectorAll("*")].find((e) => !e.children.length && e.textContent.trim().replace(/^UK\s*/i, "") === size);
      if (!leaf) return "size missing";
      leaf.setAttribute("data-bot", "variant-size");
      const cont = [...panel.querySelectorAll("*")].filter((e) => /^continue$/i.test(e.textContent.trim())).pop();
      cont?.setAttribute("data-bot", "variant-continue");
      return "ok";
    }, size);
    if (found !== "ok") throw new Error(`Select variant panel: ${found} for size ${size} (sold out again?)`);
    await page.locator('[data-bot="variant-size"]').click();
    await page.waitForTimeout(600);
    await shot("variant-picked");
    await page.locator('[data-bot="variant-continue"]').click({ timeout: 5000 });
    log(`picked size ${size} in variant panel`);
  }
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

  // If an ICICI offer has its own "Apply" button, press it (otherwise Flipkart auto-applies from the card number)
  const offerApply = page.locator("div, li").filter({ hasText: new RegExp(cfg.offerText, "i") }).getByText(/^\s*apply\s*$/i).first();
  if (await offerApply.isVisible().catch(() => false)) await offerApply.click().catch(() => {});
  await page.waitForTimeout(2500); // let Flipkart recalculate the total

  // Price guard: limit applies to the FINAL amount, card discount + fees included
  for (;;) {
    const payable = await readPayable();
    const discount = await readOfferDiscount();
    await shot("card-filled");
    log(`payable: ₹${payable ?? "?"} | card discount: ₹${discount || 0} | limit: ₹${cfg.maxPrice}`);

    const problems = [];
    if (!discount) problems.push(`${cfg.offerText} card discount NOT applied`);
    if (payable == null) problems.push("could not read the final amount");
    else if (payable > cfg.maxPrice) problems.push(`total ₹${payable} is above your ₹${cfg.maxPrice} limit`);

    if (!problems.length) break;
    // Hold the order open (don't cancel) and wait for the human
    bell();
    console.log(`\n!!! ORDER ON HOLD - NOT PAID, NOT CANCELLED !!!\n  - ${problems.join("\n  - ")}`);
    console.log("  The checkout is still open in the browser. You can fix it there (e.g. apply the offer).");
    const a = await ask(">>> Press Enter to re-check, or type PAY to pay this amount anyway: ");
    if (a === "pay") { log("you approved paying anyway"); break; }
  }

  if (cfg.dryRun) {
    log("DRY_RUN: stopping before Pay. See shots/.");
    await ask("Press Enter to close the browser.");
    return false;
  }
  await textBtn(/^\s*(pay|make payment)\b/i).click();
  return true;
}

// --- 3. OTP: the only thing we ask the human for ----------------------------
async function handleOtp() {
  await page.waitForSelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="OTP" i]', { timeout: 60000 }).catch(() => {});
  bell(); await shot("otp");
  const otp = await ask("\n>>> Enter the OTP from your bank: ");
  const box = page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="OTP" i], input[type="tel"], input[type="text"]').first();
  await box.fill(otp);
  await textBtn(/submit|confirm|verify|proceed/i).click().catch(() => page.keyboard.press("Enter"));
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("final");
  log("Done - check Flipkart orders / your SMS to confirm.");
}

// --- main loop ------------------------------------------------------------
log(`watching ${cfg.url}\nsizes ${cfg.sizes} | variant "${cfg.requireText}" | max final ₹${cfg.maxPrice} | dryRun=${cfg.dryRun}`);
if (process.env.CHECK_ONLY === "true") {
  await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);
  const { color, sizes } = await readSizes();
  log(`colour: ${color}`);
  log("in stock:", Object.entries(sizes).filter(([, v]) => v.available).map(([k]) => k).join(", ") || "none");
  log("sold out:", Object.entries(sizes).filter(([, v]) => !v.available).map(([k]) => k).join(", ") || "none");
  await shot("check-only");
  await ctx.close(); process.exit(0);
}
let n = 0;
for (;;) {
  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const size = cfg.forceBuy ? cfg.sizes[0] : await findBuyableSize();
    if (size) {
      if (cfg.forceBuy) await findBuyableSize();
      const paid = await checkout(size);
      if (paid) await handleOtp();
      break;
    }
    if (++n % 15 === 1) log(`still out of stock (check #${n})`);
  } catch (e) {
    log("error:", e.message.split("\n")[0]);
    if (stopping) break;
    if (/has been closed|crashed|Target closed/i.test(e.message)) { log("browser died - restarting it"); await openBrowser().catch((e2) => log("restart failed:", e2.message)); }
    else await shot("error");
  }
  await sleep(cfg.pollMs + Math.random() * cfg.jitterMs);
}
await ctx.close();
