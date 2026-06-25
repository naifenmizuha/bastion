package cli

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alecthomas/kong"
	"github.com/pelletier/go-toml/v2"
)

func TestPlayerAddAndRead(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "right",
		"--throw", "right",
		"--positions", "pitcher,infield",
	)
	if err != nil {
		t.Fatalf("player add failed: %v", err)
	}
	if !strings.Contains(out, "player added: 张三") {
		t.Fatalf("unexpected add output: %q", out)
	}

	out, err = runCommand(dbPath, "player", "read", "--name", "张三")
	if err != nil {
		t.Fatalf("player read failed: %v", err)
	}
	assertValidTOML(t, out)

	wantParts := []string{
		"[player]",
		"name = '张三'",
		"number = 18",
		"bat = 'right'",
		"throw = 'right'",
		"positions = 'pitcher,infield'",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("read output missing %q: %q", want, out)
		}
	}
}

func TestPlayerAddRejectsDuplicateName(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "right",
		"--throw", "right",
		"--positions", "pitcher",
	)
	if err != nil {
		t.Fatalf("first player add failed: %v", err)
	}

	_, err = runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "19",
		"--bat", "left",
		"--throw", "left",
		"--positions", "outfield",
	)
	if err == nil {
		t.Fatal("expected duplicate player add to fail")
	}
	if !strings.Contains(err.Error(), "player already exists: 张三") {
		t.Fatalf("unexpected duplicate error: %v", err)
	}
}

func TestReportWriteReadAndOverwrite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	_, err := runCommand(dbPath, "report", "write",
		"--name", "张三",
		"--date", "2026-06-24",
		"--content", "挥棒训练",
		"--reflection", "节奏更稳定",
	)
	if err != nil {
		t.Fatalf("report write failed: %v", err)
	}

	_, err = runCommand(dbPath, "report", "write",
		"--name", "张三",
		"--date", "2026-06-24",
		"--content", "守备训练",
		"--reflection", "脚步更主动",
	)
	if err != nil {
		t.Fatalf("report overwrite failed: %v", err)
	}

	out, err := runCommand(dbPath, "report", "read",
		"--name", "张三",
		"--date", "2026-06-24",
	)
	if err != nil {
		t.Fatalf("report read failed: %v", err)
	}
	assertValidTOML(t, out)

	wantParts := []string{
		"[report]",
		"name = '张三'",
		"date = '2026-06-24'",
		"content = '守备训练'",
		"reflection = '脚步更主动'",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("report output missing %q: %q", want, out)
		}
	}
	if strings.Contains(out, "挥棒训练") {
		t.Fatalf("report was not overwritten: %q", out)
	}
}

func TestReportWriteRequiresExistingPlayer(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "report", "write",
		"--name", "不存在",
		"--date", "2026-06-24",
		"--content", "挥棒训练",
		"--reflection", "节奏更稳定",
	)
	if err == nil {
		t.Fatal("expected report write to fail for missing player")
	}
	if !strings.Contains(err.Error(), "player not found: 不存在") {
		t.Fatalf("unexpected missing player error: %v", err)
	}
}

func TestReportRejectsInvalidDate(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	_, err := runCommand(dbPath, "report", "write",
		"--name", "张三",
		"--date", "2026-6-24",
		"--content", "挥棒训练",
		"--reflection", "节奏更稳定",
	)
	if err == nil {
		t.Fatal("expected invalid date to fail")
	}
	if !strings.Contains(err.Error(), "expected YYYY-MM-DD") {
		t.Fatalf("unexpected invalid date error: %v", err)
	}
}

func TestPlayerRejectsInvalidChoice(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "switch",
		"--throw", "right",
		"--positions", "pitcher",
	)
	if err == nil {
		t.Fatal("expected invalid hand value to fail")
	}
	if !strings.Contains(err.Error(), "invalid --bat") {
		t.Fatalf("unexpected invalid choice error: %v", err)
	}
}

