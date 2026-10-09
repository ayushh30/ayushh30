// Run once: opens a real browser with a saved profile. Log in to Flipkart yourself
// (mobile + OTP), set your default address, then close the window / press Enter.
import { chromium } from "playwright";
import { PROFILE_DIR } from "./config.js";

const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: false, viewport: null });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://www.flipkart.com/login");
console.log("Log in in the browser window, then press Enter here to save the session.");
process.stdin.once("data", async () => { await ctx.close(); process.exit(0); });
