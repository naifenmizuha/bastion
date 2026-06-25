package person

import (
	"strings"
	"testing"
	"time"

	"bastion/internal/domain/game"
)

type fakeRepo struct {
	playerExists bool
	games        []game.Game
	analyses     []game.GameAnalysisListItem
	batting      []game.PlayerBattingStats
	baserunning  []game.PlayerBaserunningStats
	pitching     []game.PlayerPitchingStats
	fielding     []game.PlayerFieldingStats
	summaries    []game.PlayerPerformanceSummary
}

func (r *fakeRepo) PlayerExists(name string) (bool, error) {
	return r.playerExists, nil
}
func (r *fakeRepo) ListFinalGamesInSpan(from, to string) ([]game.Game, error) {
	return r.games, nil
}
func (r *fakeRepo) ListAnalysesInSpan(from, to string) ([]game.GameAnalysisListItem, error) {
	return r.analyses, nil
}
func (r *fakeRepo) ListBattingStats(name, from, to string) ([]game.PlayerBattingStats, error) {
	return r.batting, nil
}
func (r *fakeRepo) ListBaserunningStats(name, from, to string) ([]game.PlayerBaserunningStats, error) {
	return r.baserunning, nil
}
func (r *fakeRepo) ListPitchingStats(name, from, to string) ([]game.PlayerPitchingStats, error) {
	return r.pitching, nil
}
func (r *fakeRepo) ListFieldingStats(name, from, to string) ([]game.PlayerFieldingStats, error) {
	return r.fielding, nil
}
func (r *fakeRepo) ListPerformanceSummaries(name, from, to string) ([]game.PlayerPerformanceSummary, error) {
	return r.summaries, nil
}

func newService(repo *fakeRepo) *Service {
	s := NewService(repo)
	s.now = func() time.Time { return time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC) }
	return s
}

func TestBuildPersonAnalysisBattingAggregation(t *testing.T) {
	batting := []game.PlayerBattingStats{
		{GameID: 1, Player: "张三", PA: 4, AtBats: 4, Hits: 2, Singles: 1, Doubles: 1, TotalBases: 3},
		{GameID: 2, Player: "张三", PA: 4, AtBats: 3, Hits: 1, Singles: 1, TotalBases: 1, Walks: 1},
	}
	games := []game.Game{{ID: 1, IsFinal: true, OwnScore: 5, OpponentScore: 3}, {ID: 2, IsFinal: true, OwnScore: 2, OpponentScore: 2}}
	analyses := []game.GameAnalysisListItem{{GameID: 1}, {GameID: 2}}

	result := BuildPersonAnalysis("张三", "2026-04-01", "2026-06-30", "2026-06-30T12:00:00Z", games, analyses, batting, nil, nil, nil, nil)

	if result.Batting.Games != 2 {
		t.Fatalf("games = %d, want 2", result.Batting.Games)
	}
	if result.Batting.PA != 8 {
		t.Fatalf("PA = %d, want 8", result.Batting.PA)
	}
	if result.Batting.AtBats != 7 {
		t.Fatalf("AtBats = %d, want 7", result.Batting.AtBats)
	}
	if result.Batting.Hits != 3 {
		t.Fatalf("Hits = %d, want 3", result.Batting.Hits)
	}
	if result.Batting.TotalBases != 4 {
		t.Fatalf("TotalBases = %d, want 4", result.Batting.TotalBases)
	}
	wantAVG := 3.0 / 7.0
	if result.Batting.BattingAverage != wantAVG {
		t.Fatalf("AVG = %v, want %v", result.Batting.BattingAverage, wantAVG)
	}
	wantOBP := 4.0 / 8.0
	if result.Batting.OnBasePercentage != wantOBP {
		t.Fatalf("OBP = %v, want %v", result.Batting.OnBasePercentage, wantOBP)
	}
	wantSLG := 4.0 / 7.0
	if result.Batting.SluggingPercentage != wantSLG {
		t.Fatalf("SLG = %v, want %v", result.Batting.SluggingPercentage, wantSLG)
	}
	if result.Batting.OPS != wantOBP+wantSLG {
		t.Fatalf("OPS = %v, want %v", result.Batting.OPS, wantOBP+wantSLG)
	}
	if result.Analysis.GamesAnalyzed != 2 {
		t.Fatalf("GamesAnalyzed = %d, want 2", result.Analysis.GamesAnalyzed)
	}
	if result.Summary.GamesBatting != 2 {
		t.Fatalf("GamesBatting = %d, want 2", result.Summary.GamesBatting)
	}
	if result.Analysis.OwnWins != 1 || result.Analysis.OwnTies != 1 || result.Analysis.OwnLosses != 0 {
		t.Fatalf("W/L/T = %d/%d/%d, want 1/0/1", result.Analysis.OwnWins, result.Analysis.OwnLosses, result.Analysis.OwnTies)
	}
}