func TestHelpTextDescribesStringChoices(t *testing.T) {
	tests := []struct {
		name      string
		args      []string
		wantParts []string
	}{
		{
			name: "player add",
			args: []string{"player", "add", "-h"},
			wantParts: []string{
				"Batting hand(s): left,right.",
				"Throwing hand(s): left,right.",
				"Positions: pitcher,catcher,infield,outfield.",
			},
		},
		{
			name: "report write",
			args: []string{"report", "write", "-h"},
			wantParts: []string{
				"Training date, formatted as YYYY-MM-DD.",
				"Training content; cannot be empty.",
				"Training reflection; cannot be empty.",
			},
		},
		{
			name: "game write",
			args: []string{"game", "write", "-h"},
			wantParts: []string{
				"Own batting side: top,bottom.",
				"JSON array of lineup records.",
				"team: own,opponent.",
				"JSON array of game fact events.",
				"event_kind:",
				"plate_result,runner_movement,fielding_credit.",
			},
		},
		{
			name: "game lineup add",
			args: []string{"game", "lineup", "add", "-h"},
			wantParts: []string{
				"Team: own,opponent.",
				"Batting order, 1-9; omit for substitute or unknown.",
				"Starting position: P,C,1B,2B,3B,SS,LF,CF,RF.",
			},
		},
		{
			name: "game event write",
			args: []string{"game", "event", "write", "-h"},
			wantParts: []string{
				"Game id to append events to; must exist.",
				"JSON array of game fact events;",
				"supports plate_result, runner_movement, and",
				"fielding_credit.",
			},
		},
		{
			name: "game list",
			args: []string{"game", "list", "-h"},
			wantParts: []string{
				"Filter games by date, formatted as YYYY-MM-DD.",
			},
		},
		{
			name: "drill recommend write",
			args: []string{"drill", "recommend", "write", "-h"},
			wantParts: []string{
				"Recommender name; must be a registered player.",
				"Drill type:",
				"pitching,catching,hitting,strength,baserunning,infield,outfield.",
				"AI-generated summary; cannot be empty.",
			},
		},
		{
			name: "drill recommend list",
			args: []string{"drill", "recommend", "list", "-h"},
			wantParts: []string{
				"Filter by recommender name.",
				"Filter by drill type:",
				"pitching,catching,hitting,strength,baserunning,infield,outfield.",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out, err := runHelp(tt.args...)
			if err != nil {
				t.Fatalf("help command failed: %v", err)
			}
			for _, want := range tt.wantParts {
				if !strings.Contains(out, want) {
					t.Fatalf("help output missing %q: %q", want, out)
				}
			}
		})
	}
}

func TestGameWriteReadAndList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--start-time", "19:30",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "5",
		"--opponent-score", "3",
		"--raw", "6月24日对海港队，先攻，5:3获胜",
		"--lineup-json", `[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"}]`,
		"--events-json", `[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"李四","pitch_sequence":"B,S,X","description":"张三中前安打"}]`,
	)
	if err != nil {
		t.Fatalf("game write failed: %v", err)
	}
	if !strings.Contains(out, "game saved: 1") {
		t.Fatalf("unexpected write output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read failed: %v", err)
	}
	assertValidTOML(t, out)
	wantParts := []string{
		"[game]",
		"date = '2026-06-24'",
		"opponent = '海港队'",
		"own_score = 5",
		"opponent_score = 3",
		"score = '5-3'",
		"is_final = true",
		"batting_side = 'top'",
		"[[lineups]]",
		"team = 'own'",
		"starting_position = 'P'",
		"[[events]]",
		"half = 'top'",
		"event_kind = 'plate_result'",
		"result = 'single'",
		"player = '张三'",
		"description = '张三中前安打'",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("read output missing %q: %q", want, out)
		}
	}
	if strings.Contains(out, "base_from =") || strings.Contains(out, "earned =") {
		t.Fatalf("nil optional event values should be omitted: %q", out)
	}

	out, err = runCommand(dbPath, "game", "list", "--date", "2026-06-24")
	if err != nil {
		t.Fatalf("game list failed: %v", err)
	}
	assertValidTOML(t, out)
	if !strings.Contains(out, "[[games]]") || !strings.Contains(out, "id = 1") || !strings.Contains(out, "date = '2026-06-24'") || !strings.Contains(out, "batting_side = 'top'") || !strings.Contains(out, "score = '5-3'") {
		t.Fatalf("unexpected list output: %q", out)
	}
}

