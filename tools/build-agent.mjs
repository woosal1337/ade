import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildAgent(outfile = path.join(root, "dist", "remote-agent.mjs")) {
  await build({
    entryPoints: [path.join(root, "src", "remote", "agent.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    legalComments: "none",
    minify: true,
    logLevel: "warning",
  });
  return outfile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outfile = await buildAgent(process.argv[2]);
  console.log(`Wrote ${path.relative(root, outfile)}`);
}
