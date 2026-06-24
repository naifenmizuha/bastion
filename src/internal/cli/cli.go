package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"bastion/internal/domain/game"
	"bastion/internal/domain/player"
	"bastion/internal/domain/report"
	"bastion/internal/sqlite"

	"github.com/alecthomas/kong"
)

type CLI struct {
	DB     string    `help:"Path to the SQLite database." default:"bastion.db" placeholder:"PATH"`
	Player PlayerCmd `cmd:"" help:"Manage players."`
	Report ReportCmd `cmd:"" help:"Manage training reports."`
	Game   GameCmd   `cmd:"" help:"Manage games."`
}

type PlayerCmd struct {
	Add  PlayerAddCmd  `cmd:"" help:"Add a player."`
	Read PlayerReadCmd `cmd:"" help:"Read a player by name."`
}

type PlayerAddCmd struct {
	Name      string `required:"" help:"Player name; cannot be empty."`
	Number    int    `required:"" help:"Jersey number, >= 0."`
	Bat       string `required:"" help:"Batting hand(s): left,right. Use comma for multiple values, for example left,right."`
	Throw     string `name:"throw" required:"" help:"Throwing hand(s): left,right. Use comma for multiple values, for example right."`
	Positions string `required:"" help:"Positions: pitcher,catcher,infield,outfield. Use comma for multiple values."`
}

type PlayerReadCmd struct {
	Name string `required:"" help:"Player name to read."`
}

type ReportCmd struct {
	Write ReportWriteCmd `cmd:"" help:"Write a training report."`
	Read  ReportReadCmd  `cmd:"" help:"Read a training report."`
}

type ReportWriteCmd struct {
	Name       string `required:"" help:"Player name; cannot be empty."`
	Date       string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
	Content    string `required:"" help:"Training content; cannot be empty."`
	Reflection string `required:"" help:"Training reflection; cannot be empty."`
}

type ReportReadCmd struct {
	Name string `required:"" help:"Player name."`
	Date string `required:"" help:"Training date, formatted as YYYY-MM-DD."`
}

type GameCmd struct {
	Write  GameWriteCmd  `cmd:"" help:"Write a complete game."`
	Create GameCreateCmd `cmd:"" help:"Create a game."`
	Lineup GameLineupCmd `cmd:"" help:"Manage game lineups."`
	Event  GameEventCmd  `cmd:"" help:"Manage plate appearance events."`
	Score  GameScoreCmd  `cmd:"" help:"Manage game scores."`
	Read   GameReadCmd   `cmd:"" help:"Read a game by id."`
	List   GameListCmd   `cmd:"" help:"List games."`
}

type GameWriteCmd struct {
	Date          string `required:"" help:"Game date, formatted as YYYY-MM-DD."`
	StartTime     string `help:"Game start time, formatted as HH:MM; omit when unknown."`
	Opponent      string `required:"" help:"Opponent name; cannot be empty."`
	BattingSide   string `required:"" help:"Own batting side: top,bottom."`
	OwnScore      int    `required:"" help:"Own final score, >= 0."`
	OpponentScore int    `required:"" help:"Opponent final score, >= 0."`
	Raw           string `required:"" help:"Raw natural language game description; cannot be empty."`
	LineupJSON    string `name:"lineup-json" default:"[]" help:"JSON array of lineup records. team: own,opponent. starting_position: P,C,1B,2B,3B,SS,LF,CF,RF."`
	EventsJSON    string `name:"events-json" default:"[]" help:"JSON array of plate appearance records. half: top,bottom. event_type: other,single,double,triple,homerun,walk,strikeout,groundout,flyout,error,steal."`
}

type GameCreateCmd struct {
	Date        string `required:"" help:"Game date, formatted as YYYY-MM-DD."`
	StartTime   string `help:"Game start time, formatted as HH:MM; omit when unknown."`
	Opponent    string `required:"" help:"Opponent name; cannot be empty."`
	BattingSide string `required:"" help:"Own batting side: top,bottom."`
	Raw         string `required:"" help:"Raw natural language game description; cannot be empty."`
}

type GameLineupCmd struct {
	Add GameLineupAddCmd `cmd:"" help:"Add a lineup record."`
}

type GameLineupAddCmd struct {
	GameID           int64   `required:"" help:"Game id, > 0."`
	Team             string  `required:"" help:"Team: own,opponent."`
	Player           string  `required:"" help:"Player name; cannot be empty."`
	BattingOrder     *int    `help:"Batting order, 1-9; omit for substitute or unknown."`
	StartingPosition *string `help:"Starting position: P,C,1B,2B,3B,SS,LF,CF,RF. Omit for non-starter or unknown."`
}

