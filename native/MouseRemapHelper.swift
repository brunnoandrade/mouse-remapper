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

// MARK: - Permission check mode (used by the settings UI to show the real Accessibility status)

if CommandLine.arguments.contains("--check-permission") {
    print(AXIsProcessTrusted() ? "true" : "false")
    exit(0)
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

/// A set of mappings. The default profile applies everywhere (when enabled); an app profile only while
/// that app is frontmost, and wins over the default profile for the triggers it defines.
struct Profile: Codable {
    var enabled: Bool?
    var mappings: [Mapping]

    private enum CodingKeys: String, CodingKey { case enabled, mappings }
}

extension Profile {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled)
        mappings = try c.decodeIfPresent([Mapping].self, forKey: .mappings) ?? []
    }
}

/// Adjustments for plain mouse-wheel scrolling (scroll that no mapping consumed).
struct ScrollSettings: Codable {
    var invert: Bool
    var speed: Double        // multiplier, 0.5...4
    var acceleration: Double // 0...1: extra boost while the wheel is spun fast

    static let standard = ScrollSettings(invert: false, speed: 1, acceleration: 0)
    var isStandard: Bool { !invert && speed == 1 && acceleration == 0 }
}

extension ScrollSettings {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        invert = try c.decodeIfPresent(Bool.self, forKey: .invert) ?? false
        speed = min(4, max(0.5, try c.decodeIfPresent(Double.self, forKey: .speed) ?? 1))
        acceleration = min(1, max(0, try c.decodeIfPresent(Double.self, forKey: .acceleration) ?? 0))
    }
}

struct Config: Codable {
    var defaultProfile: Profile
    var appProfiles: [String: Profile] // keyed by bundle identifier
    var scrollThreshold: Double // accumulated deltaY needed to fire one action
    var suppressOriginalScroll: Bool
    var scroll: ScrollSettings

    private enum CodingKeys: String, CodingKey {
        case defaultProfile, appProfiles, scrollThreshold, suppressOriginalScroll, scroll
    }
}

extension Config {
    // Lenient on purpose: a missing field must never make load() fall back to defaults and overwrite the user's file.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        defaultProfile = try c.decodeIfPresent(Profile.self, forKey: .defaultProfile) ?? Profile(enabled: true, mappings: [])
        appProfiles = try c.decodeIfPresent([String: Profile].self, forKey: .appProfiles) ?? [:]
        scrollThreshold = try c.decodeIfPresent(Double.self, forKey: .scrollThreshold) ?? 4.0
        suppressOriginalScroll = try c.decodeIfPresent(Bool.self, forKey: .suppressOriginalScroll) ?? true
        scroll = try c.decodeIfPresent(ScrollSettings.self, forKey: .scroll) ?? .standard
    }
}

let defaultConfig = Config(
    defaultProfile: Profile(enabled: true, mappings: []),
    appProfiles: [:],
    scrollThreshold: 4.0,
    suppressOriginalScroll: true,
    scroll: .standard
)

/// The mapping that applies to the frontmost app: its own profile first, then the default profile.
func findMapping(in cfg: Config, matching predicate: (Mapping) -> Bool) -> Mapping? {
    if let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
       let profile = cfg.appProfiles[front],
       let mapping = profile.mappings.first(where: { $0.enabled && predicate($0) }) {
        return mapping
    }
    guard cfg.defaultProfile.enabled ?? true else { return nil }
    return cfg.defaultProfile.mappings.first(where: { $0.enabled && predicate($0) })
}

let configURL: URL = {
    // Test/debug hook: run against a throwaway config instead of the user's real one.
    if let override = ProcessInfo.processInfo.environment["MOUSE_REMAP_CONFIG"] {
        return URL(fileURLWithPath: override)
    }
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("MouseRemapper")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("config.json")
}()

final class ConfigStore {
    private(set) var config: Config = defaultConfig
    private var source: DispatchSourceFileSystemObject?
    private var pendingReload: DispatchWorkItem?
    private var poller: DispatchSourceTimer?
    private var lastLoaded: FileStamp?

    /// Modification date + size: enough to notice that the file changed behind a missed watcher event.
    private struct FileStamp: Equatable {
        var modified: Date
        var size: Int
    }

