# Yapper Mod Patcher

Installs and removes the local **Yapper Mod** tweaks inside the Yapper desktop app.

The mod lives in a tab called **Yapper Mod** inside Yapper's own Settings, and it is
entirely reversible: the original archive is kept and `uninstall` puts it back
byte-for-byte.

---

## Quick start

Double-click one of these:

| File | What it does |
|---|---|
| `install.bat` | Back up the original and apply the mod |
| `uninstall.bat` | Restore the original Yapper |
| `status.bat` | Show whether the mod is currently installed |

Or from a terminal:

```
python patcher.py install
python patcher.py uninstall
python patcher.py reinstall
python patcher.py status
```

Add `--path "C:\...\yapper-desktop"` if Yapper lives somewhere unusual, and
`--force` to overwrite an existing backup.

---

## Requirements

- Windows
- Python 3.8 or newer (only for running the patcher, not for Yapper itself)
- **Quit Yapper before installing or uninstalling.** The patcher will tell you if
  it is still running.

---

## How it works

Yapper is an Electron application. Its JavaScript is bundled into a single
archive at:

```
resources/app.asar
```

The patcher unpacks that archive, swaps in the two modified files from
`payload/` (`main.js` and `preload.js`), recomputes the per-file SHA-256 integrity
blocks, and repacks it in the exact layout Electron expects.

**Nothing outside `resources/app.asar` is modified**, and the untouched original
is saved alongside as `app.asar.vanilla` before anything is written.

### Safety properties

- **Byte-exact rollback** — `uninstall` restores the original archive; the SHA-256
  matches the pre-install file exactly.
- **Self-verifying** — the repacked archive is re-parsed before it replaces the
  live one, so a malformed bundle is never written.
- **Fail-safe ordering** — the backup is taken first. If any later step fails,
  the original is still on disk.
- **Atomic swap** — the new archive is written to a temporary file and moved into
  place with a single replace, so the install cannot leave a half-written archive.

---

## Layout

```
yapper-mod-patcher/
├── patcher.py        the tool
├── install.bat       one-click install
├── uninstall.bat     one-click uninstall
├── status.bat        one-click status check
└── payload/
    ├── main.js       patched application script
    ├── preload.js    patched preload bridge
    └── icon.png      application icon
```

---

## Features

The mod adds a **Yapper Mod** tab to Yapper's Settings. Everything there is off
by default.

**Appearance** — media placeholders, window corner radius, backdrop media,
ambient transitions, unscripted palette, monochrome surfaces

**Messaging** — message audit trail, author identity labels

**Profile & presence** — condensed biographies, personal avatar frame, unified presence

**Interface** — vector iconography, custom stylesheet with a built-in editor

It also adds **server folders** to the rail: drag one server onto another to
group them, click to expand, right-click to rename or give it an image.

Settings persist to `%APPDATA%\Yapper\yapper-mod.json`.

---

## Troubleshooting

**"Could not find Yapper"** — pass `--path` pointing at the `yapper-desktop`
folder.

**"Yapper is running"** — quit it from the tray icon, then retry.

**Something looks wrong after installing** — run `uninstall.bat` to get back to
a clean Yapper, then reinstall.

**An update wiped the mod** — Yapper auto-updates from GitHub releases and
replaces `app.asar`. Just run `install.bat` again afterwards.