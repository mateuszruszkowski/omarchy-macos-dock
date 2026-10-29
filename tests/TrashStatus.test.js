const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const qml = fs.readFileSync(path.join(__dirname, '../DockPanelBase.qml'), 'utf8')
const source = qml.match(/^  function trashStatusCommand\(\) \{[\s\S]*?^  \}/m)?.[0]

test('trash status includes hidden files, directories and broken symlinks without external scanners', t => {
  assert.ok(source, 'production trash command exists')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-trash-status-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const trash = path.join(dir, "trash's files")
  const command = () => vm.runInNewContext('(' + source.trim() + ')', {root: {trashFilesPath: trash}})()
  const check = expected => {
    const args = command()
    // PATH contains no ls/head/grep/find; the check uses bash builtins only.
    const result = spawnSync('/bin/bash', args.slice(1), { encoding: 'utf8', env: {...process.env, PATH: '/nonexistent'} })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), expected)
  }
  check('empty')
  fs.mkdirSync(trash); check('empty')
  for (const name of ['normal', '.hidden']) {
    fs.writeFileSync(path.join(trash, name), 'test'); check('full')
    fs.unlinkSync(path.join(trash, name)); check('empty')
  }
  fs.mkdirSync(path.join(trash, 'directory')); check('full')
  fs.rmdirSync(path.join(trash, 'directory')); check('empty')
  fs.symlinkSync('/definitely-missing-dock-test-target', path.join(trash, 'broken')); check('full')
  fs.unlinkSync(path.join(trash, 'broken')); check('empty')
  fs.rmdirSync(trash); check('empty')
})

test('production QML watchers recover missing and recreated trash directories', async t => {
  const { spawn } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-trash-watch-'))
  const home = path.join(dir, 'home')
  const share = path.join(home, '.local/share')
  const trash = path.join(share, 'Trash/files')
  fs.mkdirSync(share, { recursive: true })
  const functions = ['trashStatusCommand', 'updateTrashStatus', 'rearmTrashWatchers'].map(name => {
    const match = qml.match(new RegExp('^  function ' + name + '\\(\\) \\{[\\s\\S]*?^  \\}', 'm'))
    assert.ok(match, name)
    return match[0]
  }).join('\n')
  const section = qml.slice(qml.indexOf('  // Directory events do the normal refresh'), qml.indexOf('  // Persistence is written'))
  assert.ok(section.includes('id: trashCheckProcess'))
  fs.writeFileSync(path.join(dir, 'shell.qml'), `import QtQuick
import Quickshell
import Quickshell.Io
ShellRoot {
 id: root
 property string home: ${JSON.stringify(home)}
 property string trashFilesPath: ${JSON.stringify(trash)}
 property bool trashFull: false
 property bool trashCheckPending: false
 ${functions}
 ${section}
 Component.onCompleted: { updateTrashStatus(); updateTrashStatus() }
 Timer { interval: 100; running: true; repeat: true; onTriggered: console.log("TRASH_STATE", root.trashFull, root.trashCheckPending) }
}`)
  const child = spawn('qs', ['-p', dir, '--no-color'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = '', state = null, pending = true, exited = false
  const receive = data => {
    log += String(data)
    const matches = [...log.matchAll(/TRASH_STATE (true|false) (true|false)/g)]
    if (matches.length) { state = matches.at(-1)[1] === 'true'; pending = matches.at(-1)[2] === 'true' }
  }
  child.stdout.on('data', receive); child.stderr.on('data', receive)
  child.on('exit', () => { exited = true })
  t.after(async () => {
    child.kill('SIGTERM')
    if (!exited) await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 1000) })
    fs.rmSync(dir, {recursive: true, force: true})
  })
  const waitState = async (expected, label) => {
    const until = Date.now() + 4000
    while (Date.now() < until) {
      if (state === expected && !pending) return
      assert.equal(exited, false, log)
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    assert.fail(label + '\n' + log)
  }
  await waitState(false, 'missing directory is empty and pending refresh settles')
  fs.mkdirSync(trash, {recursive: true})
  fs.writeFileSync(path.join(trash, '.hidden'), 'test')
  await waitState(true, 'new tree with hidden file')
  fs.rmSync(path.join(share, 'Trash'), {recursive: true})
  await waitState(false, 'deleted whole Trash')
  fs.mkdirSync(trash, {recursive: true})
  fs.symlinkSync('/missing-dock-fixture-target', path.join(trash, 'broken'))
  await waitState(true, 'recreated whole Trash with broken link')
  fs.rmSync(trash, {recursive: true})
  await waitState(false, 'deleted files directory')
  fs.mkdirSync(path.join(trash, 'directory'), {recursive: true})
  await waitState(true, 'recreated files directory with subdirectory')
  fs.rmdirSync(path.join(trash, 'directory'))
  await waitState(false, 'empty after final entry removed')
})
