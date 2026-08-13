import { execSync } from "node:child_process";

const report = JSON.parse(
  execSync("npm audit --json 2>/dev/null", { maxBuffer: 10 * 1024 * 1024 }),
);

for (const [name, v] of Object.entries(report.vulnerabilities)) {
  if (v.severity === "info") continue;
  console.log(
    `[${v.severity.toUpperCase()}] ${name} via: ${v.via
      .filter((x) => typeof x === "string")
      .join(", ")} | fix: ${v.fixAvailable ? (v.fixAvailable.name + "@" + v.fixAvailable.version + (v.fixAvailable.isSemVerMajor ? " (MAJOR)" : "")) : "NONE"}`,
  );
}
