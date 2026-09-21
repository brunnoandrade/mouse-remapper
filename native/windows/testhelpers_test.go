package main

import (
	"fmt"
	"strings"
	"testing"
)

// fakeHost records everything the engine asks the operating system to do.
type fakeHost struct {
	foreground string
	sent       [][]Input
	opened     []Action
	cursor     [][2]int
	logs       []string
}

func (h *fakeHost) Foreground() string { return h.foreground }
func (h *fakeHost) Send(in []Input)    { h.sent = append(h.sent, in) }
func (h *fakeHost) OpenApp(a Action)   { h.opened = append(h.opened, a) }
func (h *fakeHost) SetCursor(x, y int) { h.cursor = append(h.cursor, [2]int{x, y}) }
func (h *fakeHost) Log(line string)    { h.logs = append(h.logs, line) }
func (h *fakeHost) reset()             { *h = fakeHost{foreground: h.foreground} }
func (h *fakeHost) actions() string    { return strings.Join(h.logs, " | ") }

func mustConfig(t *testing.T, js string) Config {
	t.Helper()
	cfg, err := parseConfig([]byte(js))
	if err != nil {
		t.Fatalf("parseConfig: %v", err)
	}
	return cfg
}

// engineWith builds a dry-run engine (actions are logged, not injected) with the given foreground app.
func engineWith(t *testing.T, cfgJSON, foreground string) (*Engine, *fakeHost) {
	t.Helper()
	h := &fakeHost{foreground: foreground}
	return NewEngine(h, mustConfig(t, cfgJSON), true), h
}

func btn(kind EventKind, b int) MouseEvent { return MouseEvent{Kind: kind, Button: b, X: 500, Y: 400} }
func move(x, y int) MouseEvent             { return MouseEvent{Kind: EvMove, X: x, Y: y} }

func expect(t *testing.T, name string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("%s: got %v, want %v", name, got, want)
	}
}
