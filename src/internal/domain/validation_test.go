package domain

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

func TestParseHands(t *testing.T) {
	got, err := ParseHands(" Right, left,RIGHT ")
	if err != nil {
		t.Fatalf("ParseHands failed: %v", err)
	}
	if got != HandRight|HandLeft {
		t.Fatalf("unexpected hands: %q", got)
	}
	if FormatHands(got) != "left,right" {
		t.Fatalf("unexpected formatted hands: %q", FormatHands(got))
	}
}

func TestParseHandsRejectsInvalidValue(t *testing.T) {
	_, err := ParseHands("switch")
	if err == nil {
		t.Fatal("expected invalid hand to fail")
	}
	if !strings.Contains(err.Error(), "unsupported value") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestParsePositions(t *testing.T) {
	got, err := ParsePositions(" pitcher, infield,pitcher ")
	if err != nil {
		t.Fatalf("ParsePositions failed: %v", err)
	}
	if got != PositionPitcher|PositionInfield {
		t.Fatalf("unexpected positions: %q", got)
	}
	if FormatPositions(got) != "pitcher,infield" {
		t.Fatalf("unexpected formatted positions: %q", FormatPositions(got))
	}
}

func TestParsePositionsRejectsInvalidValue(t *testing.T) {
	_, err := ParsePositions("bench")
	if err == nil {
		t.Fatal("expected invalid position to fail")
	}
	if !strings.Contains(err.Error(), "unsupported value") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestHandFromBitsRejectsInvalidBits(t *testing.T) {
	_, err := HandFromBits(4)
	if err == nil {
		t.Fatal("expected invalid hand bits to fail")
	}
}

func TestPositionFromBitsRejectsInvalidBits(t *testing.T) {
	_, err := PositionFromBits(16)
	if err == nil {
		t.Fatal("expected invalid position bits to fail")
	}
}
