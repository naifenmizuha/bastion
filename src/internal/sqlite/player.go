package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"bastion/internal/domain/player"
)

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

func (s *Store) PlayerExists(name string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM players WHERE name = ?)`, name).Scan(&exists)
	return exists, err
}
