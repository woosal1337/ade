# ade runbook

## Run the local checks

```bash
python3 tools/quality.py check
npm test
```

## Try a profile in a scratch home

```bash
mkdir -p /tmp/ade-home
node src/cli.ts plan --profile <profile-dir> --home /tmp/ade-home
node src/cli.ts apply --profile <profile-dir> --home /tmp/ade-home --yes
```

## Move a setup to another machine over SSH

1. Capture the old machine into a local profile:

   ```bash
   ade remote old-box capture --out ~/agent-profile
   ```

2. Show the plan for the new machine:

   ```bash
   ade remote new-box plan --profile ~/agent-profile
   ```

3. Apply the profile on the new machine:

   ```bash
   ade remote new-box apply --profile ~/agent-profile
   ```

## Move a setup to another machine with a bundle file

1. On the old machine, capture the setup:

   ```bash
   ade capture --out ~/agent-profile
   ```

2. Read the secret list in the capture output.
3. Copy the profile directory to the new machine with Git, or export one bundle file:

   ```bash
   ade export --profile ~/agent-profile --out profile.ade.json
   ```

4. On the new machine, import the bundle:

   ```bash
   ade import profile.ade.json --out ~/agent-profile
   ```

5. Set each secret on the new machine. Then check the profile:

   ```bash
   ade doctor --profile ~/agent-profile
   ```

6. Show the plan, then apply it:

   ```bash
   ade plan --profile ~/agent-profile
   ade apply --profile ~/agent-profile
   ```

## Sync a machine with a published profile

1. Show the plan:

   ```bash
   ade plan <owner>/<repo>
   ```

2. Apply the profile. Read the trust summary before you type yes:

   ```bash
   ade apply <owner>/<repo>
   ```

3. Make the source the default for later syncs:

   ```bash
   ade use <owner>/<repo>
   ```

## Share a setup as one ADE.md

1. Write the file:

   ```bash
   ade share --profile <dir> --repo <owner>/<repo>
   ```

2. Read the warnings and the file.
3. Check the file:

   ```bash
   ade verify ADE.md
   ```

4. Commit `ADE.md` to the repository.

## Publish a profile folder

1. Write the publication copy:

   ```bash
   ade pack --out <dir> --repo <owner>/<repo>
   ```

2. Read the warnings and the generated README.
3. Push the folder to a public repository.

## Deploy the site

Vercel deploys the `site` folder to https://ade.chele.bi on each push to `main`.

1. Push the commit to `main`.
2. Open the Vercel project `ade`. Make sure that the new deployment shows Ready.
3. Run this command. Make sure that it prints 200:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://ade.chele.bi/
   ```

4. If the site is broken, promote the last good deployment in Vercel.

## Deploy the accounts API

Coolify on Igris builds `server/Dockerfile` from GitHub. A GitHub push webhook starts each deploy.

1. Push the commit to the branch that the Coolify app `ade-api` builds.
2. Open the app in Coolify. Make sure that the new deployment shows Finished, and the app shows running:healthy.
3. Run this command. Make sure that it prints `"ok":true`:

   ```bash
   curl -s https://ade-api.chele.bi/health
   ```

4. If the API is broken, redeploy the last good commit in Coolify.

The API applies new database migrations when it starts.

## Turn on the login

The API runs with the login off until it has the three WorkOS values.

1. Register the redirect URI with the WorkOS API key:

   ```bash
   curl -s https://api.workos.com/user_management/redirect_uris \
     -H "Authorization: Bearer $WORKOS_API_KEY" -H "Content-Type: application/json" \
     -d '{"uri": "https://ade.chele.bi/api/auth/callback"}'
   ```

2. Set `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD` on the Coolify app. The cookie password needs 32 or more characters.
3. Redeploy the app.
4. Run `curl -s https://ade-api.chele.bi/health`. Make sure that it prints `"auth":true`.

A WorkOS Staging environment uses the GitHub app of WorkOS, and the GitHub screen shows the WorkOS name. A Production environment needs your own GitHub OAuth App in the WorkOS dashboard. The logout ends the session through the API key, so it needs no sign-out redirect.

## Update the GitHub social preview

GitHub has no API for this image. Do these steps after a change to the social card:

1. Open https://github.com/woosal1337/ade/settings.
2. In Social preview, select Edit, then Upload an image.
3. Select the file from https://ade.chele.bi/social-preview.png.

## Undo an apply

```bash
ade history
ade revert
```

To undo an older apply, give its record id: `ade revert <id>`.

## Recover from drift

1. Show the entries that changed outside ade:

   ```bash
   ade status
   ```

2. To keep the machine value, change the profile with `ade set`, `ade add --replace`, or `ade remove`.
3. To restore the profile value, apply with force:

   ```bash
   ade apply --force
   ```

## Recover from a stale lock

1. Make sure that no `ade apply` or `ade revert` process runs.
2. Remove the `lock` file in the state directory.
