import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons

Item {
  id: root

  property var shell: null
  property var pluginRegistry: null
  property var manifest: null
  property var barWidgetRegistry: null
  property var service: null

  // Keep the mature interaction/launch/pinning implementation intact while
  // giving it a tighter macOS-like visual shell.
  DockPanelBase {
    id: dock
    shell: root.shell
    pluginRegistry: root.pluginRegistry
    manifest: root.manifest
  }

  // A lightweight material layer sits above the legacy surface. It is
  // intentionally almost transparent: its job is to add the soft edge and
  // glass highlight that makes the dock read as a floating material surface,
  // not as a generic black panel. The actual icons remain fully interactive.
  PanelWindow {
    id: material
    visible: dock.enabled && !dock.conflictDetected && !dock.remapping && Quickshell.screens.length > 0
    screen: dock.resolveScreen()
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.namespace: "macos-dock-material"
    anchors { top: true; bottom: true; left: true; right: true }
    mask: Region {}

    // Mirror the dock surface's screen-space geometry. The surface follows
    // numeric x/y/width/height on the base so both layers can never disagree.
    Rectangle {
      id: materialSurface
      Connections {
        target: Style
        function onReduceMotionChanged() {
          if (!Style.reduceMotion) return
          materialSurface.width = Qt.binding(function() { return dock.surfaceWidth })
          materialSurface.height = Qt.binding(function() { return dock.surfaceHeight })
          materialSurface.opacity = Qt.binding(function() { return dock.menuOpen || dock.pickerOpen || dock.dockHovered ? 1 : 0.92 })
        }
      }
      x: dock.surfaceX
      y: dock.surfaceY
      width: dock.surfaceWidth
      height: dock.surfaceHeight
      radius: dock.metrics.cornerRadius
      color: "transparent"
      border.color: "transparent"
      border.width: 0
      opacity: dock.menuOpen || dock.pickerOpen || dock.dockHovered ? 1 : 0.92

      Behavior on width { enabled: !Style.reduceMotion; NumberAnimation { duration: Style.duration(250); easing.type: Easing.OutCubic } }
      Behavior on height { enabled: !Style.reduceMotion; NumberAnimation { duration: Style.duration(250); easing.type: Easing.OutCubic } }
      Behavior on opacity { enabled: !Style.reduceMotion; NumberAnimation { duration: Style.duration(160) } }
    }
  }
}
