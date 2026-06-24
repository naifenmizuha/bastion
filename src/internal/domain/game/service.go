package game

import (
	"errors"
	"fmt"
	"strings"

	"bastion/internal/domain/common"
)

type Repository interface {
	CreateGame(game Game, lineups []GameLineup, events []PlateAppearance) (int64, error)
	AddGameLineup(lineup GameLineup) (int64, error)
	AddPlateAppearance(event PlateAppearance) (int64, error)
	SetGameScore(gameID int64, ownScore int, opponentScore int) error
	GetGame(id int64) (GameDetails, error)
	ListGames(filter GameListFilter) ([]Game, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) WriteGame(dateRaw string, startTime string, opponent string, battingSide BattingSide, ownScore int, opponentScore int, raw string, lineups []GameLineup, events []PlateAppearance) (int64, error) {
	game, err := prepareGame(dateRaw, startTime, opponent, battingSide, ownScore, opponentScore, true, raw)
	if err != nil {
		return 0, err
	}
	for i := range lineups {
		if err := prepareLineup(&lineups[i], 0); err != nil {
			return 0, fmt.Errorf("invalid lineup %d: %w", i+1, err)
		}
	}
	for i := range events {
		if err := preparePlateAppearance(&events[i], 0); err != nil {
			return 0, fmt.Errorf("invalid event %d: %w", i+1, err)
		}
	}
	return s.repo.CreateGame(game, lineups, events)
}

func (s *Service) CreateGame(dateRaw string, startTime string, opponent string, battingSide BattingSide, raw string) (int64, error) {
	game, err := prepareGame(dateRaw, startTime, opponent, battingSide, 0, 0, false, raw)
	if err != nil {
		return 0, err
	}
	return s.repo.CreateGame(game, nil, nil)
}

func (s *Service) AddGameLineup(gameID int64, team Team, player string, battingOrder *int, startingPosition *int) (int64, error) {
	if gameID <= 0 {
		return 0, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	lineup := GameLineup{
		GameID:           gameID,
		Team:             team,
		Player:           player,
		BattingOrder:     battingOrder,
		StartingPosition: startingPosition,
	}
	if err := prepareLineup(&lineup, gameID); err != nil {
		return 0, err
	}
	return s.repo.AddGameLineup(lineup)
}

func (s *Service) AddPlateAppearance(gameID int64, inning int, half Half, batter string, pitcher string, eventType EventType, pitchSequence string, outs int, baseState int, runsScored int, description string) (int64, error) {
	if gameID <= 0 {
		return 0, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	event := PlateAppearance{
		GameID:        gameID,
		Inning:        inning,
		Half:          half,
		Batter:        batter,
		Pitcher:       pitcher,
		EventType:     eventType,
		PitchSequence: pitchSequence,
		Outs:          outs,
		BaseState:     baseState,
		RunsScored:    runsScored,
		Description:   description,
	}
	if err := preparePlateAppearance(&event, gameID); err != nil {
		return 0, err
	}
	return s.repo.AddPlateAppearance(event)
}

func (s *Service) SetGameScore(gameID int64, ownScore int, opponentScore int) error {
	if gameID <= 0 {
		return fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	if ownScore < 0 {
		return fmt.Errorf("invalid --own-score %d, expected >= 0", ownScore)
	}
	if opponentScore < 0 {
		return fmt.Errorf("invalid --opponent-score %d, expected >= 0", opponentScore)
	}
	return s.repo.SetGameScore(gameID, ownScore, opponentScore)
}

func (s *Service) GetGame(id int64) (GameDetails, error) {
	if id <= 0 {
		return GameDetails{}, fmt.Errorf("invalid --id %d, expected greater than 0", id)
	}
	return s.repo.GetGame(id)
}

func (s *Service) ListGames(dateRaw string) ([]Game, error) {
	filter := GameListFilter{}
	if strings.TrimSpace(dateRaw) != "" {
		date, err := common.NormalizeDate(dateRaw)
		if err != nil {
			return nil, err
		}
		filter.Date = date
	}
	return s.repo.ListGames(filter)
}

func prepareGame(dateRaw string, startTime string, opponent string, battingSide BattingSide, ownScore int, opponentScore int, isFinal bool, raw string) (Game, error) {
	date, err := common.NormalizeDate(dateRaw)
	if err != nil {
		return Game{}, err
	}
	game := Game{
		Date:          date,
		StartTime:     strings.TrimSpace(startTime),
		Opponent:      strings.TrimSpace(opponent),
		BattingSide:   battingSide,
		OwnScore:      ownScore,
		OpponentScore: opponentScore,
		IsFinal:       isFinal,
		Raw:           strings.TrimSpace(raw),
	}
	if game.Opponent == "" {
		return Game{}, errors.New("--opponent cannot be empty")
	}
	if err := ValidateBattingSide(game.BattingSide); err != nil {
		return Game{}, err
	}
	if game.OwnScore < 0 {
		return Game{}, fmt.Errorf("invalid --own-score %d, expected >= 0", game.OwnScore)
	}
	if game.OpponentScore < 0 {
		return Game{}, fmt.Errorf("invalid --opponent-score %d, expected >= 0", game.OpponentScore)
	}
	if game.Raw == "" {
		return Game{}, errors.New("--raw cannot be empty")
	}
	return game, nil
}

func prepareLineup(lineup *GameLineup, gameID int64) error {
	if gameID > 0 {
		lineup.GameID = gameID
	}
	if lineup.GameID < 0 {
		return fmt.Errorf("invalid --game-id %d, expected greater than 0", lineup.GameID)
	}
	if err := ValidateTeam(lineup.Team); err != nil {
		return err
	}
	lineup.Player = strings.TrimSpace(lineup.Player)
	if lineup.Player == "" {
		return errors.New("--player cannot be empty")
	}
	if err := ValidateBattingOrder(lineup.BattingOrder); err != nil {
		return err
	}
	if err := ValidateStartingPosition(lineup.StartingPosition); err != nil {
		return err
	}
	return nil
}

func preparePlateAppearance(event *PlateAppearance, gameID int64) error {
	if gameID > 0 {
		event.GameID = gameID
	}
	if event.GameID < 0 {
		return fmt.Errorf("invalid --game-id %d, expected greater than 0", event.GameID)
	}
	if event.Inning < 1 {
		return fmt.Errorf("invalid --inning %d, expected >= 1", event.Inning)
	}
	if err := ValidateHalf(event.Half); err != nil {
		return err
	}
	event.Batter = strings.TrimSpace(event.Batter)
	if event.Batter == "" {
		return errors.New("--batter cannot be empty")
	}
	event.Pitcher = strings.TrimSpace(event.Pitcher)
	if err := ValidateEventType(event.EventType); err != nil {
		return err
	}
	event.PitchSequence = strings.TrimSpace(event.PitchSequence)
	if err := ValidateOuts(event.Outs); err != nil {
		return err
	}
	if err := ValidateBaseState(event.BaseState); err != nil {
		return err
	}
	if event.RunsScored < 0 {
		return fmt.Errorf("invalid --runs-scored %d, expected >= 0", event.RunsScored)
	}
	event.Description = strings.TrimSpace(event.Description)
	if event.Description == "" {
		return errors.New("--description cannot be empty")
	}
	return nil
}