type GameEventCmd struct {
	Add GameEventAddCmd `cmd:"" help:"Add a plate appearance event."`
}

type GameEventAddCmd struct {
	GameID        int64  `required:"" help:"Game id, > 0."`
	Inning        int    `required:"" help:"Inning, starting from 1."`
	Half          string `required:"" help:"Half inning: top,bottom."`
	Batter        string `required:"" help:"Batter name; cannot be empty."`
	Pitcher       string `help:"Pitcher name; omit when unknown."`
	EventType     string `required:"" help:"Event type: other,single,double,triple,homerun,walk,strikeout,groundout,flyout,error,steal."`
	PitchSequence string `help:"Pitch sequence, for example B,S,F,X; omit when unknown."`
	Outs          int    `required:"" help:"Outs after the event: 0, 1, or 2."`
	BaseState     int    `required:"" help:"Base state before the event: 0-7. 0 empty, 1 first, 2 second, 4 third; combine by addition."`
	RunsScored    int    `default:"0" help:"Runs scored by this event, >= 0."`
	Description   string `required:"" help:"Event description; cannot be empty."`
}

type GameScoreCmd struct {
	Set GameScoreSetCmd `cmd:"" help:"Set final score."`
}

type GameScoreSetCmd struct {
	GameID        int64 `required:"" help:"Game id, > 0."`
	OwnScore      int   `required:"" help:"Own final score, >= 0."`
	OpponentScore int   `required:"" help:"Opponent final score, >= 0."`
}

type GameReadCmd struct {
	ID int64 `required:"" help:"Game id to read."`
}

type GameListCmd struct {
	Date string `help:"Filter games by date, formatted as YYYY-MM-DD."`
}

type Context struct {
	PlayerService *player.Service
	ReportService *report.Service
	GameService   *game.Service
	Out           io.Writer
}

func Run(args []string, stdout io.Writer, stderr io.Writer) error {
	var app CLI
	parser := kong.Must(
		&app,
		kong.Name("bastion"),
		kong.Description("Baseball player self-training registration CLI."),
		kong.Writers(stdout, stderr),
	)

	ctx, err := parser.Parse(args)
	if err != nil {
		return err
	}

	store, err := sqlite.Open(app.DB)
	if err != nil {
		return err
	}
	defer store.Close()

	if err := store.Init(); err != nil {
		return err
	}

	return ctx.Run(&Context{
		PlayerService: player.NewService(store),
		ReportService: report.NewService(store),
		GameService:   game.NewService(store),
		Out:           stdout,
	})
}

func (cmd *PlayerAddCmd) Run(ctx *Context) error {
	player, err := ctx.PlayerService.AddPlayer(cmd.Name, cmd.Number, cmd.Bat, cmd.Throw, cmd.Positions)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "player added: %s\n", player.Name)
	return nil
}

func (cmd *PlayerReadCmd) Run(ctx *Context) error {
	player, err := ctx.PlayerService.GetPlayer(cmd.Name)
	if err != nil {
		return err
	}
	printPlayer(ctx.Out, player)
	return nil
}

func (cmd *ReportWriteCmd) Run(ctx *Context) error {
	report, err := ctx.ReportService.WriteReport(cmd.Name, cmd.Date, cmd.Content, cmd.Reflection)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "report saved: %s %s\n", report.Name, report.Date)
	return nil
}

func (cmd *ReportReadCmd) Run(ctx *Context) error {
	report, err := ctx.ReportService.GetReport(cmd.Name, cmd.Date)
	if err != nil {
		return err
	}
	printReport(ctx.Out, report)
	return nil
}

func (cmd *GameWriteCmd) Run(ctx *Context) error {
	battingSide, err := parseBattingSide(cmd.BattingSide)
	if err != nil {
		return err
	}
	lineups, err := parseLineupsJSON(cmd.LineupJSON)
	if err != nil {
		return err
	}
	events, err := parseEventsJSON(cmd.EventsJSON)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.WriteGame(
		cmd.Date,
		cmd.StartTime,
		cmd.Opponent,
		battingSide,
		cmd.OwnScore,
		cmd.OpponentScore,
		cmd.Raw,
		lineups,
		events,
	)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "game saved: %d\n", id)
	return nil
}

func (cmd *GameCreateCmd) Run(ctx *Context) error {
	battingSide, err := parseBattingSide(cmd.BattingSide)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.CreateGame(cmd.Date, cmd.StartTime, cmd.Opponent, battingSide, cmd.Raw)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "game created: %d\n", id)
	return nil
}

func (cmd *GameLineupAddCmd) Run(ctx *Context) error {
	team, err := parseTeam(cmd.Team)
	if err != nil {
		return err
	}
	startingPosition, err := parseOptionalStartingPosition(cmd.StartingPosition)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.AddGameLineup(cmd.GameID, team, cmd.Player, cmd.BattingOrder, startingPosition)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "lineup added: %d\n", id)
	return nil
}

