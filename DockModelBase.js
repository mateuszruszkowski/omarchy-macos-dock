.pragma library

var DEFAULT_PINNED = []

// Fixed macOS-style section. These ids are not apps: they never join the
// pinned list or the reorderable dock order, and the separator always sits
// after every pinned and running icon.
var SEPARATOR_ID = "__separator__"
var DOWNLOADS_ID = "downloads"
var TRASH_ID = "trash"

var lastWrittenHash = null

function normalizeId(value) {
    var id = String(value || "").trim()
    return id.endsWith(".desktop") ? id.slice(0, -8) : id
}

// Combines the shell's app-library view with the desktop-entry index. The
// former may be ordered/fuzzy and may omit apps that have no open window;
// the latter is the complete set of entries Quickshell exposes. Earlier
// entries win so the app-library's richer metadata remains authoritative.
function mergeAppEntries(primary, secondary) {
    var result = []
    var seen = {}

    function append(source) {
        ;(source || []).forEach(function(row) {
            var entry = row && row.entry ? row.entry : row
            if (!entry) return
            var id = normalizeId(entry.id || entry.desktopId)
            if (!id || seen[id]) return

            var copy = {}
            for (var key in entry) copy[key] = entry[key]
            copy.id = id
            if (!copy.name) copy.name = copy.displayName || id
            if (!copy.icon) copy.icon = copy.iconName || copy.appIcon || ""

            seen[id] = true
            result.push(copy)
        })
    }

    append(primary)
    append(secondary)
    return result
}

function stripDesktop(value) { return normalizeId(value) }

function toArray(value) {
    if (Array.isArray(value)) return value
    if (value && Array.isArray(value.pinned)) return value.pinned
    return []
}

function parsePinned(text, fallback) {
    var source = String(text || "").trim()
    if (!source) return (fallback || DEFAULT_PINNED).slice()
    try {
        var parsed = JSON.parse(source)
        var values = toArray(parsed)
        var result = []
        values.forEach(function(value) {
            var id = normalizeId(value)
            if (id && result.indexOf(id) === -1) result.push(id)
        })
        return result
    } catch (error) {
        return (fallback || DEFAULT_PINNED).slice()
    }
}

function serializePinned(ids, order) {
    var clean = parsePinned(JSON.stringify(ids || []), [])
    var orderClean = []
    ;(order || []).forEach(function(value) {
        var id = normalizeId(value)
        if (id && orderClean.indexOf(id) === -1) orderClean.push(id)
    })
    return JSON.stringify({ version: 1, pinned: clean, order: orderClean }, null, 2) + "\n"
}

// Reads the persisted full dock order. The `order` field records the spatial
// layout (pinned and running interleaved); `pinned` records membership only.
// A legacy file without the field falls back to the caller's current order.
function parseOrder(text, fallback) {
    var source = String(text || "").trim()
    if (!source) return (fallback || []).slice()
    try {
        var parsed = JSON.parse(source)
        if (!parsed || !Array.isArray(parsed.order)) return (fallback || []).slice()
        var result = []
        parsed.order.forEach(function(value) {
            var id = normalizeId(value)
            if (id && result.indexOf(id) === -1) result.push(id)
        })
        return result
    } catch (error) {
        return (fallback || []).slice()
    }
}

function isPinned(ids, id) {
    return (ids || []).indexOf(normalizeId(id)) !== -1
}

function togglePinned(ids, id) {
    var next = (ids || []).slice()
    var value = normalizeId(id)
    var index = next.indexOf(value)
    if (index >= 0) next.splice(index, 1)
    else if (value) next.push(value)
    return next
}

function reorderPinned(ids, fromIndex, toIndex) {
    var next = (ids || []).slice()
    if (fromIndex < 0 || fromIndex >= next.length || toIndex < 0 || toIndex >= next.length)
        return next
    var item = next.splice(fromIndex, 1)[0]
    next.splice(toIndex, 0, item)
    return next
}

function insertPinned(ids, id, index) {
    var value = normalizeId(id)
    var next = (ids || []).slice()
    if (!value || next.indexOf(value) !== -1) return next
    var idx = Math.max(0, Math.min(index || 0, next.length))
    next.splice(idx, 0, value)
    return next
}

function removePinned(ids, id) {
    var value = normalizeId(id)
    var next = (ids || []).slice()
    var index = next.indexOf(value)
    if (index >= 0) next.splice(index, 1)
    return next
}

