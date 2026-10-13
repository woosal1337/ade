# Accounts and public pages

An ade account gives you a page at `ade.chele.bi/<name>`. You upload your setup from the CLI, and you choose each item that others see. Others apply the shared items with `ade apply @<name>`.

## Share your setup

1. Log in on the site with GitHub: https://ade.chele.bi/dashboard
2. Link the CLI to the same account. ade prints a link and a code. Open the link and confirm the code:

   ```bash
   ade login
   ```

3. Upload your profile:

   ```bash
   ade push
   ```

4. Open the dashboard. Switch on each item that others can see.
5. Share the link `ade.chele.bi/<name>`, or the command `ade apply @<name>`.

Run `ade push` again after a change on your machine. The dashboard shows the new upload.

At the first login, WorkOS can ask for proof of the email address of your GitHub account. WorkOS then sends a 6-digit code to that address, and the dashboard asks for it. The login waits 10 minutes for the code. To get a new code, start the login again.

## What ade uploads

`ade push` uploads the same bundle as `ade share`:

- The profile file, the instructions, the skill files, the extra files, and the patches.
- Secret names and the kind of each secret source. ade never uploads a secret value.
- Copies of linked files and linked skills. Git skills stay Git references with their locked commits.

The CLI and the server both refuse a value that looks like a token or a private key, and a file with a credential name such as `.env`.

## What others see

Each item has a switch on the dashboard. An item is public only when you switch it on.

| Event | Result |
|---|---|
| A new item in an upload | Hidden |
| You switch an item on | Public, at this version |
| The item changes in a later upload | Hidden again. The dashboard marks it as changed until you switch it on again |
| The item leaves a later upload | Gone, and its approval ends |

The public page and `ade apply @<name>` show the same items. In the public profile, each secret becomes an environment variable with the same name. The user who applies it sets the variable.

## The People page

https://ade.chele.bi/people lists each person with at least one public item. A person with no public item is not on the list.

| Part | Use |
|---|---|
| Search bar | Finds a person by page name, display name, GitHub login, skill, MCP server, plugin, or harness. Each word must match. Press `/` to start a search |
| Harness filter | Shows only the people who share their harness list with that harness |
| Shares filter | Shows only the people who share skills, MCP servers, or plugins |
| Sort | Top voted, recently updated, most skills, or name |
| Update date | The last time that the public items of the person changed |
| Votes | Up or down, one vote for each person. Press the same arrow again to remove the vote |

Only a logged-in user can vote. A user cannot vote for their own page. The page shows the vote counts, not the voters. The search, the filters, and the sort stay in the address, so a link keeps the same view.

## Apply a shared setup

| Source | Meaning |
|---|---|
| `@ege` | The shared items of the page `ade.chele.bi/ege` |
| `ade.chele.bi/ege` | The same page |
| `https://ade.chele.bi/ege` | The same page |

```bash
ade plan @ege
ade apply @ege
```

The source needs trust, like a Git source. ade shows what the setup runs and writes before the first apply. A change on the page needs trust again. `--offline` uses the last download.

## Manage the account

| Task | Where |
|---|---|
| Change the page name | Dashboard, Page name |
| Show the linked account | `ade whoami` |
| Remove the login of a machine | `ade logout` |
| Log out of the site | Dashboard, Log out |
| Delete the account, the uploads, and the page | Dashboard, Delete the account |

A rename moves the page at once. The old name then shows 404.

The browser keeps the login cookie for 30 days, and the API renews the WorkOS access token when it expires. WorkOS ends the login earlier when its session length or inactivity timeout passes. Set both in the WorkOS dashboard, under Applications, Sessions. The dashboard shows your last account view at once on each visit, then checks it with the API. Log out on a shared computer, because the browser keeps that view.

## Settings

| Variable | Default | Use |
|---|---|---|
| `ADE_API_URL` | `https://ade-api.chele.bi` | The API for login, push, and `@name` sources |
| `ADE_SITE_URL` | `https://ade.chele.bi` | The site for page links and `ade.chele.bi/<name>` sources |

The CLI keeps its tokens in `account.json` in the state folder, with mode 600.

## API

The API answers on `https://ade-api.chele.bi` and on `https://ade.chele.bi/api`.

| Request | Access | Result |
|---|---|---|
| `GET /health` | Public | The API version and the login state |
| `GET /v1/auth/config` | Public | The WorkOS client ID and the device flow URLs |
| `GET /v1/users/<name>` | Public | The shared items of a page |
| `GET /v1/users/<name>/ADE.md` | Public | The shared items as an `ADE.md` |
| `GET /v1/people` | Public | The People list: `q`, `harness`, `has`, `sort`, and `page`. A logged-in request also gets its own votes |
| `GET /v1/people/<name>` | Public | One person of the list, with the vote counts |
| `PUT /v1/people/<name>/vote` | Signed in | Vote: `{ "value": 1 }`, `{ "value": -1 }`, or `{ "value": 0 }` to remove the vote |
| `GET /v1/me` | Owner | The account, the last upload, and every item with its state |
| `PATCH /v1/me` | Owner | Change the page name or the display name |
| `DELETE /v1/me` | Owner | Delete the account |
| `POST /v1/me/snapshots` | Owner | Upload a bundle |
| `PUT /v1/me/visibility` | Owner | Switch items on or off: `{ "items": { "<key>": true } }` |

Owner requests use a WorkOS access token in `Authorization: Bearer`, or the session cookie of the site.
