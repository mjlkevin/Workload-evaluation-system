import { runConfigIntegrityCheck } from "./config-integrity";

const args = new Set(process.argv.slice(2));
const repair = args.has("--repair");
const source = args.has("--scheduled") ? "scheduled" : "manual";

const result = runConfigIntegrityCheck(source, repair);

if (result.ok) {
  console.log(`[config-integrity] OK, checked ${result.checkedFiles.length} files.`);
  process.exit(0);
}

console.error("[config-integrity] issues found:");
for (const issue of result.issues) {
  console.error(`- ${issue.file}: ${issue.reason}`);
}
process.exit(1);
