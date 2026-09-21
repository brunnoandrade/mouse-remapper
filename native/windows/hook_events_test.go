package main

import "testing"

func hookInfo(x, y int32, mouseData uint32) *msllHook {
	return &msllHook{pt: point{x, y}, mouseData: mouseData}
}

func TestTranslate(t *testing.T) {
	for _, c := range []struct {
		name string
		msg  uintptr
		data uint32
		want MouseEvent
		ok   bool
	}{
		{"middle down", wmMButtonDown, 0, MouseEvent{Kind: EvDown, Button: 2, X: 10, Y: 20}, true},
		{"middle up", wmMButtonUp, 0, MouseEvent{Kind: EvUp, Button: 2, X: 10, Y: 20}, true},
		{"XBUTTON1 down is 'back' (3)", wmXButtonDown, 1 << 16, MouseEvent{Kind: EvDown, Button: 3, X: 10, Y: 20}, true},
		{"XBUTTON1 up", wmXButtonUp, 1 << 16, MouseEvent{Kind: EvUp, Button: 3, X: 10, Y: 20}, true},
		{"XBUTTON2 down is 'forward' (4)", wmXButtonDown, 2 << 16, MouseEvent{Kind: EvDown, Button: 4, X: 10, Y: 20}, true},
		{"XBUTTON2 up", wmXButtonUp, 2 << 16, MouseEvent{Kind: EvUp, Button: 4, X: 10, Y: 20}, true},
		{"unknown X button is ignored", wmXButtonDown, 3 << 16, MouseEvent{}, false},
		{"move", wmMouseMove, 0, MouseEvent{Kind: EvMove, X: 10, Y: 20}, true},
		{"wheel up one notch", wmMouseWheel, 120 << 16, MouseEvent{Kind: EvWheel, Delta: 120, X: 10, Y: 20}, true},
		{"wheel down one notch (negative high word)", wmMouseWheel, uint32(uint16(0xFF88)) << 16, MouseEvent{Kind: EvWheel, Delta: -120, X: 10, Y: 20}, true},
		{"wheel, fine delta", wmMouseWheel, 37 << 16, MouseEvent{Kind: EvWheel, Delta: 37, X: 10, Y: 20}, true},
		{"wheel ignores the low word", wmMouseWheel, (120 << 16) | 0xFFFF, MouseEvent{Kind: EvWheel, Delta: 120, X: 10, Y: 20}, true},
		{"horizontal wheel right", wmMouseHWheel, 120 << 16, MouseEvent{Kind: EvHWheel, Delta: 120, X: 10, Y: 20}, true},
		{"left button is not handled", 0x0201, 0, MouseEvent{}, false},
		{"right button is not handled", 0x0204, 0, MouseEvent{}, false},
	} {
		got, ok := translate(c.msg, hookInfo(10, 20, c.data))
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("%s: got %+v ok=%v, want %+v ok=%v", c.name, got, ok, c.want, c.ok)
		}
	}
	// coordinates can be negative on multi-monitor setups
	if ev, _ := translate(wmMouseMove, hookInfo(-1920, -50, 0)); ev.X != -1920 || ev.Y != -50 {
		t.Errorf("negative coordinates: %+v", ev)
	}
}
