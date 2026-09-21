package main

// The config stores keys as macOS virtual key codes (see CODE_TO_MAC in src/settings.js), so the Windows helper
// translates them to Windows virtual-key codes.

type winKey struct {
	vk       uint16
	extended bool // arrows, Home/End, PageUp/PageDown, PrintScreen... need KEYEVENTF_EXTENDEDKEY, otherwise
	// Windows sees the numeric-keypad variant of the key.
}

const (
	vkBack     = 0x08
	vkTab      = 0x09
	vkReturn   = 0x0D
	vkShift    = 0xA0 // left shift
	vkControl  = 0xA2 // left control
	vkMenu     = 0xA4 // left alt
	vkEscape   = 0x1B
	vkSpace    = 0x20
	vkPrior    = 0x21 // page up
	vkNext     = 0x22 // page down
	vkEnd      = 0x23
	vkHome     = 0x24
	vkLeft     = 0x25
	vkUp       = 0x26
	vkRight    = 0x27
	vkDown     = 0x28
	vkSnapshot = 0x2C // print screen
	vkLWin     = 0x5B
	vkF1       = 0x70

	vkVolumeMute    = 0xAD
	vkVolumeDown    = 0xAE
	vkVolumeUp      = 0xAF
	vkMediaNext     = 0xB0
	vkMediaPrev     = 0xB1
	vkMediaPlayStop = 0xB3
)

var macToWin = buildMacToWin()

func buildMacToWin() map[int]winKey {
	m := map[int]winKey{}
	letters := map[int]byte{ // mac key code -> letter
		0x00: 'A', 0x01: 'S', 0x02: 'D', 0x03: 'F', 0x04: 'H', 0x05: 'G', 0x06: 'Z', 0x07: 'X', 0x08: 'C', 0x09: 'V',
		0x0B: 'B', 0x0C: 'Q', 0x0D: 'W', 0x0E: 'E', 0x0F: 'R', 0x10: 'Y', 0x11: 'T', 0x1F: 'O', 0x20: 'U', 0x22: 'I',
		0x23: 'P', 0x25: 'L', 0x26: 'J', 0x28: 'K', 0x2D: 'N', 0x2E: 'M',
	}
	for mac, ch := range letters {
		m[mac] = winKey{vk: uint16(ch)}
	}
	digits := map[int]byte{
		0x12: '1', 0x13: '2', 0x14: '3', 0x15: '4', 0x16: '6', 0x17: '5', 0x19: '9', 0x1A: '7', 0x1C: '8', 0x1D: '0',
	}
	for mac, ch := range digits {
		m[mac] = winKey{vk: uint16(ch)}
	}
	for mac, vk := range map[int]uint16{
		0x18: 0xBB, // = (VK_OEM_PLUS)
		0x1B: 0xBD, // - (VK_OEM_MINUS)
		0x1E: 0xDD, // ]
		0x21: 0xDB, // [
		0x27: 0xDE, // '
		0x29: 0xBA, // ;
		0x2A: 0xDC, // \
		0x2B: 0xBC, // ,
		0x2C: 0xBF, // /
		0x2F: 0xBE, // .
		0x32: 0xC0, // `
		0x30: vkTab, 0x31: vkSpace, 0x24: vkReturn, 0x33: vkBack, 0x35: vkEscape,
	} {
		m[mac] = winKey{vk: vk}
	}
	for mac, vk := range map[int]uint16{
		0x7B: vkLeft, 0x7C: vkRight, 0x7D: vkDown, 0x7E: vkUp,
		0x74: vkPrior, 0x79: vkNext, 0x73: vkHome, 0x77: vkEnd,
	} {
		m[mac] = winKey{vk: vk, extended: true}
	}
	// F1..F12 (their mac codes are not in order)
	for i, mac := range []int{0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F} {
		m[mac] = winKey{vk: uint16(vkF1 + i)}
	}
	return m
}

func lookupKey(macKeyCode int) (winKey, bool) {
	k, ok := macToWin[macKeyCode]
	return k, ok
}