// Builds the visual order of items that flow through the dock. `floatingId`
// is the item being dragged (excluded from the flow; the ghost represents it),
// and `phantomIndex` (>= 0) inserts an empty placeholder slot anywhere in the
// full flow (pinned cluster followed by running unpinned apps) that shows
// where the dragged item will settle, so the gap tracks the cursor across the
// entire dock.
function buildFlow(pinned, runningUnpinned, floatingId, phantomIndex) {
    var flow = []
    var floating = normalizeId(floatingId)
    var hasPhantom = typeof phantomIndex === "number" && phantomIndex >= 0
    var combined = []

    ;(pinned || []).forEach(function(id) {
        var value = normalizeId(id)
        if (value !== floating) combined.push({ id: value })
    })
    ;(runningUnpinned || []).forEach(function(id) {
        var value = normalizeId(id)
        if (value !== floating) combined.push({ id: value })
    })

    var idx = hasPhantom ? Math.max(0, Math.min(phantomIndex, combined.length)) : -1
    for (var i = 0; i < combined.length; i++) {
        if (hasPhantom && i === idx) flow.push({ id: "__phantom__", phantom: true })
        flow.push(combined[i])
    }
    if (hasPhantom && idx === combined.length) flow.push({ id: "__phantom__", phantom: true })
    return flow
}

// Builds the session dock order: pinned apps first (persistent), then running
// apps that are not pinned, preserving their previous relative order so drag
// reorders survive window/app refreshes. Unknown apps append in list order.
function buildDockOrder(pinnedIds, runningIds, previousOrder) {
    var pinned = (pinnedIds || []).map(normalizeId)
    var running = (runningIds || []).map(normalizeId)
    var unpinned = []
    running.forEach(function(id) {
        if (pinned.indexOf(id) === -1 && unpinned.indexOf(id) === -1) unpinned.push(id)
    })
    var position = {}
    ;(previousOrder || []).forEach(function(id, index) { position[normalizeId(id)] = index })
    unpinned.sort(function(a, b) {
        var pa = position[a] === undefined ? 9999 : position[a]
        var pb = position[b] === undefined ? 9999 : position[b]
        return pa - pb
    })
    return pinned.concat(unpinned)
}

// Reconciles the session order against reality: keeps every app that is still
// pinned or running in its current position, appends newly pinned and newly
// running apps in order. This is what lets any app sit in any slot without
// being persisted.
function reconcileDockOrder(previousOrder, pinnedIds, runningIds) {
    var pinned = (pinnedIds || []).map(normalizeId)
    var running = (runningIds || []).map(normalizeId)
    var result = []
    ;(previousOrder || []).forEach(function(id) {
        var value = normalizeId(id)
        if (running.indexOf(value) !== -1 || pinned.indexOf(value) !== -1)
            result.push(value)
    })
    pinned.forEach(function(id) { if (result.indexOf(id) === -1) result.push(id) })
    running.forEach(function(id) { if (result.indexOf(id) === -1) result.push(id) })
    return result
}

// Moves an app to a new slot within the session order. Returns a new array.
function moveInOrder(order, id, index) {
    var value = normalizeId(id)
    var next = (order || []).slice()
    var from = next.indexOf(value)
    if (from < 0) {
        var idx = Math.max(0, Math.min(index || 0, next.length))
        next.splice(idx, 0, value)
        return next
    }
    next.splice(from, 1)
    var idx = Math.max(0, Math.min(index || 0, next.length))
    next.splice(idx, 0, value)
    return next
}

// Keeps only the pinned members of an order, in that order (used to persist
// pinned-app rearrangements without ever persisting running apps).
function orderPinned(order, pinnedIds) {
    var result = []
    ;(order || []).forEach(function(id) {
        var value = normalizeId(id)
        if ((pinnedIds || []).indexOf(value) !== -1 && result.indexOf(value) === -1)
            result.push(value)
    })
    return result
}

// Smooth pointer wave used by the dock. The cosine falloff keeps the hover
// response soft at both ends of the reach; the matching ramp is its integral,
// so neighboring slots move exactly far enough to make room for the growth.
function hoverFalloff(distance, reach) {
    var t = Math.abs(distance) / reach
    if (t >= 1) return 0
    return 0.5 * (1 + Math.cos(Math.PI * t))
}

function hoverRamp(distance, reach) {
    var u = distance / reach
    if (u >= 1) return 0.5
    if (u <= -1) return -0.5
    return 0.5 * u + Math.sin(Math.PI * u) / (2 * Math.PI)
}

