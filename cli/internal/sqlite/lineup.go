package sqlite

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"bastion/internal/domain/game"
	"bastion/internal/domain/lineup"
)

// SaveLineup 原子保存已校验的阵容方案、成员和投手计划。
func (s *Store) SaveLineup(value lineup.Lineup) (int64, error) {
	var id int64
	err := s.withTx(func(tx *sql.Tx) error {
		var isFinal bool
		if err := tx.QueryRow(`SELECT is_final FROM games WHERE id = ?`, value.GameID).Scan(&isFinal); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("game not found: %d", value.GameID)
			}
			return err
		}
		if isFinal {
			return fmt.Errorf("game already final: %d", value.GameID)
		}
		reasoning, err := json.Marshal(value.Reasoning)
		if err != nil {
			return err
		}
		warnings, err := json.Marshal(value.Warnings)
		if err != nil {
			return err
		}
		createdAt := value.CreatedAt
		if createdAt == "" {
			createdAt = time.Now().UTC().Format(time.RFC3339)
		}
		result, err := tx.Exec(`
INSERT INTO lineups (game_id, schema_version, status, strategy, reasoning_json, warnings_json, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
`, value.GameID, value.SchemaVersion, int(lineup.StatusValidated), nullString(value.Strategy), string(reasoning), string(warnings), createdAt)
		if err != nil {
			return err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return err
		}
		for _, entry := range value.Entries {
			if _, err := tx.Exec(`
INSERT INTO lineup_entries (lineup_id, player, role, batting_order, position, suggested_role)
VALUES (?, ?, ?, ?, ?, ?)
`, id, entry.Player, int(entry.Role), nullInt(entry.BattingOrder), nullInt(entry.Position), nullString(entry.SuggestedRole)); err != nil {
				return err
			}
		}
		for i, plan := range value.PitchingPlan {
			if _, err := tx.Exec(`
INSERT INTO lineup_pitching_plans (lineup_id, player, sequence, role, planned_innings)
VALUES (?, ?, ?, ?, ?)
`, id, plan.Player, i+1, int(plan.Role), nullInt(plan.PlannedInnings)); err != nil {
				return err
			}
		}
		return nil
	})
	return id, err
}

// GetLineup 读取一个阵容方案的完整快照。
func (s *Store) GetLineup(id int64) (lineup.Lineup, error) {
	value, err := s.getLineupHeader(id)
	if err != nil {
		return lineup.Lineup{}, err
	}
	value.Entries, err = s.getLineupEntries(id)
	if err != nil {
		return lineup.Lineup{}, err
	}
	value.PitchingPlan, err = s.getLineupPitchingPlan(id)
	if err != nil {
		return lineup.Lineup{}, err
	}
	return value, nil
}

