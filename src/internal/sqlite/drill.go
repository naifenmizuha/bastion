package sqlite

import (
	"strings"
	"time"

	"bastion/internal/domain/drill"
)

func (s *Store) CreateRecommendation(r drill.Recommendation) (int64, error) {
	createdAt := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
INSERT INTO drill_recommendations (name, url, reason, type, summary, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`, r.Name, r.URL, r.Reason, int(r.Type), r.Summary, createdAt)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) ListRecommendations(filter drill.ListFilter) ([]drill.Recommendation, error) {
	query := `SELECT id, name, url, reason, type, summary, created_at FROM drill_recommendations`
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
		var r drill.Recommendation
		if err := rows.Scan(&r.ID, &r.Name, &r.URL, &r.Reason, &r.Type, &r.Summary, &r.CreatedAt); err != nil {
			return nil, err
		}
		recommendations = append(recommendations, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return recommendations, nil
}
