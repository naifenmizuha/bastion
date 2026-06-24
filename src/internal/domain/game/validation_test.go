package game

import "testing"

func TestGameValidationHelpers(t *testing.T) {
	if err := ValidateBattingSide(BattingSideTop); err != nil {
		t.Fatalf("ValidateBattingSide failed: %v", err)
	}
	if err := ValidateHalf(HalfBottom); err != nil {
		t.Fatalf("ValidateHalf failed: %v", err)
	}
	if err := ValidateEventType(EventTypeSteal); err != nil {
		t.Fatalf("ValidateEventType failed: %v", err)
	}
	if err := ValidateBaseState(7); err != nil {
		t.Fatalf("ValidateBaseState failed: %v", err)
	}
	if err := ValidateOuts(2); err != nil {
		t.Fatalf("ValidateOuts failed: %v", err)
	}
}

func TestGameValidationHelpersRejectInvalidValues(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{name: "batting side", err: ValidateBattingSide(2)},
		{name: "half", err: ValidateHalf(2)},
		{name: "event type", err: ValidateEventType(11)},
		{name: "base state", err: ValidateBaseState(8)},
		{name: "outs", err: ValidateOuts(3)},
	}

	for _, tc := range cases {
		if tc.err == nil {
			t.Fatalf("expected %s to fail", tc.name)
		}
	}
}
