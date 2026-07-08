package game

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

// BuildGameAnalysis 将比赛事件归类并汇总为各球员的单场表现分析。
func BuildGameAnalysis(details GameDetails, generatedAt string) (GameAnalysisResult, error) {
	if len(details.Events) == 0 {
		return GameAnalysisResult{}, errors.New("game has no analyzable events")
	}

	result := GameAnalysisResult{
		Analysis: GameAnalysis{
			GameID:       details.Game.ID,
			Date:         details.Game.Date,
			Opponent:     details.Game.Opponent,
			IsFinal:      details.Game.IsFinal,
			Result:       determineGameResult(details.Game),
			OwnRuns:      details.Game.OwnScore,
			OpponentRuns: details.Game.OpponentScore,
			GeneratedAt:  generatedAt,
		},
	}

	// 用球员名聚合四类统计，并分别记录可用性和数据缺口。
	batting := map[string]*PlayerBattingStats{}
	baserunning := map[string]*PlayerBaserunningStats{}
	pitching := map[string]*PlayerPitchingStats{}
	fielding := map[string]*PlayerFieldingStats{}
	baserunningAvailable := map[string]bool{}
	fieldingAvailable := map[string]bool{}
	pitchingAvailable := map[string]bool{}
	players := map[string]bool{}
	battingOrders := map[string]*int{}
	positions := map[string]map[string]bool{}
	pitcherByPlay := map[string]string{}
	pitcherHasEarnedData := map[string]bool{}
	pitcherMissingEarnedData := map[string]bool{}

	// 从本方首发名单预先收集球员、打序和守备位置。
	for _, lineup := range details.Lineups {
		if lineup.Team != TeamOwn {
			continue
		}
		player := strings.TrimSpace(lineup.Player)
		if player == "" {
			continue
		}
		players[player] = true
		if lineup.BattingOrder != nil {
			battingOrders[player] = copyInt(lineup.BattingOrder)
		}
		if lineup.StartingPosition != nil {
			addPosition(positions, player, formatPosition(*lineup.StartingPosition))
		}
	}

	// 先建立对方打席到投手的映射，供后续跑垒事件补全投手归属。
	for _, event := range details.Events {
		if event.EventKind == EventKindPlateResult && !isOwnOffense(details.Game.BattingSide, event.Half) && event.RelatedPlayer != "" {
			pitcherByPlay[playKey(event)] = event.RelatedPlayer
		}
	}

	// 按事件类型与攻守方归类，累加打击、跑垒、投球或守备数据。
	for _, event := range details.Events {
		ownOffense := isOwnOffense(details.Game.BattingSide, event.Half)
		switch event.EventKind {
		case EventKindPlateResult:
			if ownOffense {
				stats := battingFor(batting, event.Player, details.Game.ID)
				players[event.Player] = true
				stats.PA += event.Value
				applyBattingResult(stats, PlateResult(event.Result), event.Value)
				continue
			}
			pitcher := strings.TrimSpace(event.RelatedPlayer)
			if pitcher == "" {
				result.DataGaps = append(result.DataGaps, gap(details.Game.ID, "pitching", fmt.Sprintf("missing pitcher for plate result in inning %d", event.Inning)))
				continue
			}
			players[pitcher] = true
			pitchingAvailable[pitcher] = true
			stats := pitchingFor(pitching, pitcher, details.Game.ID)
			stats.BattersFaced += event.Value
			stats.OutsRecorded += event.OutsOnPlay
			applyPitchingPlateResult(stats, PlateResult(event.Result), event.Value)
		case EventKindRunnerMovement:
			if ownOffense {
				players[event.Player] = true
				baserunningAvailable[event.Player] = true
				stats := baserunningFor(baserunning, event.Player, details.Game.ID)
				applyBaserunning(stats, event)
				if event.RBIPlayer != "" {
					rbiStats := battingFor(batting, event.RBIPlayer, details.Game.ID)
					players[event.RBIPlayer] = true
					runs := event.RunsScored
					if runs == 0 && RunnerResult(event.Result) == RunnerResultRunScored {
						runs = event.Value
					}
					rbiStats.RunsBattedIn += runs
				}
				continue
			}
			pitcher := strings.TrimSpace(event.RelatedPlayer)
			if pitcher == "" {
				pitcher = pitcherByPlay[playKey(event)]
			}
			if pitcher == "" {
				if RunnerResult(event.Result) == RunnerResultRunScored || event.OutsOnPlay > 0 || isPitcherRunnerReason(event.Reason) {
					result.DataGaps = append(result.DataGaps, gap(details.Game.ID, "pitching", fmt.Sprintf("missing pitcher attribution for runner movement in inning %d", event.Inning)))
				}
				continue
			}
			players[pitcher] = true
			pitchingAvailable[pitcher] = true
			stats := pitchingFor(pitching, pitcher, details.Game.ID)
			stats.OutsRecorded += event.OutsOnPlay
			applyPitchingRunnerMovement(stats, event)
			if RunnerResult(event.Result) == RunnerResultRunScored {
				if event.Earned == nil {
					pitcherMissingEarnedData[pitcher] = true
					result.DataGaps = append(result.DataGaps, gap(details.Game.ID, "pitching", fmt.Sprintf("missing earned-run flag for %s", pitcher)))
				} else {
					pitcherHasEarnedData[pitcher] = true
					if *event.Earned {
						runs := event.RunsScored
						if runs == 0 {
							runs = event.Value
						}
						stats.EarnedRuns += runs
					}
				}
			}
		case EventKindFieldingCredit:
			if event.Team != TeamOwn {
				continue
			}
			players[event.Player] = true
			fieldingAvailable[event.Player] = true
			stats := fieldingFor(fielding, event.Player, details.Game.ID)
			stats.Positions = joinPositions(positions[event.Player])
			applyFielding(stats, FieldingResult(event.Result), event.Value)
		}
	}

	// 统一计算派生率值，再把按球员聚合的结果转换为输出切片。
	for _, stats := range batting {
		finalizeBatting(stats)
		result.Batting = append(result.Batting, *stats)
	}
	for _, stats := range baserunning {
		finalizeBaserunning(stats)
		result.Baserunning = append(result.Baserunning, *stats)
	}
	for player, stats := range pitching {
		finalizePitching(stats, pitcherHasEarnedData[player] && !pitcherMissingEarnedData[player])
		result.Pitching = append(result.Pitching, *stats)
	}
	for _, stats := range fielding {
		finalizeFielding(stats)
		result.Fielding = append(result.Fielding, *stats)
	}

	if len(baserunning) == 0 {
		result.DataGaps = append(result.DataGaps, gap(details.Game.ID, "baserunning", "no structured baserunning events recorded"))
	}
	if len(fielding) == 0 {
		result.DataGaps = append(result.DataGaps, gap(details.Game.ID, "fielding", "no structured fielding credit events recorded"))
	}

	// 为出现过的每名球员生成可用数据范围和表现标签摘要。
	for player := range players {
		summary := PlayerPerformanceSummary{
			GameID:               details.Game.ID,
			Player:               player,
			BattingOrder:         copyInt(battingOrders[player]),
			Positions:            joinPositions(positions[player]),
			BattingAvailable:     batting[player] != nil && batting[player].PA > 0,
			BaserunningAvailable: baserunningAvailable[player],
			PitchingAvailable:    pitchingAvailable[player],
			FieldingAvailable:    fieldingAvailable[player],
		}
		summary.Highlight, summary.Risk = buildTags(batting[player], baserunning[player], pitching[player], fielding[player])
		result.Summaries = append(result.Summaries, summary)
	}
	result.Analysis.PlayersAnalyzed = len(result.Summaries)

	sortAnalysisResult(&result)
	return result, nil
}

