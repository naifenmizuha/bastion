package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"bastion/internal/domain/player"
)

// AddPlayer 写入球员资料，并将唯一键冲突转换为业务错误。
func (s *Store) AddPlayer(p player.Player) error {
	_, err := s.db.Exec(`
INSERT INTO players (name, number, bat_hands, throw_hands, positions)
VALUES (?, ?, ?, ?, ?)
`, p.Name, p.Number, int64(p.Bat), int64(p.Throw), int64(p.Positions))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("player already exists: %s", p.Name)
		}
		return err
	}
	return nil
}

// GetPlayer 查询球员并将数据库位标记还原为领域枚举。
func (s *Store) GetPlayer(name string) (player.Player, error) {
	var (
		p            player.Player
		batBits      int64
		throwBits    int64
		positionBits int64
	)
	err := s.db.QueryRow(`
SELECT name, number, bat_hands, throw_hands, positions
FROM players
WHERE name = ?
`, name).Scan(&p.Name, &p.Number, &batBits, &throwBits, &positionBits)
	if errors.Is(err, sql.ErrNoRows) {
		return player.Player{}, fmt.Errorf("player not found: %s", name)
	}
	if err != nil {
		return player.Player{}, err
	}
	p.Bat, err = player.HandFromBits(batBits)
	if err != nil {
		return player.Player{}, err
	}
	p.Throw, err = player.HandFromBits(throwBits)
	if err != nil {
		return player.Player{}, err
	}
	p.Positions, err = player.PositionFromBits(positionBits)
	if err != nil {
		return player.Player{}, err
	}
	return p, nil
}

// ListPlayers 按背号和姓名返回全部已登记球员。
func (s *Store) ListPlayers() ([]player.Player, error) {
	rows, err := s.db.Query(`
SELECT name, number, bat_hands, throw_hands, positions
FROM players
ORDER BY number ASC, name ASC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	players := []player.Player{}
	for rows.Next() {
		var (
			p            player.Player
			batBits      int64
			throwBits    int64
			positionBits int64
		)
		if err := rows.Scan(&p.Name, &p.Number, &batBits, &throwBits, &positionBits); err != nil {
			return nil, err
		}
		p.Bat, err = player.HandFromBits(batBits)
		if err != nil {
			return nil, err
		}
		p.Throw, err = player.HandFromBits(throwBits)
		if err != nil {
			return nil, err
		}
		p.Positions, err = player.PositionFromBits(positionBits)
		if err != nil {
			return nil, err
		}
		players = append(players, p)
	}
	return players, rows.Err()
}

// PlayerExists 高效确认指定名称的球员是否存在。
func (s *Store) PlayerExists(name string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM players WHERE name = ?)`, name).Scan(&exists)
	return exists, err
}
