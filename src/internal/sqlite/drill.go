package sqlite

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"bastion/internal/domain/drill"
)

func (s *Store) CreateRecommendation(r drill.Recommendation) (int64, error) {
	createdAt := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
INSERT INTO drill_recommendations (name, url, reason, type, summary, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
`, r.Name, r.URL, r.Reason, int(r.Type), r.Summary, int(drill.StatusPending), createdAt)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) ListRecommendations(filter drill.ListFilter) ([]drill.Recommendation, error) {
	query := `SELECT id, name, url, reason, type, summary, status, reviewed_by, reviewed_at, created_at FROM drill_recommendations`
	var conditions []string
	var args []any
	if filter.Name != "" {
		conditions = append(conditions, "name = ?")
		args = append(args, filter.Name)
	}
	if filter.Type != nil {
		conditions = append(conditions, "type = ?")
		args = append(args, int(*filter.Type))
	}
	if filter.Status != nil {
		conditions = append(conditions, "status = ?")
		args = append(args, int(*filter.Status))
	}
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY created_at DESC, id DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var recommendations []drill.Recommendation
	for rows.Next() {
		var (
			r          drill.Recommendation
			status     int
			reviewedBy sql.NullString
			reviewedAt sql.NullString
		)
		if err := rows.Scan(&r.ID, &r.Name, &r.URL, &r.Reason, &r.Type, &r.Summary, &status, &reviewedBy, &reviewedAt, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Status = drill.RecommendationStatus(status)
		r.ReviewedBy = reviewedBy.String
		r.ReviewedAt = reviewedAt.String
		recommendations = append(recommendations, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return recommendations, nil
}

// ReviewRecommendation 把指定推荐置为目标状态，写入审批人与审批时间；推荐不存在时返回 not found 错误。
func (s *Store) ReviewRecommendation(id int64, status drill.RecommendationStatus, reviewer string) error {
	return s.withTx(func(tx *sql.Tx) error {
		var exists bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM drill_recommendations WHERE id = ?)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("drill recommendation not found: %d", id)
		}
		reviewedAt := time.Now().UTC().Format(time.RFC3339)
		var reviewerArg any
		if reviewer == "" {
			reviewerArg = nil
		} else {
			reviewerArg = reviewer
		}
		_, err := tx.Exec(`
UPDATE drill_recommendations
SET status = ?, reviewed_by = ?, reviewed_at = ?
WHERE id = ?
`, int(status), reviewerArg, reviewedAt, id)
		return err
	})
}
