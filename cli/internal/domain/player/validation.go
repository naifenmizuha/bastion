package player

import (
	"fmt"
	"strings"
)

const allHands = HandLeft | HandRight
const allPositions = PositionPitcher | PositionCatcher | PositionFirstBase | PositionSecondBase | PositionThirdBase | PositionShortstop | PositionOutfield

type handOption struct {
	label string
	flag  Hand
}

type positionOption struct {
	label string
	flag  Position
}

var handOptions = []handOption{
	{label: "left", flag: HandLeft},
	{label: "right", flag: HandRight},
}

var positionOptions = []positionOption{
	{label: "pitcher", flag: PositionPitcher},
	{label: "catcher", flag: PositionCatcher},
	{label: "first_base", flag: PositionFirstBase},
	{label: "second_base", flag: PositionSecondBase},
	{label: "third_base", flag: PositionThirdBase},
	{label: "shortstop", flag: PositionShortstop},
	{label: "outfield", flag: PositionOutfield},
}

// ParseHands 将逗号分隔的左右打击/投球习惯转换为位标记。
func ParseHands(raw string) (Hand, error) {
	// 先按标签建立查找表，再合并用户给出的多个选项。
	lookup := map[string]Hand{}
	for _, option := range handOptions {
		lookup[option.label] = option.flag
	}

	var hands Hand
	for _, part := range strings.Split(raw, ",") {
		value := strings.ToLower(strings.TrimSpace(part))
		if value == "" {
			continue
		}
		flag, ok := lookup[value]
		if !ok {
			return 0, fmt.Errorf("unsupported value %q, allowed values: %s", value, handLabels())
		}
		hands |= flag
	}
	if hands == 0 {
		return 0, fmt.Errorf("at least one value is required, allowed values: %s", handLabels())
	}
	return hands, nil
}

// ParsePositions 将逗号分隔的守备位置转换为位标记。
func ParsePositions(raw string) (Position, error) {
	// 位置可多选，循环累计每个合法位置的标记。
	lookup := map[string]Position{}
	for _, option := range positionOptions {
		lookup[option.label] = option.flag
	}

	var positions Position
	for _, part := range strings.Split(raw, ",") {
		value := strings.ToLower(strings.TrimSpace(part))
		if value == "" {
			continue
		}
		flag, ok := lookup[value]
		if !ok {
			return 0, fmt.Errorf("unsupported value %q, allowed values: %s", value, positionLabels())
		}
		positions |= flag
	}
	if positions == 0 {
		return 0, fmt.Errorf("at least one value is required, allowed values: %s", positionLabels())
	}
	return positions, nil
}

// HandFromBits 校验并还原数据库中存储的左右手位标记。
func HandFromBits(bits int64) (Hand, error) {
	if bits <= 0 || bits&^int64(allHands) != 0 {
		return 0, fmt.Errorf("invalid hand bits: %d", bits)
	}
	return Hand(bits), nil
}

// PositionFromBits 校验并还原数据库中存储的位置位标记。
func PositionFromBits(bits int64) (Position, error) {
	if bits <= 0 || bits&^int64(allPositions) != 0 {
		return 0, fmt.Errorf("invalid position bits: %d", bits)
	}
	return Position(bits), nil
}

// FormatHands 将左右手位标记转为面向用户的逗号分隔文本。
func FormatHands(hands Hand) string {
	labels := make([]string, 0, len(handOptions))
	for _, option := range handOptions {
		if hands&option.flag != 0 {
			labels = append(labels, option.label)
		}
	}
	return strings.Join(labels, ",")
}

// FormatPositions 将位置位标记转为面向用户的逗号分隔文本。
func FormatPositions(positions Position) string {
	labels := make([]string, 0, len(positionOptions))
	for _, option := range positionOptions {
		if positions&option.flag != 0 {
			labels = append(labels, option.label)
		}
	}
	return strings.Join(labels, ",")
}

// handLabels 返回所有合法左右手选项，用于错误提示。
func handLabels() string {
	labels := make([]string, 0, len(handOptions))
	for _, option := range handOptions {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}

// positionLabels 返回所有合法位置选项，用于错误提示。
func positionLabels() string {
	labels := make([]string, 0, len(positionOptions))
	for _, option := range positionOptions {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}
