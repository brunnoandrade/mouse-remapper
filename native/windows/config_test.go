package main

import "testing"

const profilesJSON = `{
  "defaultProfile": {"enabled": true, "mappings": [
    {"id":"d1","enabled":true,"trigger":{"type":"button","button":3},"action":{"type":"system","id":"mute"}},
    {"id":"d2","enabled":true,"trigger":{"type":"button","button":4},"action":{"type":"system","id":"play_pause"}}]},
  "appProfiles": {"Chrome.EXE": {"mappings": [
    {"id":"a1","enabled":true,"trigger":{"type":"button","button":3},"action":{"type":"key","keyCode":1,"flags":0}},
    {"id":"a2","enabled":true,"trigger":{"type":"button","button":4},"action":{"type":"none"}},
    {"id":"a3","enabled":false,"trigger":{"type":"button","button":5},"action":{"type":"key","keyCode":2}}]}}
}`

func TestParseConfigDefaultsAndClamps(t *testing.T) {
	c := mustConfig(t, `{}`)
	expect(t, "empty config: default profile enabled", c.DefaultProfile.isEnabled(), true)
	expect(t, "empty config: threshold", c.ScrollThreshold, 4.0)
	expect(t, "empty config: scroll is standard", c.Scroll.isStandard(), true)
	expect(t, "empty config: speed defaults to 1 (not 0)", c.Scroll.Speed, 1.0)

	c = mustConfig(t, `{"scroll":{"speed":99,"acceleration":-1,"smoothing":7}}`)
	expect(t, "speed clamped", c.Scroll.Speed, 4.0)
	expect(t, "acceleration clamped", c.Scroll.Acceleration, 0.0)
	expect(t, "smoothing clamped", c.Scroll.Smoothing, 1.0)

	c = mustConfig(t, `{"scroll":{"invert":true}}`)
	expect(t, "partial scroll keeps the other defaults", c.Scroll.Speed, 1.0)

	c = mustConfig(t, `{"scrollThreshold": -3}`)
	expect(t, "non-positive threshold falls back", c.ScrollThreshold, 4.0)

	// the old (pre-profiles) format has none of the new keys: it must still parse, with no mappings
	c = mustConfig(t, `{"scrollUp":{"enabled":true,"keyCode":126,"flags":0},"targetApps":["x"],"scrollThreshold":6}`)
	expect(t, "old format: parses", c.ScrollThreshold, 6.0)
	expect(t, "old format: no mappings", len(c.DefaultProfile.Mappings), 0)

	if _, err := parseConfig([]byte(`{ not json`)); err == nil {
		t.Error("invalid JSON must be an error")
	}
}

func TestFindMappingPrecedence(t *testing.T) {
	c := mustConfig(t, profilesJSON)
	id := func(fg string, button int) string {
		m, ok := c.findMapping(fg, func(m Mapping) bool { return m.Trigger.Type == "button" && intPtrEq(m.Trigger.Button, button) })
		if !ok {
			return "nil"
		}
		return m.ID
	}
	expect(t, "app profile overrides the default (button 3)", id("chrome.exe", 3), "a1")
	expect(t, "app 'none' wins over the default (button 4)", id("chrome.exe", 4), "a2")
	expect(t, "disabled own mapping, nothing in default", id("chrome.exe", 5), "nil")
	expect(t, "other app uses the default (button 3)", id("notepad.exe", 3), "d1")
	expect(t, "other app uses the default (button 4)", id("notepad.exe", 4), "d2")
	expect(t, "profile keys and lookups are case-insensitive", id("CHROME.exe", 3), "a1")
	expect(t, "unknown foreground uses the default", id("", 3), "d1")

	c.DefaultProfile.Enabled = new(bool) // false
	expect(t, "default off: other apps get nothing", id("notepad.exe", 3), "nil")
	expect(t, "default off: an app profile still applies", id("chrome.exe", 3), "a1")
}