    private func currentStamp() -> FileStamp? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: configURL.path),
              let modified = attrs[.modificationDate] as? Date,
              let size = attrs[.size] as? Int else { return nil }
        return FileStamp(modified: modified, size: size)
    }

    /// Reads the config file. Returns false when it exists but can't be decoded (e.g. it is caught halfway
    /// through a write). In that case the current config is kept and the user's file is never touched:
    /// only a *missing* file gets replaced by the defaults.
    @discardableResult
    func load() -> Bool {
        guard FileManager.default.fileExists(atPath: configURL.path) else {
            config = defaultConfig
            save()
            lastLoaded = currentStamp()
            return true
        }
        let stamp = currentStamp()
        guard let data = try? Data(contentsOf: configURL), !data.isEmpty,
              let decoded = try? JSONDecoder().decode(Config.self, from: data) else {
            return false
        }
        config = decoded
        lastLoaded = stamp
        return true
    }

    func save() {
        if let data = try? JSONEncoder().encode(config) {
            try? data.write(to: configURL)
        }
    }

    /// Reloads shortly after the last change, so a write in progress has time to finish; retries while the
    /// file doesn't decode yet.
    private func scheduleReload(attempt: Int = 0) {
        pendingReload?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            self.pendingReload = nil
            if self.load() {
                FileHandle.standardError.write("[MouseRemapHelper] config reloaded\n".data(using: .utf8)!)
            } else if attempt < 20 {
                self.scheduleReload(attempt: attempt + 1)
            } else {
                // Give up until the file changes again, so a corrupt file isn't re-read forever.
                self.lastLoaded = self.currentStamp()
                FileHandle.standardError.write("[MouseRemapHelper] config unreadable, keeping the previous one\n".data(using: .utf8)!)
            }
        }
        pendingReload = item
        DispatchQueue.main.asyncAfter(deadline: .now() + (attempt == 0 ? 0.05 : 0.1), execute: item)
    }

    private func startWatching() {
        source?.cancel()
        let fd = open(configURL.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete, .extend], queue: .main)
        src.setEventHandler { [weak self] in
            guard let self = self else { return }
            // The file was replaced or removed (e.g. an editor's atomic save): the descriptor is stale.
            if !src.data.isDisjoint(with: [.rename, .delete]) { self.startWatching() }
            self.scheduleReload()
        }
        src.setCancelHandler { close(fd) }
        src.resume()
        source = src
    }

    func watch() {
        if !load() {
            FileHandle.standardError.write("[MouseRemapHelper] config unreadable at startup, using defaults in memory (file left untouched)\n".data(using: .utf8)!)
        }
        startWatching()

        // Safety net: file-system events can be coalesced or missed, so also compare the file once a second.
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard let self = self, self.pendingReload == nil else { return }
            if let stamp = self.currentStamp(), stamp != self.lastLoaded { self.scheduleReload() }
            else if self.source == nil { self.startWatching() }
        }
        timer.resume()
        poller = timer
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

// Test/debug hook: print what would have been done instead of doing it.
let dryRun = ProcessInfo.processInfo.environment["MOUSE_REMAP_DRY_RUN"] != nil

