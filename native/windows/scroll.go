package main

import "math"

// ---- Adjuster: invert / speed / acceleration ----------------------------------------------------------------

// ScrollAdjuster works out how much to scale a wheel tick. Acceleration boosts ticks that arrive in quick
// succession, and nothing when the wheel is turned slowly.
type ScrollAdjuster struct {
	last float64
}

const (
	slowRate = 8.0  // events per second below which there is no boost
	fastRate = 40.0 // ...and at or above which the boost is full
	maxBoost = 3.0  // acceleration 1.0 => up to +300%
)

func (a *ScrollAdjuster) factor(s ScrollSettings, now float64) float64 {
	dt := now - a.last
	a.last = now
	rate := 0.0 // a pause means a new scroll gesture: start from the slow end again
	if dt <= 0.3 {
		rate = 1 / math.Max(dt, 0.005)
	}
	t := clamp((rate-slowRate)/(fastRate-slowRate), 0, 1)
	return s.Speed * (1 + s.Acceleration*maxBoost*t)
}

// scales returns the vertical and horizontal multipliers for a tick arriving at `now`.
// Invert only affects the vertical axis.
func (a *ScrollAdjuster) scales(s ScrollSettings, now float64) (vertical, horizontal float64) {
	speed := a.factor(s, now)
	if s.Invert {
		return -speed, speed
	}
	return speed, speed
}

// ---- Smoother ------------------------------------------------------------------------------------------------

// Smoother turns discrete wheel ticks into a stream of small steps that glides to a stop. Each frame delivers
// a fixed fraction of what is still pending (exponential ease-out), so the distance travelled is exactly what
// the ticks asked for; remainders below one unit are carried from frame to frame.
//
// Distances are in wheel units (120 per notch on Windows). FinishBelow and MaxPending are in the same unit.
type Smoother struct {
	FinishBelow float64 // once this little is left, deliver it and stop
	MaxPending  float64 // a runaway queue would keep scrolling long after the wheel stops

	pendX, pendY   float64
	carryX, carryY float64
}

func NewSmoother() *Smoother { return &Smoother{FinishBelow: 1, MaxPending: 6000} }

func (s *Smoother) Animating() bool { return s.pendX != 0 || s.pendY != 0 }

// smoothingTau is the time constant in seconds: 0.015 s (barely there) ... 0.1 s (about half a second to rest).
func smoothingTau(smoothing float64) float64 { return 0.015 + 0.085*clamp(smoothing, 0, 1) }

// Add queues distance. A tick against the direction still in flight cancels the old distance in that axis, so
// reversing the wheel takes effect at once instead of after the glide.
func (s *Smoother) Add(dx, dy float64) {
	s.pendX = s.merged(s.pendX, dx)
	s.pendY = s.merged(s.pendY, dy)
}

func (s *Smoother) merged(pending, added float64) float64 {
	if added == 0 {
		return pending
	}
	base := pending
	if pending != 0 && (pending < 0) != (added < 0) {
		base = 0
	}
	return clamp(base+added, -s.MaxPending, s.MaxPending)
}

func (s *Smoother) advance(pending, carry *float64, fraction float64) int {
	due := *pending * fraction
	rest := *pending - due
	if math.Abs(rest) < s.FinishBelow { // final step: hand over everything that is left
		due = *pending
		rest = 0
	}
	*pending = rest
	total := due + *carry
	if rest == 0 {
		*carry = 0
		return int(math.Round(total))
	}
	whole := math.Trunc(total)
	*carry = total - whole
	return int(whole)
}

// Step advances the glide by dt seconds and returns the whole-unit deltas to emit now.
func (s *Smoother) Step(dt, smoothing float64) (dx, dy int) {
	fraction := 1 - math.Exp(-math.Max(0, dt)/smoothingTau(smoothing))
	dx = s.advance(&s.pendX, &s.carryX, fraction)
	dy = s.advance(&s.pendY, &s.carryY, fraction)
	return dx, dy
}

// Flush delivers everything still pending at once (smoothing switched off, ...).
func (s *Smoother) Flush() (dx, dy int) {
	dx = int(math.Round(s.pendX + s.carryX))
	dy = int(math.Round(s.pendY + s.carryY))
	s.pendX, s.pendY, s.carryX, s.carryY = 0, 0, 0, 0
	return dx, dy
}
