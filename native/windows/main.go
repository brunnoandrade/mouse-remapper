// MouseRemapHelper for Windows: the counterpart of native/MouseRemapHelper.swift. The Electron app starts it,
// it reads the shared config.json and remaps mouse input with a low-level mouse hook.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var processStart = time.Now()

// monotonicNow is a monotonic clock in seconds.
func monotonicNow() float64 { return time.Since(processStart).Seconds() }

// RunningApp is one entry of --list-apps / --resolve-apps. The JSON matches the macOS helper's, plus Path.
// BundleIdentifier is the lower-case executable name on Windows.
type RunningApp struct {
	Name             string  `json:"name"`
	BundleIdentifier string  `json:"bundleIdentifier"`
	IconBase64       *string `json:"iconBase64"` // the Electron app fills icons in (app.getFileIcon)
	Path             string  `json:"path,omitempty"`
}

func configPath() string {
	if override := os.Getenv("MOUSE_REMAP_CONFIG"); override != "" { // test/debug hook
		return override
	}
	dir, err := os.UserConfigDir() // %AppData% on Windows
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "MouseRemapper", "config.json")
}

func logf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[MouseRemapHelper] "+format+"\n", args...)
}

func printJSON(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		data = []byte("[]")
	}
	fmt.Println(string(data))
}

func main() {
	for _, arg := range os.Args[1:] {
		switch {
		case arg == "--check-permission":
			// Windows has no Accessibility-style permission prompt. (Apps running as administrator are out of
			// reach for a normal process; that is a limit of the hook, not a permission to grant.)
			fmt.Println("true")
			return
		case arg == "--list-apps":
			printJSON(listApps())
			return
		case strings.HasPrefix(arg, "--resolve-apps="):
			printJSON(resolveApps(strings.Split(strings.TrimPrefix(arg, "--resolve-apps="), ",")))
			return
		}
	}
	run()
}

func run() {
	path := configPath()
	store := NewStore(path)
	if err := store.Load(); err != nil {
		logf("config unreadable at startup, using defaults in memory (file left untouched): %v", err)
	}

	dry := os.Getenv("MOUSE_REMAP_DRY_RUN") != "" // test/debug hook: print actions instead of performing them
	host := newHost()
	engine := NewEngine(host, store.Config(), dry)

	stop := make(chan struct{})
	go engine.RunSmoother(stop, monotonicNow)
	go func() {
		for range time.Tick(100 * time.Millisecond) {
			changed, err := store.Poll()
			switch {
			case changed:
				engine.SetConfig(store.Config())
				logf("config reloaded")
			case err != nil:
				// keep the previous config; the store retries and eventually gives up until the file changes
			}
		}
	}()

	logf("Running. Config at %s", path)
	if err := installHook(engine); err != nil {
		logf("Failed to install the mouse hook: %v", err)
		os.Exit(1)
	}
	close(stop)
}
