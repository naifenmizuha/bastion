package report

import (
	"errors"
	"fmt"
	"strings"

	"bastion/internal/domain/common"
)

type Repository interface {
	PlayerExists(name string) (bool, error)
	UpsertReport(report Report) error
	GetReport(name string, date string) (Report, error)
}

type Service struct {
	repo Repository
}

// NewService 用数据仓库创建训练报告领域服务。
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// WriteReport 校验球员与内容后，新建或覆盖其当日训练报告。
func (s *Service) WriteReport(name string, dateRaw string, content string, reflection string) (Report, error) {
	// 日期在入口处统一规范化，保证唯一键按同一天匹配。
	date, err := common.NormalizeDate(dateRaw)
	if err != nil {
		return Report{}, err
	}

	report := Report{
		Name:       strings.TrimSpace(name),
		Date:       date,
		Content:    strings.TrimSpace(content),
		Reflection: strings.TrimSpace(reflection),
	}
	if report.Name == "" {
		return Report{}, errors.New("--name cannot be empty")
	}
	if report.Content == "" {
		return Report{}, errors.New("--content cannot be empty")
	}
	if report.Reflection == "" {
		return Report{}, errors.New("--reflection cannot be empty")
	}

	// 报告必须归属已登记球员，确认后才执行写入。
	exists, err := s.repo.PlayerExists(report.Name)
	if err != nil {
		return Report{}, err
	}
	if !exists {
		return Report{}, fmt.Errorf("player not found: %s", report.Name)
	}
	if err := s.repo.UpsertReport(report); err != nil {
		return Report{}, err
	}
	return report, nil
}

// GetReport 按球员和规范化日期读取单日训练报告。
func (s *Service) GetReport(name string, dateRaw string) (Report, error) {
	date, err := common.NormalizeDate(dateRaw)
	if err != nil {
		return Report{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return Report{}, errors.New("--name cannot be empty")
	}
	return s.repo.GetReport(name, date)
}
