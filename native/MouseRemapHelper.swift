import Cocoa
import ApplicationServices

// MARK: - List running apps mode (used by the settings UI to populate the app picker)

struct RunningAppInfo: Codable {
    var name: String
    var bundleIdentifier: String
    var iconBase64: String?
}

func iconBase64(for app: NSRunningApplication) -> String? {
    guard let icon = app.icon else { return nil }
    let size = NSSize(width: 32, height: 32)
    let resized = NSImage(size: size)
    resized.lockFocus()
    icon.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1.0)
    resized.unlockFocus()
    guard let tiff = resized.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return png.base64EncodedString()
}

if CommandLine.arguments.contains("--list-apps") {
    let apps = NSWorkspace.shared.runningApplications
        .filter { $0.activationPolicy == .regular }
        .compactMap { app -> RunningAppInfo? in
            guard let bundleId = app.bundleIdentifier, let name = app.localizedName else { return nil }
            return RunningAppInfo(name: name, bundleIdentifier: bundleId, iconBase64: iconBase64(for: app))
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }

    if let data = try? JSONEncoder().encode(apps), let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("[]")
    }
    exit(0)
}

// MARK: - Config

struct KeyMapping: Codable {
    var enabled: Bool
    var keyCode: CGKeyCode
    var flags: UInt64 // CGEventFlags rawValue (modifiers)
}

struct Config: Codable {
    var scrollUp: KeyMapping
    var scrollDown: KeyMapping
    var middleClick: KeyMapping
    var scrollThreshold: Double // accumulated deltaY needed to fire one key press
    var suppressOriginalScroll: Bool
    var suppressOriginalMiddleClick: Bool
    var targetApps: [String]? // bundle identifiers; remapping only applies while one of these is frontmost
}

let defaultConfig = Config(
    scrollUp: KeyMapping(enabled: false, keyCode: 126, flags: 0),      // Up arrow
    scrollDown: KeyMapping(enabled: false, keyCode: 125, flags: 0),    // Down arrow
    middleClick: KeyMapping(enabled: false, keyCode: 49, flags: 0),    // Space
    scrollThreshold: 4.0,
    suppressOriginalScroll: true,
    suppressOriginalMiddleClick: true,
    targetApps: []
)

let configURL: URL = {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("MouseRemapper")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("config.json")
}()

final class ConfigStore {
    private(set) var config: Config = defaultConfig
    private var source: DispatchSourceFileSystemObject?

    func load() {
        guard let data = try? Data(contentsOf: configURL),
              let decoded = try? JSONDecoder().decode(Config.self, from: data) else {
            config = defaultConfig
            save()
            return
        }
        config = decoded
    }

    func save() {
        if let data = try? JSONEncoder().encode(config) {
            try? data.write(to: configURL)
        }
    }

    func watch() {
        load()
        let fd = open(configURL.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: .main)
        src.setEventHandler { [weak self] in
            self?.load()
            FileHandle.standardError.write("[MouseRemapHelper] config reloaded\n".data(using: .utf8)!)
        }
        src.setCancelHandler { close(fd) }
        src.resume()
        self.source = src
    }
}

let store = ConfigStore()
store.watch()

// MARK: - Accessibility permission check

func ensureAccessibilityPermission() {
    let options: NSDictionary = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true]
    let trusted = AXIsProcessTrustedWithOptions(options)
    if !trusted {
        FileHandle.standardError.write("[MouseRemapHelper] Waiting for Accessibility permission...\n".data(using: .utf8)!)
    }
}

ensureAccessibilityPermission()

// MARK: - Key synthesis

func postKey(keyCode: CGKeyCode, flags: CGEventFlags) {
    guard let source = CGEventSource(stateID: .hidSystemState) else { return }
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true) else { return }
    guard let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else { return }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

// MARK: - Scroll accumulation state

var scrollAccumulator: Double = 0

// MARK: - Event tap callback

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = globalTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    let cfg = store.config

    // Not global: only remap while one of the selected apps is frontmost.
    let targets = cfg.targetApps ?? []
    guard !targets.isEmpty,
          let frontBundleId = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
          targets.contains(frontBundleId) else {
        return Unmanaged.passUnretained(event)
    }

    switch type {
    case .scrollWheel:
        let deltaY = event.getDoubleValueField(.scrollWheelEventDeltaAxis1)
        if deltaY == 0 { return Unmanaged.passUnretained(event) }

        let mapping = deltaY > 0 ? cfg.scrollUp : cfg.scrollDown
        guard mapping.enabled else { return Unmanaged.passUnretained(event) }

        scrollAccumulator += abs(deltaY)
        if scrollAccumulator >= cfg.scrollThreshold {
            scrollAccumulator = 0
            postKey(keyCode: mapping.keyCode, flags: CGEventFlags(rawValue: mapping.flags))
        }

        return cfg.suppressOriginalScroll ? nil : Unmanaged.passUnretained(event)

    case .otherMouseDown, .otherMouseUp:
        let buttonNumber = event.getIntegerValueField(.mouseEventButtonNumber)
        guard buttonNumber == 2, cfg.middleClick.enabled else { return Unmanaged.passUnretained(event) }

        if type == .otherMouseDown {
            postKey(keyCode: cfg.middleClick.keyCode, flags: CGEventFlags(rawValue: cfg.middleClick.flags))
        }
        return cfg.suppressOriginalMiddleClick ? nil : Unmanaged.passUnretained(event)

    default:
        return Unmanaged.passUnretained(event)
    }
}

// MARK: - Set up event tap

var globalTap: CFMachPort?

let eventMask: CGEventMask =
    (1 << CGEventType.scrollWheel.rawValue) |
    (1 << CGEventType.otherMouseDown.rawValue) |
    (1 << CGEventType.otherMouseUp.rawValue)

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: eventMask,
    callback: eventTapCallback,
    userInfo: nil
) else {
    FileHandle.standardError.write("[MouseRemapHelper] Failed to create event tap. Grant Accessibility permission and restart.\n".data(using: .utf8)!)
    exit(1)
}

globalTap = tap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

FileHandle.standardError.write("[MouseRemapHelper] Running. Config at \(configURL.path)\n".data(using: .utf8)!)

CFRunLoopRun()
