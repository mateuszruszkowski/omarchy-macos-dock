# macos.dock

A compact, bottom-centered macOS-inspired dock plugin for Omarchy.

![Omarchy macOS dock preview](preview.png)

## Features

- Glassy floating dock surface
- Hover magnification and application tooltips, with configurable icon size,
  magnification and hover effect: the macOS wave, a zoom of only the hovered
  icon, or none
- Pinned application persistence
- Running-application indicators
- Pin, unpin, new-window, hide, and close actions. Pinning or unpinning an
  app from the dock (its menu, or dragging a pinned icon off the dock) shows a
  "Pinned …" / "Unpinned …" notification
- Hide: choose "Hide" in an app's menu (or right-click it with
  `"rightClick": "hide"`) to park all its windows on Hyprland's
  `special:minimized` workspace. Clicking the icon, a window preview or the app
  in Alt+Tab brings them back to the focused monitor's workspace
- Live window previews on hover, with cached thumbnail fallbacks
- Custom macOSicons, local PNG, and WebP icon overrides
- Point-and-click icon picker: open any app's menu and choose "Get Info…" to
  change its icon from macOSicons, your own image, or a direct image URL — no
  terminal needed
- "Manage Icons…" lets you assign icons to *any* installed app, even before it
  first appears on the dock
- macOS-style Alt+Tab application switcher (most-recently-used order)
- Auto-hide by default: the dock glides completely off-screen after 1s
  idle and reveals when the cursor hits the bottom 3px edge (100ms
  delay, 380ms hide / 280ms reveal). Tiled windows use the full screen
  — the dock overlays them like macOS. Toggle via dock menu or IPC,
  persists in `~/.config/omarchy/dock-settings.json`
- Tiling window adaptation: when auto-hide is off, it reserves its footprint
  as a Wayland exclusive zone, so tiled windows never overlap it

## Mouse controls

- Left click an icon: focus the app, bring back its hidden windows, or launch
  it.
