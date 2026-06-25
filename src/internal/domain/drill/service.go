package drill

import (
	"errors"
	"fmt"
	"strings"
)

type Repository interface {
	PlayerExists(name string) (bool, error)
	CreateRecommendation(r Recommendation) (int64, error)
	ListRecommendations(filter ListFilter) ([]Recommendation, error)
	GetRecommendation(id int64) (Recommendation, error)
	UpdateRecommendationReview(id int64, isApproved bool, reviewedBy string, reviewSummary string, reviewNote string) error
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) WriteRecommendation(name string, url string, reason string, drillType DrillType, summary string) (int64, error) {
	r := Recommendation{
		Name:    strings.TrimSpace(name),
		URL:     strings.TrimSpace(url),
		Reason:  strings.TrimSpace(reason),
		Type:    drillType,
		Summary: strings.TrimSpace(summary),
	}
	if r.Name == "" {
		return 0, errors.New("--name cannot be empty")
	}
	if r.URL == "" {
		return 0, errors.New("--url cannot be empty")
	}
	if r.Reason == "" {
		return 0, errors.New("--reason cannot be empty")
	}
	if r.Summary == "" {
		return 0, errors.New("--summary cannot be empty")
	}
	if err := ValidateDrillType(r.Type); err != nil {
		return 0, err
	}

	exists, err := s.repo.PlayerExists(r.Name)
	if err != nil {
		return 0, err
	}
	if !exists {
		return 0, fmt.Errorf("player not found: %s", r.Name)
	}

	return s.repo.CreateRecommendation(r)
}

func (s *Service) ListRecommendations(filter ListFilter) ([]Recommendation, error) {
	filter.Name = strings.TrimSpace(filter.Name)
	if filter.Status != nil {
		if err := ValidateReviewStatus(*filter.Status); err != nil {
			return nil, err
		}
	}
	return s.repo.ListRecommendations(filter)
}

func (s *Service) ApproveRecommendation(recommendationID int64, coach string, summary string, note string) error {
	return s.reviewRecommendation(recommendationID, true, coach, summary, note, "--note")
}

func (s *Service) RejectRecommendation(recommendationID int64, coach string, summary string, reason string) error {
	return s.reviewRecommendation(recommendationID, false, coach, summary, reason, "--reason")
}

func (s *Service) ListTrainings(filter ListFilter) ([]Recommendation, error) {
	approved := ReviewStatusApproved
	filter.Name = strings.TrimSpace(filter.Name)
	filter.Status = &approved
	return s.repo.ListRecommendations(filter)
}

func (s *Service) GetTraining(recommendationID int64) (Recommendation, error) {
	r, err := s.repo.GetRecommendation(recommendationID)
	if err != nil {
		return Recommendation{}, err
	}
	if !r.IsApproved {
		return Recommendation{}, fmt.Errorf("drill training not found: %d", recommendationID)
	}
	return r, nil
}

func (s *Service) reviewRecommendation(recommendationID int64, isApproved bool, coach string, summary string, note string, noteFlag string) error {
	reviewedBy := strings.TrimSpace(coach)
	reviewSummary := strings.TrimSpace(summary)
	reviewNote := strings.TrimSpace(note)
	if recommendationID <= 0 {
		return errors.New("--recommendation-id must be positive")
	}
	if reviewedBy == "" {
		return errors.New("--coach cannot be empty")
	}
	if reviewSummary == "" {
		return errors.New("--summary cannot be empty")
	}
	if reviewNote == "" {
		return fmt.Errorf("%s cannot be empty", noteFlag)
	}
	if _, err := s.repo.GetRecommendation(recommendationID); err != nil {
		return err
	}
	return s.repo.UpdateRecommendationReview(recommendationID, isApproved, reviewedBy, reviewSummary, reviewNote)
}
