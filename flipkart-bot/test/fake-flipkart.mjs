// Fake Flipkart checkout used by test/run-all.sh. Product: 8.5 sold out, 9 restocks on the 3rd page load.
// Fake Flipkart checkout to exercise watch.js. SCENARIO=ok|nodiscount. Stock appears on the 3rd product load.
import http from "node:http";
const SC = process.env.SCENARIO || "ok";
let loads = 0;
const events = [];
const page = (b) => `<!doctype html><html><body>${b}<script>
const log=(e)=>fetch('/log?e='+encodeURIComponent(e));</script></body></html>`;
const product = () => {
  const inStock = ++loads >= 3 && SC !== "never";
  const li = (s, ok) => `<li class="${ok ? "" : "disabled"}"><a href="#">${s}</a></li>`;
  return page(`<h1>New Balance 530 Sneakers For Men</h1><div>Color: White 0SG</div><div>₹4,299</div>
  <ul>${li("8", true)}${li("8.5", false)}${li("9", inStock)}${li("10", true)}</ul>
  <button ${inStock ? "" : "disabled"} onclick="log('buy-now');location='/addr'">BUY NOW</button>`);
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
  res.end(u.pathname === "/p" ? product() : routes[u.pathname] || "404");
}).listen(Number(process.env.PORT), () => console.log("mock up", SC));
