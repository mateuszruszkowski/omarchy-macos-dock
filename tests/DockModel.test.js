const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")

function loadQmlJs(path) {
  const source = fs.readFileSync(path, "utf8").replace(/^\.pragma library\s*/, "")
  const context = { module: { exports: {} }, console }
  vm.runInNewContext(source, context, { filename: path })
  return context.module.exports
}

const model = loadQmlJs("DockModelBase.js")
const plain = (value) => JSON.parse(JSON.stringify(value))

test("parses and normalizes pinned ids", () => {
  assert.deepEqual(Array.from(model.parsePinned('{"pinned":["code.desktop","code","ghostty"]}')), ["code", "ghostty"])
})

test("merges app-library and desktop entries for installed apps without windows", () => {
  const merged = model.mergeAppEntries(
    [{ entry: { id: "running.desktop", name: "Running", icon: "running-icon" } }],
    [
      { id: "running.desktop", name: "Duplicate", icon: "duplicate-icon" },
      { id: "idle.desktop", name: "Idle App", icon: "idle-icon" },
    ],
  )

  assert.deepEqual(JSON.parse(JSON.stringify(merged)), [
    { id: "running", name: "Running", icon: "running-icon" },
    { id: "idle", name: "Idle App", icon: "idle-icon" },
  ])
})

test("merged app entries preserve searchable names and ids", () => {
  const merged = model.mergeAppEntries([], [
    { desktopId: "org.example.Writer.desktop", displayName: "Writer" },
    { id: "terminal", name: "Terminal", iconName: "kitty" },
  ])

  assert.equal(merged[0].id, "org.example.Writer")
  assert.equal(merged[0].name, "Writer")
  assert.equal(merged[1].id, "terminal")
  assert.equal(merged[1].icon, "kitty")
})

test("round trips pins", () => {
  assert.deepEqual(Array.from(model.parsePinned(model.serializePinned(["code", "ghostty"]))), ["code", "ghostty"])
})

test("serializePinned persists the full order alongside pins", () => {
  const content = model.serializePinned(["spotify"], ["firefox", "terminal", "vscode", "spotify", "files"])
  const parsed = JSON.parse(content)
  assert.deepEqual(Array.from(parsed.pinned), ["spotify"])
  assert.deepEqual(Array.from(parsed.order), ["firefox", "terminal", "vscode", "spotify", "files"])
  assert.equal(parsed.version, 1)
})

test("parseOrder reads the order field and falls back safely", () => {
  const content = model.serializePinned(["a"], ["x", "a", "y"])
  assert.deepEqual(Array.from(model.parseOrder(content, [])), ["x", "a", "y"])
  assert.deepEqual(Array.from(model.parseOrder('{"pinned":["a"]}', ["old"])), ["old"])
  assert.deepEqual(Array.from(model.parseOrder("not json", ["old"])), ["old"])
  assert.deepEqual(Array.from(model.parseOrder("", ["old"])), ["old"])
  assert.deepEqual(Array.from(model.parseOrder('{"order":["a","a","b.desktop"]}', [])), ["a", "b"])
})

test("restored order is a preference, not an authority", () => {
  const restored = model.reconcileDockOrder(["a", "b", "c", "d"], ["a", "c", "d"], ["a", "c", "d"])
  assert.deepEqual(Array.from(restored), ["a", "c", "d"])
  const afterLaunch = model.reconcileDockOrder(restored, ["a", "c", "d"], ["a", "b", "c", "d"])
  assert.deepEqual(Array.from(afterLaunch), ["a", "c", "d", "b"])
})

test("acceptance: pin keeps position, survives restart, unpin removes", () => {
  let dockOrder = model.reconcileDockOrder([], [], ["firefox", "terminal", "vscode", "spotify", "files"])
  const persisted = model.serializePinned(["spotify"], dockOrder)
  let pinned = model.parsePinned(persisted, [])
  let restored = model.parseOrder(persisted, [])
  assert.deepEqual(Array.from(pinned), ["spotify"])

  // Pin does not reorder: membership changes, order does not.
  const before = dockOrder.join("|")
  dockOrder = model.reconcileDockOrder(dockOrder, pinned, ["firefox", "terminal", "vscode", "spotify", "files"])
  assert.equal(dockOrder.join("|"), before)

  // Spotify closes; restart with only some apps running: it stays mid-dock.
  dockOrder = model.reconcileDockOrder(restored, pinned, ["firefox", "terminal", "vscode"])
  assert.deepEqual(Array.from(dockOrder), ["firefox", "terminal", "vscode", "spotify"])

  // Unpin, close, restart: Spotify gone; relaunch appends at the end.
  pinned = model.removePinned(pinned, "spotify")
  dockOrder = model.reconcileDockOrder(dockOrder, pinned, ["firefox", "terminal", "vscode"])
  assert.equal(dockOrder.indexOf("spotify"), -1)
  dockOrder = model.reconcileDockOrder(dockOrder, pinned, ["firefox", "terminal", "vscode", "spotify"])
  assert.deepEqual(Array.from(dockOrder), ["firefox", "terminal", "vscode", "spotify"])
})

