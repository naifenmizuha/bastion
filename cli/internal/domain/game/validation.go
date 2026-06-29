package game

import "fmt"

// ValidateBattingSide 校验本队先后攻枚举值。
func ValidateBattingSide(value BattingSide) error {
	if value != BattingSideTop && value != BattingSideBottom {
		return fmt.Errorf("invalid --batting-side %d, expected 0 or 1", value)
	}
	return nil
}

// ValidateTeam 校验本队或对手枚举值。
func ValidateTeam(value Team) error {
	if value != TeamOwn && value != TeamOpponent {
		return fmt.Errorf("invalid --team %d, expected 0 or 1", value)
	}
	return nil
}

// ValidateHalf 校验上半局或下半局枚举值。
func ValidateHalf(value Half) error {
	if value != HalfTop && value != HalfBottom {
		return fmt.Errorf("invalid --half %d, expected 0 or 1", value)
	}
	return nil
}

// ValidateEventKind 校验比赛事件大类。
func ValidateEventKind(value EventKind) error {
	if value < EventKindPlateResult || value > EventKindFieldingCredit {
		return fmt.Errorf("invalid --event-kind %d, expected 0-2", value)
	}
	return nil
}

// ValidateResult 按事件大类校验其结果枚举的合法范围。
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

// ValidateRunnerReason 校验跑垒原因枚举值。
func ValidateRunnerReason(value RunnerReason) error {
	if value < RunnerReasonBattedBall || value > RunnerReasonOther {
		return fmt.Errorf("invalid --reason %d, expected 0-9", value)
	}
	return nil
}

// ValidateGameResult 校验比赛结果枚举值。
func ValidateGameResult(value GameResult) error {
	if value < GameResultWin || value > GameResultInProgress {
		return fmt.Errorf("invalid game result %d, expected 0-3", value)
	}
	return nil
}

// ValidateBattingOrder 校验可选打序位于一至九棒。
func ValidateBattingOrder(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 9 {
		return fmt.Errorf("invalid --batting-order %d, expected 1-9", *value)
	}
	return nil
}

// ValidateStartingPosition 校验可选首发守备编号位于一至九号。
func ValidateStartingPosition(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 9 {
		return fmt.Errorf("invalid --starting-position %d, expected 1-9", *value)
	}
	return nil
}

// ValidatePlayNo 校验可选打席编号为正数。
func ValidatePlayNo(value *int) error {
	if value == nil {
		return nil
	}
	if *value <= 0 {
		return fmt.Errorf("invalid --play-no %d, expected greater than 0", *value)
	}
	return nil
}

// ValidateBaseFrom 校验跑垒起点为本垒或一至三垒。
func ValidateBaseFrom(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 0 || *value > 3 {
		return fmt.Errorf("invalid --base-from %d, expected 0-3", *value)
	}
	return nil
}

// ValidateBaseTo 校验跑垒终点为一至四垒。
func ValidateBaseTo(value *int) error {
	if value == nil {
		return nil
	}
	if *value < 1 || *value > 4 {
		return fmt.Errorf("invalid --base-to %d, expected 1-4", *value)
	}
	return nil
}
