package player

import (
	"errors"
	"fmt"
	"strings"
)

type Repository interface {
	AddPlayer(player Player) error
	GetPlayer(name string) (Player, error)
	PlayerExists(name string) (bool, error)
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
