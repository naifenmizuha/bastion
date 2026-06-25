package sqlite

import (
	"testing"

	"bastion/internal/domain/drill"
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