// What the pointer does to the resting row, per hover effect: a scale and a
// sideways shift for every slot, and the width the row then takes up. A slot
// spans slot * scale from its resting x plus the shift. "none" has no entry of
// its own: dockMetrics gives it hoverScale 1, so the wave leaves the row alone.
var HOVER_LAYOUTS = {
    // Every slot within reach grows by the cosine falloff, and the ramp moves
    // the neighbors exactly far enough to make room, so the dock grows.
    wave: function(resting, pointer, contentWidth, opts) {
        // A pointer left of the row's start leaves the wave at rest.
        if (pointer < 0) return null
        var reach = Math.max(opts.slotWidth, opts.radius)
        var spread = opts.iconSize * (opts.hoverScale - 1) * (reach / opts.slotWidth)
        var recenter = (spread * hoverRamp(-pointer, reach) + spread * hoverRamp(contentWidth - pointer, reach)) / 2
        var grown = 0
        var slots = resting.map(function(entry) {
            if (entry.item.separator) return { scale: 1, shift: 0 }
            var distance = entry.center - pointer
            var scale = 1 + (opts.hoverScale - 1) * hoverFalloff(distance, reach)
            grown += entry.slot * (scale - 1)
            return { scale: scale, shift: spread * hoverRamp(distance, reach) - recenter }
        })
        return { slots: slots, width: contentWidth + grown }
    },
    // Only the slot nearest the pointer, within half a slot pitch, grows, around
    // its own center and over its neighbors. Past either end of the row the
    // end slot grows, so the part of it that sticks out stays under the
    // pointer. Nothing moves and the dock keeps its length.
    zoom: function(resting, pointer, contentWidth, opts) {
        var target = -1
        var last = resting.length - 1
        for (var i = 0; i <= last; i++) {
            if (Math.abs(resting[i].center - pointer) <= (resting[i].slot + opts.spacing) / 2) target = i
        }
        if (target < 0 && last >= 0) target = pointer < resting[0].center ? 0 : (pointer > resting[last].center ? last : -1)
        if (target >= 0 && resting[target].item.separator) target = -1
        var slots = resting.map(function(entry, i) {
            var scale = i === target ? opts.hoverScale : 1
            return { scale: scale, shift: -entry.slot * (scale - 1) / 2 }
        })
        return { slots: slots, width: contentWidth }
    }
}

// Continuous layout driven by the cursor. Slot centers are measured from the
// resting row, then every slot receives a scale and a shift. This is
// important: measuring each center after the previous slot has grown makes the
// hover wave feed back into itself and causes the row to wobble at the edges.
function computeLayout(flow, cursorX, opts) {
    opts = opts || LAYOUT_OPTS
    var resting = []
    var x = 0
    for (var i = 0; i < flow.length; i++) {
        var item = flow[i]
        var slot = item.separator ? opts.separatorWidth : opts.slotWidth
        resting.push({ item: item, x: x, slot: slot, center: x + slot / 2 })
        x += slot + opts.spacing
    }
    var contentWidth = Math.max(0, x - opts.spacing)

    // NaN (or no number) is no pointer. A negative x is the pointer left of
    // the row, over the dock's padding.
    var cursorValid = typeof cursorX === "number" && isFinite(cursorX)
    var layout = HOVER_LAYOUTS[opts.hoverEffect] || HOVER_LAYOUTS.wave
    var hover = cursorValid ? layout(resting, cursorX, contentWidth, opts) : null
    var placements = {}
    resting.forEach(function(entry, j) {
        var slotHover = hover ? hover.slots[j] : { scale: 1, shift: 0 }
        placements[entry.item.id] = {
            x: entry.x + slotHover.shift,
            scale: slotHover.scale,
            lift: (slotHover.scale - 1) * opts.iconSize * 0.5,
            phantom: !!entry.item.phantom
        }
    })
    var flowWidth = hover ? hover.width : contentWidth
    return { placements: placements, flowWidth: flowWidth, totalWidth: flowWidth + 2 * opts.sidePadding }
}

// Returns the flow index the cursor currently falls over (0..flow.length),
// using the same scaled geometry as the rendered layout so the drop lands
// on the icon the user sees.
function insertionIndexFor(cursorX, flow, opts) {
    opts = opts || LAYOUT_OPTS
    if (!flow || flow.length === 0) return 0
    var x = 0
    // Zoom moves nothing, so its drop slots are the resting ones.
    var waves = typeof cursorX === "number" && cursorX >= 0 && opts.hoverEffect !== "zoom"
    for (var i = 0; i < flow.length; i++) {
        var item = flow[i]
        var slot = item.separator ? opts.separatorWidth : opts.slotWidth
        var center = x + slot / 2
        var scale = 1
        if (waves) {
            var reach = Math.max(opts.slotWidth, opts.radius)
            scale = 1 + (opts.hoverScale - 1) * hoverFalloff(cursorX - center, reach)
        }
        if (cursorX < x + slot * scale / 2) return i
        x += slot * scale + opts.spacing
    }
    return flow.length
}

function isWebAppClass(value) {
    var v = String(value || "").toLowerCase()
    if (/^chrome[-_.]/.test(v) || /^chromium[-_.]/.test(v) || /^google-chrome[-_.]/.test(v)) return true
    if (/__-default(-\d+)?$/.test(v) || /\.-default(-\d+)?$/.test(v)) return true
    return /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/.test(v)
}

