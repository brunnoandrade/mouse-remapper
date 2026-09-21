package main

// GestureDistance is how far (in pixels) the pointer must travel from where the button was pressed before
// the drag counts as a gesture.
const GestureDistance = 60

// GestureTracker follows one held button and reports the drag direction the first time the pointer has moved
// far enough from the press point. Pure state, so it can be tested without a mouse.
type GestureTracker struct {
	active bool
	button int
	ax, ay int
	fired  bool
}

func (t *GestureTracker) Begin(button, x, y int) {
	t.active, t.button, t.ax, t.ay, t.fired = true, button, x, y, false
}

func (t *GestureTracker) Reset() { *t = GestureTracker{} }

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// Move feeds the pointer position and returns the direction once, when the distance is first crossed.
func (t *GestureTracker) Move(x, y int) (string, bool) {
	if !t.active || t.fired {
		return "", false
	}
	dx, dy := x-t.ax, y-t.ay
	if max(abs(dx), abs(dy)) < GestureDistance {
		return "", false
	}
	t.fired = true
	if abs(dx) >= abs(dy) { // a tie goes horizontal
		if dx > 0 {
			return "right", true
		}
		return "left", true
	}
	if dy > 0 { // screen coordinates: +y points down
		return "down", true
	}
	return "up", true
}
