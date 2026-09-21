//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// The Win32 layer. It is deliberately thin: it turns hook callbacks into MouseEvents for the Engine and turns
// the engine's abstract Inputs into SendInput calls. All decisions live in engine.go, which is tested without
// Windows.

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	winmm    = windows.NewLazySystemDLL("winmm.dll")
	dwmapi   = windows.NewLazySystemDLL("dwmapi.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procSetWindowsHookEx    = user32.NewProc("SetWindowsHookExW")
	procUnhookWindowsHookEx = user32.NewProc("UnhookWindowsHookEx")
	procCallNextHookEx      = user32.NewProc("CallNextHookEx")
	procGetMessage          = user32.NewProc("GetMessageW")
	procTranslateMessage    = user32.NewProc("TranslateMessage")
	procDispatchMessage     = user32.NewProc("DispatchMessageW")
	procSendInput           = user32.NewProc("SendInput")
	procSetCursorPos        = user32.NewProc("SetCursorPos")
	procMapVirtualKey       = user32.NewProc("MapVirtualKeyW")
	procSetProcessDPIAware  = user32.NewProc("SetProcessDPIAware")
	procGetWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	procGetWindowLong       = user32.NewProc("GetWindowLongW")
	procTimeBeginPeriod     = winmm.NewProc("timeBeginPeriod")
	procGetModuleHandle     = kernel32.NewProc("GetModuleHandleW")
	procDwmGetWindowAttr    = dwmapi.NewProc("DwmGetWindowAttribute")
)

// allProcs is checked by a test on Windows: a mistyped export name would otherwise only fail when first called.
var allProcs = []*windows.LazyProc{
	procSetWindowsHookEx, procUnhookWindowsHookEx, procCallNextHookEx, procGetMessage, procTranslateMessage,
	procDispatchMessage, procSendInput, procSetCursorPos, procMapVirtualKey, procSetProcessDPIAware,
	procGetWindowTextLength, procGetWindowLong, procTimeBeginPeriod, procDwmGetWindowAttr, procGetModuleHandle,
	procPostThreadMessage, procGetSystemMetrics,
}

const (
	whMouseLL = 14

	// Marks the events this helper injects, so the hook lets them through instead of handling them again.
	selfMarker uintptr = 0x4D524D50 // "MRMP"
)

type msg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      point
}

// ---- hook -------------------------------------------------------------------------------------------------------

var hookEngine *Engine

func hookProc(nCode, wParam, lParam uintptr) uintptr {
	if int32(nCode) >= 0 {
		info := (*msllHook)(*(*unsafe.Pointer)(unsafe.Pointer(&lParam)))
		if info.extra != selfMarker {
			if ev, ok := translate(wParam, info); ok && hookEngine.Handle(ev, monotonicNow()) {
				return 1 // swallowed: the app never sees it
			}
		}
	}
	ret, _, _ := procCallNextHookEx.Call(0, nCode, wParam, lParam)
	return ret
}

const wmQuit = 0x0012

var (
	procPostThreadMessage = user32.NewProc("PostThreadMessageW")
	procGetSystemMetrics  = user32.NewProc("GetSystemMetrics")
)

// startHook installs the engine's low-level mouse hook. See startHookWith.
func startHook(e *Engine) (stop func(), err error) {
	hookEngine = e
	return startHookWith(hookProc)
}

