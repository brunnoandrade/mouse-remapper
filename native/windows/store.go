package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type fileStamp struct {
	mod  time.Time
	size int64
}

// Store keeps the parsed config and follows the file on disk. It mirrors the macOS helper's ConfigStore:
//   - a missing file is created with the defaults;
//   - a file that exists but cannot be read or parsed (for instance caught halfway through a write) is never
//     overwritten: the previous config stays in effect and the read is retried;
//   - a change is picked up once the file has stopped changing, so a write in progress has time to finish.
type Store struct {
	path string

	mu       sync.Mutex
	cfg      Config
	loaded   fileStamp
	hasStamp bool
	pending  fileStamp
	hasPend  bool
	attempts int
}

const maxReloadAttempts = 20

func NewStore(path string) *Store { return &Store{path: path, cfg: defaultConfig()} }

func (s *Store) Config() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

func stampOf(path string) (fileStamp, error) {
	info, err := os.Stat(path)
	if err != nil {
		return fileStamp{}, err
	}
	return fileStamp{mod: info.ModTime(), size: info.Size()}, nil
}

// Load reads the file now. A missing file is created with the defaults.
func (s *Store) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() error {
	stamp, err := stampOf(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.cfg = defaultConfig()
		if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err == nil {
			if data, err := json.MarshalIndent(s.cfg, "", "  "); err == nil {
				_ = os.WriteFile(s.path, data, 0o644)
			}
		}
		s.markLoaded()
		return nil
	}
	if err != nil {
		return err
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return errors.New("config file is empty")
	}
	cfg, err := parseConfig(data)
	if err != nil {
		return err
	}
	s.cfg = cfg
	s.loaded, s.hasStamp = stamp, true
	s.hasPend, s.attempts = false, 0
	return nil
}

func (s *Store) markLoaded() {
	if stamp, err := stampOf(s.path); err == nil {
		s.loaded, s.hasStamp = stamp, true
	}
	s.hasPend, s.attempts = false, 0
}

// Poll is meant to be called every ~100 ms. It reports whether a new config was loaded.
func (s *Store) Poll() (changed bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	stamp, statErr := stampOf(s.path)
	if statErr != nil { // deleted: bring the defaults back, like on first run
		if errors.Is(statErr, os.ErrNotExist) {
			return true, s.loadLocked()
		}
		return false, statErr
	}
	if s.hasStamp && stamp == s.loaded {
		s.hasPend = false
		return false, nil
	}
	// Changed. Wait until it has stayed the same for one more poll before reading.
	if !s.hasPend || s.pending != stamp {
		s.pending, s.hasPend, s.attempts = stamp, true, 0
		return false, nil
	}
	if err := s.loadLocked(); err != nil {
		s.attempts++
		if s.attempts >= maxReloadAttempts { // give up until the file changes again
			s.loaded, s.hasStamp, s.hasPend = stamp, true, false
		}
		return false, err
	}
	return true, nil
}
