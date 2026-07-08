package person

import (
	"fmt"
	"sort"
	"strings"

	"teamops/internal/domain/game"
)

// BuildPersonAnalysis 汇总时间范围内的单场分析，生成球员跨周期表现报告。
func BuildPersonAnalysis(
	name, from, to, computedAt string,
	gamesInSpan []game.Game,
	analyses []game.GameAnalysisListItem,
	batting []game.PlayerBattingStats,
	baserunning []game.PlayerBaserunningStats,
	pitching []game.PlayerPitchingStats,
	fielding []game.PlayerFieldingStats,
	summaries []game.PlayerPerformanceSummary,
) AnalysisResult {
	// 先找出范围内尚未生成单场分析的比赛，作为报告数据缺口。
	analyzedGameIDs := make(map[int64]bool, len(analyses))
	for _, a := range analyses {
		analyzedGameIDs[a.GameID] = true
	}

	gaps := []AnalysisDataGap{}
	for _, g := range gamesInSpan {
		if !analyzedGameIDs[g.ID] {
			gaps = append(gaps, AnalysisDataGap{
				Scope:   "missing_game_analysis",
				Message: fmt.Sprintf("game %d in span has no game analysis", g.ID),
			})
		}
	}

	// 分别聚合四类累计统计，并传播无法计算 ERA 的数据问题。
	bat := aggregateBatting(batting)
	base := aggregateBaserunning(baserunning)
	pit, eraMissing := aggregatePitching(pitching)
	if eraMissing {
		gaps = append(gaps, AnalysisDataGap{
			Scope:   "pitching",
			Message: "cross-period ERA unavailable: at least one game has missing earned-run data",
		})
	}
	fld := aggregateFielding(fielding)
	positions := collectPositions(summaries, fielding)
	fld.Positions = positions

	// 汇总数据覆盖面与位置，再根据累计数据生成亮点和风险标签。
	summary := PerformanceSummary{
		Positions:            positions,
		GamesBatting:         len(batting),
		GamesBaserunning:     len(baserunning),
		GamesPitching:        len(pitching),
		GamesFielding:        len(fielding),
		BattingAvailable:     len(batting) > 0,
		BaserunningAvailable: len(baserunning) > 0,
		PitchingAvailable:    len(pitching) > 0,
		FieldingAvailable:    len(fielding) > 0,
	}
	summary.Highlight, summary.Risk = buildTags(bat, base, pit, fld)

	wins, losses, ties := countResults(gamesInSpan)

	return AnalysisResult{
		Analysis: Analysis{
			Name:          name,
			SpanFrom:      from,
			SpanTo:        to,
			GamesInSpan:   len(gamesInSpan),
			GamesAnalyzed: countAnalyzedGames(batting, baserunning, pitching, fielding),
			OwnWins:       wins,
			OwnLosses:     losses,
			OwnTies:       ties,
			ComputedAt:    computedAt,
		},
		Summary:     summary,
		Batting:     bat,
		Baserunning: base,
		Pitching:    pit,
		Fielding:    fld,
		DataGaps:    gaps,
	}
}

// aggregateBatting 累加单场打击数据并重新计算周期率值。
func aggregateBatting(rows []game.PlayerBattingStats) BattingStats {
	var s BattingStats
	s.Games = len(rows)
	for _, r := range rows {
		s.PA += r.PA
		s.AtBats += r.AtBats
		s.Hits += r.Hits
		s.Singles += r.Singles
		s.Doubles += r.Doubles
		s.Triples += r.Triples
		s.Homeruns += r.Homeruns
		s.Walks += r.Walks
		s.HitByPitch += r.HitByPitch
		s.Strikeouts += r.Strikeouts
		s.ReachedOnError += r.ReachedOnError
		s.RunsBattedIn += r.RunsBattedIn
		s.TotalBases += r.TotalBases
	}
	s.BattingAverage = divFloat(float64(s.Hits), float64(s.AtBats))
	s.OnBasePercentage = divFloat(float64(s.Hits+s.Walks+s.HitByPitch+s.ReachedOnError), float64(s.PA))
	s.SluggingPercentage = divFloat(float64(s.TotalBases), float64(s.AtBats))
	s.OPS = s.OnBasePercentage + s.SluggingPercentage
	return s
}

