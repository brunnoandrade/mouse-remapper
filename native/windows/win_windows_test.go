//go:build windows

package main

import (
	"sync"
	"testing"
	"time"
	"unsafe"
)

// These tests need Windows (they are run by the CI job in .github/workflows/windows.yml). They check the
// things the portable tests cannot: that every Win32 export the helper uses exists, that the INPUT structs
// have the layout SendInput expects, and that the real hook translates, swallows and re-injects events.

func TestEveryWin32ExportResolves(t *testing.T) {
	for _, p := range allProcs {
		if err := p.Find(); err != nil {
			t.Errorf("%s: %v", p.Name, err)
		}
	}
}

func TestInputStructLayout(t *testing.T) {
	// INPUT on 64-bit Windows: type at 0, the union at 8, 40 bytes in total.
	if got := unsafe.Sizeof(rawInput{}); got != 40 {
		t.Errorf("sizeof(INPUT) = %d, want 40", got)
	}
	if got := unsafe.Offsetof(rawInput{}.data); got != 8 {
		t.Errorf("union offset = %d, want 8", got)
	}
	var mi mouseInput
	for name, c := range map[string][2]uintptr{
		"MOUSEINPUT.dx": {unsafe.Offsetof(mi.dx), 0}, "dy": {unsafe.Offsetof(mi.dy), 4}, "mouseData": {unsafe.Offsetof(mi.mouseData), 8},
		"dwFlags": {unsafe.Offsetof(mi.flags), 12}, "time": {unsafe.Offsetof(mi.time), 16}, "dwExtraInfo": {unsafe.Offsetof(mi.extra), 24},
	} {
		if c[0] != c[1] {
			t.Errorf("%s at %d, want %d", name, c[0], c[1])
		}
	}
	var ki keybdInput
	for name, c := range map[string][2]uintptr{
		"KEYBDINPUT.wVk": {unsafe.Offsetof(ki.vk), 0}, "wScan": {unsafe.Offsetof(ki.scan), 2}, "dwFlags": {unsafe.Offsetof(ki.flags), 4},
		"time": {unsafe.Offsetof(ki.time), 8}, "dwExtraInfo": {unsafe.Offsetof(ki.extra), 16},
	} {
		if c[0] != c[1] {
			t.Errorf("%s at %d, want %d", name, c[0], c[1])
		}
	}
	if got := unsafe.Sizeof(msllHook{}); got != 32 {
		t.Errorf("sizeof(MSLLHOOKSTRUCT) = %d, want 32", got)
	}
}

func TestRecordsCarryTheMarker(t *testing.T) {
	recs := toRecords([]Input{{Kind: KeyDown, VK: 'A'}, {Kind: WheelV, Delta: -240}, {Kind: MouseDown, Button: "x1"}}, selfMarker)
	if len(recs) != 3 {
		t.Fatalf("got %d records", len(recs))
	}
	ki := *(*keybdInput)(unsafe.Pointer(&recs[0].data[0]))
	if recs[0].typ != inputKeyboard || ki.vk != 'A' || ki.extra != selfMarker || ki.scan == 0 {
		t.Errorf("key record: type=%d %+v (a scan code is expected)", recs[0].typ, ki)
	}
	wheel := *(*mouseInput)(unsafe.Pointer(&recs[1].data[0]))
	if recs[1].typ != inputMouse || wheel.flags != mouseeventfWheel || int32(wheel.mouseData) != -240 {
		t.Errorf("wheel record: %+v", wheel)
	}
	x1 := *(*mouseInput)(unsafe.Pointer(&recs[2].data[0]))
	if x1.flags != mouseeventfXDown || x1.mouseData != 1 {
		t.Errorf("XBUTTON1 record: %+v", x1)
	}
}

// ---- end to end with the real hook -------------------------------------------------------------------------------

type seenEvent struct {
	ev    MouseEvent
	extra uintptr
}

var seen = make(chan seenEvent, 1024)

