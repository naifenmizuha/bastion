package common

import (
	"fmt"
	"strings"
	"time"
)

// NormalizeDate 清理并校验 YYYY-MM-DD 格式的日期输入。
func NormalizeDate(raw string) (string, error) {
	date := strings.TrimSpace(raw)
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil || parsed.Format("2006-01-02") != date {
		return "", fmt.Errorf("invalid --date %q, expected YYYY-MM-DD", raw)
	}
	return date, nil
}

// NormalizeTime accepts an empty value or a strict 24-hour HH:MM value.
func NormalizeTime(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", nil
	}
	parsed, err := time.Parse("15:04", value)
	if err != nil || parsed.Format("15:04") != value {
		return "", fmt.Errorf("invalid time %q, expected HH:MM in 00:00-23:59", raw)
	}
	return value, nil
}
