package drill

import "fmt"

func ValidateDrillType(value DrillType) error {
	if value < DrillTypePitching || value > DrillTypeOutfield {
		return fmt.Errorf("invalid --type %d, expected 0-6", value)
	}
	return nil
}

func ValidateReviewStatus(value ReviewStatus) error {
	if value < ReviewStatusPending || value > ReviewStatusRejected {
		return fmt.Errorf("invalid --status %d, expected 0-2", value)
	}
	return nil
}