// startHookWith installs a low-level mouse hook on its own OS thread, which runs the message loop that keeps it
// alive, and returns once the hook is in place. stop() removes it.
func startHookWith(proc func(nCode, wParam, lParam uintptr) uintptr) (stop func(), err error) {
	if unsafe.Sizeof(uintptr(0)) != 8 {
		return nil, syscall.EINVAL // rawInput mirrors the 64-bit INPUT layout
	}
	type started struct {
		tid uint32
		err error
	}
	ready := make(chan started, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runtime.LockOSThread() // the hook is delivered to the thread that installed it: it must own the message loop
		defer runtime.UnlockOSThread()

		module, _, _ := procGetModuleHandle.Call(0) // this executable's module, as low-level hooks expect
		hook, _, hookErr := procSetWindowsHookEx.Call(whMouseLL, syscall.NewCallback(proc), module, 0)
		if hook == 0 {
			ready <- started{err: hookErr}
			return
		}
		ready <- started{tid: windows.GetCurrentThreadId()}

		var m msg
		for {
			r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 { // 0 = WM_QUIT, -1 = error
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessage.Call(uintptr(unsafe.Pointer(&m)))
		}
		procUnhookWindowsHookEx.Call(hook)
	}()

	s := <-ready
	if s.err != nil {
		return nil, s.err
	}
	return func() {
		// The thread may not have created its message queue yet, in which case the post is refused: keep asking.
		for {
			procPostThreadMessage.Call(uintptr(s.tid), wmQuit, 0, 0)
			select {
			case <-done:
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}, nil
}

// installHook installs the hook for the lifetime of the process. It blocks.
func installHook(e *Engine) error {
	procSetProcessDPIAware.Call() // pointer coordinates in real pixels, so the gesture distance is not scaled
	procTimeBeginPeriod.Call(1)   // 1 ms timer resolution: the smoothing ticker needs ~8 ms frames
	stop, err := startHook(e)
	if err != nil {
		return err
	}
	defer stop()
	select {} // the hook thread does the work
}

// ---- SendInput --------------------------------------------------------------------------------------------------

const (
	inputMouse    = 0
	inputKeyboard = 1

	keyeventfExtendedKey = 0x0001
	keyeventfKeyUp       = 0x0002

	mouseeventfLeftDown   = 0x0002
	mouseeventfLeftUp     = 0x0004
	mouseeventfRightDown  = 0x0008
	mouseeventfRightUp    = 0x0010
	mouseeventfMiddleDown = 0x0020
	mouseeventfMiddleUp   = 0x0040
	mouseeventfXDown      = 0x0080
	mouseeventfXUp        = 0x0100
	mouseeventfWheel      = 0x0800
	mouseeventfHWheel     = 0x1000
)

type mouseInput struct {
	dx, dy    int32
	mouseData uint32
	flags     uint32
	time      uint32
	extra     uintptr
}

type keybdInput struct {
	vk, scan uint16
	flags    uint32
	time     uint32
	extra    uintptr
}

// rawInput is one INPUT record (40 bytes on 64-bit Windows): the type, then a union sized for its largest member.
// Both members are written into `data`, which sits at offset 8 like the union in the C struct.
type rawInput struct {
	typ  uint32
	_    uint32
	data [32]byte
}

func mouseRecord(flags, data uint32, extra uintptr) rawInput {
	r := rawInput{typ: inputMouse}
	*(*mouseInput)(unsafe.Pointer(&r.data[0])) = mouseInput{mouseData: data, flags: flags, extra: extra}
	return r
}

func keyRecord(vk uint16, flags uint32, extra uintptr) rawInput {
	scan, _, _ := procMapVirtualKey.Call(uintptr(vk), 0) // MAPVK_VK_TO_VSC
	r := rawInput{typ: inputKeyboard}
	*(*keybdInput)(unsafe.Pointer(&r.data[0])) = keybdInput{vk: vk, scan: uint16(scan), flags: flags, extra: extra}
	return r
}

func buttonFlags(name string, down bool) (flags, data uint32) {
	pick := func(d, u uint32) uint32 {
		if down {
			return d
		}
		return u
	}
	switch name {
	case "right":
		return pick(mouseeventfRightDown, mouseeventfRightUp), 0
	case "middle":
		return pick(mouseeventfMiddleDown, mouseeventfMiddleUp), 0
	case "x1":
		return pick(mouseeventfXDown, mouseeventfXUp), 1
	case "x2":
		return pick(mouseeventfXDown, mouseeventfXUp), 2
	}
	return pick(mouseeventfLeftDown, mouseeventfLeftUp), 0
}

// toRecords converts abstract inputs to INPUT records tagged with `extra`.
func toRecords(inputs []Input, extra uintptr) []rawInput {
	records := make([]rawInput, 0, len(inputs))
	for _, in := range inputs {
		switch in.Kind {
		case KeyDown, KeyUp:
			var flags uint32
			if in.Extended {
				flags |= keyeventfExtendedKey
			}
			if in.Kind == KeyUp {
				flags |= keyeventfKeyUp
			}
			records = append(records, keyRecord(in.VK, flags, extra))
		case MouseDown, MouseUp:
			flags, data := buttonFlags(in.Button, in.Kind == MouseDown)
			records = append(records, mouseRecord(flags, data, extra))
		case WheelV:
			records = append(records, mouseRecord(mouseeventfWheel, uint32(int32(in.Delta)), extra))
		case WheelH:
			records = append(records, mouseRecord(mouseeventfHWheel, uint32(int32(in.Delta)), extra))
		}
	}
	return records
}

func sendRecords(records []rawInput) {
	if len(records) == 0 {
		return
	}
	// One call for the whole batch, so other input cannot get in between a modifier and its key.
	procSendInput.Call(uintptr(len(records)), uintptr(unsafe.Pointer(&records[0])), unsafe.Sizeof(records[0]))
}

// ---- Host -------------------------------------------------------------------------------------------------------

type winHost struct {
	mu       sync.Mutex
	pidNames map[uint32]string
	lastHwnd windows.HWND
	lastName string
	lastAt   time.Time
}

func newHost() Host { return &winHost{pidNames: map[uint32]string{}} }

// Everything that calls into the system on behalf of the hook is handed to a worker goroutine. SendInput made
// from inside a low-level hook callback is not delivered reliably (the CI run on Windows showed the injected wheel
// event never arriving), and the callback must return quickly anyway.
var asyncWork = make(chan func(), 512)
var asyncOnce sync.Once

func runAsync(f func()) {
	asyncOnce.Do(func() {
		go func() {
			for job := range asyncWork {
				job()
			}
		}()
	})
	select {
	case asyncWork <- f:
	default: // queue full: dropping is better than blocking the hook
	}
}

func (h *winHost) Send(inputs []Input) {
	records := toRecords(inputs, selfMarker)
	runAsync(func() { sendRecords(records) })
}

func (h *winHost) SetCursor(x, y int) {
	runAsync(func() { procSetCursorPos.Call(uintptr(x), uintptr(y)) })
}

func (h *winHost) Log(line string) { fmt.Println(line) }

// OpenApp launches an app. ShellExecute can take a while, and this runs inside the hook callback, so it must not
// block: it runs on its own goroutine.
func (h *winHost) OpenApp(a Action) {
	go openApp(a)
}

func openApp(a Action) {
	target := a.Path
	if target == "" {
		target = a.BundleID // a bare executable name is resolved through App Paths / PATH by the shell
	}
	if target == "" {
		return
	}
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return
	}
	verb, _ := windows.UTF16PtrFromString("open")
	_ = windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}

// Foreground returns the lower-case executable name of the foreground window's process.
func (h *winHost) Foreground() string {
	hwnd := windows.GetForegroundWindow()
	if hwnd == 0 {
		return ""
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if hwnd == h.lastHwnd && time.Since(h.lastAt) < time.Second {
		return h.lastName
	}
	var pid uint32
	_, _ = windows.GetWindowThreadProcessId(hwnd, &pid)
	name, cached := h.pidNames[pid]
	if !cached {
		name = strings.ToLower(filepath.Base(exePath(pid)))
		if name == "." {
			name = ""
		}
		if len(h.pidNames) > 512 { // pids get reused: do not let the cache grow forever
			h.pidNames = map[uint32]string{}
		}
		h.pidNames[pid] = name
	}
	h.lastHwnd, h.lastName, h.lastAt = hwnd, name, time.Now()
	return name
}

func exePath(pid uint32) string {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(handle)
	buf := make([]uint16, windows.MAX_PATH*2)
	size := uint32(len(buf))
	if err := windows.QueryFullProcessImageName(handle, 0, &buf[0], &size); err != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:size])
}

// ---- app lists (--list-apps / --resolve-apps) ---------------------------------------------------------------------

func displayName(exe string) string {
	stem := strings.TrimSuffix(exe, filepath.Ext(exe))
	if stem == "" {
		return exe
	}
	return strings.ToUpper(stem[:1]) + stem[1:]
}

func windowIsListable(hwnd windows.HWND) bool {
	if !windows.IsWindowVisible(hwnd) {
		return false
	}
	if length, _, _ := procGetWindowTextLength.Call(uintptr(hwnd)); length == 0 {
		return false
	}
	const gwlExStyle, wsExToolWindow = ^uintptr(19), 0x00000080 // GWL_EXSTYLE = -20
	if style, _, _ := procGetWindowLong.Call(uintptr(hwnd), gwlExStyle); style&wsExToolWindow != 0 {
		return false
	}
	var cloaked uint32 // UWP windows that are "visible" but hidden by the shell
	procDwmGetWindowAttr.Call(uintptr(hwnd), 14 /* DWMWA_CLOAKED */, uintptr(unsafe.Pointer(&cloaked)), unsafe.Sizeof(cloaked))
	return cloaked == 0
}

// listApps returns the apps that currently have a normal, visible window.
func listApps() []RunningApp {
	found := map[string]RunningApp{}
	callback := syscall.NewCallback(func(hwnd windows.HWND, _ uintptr) uintptr {
		if !windowIsListable(hwnd) {
			return 1
		}
		var pid uint32
		_, _ = windows.GetWindowThreadProcessId(hwnd, &pid)
		path := exePath(pid)
		if path == "" {
			return 1
		}
		exe := strings.ToLower(filepath.Base(path))
		if _, dup := found[exe]; !dup {
			found[exe] = RunningApp{Name: displayName(filepath.Base(path)), BundleIdentifier: exe, Path: path}
		}
		return 1 // keep enumerating
	})
	_ = windows.EnumWindows(callback, nil)

	apps := make([]RunningApp, 0, len(found))
	for _, a := range found {
		apps = append(apps, a)
	}
	sort.Slice(apps, func(i, j int) bool { return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name) })
	return apps
}

// resolveApps looks up apps that are not necessarily running, through the "App Paths" registry entries that
// installers register for launching by name. Anything not found still gets a readable name.
func resolveApps(names []string) []RunningApp {
	apps := make([]RunningApp, 0, len(names))
	for _, name := range names {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" {
			continue
		}
		app := RunningApp{Name: displayName(name), BundleIdentifier: name}
		for _, root := range []registry.Key{registry.CURRENT_USER, registry.LOCAL_MACHINE} {
			key, err := registry.OpenKey(root, `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\`+name, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			path, _, err := key.GetStringValue("")
			key.Close()
			if err == nil && path != "" {
				app.Path = strings.Trim(path, `"`)
				break
			}
		}
		apps = append(apps, app)
	}
	return apps
}
