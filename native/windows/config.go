package main

import (
	"encoding/json"
	"math"
	"strings"
)

// The config file is shared with the macOS helper and the Electron app (see src/config.js), so the field
// names and shapes here must stay in step with native/MouseRemapHelper.swift.

// Action is what a trigger does. Type selects which of the other fields apply:
// key -> KeyCode/Flags, system -> ID, click -> ID (left|right|double), app -> BundleID/Path.
type Action struct {
	Type     string  `json:"type"`
	KeyCode  *int    `json:"keyCode,omitempty"` // macOS virtual key code: the config's canonical key format
	Flags    *uint64 `json:"flags,omitempty"`   // macOS modifier bits, see the flag* constants
	ID       string  `json:"id,omitempty"`
	BundleID string  `json:"bundleId,omitempty"` // on Windows: the lower-case executable name
	Path     string  `json:"path,omitempty"`     // full path of the executable, used to launch it
}

// Modifier bits as stored in the config (they are the macOS CGEventFlags values). Windows maps
// shift/control/option/command to Shift/Ctrl/Alt/Win.
const (
	flagShift   uint64 = 0x20000
	flagControl uint64 = 0x40000
	flagOption  uint64 = 0x80000
	flagCommand uint64 = 0x100000
)

// Trigger fires a mapping. button: 2 middle, 3 back, 4 forward. scroll: direction up|down.
// gesture: hold `button` and drag in `direction` (left|right|up|down).
type Trigger struct {
	Type      string `json:"type"`
	Button    *int   `json:"button,omitempty"`
	Direction string `json:"direction,omitempty"`
}

type Mapping struct {
	ID      string  `json:"id"`
	Enabled bool    `json:"enabled"`
	Trigger Trigger `json:"trigger"`
	Action  Action  `json:"action"`
}

// Profile is a set of mappings. The default profile applies everywhere (when enabled); an app profile only
// while that app is in the foreground, and wins over the default profile for the triggers it defines.
type Profile struct {
	Enabled  *bool     `json:"enabled"`
	Mappings []Mapping `json:"mappings"`
}

func (p Profile) isEnabled() bool { return p.Enabled == nil || *p.Enabled }

// ScrollSettings adjusts plain mouse-wheel scrolling (scroll that no mapping consumed).
type ScrollSettings struct {
	Invert       bool    `json:"invert"`
	Speed        float64 `json:"speed"`        // multiplier, 0.5...4
	Acceleration float64 `json:"acceleration"` // 0...1: extra boost while the wheel is spun fast
	Smoothing    float64 `json:"smoothing"`    // 0...1: 0 = off; higher = longer glide after each tick
}

func (s ScrollSettings) isStandard() bool {
	return !s.Invert && s.Speed == 1 && s.Acceleration == 0 && s.Smoothing == 0
}

type Config struct {
	DefaultProfile         Profile            `json:"defaultProfile"`
	AppProfiles            map[string]Profile `json:"appProfiles"` // keyed by lower-case executable name
	ScrollThreshold        float64            `json:"scrollThreshold"`
	SuppressOriginalScroll bool               `json:"suppressOriginalScroll"`
	Scroll                 ScrollSettings     `json:"scroll"`
}

func clamp(v, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, v)) }

func defaultConfig() Config {
	enabled := true
	return Config{
		DefaultProfile:         Profile{Enabled: &enabled, Mappings: []Mapping{}},
		AppProfiles:            map[string]Profile{},
		ScrollThreshold:        4,
		SuppressOriginalScroll: true,
		Scroll:                 ScrollSettings{Speed: 1},
	}
}

// parseConfig is lenient on purpose: a missing field takes its default, so a config written by an older
// or newer app never makes the helper fall back to "no mappings". Only invalid JSON is an error.
func parseConfig(data []byte) (Config, error) {
	cfg := defaultConfig()
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, err
	}
	cfg.Scroll.Speed = clamp(cfg.Scroll.Speed, 0.5, 4)
	cfg.Scroll.Acceleration = clamp(cfg.Scroll.Acceleration, 0, 1)
	cfg.Scroll.Smoothing = clamp(cfg.Scroll.Smoothing, 0, 1)
	if cfg.ScrollThreshold <= 0 {
		cfg.ScrollThreshold = 4
	}
	if cfg.AppProfiles == nil {
		cfg.AppProfiles = map[string]Profile{}
	}
	// Profile keys are matched case-insensitively (Windows file names are).
	lowered := make(map[string]Profile, len(cfg.AppProfiles))
	for name, profile := range cfg.AppProfiles {
		lowered[strings.ToLower(name)] = profile
	}
	cfg.AppProfiles = lowered
	return cfg, nil
}

// findMapping returns the mapping that applies while `foreground` is the active app: its own profile first,
// then the default profile.
func (c Config) findMapping(foreground string, matches func(Mapping) bool) (Mapping, bool) {
	if profile, ok := c.AppProfiles[strings.ToLower(foreground)]; ok {
		for _, m := range profile.Mappings {
			if m.Enabled && matches(m) {
				return m, true
			}
		}
	}
	if !c.DefaultProfile.isEnabled() {
		return Mapping{}, false
	}
	for _, m := range c.DefaultProfile.Mappings {
		if m.Enabled && matches(m) {
			return m, true
		}
	}
	return Mapping{}, false
}

func intPtrEq(p *int, v int) bool { return p != nil && *p == v }