func TestBuildPersonAnalysisAVGNotArithmeticMean(t *testing.T) {
	batting := []game.PlayerBattingStats{
		{GameID: 1, AtBats: 1, Hits: 1},
		{GameID: 2, AtBats: 10, Hits: 3},
	}
	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", nil, nil, batting, nil, nil, nil, nil)
	wantAVG := 4.0 / 11.0
	if result.Batting.BattingAverage != wantAVG {
		t.Fatalf("AVG = %v, want %v (not arithmetic mean 0.65)", result.Batting.BattingAverage, wantAVG)
	}
}

func TestBuildPersonAnalysisPitchingERAPropagation(t *testing.T) {
	eraGame1 := 0.0
	eraGame3 := 9.0
	pitchingComplete := []game.PlayerPitchingStats{
		{GameID: 1, OutsRecorded: 6, EarnedRuns: 0, ERA: &eraGame1},
		{GameID: 2, OutsRecorded: 6, EarnedRuns: 2, ERA: &eraGame3},
	}
	games := []game.Game{{ID: 1, IsFinal: true}, {ID: 2, IsFinal: true}}
	analyses := []game.GameAnalysisListItem{{GameID: 1}, {GameID: 2}}

	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, nil, nil, pitchingComplete, nil, nil)
	if result.Pitching.ERA == nil {
		t.Fatal("ERA should be non-nil when all games have ERA")
	}
	wantERA := 9.0 * 2.0 / 4.0
	if *result.Pitching.ERA != wantERA {
		t.Fatalf("ERA = %v, want %v", *result.Pitching.ERA, wantERA)
	}
	if result.Pitching.InningsPitched != 4.0 {
		t.Fatalf("IP = %v, want 4", result.Pitching.InningsPitched)
	}

	pitchingMissing := []game.PlayerPitchingStats{
		{GameID: 1, OutsRecorded: 6, EarnedRuns: 0, ERA: &eraGame1},
		{GameID: 2, OutsRecorded: 6, EarnedRuns: 2, ERA: nil},
	}
	result = BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, nil, nil, pitchingMissing, nil, nil)
	if result.Pitching.ERA != nil {
		t.Fatalf("ERA should be nil when any game ERA missing, got %v", *result.Pitching.ERA)
	}
	found := false
	for _, gap := range result.DataGaps {
		if gap.Scope == "pitching" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected pitching data gap when ERA missing")
	}
}

func TestBuildPersonAnalysisPitchingRatios(t *testing.T) {
	pitching := []game.PlayerPitchingStats{
		{GameID: 1, OutsRecorded: 3, BattersFaced: 4, HitsAllowed: 1, WalksAllowed: 1, Strikeouts: 2, RunsAllowed: 1},
	}
	games := []game.Game{{ID: 1, IsFinal: true}}
	analyses := []game.GameAnalysisListItem{{GameID: 1}}
	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, nil, nil, pitching, nil, nil)
	if result.Pitching.WHIP != 2.0/1.0 {
		t.Fatalf("WHIP = %v, want 2", result.Pitching.WHIP)
	}
	if result.Pitching.RA9 != 9.0*1.0/1.0 {
		t.Fatalf("RA9 = %v, want 9", result.Pitching.RA9)
	}
	if result.Pitching.StrikeoutWalkRatio == nil || *result.Pitching.StrikeoutWalkRatio != 2.0 {
		t.Fatalf("K/BB = %v, want 2", result.Pitching.StrikeoutWalkRatio)
	}

	pitchingNoWalks := []game.PlayerPitchingStats{{GameID: 1, OutsRecorded: 3, BattersFaced: 3, Strikeouts: 2, WalksAllowed: 0}}
	result = BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, nil, nil, pitchingNoWalks, nil, nil)
	if result.Pitching.StrikeoutWalkRatio != nil {
		t.Fatalf("K/BB should be nil when no walks, got %v", *result.Pitching.StrikeoutWalkRatio)
	}
}