- Right or middle click an icon: open the app menu (Get Info, Pin, New Window,
  Manage Icons, Hide, and the dock's hiding and side options).
- With `"rightClick": "hide"` in `dock-settings.json`, right click a running
  app to hide all its windows, and right click it again to bring them back
  once every window is hidden. Right click on an app that is not running
  still opens its menu, and middle click always does.
- Right or middle click empty dock space: open the icon manager.

## Install

Add and enable the plugin through Omarchy's plugin manager. The plugin's own
id is `macos.dock` (`manifest.json`'s `id` field), not the repository name:

```bash
omarchy plugin add https://github.com/ifubaraboye/omarchy-dock.git
omarchy plugin enable macos.dock
```

The custom-icon helper (search, set, list, clear — see "Custom icons" below) lives in the plugin's own `scripts/` directory, but nothing in Omarchy's plugin system installs it onto `PATH`; do it once by hand:

```bash
ln -sf ~/.config/omarchy/plugins/macos.dock/scripts/omarchy-dock-icon ~/.local/bin/omarchy-dock-icon
```

Without this, both the point-and-click picker and the `omarchy-dock-icon` CLI fail — the dock itself works fine either way.

The dock stores pins and auto-hide preference in:

```text
~/.config/omarchy/dock-pinned-macos.json
~/.config/omarchy/dock-settings.json
```

## Requirements and removal

This plugin requires Omarchy with Quickshell, plus `bash`, `curl`, `python3`,
ImageMagick (`magick` or `convert` and `identify`), and `xdg-open` for the
optional custom-icon helper.

For the best experience, use **floating windows** (not tiling): the dock is
designed to work with a floating layout where windows overlap its surface, and
it behaves best when windows are allowed to float over it rather than being
tiled up to its edges.

Tiled layouts are supported too: while the dock is visible ("Always Show"
mode), it claims its footprint (dock surface plus bottom margin) as a Wayland
exclusive zone, so tiled Hyprland windows reserve that space and never overlap
the dock. Hiding the dock releases the zone and tiled windows reclaim the
space. Floating windows are unaffected and may still overlap the dock by
design.

To remove the plugin, disable it and delete its installed directory (same id
as Install above, `macos.dock` — not the repository name; `disable` against a
nonexistent id exits 0 and disables nothing, so this is easy to get wrong
silently):

```bash
omarchy plugin disable macos.dock
rm -rf ~/.config/omarchy/plugins/macos.dock
omarchy restart shell
```

The plugin does not overwrite existing Omarchy or user configuration files.
It only creates or updates its own files under `~/.config/omarchy/` after the
user explicitly invokes a dock action or the custom-icon helper. Custom icon
files and mappings can be removed with `omarchy-dock-icon clear <app-id>`.

The repository author owns this plugin and has permission to submit the source
code and preview assets. External icons downloaded from macOSicons remain
subject to their respective rights and terms; users should only use assets
they are permitted to use.

Plugin-directory approval is for listing in the Omarchy plugin directory and
is not a security review or endorsement. Review the source and dependencies
before installing.

## Custom icons

### Point-and-click

No terminal required:

- **Right- or middle-click an app on the dock → "Get Info…"** opens an icon
  picker with suggested icons from macOSicons (searched by the app's name), a
  live search box, and options to use your own image or a direct image URL.
- **"Manage Icons…" in any app's menu, or a right or middle click on empty
  dock space,** browses every installed app. You can change an icon for an app
  that isn't on the dock yet. The icon is stored by app id, so it appears
  automatically the moment the app opens.

The picker applies changes instantly through the same helper the CLI uses
(download, trim, rounded corners, persistence) and the dock updates live.

### Apps with no icon at all (not even a generic one)

A few apps ship their `.desktop` file with `NoDisplay=true` — meaning "don't list me in an app launcher." QEMU is one (`qemu.desktop`, present when the `qemu` package is installed): a window with class `qemu` gets no icon anywhere in the dock, not even the generic fallback other unmatched windows get. This is not this plugin refusing to look one up: Quickshell's own `DesktopEntries.applications` list excludes `NoDisplay` entries before any plugin code runs, and there is no property on it to ask for them too.

"Manage Icons…" won't offer these apps either, since it browses that same list. The CLI is the only way in, because it takes the id directly instead of browsing a list:

```bash
omarchy-dock-icon set qemu --file ~/Pictures/qemu-icon.png
```

Any icon file works — nothing requires it to come from the app's own theme.

### Command line

For scripting, the same operations are available from a terminal:

```bash
omarchy-dock-icon search figma
omarchy-dock-icon set code figma-i3FsrkYvf6
omarchy-dock-icon set code --file ~/Pictures/code.png
omarchy-dock-icon set code https://example.com/icon.png
omarchy-dock-icon list
omarchy-dock-icon clear code
omarchy-dock-icon folder
```

The dock visibility shortcut is `SUPER + H`. It can also be controlled from a
terminal:

```bash
omarchy-shell macos.dock hide
omarchy-shell macos.dock show
omarchy-shell macos.dock toggle
```

Auto-hide is **enabled by default** (fresh installs and existing installs without
`dock-settings.json` both default to ON). The dock waits **1000ms** of idle
before gliding **380ms** completely off-screen; hitting the bottom **3px** edge
reveals it after **100ms** with a **280ms** glide up. It stays visible while
the cursor is over the dock *or* the bottom edge (`dockEngaged`), and hide is
suppressed while a menu, icon picker, window preview, drag, or Alt+Tab HUD is
active. Auto-hide can be toggled without restarting the shell:

```bash
# Right- or middle-click any dock icon → "Hiding on" / "Hiding off" in the Dock row
omarchy-shell -q macos.dock toggleAutoHide
omarchy-shell -q macos.dock setAutoHide true
omarchy-shell -q macos.dock setAutoHide false
omarchy-shell -q macos.dock getAutoHide
```

The preference is persisted in `~/.config/omarchy/dock-settings.json` and survives
restarts. When auto-hide is on, tiled windows use the full screen and the dock
overlays them; when off, the dock reserves its footprint as an exclusive zone.

## Alt+Tab application switcher

The plugin ships a macOS-style app switcher (a glass pill with the running
applications in most-recently-used order). No setup is needed: when the shell
starts, the plugin registers the bindings automatically:

- `ALT + GRAVE` (Alt + `` ` ``) — next application
- `ALT + SHIFT + GRAVE` (Alt + Shift + `` ` ``) — previous application

Behavior:

- Hold `Alt`, press `` ` `` to cycle forward, `Shift + `` ` `` to cycle
  backward. The first press selects the application after the currently
  focused one, like macOS.
- Release `Alt` to activate the selected application (its most recently
  focused window, or launch it if none is open).
- `Enter` activates the selection, `Escape` cancels without changing focus,
  arrow keys move the selection, and the mouse can hover to select or click
  to activate.
- The switcher opens on the dock's primary screen and cycles applications
  only — pinned-but-closed applications are never included.

### Changing the keybind

The registered binds live only for the current session (they are re-added at
each shell start and never written to any config file). To use a different
combination, add your own bind to `~/.config/hypr/bindings.lua` — your
config-file bind takes precedence over the plugin's default:

```lua
o.bind("ALT + TAB", "App switcher next", "omarchy-shell -q macos.dock altTabNext")
o.bind("ALT + SHIFT + TAB", "App switcher prev", "omarchy-shell -q macos.dock altTabPrev")
```

Note: Omarchy's default config already binds `ALT + TAB` to window cycling, so
if you rebind to `ALT + TAB` you must first free it with `hl.unbind("ALT + TAB")`
in your `bindings.lua` (and `hl.unbind("ALT + SHIFT + TAB")` for the previous
direction).

For testing without bindings:

```bash
omarchy-shell -q macos.dock altTabNext
omarchy-shell -q macos.dock altTabPrev
omarchy-shell -q macos.dock altTabCancel
```

Icons are normalized into transparent macOS-style rounded PNGs and metadata is
stored in `~/.config/omarchy/icons/` and `~/.config/omarchy/dock-icons.json`.
Changes are watched and applied without restarting the shell. The helper is installed at
`~/.local/bin/omarchy-dock-icon`.

## Configuration

The dock keeps all of its state under `~/.config/omarchy/`. The settings below
live in `dock-settings.json`, and edits to that file apply without restarting
the shell. Pins, order, and icon overrides are managed through the UI or the
icon CLI. Timing is baked in.

### Settings

| Setting | Type | Default | Stored in | Description |
|---|---|---|---|---|
| `autoHide` | bool | `true` | `dock-settings.json` | Glide off-screen when idle and reveal from the bottom edge. When off, the dock reserves its footprint as an exclusive zone. |
| `dockSide` | string | `"bottom"` | `dock-settings.json` | Screen edge the dock sits on: `"bottom"`, `"left"` or `"right"`. |
| `screen` | string | `""` | `dock-settings.json` | Monitor the dock (and the Alt+Tab switcher) appears on: an output name from `hyprctl monitors` such as `"DP-2"`, or `"focused"` to follow the focused monitor. Empty, or an output that is not connected, uses the first screen. |
| `iconSize` | int | `54` | `dock-settings.json` | Icon size in pixels, from 32 to 96. The dock height, slots, spacing, padding, corner radius, hover reach and launch bounce all scale with it. A number or numeric string is rounded, then clamped to the range; anything else uses the default. Written only when it is not the default. |
| `magnification` | number | `1.36` | `dock-settings.json` | Scale of the icon under the pointer, from 1.0 (no magnification) to 2.0. A number or numeric string is clamped to the range; anything else uses the default. Written only when it is not the default. |
| `hoverEffect` | string | `"wave"` | `dock-settings.json` | How icons react to the pointer. `"wave"` is the macOS magnification: the hovered icon grows to `magnification`, its neighbors grow less and slide apart, and the dock lengthens. `"zoom"` grows only the hovered icon to `magnification`, in place and over its neighbors; no other icon moves and the dock keeps its length. `"none"` grows nothing, whatever `magnification` says. Any other value uses the default. Written only when it is not the default. |
| `bounce` | bool | `true` | `dock-settings.json` | Bounce an app's icon when the app opens. Accepts `true`/`false` or the strings `"true"`/`"false"`; anything else uses the default. Written only when it is not the default. |
| `rightClick` | string | `"menu"` | `dock-settings.json` | What right-clicking an app icon does. `"menu"` opens the app menu. `"hide"` hides every window of a running app, or brings them back when all of them are hidden; an app that is not running still opens its menu. Middle click opens the menu in both modes. Any other value uses the default. Written only when it is not the default. |
| `pinned` | string[] | `[]` | `dock-pinned-macos.json` | App ids pinned to the dock (persists via Pin/Unpin). |
| `order` | string[] | `[]` | `dock-pinned-macos.json` | Full spatial order of dock items (pinned + running). |
| custom icon mappings | object | `{}` | `dock-icons.json` | Per-app-id icon override (`file`, `source`, `imageUrl`). Managed via "Get Info…", "Manage Icons…", or `omarchy-dock-icon`. |

### IPC commands

All commands are invoked as `omarchy-shell [-q] macos.dock <command>`:

| Command | Args | Description |
|---|---|---|
| `toggle` | — | Show/hide the dock |
| `show` | — | Show the dock |
| `hide` | — | Hide the dock |
| `toggleAutoHide` | — | Toggle auto-hide (persisted) |
| `setAutoHide` | `true`/`false` | Set auto-hide explicitly (persisted) |
| `getAutoHide` | — | Print current auto-hide state |
| `altTabNext` | — | Next application in the switcher |
| `altTabPrev` | — | Previous application in the switcher |
| `altTabCancel` | — | Dismiss the switcher without changing focus |
| `hideActive` | — | Hide the focused window (bind it to a key, e.g. `SUPER + H`) |
| `hideApp` | app id | Hide every window of an app, like the menu's "Hide" |
| `activateApp` | app id | Like clicking the dock icon: focus, unhide, or launch |
| `activateWindow` | window address | Like clicking a preview card: focus or unhide one window |

### Built-in constants (not configurable)

- Timing: 1000ms idle hide delay, 100ms edge-reveal delay, 380ms hide / 280ms
  show animation, 180ms window-preview delay, 300ms persist debounce
- Geometry: the stock dock has a 54px icon in a 78px dock, 60px slots, 6px
  spacing, 12px side padding, a 96px hover reach and an 18px corner radius.
  Every one of these scales with `iconSize`. The 4px margin to the screen edge
  stays fixed
- Edge trigger: bottom 3px of the screen

### Full default config file

`~/.config/omarchy/dock-settings.json`:

```json
{
  "version": 1,
  "autoHide": true,
  "dockSide": "bottom"
}
```

A dock with larger icons, a stronger zoom of only the hovered icon and no
launch bounce:

```json
{
  "version": 1,
  "autoHide": true,
  "dockSide": "bottom",
  "iconSize": 72,
  "magnification": 1.6,
  "bounce": false,
  "hoverEffect": "zoom"
}
```

For reference, the companion files with all defaults applied:

`~/.config/omarchy/dock-pinned-macos.json`:

```json
{
  "version": 1,
  "pinned": [],
  "order": []
}
```

`~/.config/omarchy/dock-icons.json`:

```json
{}
```

## Development

```bash
./tests/run.sh
qmllint DockPanel.qml DockItem.qml DockMenu.qml
```

The dock is intended for a single output. By default it uses the first configured Quickshell screen; set `screen` in `dock-settings.json` to put it on a specific monitor.