// observerProc records what reaches the end of the hook chain. Hooks run in reverse order of installation, so an
// observer installed BEFORE the engine's hook only sees events the engine did not swallow.
func observerProc(nCode, wParam, lParam uintptr) uintptr {
	if int32(nCode) >= 0 {
		info := (*msllHook)(*(*unsafe.Pointer)(unsafe.Pointer(&lParam)))
		if ev, ok := translate(wParam, info); ok && ev.Kind != EvMove {
			select {
			case seen <- seenEvent{ev, info.extra}:
			default:
			}
		}
	}
	r, _, _ := procCallNextHookEx.Call(0, nCode, wParam, lParam)
	return r
}

// lockedHost is a fakeHost that is safe to read while the hook thread is writing to it.
type lockedHost struct {
	mu sync.Mutex
	fakeHost
}

func (h *lockedHost) Log(l string)       { h.mu.Lock(); h.fakeHost.Log(l); h.mu.Unlock() }
func (h *lockedHost) SetCursor(x, y int) { h.mu.Lock(); h.fakeHost.SetCursor(x, y); h.mu.Unlock() }
func (h *lockedHost) Send(in []Input)    { sendRecords(toRecords(in, selfMarker)) } // really inject
func (h *lockedHost) snapshot() (logs []string, cursorCalls int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.logs...), len(h.cursor)
}

func drain() {
	for {
		select {
		case <-seen:
		default:
			return
		}
	}
}

func collect(d time.Duration) []seenEvent {
	var out []seenEvent
	deadline := time.After(d)
	for {
		select {
		case e := <-seen:
			out = append(out, e)
		case <-deadline:
			return out
		}
	}
}

func inject(inputs ...rawInput) { sendRecords(inputs) }

func injectMove(x, y int) {
	cx, _, _ := procGetSystemMetrics.Call(0) // SM_CXSCREEN
	cy, _, _ := procGetSystemMetrics.Call(1) // SM_CYSCREEN
	r := mouseRecord(0x8001, 0, 0)           // MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
	mi := (*mouseInput)(unsafe.Pointer(&r.data[0]))
	mi.dx, mi.dy = int32(x*65535/int(cx)), int32(y*65535/int(cy))
	inject(r)
}

func startEngine(t *testing.T, cfg string, dry bool) (*lockedHost, func()) {
	t.Helper()
	host := &lockedHost{}
	engine := NewEngine(host, mustConfig(t, cfg), dry)
	stopSmoother := make(chan struct{})
	go engine.RunSmoother(stopSmoother, monotonicNow)
	stop, err := startHook(engine)
	if err != nil {
		close(stopSmoother)
		t.Skipf("cannot install the mouse hook here (no interactive desktop?): %v", err)
	}
	return host, func() { stop(); close(stopSmoother) }
}

