# Mouse Remapper helper for Windows

The Windows counterpart of `native/MouseRemapHelper.swift`. The Electron app starts it, it reads the shared
`config.json` (`%AppData%\MouseRemapper\config.json`) and remaps mouse input with a low-level mouse hook
(`WH_MOUSE_LL`), injecting input with `SendInput`.

## Layout

The decisions are separated from the operating system so almost all of it is tested on any machine:

| File | What it holds | Tested on |
|---|---|---|
| `config.go`, `store.go` | config model, lenient parsing, file following (never overwrites an unreadable file) | anywhere |
| `engine.go` | what to do with each mouse event (profiles, gestures, scroll) against a `Host` interface | anywhere |
| `gesture.go`, `scroll.go` | gesture tracker, scroll adjuster and smoother | anywhere |
| `keymap.go`, `plan.go` | macOS key codes → Windows keys, and the input sequences for each action | anywhere |
| `hook_events.go` | translation of hook messages (XBUTTON, wheel sign, ...) into events | anywhere |
| `platform_windows.go` | the thin Win32 layer: hook, `SendInput`, foreground app, app lists | Windows only (CI) |
| `platform_other.go` | stubs so everything else builds off Windows | – |

## Build and test

```
go test ./...                                   # portable logic, on any OS
go build -trimpath -ldflags "-s -w" -o MouseRemapHelper.exe .     # on Windows (or set GOOS=windows)
```

`npm start` at the repository root builds it automatically on Windows (Go must be installed).

`win_windows_test.go` only runs on Windows: it checks that every Win32 export the helper resolves at run time
exists, that the `INPUT` structs have the layout `SendInput` expects, and that the real hook translates, swallows
and re-injects events. `.github/workflows/windows-helper.yml` runs it on a Windows runner.

## Command line

| Argument | Output |
|---|---|
| *(none)* | runs the hook until killed |
| `--check-permission` | `true` (Windows has no permission to grant) |
| `--list-apps` | JSON list of apps with a visible window (`name`, `bundleIdentifier` = lower-case exe name, `path`) |
| `--resolve-apps=a.exe,b.exe` | same shape, for apps that may not be running (looked up in the App Paths registry) |

Environment hooks for tests: `MOUSE_REMAP_CONFIG=<file>` uses another config; `MOUSE_REMAP_DRY_RUN=1` prints
`ACTION ...`, `REPLAY ...` and `SMOOTH ...` lines instead of injecting input (same wording as the macOS helper).

## Known limits

- Apps running as administrator do not receive remapped input unless this helper also runs as administrator.
- Precision touchpads and high-resolution wheels send wheel deltas that are not multiples of 120; those are left alone.
- Only the middle button and the two side buttons (XBUTTON1/2) exist for the standard hook.
- 64-bit Windows only.