func TestBuildPersonAnalysisBaserunningFielding(t *testing.T) {
	baserunning := []game.PlayerBaserunningStats{
		{GameID: 1, Runs: 2, StolenBases: 1, CaughtStealing: 0, StolenBaseAttempts: 1},
		{GameID: 2, Runs: 1, StolenBases: 0, CaughtStealing: 1, StolenBaseAttempts: 1},
	}
	fielding := []game.PlayerFieldingStats{
		{GameID: 1, Positions: "SS", Putouts: 2, Assists: 3, Errors: 0},
		{GameID: 2, Positions: "SS", Putouts: 1, Assists: 2, Errors: 1},
	}
	games := []game.Game{{ID: 1, IsFinal: true}, {ID: 2, IsFinal: true}}
	analyses := []game.GameAnalysisListItem{{GameID: 1}, {GameID: 2}}

	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, nil, baserunning, nil, fielding, nil)
	if result.Baserunning.Runs != 3 {
		t.Fatalf("Runs = %d, want 3", result.Baserunning.Runs)
	}
	if result.Baserunning.StolenBases != 1 || result.Baserunning.CaughtStealing != 1 {
		t.Fatalf("SB/CS = %d/%d, want 1/1", result.Baserunning.StolenBases, result.Baserunning.CaughtStealing)
	}
	if result.Baserunning.StolenBasePercentage != 0.5 {
		t.Fatalf("SB%% = %v, want 0.5", result.Baserunning.StolenBasePercentage)
	}
	if result.Fielding.TotalChances != 9 {
		t.Fatalf("TC = %d, want 9", result.Fielding.TotalChances)
	}
	wantFPCT := 8.0 / 9.0
	if result.Fielding.FieldingPercentage != wantFPCT {
		t.Fatalf("FPCT = %v, want %v", result.Fielding.FieldingPercentage, wantFPCT)
	}
	if result.Fielding.Positions != "SS" {
		t.Fatalf("Positions = %q, want SS", result.Fielding.Positions)
	}
	if result.Summary.Positions != "SS" {
		t.Fatalf("Summary Positions = %q, want SS", result.Summary.Positions)
	}
}

func TestBuildPersonAnalysisMissingGameAnalysisGap(t *testing.T) {
	games := []game.Game{{ID: 1, IsFinal: true}, {ID: 2, IsFinal: true}, {ID: 3, IsFinal: true}}
	analyses := []game.GameAnalysisListItem{{GameID: 1}}
	batting := []game.PlayerBattingStats{{GameID: 1, Player: "x", PA: 1, AtBats: 1, Hits: 1}}

	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, batting, nil, nil, nil, nil)
	count := 0
	for _, gap := range result.DataGaps {
		if gap.Scope == "missing_game_analysis" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("missing_game_analysis gaps = %d, want 2", count)
	}
	if result.Analysis.GamesInSpan != 3 {
		t.Fatalf("GamesInSpan = %d, want 3", result.Analysis.GamesInSpan)
	}
}

func TestBuildPersonAnalysisPositionsFrequency(t *testing.T) {
	summaries := []game.PlayerPerformanceSummary{
		{GameID: 1, Positions: "SS,2B"},
		{GameID: 2, Positions: "SS"},
		{GameID: 3, Positions: "1B"},
	}
	fielding := []game.PlayerFieldingStats{
		{GameID: 1, Positions: "SS"},
		{GameID: 2, Positions: "SS"},
	}
	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", nil, nil, nil, nil, nil, fielding, summaries)
	if result.Summary.Positions != "SS,1B,2B" {
		t.Fatalf("Positions = %q, want SS,1B,2B (SS freq 3, then alphabetical)", result.Summary.Positions)
	}
}

func TestBuildPersonAnalysisTags(t *testing.T) {
	batting := []game.PlayerBattingStats{}
	for i := 0; i < 25; i++ {
		batting = append(batting, game.PlayerBattingStats{GameID: int64(i + 1), PA: 1, AtBats: 1, Hits: 1, Strikeouts: 0})
	}
	games := make([]game.Game, 25)
	analyses := make([]game.GameAnalysisListItem, 25)
	for i := 0; i < 25; i++ {
		games[i] = game.Game{ID: int64(i + 1), IsFinal: true}
		analyses[i] = game.GameAnalysisListItem{GameID: int64(i + 1)}
	}
	result := BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, batting, nil, nil, nil, nil)
	if !strings.Contains(result.Summary.Highlight, "consistent_hitter") {
		t.Fatalf("expected consistent_hitter highlight, got %q", result.Summary.Highlight)
	}
	if !strings.Contains(result.Summary.Highlight, "on_base_machine") {
		t.Fatalf("expected on_base_machine highlight, got %q", result.Summary.Highlight)
	}

	battingK := []game.PlayerBattingStats{}
	for i := 0; i < 25; i++ {
		battingK = append(battingK, game.PlayerBattingStats{GameID: int64(i + 1), PA: 1, AtBats: 1, Strikeouts: 1})
	}
	result = BuildPersonAnalysis("x", "2026-01-01", "2026-01-31", "t", games, analyses, battingK, nil, nil, nil, nil)
	if !strings.Contains(result.Summary.Risk, "high_strikeout_span") {
		t.Fatalf("expected high_strikeout_span risk, got %q", result.Summary.Risk)
	}
}