func perform(_ action: Action, at location: CGPoint) {
    if dryRun {
        print("ACTION \(action.type) \(action.id ?? action.bundleId ?? "key=\(action.keyCode ?? 0),flags=\(action.flags ?? 0)")")
        fflush(stdout)
        return
    }
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

// MARK: - Gestures (hold a button and drag)

enum GestureDirection: String {
    case left, right, up, down
}

/// Tracks one held button and reports the drag direction the first time it travels far enough.
/// Pure state (no CGEvent), so it can be tested on its own.
struct GestureTracker {
    static let distance = 60.0 // points the pointer must travel before the gesture counts

    private(set) var button: Int?
    private(set) var fired = false
    private var dx = 0.0
    private var dy = 0.0

    mutating func begin(button: Int) {
        self.button = button
        dx = 0
        dy = 0
        fired = false
    }

    mutating func reset() {
        button = nil
        dx = 0
        dy = 0
        fired = false
    }

    /// Feed one drag delta. Returns the direction once, when the distance is first crossed.
    mutating func drag(dx deltaX: Double, dy deltaY: Double) -> GestureDirection? {
        guard button != nil, !fired else { return nil }
        dx += deltaX
        dy += deltaY
        guard max(abs(dx), abs(dy)) >= Self.distance else { return nil }
        fired = true
        if abs(dx) >= abs(dy) { return dx > 0 ? .right : .left }
        return dy > 0 ? .down : .up // screen coordinates: +y points down
    }
}

var gestureTracker = GestureTracker()

/// Marks events this helper posted itself, so the tap lets them through instead of intercepting them again.
let selfEventMarker: Int64 = 0x4D52_4D50 // "MRMP"

/// A held button that turned out to be a plain click is replayed, because the original press was swallowed.
func replayClick(button: Int, at location: CGPoint) {
    if dryRun {
        print("REPLAY button=\(button)")
        fflush(stdout)
        return
    }
    for type in [CGEventType.otherMouseDown, .otherMouseUp] {
        // CGMouseButton only names left/right/center; any extra button is set through the button-number field.
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: location, mouseButton: .center) else { return }
        event.setIntegerValueField(.mouseEventButtonNumber, value: Int64(button))
        event.setIntegerValueField(.eventSourceUserData, value: selfEventMarker)
        event.post(tap: .cghidEventTap)
    }
}

/// Whether the frontmost app's profile (or the default one) defines any gesture on this button.
func hasGesture(in cfg: Config, button: Int) -> Bool {
    for direction in ["left", "right", "up", "down"] {
        if findMapping(in: cfg, matching: { $0.trigger.type == "gesture" && $0.trigger.button == button && $0.trigger.direction == direction }) != nil {
            return true
        }
    }
    return false
}

// MARK: - Scroll adjustment

/// Rescales mouse-wheel events (never trackpad ones). Wheel deltas are integers, so a fractional result is
/// carried over to the next event instead of being lost: with speed 0.5, two ticks still add up to one line.
struct ScrollAdjuster {
    private var lastEvent: TimeInterval = 0
    private var carry: [UInt32: Double] = [:]

    // Below `slowRate` events/s there is no boost; at `fastRate` and above it is the full one.
    static let slowRate = 8.0
    static let fastRate = 40.0
    static let maxBoost = 3.0 // acceleration 1.0 => up to +300%

    /// Speed multiplier for an event arriving at `now`, including the acceleration boost.
    mutating func factor(for settings: ScrollSettings, now: TimeInterval) -> Double {
        let dt = now - lastEvent
        lastEvent = now
        // A pause means a new scroll gesture: start from the slow end again.
        let rate = dt > 0.3 ? 0 : 1 / max(dt, 0.005)
        let t = min(1, max(0, (rate - Self.slowRate) / (Self.fastRate - Self.slowRate)))
        return settings.speed * (1 + settings.acceleration * Self.maxBoost * t)
    }

    /// Scales an integer delta, keeping the fractional part for the next event.
    private mutating func scaledWhole(_ original: Int64, by factor: Double, field: CGEventField) -> Int64 {
        let raw = Double(original) * factor + (carry[field.rawValue] ?? 0)
        let whole = raw.rounded(.towardZero)
        carry[field.rawValue] = raw - whole
        return Int64(whole)
    }

    /// The line, point and fixed-point deltas of one axis are coupled inside CGEvent: writing the line delta
    /// recomputes the point delta. So all three originals are read first and written line -> point -> fixed;
    /// any other order leaves the point delta wrong.
    private mutating func scaleAxis(_ event: CGEvent, line: CGEventField, point: CGEventField, fixed: CGEventField, by factor: Double) {
        let originalLine = event.getIntegerValueField(line)
        let originalPoint = event.getIntegerValueField(point)
        let originalFixed = event.getDoubleValueField(fixed)

        event.setIntegerValueField(line, value: scaledWhole(originalLine, by: factor, field: line))
        event.setIntegerValueField(point, value: scaledWhole(originalPoint, by: factor, field: point))
        event.setDoubleValueField(fixed, value: originalFixed * factor)
    }

