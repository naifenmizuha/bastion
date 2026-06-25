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
INSERT INTO drill_recommendations (name, url, reason, type, summary, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`, r.Name, r.URL, r.Reason, int(r.Type), r.Summary, createdAt)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (s *Store) ListRecommendations(filter drill.ListFilter) ([]drill.Recommendation, error) {
	query := `SELECT id, name, url, reason, type, summary, is_approved, reviewed_by, review_summary, review_note, reviewed_at, created_at FROM drill_recommendations`
	var conditions []string
	var args []any
	if filter.ID != nil {
		conditions = append(conditions, "id = ?")
		args = append(args, *filter.ID)
	}
	if filter.Name != "" {
		conditions = append(conditions, "name = ?")
		args = append(args, filter.Name)
	}
	if filter.Type != nil {
		conditions = append(conditions, "type = ?")
		args = append(args, int(*filter.Type))
	}
	if filter.Status != nil {
		switch *filter.Status {
		case drill.ReviewStatusPending:
			conditions = append(conditions, "reviewed_at IS NULL")
		case drill.ReviewStatusApproved:
			conditions = append(conditions, "is_approved = 1")
		case drill.ReviewStatusRejected:
			conditions = append(conditions, "is_approved = 0 AND reviewed_at IS NOT NULL")
		}
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
		r, err := scanRecommendation(rows)
		if err != nil {
			return nil, err
		}
		recommendations = append(recommendations, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return recommendations, nil
}

func (s *Store) GetRecommendation(id int64) (drill.Recommendation, error) {
	row := s.db.QueryRow(`
SELECT id, name, url, reason, type, summary, is_approved, reviewed_by, review_summary, review_note, reviewed_at, created_at
FROM drill_recommendations
WHERE id = ?
`, id)
	r, err := scanRecommendation(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return drill.Recommendation{}, fmt.Errorf("drill recommendation not found: %d", id)
		}
		return drill.Recommendation{}, err
	}
	return r, nil
}

func (s *Store) UpdateRecommendationReview(id int64, isApproved bool, reviewedBy string, reviewSummary string, reviewNote string) error {
	reviewedAt := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(`
UPDATE drill_recommendations
SET is_approved = ?, reviewed_by = ?, review_summary = ?, review_note = ?, reviewed_at = ?
WHERE id = ?
`, isApproved, reviewedBy, reviewSummary, reviewNote, reviewedAt, id)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("drill recommendation not found: %d", id)
	}
	return nil
}

type recommendationScanner interface {
	Scan(dest ...any) error
}

func scanRecommendation(scanner recommendationScanner) (drill.Recommendation, error) {
	var r drill.Recommendation
	var reviewedBy sql.NullString
	var reviewSummary sql.NullString
	var reviewNote sql.NullString
	var reviewedAt sql.NullString
	if err := scanner.Scan(
		&r.ID,
		&r.Name,
		&r.URL,
		&r.Reason,
		&r.Type,
		&r.Summary,
		&r.IsApproved,
		&reviewedBy,
		&reviewSummary,
		&reviewNote,
		&reviewedAt,
		&r.CreatedAt,
	); err != nil {
		return drill.Recommendation{}, err
	}
	r.ReviewedBy = reviewedBy.String
	r.ReviewSummary = reviewSummary.String
	r.ReviewNote = reviewNote.String
	r.ReviewedAt = reviewedAt.String
	return r, nil
}