func TestServiceReadPersonAnalysisValidation(t *testing.T) {
	cases := []struct {
		name    string
		repo    *fakeRepo
		player  string
		from    string
		to      string
		wantErr string
	}{
		{"empty name", &fakeRepo{playerExists: true}, "  ", "2026-01-01", "2026-01-31", "--name cannot be empty"},
		{"invalid from", &fakeRepo{playerExists: true}, "x", "2026-13-01", "2026-01-31", "invalid --date"},
		{"invalid to", &fakeRepo{playerExists: true}, "x", "2026-01-01", "not-a-date", "invalid --date"},
		{"from after to", &fakeRepo{playerExists: true}, "x", "2026-02-01", "2026-01-01", "is after"},
		{"player not found", &fakeRepo{playerExists: false}, "x", "2026-01-01", "2026-01-31", "player not found"},
		{"no analyzable games", &fakeRepo{playerExists: true, games: []game.Game{}, analyses: []game.GameAnalysisListItem{}}, "x", "2026-01-01", "2026-01-31", "no analyzable games in span"},
		{"no player stats", &fakeRepo{playerExists: true, games: []game.Game{{ID: 1, IsFinal: true}}, analyses: []game.GameAnalysisListItem{{GameID: 1}}}, "x", "2026-01-01", "2026-01-31", "no player stats in span"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newService(tc.repo)
			_, err := svc.ReadPersonAnalysis(tc.player, tc.from, tc.to)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("err = %q, want substring %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestServiceReadPersonAnalysisTrimsName(t *testing.T) {
	repo := &fakeRepo{
		playerExists: true,
		games:        []game.Game{{ID: 1, IsFinal: true}},
		analyses:     []game.GameAnalysisListItem{{GameID: 1}},
		batting:      []game.PlayerBattingStats{{GameID: 1, Player: "张三", PA: 1, AtBats: 1, Hits: 1}},
	}
	svc := newService(repo)
	result, err := svc.ReadPersonAnalysis("  张三  ", "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Analysis.Name != "张三" {
		t.Fatalf("Name = %q, want 张三", result.Analysis.Name)
	}
}

func TestServiceReadPersonAnalysisNoErrors(t *testing.T) {
	era := 0.0
	repo := &fakeRepo{
		playerExists: true,
		games:        []game.Game{{ID: 1, IsFinal: true, OwnScore: 5, OpponentScore: 3}},
		analyses:     []game.GameAnalysisListItem{{GameID: 1}},
		batting:      []game.PlayerBattingStats{{GameID: 1, Player: "x", PA: 4, AtBats: 4, Hits: 2, TotalBases: 3, Doubles: 1, Singles: 1}},
		pitching:     []game.PlayerPitchingStats{{GameID: 1, OutsRecorded: 3, BattersFaced: 3, Strikeouts: 1, ERA: &era}},
	}
	svc := newService(repo)
	result, err := svc.ReadPersonAnalysis("x", "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Analysis.Name != "x" || result.Analysis.SpanFrom != "2026-01-01" || result.Analysis.SpanTo != "2026-01-31" {
		t.Fatalf("unexpected analysis header: %+v", result.Analysis)
	}
	if result.Analysis.GamesInSpan != 1 || result.Analysis.GamesAnalyzed != 1 {
		t.Fatalf("games = %d/%d, want 1/1", result.Analysis.GamesInSpan, result.Analysis.GamesAnalyzed)
	}
	if result.Analysis.OwnWins != 1 {
		t.Fatalf("wins = %d, want 1", result.Analysis.OwnWins)
	}
	if result.Batting.Hits != 2 {
		t.Fatalf("hits = %d, want 2", result.Batting.Hits)
	}
}
