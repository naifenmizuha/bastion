package sqlite

import (
	"database/sql"
	"time"

	"teamops/internal/domain/game"

	_ "github.com/mattn/go-sqlite3"
)

func nowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

type Store struct {
	db *sql.DB
}

// Open 打开 SQLite 数据库并启用外键约束。
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

// Close 释放数据库连接及其底层资源。
func (s *Store) Close() error {
	return s.db.Close()
}

// withTx 在事务中执行回调，失败自动回滚，成功才提交。
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

// nullString 将空字符串转换为可写入 SQL NULL 的值。
func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// nullInt 将可选整数转换为数据库参数。
func nullInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

// nullIntPointer 将数据库可空整数转换为领域可选值。
func nullIntPointer(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	intValue := int(value.Int64)
	return &intValue
}

// nullBool 将可选布尔值转换为数据库参数。
func nullBool(value *bool) any {
	if value == nil {
		return nil
	}
	return *value
}

// nullBoolPointer 将数据库可空布尔值转换为领域可选值。
func nullBoolPointer(value sql.NullBool) *bool {
	if !value.Valid {
		return nil
	}
	boolValue := value.Bool
	return &boolValue
}

// nullFloat 将可选浮点数转换为数据库参数。
func nullFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

// nullFloatPointer 将数据库可空浮点数转换为领域可选值。
func nullFloatPointer(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	floatValue := value.Float64
	return &floatValue
}

// nullRunnerReason 将可选跑垒原因转换为数据库枚举值。
func nullRunnerReason(value *game.RunnerReason) any {
	if value == nil {
		return nil
	}
	return int(*value)
}

// nullRunnerReasonPointer 将数据库可空枚举还原为跑垒原因。
func nullRunnerReasonPointer(value sql.NullInt64) *game.RunnerReason {
	if !value.Valid {
		return nil
	}
	reason := game.RunnerReason(value.Int64)
	return &reason
}
