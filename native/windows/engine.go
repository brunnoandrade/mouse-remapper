package main

import (
	"fmt"
	"math"
	"sync"
	"time"
)

const wheelDelta = 120 // Windows wheel units per notch

type EventKind int

const (
	EvDown EventKind = iota
	EvUp
	EvMove
	EvWheel  // vertical wheel
	EvHWheel // horizontal wheel
)

// MouseEvent is what the low-level hook reports. Button uses the config's numbering: 2 middle, 3 back, 4 forward.
// Delta is in wheel units (120 per notch; positive = away from the user / to the right).
type MouseEvent struct {
	Kind   EventKind
	Button int
	X, Y   int
	Delta  int
}

// Host is everything the engine needs from the operating system.
type Host interface {
	Foreground() string // lower-case executable name of the foreground app, "" when unknown
	Send(inputs []Input)
	OpenApp(a Action)
	SetCursor(x, y int)
	Log(line string)
}

// Engine decides, for every mouse event, whether it is swallowed and what it triggers. It is the Go counterpart
// of eventTapCallback in native/MouseRemapHelper.swift.
type Engine struct {
	mu       sync.Mutex
	host     Host
	cfg      Config
	dryRun   bool
	tracker  GestureTracker
	adjuster ScrollAdjuster
	smoother *Smoother

	sends          [][]Input // input to inject; sent after the mutex is released (see flush)
	scrollAcc      float64   // wheel notches accumulated towards one remapped scroll step
	carryV, carryH float64   // fractional wheel units left over when only invert/speed are applied
	lastTick       float64
	wake           chan struct{}
}

func NewEngine(host Host, cfg Config, dryRun bool) *Engine {
	return &Engine{host: host, cfg: cfg, dryRun: dryRun, smoother: NewSmoother(), wake: make(chan struct{}, 1)}
}

func (e *Engine) SetConfig(cfg Config) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.cfg = cfg
	if e.smoother.Animating() {
		e.signal() // smoothing may have been switched off: let the ticker flush what is pending
	}
}

func (e *Engine) signal() {
	select {
	case e.wake <- struct{}{}:
	default:
	}
}

func (e *Engine) find(matches func(Mapping) bool) (Mapping, bool) {
	return e.cfg.findMapping(e.host.Foreground(), matches)
}

func (e *Engine) findButton(button int) (Mapping, bool) {
	return e.find(func(m Mapping) bool { return m.Trigger.Type == "button" && intPtrEq(m.Trigger.Button, button) })
}

func (e *Engine) findGesture(button int, direction string) (Mapping, bool) {
	return e.find(func(m Mapping) bool {
		return m.Trigger.Type == "gesture" && intPtrEq(m.Trigger.Button, button) && m.Trigger.Direction == direction
	})
}

// hasGesture reports whether the foreground app's profile (or the default one) defines any gesture on the button.
func (e *Engine) hasGesture(button int) bool {
	for _, d := range []string{"left", "right", "up", "down"} {
		if _, ok := e.findGesture(button, d); ok {
			return true
		}
	}
	return false
}

// Handle processes one event and reports whether it must be swallowed (not delivered to the app).
// `now` is a monotonic clock in seconds.
func (e *Engine) Handle(ev MouseEvent, now float64) bool {
	e.mu.Lock()
	var swallow bool
	switch ev.Kind {
	case EvWheel, EvHWheel:
		swallow = e.handleWheel(ev, now)
	default:
		swallow = e.handleButton(ev)
	}
	sends := e.takeSends()
	e.mu.Unlock()
	e.flush(sends)
	return swallow
}

// send queues input for injection. Windows gives a low-level hook about 300 ms and removes it if it is slow, so
// nothing that calls into the system may run while the engine's mutex is held: Handle and Tick collect the input
// under the lock and inject it after releasing it.
func (e *Engine) send(in []Input) { e.sends = append(e.sends, in) }

func (e *Engine) takeSends() [][]Input {
	sends := e.sends
	e.sends = nil
	return sends
}

func (e *Engine) flush(sends [][]Input) {
	for _, in := range sends {
		e.host.Send(in)
	}
}

// ---- wheel ---------------------------------------------------------------------------------------------------

func (e *Engine) handleWheel(ev MouseEvent, now float64) bool {
	if ev.Delta == 0 {
		return false
	}
	if ev.Kind == EvWheel {
		direction := "down"
		if ev.Delta > 0 {
			direction = "up"
		}
		if m, ok := e.find(func(m Mapping) bool { return m.Trigger.Type == "scroll" && m.Trigger.Direction == direction }); ok && m.Action.Type != "none" {
			e.scrollAcc += math.Abs(float64(ev.Delta)) / wheelDelta
			if e.scrollAcc >= e.cfg.ScrollThreshold {
				e.scrollAcc = 0
				e.perform(m.Action)
			}
			return e.cfg.SuppressOriginalScroll
		}
	}
	return e.plainScroll(ev, now)
}

