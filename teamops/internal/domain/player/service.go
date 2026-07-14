package player

import (
	"database/sql"
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

type teamRepository interface {
	ResolvePlayerTeam(name string) (int64, string, error)
	GetPlayerForTeam(name, team string) (Player, error)
	ListPlayersFiltered(team, scope string) ([]Player, error)
}

type identityRepository interface {
	AddPlayerReturning(Player) (Player, bool, error)
	GetPlayerByID(int64) (Player, error)
	GetPlayerByKey(string) (Player, error)
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
	return s.AddPlayerForTeam(name, "", number, batRaw, throwRaw, positionsRaw)
}

func (s *Service) AddPlayerForTeam(name, team string, number int, batRaw string, throwRaw string, positionsRaw string) (Player, error) {
	value, _, err := s.AddPlayerForTeamResult(name, team, number, batRaw, throwRaw, positionsRaw)
	return value, err
}

func (s *Service) AddPlayerForTeamResult(name, team string, number int, batRaw string, throwRaw string, positionsRaw string) (Player, bool, error) {
	// 先将文本枚举转换为领域位标记，避免无效数据进入仓库。
	bat, err := ParseHands(batRaw)
	if err != nil {
		return Player{}, false, fmt.Errorf("invalid --bat: %w", err)
	}
	throw, err := ParseHands(throwRaw)
	if err != nil {
		return Player{}, false, fmt.Errorf("invalid --throw: %w", err)
	}
	positions, err := ParsePositions(positionsRaw)
	if err != nil {
		return Player{}, false, fmt.Errorf("invalid --positions: %w", err)
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
		return Player{}, false, errors.New("--name cannot be empty")
	}
	if number < 0 {
		return Player{}, false, fmt.Errorf("invalid --number %d, expected >= 0", number)
	}
	repo, ok := s.repo.(teamRepository)
	if !ok {
		if strings.TrimSpace(team) != "" {
			return Player{}, false, errors.New("team-aware player repository is unavailable")
		}
		if err := s.repo.AddPlayer(player); err != nil {
			return Player{}, false, err
		}
		return player, true, nil
	}
	teamID, teamName, err := repo.ResolvePlayerTeam(strings.TrimSpace(team))
	if err != nil {
		return Player{}, false, err
	}
	player.TeamID, player.Team = teamID, teamName
	if identity, ok := s.repo.(identityRepository); ok {
		return identity.AddPlayerReturning(player)
	}
	if err := s.repo.AddPlayer(player); err != nil {
		return Player{}, false, err
	}
	return player, true, nil
}

func (s *Service) GetPlayerByID(id int64) (Player, error) {
	if id <= 0 {
		return Player{}, fmt.Errorf("invalid --id %d, expected greater than 0", id)
	}
	repo, ok := s.repo.(identityRepository)
	if !ok {
		return Player{}, errors.New("identity-aware player repository is unavailable")
	}
	p, err := repo.GetPlayerByID(id)
	if errors.Is(err, sql.ErrNoRows) {
		return Player{}, fmt.Errorf("player not found: %d", id)
	}
	return p, err
}

func (s *Service) GetPlayerByKey(key string) (Player, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return Player{}, errors.New("--key cannot be empty")
	}
	repo, ok := s.repo.(identityRepository)
	if !ok {
		return Player{}, errors.New("identity-aware player repository is unavailable")
	}
	p, err := repo.GetPlayerByKey(key)
	if errors.Is(err, sql.ErrNoRows) {
		return Player{}, fmt.Errorf("player not found: %s", key)
	}
	return p, err
}

func (s *Service) GetPlayerForTeam(name, team string) (Player, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Player{}, errors.New("--name cannot be empty")
	}
	if repo, ok := s.repo.(teamRepository); ok {
		return repo.GetPlayerForTeam(name, strings.TrimSpace(team))
	}
	return s.repo.GetPlayer(name)
}

func (s *Service) ListPlayersFiltered(team, scope string) ([]Player, error) {
	scope = strings.TrimSpace(scope)
	if scope != "" && scope != "own" && scope != "opponent" {
		return nil, fmt.Errorf("invalid --scope %q, expected own or opponent", scope)
	}
	if repo, ok := s.repo.(teamRepository); ok {
		return repo.ListPlayersFiltered(strings.TrimSpace(team), scope)
	}
	return s.repo.ListPlayers()
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
