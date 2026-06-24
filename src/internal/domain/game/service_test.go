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
		[]PlateAppearance{{
			Inning:        1,
			Half:          HalfTop,
			Batter:        " 张三 ",
			Pitcher:       " 李四 ",
			EventType:     EventTypeSingle,
			PitchSequence: " B,S,X ",
			Outs:          0,
			BaseState:     0,
			RunsScored:    0,
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
	if repo.createdEvents[0].Batter != "张三" || repo.createdEvents[0].Pitcher != "李四" || repo.createdEvents[0].Description != "张三中前安打" {
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

func TestServiceAddPlateAppearanceRejectsInvalidOuts(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	_, err := service.AddPlateAppearance(1, 1, HalfTop, "张三", "李四", EventTypeSingle, "B,S,X", 3, 0, 0, "安打")
	if err == nil {
		t.Fatal("expected invalid outs to fail")
	}
	if !strings.Contains(err.Error(), "invalid --outs") {
		t.Fatalf("unexpected error: %v", err)
	}
}

type fakeRepo struct {
	createdGame      Game
	createdLineups   []GameLineup
	createdEvents    []PlateAppearance
	addedLineup      GameLineup
	addedEvent       PlateAppearance
	setScoreGameID   int64
	setOwnScore      int
	setOpponentScore int
}

func (r *fakeRepo) CreateGame(game Game, lineups []GameLineup, events []PlateAppearance) (int64, error) {
	r.createdGame = game
	r.createdLineups = lineups
	r.createdEvents = events
	return 1, nil
}

func (r *fakeRepo) AddGameLineup(lineup GameLineup) (int64, error) {
	r.addedLineup = lineup
	return 1, nil
}

func (r *fakeRepo) AddPlateAppearance(event PlateAppearance) (int64, error) {
	r.addedEvent = event
	return 1, nil
}

func (r *fakeRepo) SetGameScore(gameID int64, ownScore int, opponentScore int) error {
	r.setScoreGameID = gameID
	r.setOwnScore = ownScore
	r.setOpponentScore = opponentScore
	return nil
}

func (r *fakeRepo) GetGame(id int64) (GameDetails, error) {
	return GameDetails{Game: Game{ID: id}}, nil
}

func (r *fakeRepo) ListGames(filter GameListFilter) ([]Game, error) {
	return []Game{{Date: filter.Date}}, nil
}
