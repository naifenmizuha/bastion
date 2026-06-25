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
