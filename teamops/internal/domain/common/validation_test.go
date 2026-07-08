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

func TestNormalizeDateRejectsInvalidFormat(t *testing.T) {
	_, err := NormalizeDate("2026-6-24")
	if err == nil {
		t.Fatal("expected invalid date to fail")
	}
	if !strings.Contains(err.Error(), "expected YYYY-MM-DD") {
		t.Fatalf("unexpected error: %v", err)
	}
}
