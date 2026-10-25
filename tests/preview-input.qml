import QtQuick
import QtTest
import Quickshell

ShellRoot {
  WindowPreviewPanel {
    id: panel
    readonly property var requestedScreen: Quickshell.screens.find(s => s.name === Quickshell.env("DOCK_INPUT_TEST_SCREEN")) || null
    screen: requestedScreen
    previewVisible: requestedScreen !== null
    windowList: requestedScreen ? [{address: "0xdeadbeef", title: "Input regression probe"}] : []
    centerX: 400
    bottomY: 500
    property int activations: 0
    property int closes: 0
    property int kills: 0
    property int enters: 0
    property int exits: 0
    property string activatedAddress: ""
    property string closedAddress: ""
    property string killedAddress: ""
    onActivated: data => { activations++; activatedAddress = data.address }
    onCloseRequested: address => { closes++; closedAddress = address }
    onForceKillRequested: address => { kills++; killedAddress = address }
    onPreviewHoverEntered: enters++
    onPreviewHoverExited: exits++
    Timer {
      interval: 1200
      running: true
      onTriggered: tester.runProbe()
    }
    TestCase {
      id: tester
      name: "DockInput"
      when: false
      function require(condition, label) {
        if (!condition) throw new Error(label)
      }
      function runProbe() {
        try {
          require(panel.requestedScreen !== null, "requested disposable screen exists")
          require(panel.cards.length === 1, "one card created")
          var card = panel.cards[0]
          mouseMove(panel.contentItem, 10, 10)
          mouseMove(card, 84, 70)
          wait(30)
          require(panel.enters > 0, "hover enters card")
          mouseClick(card, 84, 70)
          require(panel.activations === 1 && panel.activatedAddress === "0xdeadbeef", "card activates exact address")
          mouseMove(card, 148, 20)
          mouseClick(card, 148, 20)
          require(panel.closes === 1 && panel.closedAddress === "0xdeadbeef" && panel.activations === 1, "normal X closes only")
          mouseMove(card, 20, 20)
          mouseClick(card, 20, 20)
          require(panel.kills === 1 && panel.killedAddress === "0xdeadbeef" && panel.activations === 1, "red X kills only")
          mouseMove(card, 84, 130)
          mouseClick(card, 84, 130)
          require(panel.activations === 2, "title activates")
          require(panel.exits === 0, "moving between controls keeps hover")
          mouseMove(panel.contentItem, 10, 10)
          wait(30)
          require(panel.exits === 1, "hover exits panel")
          console.log("DOCK_INPUT_TEST_PASS")
        } catch(error) {
          console.log("DOCK_INPUT_TEST_FAIL", String(error))
        }
        Qt.quit()
      }
    }
  }
}
