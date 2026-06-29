package lineup

import (
	"fmt"
	"strings"

	"bastion/internal/domain/game"
	"bastion/internal/domain/player"
)

type Repository interface {
	GetGame(id int64) (game.GameDetails, error)
	GetPlayer(name string) (player.Player, error)
	SaveLineup(lineup Lineup) (int64, error)
	GetLineup(id int64) (Lineup, error)
	ListLineups(filter ListFilter) ([]Lineup, error)
	AcceptLineup(id int64) (AcceptResult, error)
	RejectLineup(id int64) error
}

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Validate 检查阵容全部硬约束，并一次返回所有可修复问题。
func (s *Service) Validate(draft Draft) (ValidationResult, error) {
	result := ValidationResult{
		GameID:       draft.GameID,
		StarterCount: len(draft.Starters),
		BenchCount:   len(draft.Bench),
		Errors:       []Issue{},
		Warnings:     []Issue{},
	}
	if draft.SchemaVersion != "1.0" {
		result.Errors = append(result.Errors, issue("invalid_schema_version", "schema_version", "", "", `schema_version must be "1.0"`))
	}
	if draft.GameID <= 0 {
		result.Errors = append(result.Errors, issue("game_not_found", "game_id", "", "", "game_id must be greater than 0"))
	} else {
		details, err := s.repo.GetGame(draft.GameID)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				result.Errors = append(result.Errors, issue("game_not_found", "game_id", "", "", err.Error()))
			} else {
				return result, err
			}
		} else if details.Game.IsFinal {
			result.Errors = append(result.Errors, issue("game_already_final", "game_id", "", "", "cannot create a lineup for a final game"))
		}
	}

	if len(draft.Starters) != 9 {
		result.Errors = append(result.Errors, issue("invalid_starter_count", "starters", "", "", fmt.Sprintf("starting lineup must contain 9 players, got %d", len(draft.Starters))))
	}

	seenPlayers := map[string]string{}
	seenOrders := map[int]bool{}
	seenPositions := map[int]bool{}
	var startingPitcher string
	for i := range draft.Starters {
		starter := &draft.Starters[i]
		starter.Player = strings.TrimSpace(starter.Player)
		field := fmt.Sprintf("starters[%d]", i)
		if starter.Player == "" {
			result.Errors = append(result.Errors, issue("player_not_found", field+".player", "", "", "player cannot be empty"))
		} else if previous, exists := seenPlayers[starter.Player]; exists {
			result.Errors = append(result.Errors, issue("duplicate_player", field+".player", starter.Player, "", fmt.Sprintf("player already used in %s", previous)))
		} else {
			seenPlayers[starter.Player] = field
		}
		if starter.BattingOrder < 1 || starter.BattingOrder > 9 {
			result.Errors = append(result.Errors, issue("batting_order_uncovered", field+".batting_order", starter.Player, "", "batting_order must be between 1 and 9"))
		} else if seenOrders[starter.BattingOrder] {
			result.Errors = append(result.Errors, issue("duplicate_batting_order", field+".batting_order", starter.Player, "", fmt.Sprintf("batting order %d is duplicated", starter.BattingOrder)))
		} else {
			seenOrders[starter.BattingOrder] = true
		}
		if starter.Position < 1 || starter.Position > 9 {
			result.Errors = append(result.Errors, issue("position_uncovered", field+".position", starter.Player, "", "position must be one of P,C,1B,2B,3B,SS,LF,CF,RF"))
		} else if seenPositions[starter.Position] {
			result.Errors = append(result.Errors, issue("duplicate_position", field+".position", starter.Player, FormatPosition(starter.Position), fmt.Sprintf("position %s is duplicated", FormatPosition(starter.Position))))
		} else {
			seenPositions[starter.Position] = true
			if starter.Position == 1 {
				startingPitcher = starter.Player
			}
		}
		if starter.Player != "" {
			s.validatePlayerPosition(&result, starter.Player, starter.Position, field+".position")
		}
	}
	for value := 1; value <= 9; value++ {
		if !seenOrders[value] {
			result.Errors = append(result.Errors, issue("batting_order_uncovered", "starters", "", "", fmt.Sprintf("batting order %d is not covered", value)))
		}
		if !seenPositions[value] {
			result.Errors = append(result.Errors, issue("position_uncovered", "starters", "", FormatPosition(value), fmt.Sprintf("position %s is not covered", FormatPosition(value))))
		}
	}

	for i := range draft.Bench {
		entry := &draft.Bench[i]
		entry.Player = strings.TrimSpace(entry.Player)
		field := fmt.Sprintf("bench[%d].player", i)
		if entry.Player == "" {
			result.Errors = append(result.Errors, issue("player_not_found", field, "", "", "player cannot be empty"))
			continue
		}
		if previous, exists := seenPlayers[entry.Player]; exists {
			code := "duplicate_player"
			if strings.HasPrefix(previous, "starters") {
				code = "starter_bench_conflict"
			}
			result.Errors = append(result.Errors, issue(code, field, entry.Player, "", fmt.Sprintf("player already used in %s", previous)))
			continue
		}
		seenPlayers[entry.Player] = fmt.Sprintf("bench[%d]", i)
		if _, err := s.repo.GetPlayer(entry.Player); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "not found") {
				result.Errors = append(result.Errors, issue("player_not_found", field, entry.Player, "", err.Error()))
			} else {
				return result, err
			}
		}
	}

	if len(draft.PitchingPlan) == 0 {
		result.Warnings = append(result.Warnings, issue("pitching_plan_empty", "pitching_plan", "", "", "pitching plan is empty"))
	} else {
		totalInnings := 0
		seenPitchers := map[string]bool{}
		for i := range draft.PitchingPlan {
			plan := &draft.PitchingPlan[i]
			plan.Player = strings.TrimSpace(plan.Player)
			field := fmt.Sprintf("pitching_plan[%d]", i)
			if seenPitchers[plan.Player] {
				result.Errors = append(result.Errors, issue("duplicate_player", field+".player", plan.Player, "", "pitcher is duplicated in pitching plan"))
			}
			seenPitchers[plan.Player] = true
			if i == 0 && plan.Role != PitchingRoleStarter || i > 0 && plan.Role != PitchingRoleReliever {
				result.Errors = append(result.Errors, issue("invalid_pitching_role", field+".role", plan.Player, "", "first pitcher must be starter and remaining pitchers must be relievers"))
			}
			p, err := s.repo.GetPlayer(plan.Player)
			if err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "not found") {
					result.Errors = append(result.Errors, issue("player_not_found", field+".player", plan.Player, "", err.Error()))
					continue
				}
				return result, err
			}
			if p.Positions&player.PositionPitcher == 0 {
				result.Errors = append(result.Errors, issue("pitcher_not_eligible", field+".player", plan.Player, "P", "player is not eligible to pitch"))
			}
			if plan.PlannedInnings != nil {
				if *plan.PlannedInnings <= 0 {
					result.Errors = append(result.Errors, issue("invalid_value", field+".planned_innings", plan.Player, "", "planned_innings must be greater than 0"))
				} else {
					totalInnings += *plan.PlannedInnings
				}
			}
		}
		if draft.PitchingPlan[0].Player != startingPitcher {
			result.Errors = append(result.Errors, issue("starter_pitcher_mismatch", "pitching_plan[0].player", draft.PitchingPlan[0].Player, "P", fmt.Sprintf("pitching plan starter must match lineup pitcher %q", startingPitcher)))
		}
		if totalInnings > 9 {
			result.Warnings = append(result.Warnings, issue("planned_innings_exceed_game", "pitching_plan", "", "", fmt.Sprintf("planned innings total %d exceeds 9", totalInnings)))
		}
	}

	sortIssues(result.Errors)
	sortIssues(result.Warnings)
	result.Valid = len(result.Errors) == 0
	return result, nil
}

