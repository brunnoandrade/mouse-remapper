package main

import "testing"

func kinds(in []Input) string {
	s := ""
	for _, i := range in {
		switch i.Kind {
		case KeyDown:
			s += "v"
		case KeyUp:
			s += "^"
		case MouseDown:
			s += "M"
		case MouseUp:
			s += "m"
		case WheelV:
			s += "W"
		case WheelH:
			s += "H"
		}
	}
	return s
}

func i(n int) *int       { return &n }
func u(n uint64) *uint64 { return &n }

func TestPlanKey(t *testing.T) {
	in := planAction(Action{Type: "key", KeyCode: i(0x08), Flags: u(flagCommand | flagShift)}) // ⌘⇧C -> Win+Shift+C
	expect(t, "modifiers wrap the key and release in reverse", kinds(in), "vvv^^^")
	want := []uint16{vkLWin, vkShift, 'C', 'C', vkShift, vkLWin}
	for n, w := range want {
		if in[n].VK != w {
			t.Errorf("step %d: vk 0x%X, want 0x%X", n, in[n].VK, w)
		}
	}
	in = planAction(Action{Type: "key", KeyCode: i(0x7E), Flags: u(0)})
	if len(in) != 2 || !in[0].Extended || in[0].VK != vkUp {
		t.Errorf("plain arrow key: %+v", in)
	}
	in = planAction(Action{Type: "key", KeyCode: i(0x00), Flags: u(flagControl | flagOption)})
	expect(t, "ctrl+alt+A order", []uint16{in[0].VK, in[1].VK, in[2].VK}, []uint16{vkControl, vkMenu, 'A'})
	if planAction(Action{Type: "key"}) != nil || planAction(Action{Type: "key", KeyCode: i(0x7F)}) != nil {
		t.Error("a key action without a usable key plans nothing")
	}
	if got := planAction(Action{Type: "key", KeyCode: i(0x00)}); len(got) != 2 {
		t.Errorf("missing flags means no modifiers: %d inputs", len(got))
	}
}

func TestPlanSystemAndClick(t *testing.T) {
	vks := func(in []Input) []uint16 {
		var out []uint16
		for _, x := range in {
			if x.Kind == KeyDown {
				out = append(out, x.VK)
			}
		}
		return out
	}
	expect(t, "mission control = Win+Tab", vks(planSystem("mission_control")), []uint16{vkLWin, vkTab})
	expect(t, "space left = Ctrl+Win+Left", vks(planSystem("space_left")), []uint16{vkControl, vkLWin, vkLeft})
	if in := planSystem("space_right"); !in[2].Extended {
		t.Error("desktop switching arrows must be extended keys")
	}
	expect(t, "screenshot area = Win+Shift+S", vks(planSystem("screenshot_area")), []uint16{vkLWin, vkShift, 'S'})
	expect(t, "screenshot full = Win+PrtScn", vks(planSystem("screenshot_full")), []uint16{vkLWin, vkSnapshot})
	for id, vk := range map[string]uint16{
		"mute": vkVolumeMute, "volume_up": vkVolumeUp, "volume_down": vkVolumeDown,
		"play_pause": vkMediaPlayStop, "next_track": vkMediaNext, "previous_track": vkMediaPrev,
	} {
		in := planSystem(id)
		if len(in) != 2 || in[0].VK != vk {
			t.Errorf("%s: %+v", id, in)
		}
	}
	if planSystem("rm -rf") != nil {
		t.Error("unknown system action plans nothing")
	}
	// ids the UI offers must all be planned
	for _, id := range []string{"mission_control", "space_left", "space_right", "screenshot_full", "screenshot_area", "screenshot_menu",
		"play_pause", "next_track", "previous_track", "volume_up", "volume_down", "mute"} {
		if planSystem(id) == nil {
			t.Errorf("system action %q is offered by the UI but not planned", id)
		}
	}
	expect(t, "left click", kinds(planAction(Action{Type: "click", ID: "left"})), "Mm")
	expect(t, "right click", planAction(Action{Type: "click", ID: "right"})[0].Button, "right")
	expect(t, "double click = two clicks", kinds(planAction(Action{Type: "click", ID: "double"})), "MmMm")
}
