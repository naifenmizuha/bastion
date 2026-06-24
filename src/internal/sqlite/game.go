package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"bastion/internal/domain/game"
)

func (s *Store) CreateGame(g game.Game, lineups []game.GameLineup, events []game.PlateAppearance) (int64, error) {
	var gameID int64
	err := s.withTx(func(tx *sql.Tx) error {
		createdAt := g.CreatedAt
		if createdAt == "" {
			createdAt = time.Now().UTC().Format(time.RFC3339)
		}
		result, err := tx.Exec(`
INSERT INTO games (date, start_time, opponent, batting_side, own_score, opponent_score, is_final, raw, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`, g.Date, nullString(g.StartTime), g.Opponent, int(g.BattingSide), g.OwnScore, g.OpponentScore, g.IsFinal, g.Raw, createdAt)
		if err != nil {
			return err
		}
		gameID, err = result.LastInsertId()
		if err != nil {
			return err
		}
		for _, lineup := range lineups {
			lineup.GameID = gameID
			if _, err := insertLineup(tx, lineup); err != nil {
				return err
			}
		}
		for _, event := range events {
			event.GameID = gameID
			if _, err := insertPlateAppearance(tx, event); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return gameID, nil
}

func (s *Store) AddGameLineup(lineup game.GameLineup) (int64, error) {
	var id int64
	err := s.withTx(func(tx *sql.Tx) error {
		exists, err := gameExistsTx(tx, lineup.GameID)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("game not found: %d", lineup.GameID)
		}
		id, err = insertLineup(tx, lineup)
		return err
	})
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) AddPlateAppearance(event game.PlateAppearance) (int64, error) {
	var id int64
	err := s.withTx(func(tx *sql.Tx) error {
		exists, err := gameExistsTx(tx, event.GameID)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("game not found: %d", event.GameID)
		}
		id, err = insertPlateAppearance(tx, event)
		return err
	})
	if err != nil {
		return 0, err
	}
	return id, nil
}

func (s *Store) SetGameScore(gameID int64, ownScore int, opponentScore int) error {
	return s.withTx(func(tx *sql.Tx) error {
		exists, err := gameExistsTx(tx, gameID)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("game not found: %d", gameID)
		}
		_, err = tx.Exec(`
UPDATE games
SET own_score = ?, opponent_score = ?, is_final = 1
WHERE id = ?
`, ownScore, opponentScore, gameID)
		return err
	})
}

func (s *Store) GetGame(id int64) (game.GameDetails, error) {
	g, err := s.getGame(id)
	if err != nil {
		return game.GameDetails{}, err
	}
	lineups, err := s.getGameLineups(id)
	if err != nil {
		return game.GameDetails{}, err
	}
	events, err := s.getPlateAppearances(id)
	if err != nil {
		return game.GameDetails{}, err
	}
	return game.GameDetails{Game: g, Lineups: lineups, Events: events}, nil
}

func (s *Store) ListGames(filter game.GameListFilter) ([]game.Game, error) {
	query := `
SELECT id, date, start_time, opponent, batting_side, own_score, opponent_score, is_final, raw, created_at
FROM games
ORDER BY date DESC, id DESC
`
	args := []any{}
	if filter.Date != "" {
		query = `
SELECT id, date, start_time, opponent, batting_side, own_score, opponent_score, is_final, raw, created_at
FROM games
WHERE date = ?
ORDER BY date DESC, id DESC
`
		args = append(args, filter.Date)
	}
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var games []game.Game
	for rows.Next() {
		g, err := scanGame(rows)
		if err != nil {
			return nil, err
		}
		games = append(games, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return games, nil
}

func (s *Store) getGame(id int64) (game.Game, error) {
	row := s.db.QueryRow(`
SELECT id, date, start_time, opponent, batting_side, own_score, opponent_score, is_final, raw, created_at
FROM games
WHERE id = ?
`, id)
	g, err := scanGame(row)
	if errors.Is(err, sql.ErrNoRows) {
		return game.Game{}, fmt.Errorf("game not found: %d", id)
	}
	if err != nil {
		return game.Game{}, err
	}
	return g, nil
}

func (s *Store) getGameLineups(gameID int64) ([]game.GameLineup, error) {
	rows, err := s.db.Query(`
SELECT id, game_id, team, player, batting_order, starting_position
FROM game_lineups
WHERE game_id = ?
ORDER BY team ASC, batting_order ASC, id ASC
`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lineups []game.GameLineup
	for rows.Next() {
		var lineup game.GameLineup
		var battingOrder sql.NullInt64
		var startingPosition sql.NullInt64
		if err := rows.Scan(&lineup.ID, &lineup.GameID, &lineup.Team, &lineup.Player, &battingOrder, &startingPosition); err != nil {
			return nil, err
		}
		lineup.BattingOrder = nullIntPointer(battingOrder)
		lineup.StartingPosition = nullIntPointer(startingPosition)
		lineups = append(lineups, lineup)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return lineups, nil
}

func (s *Store) getPlateAppearances(gameID int64) ([]game.PlateAppearance, error) {
	rows, err := s.db.Query(`
SELECT id, game_id, inning, half, batter, pitcher, event_type, pitch_sequence, outs, base_state, runs_scored, description
FROM plate_appearances
WHERE game_id = ?
ORDER BY inning ASC, half ASC, id ASC
`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []game.PlateAppearance
	for rows.Next() {
		var event game.PlateAppearance
		var pitcher sql.NullString
		var pitchSequence sql.NullString
		if err := rows.Scan(
			&event.ID,
			&event.GameID,
			&event.Inning,
			&event.Half,
			&event.Batter,
			&pitcher,
			&event.EventType,
			&pitchSequence,
			&event.Outs,
			&event.BaseState,
			&event.RunsScored,
			&event.Description,
		); err != nil {
			return nil, err
		}
		event.Pitcher = pitcher.String
		event.PitchSequence = pitchSequence.String
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func insertLineup(tx *sql.Tx, lineup game.GameLineup) (int64, error) {
	result, err := tx.Exec(`
INSERT INTO game_lineups (game_id, team, player, batting_order, starting_position)
VALUES (?, ?, ?, ?, ?)
`, lineup.GameID, int(lineup.Team), lineup.Player, nullInt(lineup.BattingOrder), nullInt(lineup.StartingPosition))
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func insertPlateAppearance(tx *sql.Tx, event game.PlateAppearance) (int64, error) {
	result, err := tx.Exec(`
INSERT INTO plate_appearances (game_id, inning, half, batter, pitcher, event_type, pitch_sequence, outs, base_state, runs_scored, description)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, event.GameID, event.Inning, int(event.Half), event.Batter, nullString(event.Pitcher), int(event.EventType), nullString(event.PitchSequence), event.Outs, event.BaseState, event.RunsScored, event.Description)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

type gameScanner interface {
	Scan(dest ...any) error
}

func scanGame(scanner gameScanner) (game.Game, error) {
	var g game.Game
	var startTime sql.NullString
	err := scanner.Scan(
		&g.ID,
		&g.Date,
		&startTime,
		&g.Opponent,
		&g.BattingSide,
		&g.OwnScore,
		&g.OpponentScore,
		&g.IsFinal,
		&g.Raw,
		&g.CreatedAt,
	)
	if err != nil {
		return game.Game{}, err
	}
	g.StartTime = startTime.String
	return g, nil
}

func gameExistsTx(tx *sql.Tx, gameID int64) (bool, error) {
	var exists bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM games WHERE id = ?)`, gameID).Scan(&exists)
	return exists, err
}