// Resolves a window class/appId to a desktop-entry id. Pass 1 is an exact
// id match; pass 2 is the legacy Name-substring fallback, gated on
// isWebAppClass() so short web-app names (e.g. `X`) cannot hijack ordinary
// classes such as `firefox` (see issue #19). Returns the normalized raw id
// when nothing matches, mirroring the previous QML fallback.
function desktopIdForWindow(rawId, entries) {
    var raw = normalizeId(rawId)
    var lower = raw.toLowerCase()
    if (!lower) return ""
    var list = entries || []
    for (var i = 0; i < list.length; i++) {
        var entry = list[i] && list[i].entry ? list[i].entry : (list[i] || {})
        var id = normalizeId(entry.id || entry.desktopId)
        if (id && id.toLowerCase() === lower) return id
    }
    if (!isWebAppClass(lower)) return raw
    for (var j = 0; j < list.length; j++) {
        var candidate = list[j] && list[j].entry ? list[j].entry : (list[j] || {})
        var candidateId = normalizeId(candidate.id || candidate.desktopId)
        var name = String(candidate.name || candidate.displayName || "").toLowerCase()
        if (candidateId && name && lower.indexOf(name) !== -1) return candidateId
    }
    return raw
}

function isSpecialId(id) {
    var value = normalizeId(id)
    return value === SEPARATOR_ID || value === DOWNLOADS_ID || value === TRASH_ID
}

function stripSpecialIds(ids) {
    var result = []
    ;(ids || []).forEach(function(id) {
        var value = normalizeId(id)
        if (!value || isSpecialId(value) || result.indexOf(value) !== -1) return
        result.push(value)
    })
    return result
}

// Downloads and Trash, preceded by the divider. Omitted entirely when both
// toggles are off so the dock does not keep an empty separator. `trashFull`
// only swaps the trash icon; the item stays in the same slot.
function specialSection(options) {
    var opts = options || {}
    var showDownloads = opts.showDownloads !== false
    var showTrash = opts.showTrash !== false
    if (!showDownloads && !showTrash) return []
    var items = [{
        id: SEPARATOR_ID, separator: true, name: "", icon: "",
        pinned: false, running: false, special: true
    }]
    if (showDownloads) items.push({
        id: DOWNLOADS_ID, name: "Downloads", icon: "folder-download",
        pinned: false, running: false, special: true
    })
    if (showTrash) items.push({
        id: TRASH_ID, name: "Trash", icon: opts.trashFull ? "user-trash-full" : "user-trash",
        pinned: false, running: false, special: true
    })
    return items
}

// Appends the fixed section after the app flow. Special ids already present
// (a stale pin, a drag) are dropped so they cannot sit among apps; the
// phantom placeholder is left where buildFlow put it.
function appendSpecialItems(flow, options) {
    var next = []
    ;(flow || []).forEach(function(item) {
        if (!item) return
        if (!item.phantom && isSpecialId(item.id)) return
        next.push(item)
    })
    return next.concat(specialSection(options))
}

function entryFor(id, entries) {
    var value = normalizeId(id)
    var list = entries || []
    var lowerValue = value.toLowerCase()
    for (var i = 0; i < list.length; i++) {
        var entry = list[i] && list[i].entry ? list[i].entry : (list[i] || {})
        var candidate = normalizeId(entry.id || entry.desktopId)
        if (candidate === value || candidate.toLowerCase() === lowerValue) return entry
    }
    var pretty = value.split(".").pop().replace(/[-_]+/g, " ").trim()
    if (pretty) pretty = pretty.charAt(0).toUpperCase() + pretty.slice(1)
    return { id: value, name: pretty || value, icon: "application-x-executable" }
}

function buildDockItems(pinned, entries, runningIds, options) {
    var result = []
    var pinnedIds = stripSpecialIds(pinned)
    var running = stripSpecialIds(runningIds || [])
    pinnedIds.forEach(function(id) {
        var entry = entryFor(id, entries)
        result.push({ id: normalizeId(id), name: entry.name || entry.displayName || id,
            icon: entry.icon || entry.iconName || "", pinned: true,
            running: running.indexOf(normalizeId(id)) >= 0 })
    })

    var unpinned = []
    running.forEach(function(id) {
        var normalized = normalizeId(id)
        if (!isPinned(pinnedIds, normalized) && unpinned.indexOf(normalized) === -1)
            unpinned.push(normalized)
    })
    unpinned.forEach(function(id) {
        var entry = entryFor(id, entries)
        result.push({ id: id, name: entry.name || entry.displayName || id,
            icon: entry.icon || entry.iconName || "", pinned: false, running: true })
    })
    return appendSpecialItems(result, options)
}

function hashContent(value) {
    var text = String(value || "")
    var hash = 0
    for (var i = 0; i < text.length; i++)
        hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0
    return hash
}

function shouldReprocess(content) {
    return hashContent(content) !== lastWrittenHash
}

function markWritten(content) { lastWrittenHash = hashContent(content) }

function resetWrittenGuard() { lastWrittenHash = null }

// ---- Dock settings (dock-settings.json) ----------------------------------
var lastSettingsHash = null

var DEFAULT_SETTINGS = {
    autoHide: true,
    dockSide: "bottom",
    screenMode: "all",
    showDownloads: true,
    showTrash: true,
    iconSize: 54,
    magnification: 1.36,
    bounce: true,
    rightClick: "menu",
    hoverEffect: "wave"
}
var RIGHT_CLICK_MODES = ["menu", "hide"]
// "wave": the hovered icon and its neighbors grow and make room (macOS).
// "zoom": only the hovered icon grows, in place. "none": nothing grows.
var HOVER_EFFECTS = ["wave", "zoom", "none"]
var ICON_SIZE_RANGE = [32, 96]
var MAGNIFICATION_RANGE = [1, 2]

