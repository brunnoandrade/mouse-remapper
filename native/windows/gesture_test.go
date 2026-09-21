package main

import "testing"

func TestGestureTracker(t *testing.T) {
	var tr GestureTracker
	if _, ok := tr.Move(9999, 9999); ok {
		t.Error("an idle tracker must ignore movement")
	}

	cases := []struct {
		name   string
		dx, dy int
		want   string
	}{
		{"left", -70, 5, "left"}, {"right", 70, -5, "right"}, {"up", 3, -80, "up"}, {"down", -3, 80, "down"},
		{"diagonal: dominant axis wins", 61, 59, "right"}, {"tie goes horizontal", -60, 60, "left"},
	}
	for _, c := range cases {
		tr.Begin(3, 500, 400)
		if got, ok := tr.Move(500+c.dx, 400+c.dy); !ok || got != c.want {
			t.Errorf("%s: got %q,%v want %q", c.name, got, ok, c.want)
		}
	}

	tr.Begin(3, 500, 400)
	if _, ok := tr.Move(500-59, 400); ok {
		t.Error("59 px must not fire")
	}
	if d, ok := tr.Move(500-60, 400); !ok || d != "left" {
		t.Errorf("60 px fires: %q,%v", d, ok)
	}
	if _, ok := tr.Move(500-500, 400); ok {
		t.Error("fires only once per press")
	}

	tr.Begin(3, 500, 400)
	tr.Move(530, 400)
	if _, ok := tr.Move(505, 400); ok {
		t.Error("back to near the start: no gesture (net displacement is what counts)")
	}
	tr.Reset()
	if _, ok := tr.Move(9999, 0); ok || tr.active {
		t.Error("reset clears the tracker")
	}
}
