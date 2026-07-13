package game

import (
	"strings"
	"testing"
)

func TestServiceWriteGameNormalizesFields(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	lineupOrder := 1
	position := 1
	playNo := 1
	_, err := service.WriteGame(
		" 2026-06-24 ",
		" 19:30 ",
		" 海港队 ",
		BattingSideTop,
		5,
		3,
		" 原始描述 ",
		[]GameLineup{{
			Team:             TeamOwn,
			Player:           " 张三 ",
			BattingOrder:     &lineupOrder,
			StartingPosition: &position,
		}},
		[]GameEvent{{
			Inning:        1,
			Half:          HalfTop,
			PlayNo:        &playNo,
			Sequence:      1,
			EventKind:     EventKindPlateResult,
			Player:        " 张三 ",
			Team:          TeamOwn,
			Result:        int(PlateResultSingle),
			RelatedPlayer: " 李四 ",
			PitchSequence: " B,S,X ",
			Description:   " 张三中前安打 ",
		}},
	)
	if err != nil {
		t.Fatalf("WriteGame failed: %v", err)
	}

	if repo.createdGame.Date != "2026-06-24" || repo.createdGame.StartTime != "19:30" || repo.createdGame.Opponent != "海港队" || repo.createdGame.Raw != "原始描述" || !repo.createdGame.IsFinal {
		t.Fatalf("unexpected game: %+v", repo.createdGame)
	}
	if repo.createdLineups[0].Player != "张三" {
		t.Fatalf("unexpected lineup: %+v", repo.createdLineups[0])
	}
	if repo.createdEvents[0].Player != "张三" || repo.createdEvents[0].RelatedPlayer != "李四" || repo.createdEvents[0].Value != 1 || repo.createdEvents[0].Description != "张三中前安打" {
		t.Fatalf("unexpected event: %+v", repo.createdEvents[0])
	}
}