// determineGameResult 根据完赛状态与比分计算胜负或进行中状态。
func determineGameResult(g Game) GameResult {
	if !g.IsFinal {
		return GameResultInProgress
	}
	if g.OwnScore > g.OpponentScore {
		return GameResultWin
	}
	if g.OwnScore < g.OpponentScore {
		return GameResultLoss
	}
	return GameResultTie
}

// isOwnOffense 判断指定半局是否为本队进攻。
func isOwnOffense(side BattingSide, half Half) bool {
	return (side == BattingSideTop && half == HalfTop) || (side == BattingSideBottom && half == HalfBottom)
}

// playKey 生成同一局、半局和打席可共享的投手归属键。
func playKey(event GameEvent) string {
	playNo := 0
	if event.PlayNo != nil {
		playNo = *event.PlayNo
	}
	return fmt.Sprintf("%d:%d:%d", event.Inning, event.Half, playNo)
}

// battingFor 返回球员打击累计器，不存在时先初始化。
func battingFor(stats map[string]*PlayerBattingStats, player string, gameID int64) *PlayerBattingStats {
	if stats[player] == nil {
		stats[player] = &PlayerBattingStats{GameID: gameID, Player: player}
	}
	return stats[player]
}

// baserunningFor 返回球员跑垒累计器，不存在时先初始化。
func baserunningFor(stats map[string]*PlayerBaserunningStats, player string, gameID int64) *PlayerBaserunningStats {
	if stats[player] == nil {
		stats[player] = &PlayerBaserunningStats{GameID: gameID, Player: player}
	}
	return stats[player]
}