// plainScroll handles scroll that no mapping consumed: adjust it, or (with smoothing on) glide instead.
// Windows does not let a hook change an event, so the original is swallowed and a new one is injected.
func (e *Engine) plainScroll(ev MouseEvent, now float64) bool {
	s := e.cfg.Scroll
	// Real wheels report whole notches. Finer deltas come from precision touchpads and high-resolution wheels,
	// which are already smooth: leave them alone.
	if s.isStandard() || ev.Delta%wheelDelta != 0 {
		return false
	}
	vertical := ev.Kind == EvWheel
	vScale, hScale := e.adjuster.scales(s, now)
	scale := hScale
	if vertical {
		scale = vScale
	}

	if s.Smoothing > 0 {
		if !e.smoother.Animating() {
			e.lastTick = now
		}
		if vertical {
			e.smoother.Add(0, float64(ev.Delta)*scale)
		} else {
			e.smoother.Add(float64(ev.Delta)*scale, 0)
		}
		e.signal()
		return true
	}

	carry := &e.carryH
	if vertical {
		carry = &e.carryV
	}
	raw := float64(ev.Delta)*scale + *carry
	whole := math.Trunc(raw)
	*carry = raw - whole
	if whole != 0 {
		if vertical {
			e.emitWheel(0, int(whole))
		} else {
			e.emitWheel(int(whole), 0)
		}
	}
	return true
}

func (e *Engine) emitWheel(dx, dy int) {
	if dx == 0 && dy == 0 {
		return
	}
	if e.dryRun {
		e.host.Log(fmt.Sprintf("SMOOTH dx=%d dy=%d", dx, dy))
		return
	}
	var in []Input
	if dx != 0 {
		in = append(in, Input{Kind: WheelH, Delta: dx})
	}
	if dy != 0 {
		in = append(in, Input{Kind: WheelV, Delta: dy})
	}
	e.send(in)
}

// Tick advances the smoothing glide by one frame and reports whether it is still moving.
func (e *Engine) Tick(now float64) bool {
	e.mu.Lock()
	animating, sends := e.tickLocked(now)
	e.mu.Unlock()
	e.flush(sends)
	return animating
}

func (e *Engine) tickLocked(now float64) (bool, [][]Input) {
	dt := math.Min(0.05, now-e.lastTick) // a stalled frame must not turn into one huge jump
	e.lastTick = now
	var dx, dy int
	if e.cfg.Scroll.Smoothing > 0 {
		dx, dy = e.smoother.Step(dt, e.cfg.Scroll.Smoothing)
	} else {
		dx, dy = e.smoother.Flush()
	}
	e.emitWheel(dx, dy)
	return e.smoother.Animating(), e.takeSends()
}

// RunSmoother drives Tick at ~120 Hz while a glide is in progress, and sleeps otherwise.
func (e *Engine) RunSmoother(stop <-chan struct{}, now func() float64) {
	for {
		select {
		case <-e.wake:
		case <-stop:
			return
		}
		ticker := time.NewTicker(8 * time.Millisecond)
		for e.animatingOrTick(ticker, stop, now) {
		}
		ticker.Stop()
	}
}

func (e *Engine) animatingOrTick(ticker *time.Ticker, stop <-chan struct{}, now func() float64) bool {
	select {
	case <-ticker.C:
		return e.Tick(now())
	case <-stop:
		return false
	}
}

// ---- buttons and gestures ---------------------------------------------------------------------------------------

func (e *Engine) handleButton(ev MouseEvent) bool {
	switch ev.Kind {
	case EvMove:
		if !e.tracker.active {
			return false
		}
		if dir, ok := e.tracker.Move(ev.X, ev.Y); ok {
			if m, found := e.findGesture(e.tracker.button, dir); found && m.Action.Type != "none" {
				e.perform(m.Action)
			}
			// Unlike macOS the pointer keeps moving during the drag; put it back where the gesture began.
			e.host.SetCursor(e.tracker.ax, e.tracker.ay)
		}
		return false // moves always reach the app

	case EvDown:
		// A button with gestures is held back on press so the drag can be told apart from a click.
		if e.hasGesture(ev.Button) {
			e.tracker.Begin(ev.Button, ev.X, ev.Y)
			return true
		}

	case EvUp:
		if e.tracker.active && e.tracker.button == ev.Button {
			fired := e.tracker.fired
			e.tracker.Reset()
			if fired {
				return true
			}
			// No drag: it was a click. Run the button's own mapping, or give the click back to the app.
			if m, ok := e.findButton(ev.Button); ok && m.Action.Type != "none" {
				e.perform(m.Action)
			} else {
				e.replayClick(ev.Button)
			}
			return true
		}
	}

	m, ok := e.findButton(ev.Button)
	if !ok || m.Action.Type == "none" {
		return false
	}
	if ev.Kind == EvDown {
		e.perform(m.Action)
	}
	// Always swallowed when mapped, otherwise the native behavior (e.g. back/forward) would still fire.
	return true
}

// ---- actions -----------------------------------------------------------------------------------------------------

// describe is the dry-run line for an action. It matches the macOS helper's output exactly, so the same
// end-to-end checks can run against both.
func describe(a Action) string {
	detail := a.ID
	if detail == "" {
		detail = a.BundleID
	}
	if detail == "" {
		key, flags := 0, uint64(0)
		if a.KeyCode != nil {
			key = *a.KeyCode
		}
		if a.Flags != nil {
			flags = *a.Flags
		}
		detail = fmt.Sprintf("key=%d,flags=%d", key, flags)
	}
	return fmt.Sprintf("ACTION %s %s", a.Type, detail)
}

func (e *Engine) perform(a Action) {
	if e.dryRun {
		e.host.Log(describe(a))
		return
	}
	if a.Type == "app" {
		e.host.OpenApp(a)
		return
	}
	if inputs := planAction(a); len(inputs) > 0 {
		e.send(inputs)
	}
}

func (e *Engine) replayClick(button int) {
	if e.dryRun {
		e.host.Log(fmt.Sprintf("REPLAY button=%d", button))
		return
	}
	name := map[int]string{2: "middle", 3: "x1", 4: "x2"}[button]
	if name != "" {
		e.send(click(name))
	}
}
