package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alecthomas/kong"
	"github.com/pelletier/go-toml/v2"
)

func TestPlayerAddReadJSONAndTOML(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommandInput(dbPath, `{"name":"张三","number":18,"bat":"right","throw":"right","positions":"pitcher,infield"}`,
		"player", "add", "--input", "-",
	)
	if err != nil {
		t.Fatalf("player add failed: %v\n%s", err, out)
	}
	data := assertJSONOK(t, out)
	if data["resource"] != "player" || data["name"] != "张三" {
		t.Fatalf("unexpected add data: %#v", data)
	}

	out, err = runCommand(dbPath, "player", "read", "--name", "张三")
	if err != nil {
		t.Fatalf("player read failed: %v\n%s", err, out)
	}
	data = assertJSONOK(t, out)
	player := nestedMap(t, data, "player")
	if player["name"] != "张三" || player["bat"] != "right" || player["positions"] != "pitcher,infield" {
		t.Fatalf("unexpected player JSON: %#v", player)
	}

	out, err = runCommand(dbPath, "--format", "toml", "player", "read", "--name", "张三")
	if err != nil {
		t.Fatalf("player read toml failed: %v\n%s", err, out)
	}
	assertValidTOML(t, out)
	for _, want := range []string{"[player]", "name = '张三'", "number = 18", "positions = 'pitcher,infield'"} {
		if !strings.Contains(out, want) {
			t.Fatalf("TOML output missing %q: %s", want, out)
		}
	}
}

func TestJSONInputErrorsAndOldFlags(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "player", "add", "--name", "张三")
	if err == nil {
		t.Fatal("expected old payload flag to fail")
	}
	assertJSONErrorCode(t, out, "internal_error")
	if !strings.Contains(err.Error(), "unknown flag --name") {
		t.Fatalf("unexpected old flag error: %v", err)
	}

	out, err = runCommandInput(dbPath, `{"name":"张三","number":18,"bat":"right","throw":"right","positions":"pitcher","nickname":"小张"}`,
		"player", "add", "--input", "-",
	)
	if err == nil {
		t.Fatal("expected unknown field to fail")
	}
	assertJSONErrorCode(t, out, "unknown_field")

	out, err = runCommandInput(dbPath, `{"name":"张三","number":18,"bat":"switch","throw":"right","positions":"pitcher"}`,
		"player", "add", "--input", "-",
	)
	if err == nil {
		t.Fatal("expected invalid enum to fail")
	}
	assertJSONErrorCode(t, out, "invalid_value")
	if !strings.Contains(err.Error(), "invalid --bat") {
		t.Fatalf("unexpected invalid enum error: %v", err)
	}

	out, err = runCommandInput(dbPath, `{"name":"张三","bat":"right","throw":"right","positions":"pitcher"}`,
		"player", "add", "--input", "-",
	)
	if err == nil {
		t.Fatal("expected missing required field to fail")
	}
	assertJSONErrorCode(t, out, "missing_required")
}

func TestReportWriteReadAndOverwrite(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	if out, err := runCommandInput(dbPath, `{"name":"张三","date":"2026-06-24","content":"挥棒训练","reflection":"节奏更稳定"}`,
		"report", "write", "--input", "-",
	); err != nil {
		t.Fatalf("report write failed: %v\n%s", err, out)
	}
	if out, err := runCommandInput(dbPath, `{"name":"张三","date":"2026-06-24","content":"守备训练","reflection":"脚步更主动"}`,
		"report", "write", "--input", "-",
	); err != nil {
		t.Fatalf("report overwrite failed: %v\n%s", err, out)
	}

	out, err := runCommand(dbPath, "report", "read", "--name", "张三", "--date", "2026-06-24")
	if err != nil {
		t.Fatalf("report read failed: %v\n%s", err, out)
	}
	report := nestedMap(t, assertJSONOK(t, out), "report")
	if report["content"] != "守备训练" || report["reflection"] != "脚步更主动" {
		t.Fatalf("unexpected report JSON: %#v", report)
	}
}