// aggregateBaserunning 累加单场跑垒数据并计算周期盗垒率。
func aggregateBaserunning(rows []game.PlayerBaserunningStats) BaserunningStats {
	var s BaserunningStats
	s.Games = len(rows)
	for _, r := range rows {
		s.Runs += r.Runs
		s.StolenBases += r.StolenBases
		s.CaughtStealing += r.CaughtStealing
		s.StolenBaseAttempts += r.StolenBaseAttempts
		s.ExtraBasesTaken += r.ExtraBasesTaken
		s.BaserunningOuts += r.BaserunningOuts
	}
	s.StolenBasePercentage = divFloat(float64(s.StolenBases), float64(s.StolenBaseAttempts))
	return s
}

// aggregatePitching 累加投球数据，并在任一场缺责失分时禁用周期 ERA。
func aggregatePitching(rows []game.PlayerPitchingStats) (PitchingStats, bool) {
	var s PitchingStats
	eraMissing := false
	s.Games = len(rows)
	for _, r := range rows {
		s.OutsRecorded += r.OutsRecorded
		s.BattersFaced += r.BattersFaced
		s.HitsAllowed += r.HitsAllowed
		s.WalksAllowed += r.WalksAllowed
		s.Strikeouts += r.Strikeouts
		s.HomerunsAllowed += r.HomerunsAllowed
		s.RunsAllowed += r.RunsAllowed
		s.EarnedRuns += r.EarnedRuns
		s.WildPitches += r.WildPitches
		s.Balks += r.Balks
		s.Pickoffs += r.Pickoffs
		s.HitBatters += r.HitBatters
		if r.ERA == nil {
			eraMissing = true
		}
	}
	s.InningsPitched = float64(s.OutsRecorded) / 3
	if s.InningsPitched > 0 {
		s.RA9 = 9 * float64(s.RunsAllowed) / s.InningsPitched
		s.WHIP = float64(s.WalksAllowed+s.HitsAllowed) / s.InningsPitched
		if !eraMissing {
			era := 9 * float64(s.EarnedRuns) / s.InningsPitched
			s.ERA = &era
		}
	}
	if s.WalksAllowed > 0 {
		ratio := float64(s.Strikeouts) / float64(s.WalksAllowed)
		s.StrikeoutWalkRatio = &ratio
	}
	return s, eraMissing
}

// aggregateFielding 累加单场守备数据并重新计算守备率。
func aggregateFielding(rows []game.PlayerFieldingStats) FieldingStats {
	var s FieldingStats
	s.Games = len(rows)
	for _, r := range rows {
		s.Putouts += r.Putouts
		s.Assists += r.Assists
		s.Errors += r.Errors
		s.DoublePlays += r.DoublePlays
		s.PassedBalls += r.PassedBalls
		s.OutfieldAssists += r.OutfieldAssists
	}
	s.TotalChances = s.Putouts + s.Assists + s.Errors
	s.FieldingPercentage = divFloat(float64(s.Putouts+s.Assists), float64(s.TotalChances))
	return s
}

// collectPositions 按出赛场次统计并排序球员使用过的守备位置。
func collectPositions(summaries []game.PlayerPerformanceSummary, fielding []game.PlayerFieldingStats) string {
	// 每场同一位置只计一次，避免同场重复记录放大频次。
	perGame := map[int64]map[string]bool{}
	for _, s := range summaries {
		addPositions(perGame, s.GameID, s.Positions)
	}
	for _, f := range fielding {
		addPositions(perGame, f.GameID, f.Positions)
	}
	freq := map[string]int{}
	for _, positions := range perGame {
		for pos := range positions {
			freq[pos]++
		}
	}
	type posCount struct {
		pos   string
		count int
	}
	items := make([]posCount, 0, len(freq))
	for pos, count := range freq {
		items = append(items, posCount{pos, count})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].count != items[j].count {
			return items[i].count > items[j].count
		}
		return items[i].pos < items[j].pos
	})
	parts := make([]string, 0, len(items))
	for _, item := range items {
		parts = append(parts, item.pos)
	}
	return strings.Join(parts, ",")
}

