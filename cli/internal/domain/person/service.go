package person

import (
	"fmt"
	"strings"
	"time"

	"bastion/internal/domain/common"
	"bastion/internal/domain/game"
)

type Repository interface {
	PlayerExists(name string) (bool, error)
	ListFinalGamesInSpan(from, to string) ([]game.Game, error)
	ListAnalysesInSpan(from, to string) ([]game.GameAnalysisListItem, error)
	ListBattingStats(name, from, to string) ([]game.PlayerBattingStats, error)
	ListBaserunningStats(name, from, to string) ([]game.PlayerBaserunningStats, error)
	ListPitchingStats(name, from, to string) ([]game.PlayerPitchingStats, error)
	ListFieldingStats(name, from, to string) ([]game.PlayerFieldingStats, error)
	ListPerformanceSummaries(name, from, to string) ([]game.PlayerPerformanceSummary, error)
}

type Service struct {
	repo Repository
	now  func() time.Time
}

// NewService 用数据仓库和可替换时钟创建个人分析服务。
func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

// ReadPersonAnalysis 读取指定球员在日期范围内的跨比赛表现分析。
func (s *Service) ReadPersonAnalysis(nameRaw, fromRaw, toRaw string) (AnalysisResult, error) {
	// 先规范化查询条件，并确认球员与日期范围有效。
	name := strings.TrimSpace(nameRaw)
	if name == "" {
		return AnalysisResult{}, fmt.Errorf("--name cannot be empty")
	}
	from, err := common.NormalizeDate(fromRaw)
	if err != nil {
		return AnalysisResult{}, err
	}
	to, err := common.NormalizeDate(toRaw)
	if err != nil {
		return AnalysisResult{}, err
	}
	if from > to {
		return AnalysisResult{}, fmt.Errorf("invalid span: --from %s is after --to %s", from, to)
	}

	exists, err := s.repo.PlayerExists(name)
	if err != nil {
		return AnalysisResult{}, err
	}
	if !exists {
		return AnalysisResult{}, fmt.Errorf("player not found: %s", name)
	}

	// 读取范围内的比赛和各维度统计，为最终聚合准备数据。
	gamesInSpan, err := s.repo.ListFinalGamesInSpan(from, to)
	if err != nil {
		return AnalysisResult{}, err
	}
	analyses, err := s.repo.ListAnalysesInSpan(from, to)
	if err != nil {
		return AnalysisResult{}, err
	}
	if len(gamesInSpan) == 0 || len(analyses) == 0 {
		return AnalysisResult{}, fmt.Errorf("no analyzable games in span")
	}

	batting, err := s.repo.ListBattingStats(name, from, to)
	if err != nil {
		return AnalysisResult{}, err
	}
	baserunning, err := s.repo.ListBaserunningStats(name, from, to)
	if err != nil {
		return AnalysisResult{}, err
	}
	pitching, err := s.repo.ListPitchingStats(name, from, to)
	if err != nil {
		return AnalysisResult{}, err
	}
	fielding, err := s.repo.ListFieldingStats(name, from, to)
	if err != nil {
		return AnalysisResult{}, err
	}
	summaries, err := s.repo.ListPerformanceSummaries(name, from, to)
	if err != nil {
		return AnalysisResult{}, err
	}

	if len(batting) == 0 && len(baserunning) == 0 && len(pitching) == 0 && len(fielding) == 0 {
		return AnalysisResult{}, fmt.Errorf("no player stats in span: %s", name)
	}

	computedAt := s.now().Format(time.RFC3339)
	return BuildPersonAnalysis(name, from, to, computedAt, gamesInSpan, analyses, batting, baserunning, pitching, fielding, summaries), nil
}
