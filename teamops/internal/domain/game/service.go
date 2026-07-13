package game

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"teamops/internal/domain/common"
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

// NewService 用数据仓库创建比赛领域服务。
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// WriteGame 校验完整比赛及其阵容、事件后一次性保存。
func (s *Service) WriteGame(dateRaw string, startTime string, opponent string, battingSide BattingSide, ownScore int, opponentScore int, raw string, lineups []GameLineup, events []GameEvent) (int64, error) {
	// 主记录和子记录均在进入仓库前规范化，保证事务写入的数据一致。
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

// CreateGame 创建尚未完赛、可继续追加阵容和事件的比赛。
func (s *Service) CreateGame(dateRaw string, startTime string, opponent string, battingSide BattingSide, raw string) (int64, error) {
	game, err := prepareGame(dateRaw, startTime, opponent, battingSide, 0, 0, false, raw)
	if err != nil {
		return 0, err
	}
	return s.repo.CreateGame(game, nil, nil)
}

// AddGameLineup 校验后为指定比赛追加一条阵容记录。
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

// WriteGameEvents 校验并批量追加指定比赛的事实事件。
func (s *Service) WriteGameEvents(gameID int64, events []GameEvent) (int, error) {
	if err := s.ValidateGameEvents(gameID, events); err != nil {
		return 0, err
	}
	return s.repo.AddGameEvents(gameID, events)
}

// ValidateGameEvents validates a complete event batch without persisting it.
func (s *Service) ValidateGameEvents(gameID int64, events []GameEvent) error {
	if gameID <= 0 {
		return fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	if len(events) == 0 {
		return errors.New("--events-json cannot be empty")
	}
	if _, err := s.repo.GetGame(gameID); err != nil {
		return err
	}
	for i := range events {
		if err := prepareGameEvent(&events[i], gameID); err != nil {
			return fmt.Errorf("invalid event %d: %w", i+1, err)
		}
	}
	return nil
}

// SetGameScore 设置最终比分，并由仓库将比赛标记为完赛。
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

// GetGame 按编号读取比赛及其阵容、事件明细。
func (s *Service) GetGame(id int64) (GameDetails, error) {
	if id <= 0 {
		return GameDetails{}, fmt.Errorf("invalid --id %d, expected greater than 0", id)
	}
	return s.repo.GetGame(id)
}

// ListGames 按可选日期筛选比赛列表。
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

// GenerateGameAnalysis 基于比赛明细重新生成并替换单场分析结果。
func (s *Service) GenerateGameAnalysis(gameID int64) (int64, error) {
	// 读取原始事实事件、计算统计，再以整体结果原子替换旧分析。
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

// ReadGameAnalysis 读取比赛分析，可选地只保留指定球员的数据。
func (s *Service) ReadGameAnalysis(gameID int64, player string) (GameAnalysisResult, error) {
	return s.ReadGameAnalysisForTeam(gameID, player, "")
}

type analysisTeamRepository interface {
	AnalysisTeamID(gameID int64, team string) (int64, error)
}

func (s *Service) ReadGameAnalysisForTeam(gameID int64, player, team string) (GameAnalysisResult, error) {
	if gameID <= 0 {
		return GameAnalysisResult{}, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	result, err := s.repo.GetGameAnalysis(gameID, strings.TrimSpace(player))
	if err != nil {
		return GameAnalysisResult{}, err
	}
	repo, ok := s.repo.(analysisTeamRepository)
	if !ok {
		return result, nil
	}
	teamID, err := repo.AnalysisTeamID(gameID, strings.TrimSpace(team))
	if err != nil {
		return GameAnalysisResult{}, err
	}
	result.Summaries = filterSummariesByTeam(result.Summaries, teamID)
	result.Batting = filterBattingByTeam(result.Batting, teamID)
	result.Baserunning = filterBaserunningByTeam(result.Baserunning, teamID)
	result.Pitching = filterPitchingByTeam(result.Pitching, teamID)
	result.Fielding = filterFieldingByTeam(result.Fielding, teamID)
	if strings.TrimSpace(player) != "" && len(result.Summaries) == 0 {
		return GameAnalysisResult{}, fmt.Errorf("game player analysis not found: %d %s", gameID, player)
	}
	return result, nil
}

func filterSummariesByTeam(v []PlayerPerformanceSummary, id int64) []PlayerPerformanceSummary {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterBattingByTeam(v []PlayerBattingStats, id int64) []PlayerBattingStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterBaserunningByTeam(v []PlayerBaserunningStats, id int64) []PlayerBaserunningStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterPitchingByTeam(v []PlayerPitchingStats, id int64) []PlayerPitchingStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterFieldingByTeam(v []PlayerFieldingStats, id int64) []PlayerFieldingStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}

// ListGameAnalyses 返回所有已生成分析的比赛摘要。
func (s *Service) ListGameAnalyses() ([]GameAnalysisListItem, error) {
	return s.repo.ListGameAnalyses()
}

// prepareGame 规范化并校验比赛主记录的全部字段。
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

// prepareLineup 补入比赛编号并校验、清理一条阵容记录。
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

// prepareGameEvent 补入比赛编号，并按事件类型校验和规范化比赛事实。
func prepareGameEvent(event *GameEvent, gameID int64) error {
	// 先检查所有事件通用的局数、人员、计数与垒位字段。
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
	// 再补充各事件类型不可缺少的上下文字段和默认跑垒原因。
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
