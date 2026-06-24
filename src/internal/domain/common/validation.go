package common

import (
	"fmt"
	"strings"
	"time"
)

func NormalizeDate(raw string) (string, error) {
	date := strings.TrimSpace(raw)
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil || parsed.Format("2006-01-02") != date {
		return "", fmt.Errorf("invalid --date %q, expected YYYY-MM-DD", raw)
	}
	return date, nil
}
