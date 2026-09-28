// The test window for check.mjs on macOS: a pad for the mouse and a text view
// for the keyboard, reporting each thing that arrives as a line of JSON.
// Coordinates are global points from the top-left of the main screen, as the
// helper's (CGEvent's) are. Built with swiftc by check.mjs.
import AppKit

setvbuf(stdout, nil, _IOLBF, 0)

func say(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  print(s)
  fflush(stdout)
}

let top = NSScreen.screens[0].frame.height

func flip(_ r: NSRect) -> [String: Any] {
  return ["x": r.minX, "y": top - r.maxY, "width": r.width, "height": r.height]
}

func buttonName(_ e: NSEvent) -> String {
  return e.buttonNumber == 0 ? "left" : e.buttonNumber == 1 ? "right" : "middle"
}

final class Target: NSObject, NSApplicationDelegate, NSTextViewDelegate {
  var window: NSWindow!
  var pad: NSView!
  var box: NSTextView!

  func applicationDidFinishLaunching(_ n: Notification) {
    window = NSWindow(contentRect: NSRect(x: 200, y: top - 150 - 420, width: 640, height: 420), styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "rc-target"
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 640, height: 420))
    pad = NSView(frame: NSRect(x: 0, y: 120, width: 640, height: 300))
    pad.wantsLayer = true
    pad.layer?.backgroundColor = NSColor.systemTeal.cgColor
    box = NSTextView(frame: NSRect(x: 0, y: 0, width: 640, height: 120))
    box.isRichText = false
    box.isAutomaticQuoteSubstitutionEnabled = false
    box.isAutomaticDashSubstitutionEnabled = false
    box.isAutomaticTextReplacementEnabled = false
    box.isAutomaticSpellingCorrectionEnabled = false
    box.isContinuousSpellCheckingEnabled = false
    box.delegate = self
    content.addSubview(pad)
    content.addSubview(box)
    window.contentView = content
    let kinds: NSEvent.EventTypeMask = [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp, .leftMouseDragged, .scrollWheel, .keyDown]
    NSEvent.addLocalMonitorForEvents(matching: kinds) { [unowned self] e in
      self.report(e)
      return e
    }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(box)
    NSApp.activate(ignoringOtherApps: true)
    DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
      let padRect = self.window.convertToScreen(self.pad.convert(self.pad.bounds, to: nil))
      let boxRect = self.window.convertToScreen(self.box.convert(self.box.bounds, to: nil))
      say(["ready": true, "window": String(self.window.windowNumber), "frame": flip(self.window.frame), "pad": flip(padRect), "box": flip(boxRect)])
    }
  }

  func report(_ e: NSEvent) {
    switch e.type {
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
      let p = NSEvent.mouseLocation
      say(["e": "down", "button": buttonName(e), "clicks": e.clickCount, "x": p.x, "y": top - p.y])
    case .leftMouseUp, .rightMouseUp, .otherMouseUp:
      say(["e": "up", "button": buttonName(e), "clicks": e.clickCount])
    case .leftMouseDragged:
      let p = NSEvent.mouseLocation
      say(["e": "drag", "button": "left", "x": p.x, "y": top - p.y])
    case .scrollWheel:
      // AppKit: a negative deltaY scrolls down, a positive deltaX scrolls left.
      let dx = e.scrollingDeltaX, dy = e.scrollingDeltaY
      let dir = abs(dy) >= abs(dx) ? (dy < 0 ? "down" : "up") : (dx > 0 ? "left" : "right")
      say(["e": "wheel", "dir": dir, "dx": dx, "dy": dy, "precise": e.hasPreciseScrollingDeltas])
    case .keyDown:
      let f = e.modifierFlags
      say(["e": "key", "key": (e.charactersIgnoringModifiers ?? "").lowercased(), "code": Int(e.keyCode), "shift": f.contains(.shift), "ctrl": f.contains(.control), "alt": f.contains(.option), "meta": f.contains(.command)])
    default:
      break
    }
  }

  func textDidChange(_ n: Notification) {
    say(["e": "text", "value": box.string])
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let target = Target()
app.delegate = target
app.run()
