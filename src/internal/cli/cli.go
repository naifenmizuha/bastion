package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"bastion/internal/domain/drill"
	"bastion/internal/domain/game"
	"bastion/internal/domain/person"
	"bastion/internal/domain/player"
	"bastion/internal/domain/report"
	"bastion/internal/sqlite"

	"github.com/alecthomas/kong"
	"github.com/pelletier/go-toml/v2"
)

type CLI struct {
	DB     string    `help:"Path to the SQLite database." default:"bastion.db" placeholder:"PATH"`
	Format string    `help:"Output format: json,toml,text." enum:"json,toml,text" default:"json"`
	Player PlayerCmd `cmd:"" help:"Manage players."`
	Report ReportCmd `cmd:"" help:"Manage training reports."`
	Game   GameCmd   `cmd:"" help:"Manage games."`
	Drill  DrillCmd  `cmd:"" help:"Manage drill recommendations."`
	Person PersonCmd `cmd:"" help:"Manage person cross-period analysis."`
}

type PlayerCmd struct {
	Add  PlayerAddCmd  `cmd:"" help:"Add a player."`
	Read PlayerReadCmd `cmd:"" help:"Read a player by name."`
}

type PlayerAddCmd struct {
	Input string `required:"" help:"Path to player JSON input, or - for stdin." placeholder:"PATH"`
}

type PlayerReadCmd struct {
	Name string `required:"" help:"Player name to read."`
}

type ReportCmd struct {
	Write ReportWriteCmd `cmd:"" help:"Write a training report."`
	Read  ReportReadCmd  `cmd:"" help:"Read a training report."`
}

type ReportWriteCmd struct {
	Input string `required:"" help:"Path to training report JSON input, or - for stdin." placeholder:"PATH"`
}

type ReportReadCmd struct {
	Name string `required:"" help:"Player name."`
	Date string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
}

type GameCmd struct {
	Write    GameWriteCmd    `cmd:"" help:"Write a complete game."`
	Create   GameCreateCmd   `cmd:"" help:"Create a game."`
	Lineup   GameLineupCmd   `cmd:"" help:"Manage game lineups."`
	Event    GameEventCmd    `cmd:"" help:"Manage game fact events."`
	Score    GameScoreCmd    `cmd:"" help:"Manage game scores."`
	Analysis GameAnalysisCmd `cmd:"" help:"Manage game player performance analysis."`
	Read     GameReadCmd     `cmd:"" help:"Read a game by id."`
	List     GameListCmd     `cmd:"" help:"List games."`
}

type GameWriteCmd struct {
	Input string `required:"" help:"Path to complete game JSON input, or - for stdin." placeholder:"PATH"`
}

type GameCreateCmd struct {
	Input string `required:"" help:"Path to game JSON input, or - for stdin." placeholder:"PATH"`
}

type GameLineupCmd struct {
	Add GameLineupAddCmd `cmd:"" help:"Add a lineup record."`
}

type GameLineupAddCmd struct {
	Input string `required:"" help:"Path to game lineup JSON input, or - for stdin." placeholder:"PATH"`
}

type GameEventCmd struct {
	Write GameEventWriteCmd `cmd:"" help:"Write game fact events."`
}

type GameEventWriteCmd struct {
	Input string `required:"" help:"Path to game event JSON input, or - for stdin." placeholder:"PATH"`
}

type GameScoreCmd struct {
	Set GameScoreSetCmd `cmd:"" help:"Set final score."`
}

type GameScoreSetCmd struct {
	Input string `required:"" help:"Path to game score JSON input, or - for stdin." placeholder:"PATH"`
}

type GameAnalysisCmd struct {
	Generate GameAnalysisGenerateCmd `cmd:"" help:"Generate player performance analysis."`
	Read     GameAnalysisReadCmd     `cmd:"" help:"Read generated player performance analysis."`
	List     GameAnalysisListCmd     `cmd:"" help:"List games with generated analysis."`
}

type GameAnalysisGenerateCmd struct {
	Input string `required:"" help:"Path to game analysis generation JSON input, or - for stdin." placeholder:"PATH"`
}

type GameAnalysisReadCmd struct {
	GameID int64  `required:"" help:"Game id to read generated analysis for."`
	Player string `help:"Optional player name; when set only this player's analysis is shown."`
}

type GameAnalysisListCmd struct{}

type GameReadCmd struct {
	ID int64 `required:"" help:"Game id to read."`
}

type GameListCmd struct {
	Date string `help:"Filter games by date, formatted as YYYY-MM-DD."`
}

type DrillCmd struct {
	Recommend DrillRecommendCmd `cmd:"" help:"Manage drill recommendations."`
}

type DrillRecommendCmd struct {
	Write DrillWriteCmd `cmd:"" help:"Write a drill recommendation."`
	List  DrillListCmd  `cmd:"" help:"List drill recommendations."`
}

type DrillWriteCmd struct {
	Input string `required:"" help:"Path to drill recommendation JSON input, or - for stdin." placeholder:"PATH"`
}

type DrillListCmd struct {
	Name string `help:"Filter by recommender name."`
	Type string `help:"Filter by drill type: pitching,catching,hitting,strength,baserunning,infield,outfield."`
}

type PersonCmd struct {
	Analysis PersonAnalysisCmd `cmd:"" help:"Manage person cross-period analysis."`
}

type PersonAnalysisCmd struct {
	Read PersonAnalysisReadCmd `cmd:"" help:"Read cross-period player analysis."`
}

type PersonAnalysisReadCmd struct {
	Name string `required:"" help:"Player name; must be a registered player."`
	From string `required:"" help:"Span start date, formatted as YYYY-MM-DD, inclusive."`
	To   string `required:"" help:"Span end date, formatted as YYYY-MM-DD, inclusive; must be >= --from."`
}

type Context struct {
	PlayerService *player.Service
	ReportService *report.Service
	GameService   *game.Service
	DrillService  *drill.Service
	PersonService *person.Service
	Out           io.Writer
	In            io.Reader
	Format        string
}

func Run(args []string, stdout io.Writer, stderr io.Writer) error {
	return RunWithIO(args, os.Stdin, stdout, stderr)
}

func RunWithIO(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) error {
	var app CLI
	parser := kong.Must(
		&app,
		kong.Name("bastion"),
		kong.Description("Baseball player self-training registration CLI."),
		kong.Writers(stdout, stderr),
	)

	ctx, err := parser.Parse(args)
	if err != nil {
		writeError(stdout, app.Format, err)
		return err
	}

	store, err := sqlite.Open(app.DB)
	if err != nil {
		writeError(stdout, app.Format, err)
		return err
	}
	defer store.Close()

	if err := store.Init(); err != nil {
		writeError(stdout, app.Format, err)
		return err
	}

	runErr := ctx.Run(&Context{
		PlayerService: player.NewService(store),
		ReportService: report.NewService(store),
		GameService:   game.NewService(store),
		DrillService:  drill.NewService(store),
		PersonService: person.NewService(store),
		Out:           stdout,
		In:            stdin,
		Format:        app.Format,
	})
	if runErr != nil {
		writeError(stdout, app.Format, runErr)
	}
	return runErr
}

func (cmd *PlayerAddCmd) Run(ctx *Context) error {
	var input playerAddInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	player, err := ctx.PlayerService.AddPlayer(input.Name, input.Number, input.Bat, input.Throw, input.Positions)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "player", "name": player.Name}, fmt.Sprintf("player added: %s\n", player.Name))
}

func (cmd *PlayerReadCmd) Run(ctx *Context) error {
	player, err := ctx.PlayerService.GetPlayer(cmd.Name)
	if err != nil {
		return err
	}
	return printPlayer(ctx, player)
}

