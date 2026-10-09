#!/bin/bash
# Runs watch.js against a local fake Flipkart checkout. Needs no internet and no real card.
# Usage: npm test    (set CHROME_PATH if Playwright's own Chromium isn't installed)
cd "$(dirname "$0")/.." || exit 1
T=$(mktemp -d); fail=0
run() { # name scenario dryrun answers timeout_ms expected-events
  local port=$((20000+RANDOM%20000))
  SCENARIO=$2 PORT=$port timeout 90 node test/fake-flipkart.mjs >/dev/null & local sp=$!; sleep 1
  BOT=$PWD PROFILE_DIR=$T/$1 PRODUCT_URL=http://127.0.0.1:$port/p HEADLESS=true DRY_RUN=$3 POLL_SECONDS=1 POLL_JITTER=0 \
   MAX_PRICE=4000 CARD_NUMBER=4111111111111111 CARD_EXPIRY_MM=12 CARD_EXPIRY_YY=29 CARD_CVV=123 \
   ANSWERS="$4" TIMEOUT=$5 timeout 80 node test/driver.mjs > $T/$1.log 2>&1
  local got; got=$(curl -s 127.0.0.1:$port/events); kill $sp 2>/dev/null
  if [ "$got" = "$6" ]; then echo "PASS $1"; else echo "FAIL $1: expected $6 got $got"; tail -5 $T/$1.log; fail=1; fi
}
run discount-ok-buys-size-9   ok         false "123456"       40000 '["offer-apply","buy-now:?pid=P9","deliver","continue","PAY-CLICKED","otp=123456"]'
run no-discount-holds         nodiscount false ""             15000 '["offer-apply","buy-now:?pid=P9","deliver","continue"]'
run no-discount-user-says-pay nodiscount false ",PAY,654321"  40000 '["offer-apply","buy-now:?pid=P9","deliver","continue","PAY-CLICKED","otp=654321"]'
run dry-run-never-pays        ok         true  ""             20000 '["offer-apply","buy-now:?pid=P9","deliver","continue"]'
run never-restocks-never-buys never      false ""             10000 '[]'
rm -rf "$T"; exit $fail
