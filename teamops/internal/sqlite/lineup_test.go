package sqlite

import (
	"fmt"
	"path/filepath"
	"testing"

	"teamops/internal/domain/game"
	"teamops/internal/domain/lineup"
	"teamops/internal/domain/player"
)

func TestLineupAcceptReplacesOwnGameLineupAndPreservesOpponent(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "lineup.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}

	positions := []player.Position{
		player.PositionPitcher,
		player.PositionCatcher,
		player.PositionFirstBase,
		player.PositionSecondBase,
		player.PositionThirdBase,
		player.PositionShortstop,
		player.PositionOutfield,
		player.PositionOutfield,
		player.PositionOutfield,
	}
	for i, position := range positions {
		if err := store.AddPlayer(player.Player{
			Name: fmt.Sprintf("player-%d", i+1), Number: i + 1,
			Bat: player.HandRight, Throw: player.HandRight, Positions: position,
		}); err != nil {
			t.Fatal(err)
		}
	}
	gameID, err := store.CreateGame(game.Game{
		Date: "2026-07-02", Opponent: "opponent", BattingSide: game.BattingSideTop, Raw: "lineup test",
	}, []game.GameLineup{{Team: game.TeamOpponent, Player: "opponent-player"}}, nil)
	if err != nil {
		t.Fatal(err)
	}

	draft := lineup.Draft{SchemaVersion: "1.0", GameID: gameID}
	for position := 1; position <= 9; position++ {
		draft.Starters = append(draft.Starters, lineup.Starter{
			Player: fmt.Sprintf("player-%d", position), Position: position, BattingOrder: position,
		})
	}
	innings := 5
	draft.PitchingPlan = []lineup.PitchingPlan{{
		Player: "player-1", Role: lineup.PitchingRoleStarter, PlannedInnings: &innings,
	}}
	service := lineup.NewService(store)
	id, validation, err := service.Write(draft)
	if err != nil {
		t.Fatal(err)
	}
	if !validation.Valid {
		t.Fatalf("unexpected validation errors: %+v", validation.Errors)
	}
	accepted, err := service.Accept(id)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.GameLineupCount != 9 {
		t.Fatalf("unexpected accepted count: %+v", accepted)
	}

	details, err := store.GetGame(gameID)
	if err != nil {
		t.Fatal(err)
	}
	own, opponent := 0, 0
	for _, entry := range details.Lineups {
		if entry.Team == game.TeamOwn {
			own++
		} else {
			opponent++
		}
	}
	if own != 9 || opponent != 1 {
		t.Fatalf("unexpected game lineups: own=%d opponent=%d", own, opponent)
	}
}
