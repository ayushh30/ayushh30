// Runs watch.js, answers its prompts like a human would. ANSWERS = comma list, e.g. "123456" or ",PAY,123456"
import { spawn } from "node:child_process";
const answers = (process.env.ANSWERS || "").split(",");
const p = spawn("node", ["src/watch.js"], { cwd: process.env.BOT, env: process.env });
let buf = "";
p.stdout.on("data", (d) => {
  process.stdout.write(d); buf += d;
  if (/>>> |Press Enter/.test(buf)) {
    buf = "";
    const a = answers.shift();
    if (a === undefined) return; // leave it waiting (human away)
    setTimeout(() => { console.log(`[driver types: "${a}"]`); p.stdin.write(a + "\n"); }, 300);
  }
});
p.stderr.on("data", (d) => process.stderr.write(d));
setTimeout(() => { console.log("[driver: timeout, killing bot]"); p.kill(); }, Number(process.env.TIMEOUT || 60000));
p.on("exit", () => process.exit(0));