func TestServiceWriteGameRejectsMissingRequiredFields(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	_, err := service.WriteGame("2026-06-24", "", " ", BattingSideTop, 0, 0, "raw", nil, nil)
	if err == nil {
		t.Fatal("expected empty opponent to fail")
	}
	if !strings.Contains(err.Error(), "--opponent cannot be empty") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceWriteGameEventsRejectsInvalidRunnerMovement(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	_, err := service.WriteGameEvents(1, []GameEvent{{
		Inning:    1,
		Half:      HalfTop,
		Sequence:  1,
		EventKind: EventKindRunnerMovement,
		Player:    "张三",
		Team:      TeamOwn,
		Result:    int(RunnerResultAdvance),
		BaseTo:    intPtr(2),
	}})
	if err == nil {
		t.Fatal("expected missing base_from to fail")
	}
	if !strings.Contains(err.Error(), "--base-from cannot be empty") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestBuildGameAnalysisComputesPlayerStats(t *testing.T) {
	playNo := 1
	earned := true
	details := GameDetails{
		Game: Game{ID: 1, Date: "2026-06-24", Opponent: "海港队", BattingSide: BattingSideTop, OwnScore: 2, OpponentScore: 1, IsFinal: true},
		Lineups: []GameLineup{
			{GameID: 1, Team: TeamOwn, Player: "张三", BattingOrder: intPtr(1), StartingPosition: intPtr(1)},
			{GameID: 1, Team: TeamOwn, Player: "李四", BattingOrder: intPtr(2), StartingPosition: intPtr(8)},
		},
		Events: []GameEvent{
			{GameID: 1, Inning: 1, Half: HalfTop, PlayNo: &playNo, Sequence: 1, EventKind: EventKindPlateResult, Player: "张三", Team: TeamOwn, Result: int(PlateResultDouble), RelatedPlayer: "对方投手", PitchSequence: "B,X", Value: 1},
			{GameID: 1, Inning: 1, Half: HalfTop, PlayNo: &playNo, Sequence: 2, EventKind: EventKindRunnerMovement, Player: "李四", Team: TeamOwn, Result: int(RunnerResultRunScored), BaseFrom: intPtr(2), BaseTo: intPtr(4), Reason: runnerReasonPtr(RunnerReasonBattedBall), RunsScored: 1, RBIPlayer: "张三", Value: 1},
			{GameID: 1, Inning: 1, Half: HalfTop, PlayNo: intPtr(2), Sequence: 1, EventKind: EventKindRunnerMovement, Player: "张三", Team: TeamOwn, Result: int(RunnerResultAdvance), BaseFrom: intPtr(1), BaseTo: intPtr(2), Reason: runnerReasonPtr(RunnerReasonStolenBase), Value: 1},
			{GameID: 1, Inning: 1, Half: HalfBottom, PlayNo: intPtr(3), Sequence: 1, EventKind: EventKindPlateResult, Player: "对手甲", Team: TeamOpponent, Result: int(PlateResultStrikeout), RelatedPlayer: "张三", PitchSequence: "S,S,S", OutsOnPlay: 1, Value: 1},
			{GameID: 1, Inning: 1, Half: HalfBottom, PlayNo: intPtr(4), Sequence: 1, EventKind: EventKindRunnerMovement, Player: "对手乙", Team: TeamOpponent, Result: int(RunnerResultRunScored), BaseFrom: intPtr(3), BaseTo: intPtr(4), Reason: runnerReasonPtr(RunnerReasonBattedBall), RelatedPlayer: "张三", RunsScored: 1, Earned: &earned, Value: 1},
			{GameID: 1, Inning: 1, Half: HalfBottom, PlayNo: intPtr(5), Sequence: 1, EventKind: EventKindFieldingCredit, Player: "李四", Team: TeamOwn, Result: int(FieldingResultPutout), Value: 1},
		},
	}

	got, err := BuildGameAnalysis(details, "2026-06-25T00:00:00Z")
	if err != nil {
		t.Fatalf("BuildGameAnalysis failed: %v", err)
	}
	if got.Analysis.Result != GameResultWin || got.Analysis.PlayersAnalyzed != 2 {
		t.Fatalf("unexpected analysis header: %+v", got.Analysis)
	}
	if len(got.Batting) != 1 || got.Batting[0].Player != "张三" || got.Batting[0].Doubles != 1 || got.Batting[0].RunsBattedIn != 1 || got.Batting[0].OPS != 3 {
		t.Fatalf("unexpected batting stats: %+v", got.Batting)
	}
	if len(got.Baserunning) != 2 || got.Baserunning[0].Player != "张三" || got.Baserunning[0].StolenBases != 1 {
		t.Fatalf("unexpected baserunning stats: %+v", got.Baserunning)
	}
	if len(got.Pitching) != 1 || got.Pitching[0].Player != "张三" || got.Pitching[0].Strikeouts != 1 || got.Pitching[0].EarnedRuns != 1 || got.Pitching[0].ERA == nil {
		t.Fatalf("unexpected pitching stats: %+v", got.Pitching)
	}
	if len(got.Fielding) != 1 || got.Fielding[0].Player != "李四" || got.Fielding[0].FieldingPercentage != 1 {
		t.Fatalf("unexpected fielding stats: %+v", got.Fielding)
	}
	if !strings.Contains(got.Summaries[0].Highlight+got.Summaries[1].Highlight, "extra_base_hit") || !strings.Contains(got.Summaries[0].Highlight+got.Summaries[1].Highlight, "stole_base") {
		t.Fatalf("expected highlight tags: %+v", got.Summaries)
	}
}

func TestBuildGameAnalysisIncludesBothTeamsWithSamePlayerName(t *testing.T) {
	details := GameDetails{Game: Game{ID: 9, OwnTeamID: 1, OpponentTeamID: 2, Opponent: "海港队", BattingSide: BattingSideTop, IsFinal: true}, Lineups: []GameLineup{{Team: TeamOwn, Player: "同名"}, {Team: TeamOpponent, Player: "同名"}}, Events: []GameEvent{
		{GameID: 9, Inning: 1, Half: HalfTop, Sequence: 1, EventKind: EventKindPlateResult, Player: "同名", Team: TeamOwn, Result: int(PlateResultSingle), RelatedPlayer: "同名", PitchSequence: "X", Value: 1},
		{GameID: 9, Inning: 1, Half: HalfBottom, Sequence: 1, EventKind: EventKindPlateResult, Player: "同名", Team: TeamOpponent, Result: int(PlateResultStrikeout), RelatedPlayer: "同名", PitchSequence: "S,S,S", OutsOnPlay: 1, Value: 1},
	}}
	result, err := BuildGameAnalysis(details, "2026-07-13T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Summaries) != 2 {
		t.Fatalf("expected both same-name players, got %+v", result.Summaries)
	}
	seen := map[int64]bool{}
	for _, s := range result.Summaries {
		seen[s.TeamID] = true
	}
	if !seen[1] || !seen[2] {
		t.Fatalf("missing team attribution: %+v", result.Summaries)
	}
}

func intPtr(value int) *int {
	return &value
}

func runnerReasonPtr(value RunnerReason) *RunnerReason {
	return &value
}

type fakeRepo struct {
	createdGame      Game
	createdLineups   []GameLineup
	createdEvents    []GameEvent
	addedLineup      GameLineup
	addedEvents      []GameEvent
	setScoreGameID   int64
	setOwnScore      int
	setOpponentScore int
	details          GameDetails
	analysis         GameAnalysisResult
}

func (r *fakeRepo) CreateGame(game Game, lineups []GameLineup, events []GameEvent) (int64, error) {
	r.createdGame = game
	r.createdLineups = lineups
	r.createdEvents = events
	return 1, nil
}

func (r *fakeRepo) AddGameLineup(lineup GameLineup) (int64, error) {
	r.addedLineup = lineup
	return 1, nil
}

func (r *fakeRepo) AddGameEvents(gameID int64, events []GameEvent) (int, error) {
	r.addedEvents = events
	return len(events), nil
}

func (r *fakeRepo) SetGameScore(gameID int64, ownScore int, opponentScore int) error {
	r.setScoreGameID = gameID
	r.setOwnScore = ownScore
	r.setOpponentScore = opponentScore
	return nil
}

func (r *fakeRepo) GetGame(id int64) (GameDetails, error) {
	if len(r.details.Events) > 0 {
		return r.details, nil
	}
	return GameDetails{Game: Game{ID: id}}, nil
}

func (r *fakeRepo) ListGames(filter GameListFilter) ([]Game, error) {
	return []Game{{Date: filter.Date}}, nil
}

func (r *fakeRepo) ReplaceGameAnalysis(result GameAnalysisResult) error {
	r.analysis = result
	return nil
}

func (r *fakeRepo) GetGameAnalysis(gameID int64, player string) (GameAnalysisResult, error) {
	return r.analysis, nil
}

func (r *fakeRepo) ListGameAnalyses() ([]GameAnalysisListItem, error) {
	return []GameAnalysisListItem{{GameID: 1}}, nil
}