// pitchingFor 返回球员投球累计器，不存在时先初始化。
func pitchingFor(stats map[string]*PlayerPitchingStats, player string, gameID int64) *PlayerPitchingStats {
	if stats[player] == nil {
		stats[player] = &PlayerPitchingStats{GameID: gameID, Player: player}
	}
	return stats[player]
}

// fieldingFor 返回球员守备累计器，不存在时先初始化。
func fieldingFor(stats map[string]*PlayerFieldingStats, player string, gameID int64) *PlayerFieldingStats {
	if stats[player] == nil {
		stats[player] = &PlayerFieldingStats{GameID: gameID, Player: player}
	}
	return stats[player]
}

// applyBattingResult 按打席结果累计安打、上垒、打数和垒打数。
func applyBattingResult(stats *PlayerBattingStats, result PlateResult, value int) {
	switch result {
	case PlateResultSingle:
		stats.AtBats += value
		stats.Hits += value
		stats.Singles += value
		stats.TotalBases += value
	case PlateResultDouble:
		stats.AtBats += value
		stats.Hits += value
		stats.Doubles += value
		stats.TotalBases += 2 * value
	case PlateResultTriple:
		stats.AtBats += value
		stats.Hits += value
		stats.Triples += value
		stats.TotalBases += 3 * value
	case PlateResultHomerun:
		stats.AtBats += value
		stats.Hits += value
		stats.Homeruns += value
		stats.TotalBases += 4 * value
	case PlateResultWalk:
		stats.Walks += value
	case PlateResultHitByPitch:
		stats.HitByPitch += value
	case PlateResultStrikeout:
		stats.AtBats += value
		stats.Strikeouts += value
	case PlateResultGroundout, PlateResultFlyout, PlateResultFieldersChoice:
		stats.AtBats += value
	case PlateResultReachedOnError:
		stats.AtBats += value
		stats.ReachedOnError += value
	}
}

// applyBaserunning 从跑垒事件累计得分、盗垒、额外进垒与出局。
func applyBaserunning(stats *PlayerBaserunningStats, event GameEvent) {
	value := event.Value
	if RunnerResult(event.Result) == RunnerResultRunScored {
		if event.RunsScored > 0 {
			stats.Runs += event.RunsScored
		} else {
			stats.Runs += value
		}
	}
	if event.Reason != nil {
		switch *event.Reason {
		case RunnerReasonStolenBase:
			stats.StolenBases += value
		case RunnerReasonCaughtStealing:
			if RunnerResult(event.Result) == RunnerResultOut {
				stats.CaughtStealing += value
			}
		}
	}
	if event.Reason != nil && *event.Reason == RunnerReasonBattedBall && event.BaseFrom != nil && event.BaseTo != nil && *event.BaseTo-*event.BaseFrom > 1 {
		stats.ExtraBasesTaken += value
	}
	if RunnerResult(event.Result) == RunnerResultOut && (event.Reason == nil || *event.Reason != RunnerReasonCaughtStealing) {
		stats.BaserunningOuts += value
	}
}

// applyPitchingPlateResult 将对手打席结果转换为投手的被打与三振数据。
func applyPitchingPlateResult(stats *PlayerPitchingStats, result PlateResult, value int) {
	switch result {
	case PlateResultSingle, PlateResultDouble, PlateResultTriple:
		stats.HitsAllowed += value
	case PlateResultHomerun:
		stats.HitsAllowed += value
		stats.HomerunsAllowed += value
	case PlateResultWalk:
		stats.WalksAllowed += value
	case PlateResultHitByPitch:
		stats.HitBatters += value
	case PlateResultStrikeout:
		stats.Strikeouts += value
	}
}

// applyPitchingRunnerMovement 将对方跑垒事件计入投手失分和特殊事件。
func applyPitchingRunnerMovement(stats *PlayerPitchingStats, event GameEvent) {
	value := event.Value
	if RunnerResult(event.Result) == RunnerResultRunScored {
		if event.RunsScored > 0 {
			stats.RunsAllowed += event.RunsScored
		} else {
			stats.RunsAllowed += value
		}
	}
	if event.Reason == nil {
		return
	}
	switch *event.Reason {
	case RunnerReasonWildPitch:
		stats.WildPitches += value
	case RunnerReasonBalk:
		stats.Balks += value
	case RunnerReasonPickoff:
		stats.Pickoffs += value
	}
}