function normalizeSide(side) {
    var s = String(side || "bottom").toLowerCase()
    if (s === "left" || s === "right") return s
    return "bottom"
}

// Which outputs the dock occupies: "all" (every connected output, the
// default), "focused" (the focused monitor only, following focus), "primary"
// (the first screen only), or an output name from `hyprctl monitors` such as
// "DP-1".
function normalizeScreenMode(value) {
    if (typeof value !== "string") return "all"
    var mode = value.trim()
    if (!mode) return "all"
    var keyword = mode.toLowerCase()
    return keyword === "all" || keyword === "primary" || keyword === "focused" ? keyword : mode
}

// The output a "focused" dock lives on.
//   names       connected output names, in Quickshell order
//   want        "focused", or an output name
//   focusedName name of the focused monitor ("" if unknown)
//   currentName output the dock is on now ("" if none)
//   frozen      true while a menu/preview/drag is open: keep the dock where
//               it is instead of following focus out from under the user
// Falls back to the first output when the wanted one is missing.
function pickScreenName(names, want, focusedName, currentName, frozen) {
    var list = names || []
    if (frozen && currentName && list.indexOf(currentName) >= 0) return currentName
    var target = want === "focused" ? focusedName : want
    if (target && list.indexOf(target) >= 0) return target
    return list.length > 0 ? list[0] : ""
}

// true or false for a boolean or its "true"/"false" string, else undefined.
function flagSetting(value) {
    if (typeof value === "boolean") return value
    if (value === "true" || value === "false") return value === "true"
    return undefined
}

// A finite number or a non-empty numeric string as a number; NaN otherwise.
function settingNumber(value) {
    if (typeof value === "number") return value
    if (typeof value === "string" && value.trim()) return Number(value)
    return NaN
}

// value trimmed and lowercased when it is one of `choices`, "" otherwise.
function choiceSetting(value, choices) {
    var choice = typeof value === "string" ? value.trim().toLowerCase() : ""
    return choices.indexOf(choice) >= 0 ? choice : ""
}

function clamp(value, range) {
    return Math.min(range[1], Math.max(range[0], value))
}

// Every recognized key of `source` over `base`. A value of the wrong type
// keeps the base value, so one bad key never resets the others.
function overlaySettings(base, source) {
    var out = {}
    for (var key in DEFAULT_SETTINGS) out[key] = base[key]
    if (typeof source.autoHide === "boolean") out.autoHide = source.autoHide
    else if (typeof source.autoHide === "string") out.autoHide = source.autoHide === "true"
    if (source.dockSide !== undefined) out.dockSide = normalizeSide(source.dockSide)
    if (typeof source.screenMode === "string") out.screenMode = normalizeScreenMode(source.screenMode)
    // `screen` is the key this setting had before the dock could span outputs:
    // an output name or "focused".
    else if (typeof source.screen === "string" && source.screen.trim()) out.screenMode = normalizeScreenMode(source.screen)
    var size = settingNumber(source.iconSize)
    if (isFinite(size)) out.iconSize = clamp(Math.round(size), ICON_SIZE_RANGE)
    var magnification = settingNumber(source.magnification)
    if (isFinite(magnification)) out.magnification = clamp(magnification, MAGNIFICATION_RANGE)
    ;["bounce", "showDownloads", "showTrash"].forEach(function(key) {
        var flag = flagSetting(source[key])
        if (flag !== undefined) out[key] = flag
    })
    var rightClick = choiceSetting(source.rightClick, RIGHT_CLICK_MODES)
    if (rightClick) out.rightClick = rightClick
    var hoverEffect = choiceSetting(source.hoverEffect, HOVER_EFFECTS)
    if (hoverEffect) out.hoverEffect = hoverEffect
    return out
}

function parseSettings(text, fallback) {
    var base = overlaySettings(DEFAULT_SETTINGS, fallback || {})
    var source = String(text || "").trim()
    if (!source) return base
    try {
        var parsed = JSON.parse(source)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return base
        return overlaySettings(base, parsed)
    } catch (error) {
        return base
    }
}

function serializeSettings(settings) {
    var value = settings && typeof settings.autoHide === "boolean" ? settings.autoHide : true
    var side = normalizeSide(settings && settings.dockSide)
    var out = {
        version: 1,
        autoHide: value,
        dockSide: side,
        screenMode: normalizeScreenMode(settings && settings.screenMode),
        showDownloads: flagSetting(settings && settings.showDownloads) !== false,
        showTrash: flagSetting(settings && settings.showTrash) !== false
    }
    // Written only when chosen, so an unset key follows the default.
    ;["iconSize", "magnification", "bounce", "rightClick", "hoverEffect"].forEach(function(key) {
        if (settings && settings[key] !== DEFAULT_SETTINGS[key]) out[key] = settings[key]
    })
    return JSON.stringify(out, null, 2) + "\n"
}

