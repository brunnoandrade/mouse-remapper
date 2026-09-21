package main

// Translation of low-level mouse hook messages into the engine's events. It touches no Win32 API, so it is
// portable and tested everywhere; only the code that receives the messages is Windows-specific.

const (
	wmMouseMove   = 0x0200
	wmMButtonDown = 0x0207
	wmMButtonUp   = 0x0208
	wmMouseWheel  = 0x020A
	wmXButtonDown = 0x020B
	wmXButtonUp   = 0x020C
	wmMouseHWheel = 0x020E
)

type point struct{ x, y int32 }

// msllHook is MSLLHOOKSTRUCT.
type msllHook struct {
	pt        point
	mouseData uint32
	flags     uint32
	time      uint32
	extra     uintptr
}

// translate maps a hook message to the engine's event model. Button numbers follow the config:
// 2 middle, 3 back (XBUTTON1), 4 forward (XBUTTON2). Left and right buttons are not handled.
func translate(wParam uintptr, info *msllHook) (MouseEvent, bool) {
	ev := MouseEvent{X: int(info.pt.x), Y: int(info.pt.y)}
	switch wParam {
	case wmMouseMove:
		ev.Kind = EvMove
	case wmMButtonDown:
		ev.Kind, ev.Button = EvDown, 2
	case wmMButtonUp:
		ev.Kind, ev.Button = EvUp, 2
	case wmXButtonDown, wmXButtonUp:
		ev.Kind = EvDown
		if wParam == wmXButtonUp {
			ev.Kind = EvUp
		}
		switch info.mouseData >> 16 { // the high word says which X button: 1 = XBUTTON1, 2 = XBUTTON2
		case 1:
			ev.Button = 3
		case 2:
			ev.Button = 4
		default:
			return ev, false
		}
	case wmMouseWheel, wmMouseHWheel:
		ev.Kind = EvWheel
		if wParam == wmMouseHWheel {
			ev.Kind = EvHWheel
		}
		// The high word is a signed delta: 120 per notch, positive = away from the user / to the right.
		ev.Delta = int(int16(info.mouseData >> 16))
	default:
		return ev, false
	}
	return ev, true
}