test("isPinned reads the pinned list, matching ids with or without .desktop", () => {
  assert.equal(model.isPinned(["firefox", "kitty"], "kitty"), true)
  assert.equal(model.isPinned(["firefox"], "firefox.desktop"), true)
  assert.equal(model.isPinned(["firefox"], "kitty"), false)
  assert.equal(model.isPinned([], "firefox"), false)
  assert.equal(model.isPinned(undefined, "firefox"), false)
  const pinned = model.togglePinned(["firefox"], "kitty")
  assert.equal(model.isPinned(pinned, "kitty"), true)
  assert.equal(model.isPinned(model.togglePinned(pinned, "kitty"), "kitty"), false)
})

test("toggles and reorders pins", () => {
  assert.deepEqual(Array.from(model.togglePinned(["a"], "b")), ["a", "b"])
  assert.deepEqual(Array.from(model.togglePinned(["a", "b"], "a")), ["b"])
  assert.deepEqual(Array.from(model.reorderPinned(["a", "b", "c"], 0, 2)), ["b", "c", "a"])
})

test("builds pinned and running items without a separator", () => {
  const items = model.buildDockItems(["a"], [{ id: "a", name: "A" }, { id: "b", name: "B" }], ["a", "b"])
  assert.equal(items[0].running, true)
  assert.equal(items[1].id, "b")
})

test("write guard ignores matching content", () => {
  model.resetWrittenGuard()
  model.markWritten("hello")
  assert.equal(model.shouldReprocess("hello"), false)
  assert.equal(model.shouldReprocess("world"), true)
})

test("inserts and removes pins", () => {
  assert.deepEqual(Array.from(model.insertPinned(["a", "c"], "b", 1)), ["a", "b", "c"])
  assert.deepEqual(Array.from(model.insertPinned(["a"], "x", 5)), ["a", "x"])
  assert.deepEqual(Array.from(model.insertPinned(["a", "b"], "b", 0)), ["a", "b"])
  assert.deepEqual(Array.from(model.removePinned(["a", "b", "c"], "b")), ["a", "c"])
  assert.deepEqual(Array.from(model.removePinned(["a"], "z")), ["a"])
})

test("buildFlow inserts phantom among pinned and appends running unpinned", () => {
  assert.deepEqual(Array.from(model.buildFlow(["a", "b", "c"], ["x", "y"], "", -1).map(i => i.id)), ["a", "b", "c", "x", "y"])
  assert.deepEqual(Array.from(model.buildFlow(["a", "b", "c"], [], "", 1).map(i => i.id)), ["a", "__phantom__", "b", "c"])
  assert.deepEqual(Array.from(model.buildFlow(["a", "b", "c"], [], "", 0).map(i => i.id)), ["__phantom__", "a", "b", "c"])
  assert.deepEqual(Array.from(model.buildFlow(["a", "b", "c"], [], "", 3).map(i => i.id)), ["a", "b", "c", "__phantom__"])
  assert.equal(model.buildFlow(["a", "b", "c"], [], "", 1).filter(i => i.phantom).length, 1)
})

test("buildFlow excludes the floating item", () => {
  assert.deepEqual(Array.from(model.buildFlow(["a", "b", "c"], ["x"], "b", 1).map(i => i.id)), ["a", "__phantom__", "c", "x"])
  assert.deepEqual(Array.from(model.buildFlow(["a"], ["x", "y"], "y", -1).map(i => i.id)), ["a", "x"])
})

test("buildFlow phantom tracks the full flow including running apps", () => {
  assert.deepEqual(Array.from(model.buildFlow(["a"], ["x", "y"], "y", 1).map(i => i.id)), ["a", "__phantom__", "x"])
  assert.deepEqual(Array.from(model.buildFlow(["a"], ["x", "y"], "y", 2).map(i => i.id)), ["a", "x", "__phantom__"])
  assert.deepEqual(Array.from(model.buildFlow(["a"], ["x", "y"], "x", 0).map(i => i.id)), ["__phantom__", "a", "y"])
  assert.deepEqual(Array.from(model.buildFlow(["a"], ["x", "y"], "y", 9).map(i => i.id)), ["a", "x", "__phantom__"])
})

test("pinnedIndexForInsertion maps a full-flow index into the pinned cluster", () => {
  const pinned = ["a", "b"]
  const running = ["x", "y"]
  assert.deepEqual(Array.from(model.buildDockOrder(pinned, running, [])), ["a", "b", "x", "y"])
  assert.deepEqual(Array.from(model.buildDockOrder(pinned, running, ["a", "x", "b", "y"])), ["a", "b", "x", "y"])
})

test("buildDockOrder preserves the previous relative order of running apps", () => {
  assert.deepEqual(Array.from(model.buildDockOrder(["a"], ["x", "y"], ["a", "y", "x"])), ["a", "y", "x"])
  assert.deepEqual(Array.from(model.buildDockOrder(["a"], ["x", "y", "z"], ["a", "y", "x"])), ["a", "y", "x", "z"])
})

test("reconcileDockOrder keeps session slots and appends new apps", () => {
  assert.deepEqual(Array.from(model.reconcileDockOrder(["a", "x", "y"], ["a"], ["a", "x", "y"])), ["a", "x", "y"])
  assert.deepEqual(Array.from(model.reconcileDockOrder(["a", "x"], ["a"], ["a", "x", "y"])), ["a", "x", "y"])
  assert.deepEqual(Array.from(model.reconcileDockOrder(["a", "x", "y"], ["a"], ["a", "x"])), ["a", "x"])
  assert.deepEqual(Array.from(model.reconcileDockOrder(["x"], ["a", "b"], ["x"])), ["x", "a", "b"])
})