func (cmd *ReportWriteCmd) Run(ctx *Context) error {
	var input reportWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	report, err := ctx.ReportService.WriteReport(input.Name, input.Date, input.Content, input.Reflection)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "report", "name": report.Name, "date": report.Date}, fmt.Sprintf("report saved: %s %s\n", report.Name, report.Date))
}

func (cmd *ReportReadCmd) Run(ctx *Context) error {
	report, err := ctx.ReportService.GetReport(cmd.Name, cmd.Date)
	if err != nil {
		return err
	}
	return printReport(ctx, report)
}

func (cmd *GameWriteCmd) Run(ctx *Context) error {
	var input gameWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	battingSide, err := parseBattingSide(input.BattingSide)
	if err != nil {
		return err
	}
	lineups, err := lineupsFromJSON(input.Lineups)
	if err != nil {
		return err
	}
	events, err := eventsFromJSON(input.Events)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.WriteGame(
		input.Date,
		input.StartTime,
		input.Opponent,
		battingSide,
		input.OwnScore,
		input.OpponentScore,
		input.Raw,
		lineups,
		events,
	)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game", "id": id}, fmt.Sprintf("game saved: %d\n", id))
}

func (cmd *GameCreateCmd) Run(ctx *Context) error {
	var input gameCreateInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	battingSide, err := parseBattingSide(input.BattingSide)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.CreateGame(input.Date, input.StartTime, input.Opponent, battingSide, input.Raw)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game", "id": id}, fmt.Sprintf("game created: %d\n", id))
}

func (cmd *GameLineupAddCmd) Run(ctx *Context) error {
	var input gameLineupAddInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	team, err := parseTeam(input.Team)
	if err != nil {
		return err
	}
	startingPosition, err := parseOptionalStartingPosition(input.StartingPosition)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.AddGameLineup(input.GameID, team, input.Player, input.BattingOrder, startingPosition)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_lineup", "id": id, "game_id": input.GameID}, fmt.Sprintf("lineup added: %d\n", id))
}

func (cmd *GameEventWriteCmd) Run(ctx *Context) error {
	var input gameEventWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	events, err := eventsFromJSON(input.Events)
	if err != nil {
		return err
	}
	count, err := ctx.GameService.WriteGameEvents(input.GameID, events)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_events", "game_id": input.GameID, "count": count}, fmt.Sprintf("game events saved: %d\n", count))
}

func (cmd *GameScoreSetCmd) Run(ctx *Context) error {
	var input gameScoreSetInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	if err := ctx.GameService.SetGameScore(input.GameID, input.OwnScore, input.OpponentScore); err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_score", "game_id": input.GameID, "own_score": input.OwnScore, "opponent_score": input.OpponentScore}, fmt.Sprintf("score saved: %d\n", input.GameID))
}

func (cmd *GameAnalysisGenerateCmd) Run(ctx *Context) error {
	var input gameAnalysisGenerateInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	id, err := ctx.GameService.GenerateGameAnalysis(input.GameID)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "game_analysis", "id": id, "game_id": input.GameID}, fmt.Sprintf("game analysis generated: %d\n", id))
}

func (cmd *GameAnalysisReadCmd) Run(ctx *Context) error {
	analysis, err := ctx.GameService.ReadGameAnalysis(cmd.GameID, cmd.Player)
	if err != nil {
		return err
	}
	return printGameAnalysis(ctx, analysis)
}

func (cmd *GameAnalysisListCmd) Run(ctx *Context) error {
	items, err := ctx.GameService.ListGameAnalyses()
	if err != nil {
		return err
	}
	return printGameAnalysisList(ctx, items)
}

func (cmd *GameReadCmd) Run(ctx *Context) error {
	details, err := ctx.GameService.GetGame(cmd.ID)
	if err != nil {
		return err
	}
	return printGameDetails(ctx, details)
}

func (cmd *GameListCmd) Run(ctx *Context) error {
	games, err := ctx.GameService.ListGames(cmd.Date)
	if err != nil {
		return err
	}
	return printGameList(ctx, games)
}

func (cmd *DrillWriteCmd) Run(ctx *Context) error {
	var input drillWriteInput
	if err := readJSONInput(ctx, cmd.Input, &input); err != nil {
		return err
	}
	drillType, err := parseDrillType(input.Type)
	if err != nil {
		return err
	}
	id, err := ctx.DrillService.WriteRecommendation(input.Name, input.URL, input.Reason, drillType, input.Summary)
	if err != nil {
		return err
	}
	return writeCommandResult(ctx, map[string]any{"resource": "drill_recommendation", "id": id}, fmt.Sprintf("drill recommendation saved: %d\n", id))
}

func (cmd *DrillListCmd) Run(ctx *Context) error {
	drillType, err := parseOptionalDrillType(cmd.Type)
	if err != nil {
		return err
	}
	recommendations, err := ctx.DrillService.ListRecommendations(drill.ListFilter{
		Name: cmd.Name,
		Type: drillType,
	})
	if err != nil {
		return err
	}
	return printDrillRecommendationList(ctx, recommendations)
}

func (cmd *PersonAnalysisReadCmd) Run(ctx *Context) error {
	result, err := ctx.PersonService.ReadPersonAnalysis(cmd.Name, cmd.From, cmd.To)
	if err != nil {
		return err
	}
	return printPersonAnalysis(ctx, result)
}

func printPlayer(ctx *Context, p player.Player) error {
	return writeStructured(ctx, playerReadTOML{Player: playerTOMLFrom(p)})
}

func printReport(ctx *Context, report report.Report) error {
	return writeStructured(ctx, reportReadTOML{Report: reportTOMLFrom(report)})
}

func writeStructured(ctx *Context, value any) error {
	switch ctx.Format {
	case "toml":
		writeTOML(ctx.Out, value)
		return nil
	case "text":
		writeTOML(ctx.Out, value)
		return nil
	default:
		data, err := dataFromTOMLTags(value)
		if err != nil {
			return err
		}
		return writeJSONData(ctx.Out, data)
	}
}

func writeCommandResult(ctx *Context, data map[string]any, text string) error {
	if ctx.Format == "text" {
		fmt.Fprint(ctx.Out, text)
		return nil
	}
	if ctx.Format == "toml" {
		writeTOML(ctx.Out, data)
		return nil
	}
	return writeJSONData(ctx.Out, data)
}

func writeTOML(out io.Writer, value any) {
	data, err := toml.Marshal(value)
	if err != nil {
		panic(fmt.Sprintf("marshal CLI output as TOML: %v", err))
	}
	fmt.Fprint(out, string(data))
}

func writeJSONData(out io.Writer, data any) error {
	return writeJSON(out, jsonEnvelope{Ok: true, Data: data})
}

func writeError(out io.Writer, format string, err error) {
	if err == nil || format == "toml" || format == "text" {
		return
	}
	_ = writeJSON(out, jsonEnvelope{
		Ok: false,
		Error: &jsonError{
			Code:    errorCode(err),
			Message: err.Error(),
		},
	})
}

func writeJSON(out io.Writer, value any) error {
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	return encoder.Encode(value)
}

func dataFromTOMLTags(value any) (any, error) {
	data, err := toml.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal CLI output as TOML: %w", err)
	}
	var decoded map[string]any
	if err := toml.Unmarshal(data, &decoded); err != nil {
		return nil, fmt.Errorf("convert CLI output to JSON data: %w", err)
	}
	return decoded, nil
}

