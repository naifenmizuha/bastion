package lineup

import (
	"fmt"
	"testing"

	"bastion/internal/domain/game"
	"bastion/internal/domain/player"
)

func TestValidateAcceptsCompleteLineup(t *testing.T) {
	repo := newFakeRepository()
	service := NewService(repo)

	result, err := service.Validate(validDraft())
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}
	if !result.Valid || len(result.Errors) != 0 {
		t.Fatalf("expected valid lineup, got %+v", result)
	}
}

func TestValidateReturnsMultipleRepairableErrors(t *testing.T) {
	repo := newFakeRepository()
	service := NewService(repo)
	draft := validDraft()
	draft.Starters[1].Player = draft.Starters[0].Player
	draft.Starters[2].Position = 4

	result, err := service.Validate(draft)
	if err != nil {
		t.Fatalf("Validate failed: %v", err)
	}
	if result.Valid || len(result.Errors) < 3 {
		t.Fatalf("expected multiple errors, got %+v", result.Errors)
	}
	codes := map[string]bool{}
	for _, issue := range result.Errors {
		codes[issue.Code] = true
	}
	for _, code := range []string{"duplicate_player", "duplicate_position", "position_uncovered"} {
		if !codes[code] {
			t.Fatalf("missing error %q in %+v", code, result.Errors)
		}
	}
}

func validDraft() Draft {
	starters := make([]Starter, 0, 9)
	for position := 1; position <= 9; position++ {
		starters = append(starters, Starter{
			Player:       fmt.Sprintf("player-%d", position),
			Position:     position,
			BattingOrder: position,
		})
	}
	innings := 5
	return Draft{
		SchemaVersion: "1.0",
		GameID:        1,
		Starters:      starters,
		PitchingPlan: []PitchingPlan{{
			Player:         "player-1",
			Role:           PitchingRoleStarter,
			PlannedInnings: &innings,
		}},
	}
}

type fakeRepository struct {
	players map[string]player.Player
}

func newFakeRepository() *fakeRepository {
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
	repo := &fakeRepository{players: map[string]player.Player{}}
	for i, position := range positions {
		name := fmt.Sprintf("player-%d", i+1)
		repo.players[name] = player.Player{Name: name, Positions: position}
	}
	return repo
}

func (r *fakeRepository) GetGame(id int64) (game.GameDetails, error) {
	if id != 1 {
		return game.GameDetails{}, fmt.Errorf("game not found: %d", id)
	}
	return game.GameDetails{Game: game.Game{ID: id}}, nil
}

func (r *fakeRepository) GetPlayer(name string) (player.Player, error) {
	value, ok := r.players[name]
	if !ok {
		return player.Player{}, fmt.Errorf("player not found: %s", name)
	}
	return value, nil
}

func (r *fakeRepository) SaveLineup(value Lineup) (int64, error) {
	return 1, nil
}

func (r *fakeRepository) GetLineup(id int64) (Lineup, error) {
	return Lineup{}, nil
}

func (r *fakeRepository) ListLineups(filter ListFilter) ([]Lineup, error) {
	return nil, nil
}

func (r *fakeRepository) AcceptLineup(id int64) (AcceptResult, error) {
	return AcceptResult{}, nil
}

func (r *fakeRepository) RejectLineup(id int64) error {
	return nil
}
