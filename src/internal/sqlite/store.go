package sqlite

import (
	"database/sql"

	"bastion/internal/domain/game"

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

func (s *Store) withTx(fn func(*sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullIntPointer(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	intValue := int(value.Int64)
	return &intValue
}

func nullBool(value *bool) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullBoolPointer(value sql.NullBool) *bool {
	if !value.Valid {
		return nil
	}
	boolValue := value.Bool
	return &boolValue
}

func nullFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullFloatPointer(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	floatValue := value.Float64
	return &floatValue
}

func nullRunnerReason(value *game.RunnerReason) any {
	if value == nil {
		return nil
	}
	return int(*value)
}

func nullRunnerReasonPointer(value sql.NullInt64) *game.RunnerReason {
	if !value.Valid {
		return nil
	}
	reason := game.RunnerReason(value.Int64)
	return &reason
}
