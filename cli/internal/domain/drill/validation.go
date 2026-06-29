package drill

import "fmt"

// ValidateDrillType 确认训练类型处于已定义的枚举范围内。
func ValidateDrillType(value DrillType) error {
	if value < DrillTypePitching || value > DrillTypeOutfield {
		return fmt.Errorf("invalid --type %d, expected 0-6", value)
	}
	return nil
}

// ValidateReviewStatus 确认审核状态处于已定义的枚举范围内。
func ValidateReviewStatus(value ReviewStatus) error {
	if value < ReviewStatusPending || value > ReviewStatusRejected {
		return fmt.Errorf("invalid --status %d, expected 0-2", value)
	}
	return nil
}