func TestGameCreateAppendAndSetScore(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "game", "create",
		"--date", "2026-06-24",
		"--start-time", "19:30",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--raw", "6月24日对海港队",
	)
	if err != nil {
		t.Fatalf("game create failed: %v", err)
	}
	if !strings.Contains(out, "game created: 1") {
		t.Fatalf("unexpected create output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "1",
		"--team", "OWN",
		"--player", "张三",
		"--batting-order", "1",
		"--starting-position", "p",
	)
	if err != nil {
		t.Fatalf("lineup add failed: %v", err)
	}
	if !strings.Contains(out, "lineup added: 1") {
		t.Fatalf("unexpected lineup output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "event", "write",
		"--game-id", "1",
		"--events-json", `[{"inning":1,"half":"TOP","play_no":1,"sequence":1,"event_kind":"PLATE_RESULT","player":"张三","team":"OWN","result":"SINGLE","related_player":"李四","pitch_sequence":"B,S,X","description":"张三中前安打"}]`,
	)
	if err != nil {
		t.Fatalf("event write failed: %v", err)
	}
	if !strings.Contains(out, "game events saved: 1") {
		t.Fatalf("unexpected event output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "score", "set",
		"--game-id", "1",
		"--own-score", "5",
		"--opponent-score", "3",
	)
	if err != nil {
		t.Fatalf("score set failed: %v", err)
	}
	if !strings.Contains(out, "score saved: 1") {
		t.Fatalf("unexpected score output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read failed: %v", err)
	}
	assertValidTOML(t, out)
	wantParts := []string{
		"[game]",
		"is_final = true",
		"own_score = 5",
		"opponent_score = 3",
		"[[lineups]]",
		"team = 'own'",
		"starting_position = 'P'",
		"[[events]]",
		"half = 'top'",
		"event_kind = 'plate_result'",
		"result = 'single'",
		"player = '张三'",
		"description = '张三中前安打'",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("read output missing %q: %q", want, out)
		}
	}
}

func TestGameAnalysisGenerateReadAndList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	events := `[
		{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"B,X","description":"张三二垒安打"},
		{"inning":1,"half":"top","play_no":1,"sequence":2,"event_kind":"runner_movement","player":"李四","team":"own","result":"run_scored","base_from":2,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"张三","description":"李四得分"},
		{"inning":1,"half":"top","play_no":2,"sequence":1,"event_kind":"runner_movement","player":"张三","team":"own","result":"advance","base_from":1,"base_to":2,"reason":"stolen_base","description":"张三盗上二垒"},
		{"inning":1,"half":"bottom","play_no":3,"sequence":1,"event_kind":"plate_result","player":"对手甲","team":"opponent","result":"strikeout","related_player":"张三","pitch_sequence":"S,S,S","outs_on_play":1,"description":"张三三振对手"},
		{"inning":1,"half":"bottom","play_no":4,"sequence":1,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":3,"base_to":4,"reason":"batted_ball","related_player":"张三","runs_scored":1,"earned":true,"description":"对手得分"},
		{"inning":1,"half":"bottom","play_no":5,"sequence":1,"event_kind":"fielding_credit","player":"李四","team":"own","result":"putout","description":"李四接杀"}
	]`

	_, err := runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "2",
		"--opponent-score", "1",
		"--raw", "结构化比赛",
		"--lineup-json", `[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"},{"team":"own","player":"李四","batting_order":2,"starting_position":"CF"}]`,
		"--events-json", events,
	)
	if err != nil {
		t.Fatalf("game write failed: %v", err)
	}

	out, err := runCommand(dbPath, "game", "analysis", "generate", "--game-id", "1")
	if err != nil {
		t.Fatalf("analysis generate failed: %v", err)
	}
	if !strings.Contains(out, "game analysis generated: 1") {
		t.Fatalf("unexpected generate output: %q", out)
	}

	out, err = runCommand(dbPath, "game", "analysis", "read", "--game-id", "1")
	if err != nil {
		t.Fatalf("analysis read failed: %v", err)
	}
	assertValidTOML(t, out)
	wantParts := []string{
		"data_gaps = []",
		"[analysis]",
		"result = 'win'",
		"score = '2-1'",
		"[[player_summaries]]",
		"player = '张三'",
		"highlight = 'extra_base_hit,stole_base'",
		"[[batting]]",
		"pa = 1",
		"at_bats = 1",
		"hits = 1",
		"simplified_on_base_percentage = 1.0",
		"[[baserunning]]",
		"stolen_bases = 1",
		"[[pitching]]",
		"strikeouts = 1",
		"era = 27.0",
		"[[fielding]]",
		"player = '李四'",
		"fielding_percentage = 1.0",
	}
	for _, want := range wantParts {
		if !strings.Contains(out, want) {
			t.Fatalf("analysis output missing %q: %q", want, out)
		}
	}

	out, err = runCommand(dbPath, "game", "analysis", "read", "--game-id", "1", "--player", "张三")
	if err != nil {
		t.Fatalf("analysis read player failed: %v", err)
	}
	assertValidTOML(t, out)
	if !strings.Contains(out, "player = '张三'") || strings.Contains(out, "player = '李四'") {
		t.Fatalf("unexpected player analysis output: %q", out)
	}

	_, err = runCommand(dbPath, "game", "analysis", "generate", "--game-id", "1")
	if err != nil {
		t.Fatalf("analysis regenerate failed: %v", err)
	}
	out, err = runCommand(dbPath, "game", "analysis", "list")
	if err != nil {
		t.Fatalf("analysis list failed: %v", err)
	}
	assertValidTOML(t, out)
	if !strings.Contains(out, "[[analyses]]") || !strings.Contains(out, "game_id = 1") || !strings.Contains(out, "date = '2026-06-24'") || !strings.Contains(out, "opponent = '海港队'") || !strings.Contains(out, "score = '2-1'") || !strings.Contains(out, "result = 'win'") {
		t.Fatalf("unexpected analysis list output: %q", out)
	}
}

