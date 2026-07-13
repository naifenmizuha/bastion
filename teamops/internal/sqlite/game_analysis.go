package sqlite

import (
	"database/sql"
	"errors"
	"fmt"

	"teamops/internal/domain/game"
)

// deleteGameAnalysisTx 在现有事务中清除比赛的全部旧分析明细。
func deleteGameAnalysisTx(tx *sql.Tx, gameID int64) error {
	tables := []string{
		"game_analysis_data_gaps",
		"game_player_fielding_stats",
		"game_player_pitching_stats",
		"game_player_baserunning_stats",
		"game_player_batting_stats",
		"game_player_performance_summaries",
		"game_analyses",
	}
	for _, table := range tables {
		if _, err := tx.Exec("DELETE FROM "+table+" WHERE game_id = ?", gameID); err != nil {
			return err
		}
	}
	return nil
}

// getAnalysisHeader 读取比赛对应的分析头部和比赛基础信息。
func (s *Store) getAnalysisHeader(g game.Game) (game.GameAnalysisResult, error) {
	row := s.db.QueryRow(`
SELECT id, game_id, result, own_runs, opponent_runs, players_analyzed, generated_at, updated_at
FROM game_analyses
WHERE game_id = ?
`, g.ID)
	var analysis game.GameAnalysis
	if err := row.Scan(&analysis.ID, &analysis.GameID, &analysis.Result, &analysis.OwnRuns, &analysis.OpponentRuns, &analysis.PlayersAnalyzed, &analysis.GeneratedAt, &analysis.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return game.GameAnalysisResult{}, fmt.Errorf("game analysis not found: %d", g.ID)
		}
		return game.GameAnalysisResult{}, err
	}
	analysis.Date = g.Date
	analysis.Opponent = g.Opponent
	analysis.IsFinal = g.IsFinal
	return game.GameAnalysisResult{Analysis: analysis}, nil
}

// getAnalysisSummaries 查询比赛中球员的可用数据和标签摘要。
func (s *Store) getAnalysisSummaries(gameID int64, player string) ([]game.PlayerPerformanceSummary, error) {
	query := `
SELECT s.id, s.game_id, s.team_id, COALESCE(s.player_id,0), COALESCE(p.player_key,''), s.player, s.batting_order, s.positions, s.batting_available, s.baserunning_available,
	s.pitching_available, s.fielding_available, s.highlight, s.risk
FROM game_player_performance_summaries s LEFT JOIN players p ON p.id=s.player_id
WHERE s.game_id = ?
`
	args := []any{gameID}
	if player != "" {
		query += " AND s.player = ?"
		args = append(args, player)
	}
	query += " ORDER BY s.batting_order IS NULL ASC, s.batting_order ASC, s.player ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerPerformanceSummary
	for rows.Next() {
		var item game.PlayerPerformanceSummary
		var battingOrder sql.NullInt64
		var positions, highlight, risk sql.NullString
		if err := rows.Scan(&item.ID, &item.GameID, &item.TeamID, &item.PlayerID, &item.PlayerKey, &item.Player, &battingOrder, &positions, &item.BattingAvailable, &item.BaserunningAvailable, &item.PitchingAvailable, &item.FieldingAvailable, &highlight, &risk); err != nil {
			return nil, err
		}
		item.BattingOrder = nullIntPointer(battingOrder)
		item.Positions = positions.String
		item.Highlight = highlight.String
		item.Risk = risk.String
		items = append(items, item)
	}
	return items, rows.Err()
}

