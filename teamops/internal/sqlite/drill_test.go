package sqlite

import (
	"testing"

	"teamops/internal/domain/drill"
)

func TestStoreDrillRecommendationCreateAndList(t *testing.T) {
	store := newTestStore(t)

	infield := drill.DrillTypeInfield
	pitching := drill.DrillTypePitching

	id1, err := store.CreateRecommendation(drill.Recommendation{
		Name: "张三", URL: "https://example.com/a", Reason: "步伐", Type: drill.DrillTypeInfield, Summary: "内野扑球",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation failed: %v", err)
	}
	id2, err := store.CreateRecommendation(drill.Recommendation{
		Name: "李四", URL: "https://example.com/b", Reason: "发力", Type: drill.DrillTypePitching, Summary: "投球发力",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation failed: %v", err)
	}
	if id1 == 0 || id2 == 0 {
		t.Fatalf("expected non-zero ids, got %d %d", id1, id2)
	}

	all, err := store.ListRecommendations(drill.ListFilter{})
	if err != nil {
		t.Fatalf("ListRecommendations failed: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 recommendations, got %d", len(all))
	}
	if all[0].ID != id2 || all[1].ID != id1 {
		t.Fatalf("expected newest first (id DESC), got %d %d", all[0].ID, all[1].ID)
	}
	if all[0].Type != drill.DrillTypePitching || all[0].Name != "李四" {
		t.Fatalf("unexpected first row: %+v", all[0])
	}

	byName, err := store.ListRecommendations(drill.ListFilter{Name: "张三"})
	if err != nil {
		t.Fatalf("ListRecommendations by name failed: %v", err)
	}
	if len(byName) != 1 || byName[0].Name != "张三" {
		t.Fatalf("expected 1 recommendation for 张三, got %+v", byName)
	}

	byType, err := store.ListRecommendations(drill.ListFilter{Type: &pitching})
	if err != nil {
		t.Fatalf("ListRecommendations by type failed: %v", err)
	}
	if len(byType) != 1 || byType[0].Type != drill.DrillTypePitching {
		t.Fatalf("expected 1 pitching recommendation, got %+v", byType)
	}

	combined, err := store.ListRecommendations(drill.ListFilter{Name: "张三", Type: &infield})
	if err != nil {
		t.Fatalf("ListRecommendations combined failed: %v", err)
	}
	if len(combined) != 1 || combined[0].Name != "张三" || combined[0].Type != drill.DrillTypeInfield {
		t.Fatalf("expected 1 combined recommendation, got %+v", combined)
	}

	none, err := store.ListRecommendations(drill.ListFilter{Name: "张三", Type: &pitching})
	if err != nil {
		t.Fatalf("ListRecommendations none failed: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("expected 0 recommendations for conflicting filter, got %d", len(none))
	}
}

func TestStoreDrillRecommendationReviewLifecycle(t *testing.T) {
	store := newTestStore(t)

	id, err := store.CreateRecommendation(drill.Recommendation{
		Name: "张三", URL: "https://example.com/a", Reason: "步伐", Type: drill.DrillTypeInfield, Summary: "内野扑球",
	})
	if err != nil {
		t.Fatalf("CreateRecommendation failed: %v", err)
	}

	pending := drill.ReviewStatusPending
	pendingRows, err := store.ListRecommendations(drill.ListFilter{Status: &pending})
	if err != nil {
		t.Fatalf("ListRecommendations pending failed: %v", err)
	}
	if len(pendingRows) != 1 || pendingRows[0].ID != id || pendingRows[0].ReviewStatus() != drill.ReviewStatusPending {
		t.Fatalf("expected pending recommendation, got %+v", pendingRows)
	}

	if err := store.UpdateRecommendationReview(id, true, "王教练", "适合内野基础步伐", "下周使用"); err != nil {
		t.Fatalf("UpdateRecommendationReview approve failed: %v", err)
	}
	approved := drill.ReviewStatusApproved
	approvedRows, err := store.ListRecommendations(drill.ListFilter{Status: &approved})
	if err != nil {
		t.Fatalf("ListRecommendations approved failed: %v", err)
	}
	if len(approvedRows) != 1 || !approvedRows[0].IsApproved || approvedRows[0].ReviewedBy != "王教练" || approvedRows[0].ReviewSummary != "适合内野基础步伐" || approvedRows[0].ReviewNote != "下周使用" || approvedRows[0].ReviewedAt == "" {
		t.Fatalf("expected approved recommendation with review fields, got %+v", approvedRows)
	}

	if err := store.UpdateRecommendationReview(id, false, "王教练", "不适合当前阶段", "暂不采用"); err != nil {
		t.Fatalf("UpdateRecommendationReview reject failed: %v", err)
	}
	rejected := drill.ReviewStatusRejected
	rejectedRows, err := store.ListRecommendations(drill.ListFilter{Status: &rejected})
	if err != nil {
		t.Fatalf("ListRecommendations rejected failed: %v", err)
	}
	if len(rejectedRows) != 1 || rejectedRows[0].IsApproved || rejectedRows[0].ReviewNote != "暂不采用" {
		t.Fatalf("expected rejected recommendation, got %+v", rejectedRows)
	}
}
