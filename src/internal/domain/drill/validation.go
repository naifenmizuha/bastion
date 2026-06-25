package drill

import "fmt"

func ValidateDrillType(value DrillType) error {
	if value < DrillTypePitching || value > DrillTypeOutfield {
		return fmt.Errorf("invalid --type %d, expected 0-6", value)
	}
	return nil
}
