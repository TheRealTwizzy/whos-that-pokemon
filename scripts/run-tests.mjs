import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--test", "tests/*.test.mjs"], {
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);