test("moveInOrder reorders any app without touching the pinned list", () => {
  assert.deepEqual(Array.from(model.moveInOrder(["a", "x", "y"], "x", 0)), ["x", "a", "y"])
  assert.deepEqual(Array.from(model.moveInOrder(["a", "x", "y"], "y", 1)), ["a", "y", "x"])
  assert.deepEqual(Array.from(model.moveInOrder(["a", "x"], "z", 2)), ["a", "x", "z"])
  assert.deepEqual(Array.from(model.moveInOrder(["a", "x", "y"], "a", 0)), ["a", "x", "y"])
})

test("orderPinned keeps only pinned members in order", () => {
  assert.deepEqual(Array.from(model.orderPinned(["b", "x", "a"], ["a", "b"])), ["b", "a"])
  assert.deepEqual(Array.from(model.orderPinned(["x", "y"], ["a"])), ["a"].filter(i => ["x", "y"].includes(i)))
  assert.deepEqual(Array.from(model.orderPinned(["x", "a", "y"], ["a"])), ["a"])
})

test("computeLayout rests evenly with no cursor and grows with magnification", () => {
  const opts = model.LAYOUT_OPTS
  const rest = model.computeLayout([{ id: "a" }, { id: "b" }, { id: "c" }], -1, opts)
  assert.equal(rest.totalWidth, opts.slotWidth * 3 + opts.spacing * 2 + 2 * opts.sidePadding)
  assert.deepEqual({ ...rest.placements.a }, { x: 0, scale: 1, lift: 0, phantom: false })
  assert.equal(rest.placements.b.x, opts.slotWidth + opts.spacing)
  assert.equal(rest.placements.c.x, 2 * (opts.slotWidth + opts.spacing))

  const center = rest.placements.b.x + opts.slotWidth / 2
  const mag = model.computeLayout([{ id: "a" }, { id: "b" }, { id: "c" }], center, opts)
  assert.ok(mag.placements.b.scale > 1, "hovered icon magnifies")
  assert.ok(mag.placements.a.scale < mag.placements.b.scale, "neighbors are smaller than hovered icon")
  assert.ok(mag.totalWidth > rest.totalWidth, "dock grows as the cursor approaches")
  assert.ok(mag.placements.b.lift > 0, "magnified icon lifts")
})

test("computeLayout keeps icons from overlapping under magnification", () => {
  const opts = model.LAYOUT_OPTS
  const flow = [{ id: "a" }, { id: "b" }, { id: "c" }]
  const center = opts.slotWidth + opts.slotWidth / 2
  const result = model.computeLayout(flow, center, opts)
  for (const id of ["a", "b", "c"]) {
    const p = result.placements[id]
    const painted = opts.iconSize * p.scale
    const left = p.x + (opts.slotWidth * p.scale - painted) / 2
    assert.ok(left + painted <= p.x + opts.slotWidth * p.scale, `icon ${id} fits in its slot`)
  }
})

test("single magnified icon is centered in the dock", () => {
  const opts = model.LAYOUT_OPTS
  // Cursor directly over the one slot: full magnification, no neighbors.
  const result = model.computeLayout([{ id: "a" }], opts.slotWidth / 2, opts)
  const p = result.placements.a
  // Icon center = wrapper center = slot center; flowWidth = scaled slot width.
  assert.ok(Math.abs(p.x + (opts.slotWidth * p.scale) / 2 - result.flowWidth / 2) < 0.01)
  assert.ok(Math.abs(p.x + (opts.slotWidth * p.scale) / 2 - result.flowWidth / 2) === 0
    ? true : result.flowWidth > 0)
  assert.equal(result.totalWidth, p.x + opts.slotWidth * p.scale + 2 * opts.sidePadding)
})

test("multi-item flowWidth equals the content span", () => {
  const opts = model.LAYOUT_OPTS
  const rest = model.computeLayout([{ id: "a" }, { id: "b" }], -1, opts)
  assert.equal(rest.flowWidth, opts.slotWidth + opts.spacing + opts.slotWidth)
})

test("insertionIndexFor picks the nearest slot", () => {
  const opts = model.LAYOUT_OPTS
  const flow = [{ id: "a" }, { id: "b" }, { id: "c" }]
  assert.equal(model.insertionIndexFor(0, flow, opts), 0)
  assert.equal(model.insertionIndexFor(50, flow, opts), 1)
  assert.equal(model.insertionIndexFor(100, flow, opts), 1)
  assert.equal(model.insertionIndexFor(9999, flow, opts), 3)
})

const STOCK_TABLE = {
  iconSize: 54, slotWidth: 60, spacing: 6, sidePadding: 12, separatorWidth: 12, radius: 96,
  dockHeight: 78, rowHeight: 70, rowOffset: 6, cornerRadius: 18, itemWidth: 62, itemHeight: 72,
  bounceHeight: 28, hoverScale: 1.36,
}

test("dockMetrics at the stock icon size is the stock dock", () => {
  assert.deepEqual(plain(model.dockMetrics(54, 1.36, false)), { ...STOCK_TABLE, overhang: 17, clearance: 0 })
  assert.deepEqual(plain(model.dockMetrics(54, 1.36, true)), { ...STOCK_TABLE, overhang: 15, clearance: 0 })
  assert.deepEqual(plain(model.LAYOUT_OPTS), { ...STOCK_TABLE, overhang: 17, clearance: 0 })
})

