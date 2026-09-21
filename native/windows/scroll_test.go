package main

import (
	"math"
	"testing"
)

func runToRest(s *Smoother, smoothing, dt float64) (frames []int, sumX int, sumY int) {
	for n := 0; s.Animating() && n < 20000; n++ {
		dx, dy := s.Step(dt, smoothing)
		frames = append(frames, dy)
		sumX += dx
		sumY += dy
	}
	return
}

func TestSmootherConservesDistance(t *testing.T) {
	worst, cases := 0.0, 0
	for _, smoothing := range []float64{0.05, 0.25, 0.5, 0.75, 1} {
		for _, dt := range []float64{1.0 / 60, 1.0 / 120, 1.0 / 240, 0.0173} {
			for _, total := range []float64{1, 30, 120, 240, 1200, 4000, -120, -3600} {
				s := NewSmoother()
				s.Add(total/2, total)
				_, sx, sy := runToRest(s, smoothing, dt)
				worst = math.Max(worst, math.Max(math.Abs(float64(sy)-total), math.Abs(float64(sx)-total/2)))
				cases++
			}
		}
	}
	if worst > 1 {
		t.Errorf("delivered != requested: worst error %.2f units over %d cases", worst, cases)
	}
}

func TestSmootherProfile(t *testing.T) {
	s := NewSmoother()
	s.Add(0, 1200) // 10 notches
	frames, _, total := runToRest(s, 0.5, 1.0/120)
	if total != 1200 {
		t.Errorf("total %d, want 1200", total)
	}
	maxRise, cum := 0, 0
	for i, f := range frames {
		if f < 0 {
			t.Errorf("frame %d went backwards: %d", i, f)
		}
		if i > 0 && f-frames[i-1] > maxRise {
			maxRise = f - frames[i-1]
		}
		cum += f
		if cum > 1200 {
			t.Errorf("overshoot at frame %d: %d", i, cum)
		}
	}
	if maxRise > 2 { // a decaying glide: any rise is rounding jitter
		t.Errorf("per-frame step rose by %d units", maxRise)
	}
}

func TestSmootherDurationGrowsWithSmoothing(t *testing.T) {
	var last float64
	for _, smoothing := range []float64{0.1, 0.3, 0.5, 0.75, 1} {
		s := NewSmoother()
		s.Add(0, 1200)
		frames, _, _ := runToRest(s, smoothing, 1.0/120)
		d := float64(len(frames)) / 120
		if d <= last {
			t.Errorf("smoothing %.2f: %.0f ms is not longer than %.0f ms", smoothing, d*1000, last*1000)
		}
		if d > 1.6 {
			t.Errorf("smoothing %.2f settles too slowly: %.0f ms", smoothing, d*1000)
		}
		last = d
	}
}

func TestSmootherFrameRateIndependence(t *testing.T) {
	at := func(dt float64) int {
		s := NewSmoother()
		s.Add(0, 2400)
		pos := 0
		for elapsed := 0.0; elapsed+1e-9 < 0.1; elapsed += dt {
			_, dy := s.Step(dt, 0.5)
			pos += dy
		}
		return pos
	}
	a, b, c := at(1.0/60), at(1.0/120), at(1.0/240)
	if hi, lo := max(a, b, c), min(a, b, c); hi-lo > 30 { // 1.25% of the distance
		t.Errorf("position after 100 ms differs across frame rates: %d %d %d", a, b, c)
	}
}

func TestSmootherReversalAndSafety(t *testing.T) {
	s := NewSmoother()
	s.Add(200, 1200)
	got := 0
	for i := 0; i < 3; i++ {
		_, dy := s.Step(1.0/120, 0.5)
		got += dy
	}
	s.Add(0, -360)
	if s.pendY != -360 {
		t.Errorf("reversal must replace the pending distance in that axis, got %v", s.pendY)
	}
	if s.pendX <= 0 {
		t.Error("reversal must leave the other axis alone")
	}
	_, _, rest := runToRest(s, 0.5, 1.0/120)
	if math.Abs(float64(got+rest)-float64(got-360)) > 1 {
		t.Errorf("net travelled %d, want %d", got+rest, got-360)
	}

	big := NewSmoother()
	for i := 0; i < 1000; i++ {
		big.Add(0, 1000)
	}
	if big.pendY != big.MaxPending {
		t.Errorf("pending distance must be capped, got %v", big.pendY)
	}

	tiny := NewSmoother()
	tiny.Add(0, 0.4)
	tiny.Step(1.0/120, 0.5)
	if tiny.Animating() {
		t.Error("a sub-unit request must finish in one frame")
	}

	stalled := NewSmoother()
	stalled.Add(0, 240)
	if _, dy := stalled.Step(5, 0.5); dy < 239 || dy > 240 {
		t.Errorf("a huge dt delivers the rest, never more: %d", dy)
	}

	fl := NewSmoother()
	fl.Add(50, 900)
	fl.Step(1.0/120, 0.5)
	px, py := fl.pendX, fl.pendY
	dx, dy := fl.Flush()
	if fl.Animating() || math.Abs(float64(dy)-py) > 1 || math.Abs(float64(dx)-px) > 1 {
		t.Errorf("flush delivers the remainder and stops: %d,%d vs %.1f,%.1f", dx, dy, px, py)
	}
}

func TestAdjusterFactor(t *testing.T) {
	var a ScrollAdjuster
	s := ScrollSettings{Speed: 1, Acceleration: 1}
	if f := a.factor(s, 10); f != 1 {
		t.Errorf("first tick after a pause: %v", f)
	}
	if f := a.factor(s, 10.5); f != 1 {
		t.Errorf("a pause starts a new gesture: %v", f)
	}
	if f := a.factor(s, 10.6); f <= 1 || f >= 2 {
		t.Errorf("10 ticks/s: modest boost expected, got %v", f)
	}
	last := 0.0
	for i, now := 0, 11.0; i < 6; i++ {
		now += 0.02
		last = a.factor(s, now)
	}
	if math.Abs(last-4) > 1e-9 {
		t.Errorf("50 ticks/s: full boost expected (4x), got %v", last)
	}
	var b ScrollAdjuster
	z := ScrollSettings{Speed: 2}
	b.factor(z, 1)
	if f := b.factor(z, 1.01); f != 2 {
		t.Errorf("acceleration 0 never boosts: %v", f)
	}
	v, h := (&ScrollAdjuster{}).scales(ScrollSettings{Invert: true, Speed: 2}, 1)
	if v != -2 || h != 2 {
		t.Errorf("invert flips vertical only: %v %v", v, h)
	}
}