func (cmd *GameEventAddCmd) Run(ctx *Context) error {
	half, err := parseHalf(cmd.Half)
	if err != nil {
		return err
	}
	eventType, err := parseEventType(cmd.EventType)
	if err != nil {
		return err
	}
	id, err := ctx.GameService.AddPlateAppearance(
		cmd.GameID,
		cmd.Inning,
		half,
		cmd.Batter,
		cmd.Pitcher,
		eventType,
		cmd.PitchSequence,
		cmd.Outs,
		cmd.BaseState,
		cmd.RunsScored,
		cmd.Description,
	)
	if err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "event added: %d\n", id)
	return nil
}

func (cmd *GameScoreSetCmd) Run(ctx *Context) error {
	if err := ctx.GameService.SetGameScore(cmd.GameID, cmd.OwnScore, cmd.OpponentScore); err != nil {
		return err
	}
	fmt.Fprintf(ctx.Out, "score saved: %d\n", cmd.GameID)
	return nil
}

func (cmd *GameReadCmd) Run(ctx *Context) error {
	details, err := ctx.GameService.GetGame(cmd.ID)
	if err != nil {
		return err
	}
	printGameDetails(ctx.Out, details)
	return nil
}

func (cmd *GameListCmd) Run(ctx *Context) error {
	games, err := ctx.GameService.ListGames(cmd.Date)
	if err != nil {
		return err
	}
	printGameList(ctx.Out, games)
	return nil
}

func printPlayer(out io.Writer, p player.Player) {
	fmt.Fprintf(out, "name: %s\n", p.Name)
	fmt.Fprintf(out, "number: %d\n", p.Number)
	fmt.Fprintf(out, "bat: %s\n", player.FormatHands(p.Bat))
	fmt.Fprintf(out, "throw: %s\n", player.FormatHands(p.Throw))
	fmt.Fprintf(out, "positions: %s\n", player.FormatPositions(p.Positions))
}

func printReport(out io.Writer, report report.Report) {
	fmt.Fprintf(out, "name: %s\n", report.Name)
	fmt.Fprintf(out, "date: %s\n", report.Date)
	fmt.Fprintf(out, "content: %s\n", report.Content)
	fmt.Fprintf(out, "reflection: %s\n", report.Reflection)
}

type lineupJSON struct {
	Team             string  `json:"team"`
	Player           string  `json:"player"`
	BattingOrder     *int    `json:"batting_order"`
	StartingPosition *string `json:"starting_position"`
}

type eventJSON struct {
	Inning        int    `json:"inning"`
	Half          string `json:"half"`
	Batter        string `json:"batter"`
	Pitcher       string `json:"pitcher"`
	EventType     string `json:"event_type"`
	PitchSequence string `json:"pitch_sequence"`
	Outs          int    `json:"outs"`
	BaseState     int    `json:"base_state"`
	RunsScored    int    `json:"runs_scored"`
	Description   string `json:"description"`
}

