package team

import (
	"errors"
	"strings"
)

type Repository interface {
	InitializeOwnTeam(name string) (Team, error)
	AddTeam(name string) (Team, error)
	GetTeam(name string) (Team, error)
	ListTeams() ([]Team, error)
	IsInitialized() (bool, error)
}

type Service struct{ repo Repository }

func NewService(repo Repository) *Service { return &Service{repo: repo} }

func (s *Service) Initialize(name string) (Team, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Team{}, errors.New("--own-team cannot be empty")
	}
	return s.repo.InitializeOwnTeam(name)
}

func (s *Service) Add(name string) (Team, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Team{}, errors.New("--name cannot be empty")
	}
	return s.repo.AddTeam(name)
}

func (s *Service) Get(name string) (Team, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Team{}, errors.New("--name cannot be empty")
	}
	return s.repo.GetTeam(name)
}

func (s *Service) List() ([]Team, error)        { return s.repo.ListTeams() }
func (s *Service) IsInitialized() (bool, error) { return s.repo.IsInitialized() }
