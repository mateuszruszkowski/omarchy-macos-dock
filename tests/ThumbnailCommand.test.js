const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const vm = require("node:vm")
const { spawnSync } = require("node:child_process")

const qml = fs.readFileSync(path.join(__dirname, "../DockPanelBase.qml"), "utf8")
const source = qml.match(/^  function thumbnailCommand\(job\) \{[\s\S]*?^  \}/m)?.[0]
assert.ok(source, "extract production thumbnailCommand")
const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'"
function commandFor(dir, job) {
  return vm.runInNewContext("(" + source.trim() + ")", {
    root: { thumbnailDir: dir }, Util: { shellQuote },
  })(job)
}

test("missing stableId cannot start a composited screen capture", () => {
  for (const job of [null, {}, { address: "0x123" }, { stableId: "" }])
    assert.equal(commandFor("/unused", job), "false")
})

test("thumbnail captures the exact toplevel and writes a 304x184 PNG", t => {
  if (spawnSync("magick", ["-version"]).status !== 0) return t.skip("ImageMagick unavailable")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dock-thumbnail-test-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin)
  const argsFile = path.join(dir, "grim-arguments")
  fs.writeFileSync(path.join(bin, "grim"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$GRIM_ARGS"\nprintf "P3\\n2 1\\n255\\n255 0 0 0 255 0\\n"\n', { mode: 0o755 })
  const output = path.join(dir, "cache's directory")
  const stableId = "selected'; $(touch SHOULD_NOT_EXIST); 'window"
  const result = spawnSync("bash", ["-c", commandFor(output, { address: "0x123", stableId })], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, GRIM_ARGS: argsFile },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fs.readFileSync(argsFile, "utf8").trimEnd().split("\n"), ["-T", stableId, "-"])
  assert.equal(fs.existsSync(path.join(dir, "SHOULD_NOT_EXIST")), false)
  const image = path.join(output, "0x123.png")
  assert.equal(fs.existsSync(image + ".tmp"), false)
  const identify = spawnSync("magick", ["identify", "-format", "%m %wx%h", image], { encoding: "utf8" })
  assert.equal(identify.status, 0, identify.stderr)
  assert.equal(identify.stdout, "PNG 304x184")
})