func TestGameAnalysisErrors(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "game", "create",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--raw", "只有比赛信息",
	)
	if err != nil {
		t.Fatalf("game create failed: %v", err)
	}

	_, err = runCommand(dbPath, "game", "analysis", "read", "--game-id", "1")
	if err == nil {
		t.Fatal("expected analysis read before generate to fail")
	}
	if !strings.Contains(err.Error(), "game analysis not found: 1") {
		t.Fatalf("unexpected analysis not found error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "analysis", "generate", "--game-id", "1")
	if err == nil {
		t.Fatal("expected empty game analysis generation to fail")
	}
	if !strings.Contains(err.Error(), "game has no analyzable events") {
		t.Fatalf("unexpected empty analysis error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "analysis", "generate", "--game-id", "999")
	if err == nil {
		t.Fatal("expected missing game analysis generation to fail")
	}
	if !strings.Contains(err.Error(), "game not found: 999") {
		t.Fatalf("unexpected missing game error: %v", err)
	}
}

func TestGameCommandsRejectInvalidInput(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "game", "create",
		"--date", "2026-6-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--raw", "raw",
	)
	if err == nil {
		t.Fatal("expected invalid date to fail")
	}
	if !strings.Contains(err.Error(), "expected YYYY-MM-DD") {
		t.Fatalf("unexpected invalid date error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "create",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "away",
		"--raw", "raw",
	)
	if err == nil {
		t.Fatal("expected invalid batting side to fail")
	}
	if !strings.Contains(err.Error(), `invalid --batting-side "away"`) {
		t.Fatalf("unexpected invalid batting side error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "999",
		"--team", "own",
		"--player", "张三",
	)
	if err == nil {
		t.Fatal("expected missing game to fail")
	}
	if !strings.Contains(err.Error(), "game not found: 999") {
		t.Fatalf("unexpected missing game error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "1",
		"--team", "home",
		"--player", "张三",
	)
	if err == nil {
		t.Fatal("expected invalid team to fail")
	}
	if !strings.Contains(err.Error(), `invalid --team "home"`) {
		t.Fatalf("unexpected invalid team error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "lineup", "add",
		"--game-id", "1",
		"--team", "own",
		"--player", "张三",
		"--starting-position", "DH",
	)
	if err == nil {
		t.Fatal("expected invalid starting position to fail")
	}
	if !strings.Contains(err.Error(), `invalid --starting-position "DH"`) {
		t.Fatalf("unexpected invalid starting position error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "0",
		"--opponent-score", "0",
		"--raw", "raw",
		"--events-json", `[{"inning":1,"half":"middle","sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"李四","pitch_sequence":"X"}]`,
	)
	if err == nil {
		t.Fatal("expected invalid half to fail")
	}
	if !strings.Contains(err.Error(), "invalid --half") {
		t.Fatalf("unexpected invalid half error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "write",
		"--date", "2026-06-24",
		"--opponent", "海港队",
		"--batting-side", "top",
		"--own-score", "0",
		"--opponent-score", "0",
		"--raw", "raw",
		"--lineup-json", `[{"team":"home","player":"张三"}]`,
	)
	if err == nil {
		t.Fatal("expected invalid JSON enum to fail")
	}
	if !strings.Contains(err.Error(), "invalid --lineup-json item 1") || !strings.Contains(err.Error(), "invalid --team") {
		t.Fatalf("unexpected invalid JSON enum error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "event", "write",
		"--game-id", "1",
		"--events-json", `[{"inning":1,"half":"top","sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"hit","related_player":"李四","pitch_sequence":"X"}]`,
	)
	if err == nil {
		t.Fatal("expected invalid result to fail")
	}
	if !strings.Contains(err.Error(), `invalid --result "hit"`) {
		t.Fatalf("unexpected invalid result error: %v", err)
	}

	_, err = runCommand(dbPath, "game", "event", "write",
		"--game-id", "1",
		"--events-json", `[{"inning":1,"half":"top","play_no":0,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"李四","pitch_sequence":"X"}]`,
	)
	if err == nil {
		t.Fatal("expected invalid play_no to fail")
	}
	if !strings.Contains(err.Error(), "invalid --play-no") {
		t.Fatalf("unexpected invalid play_no error: %v", err)
	}
}

func TestDrillRecommendWriteAndList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	out, err := runCommand(dbPath, "drill", "recommend", "write",
		"--name", "张三",
		"--url", "https://example.com/a",
		"--reason", "步伐好",
		"--type", "infield",
		"--summary", "讲解内野扑球步伐",
	)
	if err != nil {
		t.Fatalf("drill recommend write failed: %v", err)
	}
	if !strings.Contains(out, "drill recommendation saved: 1") {
		t.Fatalf("unexpected write output: %q", out)
	}

	_, err = runCommand(dbPath, "drill", "recommend", "write",
		"--name", "张三",
		"--url", "https://example.com/b",
		"--reason", "发力",
		"--type", "PITCHING",
		"--summary", "投球发力链",
	)
	if err != nil {
		t.Fatalf("drill recommend write failed: %v", err)
	}

	out, err = runCommand(dbPath, "drill", "recommend", "list")
	if err != nil {
		t.Fatalf("drill recommend list failed: %v", err)
	}
	assertValidTOML(t, out)
	if !strings.Contains(out, "[[drills]]") || !strings.Contains(out, "id = 2") || !strings.Contains(out, "type = 'pitching'") || !strings.Contains(out, "id = 1") || !strings.Contains(out, "type = 'infield'") {
		t.Fatalf("list output missing rows: %q", out)
	}

	out, err = runCommand(dbPath, "drill", "recommend", "list", "--type", "infield")
	if err != nil {
		t.Fatalf("drill recommend list by type failed: %v", err)
	}
	assertValidTOML(t, out)
	if !strings.Contains(out, "type = 'infield'") || strings.Contains(out, "type = 'pitching'") {
		t.Fatalf("list by type output wrong: %q", out)
	}

	out, err = runCommand(dbPath, "drill", "recommend", "list", "--name", "张三", "--type", "pitching")
	if err != nil {
		t.Fatalf("drill recommend list combined failed: %v", err)
	}
	assertValidTOML(t, out)
	if !strings.Contains(out, "type = 'pitching'") || strings.Contains(out, "type = 'infield'") {
		t.Fatalf("list combined output wrong: %q", out)
	}

	out, err = runCommand(dbPath, "drill", "recommend", "list", "--name", "不存在")
	if err != nil {
		t.Fatalf("drill recommend list empty failed: %v", err)
	}
	if out != "" {
		t.Fatalf("expected empty list output, got %q", out)
	}
}

func TestDrillRecommendWriteRequiresExistingPlayer(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	_, err := runCommand(dbPath, "drill", "recommend", "write",
		"--name", "不存在",
		"--url", "https://example.com",
		"--reason", "步伐",
		"--type", "infield",
		"--summary", "讲解",
	)
	if err == nil {
		t.Fatal("expected missing player to fail")
	}
	if !strings.Contains(err.Error(), "player not found: 不存在") {
		t.Fatalf("unexpected missing player error: %v", err)
	}
}

func TestDrillRecommendWriteRejectsInvalidType(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	_, err := runCommand(dbPath, "drill", "recommend", "write",
		"--name", "张三",
		"--url", "https://example.com",
		"--reason", "步伐",
		"--type", "running",
		"--summary", "讲解",
	)
	if err == nil {
		t.Fatal("expected invalid type to fail")
	}
	if !strings.Contains(err.Error(), `invalid --type "running"`) {
		t.Fatalf("unexpected invalid type error: %v", err)
	}
}

func TestDrillRecommendWriteRejectsEmptyFields(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	cases := []struct {
		args []string
		want string
	}{
		{[]string{"--name", "", "--url", "u", "--reason", "r", "--type", "infield", "--summary", "s"}, "--name cannot be empty"},
		{[]string{"--name", "张三", "--url", "", "--reason", "r", "--type", "infield", "--summary", "s"}, "--url cannot be empty"},
		{[]string{"--name", "张三", "--url", "u", "--reason", "", "--type", "infield", "--summary", "s"}, "--reason cannot be empty"},
		{[]string{"--name", "张三", "--url", "u", "--reason", "r", "--type", "infield", "--summary", ""}, "--summary cannot be empty"},
	}
	for _, c := range cases {
		args := append([]string{"drill", "recommend", "write"}, c.args...)
		_, err := runCommand(dbPath, args...)
		if err == nil {
			t.Fatalf("expected empty field to fail for %q", c.want)
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Fatalf("unexpected error for %q: %v", c.want, err)
		}
	}
}

func addTestPlayer(t *testing.T, dbPath string) {
	t.Helper()
	_, err := runCommand(dbPath, "player", "add",
		"--name", "张三",
		"--number", "18",
		"--bat", "right",
		"--throw", "right",
		"--positions", "pitcher,infield",
	)
	if err != nil {
		t.Fatalf("add test player failed: %v", err)
	}
}

func runCommand(dbPath string, args ...string) (string, error) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	fullArgs := append([]string{"--db", dbPath}, args...)
	err := Run(fullArgs, &stdout, &stderr)
	if err != nil {
		return stdout.String() + stderr.String(), err
	}
	return stdout.String() + stderr.String(), nil
}

func assertValidTOML(t *testing.T, output string) {
	t.Helper()
	if strings.TrimSpace(output) == "" {
		t.Fatal("expected TOML output, got empty output")
	}
	var decoded map[string]any
	if err := toml.Unmarshal([]byte(output), &decoded); err != nil {
		t.Fatalf("output is not valid TOML: %v\n%s", err, output)
	}
}

type helpExit struct {
	code int
}

func runHelp(args ...string) (output string, err error) {
	var app CLI
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	parser := kong.Must(
		&app,
		kong.Name("bastion"),
		kong.Description("Baseball player self-training registration CLI."),
		kong.Writers(&stdout, &stderr),
		kong.Exit(func(code int) {
			panic(helpExit{code: code})
		}),
	)

	defer func() {
		recovered := recover()
		if recovered == nil {
			output = stdout.String() + stderr.String()
			return
		}
		exit, ok := recovered.(helpExit)
		if !ok {
			panic(recovered)
		}
		output = stdout.String() + stderr.String()
		if exit.code != 0 {
			err = fmt.Errorf("help exited with code %d", exit.code)
		}
	}()

	_, err = parser.Parse(args)
	return stdout.String() + stderr.String(), err
}
