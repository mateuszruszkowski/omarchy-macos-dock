.pragma library

var DEFAULT_PINNED = []

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

// Continuous layout driven by the cursor. Slot centers are measured from the
// resting row, then every slot receives a scale and a centered shift. This is
// important: measuring each center after the previous slot has grown makes the
// hover wave feed back into itself and causes the row to wobble at the edges.
function computeLayout(flow, cursorX, opts) {
    opts = opts || LAYOUT_OPTS
    var placements = {}
    var cursorValid = typeof cursorX === "number" && cursorX >= 0
    var reach = Math.max(opts.slotWidth, opts.radius)
    var growth = opts.iconSize * (opts.hoverScale - 1)
    var spread = growth * (reach / opts.slotWidth)
    var resting = []
    var x = 0

    for (var i = 0; i < flow.length; i++) {
        var item = flow[i]
        var slot = item.separator ? opts.separatorWidth : opts.slotWidth
        resting.push({ item: item, x: x, slot: slot, center: x + slot / 2 })
        x += slot + opts.spacing
    }

    var contentWidth = Math.max(0, x - opts.spacing)
    var pointer = cursorValid ? cursorX : -1
    var startShift = cursorValid ? spread * hoverRamp(-pointer, reach) : 0
    var endShift = cursorValid ? spread * hoverRamp(contentWidth - pointer, reach) : 0
    var recenter = (startShift + endShift) / 2
    var lastEnd = 0
    var grownWidth = 0

    for (var j = 0; j < resting.length; j++) {
        var entry = resting[j]
        var item = entry.item
        var scale = 1
        var lift = 0
        var shift = 0
        if (cursorValid && !item.separator) {
            var distance = entry.center - pointer
            scale = 1 + (opts.hoverScale - 1) * hoverFalloff(distance, reach)
            shift = spread * hoverRamp(distance, reach) - recenter
            lift = (scale - 1) * opts.iconSize * 0.5
        }
        // The delegate itself widens around its center, so its resting x plus
        // the wave shift is already the correct left edge. Keeping that edge
        // stable also keeps a one-icon dock centered while it magnifies.
        var placedX = entry.x + shift
        placements[item.id] = { x: placedX, scale: scale, lift: lift, phantom: !!item.phantom }
        lastEnd = Math.max(lastEnd, placedX + entry.slot * scale)
        grownWidth += entry.slot * (scale - 1)
    }

    var expandedWidth = contentWidth + grownWidth
    return { placements: placements, flowWidth: expandedWidth, totalWidth: expandedWidth + 2 * opts.sidePadding }
}

