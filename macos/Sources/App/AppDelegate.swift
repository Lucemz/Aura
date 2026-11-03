import Cocoa

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let windowController = MainWindowController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        windowController.setupWindow()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            windowController.showWindow()
        }
        return true
    }

    private func setupMainMenu() {
        let isES = AppConfig.isSpanishSystem
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: isES ? "Ocultar Aura" : "Hide Aura",
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        )
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(
            withTitle: isES ? "Salir de Aura" : "Quit Aura",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: isES ? "Edición" : "Edit")
        editMenu.addItem(withTitle: isES ? "Deshacer" : "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: isES ? "Rehacer" : "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: isES ? "Cortar" : "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: isES ? "Copiar" : "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: isES ? "Pegar" : "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(
            withTitle: isES ? "Seleccionar todo" : "Select All",
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        )
        editMenuItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }
}