func (s *Service) validatePlayerPosition(result *ValidationResult, name string, position int, field string) {
	p, err := s.repo.GetPlayer(name)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			result.Errors = append(result.Errors, issue("player_not_found", strings.TrimSuffix(field, ".position")+".player", name, "", err.Error()))
			return
		}
		result.Errors = append(result.Errors, issue("player_lookup_failed", field, name, "", err.Error()))
		return
	}
	if !eligibleForPosition(p.Positions, position) {
		result.Errors = append(result.Errors, Issue{
			Code:             "player_position_unsupported",
			Field:            field,
			Player:           name,
			Position:         FormatPosition(position),
			AllowedPositions: allowedPositionNames(p.Positions),
			Message:          fmt.Sprintf("player %q cannot play %s", name, FormatPosition(position)),
		})
	}
}

// Write 校验并保存一个不可变候选方案。
func (s *Service) Write(draft Draft) (int64, ValidationResult, error) {
	result, err := s.Validate(draft)
	if err != nil || !result.Valid {
		return 0, result, err
	}
	lineup := lineupFromDraft(draft, result.Warnings)
	id, err := s.repo.SaveLineup(lineup)
	return id, result, err
}

func (s *Service) Get(id int64) (Lineup, error) {
	if id <= 0 {
		return Lineup{}, fmt.Errorf("invalid --id %d, expected greater than 0", id)
	}
	return s.repo.GetLineup(id)
}