func readJSONInput(ctx *Context, path string, value any) error {
	raw, err := readInput(ctx, path)
	if err != nil {
		return err
	}
	if err := requireJSONFields(raw, requiredFields(value)); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("invalid --input: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("invalid --input: expected a single JSON value")
	}
	return nil
}

func requiredFields(value any) []string {
	switch value.(type) {
	case *playerAddInput:
		return []string{"name", "number", "bat", "throw", "positions"}
	case *reportWriteInput:
		return []string{"name", "date", "content", "reflection"}
	case *gameWriteInput:
		return []string{"date", "opponent", "batting_side", "own_score", "opponent_score", "raw"}
	case *gameCreateInput:
		return []string{"date", "opponent", "batting_side", "raw"}
	case *gameLineupAddInput:
		return []string{"game_id", "team", "player"}
	case *gameEventWriteInput:
		return []string{"game_id", "events"}
	case *gameScoreSetInput:
		return []string{"game_id", "own_score", "opponent_score"}
	case *gameAnalysisGenerateInput:
		return []string{"game_id"}
	case *drillWriteInput:
		return []string{"name", "url", "reason", "type", "summary"}
	default:
		return nil
	}
}

func requireJSONFields(raw []byte, fields []string) error {
	if len(fields) == 0 {
		return nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil
	}
	for _, field := range fields {
		if _, ok := object[field]; !ok {
			return fmt.Errorf("missing required field %q", field)
		}
	}
	return nil
}

func readInput(ctx *Context, path string) ([]byte, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("--input is required")
	}
	if path == "-" {
		raw, err := io.ReadAll(ctx.In)
		if err != nil {
			return nil, fmt.Errorf("read --input -: %w", err)
		}
		return raw, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read --input %q: %w", path, err)
	}
	return raw, nil
}

func errorCode(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "missing required"):
		return "missing_required"
	case strings.Contains(message, "unknown field"):
		return "unknown_field"
	case strings.Contains(message, "invalid character"), strings.Contains(message, "cannot unmarshal"), strings.Contains(message, "unexpected eof"):
		return "parse_error"
	case strings.Contains(message, "not found"):
		return "not_found"
	case strings.Contains(message, "already exists"):
		return "conflict"
	case strings.Contains(message, "invalid"), strings.Contains(message, "expected"), strings.Contains(message, "cannot be empty"), strings.Contains(message, "no analyzable"):
		return "invalid_value"
	default:
		return "internal_error"
	}
}

type jsonEnvelope struct {
	Ok    bool       `json:"ok"`
	Data  any        `json:"data,omitempty"`
	Error *jsonError `json:"error,omitempty"`
}

type jsonError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type playerReadTOML struct {
	Player playerTOML `toml:"player"`
}

type playerTOML struct {
	Name      string `toml:"name"`
	Number    int    `toml:"number"`
	Bat       string `toml:"bat"`
	Throw     string `toml:"throw"`
	Positions string `toml:"positions"`
}

func playerTOMLFrom(p player.Player) playerTOML {
	return playerTOML{
		Name:      p.Name,
		Number:    p.Number,
		Bat:       player.FormatHands(p.Bat),
		Throw:     player.FormatHands(p.Throw),
		Positions: player.FormatPositions(p.Positions),
	}
}

type reportReadTOML struct {
	Report reportTOML `toml:"report"`
}

type reportTOML struct {
	Name       string `toml:"name"`
	Date       string `toml:"date"`
	Content    string `toml:"content"`
	Reflection string `toml:"reflection"`
}

func reportTOMLFrom(r report.Report) reportTOML {
	return reportTOML{
		Name:       r.Name,
		Date:       r.Date,
		Content:    r.Content,
		Reflection: r.Reflection,
	}
}

type playerAddInput struct {
	Name      string `json:"name"`
	Number    int    `json:"number"`
	Bat       string `json:"bat"`
	Throw     string `json:"throw"`
	Positions string `json:"positions"`
}

type reportWriteInput struct {
	Name       string `json:"name"`
	Date       string `json:"date"`
	Content    string `json:"content"`
	Reflection string `json:"reflection"`
}

type gameWriteInput struct {
	Date          string       `json:"date"`
	StartTime     string       `json:"start_time"`
	Opponent      string       `json:"opponent"`
	BattingSide   string       `json:"batting_side"`
	OwnScore      int          `json:"own_score"`
	OpponentScore int          `json:"opponent_score"`
	Raw           string       `json:"raw"`
	Lineups       []lineupJSON `json:"lineups"`
	Events        []eventJSON  `json:"events"`
}

type gameCreateInput struct {
	Date        string `json:"date"`
	StartTime   string `json:"start_time"`
	Opponent    string `json:"opponent"`
	BattingSide string `json:"batting_side"`
	Raw         string `json:"raw"`
}

type gameLineupAddInput struct {
	GameID           int64   `json:"game_id"`
	Team             string  `json:"team"`
	Player           string  `json:"player"`
	BattingOrder     *int    `json:"batting_order"`
	StartingPosition *string `json:"starting_position"`
}

type gameEventWriteInput struct {
	GameID int64       `json:"game_id"`
	Events []eventJSON `json:"events"`
}

type gameScoreSetInput struct {
	GameID        int64 `json:"game_id"`
	OwnScore      int   `json:"own_score"`
	OpponentScore int   `json:"opponent_score"`
}

type gameAnalysisGenerateInput struct {
	GameID int64 `json:"game_id"`
}

type drillWriteInput struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Reason  string `json:"reason"`
	Type    string `json:"type"`
	Summary string `json:"summary"`
}

type lineupJSON struct {
	Team             string  `json:"team"`
	Player           string  `json:"player"`
	BattingOrder     *int    `json:"batting_order"`
	StartingPosition *string `json:"starting_position"`
}

type eventJSON struct {
	Inning        int     `json:"inning"`
	Half          string  `json:"half"`
	PlayNo        *int    `json:"play_no"`
	Sequence      int     `json:"sequence"`
	EventKind     string  `json:"event_kind"`
	Player        string  `json:"player"`
	Team          string  `json:"team"`
	Result        string  `json:"result"`
	RelatedPlayer string  `json:"related_player"`
	PitchSequence string  `json:"pitch_sequence"`
	BaseFrom      *int    `json:"base_from"`
	BaseTo        *int    `json:"base_to"`
	Reason        *string `json:"reason"`
	OutsOnPlay    int     `json:"outs_on_play"`
	RunsScored    int     `json:"runs_scored"`
	RBIPlayer     string  `json:"rbi_player"`
	Earned        *bool   `json:"earned"`
	Value         int     `json:"value"`
	Description   string  `json:"description"`
}

func lineupsFromJSON(records []lineupJSON) ([]game.GameLineup, error) {
	lineups := make([]game.GameLineup, 0, len(records))
	for i, record := range records {
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid lineups[%d]: %w", i, err)
		}
		startingPosition, err := parseOptionalStartingPosition(record.StartingPosition)
		if err != nil {
			return nil, fmt.Errorf("invalid lineups[%d]: %w", i, err)
		}
		lineups = append(lineups, game.GameLineup{
			Team:             team,
			Player:           record.Player,
			BattingOrder:     record.BattingOrder,
			StartingPosition: startingPosition,
		})
	}
	if lineups == nil {
		lineups = []game.GameLineup{}
	}
	return lineups, nil
}

