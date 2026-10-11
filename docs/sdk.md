# SDK guide

The package `@woosal1337/ade` exports the engine that the CLI uses. A harness, an installer, or a team tool can read a profile, show a plan, and apply it with the same rules.

## Plan and apply a profile

```ts
import { apply, createContext, loadProfile, plan } from "@woosal1337/ade";

const ctx = createContext();
const profile = await loadProfile("/Users/me/agent-profile");
const preview = await plan(profile, ctx);

for (const change of preview.changes) {
  if (change.action !== "noop") {
    console.log(change.action, change.scope, change.kind, change.label);
  }
}

const result = await apply(profile, ctx, { expectedFingerprint: preview.fingerprint });
console.log(result.applyId);
```

`expectedFingerprint` makes apply fail if the machine or the profile changed after the plan.

## Target another home

```ts
const ctx = createContext({ home: "/tmp/new-home" });
```

A custom home ignores the harness home variables of the current process, so the target stays self-contained. Pass `env` to give the variables yourself.

## Edit a profile

```ts
import { addMcpServer, loadProfile, saveProfile, setSetting } from "@woosal1337/ade";

const loaded = await loadProfile(dir);
let next = addMcpServer(loaded.profile, "docs", {
  transport: "http",
  url: "https://docs.example.com/mcp",
});
next = setSetting(next, "pi", ["defaultModel"], "claude-opus-5-5");
await saveProfile(dir, next);
```

The edit functions return a new profile and do not change their input. `saveProfile` validates the profile before it writes.

## Capture, status, and revert

```ts
import { capture, revert, status, writeCapture } from "@woosal1337/ade";

const captured = await capture(ctx);
await writeCapture("/tmp/profile", captured);

const report = await status(profile, ctx);
if (report.drift > 0) {
  console.log("Entries changed outside ade.");
}

await revert(ctx);
```

## Remote machines

```ts
import { createContext, loadProfile, remoteApply, remotePlan } from "@woosal1337/ade";

const ctx = createContext();
const profile = await loadProfile("/Users/me/agent-profile");
const target = { host: "igris" };
const preview = await remotePlan(profile, ctx, { target });
await remoteApply(profile, ctx, { target, expectedFingerprint: preview.result.fingerprint });
```

Each remote call returns `{ remote, result }`. `remote` gives the host name, the platform, the Node.js version, and the home. Pass `transport` to use another channel than SSH.

## Errors

Expected failures throw `AdeError`. Each error has a `code`, a `message`, `details`, and an optional `hint`. Use `isAdeError` to check the type.

| Code | Cause |
|---|---|
| `profile-not-found`, `profile-invalid` | The profile file is missing or not valid |
| `secret-undeclared`, `secret-unresolved` | A secret reference has no source, or its source gave no value |
| `conflict` | Managed entries changed outside ade. Pass `force: true` to overwrite them |
| `target-changed` | The machine changed after the plan |
| `revert-blocked` | An entry changed after the apply |
| `locked` | Another apply holds the state lock |
| `remote-failed` | The SSH session failed, or the remote has no Node.js |

## Other harnesses

`listAdapters()` returns the adapter of each supported harness. An adapter gives the paths, the MCP format, and the capture rules of one harness. The JSON output of the CLI gives the same data to tools in other languages: run any command with `--json`.
