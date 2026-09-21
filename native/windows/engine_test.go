package main

import (
	"math"
	"testing"
)

// The scenarios below mirror the macOS end-to-end checks (same config shapes, same dry-run wording).

const gestureCfg = `{"defaultProfile":{"enabled":true,"mappings":[
 {"id":"1","enabled":true,"trigger":{"type":"gesture","button":3,"direction":"left"}, "action":{"type":"key","keyCode":123,"flags":0}},
 {"id":"2","enabled":true,"trigger":{"type":"gesture","button":3,"direction":"right"},"action":{"type":"system","id":"mute"}},
 {"id":"3","enabled":true,"trigger":{"type":"gesture","button":3,"direction":"up"},   "action":{"type":"none"}},
 {"id":"4","enabled":true,"trigger":{"type":"button","button":3},                    "action":{"type":"system","id":"play_pause"}},
 {"id":"5","enabled":true,"trigger":{"type":"gesture","button":4,"direction":"down"}, "action":{"type":"key","keyCode":125,"flags":0}},
 {"id":"6","enabled":true,"trigger":{"type":"button","button":2},                    "action":{"type":"key","keyCode":49,"flags":0}}
]},"appProfiles":{}}`

func TestGestureFiresOnceAndSwallowsTheButton(t *testing.T) {
	e, h := engineWith(t, gestureCfg, "notepad.exe")
	expect(t, "press is held back", e.Handle(btn(EvDown, 3), 0), true)
	expect(t, "moves are never swallowed", e.Handle(move(470, 400), 0.01), false) // 30 px
	expect(t, "still below the distance: nothing yet", h.actions(), "")
	expect(t, "crossing 60 px does not swallow the move", e.Handle(move(430, 402), 0.02), false)
	expect(t, "left gesture fired", h.actions(), "ACTION key key=123,flags=0")
	expect(t, "pointer put back where the drag began", h.cursor, [][2]int{{500, 400}})
	e.Handle(move(300, 400), 0.03)
	e.Handle(move(100, 400), 0.04)
	expect(t, "fires only once per press", len(h.logs), 1)
	expect(t, "release after a gesture is swallowed", e.Handle(btn(EvUp, 3), 0.05), true)
	expect(t, "and does not click", len(h.logs), 1)
}

