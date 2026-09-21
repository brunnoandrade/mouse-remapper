package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func cfgWith(button int) string {
	return fmt.Sprintf(`{"defaultProfile":{"enabled":true,"mappings":[{"id":"x","enabled":true,"trigger":{"type":"button","button":%d},"action":{"type":"system","id":"mute"}}]},"appProfiles":{}}`, button)
}

func hasButton(c Config, b int) bool {
	_, ok := c.findMapping("", func(m Mapping) bool { return intPtrEq(m.Trigger.Button, b) })
	return ok
}

// settle polls until the store has noticed (or given up on) the latest write, like the real 100 ms poller would.
func settle(t *testing.T, s *Store) {
	t.Helper()
	for n := 0; n < 40; n++ {
		s.Poll()
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStoreCreatesDefaultsOnlyWhenTheFileIsMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "config.json")
	s := NewStore(path)
	if err := s.Load(); err != nil {
		t.Fatalf("load: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 {
		t.Fatalf("defaults must be written (in a directory created on demand): %v", err)
	}
	if _, err := parseConfig(data); err != nil {
		t.Errorf("the written defaults must parse: %v", err)
	}
}

func TestStoreNeverOverwritesAnUnreadableFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	write(t, path, `{ this is not json`)
	s := NewStore(path)
	if err := s.Load(); err == nil {
		t.Error("an unreadable file must be reported")
	}
	got, _ := os.ReadFile(path)
	expect(t, "startup with a corrupt file leaves it untouched", string(got), `{ this is not json`)
	expect(t, "and the defaults are used in memory", s.Config().ScrollThreshold, 4.0)

	write(t, path, ``)
	if err := s.Load(); err == nil {
		t.Error("an empty file (caught mid-write) is unreadable, not 'no mappings'")
	}
	got, _ = os.ReadFile(path)
	expect(t, "an empty file is not overwritten either", string(got), ``)
}

func TestStoreKeepsThePreviousConfigWhileTheFileIsBroken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	write(t, path, cfgWith(7))
	s := NewStore(path)
	s.Load()
	expect(t, "loaded", hasButton(s.Config(), 7), true)

	write(t, path, `{ broken`)
	settle(t, s)
	expect(t, "corrupt file in flight: previous config still active", hasButton(s.Config(), 7), true)
	got, _ := os.ReadFile(path)
	expect(t, "corrupt file in flight: not overwritten", string(got), `{ broken`)

	write(t, path, cfgWith(8))
	settle(t, s)
	expect(t, "fixed file: picked up", hasButton(s.Config(), 8), true)
	expect(t, "fixed file: old mapping gone", hasButton(s.Config(), 7), false)
}

func TestStoreConvergesOnTheLastWriteAfterABurst(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	write(t, path, cfgWith(9))
	s := NewStore(path)
	s.Load()
	for n := 0; n < 30; n++ {
		write(t, path, cfgWith(9))
		s.Poll()
	}
	write(t, path, cfgWith(7))
	settle(t, s)
	expect(t, "the burst ends on the last version", hasButton(s.Config(), 7), true)
	expect(t, "and not on an earlier one", hasButton(s.Config(), 9), false)
}

func TestStoreWaitsForTheFileToStopChanging(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	write(t, path, cfgWith(9))
	s := NewStore(path)
	s.Load()
	write(t, path, cfgWith(7))
	if changed, _ := s.Poll(); changed {
		t.Error("the first poll after a change must wait (the write may still be in progress)")
	}
	if changed, _ := s.Poll(); !changed {
		t.Error("the second poll, with the file unchanged, must load it")
	}
}

func TestStoreFollowsAnAtomicReplace(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	write(t, path, cfgWith(7))
	s := NewStore(path)
	s.Load()
	tmp := filepath.Join(dir, "config.json.new")
	write(t, tmp, cfgWith(8))
	// make sure the replacement is distinguishable by its modification time as well as its size
	future := time.Now().Add(2 * time.Second)
	os.Chtimes(tmp, future, future)
	if err := os.Rename(tmp, path); err != nil {
		t.Fatal(err)
	}
	settle(t, s)
	expect(t, "replaced file is picked up", hasButton(s.Config(), 8), true)
}

func TestStoreRecreatesADeletedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	write(t, path, cfgWith(7))
	s := NewStore(path)
	s.Load()
	os.Remove(path)
	settle(t, s)
	if _, err := os.Stat(path); err != nil {
		t.Errorf("a deleted config comes back with the defaults: %v", err)
	}
	expect(t, "defaults are in effect", hasButton(s.Config(), 7), false)
}

func TestStoreGivesUpOnAPermanentlyBrokenFileUntilItChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	write(t, path, cfgWith(7))
	s := NewStore(path)
	s.Load()
	write(t, path, `{ broken`)
	errs := 0
	for n := 0; n < 200; n++ {
		if _, err := s.Poll(); err != nil {
			errs++
		}
	}
	if errs > maxReloadAttempts+1 {
		t.Errorf("kept retrying a corrupt file %d times", errs)
	}
	write(t, path, cfgWith(8)) // a new write must be noticed even after giving up
	settle(t, s)
	expect(t, "recovers when the file changes again", hasButton(s.Config(), 8), true)
}

// On Windows the modification time is coarse: a rewrite that keeps the size can carry the very same timestamp.
// The store must still notice it, so it compares content.
func TestStoreNoticesARewriteWithTheSameSizeAndModificationTime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	stamp := time.Now().Add(-time.Hour)
	write(t, path, cfgWith(9))
	os.Chtimes(path, stamp, stamp)
	s := NewStore(path)
	s.Load()

	write(t, path, cfgWith(7)) // same length, different content
	os.Chtimes(path, stamp, stamp)
	settle(t, s)
	expect(t, "the change is picked up", hasButton(s.Config(), 7), true)
	expect(t, "and the old mapping is gone", hasButton(s.Config(), 9), false)
}
