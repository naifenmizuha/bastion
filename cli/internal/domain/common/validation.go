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