    /// Returns false (and leaves the event alone) for trackpad / continuous events.
    @discardableResult
    mutating func adjust(_ event: CGEvent, settings: ScrollSettings, now: TimeInterval) -> Bool {
        guard !settings.isStandard,
              event.getIntegerValueField(.scrollWheelEventIsContinuous) == 0 else { return false }

        let speed = factor(for: settings, now: now)
        let vertical = settings.invert ? -speed : speed

        scaleAxis(event, line: .scrollWheelEventDeltaAxis1, point: .scrollWheelEventPointDeltaAxis1,
                  fixed: .scrollWheelEventFixedPtDeltaAxis1, by: vertical)
        scaleAxis(event, line: .scrollWheelEventDeltaAxis2, point: .scrollWheelEventPointDeltaAxis2,
                  fixed: .scrollWheelEventFixedPtDeltaAxis2, by: speed)
        return true
    }
}

var scrollAdjuster = ScrollAdjuster()

// MARK: - Scroll accumulation state

var scrollAccumulator: Double = 0

// MARK: - Event tap callback

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = globalTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        gestureTracker.reset() // the release of a held button may have been missed
        return Unmanaged.passUnretained(event)
    }

    // Our own replayed clicks go straight through.
    if event.getIntegerValueField(.eventSourceUserData) == selfEventMarker {
        return Unmanaged.passUnretained(event)
    }

    let cfg = store.config

    switch type {
    case .scrollWheel:
        let deltaY = event.getDoubleValueField(.scrollWheelEventDeltaAxis1)
        if deltaY == 0 {
            scrollAdjuster.adjust(event, settings: cfg.scroll, now: ProcessInfo.processInfo.systemUptime)
            return Unmanaged.passUnretained(event)
        }

        let direction = deltaY > 0 ? "up" : "down"
        guard let mapping = findMapping(in: cfg, matching: {
            $0.trigger.type == "scroll" && $0.trigger.direction == direction
        }), mapping.action.type != "none" else {
            scrollAdjuster.adjust(event, settings: cfg.scroll, now: ProcessInfo.processInfo.systemUptime)
            return Unmanaged.passUnretained(event)
        }

        scrollAccumulator += abs(deltaY)
        if scrollAccumulator >= cfg.scrollThreshold {
            scrollAccumulator = 0
            perform(mapping.action, at: event.location)
        }

        return cfg.suppressOriginalScroll ? nil : Unmanaged.passUnretained(event)

    case .otherMouseDown, .otherMouseUp, .otherMouseDragged:
        let button = Int(event.getIntegerValueField(.mouseEventButtonNumber))

        // A button with gestures is held back on press so the drag can be told apart from a click.
        if type == .otherMouseDown && hasGesture(in: cfg, button: button) {
            gestureTracker.begin(button: button)
            return nil
        }

        if gestureTracker.button == button {
            switch type {
            case .otherMouseDragged:
                let delta = (event.getDoubleValueField(.mouseEventDeltaX), event.getDoubleValueField(.mouseEventDeltaY))
                if let direction = gestureTracker.drag(dx: delta.0, dy: delta.1),
                   let mapping = findMapping(in: cfg, matching: {
                       $0.trigger.type == "gesture" && $0.trigger.button == button && $0.trigger.direction == direction.rawValue
                   }), mapping.action.type != "none" {
                    perform(mapping.action, at: event.location)
                }
                return nil // the pointer stays put while the gesture is being made

            case .otherMouseUp:
                let wasGesture = gestureTracker.fired
                gestureTracker.reset()
                if wasGesture { return nil }
                // No drag: it was a click. Run the button's own mapping, or give the click back to the app.
                if let mapping = findMapping(in: cfg, matching: { $0.trigger.type == "button" && $0.trigger.button == button }),
                   mapping.action.type != "none" {
                    perform(mapping.action, at: event.location)
                } else {
                    replayClick(button: button, at: event.location)
                }
                return nil

            default:
                break
            }
        }

        if type == .otherMouseDragged { return Unmanaged.passUnretained(event) }

        guard let mapping = findMapping(in: cfg, matching: {
            $0.trigger.type == "button" && $0.trigger.button == button
        }), mapping.action.type != "none" else { return Unmanaged.passUnretained(event) }

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
    (1 << CGEventType.otherMouseUp.rawValue) |
    (1 << CGEventType.otherMouseDragged.rawValue)

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
