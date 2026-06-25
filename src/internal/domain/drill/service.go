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
	ReviewRecommendation(id int64, status RecommendationStatus, reviewer string) error
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
	return s.repo.ListRecommendations(filter)
}

// ApproveRecommendation 把指定推荐置为 approved，并记录审批人与审批时间。
func (s *Service) ApproveRecommendation(id int64, reviewer string) error {
	return s.reviewRecommendation(id, StatusApproved, reviewer)
}

// RejectRecommendation 把指定推荐置为 rejected，并记录审批人与审批时间。
func (s *Service) RejectRecommendation(id int64, reviewer string) error {
	return s.reviewRecommendation(id, StatusRejected, reviewer)
}

func (s *Service) reviewRecommendation(id int64, status RecommendationStatus, reviewer string) error {
	if id <= 0 {
		return fmt.Errorf("drill recommendation not found: %d", id)
	}
	reviewer = strings.TrimSpace(reviewer)
	if reviewer != "" {
		exists, err := s.repo.PlayerExists(reviewer)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("player not found: %s", reviewer)
		}
	}
	return s.repo.ReviewRecommendation(id, status, reviewer)
}