func (s *Service) List(gameID int64, status *Status) ([]Lineup, error) {
	if gameID < 0 {
		return nil, fmt.Errorf("invalid --game-id %d, expected greater than 0", gameID)
	}
	return s.repo.ListLineups(ListFilter{GameID: gameID, Status: status})
}

// Accept 重新校验当前数据后将方案同步为正式比赛阵容。
func (s *Service) Accept(id int64) (AcceptResult, error) {
	saved, err := s.Get(id)
	if err != nil {
		return AcceptResult{}, err
	}
	if saved.Status != StatusValidated {
		return AcceptResult{}, fmt.Errorf("lineup not validated: %d has status %s", id, FormatStatus(saved.Status))
	}
	result, err := s.Validate(draftFromLineup(saved))
	if err != nil {
		return AcceptResult{}, err
	}
	if !result.Valid {
		return AcceptResult{}, fmt.Errorf("lineup stale: %s", summarizeIssues(result.Errors))
	}
	return s.repo.AcceptLineup(id)
}

func (s *Service) Reject(id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid --id %d, expected greater than 0", id)
	}
	return s.repo.RejectLineup(id)
}

func lineupFromDraft(draft Draft, warnings []Issue) Lineup {
	result := Lineup{
		GameID:        draft.GameID,
		SchemaVersion: draft.SchemaVersion,
		Status:        StatusValidated,
		Strategy:      strings.TrimSpace(draft.Strategy),
		Reasoning:     append([]string(nil), draft.Reasoning...),
		Warnings:      append([]Issue(nil), warnings...),
		Entries:       []Entry{},
		PitchingPlan:  append([]PitchingPlan(nil), draft.PitchingPlan...),
	}
	for _, starter := range draft.Starters {
		order, position := starter.BattingOrder, starter.Position
		result.Entries = append(result.Entries, Entry{Player: strings.TrimSpace(starter.Player), Role: RoleStarter, BattingOrder: &order, Position: &position})
	}
	for _, bench := range draft.Bench {
		result.Entries = append(result.Entries, Entry{Player: strings.TrimSpace(bench.Player), Role: RoleBench, SuggestedRole: strings.TrimSpace(bench.SuggestedRole)})
	}
	return result
}

func draftFromLineup(saved Lineup) Draft {
	draft := Draft{
		SchemaVersion: saved.SchemaVersion,
		GameID:        saved.GameID,
		Strategy:      saved.Strategy,
		Reasoning:     append([]string(nil), saved.Reasoning...),
		PitchingPlan:  append([]PitchingPlan(nil), saved.PitchingPlan...),
	}
	for _, entry := range saved.Entries {
		if entry.Role == RoleStarter && entry.BattingOrder != nil && entry.Position != nil {
			draft.Starters = append(draft.Starters, Starter{Player: entry.Player, BattingOrder: *entry.BattingOrder, Position: *entry.Position})
		} else if entry.Role == RoleBench {
			draft.Bench = append(draft.Bench, BenchEntry{Player: entry.Player, SuggestedRole: entry.SuggestedRole})
		}
	}
	return draft
}

func issue(code, field, playerName, position, message string) Issue {
	return Issue{Code: code, Field: field, Player: playerName, Position: position, Message: message}
}

func summarizeIssues(issues []Issue) string {
	if len(issues) == 0 {
		return ""
	}
	values := make([]string, 0, len(issues))
	for _, value := range issues {
		values = append(values, value.Code+": "+value.Message)
	}
	return strings.Join(values, "; ")
}
