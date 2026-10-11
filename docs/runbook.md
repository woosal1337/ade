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

## Publish a profile

1. Write the publication copy:

   ```bash
   ade pack --out <dir> --repo <owner>/<repo>
   ```

2. Read the warnings and the generated README.
3. Push the folder to a public repository.

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
