package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"teamops/internal/domain/report"
)

// UpsertReport 按球员和日期新建或覆盖训练报告。
func (s *Store) UpsertReport(r report.Report) error {
	_, err := s.db.Exec(`
INSERT INTO training_reports (player_id, name, date, content, reflection, updated_at)
VALUES ((SELECT p.id FROM players p JOIN app_config c ON c.own_team_id=p.team_id WHERE c.id=1 AND p.name=?), ?, ?, ?, ?, ?)
ON CONFLICT(name, date) DO UPDATE SET
	content = excluded.content,
	reflection = excluded.reflection,
	updated_at = excluded.updated_at
`, r.Name, r.Name, r.Date, r.Content, r.Reflection, nowTimestamp())
	return err
}

// GetReport 查询单日训练报告，并统一返回未找到错误。
func (s *Store) GetReport(name string, date string) (report.Report, error) {
	var r report.Report
	err := s.db.QueryRow(`
SELECT id, COALESCE(player_id,0), name, date, content, reflection, updated_at
FROM training_reports
WHERE name = ? AND date = ?
`, name, date).Scan(&r.ID, &r.PlayerID, &r.Name, &r.Date, &r.Content, &r.Reflection, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return report.Report{}, fmt.Errorf("report not found: %s %s", name, date)
	}
	if err != nil {
		return report.Report{}, err
	}
	return r, nil
}
