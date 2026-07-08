package lineup

import (
	"fmt"
	"sort"
	"strings"

	"teamops/internal/domain/player"
)

var positionNames = map[int]string{
	1: "P",
	2: "C",
	3: "1B",
	4: "2B",
	5: "3B",
	6: "SS",
	7: "LF",
	8: "CF",
	9: "RF",
}

// ParsePosition 将标准守备缩写转换为棒球守备编号。
func ParsePosition(raw string) (int, error) {
	value := strings.ToUpper(strings.TrimSpace(raw))
	for number, name := range positionNames {
		if value == name {
			return number, nil
		}
	}
	return 0, fmt.Errorf("invalid position %q, expected one of: P,C,1B,2B,3B,SS,LF,CF,RF", raw)
}

// FormatPosition 将棒球守备编号转换为标准缩写。
func FormatPosition(position int) string {
	return positionNames[position]
}

// ParsePitchingRole 将 JSON 角色名称转换为领域枚举。
func ParsePitchingRole(raw string) (PitchingRole, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "starter":
		return PitchingRoleStarter, nil
	case "reliever":
		return PitchingRoleReliever, nil
	default:
		return 0, fmt.Errorf("invalid pitching role %q, expected starter or reliever", raw)
	}
}

// FormatPitchingRole 将投手角色转换为 JSON 名称。
func FormatPitchingRole(role PitchingRole) string {
	if role == PitchingRoleStarter {
		return "starter"
	}
	return "reliever"
}

// FormatStatus 将方案状态转换为稳定名称。
func FormatStatus(status Status) string {
	switch status {
	case StatusValidated:
		return "validated"
	case StatusAccepted:
		return "accepted"
	case StatusRejected:
		return "rejected"
	case StatusSuperseded:
		return "superseded"
	default:
		return "unknown"
	}
}

// ParseStatus 将筛选状态转换为领域枚举。
func ParseStatus(raw string) (Status, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "validated":
		return StatusValidated, nil
	case "accepted":
		return StatusAccepted, nil
	case "rejected":
		return StatusRejected, nil
	case "superseded":
		return StatusSuperseded, nil
	default:
		return 0, fmt.Errorf("invalid status %q, expected validated,accepted,rejected,superseded", raw)
	}
}

func eligibleForPosition(positions player.Position, position int) bool {
	switch position {
	case 1:
		return positions&player.PositionPitcher != 0
	case 2:
		return positions&player.PositionCatcher != 0
	case 3:
		return positions&player.PositionFirstBase != 0
	case 4:
		return positions&player.PositionSecondBase != 0
	case 5:
		return positions&player.PositionThirdBase != 0
	case 6:
		return positions&player.PositionShortstop != 0
	case 7, 8, 9:
		return positions&player.PositionOutfield != 0
	default:
		return false
	}
}

func allowedPositionNames(positions player.Position) []string {
	values := []string{}
	for position := 1; position <= 9; position++ {
		if eligibleForPosition(positions, position) {
			values = append(values, FormatPosition(position))
		}
	}
	return values
}

func sortIssues(issues []Issue) {
	sort.SliceStable(issues, func(i, j int) bool {
		if issues[i].Field != issues[j].Field {
			return issues[i].Field < issues[j].Field
		}
		return issues[i].Code < issues[j].Code
	})
}
