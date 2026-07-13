package common

import (
	"strings"
	"testing"
)

func TestNormalizeDate(t *testing.T) {
	got, err := NormalizeDate(" 2026-06-24 ")
	if err != nil {
		t.Fatalf("NormalizeDate failed: %v", err)
	}
	if got != "2026-06-24" {
		t.Fatalf("unexpected date: %q", got)
	}
}

func TestNormalizeTime(t *testing.T) {
	for _, value := range []string{"", "00:00", "01:05", "23:59"} {
		if got, err := NormalizeTime(value); err != nil || got != value {
			t.Fatalf("NormalizeTime(%q)=%q,%v", value, got, err)
		}
	}
	for _, value := range []string{"638", "24:00", "12:60", "1:05"} {
		if _, err := NormalizeTime(value); err == nil {
			t.Fatalf("NormalizeTime(%q) should fail", value)
		}
	}
}

func TestNormalizeDateRejectsInvalidFormat(t *testing.T) {
	_, err := NormalizeDate("2026-6-24")
	if err == nil {
		t.Fatal("expected invalid date to fail")
	}
	if !strings.Contains(err.Error(), "expected YYYY-MM-DD") {
		t.Fatalf("unexpected error: %v", err)
	}
}
