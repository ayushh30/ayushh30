// Fake Flipkart checkout used by test/run-all.sh. Product: 8.5 sold out, 9 restocks on the 3rd page load.
// Fake Flipkart checkout to exercise watch.js. SCENARIO=ok|nodiscount. Stock appears on the 3rd product load.
import http from "node:http";
const SC = process.env.SCENARIO || "ok";
let loads = 0;
const events = [];
const page = (b) => `<!doctype html><html><body>${b}<script>
const log=(e)=>fetch('/log?e='+encodeURIComponent(e));</script></body></html>`;
// Mirrors the real Flipkart layout (checked Oct 2026): each size is a link with its own pid, sold-out sizes have a
// dashed border, other colour swatches carry "Out of stock" labels, buy button reads "Buy at ₹...".
const product = (pid) => {
  const inStock = ++loads >= 3 && SC !== "never";
  const size = (s, ok) => `<a href="/p?pid=P${s}"><div style="border:1px ${ok ? "solid" : "dashed"} #999"><div>${s}</div></div></a>`;
  return page(`<h1>New Balance 530 Sneakers For Men</h1>
  <div><div>Selected Color:</div> WHITE 0SG</div>
  <a href="/other">Grey</a><div>Out of stock</div><a href="/other2">Navy</a><div>Out of stock</div>
  <div>Select Size</div>${size("8", true)}${size("8.5", false)}${size("9", inStock)}${size("10", true)}
  <div>₹4,299</div><div>ICICI Credit Card ₹800 off <span onclick="log('offer-apply')">Apply</span></div>
  ${inStock || pid === "P8" ? `<div onclick="log('buy-now:'+location.search);location='/addr'">Buy at ₹4,299</div>` : ""}`);
};
const routes = {
  "/addr": page(`<button onclick="log('deliver');location='/summary'">Deliver Here</button>`),
  "/summary": page(`<button onclick="log('continue');location='/pay'">CONTINUE</button>`),
  "/pay": page(`<div id=opt onclick="document.getElementById('f').style.display='block'">Credit / Debit / ATM Card</div>
  <div id=f style="display:none"><input placeholder="Enter Card Number" oninput="calc()"><input placeholder="MM"><input placeholder="YY"><input placeholder="CVV"></div>
  <div>Price (1 item) ₹4,299</div><div>Platform Fee ₹7</div><div id=off></div><div>Total Amount</div><div id=tot>₹4,306</div>
  <button onclick="log('PAY-CLICKED');location='/otp'">PAY</button>
  <script>function calc(){ if('${SC}'==='ok'&&document.querySelector('input').value.length>=6){
    off.textContent='ICICI Bank Credit Card Offer −₹800'; tot.textContent='₹3,506';}}</script>`),
  "/otp": page(`<input placeholder="Enter OTP" id=o><button onclick="log('otp='+o.value);location='/done'">Submit</button>`),
  "/done": page(`<h1>Order Confirmed</h1>`),
};
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/log") { events.push(u.searchParams.get("e")); console.log("EVENT", u.searchParams.get("e")); return res.end(); }
  if (u.pathname === "/events") return res.end(JSON.stringify(events));
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(u.pathname === "/p" ? product(u.searchParams.get("pid")) : routes[u.pathname] || "404");
}).listen(Number(process.env.PORT), () => console.log("mock up", SC));