func TestGestureDirections(t *testing.T) {
	for _, c := range []struct {
		name   string
		dx, dy int
		want   string
	}{
		{"right", 80, 0, "ACTION system mute"},
		{"up (mapped to none)", 0, -80, ""},
		{"down on button 3 (no rule)", 0, 80, ""},
	} {
		e, h := engineWith(t, gestureCfg, "notepad.exe")
		e.Handle(btn(EvDown, 3), 0)
		e.Handle(move(500+c.dx, 400+c.dy), 0.01)
		expect(t, c.name+": action", h.actions(), c.want)
		expect(t, c.name+": release swallowed", e.Handle(btn(EvUp, 3), 0.02), true)
		expect(t, c.name+": exactly the expected actions, no replay", len(h.logs), boolInt(c.want != ""))
	}
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestClickOnAGestureButton(t *testing.T) {
	e, h := engineWith(t, gestureCfg, "notepad.exe")
	// with a plain mapping: it runs on release, not on press
	expect(t, "press held back", e.Handle(btn(EvDown, 3), 0), true)
	expect(t, "nothing on press", h.actions(), "")
	expect(t, "release swallowed", e.Handle(btn(EvUp, 3), 0.05), true)
	expect(t, "the button's own mapping runs on release", h.actions(), "ACTION system play_pause")

	// a small wiggle is still a click
	h.reset()
	e.Handle(btn(EvDown, 3), 1)
	e.Handle(move(510, 400), 1.01)
	e.Handle(move(520, 405), 1.02)
	e.Handle(btn(EvUp, 3), 1.03)
	expect(t, "20 px wiggle = click", h.actions(), "ACTION system play_pause")

	// without a plain mapping the click is handed back to the app
	h.reset()
	expect(t, "gesture-only button: press held back", e.Handle(btn(EvDown, 4), 2), true)
	expect(t, "gesture-only button: release swallowed", e.Handle(btn(EvUp, 4), 2.05), true)
	expect(t, "gesture-only button: the click is replayed", h.actions(), "REPLAY button=4")
}

func TestPlainButtons(t *testing.T) {
	e, h := engineWith(t, gestureCfg, "notepad.exe")
	expect(t, "mapped press swallowed", e.Handle(btn(EvDown, 2), 0), true)
	expect(t, "performed on press", h.actions(), "ACTION key key=49,flags=0")
	expect(t, "mapped release swallowed too", e.Handle(btn(EvUp, 2), 0.05), true)
	expect(t, "not performed twice", len(h.logs), 1)

	h.reset()
	expect(t, "unmapped button 5 passes (down)", e.Handle(btn(EvDown, 5), 0), false)
	expect(t, "unmapped button 5 passes (up)", e.Handle(btn(EvUp, 5), 0.1), false)
	expect(t, "moves without a held gesture button pass", e.Handle(move(1, 1), 0.2), false)
	expect(t, "and do nothing", len(h.logs), 0)
}

func TestProfilesAndNone(t *testing.T) {
	e, h := engineWith(t, profilesJSON, "notepad.exe")
	e.Handle(btn(EvDown, 3), 0)
	expect(t, "other app: default mapping", h.actions(), "ACTION system mute")

	h.reset()
	h.foreground = "chrome.exe"
	e.Handle(btn(EvDown, 3), 1)
	expect(t, "chrome: its own profile wins", h.actions(), "ACTION key key=1,flags=0")

	h.reset()
	expect(t, "chrome: 'none' lets the button through", e.Handle(btn(EvDown, 4), 2), false)
	expect(t, "chrome: 'none' performs nothing", len(h.logs), 0)
	expect(t, "chrome: and its release passes too", e.Handle(btn(EvUp, 4), 2.1), false)

	h.foreground = "notepad.exe"
	expect(t, "notepad: the same button is remapped", e.Handle(btn(EvDown, 4), 3), true)
}

func TestMappedScrollThreshold(t *testing.T) {
	cfg := `{"defaultProfile":{"enabled":true,"mappings":[
	  {"id":"s","enabled":true,"trigger":{"type":"scroll","direction":"up"},"action":{"type":"key","keyCode":126,"flags":1048576}}]},
	  "scrollThreshold":6,"suppressOriginalScroll":true}`
	e, h := engineWith(t, cfg, "explorer.exe")
	for n := 0; n < 5; n++ {
		expect(t, "mapped scroll is swallowed", e.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, float64(n)), true)
	}
	expect(t, "5 notches < threshold 6: nothing yet", len(h.logs), 0)
	e.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, 6)
	expect(t, "6th notch fires once", h.actions(), "ACTION key key=126,flags=1048576")
	for n := 0; n < 6; n++ {
		e.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, float64(10+n))
	}
	expect(t, "the accumulator restarts", len(h.logs), 2)
	expect(t, "the other direction is not mapped: passes", e.Handle(MouseEvent{Kind: EvWheel, Delta: -120}, 30), false)

	e2, _ := engineWith(t, `{"defaultProfile":{"mappings":[
	  {"id":"s","enabled":true,"trigger":{"type":"scroll","direction":"down"},"action":{"type":"system","id":"mute"}}]},
	  "suppressOriginalScroll":false}`, "")
	expect(t, "suppressOriginalScroll=false lets the wheel through", e2.Handle(MouseEvent{Kind: EvWheel, Delta: -120}, 0), false)
}

func TestScrollAdjust(t *testing.T) {
	// invert + speed 2, no smoothing: the tick is swallowed and re-injected
	e, h := engineWith(t, `{"scroll":{"invert":true,"speed":2}}`, "")
	e.dryRun = false
	expect(t, "adjusted tick swallowed", e.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, 1), true)
	expect(t, "injected once", len(h.sent), 1)
	expect(t, "+1 notch -> -2 notches", h.sent[0][0], Input{Kind: WheelV, Delta: -240})
	e.Handle(MouseEvent{Kind: EvWheel, Delta: -120}, 5)
	expect(t, "-1 notch -> +2 notches", h.sent[1][0], Input{Kind: WheelV, Delta: 240})
	e.Handle(MouseEvent{Kind: EvHWheel, Delta: 120}, 9)
	expect(t, "horizontal: speed only, never inverted", h.sent[2][0], Input{Kind: WheelH, Delta: 240})

	// finer-than-a-notch deltas (precision touchpad, hi-res wheel) are left alone
	h.reset()
	expect(t, "touchpad-style delta passes", e.Handle(MouseEvent{Kind: EvWheel, Delta: 37}, 20), false)
	expect(t, "and nothing is injected", len(h.sent), 0)

	// standard settings leave everything alone
	std, hs := engineWith(t, `{}`, "")
	std.dryRun = false
	expect(t, "standard settings pass the tick", std.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, 1), false)
	expect(t, "standard settings inject nothing", len(hs.sent), 0)

	// speed 0.5: single notches add up instead of vanishing
	half, hh := engineWith(t, `{"scroll":{"speed":0.5}}`, "")
	half.dryRun = false
	total := 0
	for n := 0; n < 10; n++ {
		half.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, float64(n))
	}
	for _, in := range hh.sent {
		total += in[0].Delta
	}
	expect(t, "10 notches at 0.5x = 5 notches", total, 600)
}