// Resolve a screen mode against a live screen list (Quickshell.screens in QML,
// plain arrays in tests) to the output names the dock should occupy.
// `focusName` is the output a "focused" dock is on (see pickScreenName). A
// named output that is not connected falls back to the first screen.
function resolveScreenNames(screens, mode, focusName) {
    var list = screens || []
    var names = []
    for (var i = 0; i < list.length; i++) {
        var screen = list[i]
        names.push(screen && screen.name ? String(screen.name) : "")
    }
    if (names.length === 0) return []
    var want = normalizeScreenMode(mode)
    if (want === "all") return names
    if (want === "focused") want = focusName
    return [names.indexOf(want) >= 0 ? want : names[0]]
}

// Dock surface top-left corner on one output, in that output's own
// coordinates. Every per-screen surface (dock, glass layer, preview anchor)
// derives its position from this one function, so no output can drift from
// another and a wrong screen size shows up in the tests.
function surfaceFor(side, winWidth, winHeight, surfaceWidth, surfaceHeight, bottomMargin, hideShift) {
    var edge = normalizeSide(side)
    var width = Number(winWidth) || 0
    var height = Number(winHeight) || 0
    var w = Number(surfaceWidth) || 0
    var h = Number(surfaceHeight) || 0
    var margin = Number(bottomMargin) || 0
    var shift = Number(hideShift) || 0
    var x = (width - w) / 2
    if (edge === "right") x = width - w - margin + shift
    else if (edge === "left") x = margin - shift
    var y = edge === "bottom" ? height - h - margin + shift : (height - h) / 2
    return { x: x, y: y }
}

function shouldReprocessSettings(content) {
    return hashContent(content) !== lastSettingsHash
}

function markSettingsWritten(content) { lastSettingsHash = hashContent(content) }

function resetSettingsGuard() { lastSettingsHash = null }

// Whether the shell's config (shell.json) turns a third-party plugin on: an
// entry with its id in plugins[] or anywhere in the bar, unless
// disabledPlugins[] names it. A plugin's own registry view only answers for
// itself, so this is how one plugin learns about another.
function shellConfigEnables(text, id) {
    var config = null
    try { config = JSON.parse(String(text || "")) } catch (error) {}
    if (!config || typeof config !== "object" || Array.isArray(config)) return false
    if (Array.isArray(config.disabledPlugins) && config.disabledPlugins.indexOf(id) >= 0) return false
    function holds(node) {
        if (!node || typeof node !== "object") return false
        if (!Array.isArray(node) && node.id === id) return true
        for (var key in node) if (holds(node[key])) return true
        return false
    }
    return holds(config.plugins) || holds(config.bar)
}

// ---- Dock settings in the app menu ----------------------------------------
// A menu control is an action "key=value", applied through the same
// validation as the file.
function settingAction(key, value) { return key + "=" + value }

// The settings after a menu action, or null when the action is not a setting.
function applySettingAction(settings, action) {
    var match = /^(\w+)=(.*)$/.exec(String(action || ""))
    if (!match || !DEFAULT_SETTINGS.hasOwnProperty(match[1])) return null
    var change = {}
    change[match[1]] = match[2]
    return overlaySettings(settings, change)
}

// Stepper stops: the default, every `step` from it, and both ends of the range.
var SETTING_STEPS = { iconSize: 4, magnification: 0.12 }
var SETTING_RANGES = { iconSize: ICON_SIZE_RANGE, magnification: MAGNIFICATION_RANGE }

function settingStops(key) {
    var step = SETTING_STEPS[key]
    var range = SETTING_RANGES[key]
    var start = DEFAULT_SETTINGS[key]
    var stops = [range[0], start, range[1]]
    for (var up = start + step; up < range[1] - 1e-9; up += step) stops.push(Math.round(up * 100) / 100)
    for (var down = start - step; down > range[0] + 1e-9; down -= step) stops.push(Math.round(down * 100) / 100)
    return stops.sort(function(a, b) { return a - b })
}

// The action that moves a stepper setting to the next stop up (direction 1)
// or down (-1), or "" at the end of its range.
function stepAction(settings, key, direction) {
    var value = settings[key]
    var stops = settingStops(key)
    if (direction < 0) stops.reverse()
    for (var i = 0; i < stops.length; i++) {
        if (direction > 0 ? stops[i] > value + 1e-9 : stops[i] < value - 1e-9) return settingAction(key, stops[i])
    }
    return ""
}

function settingText(key, value) {
    if (key === "iconSize") return value + " px"
    return value === 1 ? "Off" : value + "×"
}

