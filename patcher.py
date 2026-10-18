#!/usr/bin/env python3
"""
Yapper Mod Patcher
==================

Applies or removes the local Yapper Mod tweaks inside the Yapper desktop app.

    python patcher.py status      show what is installed
    python patcher.py install     back up the original and patch
    python patcher.py uninstall   restore the original
    python patcher.py reinstall   uninstall, then install

The app is an Electron bundle whose JavaScript lives inside
resources/app.asar. Nothing outside that archive is touched, and the
original archive is always kept so this is fully reversible.
"""

import argparse
import hashlib
import json
import os
import shutil
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PAYLOAD = os.path.join(HERE, "payload")
PATCHED_FILES = ("main.js", "preload.js")

DEFAULT_ROOTS = [
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "yapper-desktop"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "yapper-mod-patcher-target", "yapper-desktop"),
    r"C:\Program Files\yapper-desktop",
]

BACKUP_NAME = "app.asar.vanilla"
BACKUP_META = "app.asar.vanilla.json"


# --------------------------------------------------------------------------
# console
# --------------------------------------------------------------------------
def _supports_colour():
    return sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


class UI:
    def __init__(self):
        self.colour = _supports_colour()

    def _c(self, code, text):
        return "\033[%sm%s\033[0m" % (code, text) if self.colour else text

    def dim(self, t):
        return self._c("2", t)

    def bold(self, t):
        return self._c("1", t)

    def accent(self, t):
        return self._c("36", t)

    def _green(self, t):
        return self._c("32", t)

    def _yellow(self, t):
        return self._c("33", t)

    def _red(self, t):
        return self._c("31", t)

    def banner(self):
        art = [
            " __   __                 __  __   __ ",
            "\\ \\ / /__  ___ _ __ ___  \\ \\/ / /\\ \\ ",
            " \\ V / _ \\/ -_) '  \\/ _ \\  \\  / / _ \\ |",
            "  \\_/\\___/\\___|_|_|_|\\___/  /_/  \\___/",
        ]
        print()
        for line in art:
            print("   " + self.accent(line))
        print("   " + self.dim("Yapper Mod Patcher  ·  v1.0.0"))
        print()

    def step(self, n, total, text):
        print("   %s %s %s" % (
            self.accent("[%d/%d]" % (n, total)),
            self.dim("·"),
            text,
        ))

    def done(self, text):
        print("      " + self._green("✓") + " " + text)

    def good(self, text):
        print("      " + self._green("•") + " " + text)

    def warn(self, text):
        print("      " + self._yellow("!") + " " + text)

    def err(self, text):
        print("      " + self._red("✗") + " " + text)

    def fail(self, text):
        print("      " + self._red("✗") + " " + text)

    def info(self, text):
        print("      " + self.dim("·") + " " + self.dim(text))

    def blank(self):
        print()


ui = UI()


# --------------------------------------------------------------------------
# asar
# --------------------------------------------------------------------------
def asar_header(blob):
    header_size = struct.unpack_from("<I", blob, 4)[0]
    json_len = struct.unpack_from("<I", blob, 12)[0]
    return json.loads(blob[16:16 + json_len].decode("utf-8")), 8 + header_size


def asar_read(asar_path, out_dir):
    blob = open(asar_path, "rb").read()
    header, base = asar_header(blob)
    count = 0

    def walk(node, prefix=""):
        nonlocal count
        for name, child in node.get("files", {}).items():
            path = "%s/%s" % (prefix, name) if prefix else name
            if "files" in child:
                walk(child, path)
                continue
            dest = os.path.join(out_dir, path.replace("/", os.sep))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            size = int(child.get("size", 0))
            open(dest, "wb").write(blob[base + int(child["offset"]):base + int(child["offset"]) + size])
            count += 1

    walk(header)
    return count


BLOCK = 4194304


def _integrity(path):
    import base64
    data = open(path, "rb").read()
    blocks = [hashlib.sha256(data[i:i + BLOCK]).hexdigest()
              for i in range(0, len(data), BLOCK)] or [hashlib.sha256(b"").hexdigest()]
    return {"algorithm": "SHA256", "hash": blocks[0], "blockSize": BLOCK, "blocks": blocks}