func TestHookEndToEnd(t *testing.T) {
	stopObserver, err := startHookWith(observerProc)
	if err != nil {
		t.Skipf("cannot install the observer hook here (no interactive desktop?): %v", err)
	}
	defer stopObserver()

	t.Run("buttons and gestures", func(t *testing.T) {
		host, stop := startEngine(t, `{"defaultProfile":{"enabled":true,"mappings":[
		  {"id":"1","enabled":true,"trigger":{"type":"button","button":3},"action":{"type":"system","id":"mute"}},
		  {"id":"2","enabled":true,"trigger":{"type":"gesture","button":2,"direction":"left"},"action":{"type":"key","keyCode":123,"flags":0}}]}}`, true)
		defer stop()
		time.Sleep(200 * time.Millisecond)

		// XBUTTON1 (back) is mapped: the action runs and the app never sees the click
		drain()
		inject(mouseRecord(mouseeventfXDown, 1, 0), mouseRecord(mouseeventfXUp, 1, 0))
		got := collect(400 * time.Millisecond)
		logs, _ := host.snapshot()
		if len(logs) != 1 || logs[0] != "ACTION system mute" {
			t.Errorf("XBUTTON1 should trigger mute once, logs = %v", logs)
		}
		for _, e := range got {
			if e.ev.Button == 3 {
				t.Errorf("XBUTTON1 leaked through the hook: %+v", e)
			}
		}

		// XBUTTON2 (forward) has no rule: it passes untouched
		drain()
		inject(mouseRecord(mouseeventfXDown, 2, 0), mouseRecord(mouseeventfXUp, 2, 0))
		got = collect(400 * time.Millisecond)
		var downs, ups int
		for _, e := range got {
			if e.ev.Button == 4 && e.ev.Kind == EvDown {
				downs++
			}
			if e.ev.Button == 4 && e.ev.Kind == EvUp {
				ups++
			}
		}
		if downs != 1 || ups != 1 {
			t.Errorf("XBUTTON2 must pass through once, saw %d down / %d up (%v)", downs, ups, got)
		}

		// middle-button gesture: hold, drag 100 px left, release
		drain()
		injectMove(600, 400)
		time.Sleep(100 * time.Millisecond)
		inject(mouseRecord(mouseeventfMiddleDown, 0, 0))
		time.Sleep(50 * time.Millisecond)
		injectMove(500, 400)
		time.Sleep(50 * time.Millisecond)
		inject(mouseRecord(mouseeventfMiddleUp, 0, 0))
		got = collect(400 * time.Millisecond)
		logs, cursorCalls := host.snapshot()
		if len(logs) != 2 || logs[1] != "ACTION key key=123,flags=0" {
			t.Errorf("the left gesture should fire once, logs = %v", logs)
		}
		if cursorCalls == 0 {
			t.Error("the pointer should be put back when the gesture fires")
		}
		for _, e := range got {
			if e.ev.Button == 2 {
				t.Errorf("the middle button must be swallowed during a gesture: %+v", e)
			}
		}
	})

	t.Run("invert and speed re-inject the wheel", func(t *testing.T) {
		_, stop := startEngine(t, `{"scroll":{"invert":true,"speed":2}}`, false)
		defer stop()
		time.Sleep(200 * time.Millisecond)

		wheel := func(delta int32) rawInput { return mouseRecord(mouseeventfWheel, uint32(delta), 0) }
		drain()
		inject(wheel(120))
		got := collect(400 * time.Millisecond)
		if len(got) != 1 || got[0].ev.Delta != -240 || got[0].extra != selfMarker {
			t.Errorf("+1 notch should arrive as one injected -2 notches, got %+v", got)
		}
		drain()
		inject(wheel(-120))
		got = collect(400 * time.Millisecond)
		if len(got) != 1 || got[0].ev.Delta != 240 {
			t.Errorf("-1 notch should arrive as +2 notches, got %+v", got)
		}
		drain()
		inject(wheel(37)) // a fine delta (precision touchpad) is not touched
		got = collect(400 * time.Millisecond)
		if len(got) != 1 || got[0].ev.Delta != 37 || got[0].extra != 0 {
			t.Errorf("a fine delta must pass through unchanged, got %+v", got)
		}
	})

	t.Run("smoothing delivers the requested distance", func(t *testing.T) {
		_, stop := startEngine(t, `{"scroll":{"smoothing":0.5}}`, false)
		defer stop()
		time.Sleep(200 * time.Millisecond)

		drain()
		for i := 0; i < 5; i++ {
			inject(mouseRecord(mouseeventfWheel, 120, 0))
			time.Sleep(40 * time.Millisecond)
		}
		got := collect(1500 * time.Millisecond)
		sum, marked := 0, 0
		for _, e := range got {
			if e.ev.Kind == EvWheel {
				sum += e.ev.Delta
				if e.extra == selfMarker {
					marked++
				}
			}
		}
		if sum != 600 {
			t.Errorf("5 notches must deliver 600 units in total, got %d over %d events", sum, len(got))
		}
		if marked != len(got) {
			t.Errorf("%d of %d events were not the helper's own (the originals leaked)", len(got)-marked, len(got))
		}
		if len(got) < 10 {
			t.Errorf("smoothing should produce a stream of small steps, got %d events", len(got))
		}
	})
}