// The value the menu shows as chosen. "primary" or a disconnected screen
// shows as the first output, which is where the dock is.
function shownSetting(settings, key, screenNames) {
    var value = settings[key]
    if (key !== "screenMode" || value === "all" || value === "focused" || (screenNames || []).indexOf(value) >= 0) return value
    return (screenNames || [])[0] || ""
}

// ---- Dock geometry --------------------------------------------------------
// Every length of the dock at the stock 54px icon; dockMetrics scales them
// all with the icon size. radius is the hover reach computeLayout reads.
var STOCK_METRICS = {
    iconSize: 54,
    slotWidth: 60,
    spacing: 6,
    sidePadding: 12,
    separatorWidth: 12,
    radius: 96,
    dockHeight: 78,
    rowHeight: 70,
    rowOffset: 6,
    cornerRadius: 18,
    itemWidth: 62,
    itemHeight: 72,
    bounceHeight: 28
}

// How far a fully magnified icon reaches past the dock's inner edge. A bottom
// dock centers each item at dockHeight / 2 + rowOffset and scales it from its
// bottom edge; a side dock centers it across the dock and scales it from the
// screen edge.
function magnifiedOverhang(lengths, magnification, vertical) {
    var reach = vertical
        ? lengths.itemWidth * (magnification - 0.5) - lengths.dockHeight / 2
        : lengths.itemHeight * (magnification - 0.5) - lengths.dockHeight / 2 - lengths.rowOffset
    return Math.max(0, Math.ceil(reach))
}

// How far a zoomed icon at either end of the dock reaches past that end. The
// item scales about its center along the dock; on a side dock its height is
// the length along the dock.
function zoomedEndOverhang(lengths, vertical) {
    var half = (vertical ? lengths.itemHeight : lengths.itemWidth) * lengths.hoverScale / 2
    return Math.max(0, Math.ceil(half - lengths.sidePadding - lengths.slotWidth / 2))
}

// The dock's lengths for one icon size, in whole pixels, also usable as
// computeLayout/insertionIndexFor opts. hoverScale is how much the hovered
// icon grows, 1 for the "none" hover effect. clearance is how much further the
// magnified icon reaches than in the stock dock: popups beside the dock move
// out by that much, so the stock dock looks exactly as before. endOverhang is
// how far a zoomed icon reaches past the dock's ends, where the wave grows the
// dock instead.
function dockMetrics(iconSize, magnification, vertical, hoverEffect) {
    var out = {}
    var factor = iconSize / STOCK_METRICS.iconSize
    for (var key in STOCK_METRICS) out[key] = Math.round(STOCK_METRICS[key] * factor)
    out.hoverEffect = hoverEffect || DEFAULT_SETTINGS.hoverEffect
    out.hoverScale = out.hoverEffect === "none" ? 1 : magnification
    out.overhang = magnifiedOverhang(out, out.hoverScale, vertical)
    var stock = magnifiedOverhang(STOCK_METRICS, DEFAULT_SETTINGS.magnification, vertical)
    out.clearance = Math.max(0, out.overhang - stock)
    out.endOverhang = out.hoverEffect === "zoom" ? zoomedEndOverhang(out, vertical) : 0
    return out
}

var LAYOUT_OPTS = dockMetrics(DEFAULT_SETTINGS.iconSize, DEFAULT_SETTINGS.magnification, false)

// ---- Auto-hide state machine (pure, testable) --------------------------
function shouldHideDock(state) {
    var s = state || {}
    var dockEngaged = !!(s.dockEngaged || s.dockHovered || s.edgeHovered)
    return !!(s.autoHide && s.enabled && s.dockReady && !s.autoHidden && !dockEngaged && !s.hideSuppressed)
}

function shouldScheduleHide(state) {
    var s = state || {}
    var dockEngaged = !!(s.dockEngaged || s.dockHovered || s.edgeHovered)
    return !!(s.autoHide && s.enabled && s.dockReady && !s.autoHidden && !dockEngaged && !s.hideSuppressed)
}

function shouldRevealDock(state) {
    var s = state || {}
    return !!(s.autoHide && s.enabled && s.autoHidden && !!s.edgeHovered)
}

// ---- Hide / restore (pure, testable) -------------------------------------
// Hide parks windows on this special workspace. Whether a window is hidden is
// read from its Hyprland workspace name every time, never stored. Windows are
// { address, workspaceName }.
var HIDDEN_WORKSPACE = "special:minimized"

function isHiddenWorkspace(name) {
    return String(name || "").indexOf(HIDDEN_WORKSPACE) === 0
}

function normalizeWindowAddress(address) {
    if (typeof address !== "string" || !/^(?:0x)?[0-9a-f]+$/i.test(address)) return ""
    var hex = address.replace(/^0x/i, "").replace(/^0+/, "").toLowerCase()
    return hex ? "0x" + hex : ""
}

function windowActionDispatch(action, address) {
    if (action !== "close" && action !== "kill") return ""
    var target = normalizeWindowAddress(address)
    if (!target) return ""
    return "hl.dsp.window." + action + "({ window = \"address:" + target + "\" })"
}

