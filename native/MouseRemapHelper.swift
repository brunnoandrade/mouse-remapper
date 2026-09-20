import Cocoa
import ApplicationServices

// MARK: - List running apps mode (used by the settings UI to populate the app picker)

struct RunningAppInfo: Codable {
    var name: String
    var bundleIdentifier: String
    var iconBase64: String?
}

func iconBase64(from icon: NSImage?) -> String? {
    guard let icon = icon else { return nil }
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

func iconBase64(for app: NSRunningApplication) -> String? {
    iconBase64(from: app.icon)
}

// MARK: - Resolve apps mode (used to look up name/icon for apps that
// are configured as targets but may not currently be running)

if let arg = CommandLine.arguments.first(where: { $0.hasPrefix("--resolve-apps=") }) {
    let bundleIds = arg.dropFirst("--resolve-apps=".count).split(separator: ",").map(String.init)
    let apps: [RunningAppInfo] = bundleIds.compactMap { bundleId in
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return nil }
        let name = FileManager.default.displayName(atPath: url.path)
            .replacingOccurrences(of: ".app", with: "")
        let icon = NSWorkspace.shared.icon(forFile: url.path)
        return RunningAppInfo(name: name, bundleIdentifier: bundleId, iconBase64: iconBase64(from: icon))
    }

    if let data = try? JSONEncoder().encode(apps), let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("[]")
    }
    exit(0)
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

/// What a trigger does. `type` selects which of the other fields apply:
/// key -> keyCode/flags, system -> id, click -> id (left|right|double), app -> bundleId.
struct Action: Codable {
    var type: String
    var keyCode: CGKeyCode?
    var flags: UInt64? // CGEventFlags rawValue (modifiers)
    var id: String?
    var bundleId: String?
}

/// What fires a mapping. button: CGEvent button number (2 middle, 3 back, 4 forward, 5+ extras).
/// scroll: direction "up" | "down".
struct Trigger: Codable {
    var type: String
    var button: Int?
    var direction: String?
}

struct Mapping: Codable {
    var id: String?
    var enabled: Bool
    var trigger: Trigger
    var action: Action
}

struct Config: Codable {
    var mappings: [Mapping]
    var scrollThreshold: Double // accumulated deltaY needed to fire one action
    var suppressOriginalScroll: Bool
    var targetApps: [String]? // bundle identifiers; remapping only applies while one of these is frontmost

    private enum CodingKeys: String, CodingKey {
        case mappings, scrollThreshold, suppressOriginalScroll, targetApps
    }
}

extension Config {
    // Lenient on purpose: a missing field must never make load() fall back to defaults and overwrite the user's file.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mappings = try c.decodeIfPresent([Mapping].self, forKey: .mappings) ?? []
        scrollThreshold = try c.decodeIfPresent(Double.self, forKey: .scrollThreshold) ?? 4.0
        suppressOriginalScroll = try c.decodeIfPresent(Bool.self, forKey: .suppressOriginalScroll) ?? true
        targetApps = try c.decodeIfPresent([String].self, forKey: .targetApps)
    }
}

let defaultConfig = Config(
    mappings: [],
    scrollThreshold: 4.0,
    suppressOriginalScroll: true,
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

// MARK: - Action execution

func postKey(keyCode: CGKeyCode, flags: CGEventFlags) {
    guard let source = CGEventSource(stateID: .hidSystemState) else { return }
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true) else { return }
    guard let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else { return }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

// Media/volume keys are not regular key events: they are system-defined events (NX_KEYTYPE_*).
func postMediaKey(_ key: Int32) {
    func post(down: Bool) {
        let state: Int32 = down ? 0xA : 0xB
        let event = NSEvent.otherEvent(
            with: .systemDefined,
            location: .zero,
            modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(state << 8)),
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            subtype: 8,
            data1: Int((key << 16) | (state << 8)),
            data2: -1
        )
        event?.cgEvent?.post(tap: .cghidEventTap)
    }
    post(down: true)
    post(down: false)
}

