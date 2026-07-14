package person

import (
	"fmt"
	"strings"
	"time"

	"teamops/internal/domain/common"
	"teamops/internal/domain/game"
	"teamops/internal/domain/player"
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
	return s.ReadPersonAnalysisForTeam(nameRaw, "", fromRaw, toRaw)
}

type teamRepository interface {
	ResolvePersonTeam(name, team string) (teamID int64, own bool, error error)
}

type playerKeyRepository interface {
	GetPlayerByKey(string) (player.Player, error)
}

// ReadPersonAnalysisByKey resolves the database-local public identity before
// using the existing player_id + team_id constrained analysis path.
func (s *Service) ReadPersonAnalysisByKey(key, from, to string) (AnalysisResult, error) {
	repo, ok := s.repo.(playerKeyRepository)
	if !ok {
		return AnalysisResult{}, fmt.Errorf("player-key repository is unavailable")
	}
	p, err := repo.GetPlayerByKey(strings.TrimSpace(key))
	if err != nil {
		return AnalysisResult{}, fmt.Errorf("player not found: %s", key)
	}
	return s.ReadPersonAnalysisForTeam(p.Name, p.Team, from, to)
}

func (s *Service) ReadPersonAnalysisForTeam(nameRaw, teamRaw, fromRaw, toRaw string) (AnalysisResult, error) {
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

	teamID := int64(0)
	own := true
	if repo, ok := s.repo.(teamRepository); ok {
		teamID, own, err = repo.ResolvePersonTeam(name, strings.TrimSpace(teamRaw))
		if err != nil {
			return AnalysisResult{}, err
		}
	} else {
		exists, e := s.repo.PlayerExists(name)
		if e != nil {
			return AnalysisResult{}, e
		}
		if !exists {
			return AnalysisResult{}, fmt.Errorf("player not found: %s", name)
		}
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
	if teamID > 0 && !own {
		allowed := map[int64]bool{}
		filtered := gamesInSpan[:0]
		for _, g := range gamesInSpan {
			if g.OpponentTeamID == teamID {
				filtered = append(filtered, g)
				allowed[g.ID] = true
			}
		}
		gamesInSpan = filtered
		a2 := analyses[:0]
		for _, a := range analyses {
			if allowed[a.GameID] {
				a2 = append(a2, a)
			}
		}
		analyses = a2
		if len(gamesInSpan) == 0 || len(analyses) == 0 {
			return AnalysisResult{}, fmt.Errorf("no analyzable games in span")
		}
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
	if teamID > 0 {
		batting = filterBatting(batting, teamID)
		baserunning = filterBaserunning(baserunning, teamID)
		pitching = filterPitching(pitching, teamID)
		fielding = filterFielding(fielding, teamID)
		summaries = filterSummaries(summaries, teamID)
	}

	if len(batting) == 0 && len(baserunning) == 0 && len(pitching) == 0 && len(fielding) == 0 {
		return AnalysisResult{}, fmt.Errorf("no player stats in span: %s", name)
	}

	computedAt := s.now().Format(time.RFC3339)
	return BuildPersonAnalysis(name, from, to, computedAt, gamesInSpan, analyses, batting, baserunning, pitching, fielding, summaries), nil
}

func filterBatting(v []game.PlayerBattingStats, id int64) []game.PlayerBattingStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterBaserunning(v []game.PlayerBaserunningStats, id int64) []game.PlayerBaserunningStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterPitching(v []game.PlayerPitchingStats, id int64) []game.PlayerPitchingStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterFielding(v []game.PlayerFieldingStats, id int64) []game.PlayerFieldingStats {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
func filterSummaries(v []game.PlayerPerformanceSummary, id int64) []game.PlayerPerformanceSummary {
	out := v[:0]
	for _, x := range v {
		if x.TeamID == id {
			out = append(out, x)
		}
	}
	return out
}