// addPositions 将逗号分隔的位置写入指定比赛的去重集合。
func addPositions(perGame map[int64]map[string]bool, gameID int64, positions string) {
	if strings.TrimSpace(positions) == "" {
		return
	}
	if perGame[gameID] == nil {
		perGame[gameID] = map[string]bool{}
	}
	for _, p := range strings.Split(positions, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		perGame[gameID][p] = true
	}
}

// countResults 仅统计已结束比赛的胜、负、平场次。
func countResults(games []game.Game) (wins, losses, ties int) {
	for _, g := range games {
		if !g.IsFinal {
			continue
		}
		if g.OwnScore > g.OpponentScore {
			wins++
		} else if g.OwnScore < g.OpponentScore {
			losses++
		} else {
			ties++
		}
	}
	return
}

// countAnalyzedGames 合并四类统计中的比赛编号，得到实际有球员数据的场次。
func countAnalyzedGames(batting []game.PlayerBattingStats, baserunning []game.PlayerBaserunningStats, pitching []game.PlayerPitchingStats, fielding []game.PlayerFieldingStats) int {
	seen := map[int64]bool{}
	for _, r := range batting {
		seen[r.GameID] = true
	}
	for _, r := range baserunning {
		seen[r.GameID] = true
	}
	for _, r := range pitching {
		seen[r.GameID] = true
	}
	for _, r := range fielding {
		seen[r.GameID] = true
	}
	return len(seen)
}

// buildTags 按最小样本量和表现阈值生成周期亮点与风险标签。
func buildTags(bat BattingStats, base BaserunningStats, pit PitchingStats, fld FieldingStats) (highlight, risk string) {
	highlights := []string{}
	risks := []string{}

	if bat.AtBats >= 20 && bat.BattingAverage >= 0.300 {
		highlights = append(highlights, "consistent_hitter")
	}
	if bat.PA >= 20 && bat.OnBasePercentage >= 0.400 {
		highlights = append(highlights, "on_base_machine")
	}
	if bat.AtBats >= 15 && (bat.Homeruns >= 2 || bat.SluggingPercentage >= 0.450) {
		highlights = append(highlights, "power_hitter")
	}
	if bat.RunsBattedIn >= 10 {
		highlights = append(highlights, "rbi_producer")
	}
	if base.StolenBaseAttempts >= 5 && base.StolenBasePercentage >= 0.800 {
		highlights = append(highlights, "efficient_baserunner")
	}
	if pit.BattersFaced >= 20 && pit.WalksAllowed == 0 {
		highlights = append(highlights, "strong_control_span")
	}
	if pit.BattersFaced >= 20 && float64(pit.Strikeouts)/float64(pit.BattersFaced) >= 0.400 {
		highlights = append(highlights, "strikeout_artist")
	}
	if fld.TotalChances >= 10 && fld.Errors == 0 {
		highlights = append(highlights, "no_errors_span")
	}
	if fld.TotalChances >= 15 && fld.FieldingPercentage >= 0.970 {
		highlights = append(highlights, "fielding_reliable")
	}

	if bat.PA >= 20 && float64(bat.Strikeouts)/float64(bat.PA) >= 0.300 {
		risks = append(risks, "high_strikeout_span")
	}
	if pit.BattersFaced >= 20 && float64(pit.WalksAllowed)/float64(pit.BattersFaced) >= 0.200 {
		risks = append(risks, "walks_prone")
	}
	if pit.BattersFaced >= 20 && pit.HomerunsAllowed >= 3 {
		risks = append(risks, "homeruns_prone")
	}
	if base.StolenBaseAttempts >= 5 && base.StolenBasePercentage < 0.600 {
		risks = append(risks, "baserunning_risk_span")
	}
	if fld.TotalChances >= 10 && float64(fld.Errors)/float64(fld.TotalChances) >= 0.150 {
		risks = append(risks, "fielding_error_span")
	}
	if fld.PassedBalls >= 3 {
		risks = append(risks, "passed_ball_prone")
	}

	return strings.Join(highlights, ","), strings.Join(risks, ",")
}

// divFloat 执行安全的浮点除法，在分母为零时返回零。
func divFloat(numerator, denominator float64) float64 {
	if denominator == 0 {
		return 0
	}
	return numerator / denominator
}
