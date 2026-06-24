package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"bastion/internal/domain/report"
)

func (s *Store) UpsertReport(r report.Report) error {
	_, err := s.db.Exec(`
INSERT INTO training_reports (name, date, content, reflection)
VALUES (?, ?, ?, ?)
ON CONFLICT(name, date) DO UPDATE SET
	content = excluded.content,
	reflection = excluded.reflection
`, r.Name, r.Date, r.Content, r.Reflection)
	return err
}

func (s *Store) GetReport(name string, date string) (report.Report, error) {
	var r report.Report
	err := s.db.QueryRow(`
SELECT name, date, content, reflection
FROM training_reports
WHERE name = ? AND date = ?
`, name, date).Scan(&r.Name, &r.Date, &r.Content, &r.Reflection)
	if errors.Is(err, sql.ErrNoRows) {
		return report.Report{}, fmt.Errorf("report not found: %s %s", name, date)
	}
	if err != nil {
		return report.Report{}, err
	}
	return r, nil
}
