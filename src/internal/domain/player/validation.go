package player

import (
	"fmt"
	"strings"
)

const allHands = HandLeft | HandRight
const allPositions = PositionPitcher | PositionCatcher | PositionInfield | PositionOutfield

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
	{label: "infield", flag: PositionInfield},
	{label: "outfield", flag: PositionOutfield},
}

func ParseHands(raw string) (Hand, error) {
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

func ParsePositions(raw string) (Position, error) {
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

func HandFromBits(bits int64) (Hand, error) {
	if bits <= 0 || bits&^int64(allHands) != 0 {
		return 0, fmt.Errorf("invalid hand bits: %d", bits)
	}
	return Hand(bits), nil
}

func PositionFromBits(bits int64) (Position, error) {
	if bits <= 0 || bits&^int64(allPositions) != 0 {
		return 0, fmt.Errorf("invalid position bits: %d", bits)
	}
	return Position(bits), nil
}

func FormatHands(hands Hand) string {
	labels := make([]string, 0, len(handOptions))
	for _, option := range handOptions {
		if hands&option.flag != 0 {
			labels = append(labels, option.label)
		}
	}
	return strings.Join(labels, ",")
}

func FormatPositions(positions Position) string {
	labels := make([]string, 0, len(positionOptions))
	for _, option := range positionOptions {
		if positions&option.flag != 0 {
			labels = append(labels, option.label)
		}
	}
	return strings.Join(labels, ",")
}

func handLabels() string {
	labels := make([]string, 0, len(handOptions))
	for _, option := range handOptions {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}

func positionLabels() string {
	labels := make([]string, 0, len(positionOptions))
	for _, option := range positionOptions {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}