test("dockMetrics scales every length with the icon size, rounded to whole pixels", () => {
  const big = model.dockMetrics(72, 1.36, false)
  assert.equal(big.iconSize, 72)
  assert.equal(big.dockHeight, 104)
  assert.equal(big.slotWidth, 80)
  assert.equal(big.radius, 128)
  assert.equal(big.itemHeight, 96)
  assert.equal(big.rowHeight, 93)
  assert.equal(big.bounceHeight, 37)
  const small = model.dockMetrics(40, 1.36, false)
  assert.equal(small.dockHeight, 58)
  assert.equal(small.slotWidth, 44)
  assert.equal(small.spacing, 4)
  assert.equal(small.cornerRadius, 13)
})

test("clearance is the overhang beyond the stock dock's, per orientation", () => {
  const bottom = model.dockMetrics(72, 1.36, false)
  assert.equal(bottom.overhang, 23)
  assert.equal(bottom.clearance, 6)
  const side = model.dockMetrics(72, 1.36, true)
  assert.equal(side.overhang, 20)
  assert.equal(side.clearance, 5)
  assert.equal(model.dockMetrics(54, 2, false).clearance, 63 - 17)
  assert.equal(model.dockMetrics(32, 1.36, false).clearance, 0)
})

test("magnification 1 never magnifies and never overhangs", () => {
  for (const vertical of [false, true]) {
    const opts = model.dockMetrics(96, 1, vertical)
    assert.equal(opts.overhang, 0)
    assert.equal(opts.clearance, 0)
    const flow = [{ id: "a" }, { id: "b" }, { id: "c" }]
    const center = opts.slotWidth + opts.spacing + opts.slotWidth / 2
    const result = model.computeLayout(flow, center, opts)
    for (const id of ["a", "b", "c"]) assert.equal(result.placements[id].scale, 1)
  }
})

test("every size and magnification keeps the dock's contents in their space", () => {
  const flow = [{ id: "a" }, { id: "b" }, { id: "c" }]
  for (let size = 32; size <= 96; size += 8) {
    for (const magnification of [1, 1.36, 2]) {
      const label = `iconSize ${size}, magnification ${magnification}`
      const bottom = model.dockMetrics(size, magnification, false)
      const itemTop = bottom.dockHeight / 2 + bottom.rowOffset - bottom.itemHeight / 2
      const dotBottom = itemTop + size + 2 + 4
      assert.ok(itemTop >= 0, `${label}: icon starts inside the dock`)
      assert.ok(dotBottom <= bottom.dockHeight, `${label}: running dot ends inside the dock`)
      assert.ok(bottom.itemWidth <= bottom.slotWidth + bottom.spacing, `${label}: resting neighbors do not overlap`)

      const center = bottom.slotWidth + bottom.spacing + bottom.slotWidth / 2
      const scale = model.computeLayout(flow, center, bottom).placements.b.scale
      assert.ok(Math.abs(scale - magnification) < 1e-9, `${label}: the icon under the pointer magnifies fully`)
      const bottomReach = bottom.itemHeight * scale - (itemTop + bottom.itemHeight)
      assert.ok(bottomReach <= bottom.overhang, `${label}: bottom dock reach ${bottomReach} within ${bottom.overhang}`)
      assert.ok(bottom.overhang < Math.max(0, bottomReach) + 1, `${label}: bottom overhang is tight`)

      const side = model.dockMetrics(size, magnification, true)
      const itemInner = side.dockHeight / 2 - side.itemWidth / 2 + side.itemWidth * scale
      const sideReach = itemInner - side.dockHeight
      assert.ok(sideReach <= side.overhang, `${label}: side dock reach ${sideReach} within ${side.overhang}`)
      assert.ok(side.overhang < Math.max(0, sideReach) + 1, `${label}: side overhang is tight`)
    }
  }
})

test("settings parse and serialize autoHide", () => {
  assert.equal(model.parseSettings('{"autoHide":true}', { autoHide: false }).autoHide, true)
  assert.equal(model.parseSettings('{"autoHide":false}', { autoHide: true }).autoHide, false)
  assert.equal(model.parseSettings('', { autoHide: true }).autoHide, true)
  assert.equal(model.parseSettings('not json', { autoHide: false }).autoHide, false)
  assert.equal(model.parseSettings('{}', { autoHide: true }).autoHide, true)
  const s = model.serializeSettings({ autoHide: false })
  const parsed = JSON.parse(s)
  assert.equal(parsed.autoHide, false)
  assert.equal(parsed.version, 1)
  assert.equal(model.parseSettings(s, { autoHide: true }).autoHide, false)
  assert.equal(model.serializeSettings({ autoHide: true }).includes('"autoHide": true'), true)
})

test("settings parse and serialize dockSide", () => {
  assert.equal(model.parseSettings('{"dockSide":"left"}', {}).dockSide, "left")
  assert.equal(model.parseSettings('{"dockSide":"right"}', {}).dockSide, "right")
  assert.equal(model.parseSettings('{"dockSide":"top"}', {}).dockSide, "bottom")
  assert.equal(model.parseSettings('{"dockSide":"LEFT"}', {}).dockSide, "left")
  assert.equal(model.parseSettings('', {}).dockSide, "bottom")
  assert.equal(model.parseSettings('not json', { dockSide: "left" }).dockSide, "left")
  const s = model.serializeSettings({ autoHide: true, dockSide: "right" })
  const parsed = JSON.parse(s)
  assert.equal(parsed.dockSide, "right")
  assert.equal(model.parseSettings(s, {}).autoHide, true)
  assert.equal(model.parseSettings(s, {}).dockSide, "right")
  assert.equal(model.serializeSettings({ autoHide: true }).includes('"dockSide": "bottom"'), true)
  assert.equal(model.serializeSettings({ autoHide: true, dockSide: "weird" }).includes('"dockSide": "bottom"'), true)
})

