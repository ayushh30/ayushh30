# Flipkart restock auto-buyer

Watches one product page (New Balance 530, **White 0SG**) and, as soon as size **8.5 or 9** is buyable,
runs Buy Now → default address → card payment (ICICI offer) and asks you **only for the bank OTP**.

## Run it on your own laptop (not a cloud server)
Flipkart blocks datacenter IPs, and the OTP step needs you at the terminal.

```bash
cd flipkart-bot
npm install && npx playwright install chromium
cp .env.example .env        # product link + ₹4000 limit are pre-filled; add card details
npm run login               # log in once with your mobile + OTP, set default address
npm run test-checkout       # DRY RUN: goes all the way to the card form, stops before Pay
# check shots/*.png, then set DRY_RUN=false in .env
npm run watch               # leave running; beeps and asks for OTP when it buys
```

## Safety features
- `REQUIRE_TEXT=0SG`: refuses to buy if the page isn't the 0SG variant.
- `MAX_PRICE=4000`: checked against the **final amount on the payment page** (after the ICICI discount, fees included).
  If the ICICI discount isn't applied, or the total is over ₹4,000, the bot **does not pay and does not cancel**.
  It beeps, prints the reason, keeps the checkout open, and waits. Press Enter to re-check (e.g. after applying the
  offer yourself), or type `PAY` to pay anyway.
- `DRY_RUN=true` by default.
- Only `SIZES` (8.5, 9) are ever selected, in that order.
- Card details live only in `.env` (git-ignored). They're never logged or sent anywhere except the Flipkart form.

## Tests
`npm test` runs the real bot against a local fake Flipkart checkout (no internet, no real card):

| Scenario | Expected |
|---|---|
| 8.5 sold out, 9 restocks, ICICI discount applies (₹3,506) | buys **9**, pays, asks for OTP |
| discount missing (₹4,306) | **holds**: never pays, never cancels |
| discount missing, you type `PAY` | pays, asks for OTP |
| `DRY_RUN=true` | stops before Pay |
| neither size ever restocks | keeps watching, never buys |

The bot also restarts Chrome if it crashes, and Ctrl+C stops it cleanly.

## Caveats
- The tests use a *fake* checkout. The real Flipkart pages weren't reachable from the build environment, so the
  button/field matching is text-based guesswork until you've done one dry run on the real site. If a step fails, the screenshot in `shots/` shows where.
- Flipkart may show a captcha or log you out. If it does, re-run `npm run login`.
- Polling every ~4–6s is fast but polite; going much faster risks getting blocked.