// ListLineups 按比赛和状态筛选阵容方案。
func (s *Store) ListLineups(filter lineup.ListFilter) ([]lineup.Lineup, error) {
	query := `
SELECT id, game_id, schema_version, status, strategy, reasoning_json, warnings_json, created_at, accepted_at
FROM lineups
WHERE 1 = 1
`
	args := []any{}
	if filter.GameID > 0 {
		query += " AND game_id = ?"
		args = append(args, filter.GameID)
	}
	if filter.Status != nil {
		query += " AND status = ?"
		args = append(args, int(*filter.Status))
	}
	query += " ORDER BY created_at DESC, id DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []lineup.Lineup{}
	for rows.Next() {
		value, err := scanLineupHeader(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

// AcceptLineup 将候选方案设为正式方案并替换比赛本方首发。
func (s *Store) AcceptLineup(id int64) (lineup.AcceptResult, error) {
	result := lineup.AcceptResult{LineupID: id}
	err := s.withTx(func(tx *sql.Tx) error {
		var status lineup.Status
		var isFinal bool
		if err := tx.QueryRow(`
SELECT l.game_id, l.status, g.is_final
FROM lineups l
JOIN games g ON g.id = l.game_id
WHERE l.id = ?
`, id).Scan(&result.GameID, &status, &isFinal); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("lineup not found: %d", id)
			}
			return err
		}
		if status != lineup.StatusValidated {
			return fmt.Errorf("lineup not validated: %d", id)
		}
		if isFinal {
			return fmt.Errorf("game already final: %d", result.GameID)
		}
		if _, err := tx.Exec(`
UPDATE lineups
SET status = ?
WHERE game_id = ? AND status = ?
`, int(lineup.StatusSuperseded), result.GameID, int(lineup.StatusAccepted)); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM game_lineups WHERE game_id = ? AND team = ?`, result.GameID, int(game.TeamOwn)); err != nil {
			return err
		}
		rows, err := tx.Query(`
SELECT player, batting_order, position
FROM lineup_entries
WHERE lineup_id = ? AND role = ?
ORDER BY batting_order ASC
`, id, int(lineup.RoleStarter))
		if err != nil {
			return err
		}
		type starter struct {
			player   string
			order    int
			position int
		}
		starters := []starter{}
		for rows.Next() {
			var value starter
			if err := rows.Scan(&value.player, &value.order, &value.position); err != nil {
				rows.Close()
				return err
			}
			starters = append(starters, value)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		if len(starters) != 9 {
			return fmt.Errorf("invalid starter count in saved lineup: %d", len(starters))
		}
		for _, starter := range starters {
			order, position := starter.order, starter.position
			if _, err := insertLineup(tx, game.GameLineup{
				GameID:           result.GameID,
				Team:             game.TeamOwn,
				Player:           starter.player,
				BattingOrder:     &order,
				StartingPosition: &position,
			}); err != nil {
				return err
			}
		}
		acceptedAt := time.Now().UTC().Format(time.RFC3339)
		update, err := tx.Exec(`
UPDATE lineups
SET status = ?, accepted_at = ?
WHERE id = ? AND status = ?
`, int(lineup.StatusAccepted), acceptedAt, id, int(lineup.StatusValidated))
		if err != nil {
			return err
		}
		affected, err := update.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return fmt.Errorf("lineup not validated: %d", id)
		}
		result.GameLineupCount = len(starters)
		return nil
	})
	return result, err
}

// RejectLineup 拒绝一个尚未采用的候选方案。
func (s *Store) RejectLineup(id int64) error {
	return s.withTx(func(tx *sql.Tx) error {
		var status lineup.Status
		var isFinal bool
		if err := tx.QueryRow(`
SELECT l.status, g.is_final
FROM lineups l
JOIN games g ON g.id = l.game_id
WHERE l.id = ?
`, id).Scan(&status, &isFinal); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("lineup not found: %d", id)
			}
			return err
		}
		if status != lineup.StatusValidated {
			return fmt.Errorf("lineup not validated: %d", id)
		}
		if isFinal {
			return fmt.Errorf("game already final for lineup: %d", id)
		}
		result, err := tx.Exec(`
UPDATE lineups
SET status = ?
WHERE id = ? AND status = ?
`, int(lineup.StatusRejected), id, int(lineup.StatusValidated))
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return fmt.Errorf("lineup not validated: %d", id)
		}
		return nil
	})
}

func (s *Store) getLineupHeader(id int64) (lineup.Lineup, error) {
	row := s.db.QueryRow(`
SELECT id, game_id, schema_version, status, strategy, reasoning_json, warnings_json, created_at, accepted_at
FROM lineups
WHERE id = ?
`, id)
	value, err := scanLineupHeader(row)
	if errors.Is(err, sql.ErrNoRows) {
		return lineup.Lineup{}, fmt.Errorf("lineup not found: %d", id)
	}
	return value, err
}

type lineupHeaderScanner interface {
	Scan(dest ...any) error
}

func scanLineupHeader(scanner lineupHeaderScanner) (lineup.Lineup, error) {
	var value lineup.Lineup
	var strategy, acceptedAt sql.NullString
	var reasoningJSON, warningsJSON string
	if err := scanner.Scan(&value.ID, &value.GameID, &value.SchemaVersion, &value.Status, &strategy, &reasoningJSON, &warningsJSON, &value.CreatedAt, &acceptedAt); err != nil {
		return lineup.Lineup{}, err
	}
	value.Strategy = strategy.String
	value.AcceptedAt = acceptedAt.String
	if err := json.Unmarshal([]byte(reasoningJSON), &value.Reasoning); err != nil {
		return lineup.Lineup{}, fmt.Errorf("decode lineup reasoning: %w", err)
	}
	if err := json.Unmarshal([]byte(warningsJSON), &value.Warnings); err != nil {
		return lineup.Lineup{}, fmt.Errorf("decode lineup warnings: %w", err)
	}
	if value.Reasoning == nil {
		value.Reasoning = []string{}
	}
	if value.Warnings == nil {
		value.Warnings = []lineup.Issue{}
	}
	return value, nil
}

func (s *Store) getLineupEntries(id int64) ([]lineup.Entry, error) {
	rows, err := s.db.Query(`
SELECT id, lineup_id, player, role, batting_order, position, suggested_role
FROM lineup_entries
WHERE lineup_id = ?
ORDER BY role ASC, batting_order IS NULL ASC, batting_order ASC, id ASC
`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []lineup.Entry{}
	for rows.Next() {
		var value lineup.Entry
		var order, position sql.NullInt64
		var suggestedRole sql.NullString
		if err := rows.Scan(&value.ID, &value.LineupID, &value.Player, &value.Role, &order, &position, &suggestedRole); err != nil {
			return nil, err
		}
		value.BattingOrder = nullIntPointer(order)
		value.Position = nullIntPointer(position)
		value.SuggestedRole = suggestedRole.String
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) getLineupPitchingPlan(id int64) ([]lineup.PitchingPlan, error) {
	rows, err := s.db.Query(`
SELECT id, lineup_id, player, sequence, role, planned_innings
FROM lineup_pitching_plans
WHERE lineup_id = ?
ORDER BY sequence ASC
`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []lineup.PitchingPlan{}
	for rows.Next() {
		var value lineup.PitchingPlan
		var plannedInnings sql.NullInt64
		if err := rows.Scan(&value.ID, &value.LineupID, &value.Player, &value.Sequence, &value.Role, &plannedInnings); err != nil {
			return nil, err
		}
		value.PlannedInnings = nullIntPointer(plannedInnings)
		values = append(values, value)
	}
	return values, rows.Err()
}
