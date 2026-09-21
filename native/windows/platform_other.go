//go:build !windows

package main

import (
	"errors"
	"fmt"
)

// Everything the operating system provides is only available on Windows. These stubs let the portable logic
// (and its tests) build and run anywhere.

type logHost struct{}

func newHost() Host                       { return logHost{} }
func (logHost) Foreground() string        { return "" }
func (logHost) Send(inputs []Input)       {}
func (logHost) OpenApp(a Action)          {}
func (logHost) SetCursor(x, y int)        {}
func (logHost) Log(line string)           { fmt.Println(line) }
func listApps() []RunningApp              { return []RunningApp{} }
func resolveApps(_ []string) []RunningApp { return []RunningApp{} }
func installHook(_ *Engine) error         { return errors.New("the mouse hook is only available on Windows") }