func postClick(kind: String, at location: CGPoint) {
    let isRight = kind == "right"
    let downType: CGEventType = isRight ? .rightMouseDown : .leftMouseDown
    let upType: CGEventType = isRight ? .rightMouseUp : .leftMouseUp
    let button: CGMouseButton = isRight ? .right : .left
    let clicks = kind == "double" ? 2 : 1
    for count in 1...clicks {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: location, mouseButton: button),
              let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: location, mouseButton: button)
        else { return }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}

func openApp(bundleId: String) {
    guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
        FileHandle.standardError.write("[MouseRemapHelper] App not found: \(bundleId)\n".data(using: .utf8)!)
        return
    }
    NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
}

let cmd = CGEventFlags.maskCommand.rawValue
let shift = CGEventFlags.maskShift.rawValue
let ctrl = CGEventFlags.maskControl.rawValue

func performSystem(_ id: String) {
    switch id {
    case "mission_control":
        NSWorkspace.shared.openApplication(
            at: URL(fileURLWithPath: "/System/Applications/Mission Control.app"),
            configuration: NSWorkspace.OpenConfiguration()
        )
    // Spaces navigation relies on the default "Move left/right a space" shortcuts (Ctrl+←/→).
    case "space_left": postKey(keyCode: 123, flags: CGEventFlags(rawValue: ctrl))
    case "space_right": postKey(keyCode: 124, flags: CGEventFlags(rawValue: ctrl))
    case "screenshot_full": postKey(keyCode: 20, flags: CGEventFlags(rawValue: cmd | shift))  // ⌘⇧3
    case "screenshot_area": postKey(keyCode: 21, flags: CGEventFlags(rawValue: cmd | shift))  // ⌘⇧4
    case "screenshot_menu": postKey(keyCode: 23, flags: CGEventFlags(rawValue: cmd | shift))  // ⌘⇧5
    case "volume_up": postMediaKey(0)
    case "volume_down": postMediaKey(1)
    case "mute": postMediaKey(7)
    case "play_pause": postMediaKey(16)
    case "next_track": postMediaKey(17)
    case "previous_track": postMediaKey(18)
    default:
        FileHandle.standardError.write("[MouseRemapHelper] Unknown system action: \(id)\n".data(using: .utf8)!)
    }
}

func perform(_ action: Action, at location: CGPoint) {
    switch action.type {
    case "key":
        postKey(keyCode: action.keyCode ?? 0, flags: CGEventFlags(rawValue: action.flags ?? 0))
    case "system":
        performSystem(action.id ?? "")
    case "click":
        postClick(kind: action.id ?? "left", at: location)
    case "app":
        if let bundleId = action.bundleId { openApp(bundleId: bundleId) }
    default:
        break
    }
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

        let direction = deltaY > 0 ? "up" : "down"
        guard let mapping = cfg.mappings.first(where: {
            $0.enabled && $0.trigger.type == "scroll" && $0.trigger.direction == direction
        }) else { return Unmanaged.passUnretained(event) }

        scrollAccumulator += abs(deltaY)
        if scrollAccumulator >= cfg.scrollThreshold {
            scrollAccumulator = 0
            perform(mapping.action, at: event.location)
        }

        return cfg.suppressOriginalScroll ? nil : Unmanaged.passUnretained(event)

    case .otherMouseDown, .otherMouseUp:
        let button = Int(event.getIntegerValueField(.mouseEventButtonNumber))
        guard let mapping = cfg.mappings.first(where: {
            $0.enabled && $0.trigger.type == "button" && $0.trigger.button == button
        }) else { return Unmanaged.passUnretained(event) }

        if type == .otherMouseDown {
            perform(mapping.action, at: event.location)
        }
        // Always swallowed when mapped, otherwise the native behavior (e.g. back/forward) would still fire.
        return nil

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
