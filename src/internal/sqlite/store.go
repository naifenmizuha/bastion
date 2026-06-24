package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"bastion/internal/domain"

	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Init() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS players (
	name TEXT PRIMARY KEY,
	number INTEGER NOT NULL,
	bat_hands INTEGER NOT NULL,
	throw_hands INTEGER NOT NULL,
	positions INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_reports (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	date TEXT NOT NULL,
	content TEXT NOT NULL,
	reflection TEXT NOT NULL,
	UNIQUE(name, date)
);
`)
	return err
}

func (s *Store) AddPlayer(player domain.Player) error {
	_, err := s.db.Exec(`
INSERT INTO players (name, number, bat_hands, throw_hands, positions)
VALUES (?, ?, ?, ?, ?)
`, player.Name, player.Number, int64(player.Bat), int64(player.Throw), int64(player.Positions))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return fmt.Errorf("player already exists: %s", player.Name)
		}
		return err
	}
	return nil
}

func (s *Store) GetPlayer(name string) (domain.Player, error) {
	var (
		player       domain.Player
		batBits      int64
		throwBits    int64
		positionBits int64
	)
	err := s.db.QueryRow(`
SELECT name, number, bat_hands, throw_hands, positions
FROM players
WHERE name = ?
`, name).Scan(&player.Name, &player.Number, &batBits, &throwBits, &positionBits)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Player{}, fmt.Errorf("player not found: %s", name)
	}
	if err != nil {
		return domain.Player{}, err
	}
	player.Bat, err = domain.HandFromBits(batBits)
	if err != nil {
		return domain.Player{}, err
	}
	player.Throw, err = domain.HandFromBits(throwBits)
	if err != nil {
		return domain.Player{}, err
	}
	player.Positions, err = domain.PositionFromBits(positionBits)
	if err != nil {
		return domain.Player{}, err
	}
	return player, nil
}

func (s *Store) PlayerExists(name string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM players WHERE name = ?)`, name).Scan(&exists)
	return exists, err
}

func (s *Store) UpsertReport(report domain.Report) error {
	_, err := s.db.Exec(`
INSERT INTO training_reports (name, date, content, reflection)
VALUES (?, ?, ?, ?)
ON CONFLICT(name, date) DO UPDATE SET
	content = excluded.content,
	reflection = excluded.reflection
`, report.Name, report.Date, report.Content, report.Reflection)
	return err
}

func (s *Store) GetReport(name string, date string) (domain.Report, error) {
	var report domain.Report
	err := s.db.QueryRow(`
SELECT name, date, content, reflection
FROM training_reports
WHERE name = ? AND date = ?
`, name, date).Scan(&report.Name, &report.Date, &report.Content, &report.Reflection)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Report{}, fmt.Errorf("report not found: %s %s", name, date)
	}
	if err != nil {
		return domain.Report{}, err
	}
	return report, nil
}
