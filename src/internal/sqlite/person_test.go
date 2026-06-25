package sqlite

import (
	"testing"

	"bastion/internal/domain/game"
)

func seedGameWithAnalysis(t *testing.T, store *Store, date string, isFinal bool, player string) int64 {
	t.Helper()
	g := game.Game{
		Date:        date,
		Opponent:    "对手",
		BattingSide: game.BattingSideTop,
		OwnScore:    5,
		OpponentScore: 3,
		IsFinal:     isFinal,
		Raw:         "raw",
		CreatedAt:   "2026-01-01T00:00:00Z",
	}
	gameID, err := store.CreateGame(g, nil, nil)
	if err != nil {
		t.Fatalf("CreateGame failed: %v", err)
	}
	if isFinal {
		era := 0.0
		ratio := 2.0
		result := game.GameAnalysisResult{
			Analysis: game.GameAnalysis{
				GameID:       gameID,
				Result:       game.GameResultWin,
				OwnRuns:      5,
				OpponentRuns: 3,
				GeneratedAt:  "2026-01-01T00:00:00Z",
			},
			Summaries: []game.PlayerPerformanceSummary{{
				GameID:            gameID,
				Player:            player,
				Positions:         "SS",
				BattingAvailable:  true,
				PitchingAvailable: true,
			}},
			Batting: []game.PlayerBattingStats{{
				GameID: gameID, Player: player, PA: 4, AtBats: 4, Hits: 2, Singles: 1, Doubles: 1, TotalBases: 3,
			}},
			Pitching: []game.PlayerPitchingStats{{
				GameID: gameID, Player: player, OutsRecorded: 3, InningsPitched: 1, BattersFaced: 4, Strikeouts: 2, ERA: &era, StrikeoutWalkRatio: &ratio,
			}},
		}
		if err := store.ReplaceGameAnalysis(result); err != nil {
			t.Fatalf("ReplaceGameAnalysis failed: %v", err)
		}
	}
	return gameID
}

func TestListFinalGamesInSpan(t *testing.T) {
	store := newTestStore(t)
	seedGameWithAnalysis(t, store, "2026-01-15", true, "x")
	seedGameWithAnalysis(t, store, "2026-02-15", true, "x")
	seedGameWithAnalysis(t, store, "2026-03-15", false, "x")
	seedGameWithAnalysis(t, store, "2026-04-15", true, "x")

	games, err := store.ListFinalGamesInSpan("2026-01-01", "2026-03-31")
	if err != nil {
		t.Fatalf("ListFinalGamesInSpan failed: %v", err)
	}
	if len(games) != 2 {
		t.Fatalf("got %d games, want 2 (Jan+Feb final, Mar not final, Apr out of span)", len(games))
	}
	for _, g := range games {
		if !g.IsFinal {
			t.Fatalf("non-final game returned: %+v", g)
		}
	}
}

func TestListAnalysesInSpan(t *testing.T) {
	store := newTestStore(t)
	seedGameWithAnalysis(t, store, "2026-01-15", true, "x")
	seedGameWithAnalysis(t, store, "2026-02-15", true, "x")

	analyses, err := store.ListAnalysesInSpan("2026-02-01", "2026-03-31")
	if err != nil {
		t.Fatalf("ListAnalysesInSpan failed: %v", err)
	}
	if len(analyses) != 1 {
		t.Fatalf("got %d analyses, want 1", len(analyses))
	}
}

func TestListBattingStatsFiltersByPlayerAndDate(t *testing.T) {
	store := newTestStore(t)
	seedGameWithAnalysis(t, store, "2026-01-15", true, "张三")
	seedGameWithAnalysis(t, store, "2026-02-15", true, "张三")
	seedGameWithAnalysis(t, store, "2026-03-15", true, "李四")

	stats, err := store.ListBattingStats("张三", "2026-01-01", "2026-02-28")
	if err != nil {
		t.Fatalf("ListBattingStats failed: %v", err)
	}
	if len(stats) != 2 {
		t.Fatalf("got %d batting rows, want 2", len(stats))
	}
	for _, s := range stats {
		if s.Player != "张三" {
			t.Fatalf("unexpected player %q", s.Player)
		}
	}

	stats, err = store.ListBattingStats("张三", "2026-03-01", "2026-03-31")
	if err != nil {
		t.Fatalf("ListBattingStats failed: %v", err)
	}
	if len(stats) != 0 {
		t.Fatalf("got %d batting rows, want 0 for out-of-span", len(stats))
	}
}

func TestListPitchingStatsNullableFields(t *testing.T) {
	store := newTestStore(t)
	gameID := seedGameWithAnalysis(t, store, "2026-01-15", true, "张三")

	stats, err := store.ListPitchingStats("张三", "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatalf("ListPitchingStats failed: %v", err)
	}
	if len(stats) != 1 {
		t.Fatalf("got %d rows, want 1", len(stats))
	}
	if stats[0].GameID != gameID {
		t.Fatalf("GameID = %d, want %d", stats[0].GameID, gameID)
	}
	if stats[0].ERA == nil {
		t.Fatal("ERA should be non-nil")
	}
	if stats[0].StrikeoutWalkRatio == nil {
		t.Fatal("StrikeoutWalkRatio should be non-nil")
	}

	if _, err := store.db.Exec(`UPDATE game_player_pitching_stats SET era = NULL, strikeout_walk_ratio = NULL WHERE game_id = ?`, gameID); err != nil {
		t.Fatalf("update failed: %v", err)
	}
	stats, err = store.ListPitchingStats("张三", "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatalf("ListPitchingStats failed: %v", err)
	}
	if stats[0].ERA != nil {
		t.Fatalf("ERA should be nil, got %v", *stats[0].ERA)
	}
	if stats[0].StrikeoutWalkRatio != nil {
		t.Fatalf("K/BB should be nil, got %v", *stats[0].StrikeoutWalkRatio)
	}
}

func TestListPerformanceSummaries(t *testing.T) {
	store := newTestStore(t)
	seedGameWithAnalysis(t, store, "2026-01-15", true, "张三")

	summaries, err := store.ListPerformanceSummaries("张三", "2026-01-01", "2026-01-31")
	if err != nil {
		t.Fatalf("ListPerformanceSummaries failed: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("got %d summaries, want 1", len(summaries))
	}
	if summaries[0].Positions != "SS" {
		t.Fatalf("Positions = %q, want SS", summaries[0].Positions)
	}
	if !summaries[0].BattingAvailable {
		t.Fatal("BattingAvailable should be true")
	}
}
