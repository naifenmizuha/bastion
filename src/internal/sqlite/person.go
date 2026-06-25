package sqlite

import (
	"database/sql"

	"bastion/internal/domain/game"
	"bastion/internal/domain/person"
)

var _ person.Repository = (*Store)(nil)

func (s *Store) ListFinalGamesInSpan(from, to string) ([]game.Game, error) {
	rows, err := s.db.Query(`
SELECT id, date, start_time, opponent, batting_side, own_score, opponent_score, is_final, raw, created_at
FROM games
WHERE date >= ? AND date <= ? AND is_final = 1
ORDER BY date ASC, id ASC
`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.Game
	for rows.Next() {
		g, err := scanGame(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, g)
	}
	return items, rows.Err()
}

func (s *Store) ListAnalysesInSpan(from, to string) ([]game.GameAnalysisListItem, error) {
	rows, err := s.db.Query(`
SELECT a.game_id, g.date, g.opponent, a.own_runs, a.opponent_runs, a.result, g.is_final, a.players_analyzed, a.generated_at
FROM game_analyses a
JOIN games g ON g.id = a.game_id
WHERE g.date >= ? AND g.date <= ?
ORDER BY g.date ASC, a.game_id ASC
`, from, to)
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

func (s *Store) ListBattingStats(name, from, to string) ([]game.PlayerBattingStats, error) {
	rows, err := s.db.Query(`
SELECT b.id, b.game_id, b.player, b.pa, b.at_bats, b.hits, b.singles, b.doubles,
       b.triples, b.homeruns, b.walks, b.hit_by_pitch, b.strikeouts, b.reached_on_error,
       b.runs_batted_in, b.total_bases, b.batting_average, b.on_base_percentage,
       b.slugging_percentage, b.ops
FROM game_player_batting_stats b
JOIN games g ON g.id = b.game_id
WHERE b.player = ? AND g.date >= ? AND g.date <= ? AND g.is_final = 1
ORDER BY g.date ASC, b.game_id ASC
`, name, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerBattingStats
	for rows.Next() {
		var item game.PlayerBattingStats
		if err := rows.Scan(&item.ID, &item.GameID, &item.Player, &item.PA, &item.AtBats, &item.Hits, &item.Singles, &item.Doubles, &item.Triples, &item.Homeruns, &item.Walks, &item.HitByPitch, &item.Strikeouts, &item.ReachedOnError, &item.RunsBattedIn, &item.TotalBases, &item.BattingAverage, &item.OnBasePercentage, &item.SluggingPercentage, &item.OPS); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListBaserunningStats(name, from, to string) ([]game.PlayerBaserunningStats, error) {
	rows, err := s.db.Query(`
SELECT b.id, b.game_id, b.player, b.runs, b.stolen_bases, b.caught_stealing, b.stolen_base_attempts,
       b.stolen_base_percentage, b.extra_bases_taken, b.baserunning_outs
FROM game_player_baserunning_stats b
JOIN games g ON g.id = b.game_id
WHERE b.player = ? AND g.date >= ? AND g.date <= ? AND g.is_final = 1
ORDER BY g.date ASC, b.game_id ASC
`, name, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerBaserunningStats
	for rows.Next() {
		var item game.PlayerBaserunningStats
		if err := rows.Scan(&item.ID, &item.GameID, &item.Player, &item.Runs, &item.StolenBases, &item.CaughtStealing, &item.StolenBaseAttempts, &item.StolenBasePercentage, &item.ExtraBasesTaken, &item.BaserunningOuts); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListPitchingStats(name, from, to string) ([]game.PlayerPitchingStats, error) {
	rows, err := s.db.Query(`
SELECT p.id, p.game_id, p.player, p.outs_recorded, p.innings_pitched, p.batters_faced, p.hits_allowed,
       p.walks_allowed, p.strikeouts, p.homeruns_allowed, p.runs_allowed, p.earned_runs, p.ra9,
       p.era, p.whip, p.strikeout_walk_ratio, p.wild_pitches, p.balks, p.pickoffs, p.hit_batters
FROM game_player_pitching_stats p
JOIN games g ON g.id = p.game_id
WHERE p.player = ? AND g.date >= ? AND g.date <= ? AND g.is_final = 1
ORDER BY g.date ASC, p.game_id ASC
`, name, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerPitchingStats
	for rows.Next() {
		var item game.PlayerPitchingStats
		var era, ratio sql.NullFloat64
		if err := rows.Scan(&item.ID, &item.GameID, &item.Player, &item.OutsRecorded, &item.InningsPitched, &item.BattersFaced, &item.HitsAllowed, &item.WalksAllowed, &item.Strikeouts, &item.HomerunsAllowed, &item.RunsAllowed, &item.EarnedRuns, &item.RA9, &era, &item.WHIP, &ratio, &item.WildPitches, &item.Balks, &item.Pickoffs, &item.HitBatters); err != nil {
			return nil, err
		}
		item.ERA = nullFloatPointer(era)
		item.StrikeoutWalkRatio = nullFloatPointer(ratio)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListFieldingStats(name, from, to string) ([]game.PlayerFieldingStats, error) {
	rows, err := s.db.Query(`
SELECT f.id, f.game_id, f.player, f.positions, f.putouts, f.assists, f.errors, f.total_chances,
       f.fielding_percentage, f.double_plays, f.passed_balls, f.outfield_assists
FROM game_player_fielding_stats f
JOIN games g ON g.id = f.game_id
WHERE f.player = ? AND g.date >= ? AND g.date <= ? AND g.is_final = 1
ORDER BY g.date ASC, f.game_id ASC
`, name, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerFieldingStats
	for rows.Next() {
		var item game.PlayerFieldingStats
		var positions sql.NullString
		if err := rows.Scan(&item.ID, &item.GameID, &item.Player, &positions, &item.Putouts, &item.Assists, &item.Errors, &item.TotalChances, &item.FieldingPercentage, &item.DoublePlays, &item.PassedBalls, &item.OutfieldAssists); err != nil {
			return nil, err
		}
		item.Positions = positions.String
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListPerformanceSummaries(name, from, to string) ([]game.PlayerPerformanceSummary, error) {
	rows, err := s.db.Query(`
SELECT s.id, s.game_id, s.player, s.batting_order, s.positions, s.batting_available,
       s.baserunning_available, s.pitching_available, s.fielding_available, s.highlight, s.risk
FROM game_player_performance_summaries s
JOIN games g ON g.id = s.game_id
WHERE s.player = ? AND g.date >= ? AND g.date <= ? AND g.is_final = 1
ORDER BY g.date ASC, s.game_id ASC
`, name, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []game.PlayerPerformanceSummary
	for rows.Next() {
		var item game.PlayerPerformanceSummary
		var battingOrder sql.NullInt64
		var positions, highlight, risk sql.NullString
		if err := rows.Scan(&item.ID, &item.GameID, &item.Player, &battingOrder, &positions, &item.BattingAvailable, &item.BaserunningAvailable, &item.PitchingAvailable, &item.FieldingAvailable, &highlight, &risk); err != nil {
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
