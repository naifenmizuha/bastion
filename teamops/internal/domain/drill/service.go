package drill

import (
	"errors"
	"fmt"
	"strings"
)

type Repository interface {
	PlayerExists(name string) (bool, error)
	CreateRecommendation(r Recommendation) (int64, error)
	ListRecommendations(filter ListFilter) ([]Recommendation, error)
	GetRecommendation(id int64) (Recommendation, error)
	UpdateRecommendationReview(id int64, isApproved bool, reviewedBy string, reviewSummary string, reviewNote string) error
}

type Service struct {
	repo Repository
}

// NewService 用数据仓库创建训练推荐领域服务。
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// WriteRecommendation 校验推荐内容及球员存在性后保存训练建议。
func (s *Service) WriteRecommendation(name string, url string, reason string, drillType DrillType, summary string) (int64, error) {
	// 先清理外部输入并拒绝不完整或无效类型的推荐。
	r := Recommendation{
		Name:    strings.TrimSpace(name),
		URL:     strings.TrimSpace(url),
		Reason:  strings.TrimSpace(reason),
		Type:    drillType,
		Summary: strings.TrimSpace(summary),
	}
	if r.Name == "" {
		return 0, errors.New("--name cannot be empty")
	}
	if r.URL == "" {
		return 0, errors.New("--url cannot be empty")
	}
	if r.Reason == "" {
		return 0, errors.New("--reason cannot be empty")
	}
	if r.Summary == "" {
		return 0, errors.New("--summary cannot be empty")
	}
	if err := ValidateDrillType(r.Type); err != nil {
		return 0, err
	}

	// 推荐必须关联已登记球员，避免产生孤立训练记录。
	exists, err := s.repo.PlayerExists(r.Name)
	if err != nil {
		return 0, err
	}
	if !exists {
		return 0, fmt.Errorf("player not found: %s", r.Name)
	}

	return s.repo.CreateRecommendation(r)
}

// ListRecommendations 按已校验的条件查询训练推荐。
func (s *Service) ListRecommendations(filter ListFilter) ([]Recommendation, error) {
	filter.Name = strings.TrimSpace(filter.Name)
	if filter.Status != nil {
		if err := ValidateReviewStatus(*filter.Status); err != nil {
			return nil, err
		}
	}
	return s.repo.ListRecommendations(filter)
}

// ApproveRecommendation 以批准状态记录教练审核意见。
func (s *Service) ApproveRecommendation(recommendationID int64, coach string, summary string, note string) error {
	return s.reviewRecommendation(recommendationID, true, coach, summary, note, "--note")
}

// RejectRecommendation 以拒绝状态记录教练审核意见和原因。
func (s *Service) RejectRecommendation(recommendationID int64, coach string, summary string, reason string) error {
	return s.reviewRecommendation(recommendationID, false, coach, summary, reason, "--reason")
}

// ListTrainings 仅列出已批准、可作为训练内容的推荐。
func (s *Service) ListTrainings(filter ListFilter) ([]Recommendation, error) {
	approved := ReviewStatusApproved
	filter.Name = strings.TrimSpace(filter.Name)
	filter.Status = &approved
	return s.repo.ListRecommendations(filter)
}

// GetTraining 读取指定的已批准训练，拒绝未审核或被拒绝的记录。
func (s *Service) GetTraining(recommendationID int64) (Recommendation, error) {
	r, err := s.repo.GetRecommendation(recommendationID)
	if err != nil {
		return Recommendation{}, err
	}
	if !r.IsApproved {
		return Recommendation{}, fmt.Errorf("drill training not found: %d", recommendationID)
	}
	return r, nil
}

// reviewRecommendation 复用批准与拒绝流程的输入校验和审核写入。
func (s *Service) reviewRecommendation(recommendationID int64, isApproved bool, coach string, summary string, note string, noteFlag string) error {
	// 审核记录的每个字段均需有值，保证后续可追溯。
	reviewedBy := strings.TrimSpace(coach)
	reviewSummary := strings.TrimSpace(summary)
	reviewNote := strings.TrimSpace(note)
	if recommendationID <= 0 {
		return errors.New("--recommendation-id must be positive")
	}
	if reviewedBy == "" {
		return errors.New("--coach cannot be empty")
	}
	if reviewSummary == "" {
		return errors.New("--summary cannot be empty")
	}
	if reviewNote == "" {
		return fmt.Errorf("%s cannot be empty", noteFlag)
	}
	if _, err := s.repo.GetRecommendation(recommendationID); err != nil {
		return err
	}
	return s.repo.UpdateRecommendationReview(recommendationID, isApproved, reviewedBy, reviewSummary, reviewNote)
}
