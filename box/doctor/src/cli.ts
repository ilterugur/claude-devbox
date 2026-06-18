import { collect } from "./collect";
import { formatHuman, formatJson } from "./report";

async function main() {
  const [cmd, ...rest] = Bun.argv.slice(2);
  if (cmd !== "report" && cmd !== undefined) {
    console.error(`unknown command: ${cmd} (this build supports: report)`);
    process.exit(2);
  }
  const json = rest.includes("--json");
  const health = await collect({
    profileHome: process.env.HOME ?? "/root",
    activityWindowSec: 10 * 60,
    idleAfterSec: 30 * 60,
  });
  console.log(json ? formatJson(health) : formatHuman(health));
}

main();
