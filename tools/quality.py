import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
REQUIRED = {"format", "source-comments", "lint", "test"}


def load_project():
    project = json.loads((ROOT / "PROJECT.json").read_text())
    checks = project["quality"]["checks"]
    names = [check["id"] for check in checks]
    required = REQUIRED | set(project["quality"].get("required", []))
    if len(set(names)) != len(names) or not required.issubset(names):
        raise ValueError("Configure each required quality check once.")
    for check in checks:
        command(check["argv"])
    for argv in project["commands"].values():
        command(argv)
    version = project["quality"]["pre_commit_version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Set an exact pre-commit version.")
    return project


def command(argv):
    if not isinstance(argv, list) or not argv or any(not isinstance(x, str) or not x for x in argv):
        raise ValueError("Use a nonempty argument array for each command.")
    return argv


def run(argv):
    return subprocess.run(command(argv), cwd=ROOT).returncode


def hooks_install(project):
    git_root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], cwd=ROOT, text=True).strip()
    if Path(git_root).resolve() != ROOT:
        raise ValueError("Initialize Git in this project before installing hooks.")
    version = project["quality"]["pre_commit_version"]
    argv = ["uvx", "--from", "pre-commit==" + version, "pre-commit", "install", "--install-hooks"]
    argv += ["--hook-type", "pre-commit", "--hook-type", "pre-push"]
    result = run(argv)
    if result:
        return result
    for hook in ("pre-commit", "pre-push"):
        path = subprocess.check_output(["git", "rev-parse", "--git-path", "hooks/" + hook], cwd=ROOT, text=True).strip()
        target = Path(path) if Path(path).is_absolute() else ROOT / path
        if not target.is_file() or not os.access(target, os.X_OK):
            raise ValueError("The required Git hook is absent or cannot run: " + hook)
    return 0


def main():
    project = load_project()
    action = sys.argv[1] if len(sys.argv) == 2 else ""
    if action == "hooks-install":
        return hooks_install(project)
    if action == "check":
        for check in project["quality"]["checks"]:
            print("Check: " + check["id"], flush=True)
            result = run(check["argv"])
            if result:
                return result
        return 0
    if action in project["commands"]:
        return run(project["commands"][action])
    raise ValueError("Choose check, hooks-install, or a command from PROJECT.json.")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        print("Project check failed: " + str(error), file=sys.stderr)
        sys.exit(1)
