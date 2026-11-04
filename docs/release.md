# Releasing Zara

Status 2026-11-01: an unsigned per-user installer can be built locally. Signing, an update feed and a release workflow are not set up yet, on purpose: they need credentials that only the owner can create.

## Build an installer

```powershell
bun install --frozen-lockfile
bun run tauri build
```

Output: `src-tauri\target\release\bundle\nsis\Zara_<version>_x64-setup.exe`. The installer is NSIS only, per user (no administrator prompt), x64. WebView2 is bootstrapped if missing.

## Before a public release

1. **Code signing.** An unsigned build triggers Microsoft SmartScreen and may trigger Defender (apps that use low-level Windows hooks are sometimes flagged). Get a code-signing certificate, or use Azure Trusted Signing, and sign the installer and `zara.exe`. If Defender still flags the signed build, submit it to Microsoft for analysis.
2. **Auto-update.** Set up; see "Publishing an update" below.
3. **Source availability.** Zara is GPL-3.0-only. Anyone who receives the installer is entitled to the corresponding source: publish the repository (or a source archive) with each release, and keep `LICENSE` and `NOTICE` intact.
4. **Version.** `bun run bump <x.y.z>` updates `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` together.

## Publishing an update

Installed copies of Zara check `https://github.com/tevinowino/zara-assistant/releases/latest/download/latest.json` a little after startup, and in Settings > About on request. When it names a newer version they ask the user, download the installer, verify its signature against the public key in `tauri.conf.json`, install it and restart.

**One-time setup**

1. The signing key was generated with `bun x tauri signer generate`. The private key lives outside the repository (`C:\Users\tevoh\.zara-signing\updater.key`); the public key is in `src-tauri/tauri.conf.json`. **Back the private key up somewhere safe.** If it is lost, copies already installed can never accept an update, because the public key inside them cannot be changed.
2. In the GitHub repository, open Settings > Secrets and variables > Actions and add `TAURI_SIGNING_PRIVATE_KEY` with the whole contents of `updater.key`. The key has no password, so no password secret is needed.
3. The repository account must be able to run Actions (a billing lock on the account stops every job).

**Each release**

```powershell
bun run release 0.2.0
```

This bumps the version in `package.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, commits, tags `v0.2.0` and pushes. The Release workflow (`.github/workflows/release.yml`) then builds the installer, signs it, and publishes a GitHub Release with the installer, its `.sig` file and `latest.json`. Copies of version 0.1.0 and later will offer 0.2.0.

The version must go up: an update is only offered when `latest.json` names a version higher than the one installed. Copies built before the updater existed cannot update themselves once, and need the new installer by hand.

To try the signing locally:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content C:\Users\tevoh\.zara-signing\updater.key -Raw
bun run tauri build
```

The build then also writes `Zara_<version>_x64-setup.exe.sig` next to the installer.

## Release checklist

Automatic (CI runs these on every push):

- [ ] `bun run build`
- [ ] `bun test` (pure TypeScript)
- [ ] `bun run test:unit` (components and libraries)
- [ ] `cargo clippy --locked --all-targets -- -D warnings`
- [ ] `cargo test --locked`

By hand, on a clean Windows 10 and a Windows 11 machine (or VM), with an administrator-free user:

- [ ] Install, start, notch appears; the Windows taskbar is untouched
- [ ] First run: the assistant panel asks for an API key; a wrong key shows an error, a right one works
- [ ] Ask a question; ask "what's on my screen?"; ask about notes
- [ ] Stealth on: Snipping Tool, Game Bar and a conferencing app's screen share do not show Zara; Settings > Assistant > Verify now says Active
- [ ] Shortcuts: change one to a combination another app holds; Zara explains and falls back; release the other app and reopen Settings; the choice takes effect
- [ ] Library: import from a previous Zara if one exists; old files unchanged
- [ ] Sleep and wake; lock and unlock; change display scaling; unplug a monitor: notch, stealth and shortcuts survive
- [ ] Quit from the tray: the reserved top strip is released (maximise a window and check there is no gap)
- [ ] Uninstall: no leftover tray icon, no autostart entry

Not yet automated: end-to-end journeys with `tauri-driver`. The manual smoke test used during development drives the real app through the WebView debug port; see the commit history for the approach.
