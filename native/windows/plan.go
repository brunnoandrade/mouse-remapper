package main

// Input is one abstract input event. The engine plans what to send; the Windows layer turns each Input into a
// SendInput call. Keeping this abstract lets the sequencing be tested without Windows.
type InputKind int

const (
	KeyDown InputKind = iota
	KeyUp
	MouseDown
	MouseUp
	WheelV // vertical wheel, Delta in wheel units (120 per notch, positive = away from the user)
	WheelH // horizontal wheel
)

type Input struct {
	Kind     InputKind
	VK       uint16
	Extended bool
	Button   string // left | right | middle | x1 | x2
	Delta    int
}

func key(vk uint16, extended bool) []Input {
	return []Input{{Kind: KeyDown, VK: vk, Extended: extended}, {Kind: KeyUp, VK: vk, Extended: extended}}
}

// chord presses the modifiers, taps the key, then releases the modifiers in reverse order.
func chord(mods []uint16, vk uint16, extended bool) []Input {
	var out []Input
	for _, m := range mods {
		out = append(out, Input{Kind: KeyDown, VK: m})
	}
	out = append(out, key(vk, extended)...)
	for i := len(mods) - 1; i >= 0; i-- {
		out = append(out, Input{Kind: KeyUp, VK: mods[i]})
	}
	return out
}

func modifierKeys(flags uint64) []uint16 {
	var mods []uint16
	if flags&flagCommand != 0 { // ⌘ in the config is the Windows key
		mods = append(mods, vkLWin)
	}
	if flags&flagControl != 0 {
		mods = append(mods, vkControl)
	}
	if flags&flagOption != 0 {
		mods = append(mods, vkMenu)
	}
	if flags&flagShift != 0 {
		mods = append(mods, vkShift)
	}
	return mods
}

func click(button string) []Input {
	return []Input{{Kind: MouseDown, Button: button}, {Kind: MouseUp, Button: button}}
}

// planSystem returns the inputs for a system action. Ids must match ACTION_GROUPS in src/settings.js.
func planSystem(id string) []Input {
	switch id {
	case "mission_control": // Task View
		return chord([]uint16{vkLWin}, vkTab, false)
	case "space_left": // previous virtual desktop
		return chord([]uint16{vkControl, vkLWin}, vkLeft, true)
	case "space_right":
		return chord([]uint16{vkControl, vkLWin}, vkRight, true)
	case "screenshot_full": // saves a PNG to Pictures\Screenshots
		return chord([]uint16{vkLWin}, vkSnapshot, true)
	case "screenshot_area", "screenshot_menu": // Snipping Tool overlay
		return chord([]uint16{vkLWin, vkShift}, 'S', false)
	case "volume_up":
		return key(vkVolumeUp, false)
	case "volume_down":
		return key(vkVolumeDown, false)
	case "mute":
		return key(vkVolumeMute, false)
	case "play_pause":
		return key(vkMediaPlayStop, false)
	case "next_track":
		return key(vkMediaNext, false)
	case "previous_track":
		return key(vkMediaPrev, false)
	}
	return nil
}

// planAction returns the inputs for key / system / click actions. App actions are launched, not injected.
func planAction(a Action) []Input {
	switch a.Type {
	case "key":
		if a.KeyCode == nil {
			return nil
		}
		k, ok := lookupKey(*a.KeyCode)
		if !ok {
			return nil
		}
		var flags uint64
		if a.Flags != nil {
			flags = *a.Flags
		}
		return chord(modifierKeys(flags), k.vk, k.extended)
	case "system":
		return planSystem(a.ID)
	case "click":
		switch a.ID {
		case "right":
			return click("right")
		case "double":
			return append(click("left"), click("left")...)
		default:
			return click("left")
		}
	}
	return nil
}
