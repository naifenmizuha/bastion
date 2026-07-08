package game

import "testing"

func TestGameValidationHelpers(t *testing.T) {
	if err := ValidateBattingSide(BattingSideTop); err != nil {
		t.Fatalf("ValidateBattingSide failed: %v", err)
	}
	if err := ValidateHalf(HalfBottom); err != nil {
		t.Fatalf("ValidateHalf failed: %v", err)
	}
	if err := ValidateEventKind(EventKindFieldingCredit); err != nil {
		t.Fatalf("ValidateEventKind failed: %v", err)
	}
	if err := ValidateResult(EventKindPlateResult, int(PlateResultOther)); err != nil {
		t.Fatalf("ValidateResult plate failed: %v", err)
	}
	if err := ValidateResult(EventKindRunnerMovement, int(RunnerResultOut)); err != nil {
		t.Fatalf("ValidateResult runner failed: %v", err)
	}
	if err := ValidateResult(EventKindFieldingCredit, int(FieldingResultOther)); err != nil {
		t.Fatalf("ValidateResult fielding failed: %v", err)
	}
	if err := ValidateRunnerReason(RunnerReasonOther); err != nil {
		t.Fatalf("ValidateRunnerReason failed: %v", err)
	}
	if err := ValidateBaseFrom(intPtr(3)); err != nil {
		t.Fatalf("ValidateBaseFrom failed: %v", err)
	}
	if err := ValidateBaseTo(intPtr(4)); err != nil {
		t.Fatalf("ValidateBaseTo failed: %v", err)
	}
}

func TestGameValidationHelpersRejectInvalidValues(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{name: "batting side", err: ValidateBattingSide(2)},
		{name: "half", err: ValidateHalf(2)},
		{name: "event kind", err: ValidateEventKind(3)},
		{name: "plate result", err: ValidateResult(EventKindPlateResult, 13)},
		{name: "runner result", err: ValidateResult(EventKindRunnerMovement, 3)},
		{name: "fielding result", err: ValidateResult(EventKindFieldingCredit, 7)},
		{name: "runner reason", err: ValidateRunnerReason(10)},
		{name: "play no", err: ValidatePlayNo(intPtr(0))},
		{name: "base from", err: ValidateBaseFrom(intPtr(4))},
		{name: "base to", err: ValidateBaseTo(intPtr(0))},
	}

	for _, tc := range cases {
		if tc.err == nil {
			t.Fatalf("expected %s to fail", tc.name)
		}
	}
}
