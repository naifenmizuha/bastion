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

func ValidateEventType(value EventType) error {
	if value < EventTypeOther || value > EventTypeSteal {
		return fmt.Errorf("invalid --event-type %d, expected 0-10", value)
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

func ValidateOuts(value int) error {
	if value < 0 || value > 2 {
		return fmt.Errorf("invalid --outs %d, expected 0, 1, or 2", value)
	}
	return nil
}

func ValidateBaseState(value int) error {
	if value < 0 || value > 7 {
		return fmt.Errorf("invalid --base-state %d, expected 0-7", value)
	}
	return nil
}
