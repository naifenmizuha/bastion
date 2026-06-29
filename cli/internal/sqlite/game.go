package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"bastion/internal/domain/game"
)

// CreateGame 在同一事务中写入比赛及其可选阵容、事件。
func (s *Store) CreateGame(g game.Game, lineups []game.GameLineup, events []game.GameEvent) (int64, error) {
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
			if _, err := insertGameEvent(tx, event); err != nil {
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

// AddGameLineup 在确认比赛存在后追加阵容记录。
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

// AddGameEvents 在事务中确认比赛并批量追加事件。
func (s *Store) AddGameEvents(gameID int64, events []game.GameEvent) (int, error) {
	err := s.withTx(func(tx *sql.Tx) error {
		exists, err := gameExistsTx(tx, gameID)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("game not found: %d", gameID)
		}
		for _, event := range events {
			event.GameID = gameID
			if _, err := insertGameEvent(tx, event); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return len(events), nil
}

// SetGameScore 更新比分并将比赛标记为已结束。
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

// GetGame 读取比赛主记录及其关联阵容和事件。
func (s *Store) GetGame(id int64) (game.GameDetails, error) {
	g, err := s.getGame(id)
	if err != nil {
		return game.GameDetails{}, err
	}
	lineups, err := s.getGameLineups(id)
	if err != nil {
		return game.GameDetails{}, err
	}
	events, err := s.getGameEvents(id)
	if err != nil {
		return game.GameDetails{}, err
	}
	return game.GameDetails{Game: g, Lineups: lineups, Events: events}, nil
}

// ListGames 按可选日期查询比赛列表。
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

// ReplaceGameAnalysis 在事务中删除旧分析并写入整套新统计。
func (s *Store) ReplaceGameAnalysis(result game.GameAnalysisResult) error {
	return s.withTx(func(tx *sql.Tx) error {
		exists, err := gameExistsTx(tx, result.Analysis.GameID)
		if err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("game not found: %d", result.Analysis.GameID)
		}
		if err := deleteGameAnalysisTx(tx, result.Analysis.GameID); err != nil {
			return err
		}
		if _, err := tx.Exec(`
INSERT INTO game_analyses (game_id, result, own_runs, opponent_runs, players_analyzed, generated_at)
VALUES (?, ?, ?, ?, ?, ?)
`, result.Analysis.GameID, int(result.Analysis.Result), result.Analysis.OwnRuns, result.Analysis.OpponentRuns, result.Analysis.PlayersAnalyzed, result.Analysis.GeneratedAt); err != nil {
			return err
		}
		for _, row := range result.Summaries {
			if _, err := tx.Exec(`
INSERT INTO game_player_performance_summaries (
	game_id, player, batting_order, positions, batting_available, baserunning_available,
	pitching_available, fielding_available, highlight, risk
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, row.GameID, row.Player, nullInt(row.BattingOrder), nullString(row.Positions), row.BattingAvailable, row.BaserunningAvailable, row.PitchingAvailable, row.FieldingAvailable, nullString(row.Highlight), nullString(row.Risk)); err != nil {
				return err
			}
		}
		for _, row := range result.Batting {
			if _, err := tx.Exec(`
INSERT INTO game_player_batting_stats (
	game_id, player, pa, at_bats, hits, singles, doubles, triples, homeruns, walks,
	hit_by_pitch, strikeouts, reached_on_error, runs_batted_in, total_bases,
	batting_average, on_base_percentage, slugging_percentage, ops
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, row.GameID, row.Player, row.PA, row.AtBats, row.Hits, row.Singles, row.Doubles, row.Triples, row.Homeruns, row.Walks, row.HitByPitch, row.Strikeouts, row.ReachedOnError, row.RunsBattedIn, row.TotalBases, row.BattingAverage, row.OnBasePercentage, row.SluggingPercentage, row.OPS); err != nil {
				return err
			}
		}
		for _, row := range result.Baserunning {
			if _, err := tx.Exec(`
INSERT INTO game_player_baserunning_stats (
	game_id, player, runs, stolen_bases, caught_stealing, stolen_base_attempts,
	stolen_base_percentage, extra_bases_taken, baserunning_outs
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`, row.GameID, row.Player, row.Runs, row.StolenBases, row.CaughtStealing, row.StolenBaseAttempts, row.StolenBasePercentage, row.ExtraBasesTaken, row.BaserunningOuts); err != nil {
				return err
			}
		}
		for _, row := range result.Pitching {
			if _, err := tx.Exec(`
INSERT INTO game_player_pitching_stats (
	game_id, player, outs_recorded, innings_pitched, batters_faced, hits_allowed,
	walks_allowed, strikeouts, homeruns_allowed, runs_allowed, earned_runs, ra9,
	era, whip, strikeout_walk_ratio, wild_pitches, balks, pickoffs, hit_batters
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, row.GameID, row.Player, row.OutsRecorded, row.InningsPitched, row.BattersFaced, row.HitsAllowed, row.WalksAllowed, row.Strikeouts, row.HomerunsAllowed, row.RunsAllowed, row.EarnedRuns, row.RA9, nullFloat(row.ERA), row.WHIP, nullFloat(row.StrikeoutWalkRatio), row.WildPitches, row.Balks, row.Pickoffs, row.HitBatters); err != nil {
				return err
			}
		}
		for _, row := range result.Fielding {
			if _, err := tx.Exec(`
INSERT INTO game_player_fielding_stats (
	game_id, player, positions, putouts, assists, errors, total_chances,
	fielding_percentage, double_plays, passed_balls, outfield_assists
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, row.GameID, row.Player, nullString(row.Positions), row.Putouts, row.Assists, row.Errors, row.TotalChances, row.FieldingPercentage, row.DoublePlays, row.PassedBalls, row.OutfieldAssists); err != nil {
				return err
			}
		}
		for _, row := range result.DataGaps {
			if _, err := tx.Exec(`
INSERT INTO game_analysis_data_gaps (game_id, scope, message)
VALUES (?, ?, ?)
`, row.GameID, row.Scope, row.Message); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetGameAnalysis 读取比赛分析，可按球员过滤明细统计。
func (s *Store) GetGameAnalysis(gameID int64, player string) (game.GameAnalysisResult, error) {
	g, err := s.getGame(gameID)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	result, err := s.getAnalysisHeader(g)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	result.Summaries, err = s.getAnalysisSummaries(gameID, player)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	if player != "" && len(result.Summaries) == 0 {
		return game.GameAnalysisResult{}, fmt.Errorf("game player analysis not found: %d %s", gameID, player)
	}
	result.Batting, err = s.getBattingStats(gameID, player)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	result.Baserunning, err = s.getBaserunningStats(gameID, player)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	result.Pitching, err = s.getPitchingStats(gameID, player)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	result.Fielding, err = s.getFieldingStats(gameID, player)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	result.DataGaps, err = s.getAnalysisDataGaps(gameID)
	if err != nil {
		return game.GameAnalysisResult{}, err
	}
	return result, nil
}

// ListGameAnalyses 查询所有已生成比赛分析的摘要。
func (s *Store) ListGameAnalyses() ([]game.GameAnalysisListItem, error) {
	rows, err := s.db.Query(`
SELECT a.game_id, g.date, g.opponent, a.own_runs, a.opponent_runs, a.result, g.is_final, a.players_analyzed, a.generated_at
FROM game_analyses a
JOIN games g ON g.id = a.game_id
ORDER BY a.generated_at DESC, a.game_id DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.GameAnalysisListItem
	for rows.Next() {
		var item game.GameAnalysisListItem
		if err := rows.Scan(&item.GameID, &item.Date, &item.Opponent, &item.OwnRuns, &item.OpponentRuns, &item.Result, &item.IsFinal, &item.PlayersAnalyzed, &item.GeneratedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// getGame 查询单条比赛主记录并映射未找到错误。
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

// getGameLineups 查询比赛的全部阵容记录。
func (s *Store) getGameLineups(gameID int64) ([]game.GameLineup, error) {
	rows, err := s.db.Query(`
SELECT id, game_id, team, player, batting_order, starting_position
FROM game_lineups
WHERE game_id = ?
ORDER BY team ASC, batting_order IS NULL ASC, batting_order ASC, id ASC
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

// getGameEvents 按比赛过程顺序查询全部事实事件。
func (s *Store) getGameEvents(gameID int64) ([]game.GameEvent, error) {
	rows, err := s.db.Query(`
SELECT id, game_id, inning, half, play_no, sequence, event_kind, player, team, result,
	related_player, pitch_sequence, base_from, base_to, reason, outs_on_play, runs_scored,
	rbi_player, earned, value, description
FROM game_events
WHERE game_id = ?
ORDER BY inning ASC, half ASC, play_no ASC, sequence ASC, id ASC
`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []game.GameEvent
	for rows.Next() {
		event, err := scanGameEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

// insertLineup 使用既有事务插入一条阵容记录。
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

// insertGameEvent 使用既有事务插入一条比赛事件。
func insertGameEvent(tx *sql.Tx, event game.GameEvent) (int64, error) {
	result, err := tx.Exec(`
INSERT INTO game_events (
	game_id, inning, half, play_no, sequence, event_kind, player, team, result,
	related_player, pitch_sequence, base_from, base_to, reason, outs_on_play,
	runs_scored, rbi_player, earned, value, description
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, event.GameID, event.Inning, int(event.Half), nullInt(event.PlayNo), event.Sequence, int(event.EventKind), event.Player, int(event.Team), event.Result, nullString(event.RelatedPlayer), nullString(event.PitchSequence), nullInt(event.BaseFrom), nullInt(event.BaseTo), nullRunnerReason(event.Reason), event.OutsOnPlay, event.RunsScored, nullString(event.RBIPlayer), nullBool(event.Earned), event.Value, nullString(event.Description))
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

type gameScanner interface {
	Scan(dest ...any) error
}

// scanGame 将比赛查询行映射为领域对象。
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

// scanGameEvent 将含可空字段的事件查询行映射为领域对象。
func scanGameEvent(scanner gameScanner) (game.GameEvent, error) {
	var event game.GameEvent
	var playNo sql.NullInt64
	var relatedPlayer sql.NullString
	var pitchSequence sql.NullString
	var baseFrom sql.NullInt64
	var baseTo sql.NullInt64
	var reason sql.NullInt64
	var rbiPlayer sql.NullString
	var earned sql.NullBool
	var description sql.NullString
	if err := scanner.Scan(
		&event.ID,
		&event.GameID,
		&event.Inning,
		&event.Half,
		&playNo,
		&event.Sequence,
		&event.EventKind,
		&event.Player,
		&event.Team,
		&event.Result,
		&relatedPlayer,
		&pitchSequence,
		&baseFrom,
		&baseTo,
		&reason,
		&event.OutsOnPlay,
		&event.RunsScored,
		&rbiPlayer,
		&earned,
		&event.Value,
		&description,
	); err != nil {
		return game.GameEvent{}, err
	}
	event.PlayNo = nullIntPointer(playNo)
	event.RelatedPlayer = relatedPlayer.String
	event.PitchSequence = pitchSequence.String
	event.BaseFrom = nullIntPointer(baseFrom)
	event.BaseTo = nullIntPointer(baseTo)
	event.Reason = nullRunnerReasonPointer(reason)
	event.RBIPlayer = rbiPlayer.String
	event.Earned = nullBoolPointer(earned)
	event.Description = description.String
	return event, nil
}

// gameExistsTx 在当前事务中确认比赛是否存在。
func gameExistsTx(tx *sql.Tx, gameID int64) (bool, error) {
	var exists bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM games WHERE id = ?)`, gameID).Scan(&exists)
	return exists, err
}
