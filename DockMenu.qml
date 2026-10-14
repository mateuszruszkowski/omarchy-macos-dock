import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "DockModelBase.js" as DockModel

PanelWindow {
  id: root

  property var itemData: null
  // Whether itemData's app is pinned right now. itemData is the snapshot
  // taken when the menu opened, so its own `pinned` goes stale after Pin.
  property bool pinned: false
  property string iconSource: ""
  property bool opened: false
  property point requestedPosition: Qt.point(0, 0)
  // The dock's settings (DockModel.DEFAULT_SETTINGS keys) and the connected
  // output names, for the Dock section.
  property var settings: DockModel.DEFAULT_SETTINGS
  property var screenNames: []

  // The Dock section, two settings to a line. A row offers its options, or
  // − value + buttons when it is a stepper.
  readonly property var settingRows: [
    { label: "Hiding", key: "autoHide", options: [{ label: "On", value: true }, { label: "Off", value: false }] },
    { label: "Position", key: "dockSide", options: [{ label: "Bottom", value: "bottom" }, { label: "Left", value: "left" }, { label: "Right", value: "right" }] },
    { label: "Screen", key: "screen", options: [{ label: "Focused", value: "focused" }].concat(root.screenNames.map(function(name) { return { label: name, value: name } })) },
    { label: "Right click", key: "rightClick", options: [{ label: "Menu", value: "menu" }, { label: "Hide", value: "hide" }] },
    { label: "Icon size", key: "iconSize", stepper: true },
    { label: "Magnification", key: "magnification", stepper: true },
    { label: "Hover", key: "hoverEffect", options: [{ label: "Wave", value: "wave" }, { label: "Zoom", value: "zoom" }, { label: "None", value: "none" }] },
    { label: "Bounce", key: "bounce", options: [{ label: "On", value: true }, { label: "Off", value: false }] }
    // Minimize effect (Genie / Scale / None) goes here once hiding an app
    // animates its windows.
  ]

  signal actionTriggered(string action, var itemData)

  visible: opened && itemData !== null
  color: "transparent"
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.namespace: "macos-dock-menu"
  anchors { top: true; bottom: true; left: true; right: true }
  mask: Region { item: dismissSurface }

  Rectangle {
    id: card
    x: Math.round((root.width - width) / 2)
    y: Math.round((root.height - height) / 2)
    width: 650
    height: menuContent.implicitHeight + 44
    radius: 22
    color: Util.alpha(Color.background, 0.97)
    border.color: Util.alpha(Color.foreground, 0.14)
    border.width: 1

    Column {
      id: menuContent
      x: 22
      y: 22
      width: parent.width - 44
      spacing: 16

      Item {
        width: parent.width
        height: 58

        Rectangle {
          width: 58
          height: 58
          radius: 16
          anchors.left: parent.left
          color: Util.alpha(Color.foreground, 0.08)

          Image {
            id: appIcon
            anchors.centerIn: parent
            width: 48
            height: 48
            source: root.iconSource
            sourceSize: Qt.size(96, 96)
            fillMode: Image.PreserveAspectFit
            visible: status === Image.Ready
          }
          Text {
            anchors.centerIn: parent
            text: root.itemData && root.itemData.name ? String(root.itemData.name).charAt(0).toUpperCase() : "•"
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: 24
            font.bold: true
            visible: !appIcon.visible
          }
        }

        Column {
          anchors.left: parent.left
          anchors.leftMargin: 72
          anchors.verticalCenter: parent.verticalCenter
          spacing: 3
          Text {
            text: root.itemData && root.itemData.name ? root.itemData.name : "Application"
            color: Color.foreground
            font.family: Style.font.family
            font.pixelSize: Style.font.title
            font.bold: true
          }
          Text {
            text: root.itemData && root.itemData.running ? "Running application" : "Pinned application"
            color: Util.alpha(Color.foreground, 0.52)
            font.family: Style.font.family
            font.pixelSize: Style.font.bodySmall
          }
        }

        Rectangle {
          width: 32
          height: 32
          anchors.right: parent.right
          radius: 16
          anchors.verticalCenter: parent.verticalCenter
          color: closeMouse.containsMouse ? Util.alpha(Color.foreground, 0.12) : "transparent"
          Text { anchors.centerIn: parent; text: "×"; color: Util.alpha(Color.foreground, 0.65); font.pixelSize: 22 }
          MouseArea { id: closeMouse; anchors.fill: parent; hoverEnabled: true; onClicked: root.opened = false }
        }
      }

      Rectangle { width: parent.width; height: 1; color: Util.alpha(Color.foreground, 0.10) }

      Text {
        text: "Application actions"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.heading
        font.bold: true
      }

      Row {
        width: parent.width
        height: 112
        spacing: 10

        Repeater {
          id: actionCards
          model: {
            var actions = [
              { action: "setIcon", label: "Get Info", glyph: "✦", detail: "Change icon" },
              { action: "togglePin", glyph: "⌖", detail: "Dock placement" },
              { action: "newWindow", label: "New Window", glyph: "＋", detail: "Open another" },
              { action: "manageIcons", label: "Manage Icons", glyph: "▦", detail: "Browse apps" }
            ]
            if (root.itemData && root.itemData.running)
              actions.push({ action: "hide", label: "Hide", glyph: "－", detail: "All windows" })
            return actions
          }
          delegate: Rectangle {
            required property var modelData
            width: (parent.width - parent.spacing * (actionCards.count - 1)) / actionCards.count
            height: parent.height
            radius: 14
            color: actionMouse.containsMouse ? Util.alpha(Color.accent, 0.16) : Util.alpha(Color.foreground, 0.065)
            border.color: actionMouse.containsMouse ? Util.alpha(Color.accent, 0.55) : "transparent"
            border.width: 1

            Column {
              anchors.centerIn: parent
              spacing: 8
              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: modelData.glyph
                color: actionMouse.containsMouse ? Color.accent : Color.foreground
                font.pixelSize: 24
              }
              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                // Bound here, not in the model, so Pin/Unpin flips without
                // rebuilding the cards under the click that flipped it.
                text: modelData.action === "togglePin" ? (root.pinned ? "Unpin" : "Pin") : modelData.label
                color: Color.foreground
                font.family: Style.font.family
                font.pixelSize: Style.font.body
              }
              Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: modelData.detail
                color: Util.alpha(Color.foreground, 0.45)
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
              }
            }

            MouseArea {
              id: actionMouse
              anchors.fill: parent
              hoverEnabled: true
              onClicked: {
                root.actionTriggered(modelData.action, root.itemData)
              }
            }
          }
        }
      }

      Rectangle { width: parent.width; height: 1; color: Util.alpha(Color.foreground, 0.10) }

      Text {
        text: "Dock"
        color: Color.foreground
        font.family: Style.font.family
        font.pixelSize: Style.font.heading
        font.bold: true
      }

      Grid {
        id: settingsGrid
        width: parent.width
        columns: 2
        columnSpacing: 18
        rowSpacing: 8

        Repeater {
          model: root.settingRows
          delegate: Item {
            id: settingRow
            required property var modelData
            readonly property var shown: DockModel.shownSetting(root.settings, modelData.key, root.screenNames)
            width: (settingsGrid.width - settingsGrid.columnSpacing) / 2
            height: 34

            Text {
              id: settingLabel
              width: 96
              anchors.verticalCenter: parent.verticalCenter
              text: settingRow.modelData.label
              color: Util.alpha(Color.foreground, 0.52)
              font.family: Style.font.family
              font.pixelSize: Style.font.bodySmall
            }

            Row {
              id: settingOptions
              visible: !settingRow.modelData.stepper
              anchors { left: settingLabel.right; right: parent.right; top: parent.top; bottom: parent.bottom }
              spacing: 6
              Repeater {
                model: settingRow.modelData.options || []
                delegate: UtilityButton {
                  required property var modelData
                  width: (settingOptions.width - settingOptions.spacing * (settingRow.modelData.options.length - 1)) / settingRow.modelData.options.length
                  label: modelData.label
                  action: DockModel.settingAction(settingRow.modelData.key, modelData.value)
                  selected: settingRow.shown === modelData.value
                }
              }
            }

            Row {
              id: settingStepper
              visible: !!settingRow.modelData.stepper
              anchors { left: settingLabel.right; right: parent.right; top: parent.top; bottom: parent.bottom }
              spacing: 6
              UtilityButton {
                width: 34
                label: "−"
                action: settingRow.modelData.stepper ? DockModel.stepAction(root.settings, settingRow.modelData.key, -1) : ""
              }
              Text {
                width: settingStepper.width - 2 * 34 - 2 * settingStepper.spacing
                height: parent.height
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                text: settingRow.modelData.stepper ? DockModel.settingText(settingRow.modelData.key, settingRow.shown) : ""
                color: Color.foreground
                font.family: Style.font.family
                font.pixelSize: Style.font.bodySmall
              }
              UtilityButton {
                width: 34
                label: "+"
                action: settingRow.modelData.stepper ? DockModel.stepAction(root.settings, settingRow.modelData.key, 1) : ""
              }
            }
          }
        }
      }
    }
  }

  // An empty action is a button at the end of its range: dimmed, not clickable.
  component UtilityButton: Rectangle {
    property string label: ""
    property string action: ""
    property bool selected: false
    property bool danger: false
    enabled: action !== ""
    opacity: enabled ? 1 : 0.35
    height: 34
    radius: 9
    color: utilityMouse.containsMouse
      ? (danger ? Util.alpha(Color.urgent, 0.18) : Util.alpha(Color.foreground, 0.13))
      : (selected ? Util.alpha(Color.accent, 0.14) : Util.alpha(Color.foreground, 0.055))
    border.color: selected ? Util.alpha(Color.accent, 0.60) : "transparent"
    border.width: 1
    Text {
      anchors.centerIn: parent
      width: parent.width - 8
      horizontalAlignment: Text.AlignHCenter
      elide: Text.ElideRight
      text: label
      color: danger ? Color.urgent : Color.foreground
      font.family: Style.font.family
      font.pixelSize: Style.font.bodySmall
    }
    MouseArea {
      id: utilityMouse
      anchors.fill: parent
      hoverEnabled: true
      onClicked: {
        root.actionTriggered(action, root.itemData)
      }
    }
  }

  Item {
    id: dismissSurface
    anchors.fill: parent
    z: -1
    MouseArea { anchors.fill: parent; onClicked: root.opened = false }
  }
}
