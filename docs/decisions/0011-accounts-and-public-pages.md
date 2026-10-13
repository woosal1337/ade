# 0011: Accounts, public pages, and sync by name

Date: 2026-10-13

Status: Accepted for version 0.1.0.

## Context

Ege asked for GitHub login on ade.chele.bi, a page for each user at `ade.chele.bi/<name>`, and a sync by name. A user uploads a setup from the CLI and sees it on a dashboard. Others see only the items that the owner approves, and they can apply them with the CLI. Ege chose WorkOS for the GitHub login.

## Decision

1. WorkOS AuthKit runs the GitHub login. The web uses the WorkOS redirect flow with a sealed session in an HttpOnly cookie. The CLI uses WorkOS CLI Auth, the OAuth device flow.
2. The API in `server/` runs on Igris in Coolify, with a Coolify PostgreSQL database. The tunnel `igris-coolify` serves it at `ade-api.chele.bi`. The free Cloudflare certificate covers one level below `chele.bi` only, so the API cannot use `api.ade.chele.bi`.
3. The site leaves static export. Vercel renders `/<name>` on the server, and it sends `/api/*` to the API. The session cookie stays first-party on ade.chele.bi.
4. `ade push` uploads the same self-contained bundle as `ade share`. The CLI and the API both refuse token values and local paths.
5. Each item of an upload has a key and a content hash. An item is public only when the owner approved that key with that hash. A new item starts hidden. A changed item is hidden again until the owner approves it again.
6. The public profile turns each secret source into an environment source with the same name. It never holds a secret value or a secret command.
7. `@name` and `ade.chele.bi/<name>` are profile sources. They need trust like a Git source, and the trust compares the entry hashes.

## Alternatives

- A GitHub OAuth App with no WorkOS. It needs the same GitHub app, and ade then owns the session code.
- Vercel Functions with Vercel Postgres. It keeps all parts on Vercel, but Ege runs personal services on Igris.
- A static site that reads the API in the browser. Link previews then show no name.

## Consequences

- The site needs the API for `/dashboard` and `/<name>`. The home page stays static.
- The API stores hidden items too. Only the owner can read them.
- A WorkOS access token lives about 5 minutes. The CLI keeps the refresh token in the state folder with mode 600.
- The first environment is WorkOS Staging. It uses the GitHub app of WorkOS. A move to Production needs a GitHub OAuth App and a new key.
- The direct GitHub login skips the hosted AuthKit pages, so ade shows its own page for the WorkOS email code. ade chooses the first organization when WorkOS asks for one, because ade does not use organizations. Other WorkOS steps, such as MFA, stop the login with a log line.
- The API key registers the redirect URIs. A logout revokes the session through the API key, so no sign-out redirect is necessary.
