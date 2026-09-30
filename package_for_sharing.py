#!/usr/bin/env python3
"""Create a clean, shareable zip of the project (no secrets, no virtualenv, no node_modules).

    python package_for_sharing.py [output.zip]

Excluded: .venv, node_modules, .env (your DB password / JWT secret), uploads, caches, .git.
Included: the pre-built frontend (frontend/dist) so the recipient does NOT need Node.js.
"""
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKIP_DIRS = {".venv", "node_modules", "__pycache__", ".pytest_cache", ".git", ".idea", ".vscode"}
SKIP_FILES = {".env"}
SKIP_SUFFIX = {".pyc", ".log"}


def wanted(rel: Path) -> bool:
    if any(part in SKIP_DIRS for part in rel.parts):
        return False
    if rel.name in SKIP_FILES or rel.suffix in SKIP_SUFFIX:
        return False
    if rel.parts[0] == "uploads" and rel.name != ".gitkeep":
        return False
    return True


def main() -> None:
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        sys.exit("frontend/dist is missing - run `npm --prefix frontend run build` first.")
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / f"{ROOT.name}-share.zip"
    n = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(ROOT.rglob("*")):
            if p.is_file() and wanted(p.relative_to(ROOT)):
                z.write(p, Path(ROOT.name) / p.relative_to(ROOT))
                n += 1
    print(f"Wrote {out}  ({n} files, {out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