func TestGameWriteReadListAndEmptyListJSON(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommand(dbPath, "game", "list")
	if err != nil {
		t.Fatalf("empty game list failed: %v\n%s", err, out)
	}
	data := assertJSONOK(t, out)
	games, ok := data["games"].([]any)
	if !ok || len(games) != 0 {
		t.Fatalf("expected empty games array, got %#v", data["games"])
	}

	out, err = runCommandInput(dbPath, completeGameInput("2026-06-24", "海港队", sampleEvents()),
		"game", "write", "--input", "-",
	)
	if err != nil {
		t.Fatalf("game write failed: %v\n%s", err, out)
	}
	data = assertJSONOK(t, out)
	if data["resource"] != "game" || data["id"].(float64) != 1 {
		t.Fatalf("unexpected game write data: %#v", data)
	}

	out, err = runCommand(dbPath, "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read failed: %v\n%s", err, out)
	}
	data = assertJSONOK(t, out)
	gameData := nestedMap(t, data, "game")
	if gameData["date"] != "2026-06-24" || gameData["opponent"] != "海港队" || gameData["score"] != "2-1" {
		t.Fatalf("unexpected game JSON: %#v", gameData)
	}

	out, err = runCommand(dbPath, "--format", "toml", "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read toml failed: %v\n%s", err, out)
	}
	assertValidTOML(t, out)
	for _, want := range []string{"[game]", "[[lineups]]", "[[events]]", "event_kind = 'plate_result'"} {
		if !strings.Contains(out, want) {
			t.Fatalf("TOML game output missing %q: %s", want, out)
		}
	}
}

func TestGameCreateAppendScoreFlow(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	if out, err := runCommandInput(dbPath, `{"date":"2026-06-23","start_time":"18:00","opponent":"测试队","batting_side":"bottom","raw":"分步写入测试比赛。"}`,
		"game", "create", "--input", "-",
	); err != nil {
		t.Fatalf("game create failed: %v\n%s", err, out)
	}
	if out, err := runCommandInput(dbPath, `{"game_id":1,"team":"own","player":"张三","batting_order":1,"starting_position":"P"}`,
		"game", "lineup", "add", "--input", "-",
	); err != nil {
		t.Fatalf("lineup add failed: %v\n%s", err, out)
	}
	if out, err := runCommandInput(dbPath, `{"game_id":1,"events":[{"inning":1,"half":"bottom","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"对方投手","pitch_sequence":"X","description":"张三一垒安打"}]}`,
		"game", "event", "write", "--input", "-",
	); err != nil {
		t.Fatalf("event write failed: %v\n%s", err, out)
	}
	if out, err := runCommandInput(dbPath, `{"game_id":1,"own_score":5,"opponent_score":3}`,
		"game", "score", "set", "--input", "-",
	); err != nil {
		t.Fatalf("score set failed: %v\n%s", err, out)
	}

	out, err := runCommand(dbPath, "game", "read", "--id", "1")
	if err != nil {
		t.Fatalf("game read failed: %v\n%s", err, out)
	}
	gameData := nestedMap(t, assertJSONOK(t, out), "game")
	if gameData["is_final"] != true || gameData["score"] != "5-3" {
		t.Fatalf("unexpected game score JSON: %#v", gameData)
	}
}

func TestGameAnalysisGenerateReadAndList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	if out, err := runCommandInput(dbPath, completeGameInput("2026-06-24", "海港队", sampleEvents()),
		"game", "write", "--input", "-",
	); err != nil {
		t.Fatalf("game write failed: %v\n%s", err, out)
	}

	out, err := runCommandInput(dbPath, `{"game_id":1}`, "game", "analysis", "generate", "--input", "-")
	if err != nil {
		t.Fatalf("analysis generate failed: %v\n%s", err, out)
	}
	data := assertJSONOK(t, out)
	if data["resource"] != "game_analysis" || data["game_id"].(float64) != 1 {
		t.Fatalf("unexpected analysis generate data: %#v", data)
	}

	out, err = runCommand(dbPath, "game", "analysis", "read", "--game-id", "1")
	if err != nil {
		t.Fatalf("analysis read failed: %v\n%s", err, out)
	}
	data = assertJSONOK(t, out)
	analysis := nestedMap(t, data, "analysis")
	if analysis["result"] != "win" || analysis["score"] != "2-1" {
		t.Fatalf("unexpected analysis JSON: %#v", analysis)
	}

	out, err = runCommand(dbPath, "game", "analysis", "list")
	if err != nil {
		t.Fatalf("analysis list failed: %v\n%s", err, out)
	}
	items, ok := assertJSONOK(t, out)["analyses"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("unexpected analysis list: %s", out)
	}
}

