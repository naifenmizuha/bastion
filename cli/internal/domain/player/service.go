package player

import (
	"errors"
	"fmt"
	"strings"
)

type Repository interface {
	AddPlayer(player Player) error
	GetPlayer(name string) (Player, error)
	ListPlayers() ([]Player, error)
	PlayerExists(name string) (bool, error)
}

type Service struct {
	repo Repository
}

// NewService 用数据仓库创建球员领域服务。
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// AddPlayer 规范化并校验球员资料后写入仓库。
func (s *Service) AddPlayer(name string, number int, batRaw string, throwRaw string, positionsRaw string) (Player, error) {
	// 先将文本枚举转换为领域位标记，避免无效数据进入仓库。
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

	// 组装并校验名称后，才提交持久化。
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

// GetPlayer 按规范化后的名称读取球员资料。
func (s *Service) GetPlayer(name string) (Player, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Player{}, errors.New("--name cannot be empty")
	}
	return s.repo.GetPlayer(name)
}

// ListPlayers 返回全部已登记球员。
func (s *Service) ListPlayers() ([]Player, error) {
	return s.repo.ListPlayers()
}