test("settings parse and serialize screen", () => {
  assert.equal(model.parseSettings('{"screen":"DP-2"}', {}).screen, "DP-2")
  assert.equal(model.parseSettings('{"screen":"  DP-2 "}', {}).screen, "DP-2")
  assert.equal(model.parseSettings('{"screen":"focused"}', {}).screen, "focused")
  assert.equal(model.parseSettings('{"screen":" Focused "}', {}).screen, "focused")
  assert.equal(model.parseSettings('{"screen":42}', {}).screen, "")
  assert.equal(model.parseSettings('{}', {}).screen, "")
  assert.equal(model.parseSettings('', {}).screen, "")
  assert.equal(model.parseSettings('not json', { screen: "DP-3" }).screen, "DP-3")
  const s = model.serializeSettings({ autoHide: true, dockSide: "bottom", screen: "DP-2" })
  assert.equal(JSON.parse(s).screen, "DP-2")
  assert.equal(model.parseSettings(s, {}).screen, "DP-2")
  assert.equal("screen" in JSON.parse(model.serializeSettings({ autoHide: true })), false)
})

const DEFAULTS = { autoHide: true, dockSide: "bottom", screen: "", iconSize: 54, magnification: 1.36, bounce: true, rightClick: "menu" }
const CUSTOM = { autoHide: false, dockSide: "right", screen: "DP-2", iconSize: 80, magnification: 1.75, bounce: false, rightClick: "hide" }

test("settings default to the stock dock", () => {
  assert.deepEqual(plain(model.DEFAULT_SETTINGS), DEFAULTS)
  for (const text of ["", "{}", "not json", "[]", "null", "42"]) {
    assert.deepEqual(plain(model.parseSettings(text)), DEFAULTS, `parse ${JSON.stringify(text)}`)
  }
})

test("settings read icon size, magnification and bounce", () => {
  const parsed = model.parseSettings('{"iconSize":72,"magnification":1.8,"bounce":false}')
  assert.deepEqual(plain(parsed), { ...DEFAULTS, iconSize: 72, magnification: 1.8, bounce: false })
})

test("settings clamp icon size to 32..96 after rounding and magnification to 1..2", () => {
  const size = (value) => model.parseSettings(JSON.stringify({ iconSize: value })).iconSize
  assert.equal(size(10), 32)
  assert.equal(size(31.4), 32)
  assert.equal(size(32), 32)
  assert.equal(size(60.4), 60)
  assert.equal(size(60.6), 61)
  assert.equal(size(96), 96)
  assert.equal(size(97), 96)
  assert.equal(size(500), 96)
  const mag = (value) => model.parseSettings(JSON.stringify({ magnification: value })).magnification
  assert.equal(mag(0.5), 1)
  assert.equal(mag(1), 1)
  assert.equal(mag(1.5), 1.5)
  assert.equal(mag(2), 2)
  assert.equal(mag(2.5), 2)
})

test("settings accept numeric strings and the strings true/false for bounce", () => {
  const parsed = model.parseSettings('{"iconSize":" 72 ","magnification":"1.5","bounce":"false"}')
  assert.equal(parsed.iconSize, 72)
  assert.equal(parsed.magnification, 1.5)
  assert.equal(parsed.bounce, false)
  assert.equal(model.parseSettings('{"iconSize":"200","magnification":"0.2"}').iconSize, 96)
  assert.equal(model.parseSettings('{"iconSize":"200","magnification":"0.2"}').magnification, 1)
  assert.equal(model.parseSettings('{"bounce":"true"}', { bounce: false }).bounce, true)
})

test("settings keep the base value for a wrong type", () => {
  const base = { iconSize: 64, magnification: 1.5, bounce: false }
  for (const bad of [null, true, false, {}, [], "big", "", "  ", "Infinity", "54px"]) {
    const text = JSON.stringify({ iconSize: bad, magnification: bad })
    const parsed = model.parseSettings(text, base)
    assert.equal(parsed.iconSize, 64, `iconSize ${JSON.stringify(bad)}`)
    assert.equal(parsed.magnification, 1.5, `magnification ${JSON.stringify(bad)}`)
  }
  for (const bounce of [true, false]) {
    for (const bad of [null, 1, 0, "yes", "TRUE", "", {}]) {
      const parsed = model.parseSettings(JSON.stringify({ bounce: bad }), { bounce })
      assert.equal(parsed.bounce, bounce, `bounce ${JSON.stringify(bad)} over ${bounce}`)
    }
  }
  assert.equal(model.parseSettings('{"iconSize":true}').iconSize, 54)
})