// Returns the flow index the cursor currently falls over (0..flow.length),
// using the same scaled geometry as the rendered layout so the drop lands
// on the icon the user sees.
function insertionIndexFor(cursorX, flow, opts) {
    opts = opts || LAYOUT_OPTS
    if (!flow || flow.length === 0) return 0
    var x = 0
    var cursorValid = typeof cursorX === "number" && cursorX >= 0
    for (var i = 0; i < flow.length; i++) {
        var item = flow[i]
        var slot = item.separator ? opts.separatorWidth : opts.slotWidth
        var center = x + slot / 2
        var scale = 1
        if (cursorValid) {
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

function buildDockItems(pinned, entries, runningIds) {
    var result = []
    var running = runningIds || []
    ;(pinned || []).forEach(function(id) {
        var entry = entryFor(id, entries)
        result.push({ id: normalizeId(id), name: entry.name || entry.displayName || id,
            icon: entry.icon || entry.iconName || "", pinned: true,
            running: running.indexOf(normalizeId(id)) >= 0 })
    })

    var unpinned = []
    running.forEach(function(id) {
        var normalized = normalizeId(id)
        if (!isPinned(pinned, normalized) && unpinned.indexOf(normalized) === -1)
            unpinned.push(normalized)
    })
    unpinned.forEach(function(id) {
        var entry = entryFor(id, entries)
        result.push({ id: id, name: entry.name || entry.displayName || id,
            icon: entry.icon || entry.iconName || "", pinned: false, running: true })
    })
    return result
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
    screen: "",
    iconSize: 54,
    magnification: 1.36,
    bounce: true
}
var ICON_SIZE_RANGE = [32, 96]
var MAGNIFICATION_RANGE = [1, 2]

function normalizeSide(side) {
    var s = String(side || "bottom").toLowerCase()
    if (s === "left" || s === "right") return s
    return "bottom"
}

// Output name ("DP-2"), "focused", or "" for the default (first screen).
function normalizeScreen(value) {
    if (typeof value !== "string") return ""
    var name = value.trim()
    return name.toLowerCase() === "focused" ? "focused" : name
}

// Choose the output name the dock should live on.
//   names       connected output names, in Quickshell order
//   want        the `screen` setting: a name, "focused", or ""
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

// A finite number or a non-empty numeric string as a number; NaN otherwise.
function settingNumber(value) {
    if (typeof value === "number") return value
    if (typeof value === "string" && value.trim()) return Number(value)
    return NaN
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
    if (source.screen !== undefined) out.screen = normalizeScreen(source.screen)
    var size = settingNumber(source.iconSize)
    if (isFinite(size)) out.iconSize = clamp(Math.round(size), ICON_SIZE_RANGE)
    var magnification = settingNumber(source.magnification)
    if (isFinite(magnification)) out.magnification = clamp(magnification, MAGNIFICATION_RANGE)
    if (typeof source.bounce === "boolean") out.bounce = source.bounce
    else if (source.bounce === "true" || source.bounce === "false") out.bounce = source.bounce === "true"
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
    var out = { version: 1, autoHide: value, dockSide: side }
    var screen = normalizeScreen(settings && settings.screen)
    if (screen) out.screen = screen
    // Written only when chosen, so an unset key follows the default.
    ;["iconSize", "magnification", "bounce"].forEach(function(key) {
        if (settings && settings[key] !== DEFAULT_SETTINGS[key]) out[key] = settings[key]
    })
    return JSON.stringify(out, null, 2) + "\n"
}

function shouldReprocessSettings(content) {
    return hashContent(content) !== lastSettingsHash
}

function markSettingsWritten(content) { lastSettingsHash = hashContent(content) }

function resetSettingsGuard() { lastSettingsHash = null }

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

// The dock's lengths for one icon size, in whole pixels, also usable as
// computeLayout/insertionIndexFor opts. clearance is how much further the
// magnified icon reaches than in the stock dock: popups beside the dock move
// out by that much, so the stock dock looks exactly as before.
function dockMetrics(iconSize, magnification, vertical) {
    var out = {}
    var factor = iconSize / STOCK_METRICS.iconSize
    for (var key in STOCK_METRICS) out[key] = Math.round(STOCK_METRICS[key] * factor)
    out.hoverScale = magnification
    out.overhang = magnifiedOverhang(out, magnification, vertical)
    var stock = magnifiedOverhang(STOCK_METRICS, DEFAULT_SETTINGS.magnification, vertical)
    out.clearance = Math.max(0, out.overhang - stock)
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

// What activating an app (dock click, Alt+Tab) or one preview window does.
// A window in view wins, so an app with any visible window behaves as before.
// Only when every window is hidden do they all come back, to workspaceId (the
// focused monitor's active workspace). null when there is no window at all,
// so the caller launches the app instead.
function activationPlan(windows, workspaceId) {
    var list = (windows || []).filter(function(w) { return !!w.address })
    if (list.length === 0) return null
    for (var i = 0; i < list.length; i++) {
        if (!isHiddenWorkspace(list[i].workspaceName)) return { moves: [], focus: list[i].address }
    }
    if (!(workspaceId >= 1)) return { moves: [], focus: "" }
    return {
        moves: list.map(function(w) { return moveWindowDispatch(w.address, String(workspaceId)) }),
        focus: list[0].address
    }
}

// What clicking a dock icon with `button` ("left" | "middle" | "right") does.
// Right-click hides a running app, or brings it back when every window is
// already hidden; an app with no window (pinned, not running) keeps the menu.
function iconClickAction(button, windows) {
    if (button === "left") return "activate"
    if (button === "middle") return "menu"
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
        buildDockItems: buildDockItems,
        hashContent: hashContent,
        shouldReprocess: shouldReprocess,
        markWritten: markWritten,
        resetWrittenGuard: resetWrittenGuard,
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        parseSettings: parseSettings,
        serializeSettings: serializeSettings,
        normalizeSide: normalizeSide,
        normalizeScreen: normalizeScreen,
        pickScreenName: pickScreenName,
        dockMetrics: dockMetrics,
        shouldReprocessSettings: shouldReprocessSettings,
        markSettingsWritten: markSettingsWritten,
        resetSettingsGuard: resetSettingsGuard,
        shouldHideDock: shouldHideDock,
        shouldScheduleHide: shouldScheduleHide,
        shouldRevealDock: shouldRevealDock,
        isHiddenWorkspace: isHiddenWorkspace,
        windowSelector: windowSelector,
        hideDispatches: hideDispatches,
        activationPlan: activationPlan,
        iconClickAction: iconClickAction
    }
}