// applyFielding 按守备记分类型累计对应守备数据。
func applyFielding(stats *PlayerFieldingStats, result FieldingResult, value int) {
	switch result {
	case FieldingResultPutout:
		stats.Putouts += value
	case FieldingResultAssist:
		stats.Assists += value
	case FieldingResultError:
		stats.Errors += value
	case FieldingResultDoublePlay:
		stats.DoublePlays += value
	case FieldingResultPassedBall:
		stats.PassedBalls += value
	case FieldingResultOutfieldAssist:
		stats.OutfieldAssists += value
	}
}

// finalizeBatting 由累计计数计算打击率、上垒率、长打率和 OPS。
func finalizeBatting(stats *PlayerBattingStats) {
	stats.BattingAverage = div(stats.Hits, stats.AtBats)
	stats.OnBasePercentage = div(stats.Hits+stats.Walks+stats.HitByPitch+stats.ReachedOnError, stats.PA)
	stats.SluggingPercentage = div(stats.TotalBases, stats.AtBats)
	stats.OPS = stats.OnBasePercentage + stats.SluggingPercentage
}

// finalizeBaserunning 计算盗垒尝试次数及盗垒成功率。
func finalizeBaserunning(stats *PlayerBaserunningStats) {
	stats.StolenBaseAttempts = stats.StolenBases + stats.CaughtStealing
	stats.StolenBasePercentage = div(stats.StolenBases, stats.StolenBaseAttempts)
}

// finalizePitching 由累计出局数和失分计算投球率值，按数据完整性决定是否给出 ERA。
func finalizePitching(stats *PlayerPitchingStats, eraAvailable bool) {
	stats.InningsPitched = float64(stats.OutsRecorded) / 3
	if stats.InningsPitched > 0 {
		stats.RA9 = 9 * float64(stats.RunsAllowed) / stats.InningsPitched
		stats.WHIP = float64(stats.WalksAllowed+stats.HitsAllowed) / stats.InningsPitched
		if eraAvailable {
			era := 9 * float64(stats.EarnedRuns) / stats.InningsPitched
			stats.ERA = &era
		}
	}
	if stats.WalksAllowed > 0 {
		ratio := float64(stats.Strikeouts) / float64(stats.WalksAllowed)
		stats.StrikeoutWalkRatio = &ratio
	}
}

// finalizeFielding 计算守备机会数与守备率。
func finalizeFielding(stats *PlayerFieldingStats) {
	stats.TotalChances = stats.Putouts + stats.Assists + stats.Errors
	stats.FieldingPercentage = div(stats.Putouts+stats.Assists, stats.TotalChances)
}

// div 执行安全的整数除法，在分母为零时返回零。
func div(numerator int, denominator int) float64 {
	if denominator == 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}

// buildTags 从单场四类统计中生成亮点和风险标签。
func buildTags(batting *PlayerBattingStats, baserunning *PlayerBaserunningStats, pitching *PlayerPitchingStats, fielding *PlayerFieldingStats) (string, string) {
	highlights := []string{}
	risks := []string{}
	if batting != nil {
		if batting.Hits >= 2 {
			highlights = append(highlights, "multi_hit")
		}
		if batting.Doubles+batting.Triples+batting.Homeruns > 0 {
			highlights = append(highlights, "extra_base_hit")
		}
		if batting.Hits+batting.Walks+batting.HitByPitch+batting.ReachedOnError >= 2 {
			highlights = append(highlights, "reached_base_multiple")
		}
		if batting.Strikeouts >= 2 {
			risks = append(risks, "high_strikeout")
		}
	}
	if baserunning != nil {
		if baserunning.StolenBases > 0 {
			highlights = append(highlights, "stole_base")
		}
		if baserunning.CaughtStealing+baserunning.BaserunningOuts > 0 {
			risks = append(risks, "baserunning_risk")
		}
	}
	if pitching != nil {
		if pitching.WalksAllowed == 0 && pitching.BattersFaced >= 3 {
			highlights = append(highlights, "strong_control")
		}
		if pitching.WalksAllowed >= 2 {
			risks = append(risks, "walks_allowed")
		}
	}
	if fielding != nil {
		if fielding.TotalChances > 0 && fielding.Errors == 0 {
			highlights = append(highlights, "no_errors")
		}
		if fielding.Errors > 0 {
			risks = append(risks, "fielding_error")
		}
	}
	return strings.Join(highlights, ","), strings.Join(risks, ",")
}

