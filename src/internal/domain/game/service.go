package game

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"bastion/internal/domain/common"
)

type Repository interface {
	CreateGame(game Game, lineups []GameLineup, events []GameEvent) (int64, error)
	AddGameLineup(lineup GameLineup) (int64, error)
	AddGameEvents(gameID int64, events []GameEvent) (int, error)
	SetGameScore(gameID int64, ownScore int, opponentScore int) error
	GetGame(id int64) (GameDetails, error)
	ListGames(filter GameListFilter) ([]Game, error)
	ReplaceGameAnalysis(result GameAnalysisResult) error
	GetGameAnalysis(gameID int64, player string) (GameAnalysisResult, error)
	ListGameAnalyses() ([]GameAnalysisListItem, error)
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) WriteGame(dateRaw string, startTime string, opponent string, battingSide BattingSide, ownScore int, opponentScore int, raw string, lineups []GameLineup, events []GameEvent) (int64, error) {
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
		if err := prepareGameEvent(&events[i], 0); err != nil {
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

func (s *Service) WriteGameEvents(gameID int64, events []GameEvent) (int, error) {
	if gameID <= 0 {
		return 0, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	if len(events) == 0 {
		return 0, errors.New("--events-json cannot be empty")
	}
	for i := range events {
		if err := prepareGameEvent(&events[i], gameID); err != nil {
			return 0, fmt.Errorf("invalid event %d: %w", i+1, err)
		}
	}
	return s.repo.AddGameEvents(gameID, events)
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

func (s *Service) GenerateGameAnalysis(gameID int64) (int64, error) {
	if gameID <= 0 {
		return 0, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	details, err := s.repo.GetGame(gameID)
	if err != nil {
		return 0, err
	}
	analysis, err := BuildGameAnalysis(details, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return 0, err
	}
	if err := s.repo.ReplaceGameAnalysis(analysis); err != nil {
		return 0, err
	}
	return gameID, nil
}

func (s *Service) ReadGameAnalysis(gameID int64, player string) (GameAnalysisResult, error) {
	if gameID <= 0 {
		return GameAnalysisResult{}, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	return s.repo.GetGameAnalysis(gameID, strings.TrimSpace(player))
}

func (s *Service) ListGameAnalyses() ([]GameAnalysisListItem, error) {
	return s.repo.ListGameAnalyses()
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

func prepareGameEvent(event *GameEvent, gameID int64) error {
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
	if err := ValidatePlayNo(event.PlayNo); err != nil {
		return err
	}
	if event.Sequence <= 0 {
		return fmt.Errorf("invalid --sequence %d, expected greater than 0", event.Sequence)
	}
	if err := ValidateEventKind(event.EventKind); err != nil {
		return err
	}
	event.Player = strings.TrimSpace(event.Player)
	if event.Player == "" {
		return errors.New("--player cannot be empty")
	}
	if err := ValidateTeam(event.Team); err != nil {
		return err
	}
	if err := ValidateResult(event.EventKind, event.Result); err != nil {
		return err
	}
	event.RelatedPlayer = strings.TrimSpace(event.RelatedPlayer)
	event.PitchSequence = strings.TrimSpace(event.PitchSequence)
	event.RBIPlayer = strings.TrimSpace(event.RBIPlayer)
	event.Description = strings.TrimSpace(event.Description)
	if event.Value == 0 {
		event.Value = 1
	}
	if event.Value < 0 {
		return fmt.Errorf("invalid --value %d, expected >= 0", event.Value)
	}
	if event.OutsOnPlay < 0 {
		return fmt.Errorf("invalid --outs-on-play %d, expected >= 0", event.OutsOnPlay)
	}
	if event.RunsScored < 0 {
		return fmt.Errorf("invalid --runs-scored %d, expected >= 0", event.RunsScored)
	}
	if err := ValidateBaseFrom(event.BaseFrom); err != nil {
		return err
	}
	if err := ValidateBaseTo(event.BaseTo); err != nil {
		return err
	}
	switch event.EventKind {
	case EventKindPlateResult:
		if event.RelatedPlayer == "" {
			return errors.New("--related-player cannot be empty for plate_result")
		}
		if event.PitchSequence == "" {
			return errors.New("--pitch-sequence cannot be empty for plate_result")
		}
	case EventKindRunnerMovement:
		if event.BaseFrom == nil {
			return errors.New("--base-from cannot be empty for runner_movement")
		}
		if RunnerResult(event.Result) != RunnerResultOut && event.BaseTo == nil {
			return errors.New("--base-to cannot be empty for runner_movement unless result is out")
		}
		if event.Reason == nil {
			other := RunnerReasonOther
			event.Reason = &other
		}
		if err := ValidateRunnerReason(*event.Reason); err != nil {
			return err
		}
	}
	return nil
}