func TestGameCommandsRejectInvalidInput(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")

	out, err := runCommandInput(dbPath, `{"date":"2026-06-24","opponent":"海港队","batting_side":"away","own_score":0,"opponent_score":0,"raw":"raw","events":[]}`,
		"game", "write", "--input", "-",
	)
	if err == nil {
		t.Fatal("expected invalid batting side to fail")
	}
	assertJSONErrorCode(t, out, "invalid_value")
	if !strings.Contains(err.Error(), `invalid --batting-side "away"`) {
		t.Fatalf("unexpected invalid batting side error: %v", err)
	}

	out, err = runCommandInput(dbPath, `{"date":"2026-06-24","opponent":"海港队","batting_side":"top","own_score":0,"opponent_score":0,"raw":"raw","lineups":[{"team":"home","player":"张三"}]}`,
		"game", "write", "--input", "-",
	)
	if err == nil {
		t.Fatal("expected invalid lineup enum to fail")
	}
	if !strings.Contains(err.Error(), "invalid lineups[0]") || !strings.Contains(err.Error(), "invalid --team") {
		t.Fatalf("unexpected invalid lineup error: %v", err)
	}

	out, err = runCommandInput(dbPath, `{"game_id":1,"events":[{"inning":1,"half":"top","sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"hit","related_player":"李四","pitch_sequence":"X"}]}`,
		"game", "event", "write", "--input", "-",
	)
	if err == nil {
		t.Fatal("expected invalid event result to fail")
	}
	if !strings.Contains(err.Error(), `invalid --result "hit"`) {
		t.Fatalf("unexpected invalid result error: %v", err)
	}
}

func TestDrillRecommendWriteAndList(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	if out, err := runCommandInput(dbPath, `{"name":"张三","url":"https://example.com/a","reason":"步伐好","type":"infield","summary":"讲解内野扑球步伐"}`,
		"drill", "recommend", "write", "--input", "-",
	); err != nil {
		t.Fatalf("drill write failed: %v\n%s", err, out)
	}
	if out, err := runCommandInput(dbPath, `{"name":"张三","url":"https://example.com/b","reason":"发力","type":"PITCHING","summary":"投球发力链"}`,
		"drill", "recommend", "write", "--input", "-",
	); err != nil {
		t.Fatalf("drill write failed: %v\n%s", err, out)
	}

	out, err := runCommand(dbPath, "drill", "recommend", "list", "--type", "infield")
	if err != nil {
		t.Fatalf("drill list failed: %v\n%s", err, out)
	}
	drills, ok := assertJSONOK(t, out)["drills"].([]any)
	if !ok || len(drills) != 1 {
		t.Fatalf("unexpected drill list: %s", out)
	}

	out, err = runCommand(dbPath, "drill", "recommend", "list", "--name", "不存在")
	if err != nil {
		t.Fatalf("empty drill list failed: %v\n%s", err, out)
	}
	drills, ok = assertJSONOK(t, out)["drills"].([]any)
	if !ok || len(drills) != 0 {
		t.Fatalf("expected empty drills array, got %s", out)
	}
}

func TestPersonAnalysisRead(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "bastion.db")
	addTestPlayer(t, dbPath)

	events := `[
		{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"B,X","description":"张三二垒安打"},
		{"inning":1,"half":"bottom","play_no":2,"sequence":1,"event_kind":"plate_result","player":"对手甲","team":"opponent","result":"strikeout","related_player":"张三","pitch_sequence":"S,S,S","outs_on_play":1,"description":"张三三振对手"},
		{"inning":1,"half":"bottom","play_no":3,"sequence":1,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":3,"base_to":4,"reason":"batted_ball","related_player":"张三","runs_scored":1,"earned":true,"description":"对手得分"}
	]`
	seedGameForPersonTest(t, dbPath, "2026-05-10", "海港队", events)
	if out, err := runCommandInput(dbPath, `{"game_id":1}`, "game", "analysis", "generate", "--input", "-"); err != nil {
		t.Fatalf("analysis generate 1 failed: %v\n%s", err, out)
	}
	seedGameForPersonTest(t, dbPath, "2026-06-10", "风暴队", events)
	if out, err := runCommandInput(dbPath, `{"game_id":2}`, "game", "analysis", "generate", "--input", "-"); err != nil {
		t.Fatalf("analysis generate 2 failed: %v\n%s", err, out)
	}

	out, err := runCommand(dbPath, "person", "analysis", "read",
		"--name", "张三",
		"--from", "2026-05-01",
		"--to", "2026-06-30",
	)
	if err != nil {
		t.Fatalf("person analysis read failed: %v\n%s", err, out)
	}
	data := assertJSONOK(t, out)
	analysis := nestedMap(t, data, "analysis")
	if analysis["games_in_span"].(float64) != 2 || analysis["games_analyzed"].(float64) != 2 {
		t.Fatalf("unexpected person analysis: %#v", analysis)
	}
	batting := nestedMap(t, data, "batting")
	if batting["hits"].(float64) != 2 || batting["doubles"].(float64) != 2 {
		t.Fatalf("unexpected person batting: %#v", batting)
	}
}

