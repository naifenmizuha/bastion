package game

import "fmt"

func ValidateBattingSide(value BattingSide) error {
	if value != BattingSideTop && value != BattingSideBottom {
		return fmt.Errorf("invalid --batting-side %d, expected 0 or 1", value)
	}
	return nil
}

func ValidateTeam(value Team) error {
	if value != TeamOwn && value != TeamOpponent {
		return fmt.Errorf("invalid --team %d, expected 0 or 1", value)
	}
	return nil
}

func ValidateHalf(value Half) error {
	if value != HalfTop && value != HalfBottom {
		return fmt.Errorf("invalid --half %d, expected 0 or 1", value)
	}
	return nil
}

func ValidateEventKind(value EventKind) error {
	if value < EventKindPlateResult || value > EventKindFieldingCredit {
		return fmt.Errorf("invalid --event-kind %d, expected 0-2", value)
	}
	return nil
}

func ValidateResult(kind EventKind, value int) error {
	switch kind {
	case EventKindPlateResult:
		if value < int(PlateResultSingle) || value > int(PlateResultOther) {
			return fmt.Errorf("invalid --result %d for plate_result, expected 0-12", value)
		}
	case EventKindRunnerMovement:
		if value < int(RunnerResultAdvance) || value > int(RunnerResultOut) {
			return fmt.Errorf("invalid --result %d for runner_movement, expected 0-2", value)
		}
	case EventKindFieldingCredit:
		if value < int(FieldingResultPutout) || value > int(FieldingResultOther) {
			return fmt.Errorf("invalid --result %d for fielding_credit, expected 0-6", value)
		}
	default:
		return ValidateEventKind(kind)
	}
	return nil
}

func ValidateRunnerReason(value RunnerReason) error {
	if value < RunnerReasonBattedBall || value > RunnerReasonOther {
		return fmt.Errorf("invalid --reason %d, expected 0-9", value)
	}
	return nil
}

func ValidateGameResult(value GameResult) error {
	if value < GameResultWin || value > GameResultInProgress {
		return fmt.Errorf("invalid game result %d, expected 0-3", value)
	}
	return nil
}

func ValidateBattingOrder(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 9 {
		return fmt.Errorf("invalid --batting-order %d, expected 1-9", *value)
	}
	return nil
}

func ValidateStartingPosition(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 9 {
		return fmt.Errorf("invalid --starting-position %d, expected 1-9", *value)
	}
	return nil
}

func ValidatePlayNo(value *int) error {
	if value == nil {
		return nil
	}
	if *value <= 0 {
		return fmt.Errorf("invalid --play-no %d, expected greater than 0", *value)
	}
	return nil
}

func ValidateBaseFrom(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 0 || *value > 3 {
		return fmt.Errorf("invalid --base-from %d, expected 0-3", *value)
	}
	return nil
}

func ValidateBaseTo(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 4 {
		return fmt.Errorf("invalid --base-to %d, expected 1-4", *value)
	}
	return nil
}