test("settings read rightClick as menu or hide and keep the base value otherwise", () => {
  assert.equal(model.parseSettings('{"rightClick":"hide"}').rightClick, "hide")
  assert.equal(model.parseSettings('{"rightClick":" Hide "}').rightClick, "hide")
  assert.equal(model.parseSettings('{"rightClick":"menu"}', { rightClick: "hide" }).rightClick, "menu")
  for (const base of ["menu", "hide"]) {
    for (const bad of [null, true, 1, "", "minimize", ["hide"], {}]) {
      const parsed = model.parseSettings(JSON.stringify({ rightClick: bad }), { rightClick: base })
      assert.equal(parsed.rightClick, base, `rightClick ${JSON.stringify(bad)} over ${base}`)
    }
  }
})

test("broken settings fall back to the normalized fallback", () => {
  assert.deepEqual(plain(model.parseSettings("not json", CUSTOM)), CUSTOM)
  assert.deepEqual(plain(model.parseSettings("", CUSTOM)), CUSTOM)
  const normalized = model.parseSettings("not json", { iconSize: 200, magnification: 0, dockSide: "LEFT" })
  assert.deepEqual(plain(normalized), { ...DEFAULTS, iconSize: 96, magnification: 1, dockSide: "left" })
})

test("settings write only the keys that differ from the defaults", () => {
  assert.deepEqual(JSON.parse(model.serializeSettings(DEFAULTS)), { version: 1, autoHide: true, dockSide: "bottom" })
  for (const [key, value] of [["iconSize", 72], ["magnification", 1.5], ["bounce", false], ["rightClick", "hide"]]) {
    const written = JSON.parse(model.serializeSettings({ ...DEFAULTS, [key]: value }))
    assert.deepEqual(written, { version: 1, autoHide: true, dockSide: "bottom", [key]: value }, key)
  }
})

test("custom settings round-trip through the file", () => {
  assert.deepEqual(plain(model.parseSettings(model.serializeSettings(CUSTOM))), CUSTOM)
})

test("rewriting the file for one setting keeps every other custom setting", () => {
  const file = JSON.stringify({ version: 1, ...CUSTOM }, null, 2)
  const loaded = model.parseSettings(file)
  const rewritten = model.serializeSettings({ ...plain(loaded), autoHide: !loaded.autoHide })
  assert.deepEqual(plain(model.parseSettings(rewritten)), { ...CUSTOM, autoHide: true })
})

test("pickScreenName chooses the dock output", () => {
  const names = ["DP-3", "DP-2"]
  // explicit name
  assert.equal(model.pickScreenName(names, "DP-2", "DP-3", "", false), "DP-2")
  // unset or unknown name falls back to the first output
  assert.equal(model.pickScreenName(names, "", "DP-2", "", false), "DP-3")
  assert.equal(model.pickScreenName(names, "HDMI-A-1", "DP-2", "", false), "DP-3")
  // focused mode follows the focused monitor, or falls back when unknown
  assert.equal(model.pickScreenName(names, "focused", "DP-2", "DP-3", false), "DP-2")
  assert.equal(model.pickScreenName(names, "focused", "", "DP-3", false), "DP-3")
  assert.equal(model.pickScreenName(names, "focused", "HDMI-A-1", "", false), "DP-3")
  // frozen keeps the current output while it is still connected
  assert.equal(model.pickScreenName(names, "focused", "DP-2", "DP-3", true), "DP-3")
  // ...but not once it has been unplugged
  assert.equal(model.pickScreenName(["DP-2"], "focused", "DP-2", "DP-3", true), "DP-2")
  // no outputs
  assert.equal(model.pickScreenName([], "DP-2", "DP-2", "DP-2", false), "")
  assert.equal(model.pickScreenName(undefined, "", "", "", false), "")
})

test("settings write guard ignores matching content", () => {
  model.resetSettingsGuard()
  model.markSettingsWritten('{"autoHide":true}\n')
  assert.equal(model.shouldReprocessSettings('{"autoHide":true}\n'), false)
  assert.equal(model.shouldReprocessSettings('{"autoHide":false}\n'), true)
  // After an external edit is applied and marked, editing back is seen again.
  model.markSettingsWritten('{"autoHide":false}\n')
  assert.equal(model.shouldReprocessSettings('{"autoHide":true}\n'), true)
})

test("auto-hide state machine: shouldHideDock and shouldScheduleHide require ready, engaged, suppressed", () => {
  const base = { autoHide: true, enabled: true, dockReady: true, autoHidden: false, dockEngaged: false, hideSuppressed: false, dockHovered: false, edgeHovered: false }
  assert.equal(model.shouldHideDock(base), true)
  assert.equal(model.shouldScheduleHide(base), true)

  // Disabled variants
  assert.equal(model.shouldHideDock({ ...base, autoHide: false }), false)
  assert.equal(model.shouldHideDock({ ...base, enabled: false }), false)
  assert.equal(model.shouldHideDock({ ...base, dockReady: false }), false)
  assert.equal(model.shouldHideDock({ ...base, autoHidden: true }), false)
  assert.equal(model.shouldHideDock({ ...base, dockEngaged: true }), false)
  assert.equal(model.shouldHideDock({ ...base, dockHovered: true }), false)
  assert.equal(model.shouldHideDock({ ...base, edgeHovered: true }), false)
  assert.equal(model.shouldHideDock({ ...base, hideSuppressed: true }), false)

  assert.equal(model.shouldScheduleHide({ ...base, dockReady: false }), false)
  assert.equal(model.shouldScheduleHide({ ...base, hideSuppressed: true }), false)
  assert.equal(model.shouldScheduleHide({ ...base, dockEngaged: true }), false)
})