func TestHelpTextDescribesJSONInput(t *testing.T) {
	tests := []struct {
		name      string
		args      []string
		wantParts []string
	}{
		{
			name:      "player add",
			args:      []string{"player", "add", "-h"},
			wantParts: []string{"--input=PATH", "Path to player JSON input"},
		},
		{
			name:      "game write",
			args:      []string{"game", "write", "-h"},
			wantParts: []string{"--input=PATH", "Path to complete game JSON input"},
		},
		{
			name:      "game event write",
			args:      []string{"game", "event", "write", "-h"},
			wantParts: []string{"--input=PATH", "Path to game event JSON input"},
		},
		{
			name:      "drill recommend write",
			args:      []string{"drill", "recommend", "write", "-h"},
			wantParts: []string{"--input=PATH", "Path to drill recommendation JSON input"},
		},
		{
			name:      "game list",
			args:      []string{"game", "list", "-h"},
			wantParts: []string{"Filter games by date, formatted as YYYY-MM-DD."},
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

func addTestPlayer(t *testing.T, dbPath string) {
	t.Helper()
	if out, err := runCommandInput(dbPath, `{"name":"张三","number":18,"bat":"right","throw":"right","positions":"pitcher,infield"}`,
		"player", "add", "--input", "-",
	); err != nil {
		t.Fatalf("add test player failed: %v\n%s", err, out)
	}
}

func seedGameForPersonTest(t *testing.T, dbPath, date, opponent, events string) {
	t.Helper()
	if out, err := runCommandInput(dbPath, completeGameInput(date, opponent, events),
		"game", "write", "--input", "-",
	); err != nil {
		t.Fatalf("game write failed: %v\n%s", err, out)
	}
}

func sampleEvents() string {
	return `[
		{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"B,X","description":"张三二垒安打"},
		{"inning":1,"half":"top","play_no":1,"sequence":2,"event_kind":"runner_movement","player":"李四","team":"own","result":"run_scored","base_from":2,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"张三","description":"李四得分"},
		{"inning":1,"half":"top","play_no":2,"sequence":1,"event_kind":"runner_movement","player":"张三","team":"own","result":"advance","base_from":1,"base_to":2,"reason":"stolen_base","description":"张三盗上二垒"},
		{"inning":1,"half":"bottom","play_no":3,"sequence":1,"event_kind":"plate_result","player":"对手甲","team":"opponent","result":"strikeout","related_player":"张三","pitch_sequence":"S,S,S","outs_on_play":1,"description":"张三三振对手"},
		{"inning":1,"half":"bottom","play_no":4,"sequence":1,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":3,"base_to":4,"reason":"batted_ball","related_player":"张三","runs_scored":1,"earned":true,"description":"对手得分"},
		{"inning":1,"half":"bottom","play_no":5,"sequence":1,"event_kind":"fielding_credit","player":"李四","team":"own","result":"putout","description":"李四接杀"}
	]`
}

func completeGameInput(date, opponent, events string) string {
	return fmt.Sprintf(`{
		"date":%q,
		"start_time":"19:30",
		"opponent":%q,
		"batting_side":"top",
		"own_score":2,
		"opponent_score":1,
		"raw":"结构化比赛",
		"lineups":[
			{"team":"own","player":"张三","batting_order":1,"starting_position":"P"},
			{"team":"own","player":"李四","batting_order":2,"starting_position":"CF"}
		],
		"events":%s
	}`, date, opponent, events)
}

func runCommand(dbPath string, args ...string) (string, error) {
	return runCommandInput(dbPath, "", args...)
}

func runCommandInput(dbPath, input string, args ...string) (string, error) {
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	fullArgs := append([]string{"--db", dbPath}, args...)
	err := RunWithIO(fullArgs, strings.NewReader(input), &stdout, &stderr)
	if err != nil {
		return stdout.String() + stderr.String(), err
	}
	return stdout.String() + stderr.String(), nil
}

func assertJSONOK(t *testing.T, output string) map[string]any {
	t.Helper()
	var envelope struct {
		Ok   bool           `json:"ok"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal([]byte(output), &envelope); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, output)
	}
	if !envelope.Ok {
		t.Fatalf("expected ok JSON envelope, got: %s", output)
	}
	if envelope.Data == nil {
		t.Fatalf("expected data object, got: %s", output)
	}
	return envelope.Data
}

func assertJSONErrorCode(t *testing.T, output, want string) {
	t.Helper()
	var envelope struct {
		Ok    bool `json:"ok"`
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(output), &envelope); err != nil {
		t.Fatalf("error output is not valid JSON: %v\n%s", err, output)
	}
	if envelope.Ok {
		t.Fatalf("expected error envelope, got ok: %s", output)
	}
	if envelope.Error.Code != want {
		t.Fatalf("error code = %q, want %q in %s", envelope.Error.Code, want, output)
	}
}

func nestedMap(t *testing.T, data map[string]any, key string) map[string]any {
	t.Helper()
	nested, ok := data[key].(map[string]any)
	if !ok {
		t.Fatalf("data[%q] is not an object: %#v", key, data[key])
	}
	return nested
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
