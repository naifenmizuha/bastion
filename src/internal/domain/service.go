package domain

import (
	"errors"
	"fmt"
	"strings"
)

type Repository interface {
	AddPlayer(player Player) error
	GetPlayer(name string) (Player, error)
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

func (s *Service) AddPlayer(name string, number int, batRaw string, throwRaw string, positionsRaw string) (Player, error) {
	bat, err := ParseHands(batRaw)
	if err != nil {
		return Player{}, fmt.Errorf("invalid --bat: %w", err)
	}
	throw, err := ParseHands(throwRaw)
	if err != nil {
		return Player{}, fmt.Errorf("invalid --throw: %w", err)
	}
	positions, err := ParsePositions(positionsRaw)
	if err != nil {
		return Player{}, fmt.Errorf("invalid --positions: %w", err)
	}

	player := Player{
		Name:      strings.TrimSpace(name),
		Number:    number,
		Bat:       bat,
		Throw:     throw,
		Positions: positions,
	}
	if player.Name == "" {
		return Player{}, errors.New("--name cannot be empty")
	}
	if err := s.repo.AddPlayer(player); err != nil {
		return Player{}, err
	}
	return player, nil
}

func (s *Service) GetPlayer(name string) (Player, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Player{}, errors.New("--name cannot be empty")
	}
	return s.repo.GetPlayer(name)
}

func (s *Service) WriteReport(name string, dateRaw string, content string, reflection string) (Report, error) {
	date, err := NormalizeDate(dateRaw)
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
	date, err := NormalizeDate(dateRaw)
	if err != nil {
		return Report{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Report{}, errors.New("--name cannot be empty")
	}
	return s.repo.GetReport(name, date)
}
