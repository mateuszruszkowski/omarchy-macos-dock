const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const sourceRoot = process.env.DOCK_SOURCE_ROOT || path.join(__dirname, '..')

function runQml(t, source, files = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-performance-qml-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'shell.qml'), source)
  for (const file of files) fs.copyFileSync(path.join(sourceRoot, file), path.join(dir, file))
  if (files.length) {
    fs.mkdirSync(path.join(dir, 'Commons'))
    fs.writeFileSync(path.join(dir, 'Commons/qmldir'), 'module qs.Commons\nsingleton Style 1.0 Style.qml\nsingleton Color 1.0 Color.qml\n')
    fs.writeFileSync(path.join(dir, 'Commons/Style.qml'), 'pragma Singleton\nimport QtQuick\nQtObject { property bool reduceMotion: false; function duration(ms) { return reduceMotion ? 0 : ms } }\n')
    fs.writeFileSync(path.join(dir, 'Commons/Color.qml'), 'pragma Singleton\nimport QtQuick\nQtObject { property color accent: "red"; property color foreground: "white" }\n')
  }
  const result = spawnSync('qs', ['-p', dir, '--no-color'], { encoding: 'utf8', timeout: 8000 })
  const output = result.stdout + result.stderr
  assert.equal(result.status, 0, output)
  assert.match(output, /DOCK_PERFORMANCE_PASS/, output)
  assert.doesNotMatch(output, /DOCK_PERFORMANCE_FAIL/, output)
}

test('real QML capture completion keeps numeric batch identity and ignores active captures', t => {
  const source = fs.readFileSync(path.join(sourceRoot, 'DockPanelBase.qml'), 'utf8')
  const component = source.slice(source.indexOf('  Component {\n    id: captureProcess'), source.indexOf('  property string activeThumbAddress'))
  assert.ok(component.startsWith('  Component {'))
  runQml(t, `import QtQuick
import Quickshell
import Quickshell.Io
ShellRoot {
 id: root
 property int currentThumbBatch: 4
 property int snapshotPending: 2
 property int applied: 0
 property var thumbCache: ({})
 property var inFlightAddrs: ({})
 function applyThumbnails() { applied++ }
 ${component}
 Component.onCompleted: {
   captureProcess.createObject(root, {jobAddress: "snapshot", jobBatch: 4, command: ["sh", "-c", "exit 0"]}).running = true
   captureProcess.createObject(root, {jobAddress: "active", jobBatch: -1, command: ["sh", "-c", "exit 0"]}).running = true
   captureProcess.createObject(root, {jobAddress: "failed", jobBatch: 4, command: ["sh", "-c", "exit 3"]}).running = true
 }
 Timer { interval: 500; running: true; onTriggered: {
   if (root.applied === 1 && root.snapshotPending === 0 && root.thumbCache.snapshot && root.thumbCache.active && !root.thumbCache.failed)
     console.log("DOCK_PERFORMANCE_PASS")
   else console.log("DOCK_PERFORMANCE_FAIL", root.applied, root.snapshotPending)
   Qt.quit()
 } }
}`)
})

test('reduced motion cancels an active launch bounce and preserves later bounce and scale changes', t => {
  runQml(t, `import QtQuick
import QtTest
import Quickshell
import qs.Commons
ShellRoot {
 DockItem {
   id: icon
   itemData: ({id: "test", running: true})
   iconSize: 42
   launchBounceHeight: 24
   iconSourceOverride: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/>"
   property int finished: 0
   onLaunchBounceFinished: finished++
 }
 TestCase {
   id: tester
   name: "DockMotion"
   when: false
   function require(value, message) { if (!value) throw new Error(message) }
   function runProbe() {
     try {
       Style.reduceMotion = false
       require(icon.playLaunchBounce(), "normal bounce starts")
       wait(50)
       icon.targetScale = 1.2
       icon.targetOpacity = 0.4
       wait(20)
       Style.reduceMotion = true
       wait(30)
       require(icon.bounceOffset === 0, "active bounce resets immediately")
       require(icon.scale === 1.2, "active spring finishes at its target in reduced motion")
       require(icon.opacity === 0.4, "active fade finishes at its target in reduced motion")
       require(icon.finished === 1, "cancellation releases launch bookkeeping once")
       require(!icon.playLaunchBounce(), "new bounce suppressed in reduced motion")
       icon.targetScale = 1.36
       wait(20)
       require(icon.scale === 1.36, "magnification still reaches its target immediately")
       Style.reduceMotion = false
       require(icon.playLaunchBounce(), "bounce available again after reenabling motion")
       icon.cancelLaunchBounce()
       require(icon.bounceOffset === 0, "explicit cancel resets offset")
       console.log("DOCK_PERFORMANCE_PASS")
     } catch(error) { console.log("DOCK_PERFORMANCE_FAIL", String(error)) }
     Qt.quit()
   }
 }
 Timer { interval: 100; running: true; onTriggered: tester.runProbe() }
}`, ['DockItem.qml', 'IconResolver.js'])
})