func eventsFromJSON(records []eventJSON) ([]game.GameEvent, error) {
	events := make([]game.GameEvent, 0, len(records))
	for i, record := range records {
		half, err := parseHalf(record.Half)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		kind, err := parseEventKind(record.EventKind)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		result, err := parseEventResult(kind, record.Result)
		if err != nil {
			return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
		}
		var reason *game.RunnerReason
		if record.Reason != nil && strings.TrimSpace(*record.Reason) != "" {
			parsed, err := parseRunnerReason(*record.Reason)
			if err != nil {
				return nil, fmt.Errorf("invalid events[%d]: %w", i, err)
			}
			reason = &parsed
		}
		events = append(events, game.GameEvent{
			Inning:        record.Inning,
			Half:          half,
			PlayNo:        record.PlayNo,
			Sequence:      record.Sequence,
			EventKind:     kind,
			Player:        record.Player,
			Team:          team,
			Result:        result,
			RelatedPlayer: record.RelatedPlayer,
			PitchSequence: record.PitchSequence,
			BaseFrom:      record.BaseFrom,
			BaseTo:        record.BaseTo,
			Reason:        reason,
			OutsOnPlay:    record.OutsOnPlay,
			RunsScored:    record.RunsScored,
			RBIPlayer:     record.RBIPlayer,
			Earned:        record.Earned,
			Value:         record.Value,
			Description:   record.Description,
		})
	}
	if events == nil {
		events = []game.GameEvent{}
	}
	return events, nil
}

