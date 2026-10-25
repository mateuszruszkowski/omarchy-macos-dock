import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Ui

// A single window card inside the hover preview. Prefer a live compositor
// capture at the window's native source resolution. The preview card is much
// smaller than the source window, so the compositor/GPU can downsample it
// instead of displaying a pre-scaled 304x184 screenshot. Cached thumbnails
// remain the fallback when direct toplevel capture is unavailable.
Item {
  id: root

  required property var windowData
  property string iconSource: ""
  property string thumbnail: ""
  property bool active: false
  property bool animationEnabled: true
  property var captureToplevel: null

  signal activated(var windowData)
  signal closeRequested(string address)
  signal forceKillRequested(string address)

  Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  width: 168
  height: 144

  function resolveToplevel() {
    var wanted = String(root.windowData && root.windowData.address ? root.windowData.address : "")
    if (!wanted) return null
    try {
      var values = Hyprland.toplevels.values
      for (var i = 0; i < values.length; i++) {
        var candidate = values[i]
        if (String(candidate && candidate.address ? candidate.address : "") === wanted)
          return candidate
      }
    } catch (error) {}
    return null
  }

  Component.onCompleted: root.captureToplevel = root.resolveToplevel()

  Connections {
    target: Hyprland.toplevels
    function onValuesChanged() {
      root.captureToplevel = root.resolveToplevel()
    }
  }

  Rectangle {
    id: card
    z: 1
    scale: cardHover.hovered ? 1.05 : 1
    anchors { top: parent.top; left: parent.left; right: parent.right }
    height: 118
    radius: 14
    color: Util.alpha(Color.background, 0.96)
    border.color: root.active ? Util.alpha(Color.accent, 0.85) : Util.alpha(Color.foreground, 0.15)
    border.width: root.active ? 2 : 1

    Behavior on border.color { ColorAnimation { duration: 150 } }
    Behavior on scale {
      enabled: root.animationEnabled
      SpringAnimation { spring: 3.2; damping: 0.29; mass: 1 }
    }

    // Direct compositor capture is the primary source. ScreencopyView keeps
    // the source at the window's native resolution, then the scene renders it
    // into this small card. Quickshell 0.3.0 also fixed the scaled
    // ScreencopyView pixelation issue, so this avoids the old low-resolution
    // cached-frame path on current Omarchy/Quickshell builds.
    ScreencopyView {
      id: livePreview
      anchors.fill: parent
      anchors.margins: 8
      captureSource: root.captureToplevel ? root.captureToplevel.wayland : null
      live: true
      paintCursor: false
      visible: root.captureToplevel !== null
      clip: true
    }

    // Cached screenshots remain useful as a fallback if the compositor cannot
    // expose a Wayland toplevel for this window.
    Image {
      id: cachedThumbnail
      anchors.fill: parent
      anchors.margins: 8
      visible: !livePreview.hasContent && root.thumbnail !== ""
      source: root.thumbnail
      sourceSize: Qt.size(304, 184)
      fillMode: Image.PreserveAspectCrop
      asynchronous: true
      cache: true
      clip: true
    }

    Item {
      visible: !livePreview.hasContent && !cachedThumbnail.visible
      anchors.fill: parent
      anchors.margins: 8

      Rectangle {
        id: iconBackdrop
        anchors.fill: parent
        radius: 9
        color: Util.alpha(Color.foreground, 0.06)
      }

      Image {
        id: iconImage
        anchors.centerIn: parent
        width: 64
        height: 64
        source: root.iconSource
        sourceSize: Qt.size(128, 128)
        fillMode: Image.PreserveAspectFit
        asynchronous: true
        cache: true

        Text {
        textFormat: Text.PlainText
          anchors.centerIn: parent
          visible: parent.status !== Image.Ready
          text: "◆"
          color: Color.foreground
          font.pixelSize: 26
        }
      }
    }

    Rectangle {
      anchors.fill: parent
      anchors.margins: 8
      radius: 9
      color: "transparent"
      border.width: 1
      border.color: Util.alpha(Color.foreground, 0.10)
    }
    Repeater {
      model: 2

      delegate: Rectangle {
        id: control
        required property int index
        readonly property bool force: index === 0
        readonly property string label: strings.t(force ? "preview.forceKill" : "preview.close")
        x: force ? 8 : card.width - width - 8
        y: 8
        width: 24
        height: 24
        radius: 7
        color: force
          ? (controlMouse.pressed ? "#a4232e" : controlMouse.containsMouse ? "#ef5360" : "#d63645")
          : Util.alpha(Color.background, controlMouse.pressed ? 1 : controlMouse.containsMouse ? 0.98 : 0.90)
        border.width: 1
        border.color: force ? "#f27880" : Util.alpha(Color.foreground, controlMouse.containsMouse ? 0.55 : 0.28)
        Accessible.role: Accessible.Button
        Accessible.name: label
        Accessible.onPressAction: control.requestAction()

        function requestAction() {
          var address = root.windowData && root.windowData.address ? root.windowData.address : ""
          if (force) root.forceKillRequested(address)
          else root.closeRequested(address)
        }

        Text {
          anchors.centerIn: parent
          text: "×"
          color: control.force ? "white" : Color.foreground
          font.pixelSize: 21
          font.family: Style.font.family
        }

        MouseArea {
          id: controlMouse
          anchors.fill: parent
          hoverEnabled: true
          cursorShape: Qt.PointingHandCursor
          onClicked: control.requestAction()
        }

        PanelToolTip {
          visible: controlMouse.containsMouse
          text: control.label
        }
      }
    }
  }

  Text {
        textFormat: Text.PlainText
    id: titleText
    anchors { top: card.bottom; left: parent.left; right: parent.right }
    height: 22
    topPadding: 4
    elide: Text.ElideRight
    horizontalAlignment: Text.AlignHCenter
    text: root.windowData && root.windowData.title ? root.windowData.title : ""
    color: Color.foreground
    font.family: Style.font.family
    font.pixelSize: Style.font.bodySmall
  }

  HoverHandler { id: cardHover }

  MouseArea {
    anchors.fill: parent
    hoverEnabled: true
    cursorShape: Qt.PointingHandCursor

    onClicked: root.activated(root.windowData)
  }
}