def asar_pack(src_dir, out_path, template_asar):
    template, _ = asar_header(open(template_asar, "rb").read())

    def build(abspath, rel=""):
        node = {"files": {}}
        for name in sorted(os.listdir(abspath)):
            full = os.path.join(abspath, name)
            if os.path.islink(full):
                node["files"][name] = {"link": os.readlink(full)}
            elif os.path.isdir(full):
                node["files"][name] = build(full, "%s/%s" % (rel, name) if rel else name)
            else:
                node["files"][name] = {"size": os.path.getsize(full),
                                       "offset": "0",
                                       "integrity": _integrity(full)}
        return node

    def reorder(orig, disk, rel=""):
        out = {"files": {}}
        for name, child in orig.get("files", {}).items():
            mine = disk["files"].get(name)
            if mine is None:
                raise KeyError("missing from payload: %s/%s" % (rel, name))
            if "files" in child:
                out["files"][name] = reorder(child, mine, "%s/%s" % (rel, name) if rel else name)
            else:
                out["files"][name] = mine
        extra = set(disk["files"]) - set(orig.get("files", {}))
        if extra:
            raise KeyError("unexpected extra files: %s/%s" % (rel, sorted(extra)))
        return out

    root = reorder(template, build(src_dir))
    blobs = []
    cursor = 0

    def emit(node, rel=""):
        nonlocal cursor
        for name, child in node["files"].items():
            path = "%s/%s" % (rel, name) if rel else name
            if "files" in child:
                emit(child, path)
                continue
            child["offset"] = str(cursor)
            data = open(os.path.join(src_dir, path.replace("/", os.sep)), "rb").read()
            blobs.append(data)
            cursor += len(data)

    emit(root)
    header_json = json.dumps(root, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    header_size = 8 + len(header_json)
    if header_size % 4:
        header_size += 4 - (header_size % 4)
    pad = 8 + header_size - 16 - len(header_json)

    with open(out_path, "wb") as f:
        f.write(struct.pack("<III", 4, header_size, header_size - 4))
        f.write(struct.pack("<I", len(header_json)))
        f.write(header_json)
        f.write(b"\0" * pad)
        for b in blobs:
            f.write(b)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def find_install(explicit=None):
    if explicit:
        if not os.path.isdir(explicit):
            sys.exit(ui.err("No Yapper install at %s" % explicit))
        return os.path.abspath(explicit)
    env = os.environ.get("YAPPER_DIR")
    if env and os.path.isdir(env):
        return os.path.abspath(env)
    for root in DEFAULT_ROOTS:
        if root and os.path.isdir(os.path.join(root, "resources")):
            return root
    sys.exit(ui.err(
        "Could not find Yapper.\n"
        "      Pass the folder explicitly:  python patcher.py install --path \"C:\\...\\yapper-desktop\""
    ))


def is_running():
    try:
        out = os.popen('tasklist /FI "IMAGENAME eq Yapper.exe" /NH 2>nul').read()
        return "Yapper.exe" in out
    except Exception:
        return False


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def meta_path(res):
    return os.path.join(res, BACKUP_META)


def read_meta(res):
    try:
        return json.load(open(meta_path(res)))
    except Exception:
        return None


def write_meta(res, data):
    with open(meta_path(res), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------
def cmd_status(args):
    ui.banner()
    root = find_install(args.path)
    res = os.path.join(root, "resources")
    asar = os.path.join(res, "app.asar")
    backup = os.path.join(res, BACKUP_NAME)
    ui.step(1, 3, "Install location")
    ui.done(root)
    ui.step(2, 3, "Archive")
    if not os.path.exists(asar):
        ui.fail("resources/app.asar not found")
        return 1
    ui.done("app.asar  %s  (%s)" % (ui.dim(_size(asar)), ui.dim(sha(asar)[:16])))
    ui.step(3, 3, "Patch state")
    meta = read_meta(res)
    if meta:
        ui.good("installed")
        ui.info("version    %s" % meta.get("version", "?"))
        ui.info("applied    %s" % meta.get("applied", "?"))
        ui.info("backup     %s  (%s)" % (BACKUP_NAME, _size(backup) if os.path.exists(backup) else "missing"))
    elif os.path.exists(backup):
        ui.warn("backup present but no metadata - state unknown")
    else:
        ui.warn("not installed (original, untouched)")
    ui.blank()
    return 0


def cmd_install(args):
    ui.banner()
    root = find_install(args.path)
    res = os.path.join(root, "resources")
    asar = os.path.join(res, "app.asar")
    backup = os.path.join(res, BACKUP_NAME)
    work = os.path.join(HERE, ".work")

    steps = 5
    ui.step(1, steps, "Checking installation")
    if not os.path.exists(asar):
        ui.fail("resources/app.asar not found - is this a Yapper install?")
        return 1
    if not os.path.isdir(PAYLOAD):
        ui.fail("payload folder missing next to this script")
        return 1
    for f in PATCHED_FILES:
        if not os.path.exists(os.path.join(PAYLOAD, f)):
            ui.fail("payload/%s missing" % f)
            return 1
    ui.done("Yapper found")

    if is_running():
        ui.warn("Yapper is running.")
        ui.info("Quit it from the tray first, then re-run install.")
        return 2

    ui.step(2, steps, "Backing up the original")
    if os.path.exists(backup) and not args.force:
        ui.done("existing backup kept  " + ui.dim("(--force to overwrite)"))
    else:
        shutil.copy2(asar, backup)
        ui.done("original saved as %s" % BACKUP_NAME)

    ui.step(3, steps, "Unpacking archive")
    if os.path.isdir(work):
        shutil.rmtree(work)
    os.makedirs(work)
    count = asar_read(asar, work)
    ui.done("%d files extracted" % count)

    ui.step(4, steps, "Applying Yapper Mod")
    template = backup if os.path.exists(backup) else asar
    for f in PATCHED_FILES:
        shutil.copy2(os.path.join(PAYLOAD, f), os.path.join(work, f))
    icon_src = os.path.join(PAYLOAD, "icon.png")
    if os.path.exists(icon_src):
        shutil.copy2(icon_src, os.path.join(work, "build", "icon.png"))
    ui.done("applied  " + ui.dim(", ".join(PATCHED_FILES)))

    ui.step(5, steps, "Repacking and verifying")
    out_tmp = os.path.join(work + ".new")
    asar_pack(work, out_tmp, template)
    asar_header(open(out_tmp, "rb").read())          # raises if malformed
    os.replace(out_tmp, asar)
    shutil.rmtree(work, ignore_errors=True)
    write_meta(res, {"version": "1.0.0", "applied": time.strftime("%Y-%m-%d %H:%M:%S"),
                     "original_sha256": sha(backup) if os.path.exists(backup) else ""})
    ui.done("archive rewritten  %s" % ui.dim(sha(asar)[:16]))

    ui.blank()
    ui.done("Yapper Mod installed.")
    ui.info("Start Yapper and open Settings → Yapper Mod.")
    ui.blank()
    return 0


def cmd_uninstall(args):
    ui.banner()
    root = find_install(args.path)
    res = os.path.join(root, "resources")
    asar = os.path.join(res, "app.asar")
    backup = os.path.join(res, BACKUP_NAME)

    steps = 2
    ui.step(1, steps, "Checking state")
    if not os.path.exists(backup):
        ui.warn("no backup found - nothing to restore")
        return 1
    meta = read_meta(res) or {}
    ui.done("backup found  %s" % ui.dim(_size(backup)))

    ui.step(2, steps, "Restoring the original")
    shutil.copy2(backup, asar)
    for extra in (backup, meta_path(res)):
        if os.path.exists(extra):
            os.remove(extra)
    ui.done("app.asar restored  %s" % ui.dim(sha(asar)[:16]))

    ui.blank()
    ui.done("Yapper Mod removed.")
    if meta.get("applied"):
        ui.info("was installed %s" % meta["applied"])
    ui.blank()
    return 0


def cmd_reinstall(args):
    cmd_uninstall(args)
    print()
    return cmd_install(args)


def _size(path):
    n = os.path.getsize(path)
    for unit in ("B", "KB", "MB"):
        if n < 1024 or unit == "MB":
            return "%.0f %s" % (n, unit) if unit == "B" else "%.1f %s" % (n, unit)
        n /= 1024.0


def main():
    ap = argparse.ArgumentParser(
        prog="patcher",
        description="Apply or remove the Yapper Mod tweaks in the Yapper desktop app.",
    )
    ap.add_argument("command", choices=["install", "uninstall", "reinstall", "status"],
                    help="what to do")
    ap.add_argument("--path", help="path to the yapper-desktop folder")
    ap.add_argument("--force", action="store_true", help="overwrite an existing backup")
    args = ap.parse_args()
    return {
        "install": cmd_install,
        "uninstall": cmd_uninstall,
        "reinstall": cmd_reinstall,
        "status": cmd_status,
    }[args.command](args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)