func TestSmoothingThroughTheEngine(t *testing.T) {
	e, h := engineWith(t, `{"scroll":{"smoothing":0.5}}`, "")
	e.dryRun = false
	for n := 0; n < 5; n++ { // five notches, 40 ms apart
		expect(t, "tick swallowed", e.Handle(MouseEvent{Kind: EvWheel, Delta: 120}, float64(n)*0.04), true)
	}
	expect(t, "nothing is injected until a frame runs", len(h.sent), 0)

	now, frames, sum := 0.2, 0, 0
	for e.Tick(now) || frames == 0 {
		now += 1.0 / 120
		frames++
		if frames > 5000 {
			t.Fatal("glide never ends")
		}
	}
	for _, s := range h.sent {
		for _, in := range s {
			if in.Kind != WheelV {
				t.Errorf("unexpected input %+v", in)
			}
			sum += in.Delta
		}
	}
	expect(t, "the glide delivers exactly what the ticks asked for", sum, 600)
	if len(h.sent) < 10 {
		t.Errorf("expected a stream of small steps, got %d events", len(h.sent))
	}
	expect(t, "the engine is idle afterwards", e.Tick(now+1), false)

	// reversing mid-glide replaces what was still in flight
	h.reset()
	e.Handle(MouseEvent{Kind: EvWheel, Delta: 120 * 5}, 10)
	e.Handle(MouseEvent{Kind: EvWheel, Delta: -120}, 10.001)
	now = 10.002
	sum = 0
	for e.Tick(now) {
		now += 1.0 / 120
	}
	for _, s := range h.sent {
		for _, in := range s {
			sum += in.Delta
		}
	}
	expect(t, "reversal: only the new (opposite) distance is delivered", sum, -120)

	// switching smoothing off mid-glide flushes the rest at once
	h.reset()
	e.Handle(MouseEvent{Kind: EvWheel, Delta: 1200}, 20)
	cfg := e.cfg
	cfg.Scroll.Smoothing = 0
	e.SetConfig(cfg)
	e.Tick(20.008)
	sum = 0
	for _, s := range h.sent {
		for _, in := range s {
			sum += in.Delta
		}
	}
	expect(t, "smoothing off: everything is delivered on the next frame", sum, 1200)
	if math.IsNaN(float64(sum)) {
		t.Fatal("nan")
	}
}

func TestDryRunWording(t *testing.T) {
	for _, c := range []struct {
		a    Action
		want string
	}{
		{Action{Type: "key", KeyCode: i(49), Flags: u(0)}, "ACTION key key=49,flags=0"},
		{Action{Type: "key", KeyCode: i(126), Flags: u(1048576)}, "ACTION key key=126,flags=1048576"},
		{Action{Type: "system", ID: "mute"}, "ACTION system mute"},
		{Action{Type: "click", ID: "double"}, "ACTION click double"},
		{Action{Type: "app", BundleID: "notepad.exe"}, "ACTION app notepad.exe"},
	} {
		expect(t, "describe", describe(c.a), c.want)
	}
}

func TestRealActionsAreSentNotLogged(t *testing.T) {
	e, h := engineWith(t, `{"defaultProfile":{"mappings":[
	 {"id":"a","enabled":true,"trigger":{"type":"button","button":3},"action":{"type":"system","id":"mute"}},
	 {"id":"b","enabled":true,"trigger":{"type":"button","button":4},"action":{"type":"app","bundleId":"notepad.exe","path":"C:\\Windows\\notepad.exe"}}]}}`, "")
	e.dryRun = false
	e.Handle(btn(EvDown, 3), 0)
	expect(t, "mute: one input batch", len(h.sent), 1)
	expect(t, "mute: volume-mute key", h.sent[0][0].VK, uint16(vkVolumeMute))
	e.Handle(btn(EvDown, 4), 1)
	expect(t, "app action launches instead of injecting", len(h.opened), 1)
	expect(t, "with the path", h.opened[0].Path, `C:\Windows\notepad.exe`)
	expect(t, "nothing logged outside dry-run", len(h.logs), 0)
}
