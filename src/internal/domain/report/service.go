package report

import (
	"errors"
	"fmt"
	"strings"

	"bastion/internal/domain/common"
)

type Repository interface {
	PlayerExists(name string) (bool, error)
	UpsertReport(report Report) error
	GetReport(name string, date string) (Report, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) WriteReport(name string, dateRaw string, content string, reflection string) (Report, error) {
	date, err := common.NormalizeDate(dateRaw)
	if err != nil {
		return Report{}, err
	}

	report := Report{
		Name:       strings.TrimSpace(name),
		Date:       date,
		Content:    strings.TrimSpace(content),
		Reflection: strings.TrimSpace(reflection),
	}
	if report.Name == "" {
		return Report{}, errors.New("--name cannot be empty")
	}
	if report.Content == "" {
		return Report{}, errors.New("--content cannot be empty")
	}
	if report.Reflection == "" {
		return Report{}, errors.New("--reflection cannot be empty")
	}

	exists, err := s.repo.PlayerExists(report.Name)
	if err != nil {
		return Report{}, err
	}
	if !exists {
		return Report{}, fmt.Errorf("player not found: %s", report.Name)
	}
	if err := s.repo.UpsertReport(report); err != nil {
		return Report{}, err
	}
	return report, nil
}

func (s *Service) GetReport(name string, dateRaw string) (Report, error) {
	date, err := common.NormalizeDate(dateRaw)
	if err != nil {
		return Report{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Report{}, errors.New("--name cannot be empty")
	}
	return s.repo.GetReport(name, date)
}