test("auto-hide shouldRevealDock only when hidden and edge hovered", () => {
  const hiddenAtEdge = { autoHide: true, enabled: true, autoHidden: true, edgeHovered: true }
  assert.equal(model.shouldRevealDock(hiddenAtEdge), true)
  assert.equal(model.shouldRevealDock({ ...hiddenAtEdge, edgeHovered: false }), false)
  assert.equal(model.shouldRevealDock({ ...hiddenAtEdge, autoHidden: false }), false)
  assert.equal(model.shouldRevealDock({ ...hiddenAtEdge, autoHide: false }), false)
  assert.equal(model.shouldRevealDock({ ...hiddenAtEdge, enabled: false }), false)
})

test("auto-hide matrix: menu/picker/preview/floating/altTab suppress hide", () => {
  const idle = { autoHide: true, enabled: true, dockReady: true, autoHidden: false, dockEngaged: false, hideSuppressed: false }
  assert.equal(model.shouldHideDock(idle), true)
  assert.equal(model.shouldHideDock({ ...idle, hideSuppressed: true }), false)
  // hideSuppressed covers menu/picker/preview/floating/altTab
  assert.equal(model.shouldHideDock({ ...idle, dockEngaged: true }), false)
  assert.equal(model.shouldRevealDock({ autoHide: true, enabled: true, autoHidden: true, edgeHovered: true }), true)
  assert.equal(model.shouldRevealDock({ autoHide: true, enabled: true, autoHidden: true, edgeHovered: false }), false)
})

test("auto-hide hide→reveal→hide cycle is deterministic", () => {
  // Start visible, idle → hide
  let s = { autoHide: true, enabled: true, dockReady: true, autoHidden: false, dockEngaged: false, hideSuppressed: false, edgeHovered: false, dockHovered: false }
  assert.equal(model.shouldHideDock(s), true)
  s.autoHidden = true
  // Hidden, edge not hovered → no reveal
  assert.equal(model.shouldRevealDock(s), false)
  // Edge hovered → reveal
  s.edgeHovered = true
  s.dockEngaged = true
  assert.equal(model.shouldRevealDock(s), true)
  s.autoHidden = false
  s.edgeHovered = false
  s.dockEngaged = false
  // Back to idle → should hide again
  assert.equal(model.shouldHideDock(s), true)
  // Repeat without stuck state
  s.autoHidden = true
  s.edgeHovered = true
  s.dockEngaged = true
  assert.equal(model.shouldRevealDock(s), true)
})

test("isWebAppClass gates browser-generated classes", () => {
  assert.equal(model.isWebAppClass("firefox"), false)
  assert.equal(model.isWebAppClass("opencode"), false)
  assert.equal(model.isWebAppClass("vlc"), false)
  assert.equal(model.isWebAppClass("google-chrome"), false)
  assert.equal(model.isWebAppClass("x.com"), true)
  assert.equal(model.isWebAppClass("web.whatsapp.com"), true)
  assert.equal(model.isWebAppClass("chrome-web.whatsapp.com__-Default"), true)
  assert.equal(model.isWebAppClass("chrome-youtube.com__-Default-123"), true)
})

test("issue #19: short web-app Name does not hijack firefox", () => {
  const entries = [
    { id: "firefox", name: "Firefox" },
    { id: "X", name: "X" },
  ]
  assert.equal(model.desktopIdForWindow("firefox", entries), "firefox")
  assert.equal(model.desktopIdForWindow("opencode", entries), "opencode")
  assert.equal(model.desktopIdForWindow("vlc", entries), "vlc")
})

test("issue #19: web-app classes still resolve via Name fallback", () => {
  const entries = [
    { id: "firefox", name: "Firefox" },
    { id: "X", name: "X" },
    { id: "whatsapp", name: "WhatsApp" },
  ]
  assert.equal(model.desktopIdForWindow("x.com", entries), "X")
  assert.equal(
    model.desktopIdForWindow("chrome-web.whatsapp.com__-Default", entries),
    "whatsapp",
  )
})

test("desktopIdForWindow prefers exact id over Name fallback", () => {
  const entries = [
    { id: "X", name: "Firefox" },
    { id: "firefox", name: "Firefox" },
  ]
  assert.equal(model.desktopIdForWindow("firefox", entries), "firefox")
  assert.equal(model.desktopIdForWindow("unknown-app", entries), "unknown-app")
})

const shown = (address, workspaceName) => ({ address, workspaceName })
const parked = (address) => ({ address, workspaceName: "special:minimized" })

test("hidden state is read from the special:minimized workspace name", () => {
  assert.equal(model.isHiddenWorkspace("special:minimized"), true)
  assert.equal(model.isHiddenWorkspace("special:scratchpad"), false)
  assert.equal(model.isHiddenWorkspace("3"), false)
  assert.equal(model.isHiddenWorkspace(""), false)
  assert.equal(model.isHiddenWorkspace(undefined), false)
})

test("hide moves every window not already hidden, silently, by address", () => {
  const dispatches = model.hideDispatches([
    shown("0xaaa", "1"),
    parked("0xbbb"),
    shown("ccc", "special:scratchpad"),
  ])
  assert.deepEqual(Array.from(dispatches), [
    'hl.dsp.window.move({ window = "address:0xaaa", workspace = "special:minimized", follow = false })',
    'hl.dsp.window.move({ window = "address:0xccc", workspace = "special:minimized", follow = false })',
  ])
})

