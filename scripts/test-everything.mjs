// SPDX-FileCopyrightText: 2022-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "node:child_process";
import { TEST_EVERYTHING_COMMANDS } from "./test-everything-commands.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const command of TEST_EVERYTHING_COMMANDS) {
  console.log(`\n=== npm run ${command} ===\n`);
  execFileSync(npm, ["run", command], { stdio: "inherit", env: process.env });
}
