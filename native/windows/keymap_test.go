package main

import (
	"os"
	"regexp"
	"strconv"
	"testing"
)

// Every key the settings UI can record must have a Windows equivalent, otherwise a rule made on the Mac side
// of the UI would silently do nothing on Windows. The list is read from the UI source so the two cannot drift.
func TestEveryUIKeyHasAWindowsKey(t *testing.T) {
	src, err := os.ReadFile("../../src/settings.js")
	if err != nil {
		t.Skipf("settings.js not found: %v", err)
	}
	block := regexp.MustCompile(`(?s)const CODE_TO_MAC = \{(.*?)\};`).FindSubmatch(src)
	if block == nil {
		t.Fatal("CODE_TO_MAC not found in settings.js")
	}
	entries := regexp.MustCompile(`(\w+):\s*0x([0-9A-Fa-f]+)`).FindAllSubmatch(block[1], -1)
	if len(entries) < 60 {
		t.Fatalf("parsed only %d entries from CODE_TO_MAC", len(entries))
	}
	seen := map[uint16]string{}
	for _, e := range entries {
		mac, _ := strconv.ParseInt(string(e[2]), 16, 32)
		k, ok := lookupKey(int(mac))
		if !ok {
			t.Errorf("%s (mac 0x%X) has no Windows key", e[1], mac)
			continue
		}
		if other, dup := seen[k.vk]; dup {
			t.Errorf("%s and %s map to the same Windows key 0x%X", e[1], other, k.vk)
		}
		seen[k.vk] = string(e[1])
	}
	t.Logf("%d UI keys, all mapped", len(entries))
}

func TestKeyMapDetails(t *testing.T) {
	check := func(name string, mac int, vk uint16, ext bool) {
		t.Helper()
		k, ok := lookupKey(mac)
		if !ok || k.vk != vk || k.extended != ext {
			t.Errorf("%s: got %+v ok=%v, want vk=0x%X ext=%v", name, k, ok, vk, ext)
		}
	}
	check("A", 0x00, 'A', false)
	check("Z", 0x06, 'Z', false)
	check("digit 0", 0x1D, '0', false)
	check("digit 6 (mac codes are not in order)", 0x16, '6', false)
	check("Space", 0x31, vkSpace, false)
	check("Enter", 0x24, vkReturn, false)
	check("Backspace (mac 'delete')", 0x33, vkBack, false)
	check("Up arrow needs the extended flag", 0x7E, vkUp, true)
	check("Left arrow", 0x7B, vkLeft, true)
	check("Page Down", 0x79, vkNext, true)
	check("Home", 0x73, vkHome, true)
	check("F1", 0x7A, 0x70, false)
	check("F3 (mac 0x63)", 0x63, 0x72, false)
	check("F12", 0x6F, 0x7B, false)
	check("Minus", 0x1B, 0xBD, false)
	check("Equal", 0x18, 0xBB, false)
	if _, ok := lookupKey(0x7F); ok {
		t.Error("unknown mac key must not map")
	}
}