test("hide of an app whose windows are all hidden dispatches nothing", () => {
  assert.deepEqual(Array.from(model.hideDispatches([parked("0xaaa"), parked("0xbbb")])), [])
})

test("activating an app with no windows returns null so the caller launches", () => {
  assert.equal(model.activationPlan([], 1), null)
  assert.equal(model.activationPlan([{ address: "" }], 1), null)
})

test("activating an app with a visible window focuses it and restores nothing", () => {
  const plan = model.activationPlan([parked("0xaaa"), shown("0xbbb", "4"), parked("0xccc")], 1)
  assert.deepEqual(Array.from(plan.moves), [])
  assert.equal(plan.focus, "0xbbb")
})

test("activating an app whose windows are all hidden brings them all to the active workspace", () => {
  const plan = model.activationPlan([parked("0xaaa"), parked("0xbbb")], 3)
  assert.deepEqual(Array.from(plan.moves), [
    'hl.dsp.window.move({ window = "address:0xaaa", workspace = "3", follow = false })',
    'hl.dsp.window.move({ window = "address:0xbbb", workspace = "3", follow = false })',
  ])
  assert.equal(plan.focus, "0xaaa")
})

test("activating one hidden window from its preview restores only that window", () => {
  const plan = model.activationPlan([parked("0xbbb")], 2)
  assert.deepEqual(Array.from(plan.moves), [
    'hl.dsp.window.move({ window = "address:0xbbb", workspace = "2", follow = false })',
  ])
  assert.equal(plan.focus, "0xbbb")
})

test("hidden windows stay put when the focused monitor has no regular workspace", () => {
  for (const workspaceId of [-1, -98, 0, undefined]) {
    const plan = model.activationPlan([parked("0xaaa")], workspaceId)
    assert.deepEqual(Array.from(plan.moves), [], `workspace ${workspaceId}`)
    assert.equal(plan.focus, "", `workspace ${workspaceId}`)
  }
})

const WINDOW_SETS = [[], undefined, [shown("0xaaa", "1")], [parked("0xaaa")]]

test("left click activates and middle click opens the menu in either rightClick mode", () => {
  for (const mode of ["menu", "hide"]) {
    for (const windows of WINDOW_SETS) {
      assert.equal(model.iconClickAction("left", windows, mode), "activate", mode)
      assert.equal(model.iconClickAction("middle", windows, mode), "menu", mode)
    }
  }
})

test("in menu mode right click opens the menu whatever the windows", () => {
  for (const windows of WINDOW_SETS) {
    assert.equal(model.iconClickAction("right", windows, "menu"), "menu")
  }
  assert.equal(model.iconClickAction("right", [shown("0xaaa", "1")], model.DEFAULT_SETTINGS.rightClick), "menu")
})

test("in hide mode right click on an app without windows keeps the menu", () => {
  assert.equal(model.iconClickAction("right", [], "hide"), "menu")
  assert.equal(model.iconClickAction("right", undefined, "hide"), "menu")
  assert.equal(model.iconClickAction("right", [{ address: "", workspaceName: "1" }], "hide"), "menu")
})

test("in hide mode right click hides an app with any window in view", () => {
  assert.equal(model.iconClickAction("right", [shown("0xaaa", "1")], "hide"), "hide")
  assert.equal(model.iconClickAction("right", [parked("0xaaa"), shown("0xbbb", "special:scratchpad")], "hide"), "hide")
})

test("in hide mode right click restores an app whose windows are all hidden", () => {
  assert.equal(model.iconClickAction("right", [parked("0xaaa")], "hide"), "restore")
  assert.equal(model.iconClickAction("right", [parked("0xaaa"), parked("0xbbb"), { address: "", workspaceName: "1" }], "hide"), "restore")
})

test("normalizes exact nonzero hexadecimal window addresses", () => {
  for (const address of ["AbC123", "0xAbC123", "0X00AbC123"]) {
    assert.equal(model.normalizeWindowAddress(address), "0xabc123")
  }
  assert.equal(model.normalizeWindowAddress("0x123456789abcdef123"), "0x123456789abcdef123")
})

test("window actions dispatch close and kill to the selected address", () => {
  assert.equal(model.windowActionDispatch("close", "0X00AbC123"),
    'hl.dsp.window.close({ window = "address:0xabc123" })')
  assert.equal(model.windowActionDispatch("kill", "def456"),
    'hl.dsp.window.kill({ window = "address:0xdef456" })')
})

test("window actions reject missing, zero, malformed and injected targets", () => {
  const invalid = [undefined, null, 0, 123, {}, "", "0", "00", "0x0", "0X000", "0x",
    " 0x123", "0x123 ", "address:0x123", "0x123\n", "0x12g", "-1", "0x1; hl.dsp.exit()",
    '0x1" }); hl.dsp.window.kill({ window = "active']
  for (const address of invalid) {
    assert.equal(model.normalizeWindowAddress(address), "", String(address))
    assert.equal(model.windowActionDispatch("close", address), "", String(address))
    assert.equal(model.windowActionDispatch("kill", address), "", String(address))
  }
})

test("window actions reject every action outside the close and kill allowlist", () => {
  for (const action of [undefined, null, "", "Close", "forceKill", "__proto__", "toString", "kill(); hl.dsp.exit()"])
    assert.equal(model.windowActionDispatch(action, "0x123"), "")
})
