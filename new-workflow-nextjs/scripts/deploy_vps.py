#!/usr/bin/env python3
"""Deploy the current git HEAD of new-workflow-nextjs to the VPS over SSH.

Usage:
    python scripts/deploy_vps.py [--skip-build] [--keep N]

Config is read from environment variables, optionally loaded from
new-workflow-nextjs/.env.deploy.local (gitignored, never commit it):
    VPS_HOST, VPS_PORT, VPS_USER, VPS_PASSWORD
    VPS_APP_DIR      (default: /opt/new-workflow/new-workflow-nextjs)
    VPS_DEPLOY_ROOT  (default: /opt/new-workflow)
    VPS_SERVICE      (default: new-workflow.service)
    VPS_APP_PORT     (default: 3010)
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    sys.exit("paramiko is required: pip install paramiko")

SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent  # .../new-workflow-nextjs


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def run_local(cmd: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, check=True)


class Remote:
    def __init__(self, host: str, port: int, user: str, password: str):
        self.client = paramiko.SSHClient()
        self.client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.client.connect(host, port=port, username=user, password=password, timeout=30)
        self.sftp = self.client.open_sftp()

    def run(self, cmd: str, timeout: int = 900) -> int:
        print(f"$ {cmd}")
        _, stdout, _ = self.client.exec_command(cmd, get_pty=True, timeout=timeout)
        for raw_line in stdout:
            sys.stdout.write(raw_line.encode("ascii", "replace").decode())
        code = stdout.channel.recv_exit_status()
        if code != 0:
            raise RuntimeError(f"Remote command failed (exit {code}): {cmd}")
        return code

    def close(self) -> None:
        self.sftp.close()
        self.client.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-build", action="store_true", help="Skip npm run build (just sync files + restart)")
    parser.add_argument("--keep", type=int, default=5, help="Number of deploy-<sha> snapshots to keep on the VPS")
    args = parser.parse_args()

    load_env_file(APP_DIR / ".env.deploy.local")

    host = os.environ["VPS_HOST"]
    port = int(os.environ.get("VPS_PORT", "22"))
    user = os.environ.get("VPS_USER", "root")
    password = os.environ["VPS_PASSWORD"]
    app_dir = os.environ.get("VPS_APP_DIR", "/opt/new-workflow/new-workflow-nextjs")
    deploy_root = os.environ.get("VPS_DEPLOY_ROOT", "/opt/new-workflow")
    service = os.environ.get("VPS_SERVICE", "new-workflow.service")
    app_port = os.environ.get("VPS_APP_PORT", "3010")

    repo_root_out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], cwd=APP_DIR, check=True, capture_output=True, text=True
    ).stdout.strip()
    repo_root = Path(repo_root_out)
    rel_app_dir = APP_DIR.relative_to(repo_root).as_posix()

    sha = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], cwd=APP_DIR, check=True, capture_output=True, text=True
    ).stdout.strip()

    dirty = subprocess.run(
        ["git", "status", "--porcelain", rel_app_dir], cwd=repo_root, check=True, capture_output=True, text=True
    ).stdout.strip()
    if dirty:
        print("WARNING: working tree has uncommitted changes under app dir; deploying last commit (HEAD) only:")
        print(dirty)

    local_tar = Path(os.environ.get("TEMP", "/tmp")) / f"new-workflow-deploy-{sha}.tar"
    run_local(["git", "archive", "--format=tar", "HEAD", "-o", str(local_tar), "--", rel_app_dir], cwd=repo_root)
    print(f"Created {local_tar} ({local_tar.stat().st_size} bytes)")

    remote = Remote(host, port, user, password)
    try:
        remote_tar = f"/root/new-workflow-deploy-{sha}.tar"
        snapshot_dir = f"{deploy_root}/deploy-{sha}"

        print(f"Uploading {local_tar.name} -> {remote_tar}")
        remote.sftp.put(str(local_tar), remote_tar)

        remote.run(f"mkdir -p '{snapshot_dir}' && tar -xf '{remote_tar}' -C '{snapshot_dir}'")
        remote.run(
            f"rsync -a --delete "
            f"--exclude='node_modules' --exclude='.next' "
            f"--exclude='.env.production' --exclude='.env.local' "
            f"'{snapshot_dir}/{rel_app_dir}/' '{app_dir}/'"
        )
        remote.run(f"cd '{app_dir}' && npm install --no-audit --no-fund")

        if not args.skip_build:
            remote.run(f"cd '{app_dir}' && npm run build")
        else:
            print("Skipping build (--skip-build).")

        remote.run(f"systemctl restart {service}")
        remote.run(f"sleep 3 && systemctl is-active {service}")
        remote.run(f"curl -sf -o /dev/null -w 'health check: %{{http_code}}\\n' http://127.0.0.1:{app_port}/")

        remote.run(f"rm -f '{remote_tar}'")
        remote.run(
            f"cd '{deploy_root}' && ls -1dt deploy-* 2>/dev/null | tail -n +{args.keep + 1} | xargs -r rm -rf"
        )

        print(f"\nDeployed commit {sha} successfully.")
    finally:
        remote.close()
        local_tar.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
