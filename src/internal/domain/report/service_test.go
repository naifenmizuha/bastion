package report

import (
	"strings"
	"testing"
)

func TestServiceWriteReportRequiresExistingPlayer(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	_, err := service.WriteReport("不存在", "2026-06-24", "挥棒训练", "节奏更稳定")
	if err == nil {
		t.Fatal("expected missing player to fail")
	}
	if !strings.Contains(err.Error(), "player not found: 不存在") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServiceWriteReportNormalizesFields(t *testing.T) {
	repo := &fakeRepo{existingPlayers: map[string]bool{"张三": true}}
	service := NewService(repo)

	report, err := service.WriteReport(" 张三 ", " 2026-06-24 ", " 挥棒训练 ", " 节奏更稳定 ")
	if err != nil {
		t.Fatalf("WriteReport failed: %v", err)
	}

	if report.Name != "张三" || report.Date != "2026-06-24" || report.Content != "挥棒训练" || report.Reflection != "节奏更稳定" {
		t.Fatalf("unexpected report: %+v", report)
	}
	if repo.upsertedReport != report {
		t.Fatalf("repo received unexpected report: %+v", repo.upsertedReport)
	}
}

type fakeRepo struct {
	upsertedReport  Report
	existingPlayers map[string]bool
}

func (r *fakeRepo) PlayerExists(name string) (bool, error) {
	return r.existingPlayers[name], nil
}

func (r *fakeRepo) UpsertReport(report Report) error {
	r.upsertedReport = report
	return nil
}

func (r *fakeRepo) GetReport(name string, date string) (Report, error) {
	return Report{Name: name, Date: date}, nil
}