// getBattingStats 查询比赛的打击统计，可选按球员筛选。
func (s *Store) getBattingStats(gameID int64, player string) ([]game.PlayerBattingStats, error) {
	query := `
SELECT b.id, b.game_id, b.team_id, COALESCE(b.player_id,0), COALESCE(p.player_key,''), b.player, b.pa, b.at_bats, b.hits, b.singles, b.doubles, b.triples, b.homeruns, b.walks,
	b.hit_by_pitch, b.strikeouts, b.reached_on_error, b.runs_batted_in, b.total_bases,
	b.batting_average, b.on_base_percentage, b.slugging_percentage, b.ops
FROM game_player_batting_stats b LEFT JOIN players p ON p.id=b.player_id
WHERE b.game_id = ?
`
	args := []any{gameID}
	if player != "" {
		query += " AND b.player = ?"
		args = append(args, player)
	}
	query += " ORDER BY b.ops DESC, b.hits DESC, b.player ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerBattingStats
	for rows.Next() {
		var item game.PlayerBattingStats
		if err := rows.Scan(&item.ID, &item.GameID, &item.TeamID, &item.PlayerID, &item.PlayerKey, &item.Player, &item.PA, &item.AtBats, &item.Hits, &item.Singles, &item.Doubles, &item.Triples, &item.Homeruns, &item.Walks, &item.HitByPitch, &item.Strikeouts, &item.ReachedOnError, &item.RunsBattedIn, &item.TotalBases, &item.BattingAverage, &item.OnBasePercentage, &item.SluggingPercentage, &item.OPS); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// getBaserunningStats 查询比赛的跑垒统计，可选按球员筛选。
func (s *Store) getBaserunningStats(gameID int64, player string) ([]game.PlayerBaserunningStats, error) {
	query := `
SELECT b.id, b.game_id, b.team_id, COALESCE(b.player_id,0), COALESCE(p.player_key,''), b.player, b.runs, b.stolen_bases, b.caught_stealing, b.stolen_base_attempts,
	b.stolen_base_percentage, b.extra_bases_taken, b.baserunning_outs
FROM game_player_baserunning_stats b LEFT JOIN players p ON p.id=b.player_id
WHERE b.game_id = ?
`
	args := []any{gameID}
	if player != "" {
		query += " AND b.player = ?"
		args = append(args, player)
	}
	query += " ORDER BY b.stolen_bases DESC, b.runs DESC, b.player ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerBaserunningStats
	for rows.Next() {
		var item game.PlayerBaserunningStats
		if err := rows.Scan(&item.ID, &item.GameID, &item.TeamID, &item.PlayerID, &item.PlayerKey, &item.Player, &item.Runs, &item.StolenBases, &item.CaughtStealing, &item.StolenBaseAttempts, &item.StolenBasePercentage, &item.ExtraBasesTaken, &item.BaserunningOuts); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// getPitchingStats 查询比赛的投球统计，可选按球员筛选。
func (s *Store) getPitchingStats(gameID int64, player string) ([]game.PlayerPitchingStats, error) {
	query := `
SELECT s.id, s.game_id, s.team_id, COALESCE(s.player_id,0), COALESCE(p.player_key,''), s.player, s.outs_recorded, s.innings_pitched, s.batters_faced, s.hits_allowed,
	s.walks_allowed, s.strikeouts, s.homeruns_allowed, s.runs_allowed, s.earned_runs, s.ra9,
	s.era, s.whip, s.strikeout_walk_ratio, s.wild_pitches, s.balks, s.pickoffs, s.hit_batters
FROM game_player_pitching_stats s LEFT JOIN players p ON p.id=s.player_id
WHERE s.game_id = ?
`
	args := []any{gameID}
	if player != "" {
		query += " AND s.player = ?"
		args = append(args, player)
	}
	query += " ORDER BY s.innings_pitched DESC, s.strikeouts DESC, s.player ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerPitchingStats
	for rows.Next() {
		var item game.PlayerPitchingStats
		var era, ratio sql.NullFloat64
		if err := rows.Scan(&item.ID, &item.GameID, &item.TeamID, &item.PlayerID, &item.PlayerKey, &item.Player, &item.OutsRecorded, &item.InningsPitched, &item.BattersFaced, &item.HitsAllowed, &item.WalksAllowed, &item.Strikeouts, &item.HomerunsAllowed, &item.RunsAllowed, &item.EarnedRuns, &item.RA9, &era, &item.WHIP, &ratio, &item.WildPitches, &item.Balks, &item.Pickoffs, &item.HitBatters); err != nil {
			return nil, err
		}
		item.ERA = nullFloatPointer(era)
		item.StrikeoutWalkRatio = nullFloatPointer(ratio)
		items = append(items, item)
	}
	return items, rows.Err()
}

// getFieldingStats 查询比赛的守备统计，可选按球员筛选。
func (s *Store) getFieldingStats(gameID int64, player string) ([]game.PlayerFieldingStats, error) {
	query := `
SELECT f.id, f.game_id, f.team_id, COALESCE(f.player_id,0), COALESCE(p.player_key,''), f.player, f.positions, f.putouts, f.assists, f.errors, f.total_chances,
	f.fielding_percentage, f.double_plays, f.passed_balls, f.outfield_assists
FROM game_player_fielding_stats f LEFT JOIN players p ON p.id=f.player_id
WHERE f.game_id = ?
`
	args := []any{gameID}
	if player != "" {
		query += " AND f.player = ?"
		args = append(args, player)
	}
	query += " ORDER BY f.total_chances DESC, f.errors ASC, f.player ASC"
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerFieldingStats
	for rows.Next() {
		var item game.PlayerFieldingStats
		var positions sql.NullString
		if err := rows.Scan(&item.ID, &item.GameID, &item.TeamID, &item.PlayerID, &item.PlayerKey, &item.Player, &positions, &item.Putouts, &item.Assists, &item.Errors, &item.TotalChances, &item.FieldingPercentage, &item.DoublePlays, &item.PassedBalls, &item.OutfieldAssists); err != nil {
			return nil, err
		}
		item.Positions = positions.String
		items = append(items, item)
	}
	return items, rows.Err()
}

// getAnalysisDataGaps 查询比赛分析生成时记录的数据缺口。
func (s *Store) getAnalysisDataGaps(gameID int64) ([]game.AnalysisDataGap, error) {
	rows, err := s.db.Query(`
SELECT id, game_id, scope, message
FROM game_analysis_data_gaps
WHERE game_id = ?
ORDER BY id ASC
`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.AnalysisDataGap
	for rows.Next() {
		var item game.AnalysisDataGap
		if err := rows.Scan(&item.ID, &item.GameID, &item.Scope, &item.Message); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