// sortAnalysisResult 以稳定且适合展示的规则排列各类分析结果。
func sortAnalysisResult(result *GameAnalysisResult) {
	// 摘要优先按打序排列；各统计表按其最有代表性的表现指标排序。
	sort.Slice(result.Summaries, func(i, j int) bool {
		left, right := result.Summaries[i], result.Summaries[j]
		if left.BattingOrder == nil && right.BattingOrder != nil {
			return false
		}
		if left.BattingOrder != nil && right.BattingOrder == nil {
			return true
		}
		if left.BattingOrder != nil && right.BattingOrder != nil && *left.BattingOrder != *right.BattingOrder {
			return *left.BattingOrder < *right.BattingOrder
		}
		return left.Player < right.Player
	})
	sort.Slice(result.Batting, func(i, j int) bool {
		if result.Batting[i].OPS != result.Batting[j].OPS {
			return result.Batting[i].OPS > result.Batting[j].OPS
		}
		if result.Batting[i].Hits != result.Batting[j].Hits {
			return result.Batting[i].Hits > result.Batting[j].Hits
		}
		return result.Batting[i].Player < result.Batting[j].Player
	})
	sort.Slice(result.Baserunning, func(i, j int) bool {
		if result.Baserunning[i].StolenBases != result.Baserunning[j].StolenBases {
			return result.Baserunning[i].StolenBases > result.Baserunning[j].StolenBases
		}
		if result.Baserunning[i].Runs != result.Baserunning[j].Runs {
			return result.Baserunning[i].Runs > result.Baserunning[j].Runs
		}
		return result.Baserunning[i].Player < result.Baserunning[j].Player
	})
	sort.Slice(result.Pitching, func(i, j int) bool {
		if result.Pitching[i].InningsPitched != result.Pitching[j].InningsPitched {
			return result.Pitching[i].InningsPitched > result.Pitching[j].InningsPitched
		}
		if result.Pitching[i].Strikeouts != result.Pitching[j].Strikeouts {
			return result.Pitching[i].Strikeouts > result.Pitching[j].Strikeouts
		}
		return result.Pitching[i].Player < result.Pitching[j].Player
	})
	sort.Slice(result.Fielding, func(i, j int) bool {
		if result.Fielding[i].TotalChances != result.Fielding[j].TotalChances {
			return result.Fielding[i].TotalChances > result.Fielding[j].TotalChances
		}
		if result.Fielding[i].Errors != result.Fielding[j].Errors {
			return result.Fielding[i].Errors < result.Fielding[j].Errors
		}
		return result.Fielding[i].Player < result.Fielding[j].Player
	})
}

// addPosition 为球员累积去重后的守备位置。
func addPosition(positions map[string]map[string]bool, player string, position string) {
	if position == "" {
		return
	}
	if positions[player] == nil {
		positions[player] = map[string]bool{}
	}
	positions[player][position] = true
}

// joinPositions 按标准守备编号顺序输出球员位置列表。
func joinPositions(values map[string]bool) string {
	if len(values) == 0 {
		return ""
	}
	ordered := []string{"P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"}
	parts := []string{}
	for _, position := range ordered {
		if values[position] {
			parts = append(parts, position)
		}
	}
	return strings.Join(parts, ",")
}

// formatPosition 将守备编号转换为常用位置缩写。
func formatPosition(value int) string {
	switch value {
	case 1:
		return "P"
	case 2:
		return "C"
	case 3:
		return "1B"
	case 4:
		return "2B"
	case 5:
		return "3B"
	case 6:
		return "SS"
	case 7:
		return "LF"
	case 8:
		return "CF"
	case 9:
		return "RF"
	default:
		return ""
	}
}

// isPitcherRunnerReason 判断跑垒原因是否必须归入投手数据。
func isPitcherRunnerReason(reason *RunnerReason) bool {
	if reason == nil {
		return false
	}
	return *reason == RunnerReasonWildPitch || *reason == RunnerReasonBalk || *reason == RunnerReasonPickoff
}

// copyInt 复制可选整数，避免输出对象复用输入指针。
func copyInt(value *int) *int {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

// gap 构造一条附带比赛范围的数据缺口记录。
func gap(gameID int64, scope string, message string) AnalysisDataGap {
	return AnalysisDataGap{GameID: gameID, Scope: scope, Message: message}
}