func printGameDetails(ctx *Context, details game.GameDetails) error {
	output := gameDetailsTOML{
		Game:    gameTOMLFrom(details.Game),
		Lineups: make([]lineupTOML, 0, len(details.Lineups)),
		Events:  make([]eventTOML, 0, len(details.Events)),
	}
	for _, row := range details.Lineups {
		output.Lineups = append(output.Lineups, lineupTOMLFrom(row))
	}
	for _, row := range details.Events {
		output.Events = append(output.Events, eventTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

func printGameList(ctx *Context, games []game.Game) error {
	if len(games) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := gameListTOML{Games: make([]gameTOML, 0, len(games))}
	for _, row := range games {
		output.Games = append(output.Games, gameTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

func printGameAnalysis(ctx *Context, result game.GameAnalysisResult) error {
	output := gameAnalysisTOML{
		Analysis:        gameAnalysisHeaderTOMLFrom(result.Analysis),
		PlayerSummaries: make([]playerSummaryTOML, 0, len(result.Summaries)),
		Batting:         make([]battingTOML, 0, len(result.Batting)),
		Baserunning:     make([]baserunningTOML, 0, len(result.Baserunning)),
		Pitching:        make([]pitchingTOML, 0, len(result.Pitching)),
		Fielding:        make([]fieldingTOML, 0, len(result.Fielding)),
		DataGaps:        make([]dataGapTOML, 0, len(result.DataGaps)),
	}
	for _, row := range result.Summaries {
		output.PlayerSummaries = append(output.PlayerSummaries, playerSummaryTOMLFrom(row))
	}
	for _, row := range result.Batting {
		output.Batting = append(output.Batting, battingTOMLFrom(row))
	}
	for _, row := range result.Baserunning {
		output.Baserunning = append(output.Baserunning, baserunningTOMLFrom(row))
	}
	for _, row := range result.Pitching {
		output.Pitching = append(output.Pitching, pitchingTOMLFrom(row))
	}
	for _, row := range result.Fielding {
		output.Fielding = append(output.Fielding, fieldingTOMLFrom(row))
	}
	for _, row := range result.DataGaps {
		output.DataGaps = append(output.DataGaps, dataGapTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

func printGameAnalysisList(ctx *Context, items []game.GameAnalysisListItem) error {
	if len(items) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := gameAnalysisListTOML{Analyses: make([]gameAnalysisListItemTOML, 0, len(items))}
	for _, row := range items {
		output.Analyses = append(output.Analyses, gameAnalysisListItemTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

func printDrillRecommendationList(ctx *Context, recommendations []drill.Recommendation) error {
	if len(recommendations) == 0 && ctx.Format == "toml" {
		return nil
	}
	output := drillRecommendationListTOML{Drills: make([]drillRecommendationTOML, 0, len(recommendations))}
	for _, row := range recommendations {
		output.Drills = append(output.Drills, drillRecommendationTOMLFrom(row))
	}
	return writeStructured(ctx, output)
}

func printPersonAnalysis(ctx *Context, result person.AnalysisResult) error {
	output := personAnalysisTOML{
		Analysis:    personAnalysisHeaderTOMLFrom(result.Analysis),
		Summary:     personSummaryTOMLFrom(result.Summary),
		Batting:     personBattingTOMLFrom(result.Batting),
		Baserunning: personBaserunningTOMLFrom(result.Baserunning),
		Pitching:    personPitchingTOMLFrom(result.Pitching),
		Fielding:    personFieldingTOMLFrom(result.Fielding),
		DataGaps:    make([]dataGapTOML, 0, len(result.DataGaps)),
	}
	for _, row := range result.DataGaps {
		output.DataGaps = append(output.DataGaps, dataGapTOML{Scope: row.Scope, Message: row.Message})
	}
	return writeStructured(ctx, output)
}

type gameDetailsTOML struct {
	Game    gameTOML     `toml:"game"`
	Lineups []lineupTOML `toml:"lineups"`
	Events  []eventTOML  `toml:"events"`
}

type gameListTOML struct {
	Games []gameTOML `toml:"games"`
}

type gameTOML struct {
	ID            int64  `toml:"id"`
	Date          string `toml:"date"`
	StartTime     string `toml:"start_time"`
	Opponent      string `toml:"opponent"`
	BattingSide   string `toml:"batting_side"`
	OwnScore      int    `toml:"own_score"`
	OpponentScore int    `toml:"opponent_score"`
	Score         string `toml:"score"`
	IsFinal       bool   `toml:"is_final"`
	Raw           string `toml:"raw"`
	CreatedAt     string `toml:"created_at"`
}

func gameTOMLFrom(g game.Game) gameTOML {
	return gameTOML{
		ID:            g.ID,
		Date:          g.Date,
		StartTime:     g.StartTime,
		Opponent:      g.Opponent,
		BattingSide:   formatBattingSide(g.BattingSide),
		OwnScore:      g.OwnScore,
		OpponentScore: g.OpponentScore,
		Score:         fmt.Sprintf("%d-%d", g.OwnScore, g.OpponentScore),
		IsFinal:       g.IsFinal,
		Raw:           g.Raw,
		CreatedAt:     g.CreatedAt,
	}
}

type lineupTOML struct {
	ID               int64   `toml:"id"`
	Team             string  `toml:"team"`
	Player           string  `toml:"player"`
	BattingOrder     *int    `toml:"batting_order,omitempty"`
	StartingPosition *string `toml:"starting_position,omitempty"`
}

func lineupTOMLFrom(row game.GameLineup) lineupTOML {
	return lineupTOML{
		ID:               row.ID,
		Team:             formatTeam(row.Team),
		Player:           row.Player,
		BattingOrder:     row.BattingOrder,
		StartingPosition: startingPositionString(row.StartingPosition),
	}
}

type eventTOML struct {
	ID            int64   `toml:"id"`
	Inning        int     `toml:"inning"`
	Half          string  `toml:"half"`
	PlayNo        *int    `toml:"play_no,omitempty"`
	Sequence      int     `toml:"sequence"`
	EventKind     string  `toml:"event_kind"`
	Player        string  `toml:"player"`
	Team          string  `toml:"team"`
	Result        string  `toml:"result"`
	RelatedPlayer string  `toml:"related_player"`
	PitchSequence string  `toml:"pitch_sequence"`
	BaseFrom      *int    `toml:"base_from,omitempty"`
	BaseTo        *int    `toml:"base_to,omitempty"`
	Reason        *string `toml:"reason,omitempty"`
	OutsOnPlay    int     `toml:"outs_on_play"`
	RunsScored    int     `toml:"runs_scored"`
	RBIPlayer     string  `toml:"rbi_player"`
	Earned        *bool   `toml:"earned,omitempty"`
	Value         int     `toml:"value"`
	Description   string  `toml:"description"`
}

func eventTOMLFrom(row game.GameEvent) eventTOML {
	return eventTOML{
		ID:            row.ID,
		Inning:        row.Inning,
		Half:          formatHalf(row.Half),
		PlayNo:        row.PlayNo,
		Sequence:      row.Sequence,
		EventKind:     formatEventKind(row.EventKind),
		Player:        row.Player,
		Team:          formatTeam(row.Team),
		Result:        formatEventResult(row.EventKind, row.Result),
		RelatedPlayer: row.RelatedPlayer,
		PitchSequence: row.PitchSequence,
		BaseFrom:      row.BaseFrom,
		BaseTo:        row.BaseTo,
		Reason:        runnerReasonString(row.Reason),
		OutsOnPlay:    row.OutsOnPlay,
		RunsScored:    row.RunsScored,
		RBIPlayer:     row.RBIPlayer,
		Earned:        row.Earned,
		Value:         row.Value,
		Description:   row.Description,
	}
}

type gameAnalysisTOML struct {
	Analysis        gameAnalysisHeaderTOML `toml:"analysis"`
	PlayerSummaries []playerSummaryTOML    `toml:"player_summaries"`
	Batting         []battingTOML          `toml:"batting"`
	Baserunning     []baserunningTOML      `toml:"baserunning"`
	Pitching        []pitchingTOML         `toml:"pitching"`
	Fielding        []fieldingTOML         `toml:"fielding"`
	DataGaps        []dataGapTOML          `toml:"data_gaps"`
}

type gameAnalysisHeaderTOML struct {
	GameID          int64  `toml:"game_id"`
	Date            string `toml:"date"`
	Opponent        string `toml:"opponent"`
	OwnRuns         int    `toml:"own_runs"`
	OpponentRuns    int    `toml:"opponent_runs"`
	Score           string `toml:"score"`
	Result          string `toml:"result"`
	IsFinal         bool   `toml:"is_final"`
	PlayersAnalyzed int    `toml:"players_analyzed"`
	GeneratedAt     string `toml:"generated_at"`
}

func gameAnalysisHeaderTOMLFrom(row game.GameAnalysis) gameAnalysisHeaderTOML {
	return gameAnalysisHeaderTOML{
		GameID:          row.GameID,
		Date:            row.Date,
		Opponent:        row.Opponent,
		OwnRuns:         row.OwnRuns,
		OpponentRuns:    row.OpponentRuns,
		Score:           fmt.Sprintf("%d-%d", row.OwnRuns, row.OpponentRuns),
		Result:          formatGameResult(row.Result),
		IsFinal:         row.IsFinal,
		PlayersAnalyzed: row.PlayersAnalyzed,
		GeneratedAt:     row.GeneratedAt,
	}
}

type playerSummaryTOML struct {
	Player               string `toml:"player"`
	BattingOrder         *int   `toml:"batting_order,omitempty"`
	Positions            string `toml:"positions"`
	BattingAvailable     bool   `toml:"batting_available"`
	BaserunningAvailable bool   `toml:"baserunning_available"`
	PitchingAvailable    bool   `toml:"pitching_available"`
	FieldingAvailable    bool   `toml:"fielding_available"`
	Highlight            string `toml:"highlight"`
	Risk                 string `toml:"risk"`
}

func playerSummaryTOMLFrom(row game.PlayerPerformanceSummary) playerSummaryTOML {
	return playerSummaryTOML{
		Player:               row.Player,
		BattingOrder:         row.BattingOrder,
		Positions:            row.Positions,
		BattingAvailable:     row.BattingAvailable,
		BaserunningAvailable: row.BaserunningAvailable,
		PitchingAvailable:    row.PitchingAvailable,
		FieldingAvailable:    row.FieldingAvailable,
		Highlight:            row.Highlight,
		Risk:                 row.Risk,
	}
}

type battingTOML struct {
	Player                     string  `toml:"player"`
	PA                         int     `toml:"pa"`
	AtBats                     int     `toml:"at_bats"`
	Hits                       int     `toml:"hits"`
	Singles                    int     `toml:"singles"`
	Doubles                    int     `toml:"doubles"`
	Triples                    int     `toml:"triples"`
	Homeruns                   int     `toml:"homeruns"`
	Walks                      int     `toml:"walks"`
	HitByPitch                 int     `toml:"hit_by_pitch"`
	Strikeouts                 int     `toml:"strikeouts"`
	ReachedOnError             int     `toml:"reached_on_error"`
	RunsBattedIn               int     `toml:"runs_batted_in"`
	TotalBases                 int     `toml:"total_bases"`
	BattingAverage             float64 `toml:"batting_average"`
	SimplifiedOnBasePercentage float64 `toml:"simplified_on_base_percentage"`
	SluggingPercentage         float64 `toml:"slugging_percentage"`
	OPS                        float64 `toml:"ops"`
}

func battingTOMLFrom(row game.PlayerBattingStats) battingTOML {
	return battingTOML{
		Player:                     row.Player,
		PA:                         row.PA,
		AtBats:                     row.AtBats,
		Hits:                       row.Hits,
		Singles:                    row.Singles,
		Doubles:                    row.Doubles,
		Triples:                    row.Triples,
		Homeruns:                   row.Homeruns,
		Walks:                      row.Walks,
		HitByPitch:                 row.HitByPitch,
		Strikeouts:                 row.Strikeouts,
		ReachedOnError:             row.ReachedOnError,
		RunsBattedIn:               row.RunsBattedIn,
		TotalBases:                 row.TotalBases,
		BattingAverage:             row.BattingAverage,
		SimplifiedOnBasePercentage: row.OnBasePercentage,
		SluggingPercentage:         row.SluggingPercentage,
		OPS:                        row.OPS,
	}
}

type baserunningTOML struct {
	Player               string  `toml:"player"`
	Runs                 int     `toml:"runs"`
	StolenBases          int     `toml:"stolen_bases"`
	CaughtStealing       int     `toml:"caught_stealing"`
	StolenBaseAttempts   int     `toml:"stolen_base_attempts"`
	StolenBasePercentage float64 `toml:"stolen_base_percentage"`
	ExtraBasesTaken      int     `toml:"extra_bases_taken"`
	BaserunningOuts      int     `toml:"baserunning_outs"`
}

func baserunningTOMLFrom(row game.PlayerBaserunningStats) baserunningTOML {
	return baserunningTOML{
		Player:               row.Player,
		Runs:                 row.Runs,
		StolenBases:          row.StolenBases,
		CaughtStealing:       row.CaughtStealing,
		StolenBaseAttempts:   row.StolenBaseAttempts,
		StolenBasePercentage: row.StolenBasePercentage,
		ExtraBasesTaken:      row.ExtraBasesTaken,
		BaserunningOuts:      row.BaserunningOuts,
	}
}

type pitchingTOML struct {
	Player             string   `toml:"player"`
	OutsRecorded       int      `toml:"outs_recorded"`
	InningsPitched     float64  `toml:"innings_pitched"`
	BattersFaced       int      `toml:"batters_faced"`
	HitsAllowed        int      `toml:"hits_allowed"`
	WalksAllowed       int      `toml:"walks_allowed"`
	Strikeouts         int      `toml:"strikeouts"`
	HomerunsAllowed    int      `toml:"homeruns_allowed"`
	RunsAllowed        int      `toml:"runs_allowed"`
	EarnedRuns         int      `toml:"earned_runs"`
	RA9                float64  `toml:"ra9"`
	ERA                *float64 `toml:"era,omitempty"`
	WHIP               float64  `toml:"whip"`
	StrikeoutWalkRatio *float64 `toml:"strikeout_walk_ratio,omitempty"`
	WildPitches        int      `toml:"wild_pitches"`
	Balks              int      `toml:"balks"`
	Pickoffs           int      `toml:"pickoffs"`
	HitBatters         int      `toml:"hit_batters"`
}

func pitchingTOMLFrom(row game.PlayerPitchingStats) pitchingTOML {
	return pitchingTOML{
		Player:             row.Player,
		OutsRecorded:       row.OutsRecorded,
		InningsPitched:     row.InningsPitched,
		BattersFaced:       row.BattersFaced,
		HitsAllowed:        row.HitsAllowed,
		WalksAllowed:       row.WalksAllowed,
		Strikeouts:         row.Strikeouts,
		HomerunsAllowed:    row.HomerunsAllowed,
		RunsAllowed:        row.RunsAllowed,
		EarnedRuns:         row.EarnedRuns,
		RA9:                row.RA9,
		ERA:                row.ERA,
		WHIP:               row.WHIP,
		StrikeoutWalkRatio: row.StrikeoutWalkRatio,
		WildPitches:        row.WildPitches,
		Balks:              row.Balks,
		Pickoffs:           row.Pickoffs,
		HitBatters:         row.HitBatters,
	}
}

type fieldingTOML struct {
	Player             string  `toml:"player"`
	Positions          string  `toml:"positions"`
	Putouts            int     `toml:"putouts"`
	Assists            int     `toml:"assists"`
	Errors             int     `toml:"errors"`
	TotalChances       int     `toml:"total_chances"`
	FieldingPercentage float64 `toml:"fielding_percentage"`
	DoublePlays        int     `toml:"double_plays"`
	PassedBalls        int     `toml:"passed_balls"`
	OutfieldAssists    int     `toml:"outfield_assists"`
}

func fieldingTOMLFrom(row game.PlayerFieldingStats) fieldingTOML {
	return fieldingTOML{
		Player:             row.Player,
		Positions:          row.Positions,
		Putouts:            row.Putouts,
		Assists:            row.Assists,
		Errors:             row.Errors,
		TotalChances:       row.TotalChances,
		FieldingPercentage: row.FieldingPercentage,
		DoublePlays:        row.DoublePlays,
		PassedBalls:        row.PassedBalls,
		OutfieldAssists:    row.OutfieldAssists,
	}
}

type dataGapTOML struct {
	Scope   string `toml:"scope"`
	Message string `toml:"message"`
}

func dataGapTOMLFrom(row game.AnalysisDataGap) dataGapTOML {
	return dataGapTOML{
		Scope:   row.Scope,
		Message: row.Message,
	}
}

type personAnalysisTOML struct {
	Analysis    personAnalysisHeaderTOML `toml:"analysis"`
	Summary     personSummaryTOML        `toml:"summary"`
	Batting     personBattingTOML        `toml:"batting"`
	Baserunning personBaserunningTOML    `toml:"baserunning"`
	Pitching    personPitchingTOML       `toml:"pitching"`
	Fielding    personFieldingTOML       `toml:"fielding"`
	DataGaps    []dataGapTOML            `toml:"data_gaps"`
}

type personAnalysisHeaderTOML struct {
	Name          string `toml:"name"`
	SpanFrom      string `toml:"span_from"`
	SpanTo        string `toml:"span_to"`
	GamesInSpan   int    `toml:"games_in_span"`
	GamesAnalyzed int    `toml:"games_analyzed"`
	OwnWins       int    `toml:"own_wins"`
	OwnLosses     int    `toml:"own_losses"`
	OwnTies       int    `toml:"own_ties"`
	ComputedAt    string `toml:"computed_at"`
}

func personAnalysisHeaderTOMLFrom(row person.Analysis) personAnalysisHeaderTOML {
	return personAnalysisHeaderTOML{
		Name:          row.Name,
		SpanFrom:      row.SpanFrom,
		SpanTo:        row.SpanTo,
		GamesInSpan:   row.GamesInSpan,
		GamesAnalyzed: row.GamesAnalyzed,
		OwnWins:       row.OwnWins,
		OwnLosses:     row.OwnLosses,
		OwnTies:       row.OwnTies,
		ComputedAt:    row.ComputedAt,
	}
}

type personSummaryTOML struct {
	Positions            string `toml:"positions"`
	GamesBatting         int    `toml:"games_batting"`
	GamesBaserunning     int    `toml:"games_baserunning"`
	GamesPitching        int    `toml:"games_pitching"`
	GamesFielding        int    `toml:"games_fielding"`
	BattingAvailable     bool   `toml:"batting_available"`
	BaserunningAvailable bool   `toml:"baserunning_available"`
	PitchingAvailable    bool   `toml:"pitching_available"`
	FieldingAvailable    bool   `toml:"fielding_available"`
	Highlight            string `toml:"highlight"`
	Risk                 string `toml:"risk"`
}

func personSummaryTOMLFrom(row person.PerformanceSummary) personSummaryTOML {
	return personSummaryTOML{
		Positions:            row.Positions,
		GamesBatting:         row.GamesBatting,
		GamesBaserunning:     row.GamesBaserunning,
		GamesPitching:        row.GamesPitching,
		GamesFielding:        row.GamesFielding,
		BattingAvailable:     row.BattingAvailable,
		BaserunningAvailable: row.BaserunningAvailable,
		PitchingAvailable:    row.PitchingAvailable,
		FieldingAvailable:    row.FieldingAvailable,
		Highlight:            row.Highlight,
		Risk:                 row.Risk,
	}
}

type personBattingTOML struct {
	Games              int     `toml:"games"`
	PA                 int     `toml:"pa"`
	AtBats             int     `toml:"at_bats"`
	Hits               int     `toml:"hits"`
	Singles            int     `toml:"singles"`
	Doubles            int     `toml:"doubles"`
	Triples            int     `toml:"triples"`
	Homeruns           int     `toml:"homeruns"`
	Walks              int     `toml:"walks"`
	HitByPitch         int     `toml:"hit_by_pitch"`
	Strikeouts         int     `toml:"strikeouts"`
	ReachedOnError     int     `toml:"reached_on_error"`
	RunsBattedIn       int     `toml:"runs_batted_in"`
	TotalBases         int     `toml:"total_bases"`
	BattingAverage     float64 `toml:"batting_average"`
	OnBasePercentage   float64 `toml:"simplified_on_base_percentage"`
	SluggingPercentage float64 `toml:"slugging_percentage"`
	OPS                float64 `toml:"ops"`
}

func personBattingTOMLFrom(row person.BattingStats) personBattingTOML {
	return personBattingTOML{
		Games:              row.Games,
		PA:                 row.PA,
		AtBats:             row.AtBats,
		Hits:               row.Hits,
		Singles:            row.Singles,
		Doubles:            row.Doubles,
		Triples:            row.Triples,
		Homeruns:           row.Homeruns,
		Walks:              row.Walks,
		HitByPitch:         row.HitByPitch,
		Strikeouts:         row.Strikeouts,
		ReachedOnError:     row.ReachedOnError,
		RunsBattedIn:       row.RunsBattedIn,
		TotalBases:         row.TotalBases,
		BattingAverage:     row.BattingAverage,
		OnBasePercentage:   row.OnBasePercentage,
		SluggingPercentage: row.SluggingPercentage,
		OPS:                row.OPS,
	}
}

type personBaserunningTOML struct {
	Games                int     `toml:"games"`
	Runs                 int     `toml:"runs"`
	StolenBases          int     `toml:"stolen_bases"`
	CaughtStealing       int     `toml:"caught_stealing"`
	StolenBaseAttempts   int     `toml:"stolen_base_attempts"`
	StolenBasePercentage float64 `toml:"stolen_base_percentage"`
	ExtraBasesTaken      int     `toml:"extra_bases_taken"`
	BaserunningOuts      int     `toml:"baserunning_outs"`
}

func personBaserunningTOMLFrom(row person.BaserunningStats) personBaserunningTOML {
	return personBaserunningTOML{
		Games:                row.Games,
		Runs:                 row.Runs,
		StolenBases:          row.StolenBases,
		CaughtStealing:       row.CaughtStealing,
		StolenBaseAttempts:   row.StolenBaseAttempts,
		StolenBasePercentage: row.StolenBasePercentage,
		ExtraBasesTaken:      row.ExtraBasesTaken,
		BaserunningOuts:      row.BaserunningOuts,
	}
}

type personPitchingTOML struct {
	Games              int      `toml:"games"`
	OutsRecorded       int      `toml:"outs_recorded"`
	InningsPitched     float64  `toml:"innings_pitched"`
	BattersFaced       int      `toml:"batters_faced"`
	HitsAllowed        int      `toml:"hits_allowed"`
	WalksAllowed       int      `toml:"walks_allowed"`
	Strikeouts         int      `toml:"strikeouts"`
	HomerunsAllowed    int      `toml:"homeruns_allowed"`
	RunsAllowed        int      `toml:"runs_allowed"`
	EarnedRuns         int      `toml:"earned_runs"`
	RA9                float64  `toml:"ra9"`
	ERA                *float64 `toml:"era,omitempty"`
	WHIP               float64  `toml:"whip"`
	StrikeoutWalkRatio *float64 `toml:"strikeout_walk_ratio,omitempty"`
	WildPitches        int      `toml:"wild_pitches"`
	Balks              int      `toml:"balks"`
	Pickoffs           int      `toml:"pickoffs"`
	HitBatters         int      `toml:"hit_batters"`
}

func personPitchingTOMLFrom(row person.PitchingStats) personPitchingTOML {
	return personPitchingTOML{
		Games:              row.Games,
		OutsRecorded:       row.OutsRecorded,
		InningsPitched:     row.InningsPitched,
		BattersFaced:       row.BattersFaced,
		HitsAllowed:        row.HitsAllowed,
		WalksAllowed:       row.WalksAllowed,
		Strikeouts:         row.Strikeouts,
		HomerunsAllowed:    row.HomerunsAllowed,
		RunsAllowed:        row.RunsAllowed,
		EarnedRuns:         row.EarnedRuns,
		RA9:                row.RA9,
		ERA:                row.ERA,
		WHIP:               row.WHIP,
		StrikeoutWalkRatio: row.StrikeoutWalkRatio,
		WildPitches:        row.WildPitches,
		Balks:              row.Balks,
		Pickoffs:           row.Pickoffs,
		HitBatters:         row.HitBatters,
	}
}

type personFieldingTOML struct {
	Games              int     `toml:"games"`
	Positions          string  `toml:"positions"`
	Putouts            int     `toml:"putouts"`
	Assists            int     `toml:"assists"`
	Errors             int     `toml:"errors"`
	TotalChances       int     `toml:"total_chances"`
	FieldingPercentage float64 `toml:"fielding_percentage"`
	DoublePlays        int     `toml:"double_plays"`
	PassedBalls        int     `toml:"passed_balls"`
	OutfieldAssists    int     `toml:"outfield_assists"`
}

func personFieldingTOMLFrom(row person.FieldingStats) personFieldingTOML {
	return personFieldingTOML{
		Games:              row.Games,
		Positions:          row.Positions,
		Putouts:            row.Putouts,
		Assists:            row.Assists,
		Errors:             row.Errors,
		TotalChances:       row.TotalChances,
		FieldingPercentage: row.FieldingPercentage,
		DoublePlays:        row.DoublePlays,
		PassedBalls:        row.PassedBalls,
		OutfieldAssists:    row.OutfieldAssists,
	}
}

type gameAnalysisListTOML struct {
	Analyses []gameAnalysisListItemTOML `toml:"analyses"`
}

type gameAnalysisListItemTOML struct {
	GameID          int64  `toml:"game_id"`
	Date            string `toml:"date"`
	Opponent        string `toml:"opponent"`
	OwnRuns         int    `toml:"own_runs"`
	OpponentRuns    int    `toml:"opponent_runs"`
	Score           string `toml:"score"`
	Result          string `toml:"result"`
	IsFinal         bool   `toml:"is_final"`
	PlayersAnalyzed int    `toml:"players_analyzed"`
	GeneratedAt     string `toml:"generated_at"`
}

func gameAnalysisListItemTOMLFrom(row game.GameAnalysisListItem) gameAnalysisListItemTOML {
	return gameAnalysisListItemTOML{
		GameID:          row.GameID,
		Date:            row.Date,
		Opponent:        row.Opponent,
		OwnRuns:         row.OwnRuns,
		OpponentRuns:    row.OpponentRuns,
		Score:           fmt.Sprintf("%d-%d", row.OwnRuns, row.OpponentRuns),
		Result:          formatGameResult(row.Result),
		IsFinal:         row.IsFinal,
		PlayersAnalyzed: row.PlayersAnalyzed,
		GeneratedAt:     row.GeneratedAt,
	}
}

type drillRecommendationListTOML struct {
	Drills []drillRecommendationTOML `toml:"drills"`
}

type drillRecommendationTOML struct {
	ID        int64  `toml:"id"`
	Name      string `toml:"name"`
	Type      string `toml:"type"`
	URL       string `toml:"url"`
	Reason    string `toml:"reason"`
	Summary   string `toml:"summary"`
	CreatedAt string `toml:"created_at"`
}

func drillRecommendationTOMLFrom(row drill.Recommendation) drillRecommendationTOML {
	return drillRecommendationTOML{
		ID:        row.ID,
		Name:      row.Name,
		Type:      formatDrillType(row.Type),
		URL:       row.URL,
		Reason:    row.Reason,
		Summary:   row.Summary,
		CreatedAt: row.CreatedAt,
	}
}

func runnerReasonString(value *game.RunnerReason) *string {
	if value == nil {
		return nil
	}
	formatted := formatOptionalRunnerReason(value)
	return &formatted
}

func startingPositionString(value *int) *string {
	if value == nil {
		return nil
	}
	formatted := formatOptionalStartingPosition(value)
	return &formatted
}

type stringEnum[T comparable] struct {
	label string
	value T
}

var battingSideOptions = []stringEnum[game.BattingSide]{
	{label: "top", value: game.BattingSideTop},
	{label: "bottom", value: game.BattingSideBottom},
}

var teamOptions = []stringEnum[game.Team]{
	{label: "own", value: game.TeamOwn},
	{label: "opponent", value: game.TeamOpponent},
}

var halfOptions = []stringEnum[game.Half]{
	{label: "top", value: game.HalfTop},
	{label: "bottom", value: game.HalfBottom},
}

var eventKindOptions = []stringEnum[game.EventKind]{
	{label: "plate_result", value: game.EventKindPlateResult},
	{label: "runner_movement", value: game.EventKindRunnerMovement},
	{label: "fielding_credit", value: game.EventKindFieldingCredit},
}

var plateResultOptions = []stringEnum[game.PlateResult]{
	{label: "single", value: game.PlateResultSingle},
	{label: "double", value: game.PlateResultDouble},
	{label: "triple", value: game.PlateResultTriple},
	{label: "homerun", value: game.PlateResultHomerun},
	{label: "walk", value: game.PlateResultWalk},
	{label: "hit_by_pitch", value: game.PlateResultHitByPitch},
	{label: "strikeout", value: game.PlateResultStrikeout},
	{label: "groundout", value: game.PlateResultGroundout},
	{label: "flyout", value: game.PlateResultFlyout},
	{label: "reached_on_error", value: game.PlateResultReachedOnError},
	{label: "fielders_choice", value: game.PlateResultFieldersChoice},
	{label: "sacrifice", value: game.PlateResultSacrifice},
	{label: "other", value: game.PlateResultOther},
}

var runnerResultOptions = []stringEnum[game.RunnerResult]{
	{label: "advance", value: game.RunnerResultAdvance},
	{label: "run_scored", value: game.RunnerResultRunScored},
	{label: "out", value: game.RunnerResultOut},
}

var runnerReasonOptions = []stringEnum[game.RunnerReason]{
	{label: "batted_ball", value: game.RunnerReasonBattedBall},
	{label: "stolen_base", value: game.RunnerReasonStolenBase},
	{label: "caught_stealing", value: game.RunnerReasonCaughtStealing},
	{label: "wild_pitch", value: game.RunnerReasonWildPitch},
	{label: "passed_ball", value: game.RunnerReasonPassedBall},
	{label: "balk", value: game.RunnerReasonBalk},
	{label: "pickoff", value: game.RunnerReasonPickoff},
	{label: "error", value: game.RunnerReasonError},
	{label: "fielders_choice", value: game.RunnerReasonFieldersChoice},
	{label: "other", value: game.RunnerReasonOther},
}

var fieldingResultOptions = []stringEnum[game.FieldingResult]{
	{label: "putout", value: game.FieldingResultPutout},
	{label: "assist", value: game.FieldingResultAssist},
	{label: "error", value: game.FieldingResultError},
	{label: "double_play", value: game.FieldingResultDoublePlay},
	{label: "passed_ball", value: game.FieldingResultPassedBall},
	{label: "outfield_assist", value: game.FieldingResultOutfieldAssist},
	{label: "other", value: game.FieldingResultOther},
}

var gameResultOptions = []stringEnum[game.GameResult]{
	{label: "win", value: game.GameResultWin},
	{label: "loss", value: game.GameResultLoss},
	{label: "tie", value: game.GameResultTie},
	{label: "in_progress", value: game.GameResultInProgress},
}

var startingPositionOptions = []stringEnum[int]{
	{label: "P", value: 1},
	{label: "C", value: 2},
	{label: "1B", value: 3},
	{label: "2B", value: 4},
	{label: "3B", value: 5},
	{label: "SS", value: 6},
	{label: "LF", value: 7},
	{label: "CF", value: 8},
	{label: "RF", value: 9},
}

var drillTypeOptions = []stringEnum[drill.DrillType]{
	{label: "pitching", value: drill.DrillTypePitching},
	{label: "catching", value: drill.DrillTypeCatching},
	{label: "hitting", value: drill.DrillTypeHitting},
	{label: "strength", value: drill.DrillTypeStrength},
	{label: "baserunning", value: drill.DrillTypeBaserunning},
	{label: "infield", value: drill.DrillTypeInfield},
	{label: "outfield", value: drill.DrillTypeOutfield},
}

func parseBattingSide(raw string) (game.BattingSide, error) {
	return parseStringEnum("--batting-side", raw, battingSideOptions, strings.ToLower)
}

func parseTeam(raw string) (game.Team, error) {
	return parseStringEnum("--team", raw, teamOptions, strings.ToLower)
}

func parseHalf(raw string) (game.Half, error) {
	return parseStringEnum("--half", raw, halfOptions, strings.ToLower)
}

func parseEventKind(raw string) (game.EventKind, error) {
	return parseStringEnum("--event-kind", raw, eventKindOptions, strings.ToLower)
}

func parseEventResult(kind game.EventKind, raw string) (int, error) {
	switch kind {
	case game.EventKindPlateResult:
		value, err := parseStringEnum("--result", raw, plateResultOptions, strings.ToLower)
		return int(value), err
	case game.EventKindRunnerMovement:
		value, err := parseStringEnum("--result", raw, runnerResultOptions, strings.ToLower)
		return int(value), err
	case game.EventKindFieldingCredit:
		value, err := parseStringEnum("--result", raw, fieldingResultOptions, strings.ToLower)
		return int(value), err
	default:
		return 0, fmt.Errorf("invalid --event-kind %d", kind)
	}
}

func parseRunnerReason(raw string) (game.RunnerReason, error) {
	return parseStringEnum("--reason", raw, runnerReasonOptions, strings.ToLower)
}

func parseOptionalStartingPosition(raw *string) (*int, error) {
	if raw == nil {
		return nil, nil
	}
	value, err := parseStringEnum("--starting-position", *raw, startingPositionOptions, strings.ToUpper)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func parseDrillType(raw string) (drill.DrillType, error) {
	return parseStringEnum("--type", raw, drillTypeOptions, strings.ToLower)
}

func parseOptionalDrillType(raw string) (*drill.DrillType, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	value, err := parseDrillType(raw)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func parseStringEnum[T comparable](flag string, raw string, options []stringEnum[T], normalize func(string) string) (T, error) {
	value := normalize(strings.TrimSpace(raw))
	for _, option := range options {
		if value == normalize(option.label) {
			return option.value, nil
		}
	}
	var zero T
	return zero, fmt.Errorf("invalid %s %q, expected one of: %s", flag, raw, enumLabels(options))
}

func enumLabels[T comparable](options []stringEnum[T]) string {
	labels := make([]string, 0, len(options))
	for _, option := range options {
		labels = append(labels, option.label)
	}
	return strings.Join(labels, ",")
}

func formatBattingSide(value game.BattingSide) string {
	return formatStringEnum(value, battingSideOptions)
}

func formatTeam(value game.Team) string {
	return formatStringEnum(value, teamOptions)
}

func formatHalf(value game.Half) string {
	return formatStringEnum(value, halfOptions)
}

func formatEventKind(value game.EventKind) string {
	return formatStringEnum(value, eventKindOptions)
}

func formatEventResult(kind game.EventKind, value int) string {
	switch kind {
	case game.EventKindPlateResult:
		return formatStringEnum(game.PlateResult(value), plateResultOptions)
	case game.EventKindRunnerMovement:
		return formatStringEnum(game.RunnerResult(value), runnerResultOptions)
	case game.EventKindFieldingCredit:
		return formatStringEnum(game.FieldingResult(value), fieldingResultOptions)
	default:
		return fmt.Sprintf("%d", value)
	}
}

func formatOptionalRunnerReason(value *game.RunnerReason) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, runnerReasonOptions)
}

func formatOptionalStartingPosition(value *int) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, startingPositionOptions)
}

func formatDrillType(value drill.DrillType) string {
	return formatStringEnum(value, drillTypeOptions)
}

func formatGameResult(value game.GameResult) string {
	return formatStringEnum(value, gameResultOptions)
}

func formatStringEnum[T comparable](value T, options []stringEnum[T]) string {
	for _, option := range options {
		if value == option.value {
			return option.label
		}
	}
	return fmt.Sprintf("%v", value)
}