function windowSelector(address) {
    var raw = String(address || "")
    return "address:" + (raw.indexOf("0x") === 0 ? raw : "0x" + raw)
}

// Lua dispatch (Hyprland 0.56) moving a window without focus following it.
function moveWindowDispatch(address, workspace) {
    return "hl.dsp.window.move({ window = \"" + windowSelector(address)
        + "\", workspace = \"" + workspace + "\", follow = false })"
}

function hideDispatches(windows) {
    var out = []
    var list = windows || []
    for (var i = 0; i < list.length; i++) {
        if (!list[i].address || isHiddenWorkspace(list[i].workspaceName)) continue
        out.push(moveWindowDispatch(list[i].address, HIDDEN_WORKSPACE))
    }
    return out
}

function activationPlan(windows, workspaceId, visibleWorkspaceIds) {
    var list = (windows || []).filter(function(w) { return !!w.address })
    if (list.length === 0) return null
    var visible = visibleWorkspaceIds || []
    for (var i = 0; i < list.length; i++) {
        if (!isHiddenWorkspace(list[i].workspaceName) && visible.indexOf(list[i].workspaceId) >= 0)
            return { moves: [], focus: list[i].address }
    }
    if (!(workspaceId >= 1)) return { moves: [], focus: "" }
    return {
        moves: [moveWindowDispatch(list[0].address, String(workspaceId))],
        focus: list[0].address
    }
}

// What clicking a dock icon with `button` ("left" | "middle" | "right") does.
// Middle-click always opens the app menu, and so does right-click unless the
// rightClick setting is "hide": then right-click hides a running app, or
// brings it back when every window is already hidden, and an app with no
// window (pinned, not running) keeps the menu.
function iconClickAction(button, windows, rightClick) {
    if (button === "left") return "activate"
    if (button === "middle" || rightClick !== "hide") return "menu"
    var list = (windows || []).filter(function(w) { return !!w.address })
    if (list.length === 0) return "menu"
    for (var i = 0; i < list.length; i++) {
        if (!isHiddenWorkspace(list[i].workspaceName)) return "hide"
    }
    return "restore"
}

// Allows the same pure module to be exercised by Node tests. QML does not
// define `module`, so this branch is inert when imported by Quickshell.
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        DEFAULT_PINNED: DEFAULT_PINNED,
        SEPARATOR_ID: SEPARATOR_ID,
        DOWNLOADS_ID: DOWNLOADS_ID,
        TRASH_ID: TRASH_ID,
        LAYOUT_OPTS: LAYOUT_OPTS,
        normalizeId: normalizeId,
        mergeAppEntries: mergeAppEntries,
        stripDesktop: stripDesktop,
        toArray: toArray,
        parsePinned: parsePinned,
        parseOrder: parseOrder,
        serializePinned: serializePinned,
        isPinned: isPinned,
        togglePinned: togglePinned,
        reorderPinned: reorderPinned,
        insertPinned: insertPinned,
        removePinned: removePinned,
        buildFlow: buildFlow,
        buildDockOrder: buildDockOrder,
        reconcileDockOrder: reconcileDockOrder,
        moveInOrder: moveInOrder,
        orderPinned: orderPinned,
        computeLayout: computeLayout,
        insertionIndexFor: insertionIndexFor,
        isWebAppClass: isWebAppClass,
        desktopIdForWindow: desktopIdForWindow,
        entryFor: entryFor,
        isSpecialId: isSpecialId,
        stripSpecialIds: stripSpecialIds,
        specialSection: specialSection,
        appendSpecialItems: appendSpecialItems,
        buildDockItems: buildDockItems,
        hashContent: hashContent,
        shouldReprocess: shouldReprocess,
        markWritten: markWritten,
        resetWrittenGuard: resetWrittenGuard,
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        parseSettings: parseSettings,
        serializeSettings: serializeSettings,
        normalizeSide: normalizeSide,
        normalizeScreenMode: normalizeScreenMode,
        resolveScreenNames: resolveScreenNames,
        surfaceFor: surfaceFor,
        pickScreenName: pickScreenName,
        dockMetrics: dockMetrics,
        settingAction: settingAction,
        applySettingAction: applySettingAction,
        stepAction: stepAction,
        settingText: settingText,
        shownSetting: shownSetting,
        shellConfigEnables: shellConfigEnables,
        shouldReprocessSettings: shouldReprocessSettings,
        markSettingsWritten: markSettingsWritten,
        resetSettingsGuard: resetSettingsGuard,
        shouldHideDock: shouldHideDock,
        shouldScheduleHide: shouldScheduleHide,
        shouldRevealDock: shouldRevealDock,
        isHiddenWorkspace: isHiddenWorkspace,
        windowSelector: windowSelector,
        normalizeWindowAddress: normalizeWindowAddress,
        windowActionDispatch: windowActionDispatch,
        hideDispatches: hideDispatches,
        activationPlan: activationPlan,
        iconClickAction: iconClickAction
    }
}