func parseLineupsJSON(raw string) ([]game.GameLineup, error) {
	var records []lineupJSON
	if err := json.Unmarshal([]byte(raw), &records); err != nil {
		return nil, fmt.Errorf("invalid --lineup-json: %w", err)
	}
	lineups := make([]game.GameLineup, 0, len(records))
	for i, record := range records {
		team, err := parseTeam(record.Team)
		if err != nil {
			return nil, fmt.Errorf("invalid --lineup-json item %d: %w", i+1, err)
		}
		startingPosition, err := parseOptionalStartingPosition(record.StartingPosition)
		if err != nil {
			return nil, fmt.Errorf("invalid --lineup-json item %d: %w", i+1, err)
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

func parseEventsJSON(raw string) ([]game.PlateAppearance, error) {
	var records []eventJSON
	if err := json.Unmarshal([]byte(raw), &records); err != nil {
		return nil, fmt.Errorf("invalid --events-json: %w", err)
	}
	events := make([]game.PlateAppearance, 0, len(records))
	for i, record := range records {
		half, err := parseHalf(record.Half)
		if err != nil {
			return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
		}
		eventType, err := parseEventType(record.EventType)
		if err != nil {
			return nil, fmt.Errorf("invalid --events-json item %d: %w", i+1, err)
		}
		events = append(events, game.PlateAppearance{
			Inning:        record.Inning,
			Half:          half,
			Batter:        record.Batter,
			Pitcher:       record.Pitcher,
			EventType:     eventType,
			PitchSequence: record.PitchSequence,
			Outs:          record.Outs,
			BaseState:     record.BaseState,
			RunsScored:    record.RunsScored,
			Description:   record.Description,
		})
	}
	if events == nil {
		events = []game.PlateAppearance{}
	}
	return events, nil
}

func printGameDetails(out io.Writer, details game.GameDetails) {
	printGame(out, details.Game)
	fmt.Fprintln(out, "lineups:")
	if len(details.Lineups) == 0 {
		fmt.Fprintln(out, "(none)")
	}
	for _, lineup := range details.Lineups {
		fmt.Fprintf(out, "id: %d team: %s player: %s batting_order: %s starting_position: %s\n",
			lineup.ID,
			formatTeam(lineup.Team),
			lineup.Player,
			formatOptionalInt(lineup.BattingOrder),
			formatOptionalStartingPosition(lineup.StartingPosition),
		)
	}
	fmt.Fprintln(out, "events:")
	if len(details.Events) == 0 {
		fmt.Fprintln(out, "(none)")
	}
	for _, event := range details.Events {
		fmt.Fprintf(out, "id: %d inning: %d half: %s batter: %s pitcher: %s event_type: %s pitch_sequence: %s outs: %d base_state: %d runs_scored: %d description: %s\n",
			event.ID,
			event.Inning,
			formatHalf(event.Half),
			event.Batter,
			event.Pitcher,
			formatEventType(event.EventType),
			event.PitchSequence,
			event.Outs,
			event.BaseState,
			event.RunsScored,
			event.Description,
		)
	}
}

func printGame(out io.Writer, game game.Game) {
	fmt.Fprintln(out, "game:")
	fmt.Fprintf(out, "id: %d\n", game.ID)
	fmt.Fprintf(out, "date: %s\n", game.Date)
	fmt.Fprintf(out, "start_time: %s\n", game.StartTime)
	fmt.Fprintf(out, "opponent: %s\n", game.Opponent)
	fmt.Fprintf(out, "batting_side: %s\n", formatBattingSide(game.BattingSide))
	fmt.Fprintf(out, "own_score: %d\n", game.OwnScore)
	fmt.Fprintf(out, "opponent_score: %d\n", game.OpponentScore)
	fmt.Fprintf(out, "is_final: %t\n", game.IsFinal)
	fmt.Fprintf(out, "raw: %s\n", game.Raw)
	fmt.Fprintf(out, "created_at: %s\n", game.CreatedAt)
}

func printGameList(out io.Writer, games []game.Game) {
	for _, game := range games {
		fmt.Fprintf(out, "id: %d date: %s start_time: %s opponent: %s batting_side: %s score: %d-%d is_final: %t\n",
			game.ID,
			game.Date,
			game.StartTime,
			game.Opponent,
			formatBattingSide(game.BattingSide),
			game.OwnScore,
			game.OpponentScore,
			game.IsFinal,
		)
	}
}

func formatOptionalInt(value *int) string {
	if value == nil {
		return ""
	}
	return fmt.Sprintf("%d", *value)
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

var eventTypeOptions = []stringEnum[game.EventType]{
	{label: "other", value: game.EventTypeOther},
	{label: "single", value: game.EventTypeSingle},
	{label: "double", value: game.EventTypeDouble},
	{label: "triple", value: game.EventTypeTriple},
	{label: "homerun", value: game.EventTypeHomerun},
	{label: "walk", value: game.EventTypeWalk},
	{label: "strikeout", value: game.EventTypeStrikeout},
	{label: "groundout", value: game.EventTypeGroundout},
	{label: "flyout", value: game.EventTypeFlyout},
	{label: "error", value: game.EventTypeError},
	{label: "steal", value: game.EventTypeSteal},
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

func parseBattingSide(raw string) (game.BattingSide, error) {
	return parseStringEnum("--batting-side", raw, battingSideOptions, strings.ToLower)
}

func parseTeam(raw string) (game.Team, error) {
	return parseStringEnum("--team", raw, teamOptions, strings.ToLower)
}

func parseHalf(raw string) (game.Half, error) {
	return parseStringEnum("--half", raw, halfOptions, strings.ToLower)
}

func parseEventType(raw string) (game.EventType, error) {
	return parseStringEnum("--event-type", raw, eventTypeOptions, strings.ToLower)
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

func formatEventType(value game.EventType) string {
	return formatStringEnum(value, eventTypeOptions)
}

func formatOptionalStartingPosition(value *int) string {
	if value == nil {
		return ""
	}
	return formatStringEnum(*value, startingPositionOptions)
}

func formatStringEnum[T comparable](value T, options []stringEnum[T]) string {
	for _, option := range options {
		if value == option.value {
			return option.label
		}
	}
	return fmt.Sprintf("%v", value)
}
