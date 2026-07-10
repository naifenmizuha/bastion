app := "teamops"
src_dir := "teamops"
runtime_dir := "runtime"
rules_pdf_dir := "tools/rules-pdf"
out_dir := "out"
bin := out_dir / app

default:
    @just --list

build:
    mkdir -p {{out_dir}}
    cd {{src_dir}} && go build -o ../{{bin}} .

run *args: build
    ./{{bin}} {{args}}

dev *args:
    cd {{src_dir}} && go run . {{args}}

test:
    cd {{src_dir}} && go test ./...

fmt:
    cd {{src_dir}} && gofmt -w .

rt-install:
    cd {{runtime_dir}} && pnpm install

rt-check:
    cd {{runtime_dir}} && ./node_modules/.bin/tsc --noEmit

rt-test: build
    cd {{runtime_dir}} && node --import tsx --test src/*.test.ts src/teamops/*.test.ts src/baseball-rules/*.test.ts src/compaction/*.test.ts src/context-projection/*.test.ts src/derived-memory/*.test.ts src/developer-mode/*.test.ts src/scenario/*.test.ts

rt-dev: build
    cd {{runtime_dir}} && pnpm dev

rules-pdf-install:
    cd {{rules_pdf_dir}} && uv sync
    cd {{rules_pdf_dir}} && uv run --with marker-pdf marker_single --help >/dev/null

rules-pdf-convert pdf out title="WBSC Official Rules of Baseball" source="WBSC" edition="2025-2026" source_url="https://static.wbsc.org/uploads/federations/0/cms/documents/d3d36a7c-4a8a-1cca-adc1-d4edff1efc30.pdf":
    repo="$PWD"; cd {{rules_pdf_dir}} && uv run --with marker-pdf rules-pdf convert --pdf "$repo/{{pdf}}" --out "$repo/{{out}}" --title "{{title}}" --source "{{source}}" --edition "{{edition}}" --source-url "{{source_url}}"

seed-reference-game db="bastion.db": build
    printf '%s\n' '{"date":"2026-06-24","start_time":"19:30","opponent":"海港队","batting_side":"top","own_score":2,"opponent_score":1,"raw":"参考比赛：6月24日对海港队，先攻，2:1获胜。","lineups":[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"},{"team":"own","player":"李四","batting_order":2,"starting_position":"CF"}],"events":[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"B,X","description":"张三二垒安打"},{"inning":1,"half":"top","play_no":1,"sequence":2,"event_kind":"runner_movement","player":"李四","team":"own","result":"run_scored","base_from":2,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"张三","description":"李四从二垒回本垒得分"},{"inning":1,"half":"top","play_no":2,"sequence":1,"event_kind":"runner_movement","player":"张三","team":"own","result":"advance","base_from":1,"base_to":2,"reason":"stolen_base","description":"张三盗上二垒"},{"inning":1,"half":"bottom","play_no":3,"sequence":1,"event_kind":"plate_result","player":"对手甲","team":"opponent","result":"strikeout","related_player":"张三","pitch_sequence":"S,S,S","outs_on_play":1,"description":"张三三振对手"},{"inning":1,"half":"bottom","play_no":4,"sequence":1,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":3,"base_to":4,"reason":"batted_ball","related_player":"张三","runs_scored":1,"earned":true,"description":"对手乙回本垒得分"},{"inning":1,"half":"bottom","play_no":5,"sequence":1,"event_kind":"fielding_credit","player":"李四","team":"own","result":"putout","description":"李四完成接杀"}]}' | ./{{bin}} --db "{{db}}" game write --input -

analyze-player game_id="1" player="张三" db="bastion.db": build
    printf '%s\n' '{"game_id":{{game_id}}}' | ./{{bin}} --db "{{db}}" game analysis generate --input -
    ./{{bin}} --db "{{db}}"  game analysis read --game-id {{game_id}} --player "{{player}}"

# Demo recipes: each showcases one feature against a throwaway database.
# Run `just demo-all` to execute them all in order, or run any single one.

demo_db := "/tmp/bastion-demo.db"

demo-reset:
    rm -f {{demo_db}}

# Player: add two players, then read one back.
demo-player: build demo-reset
    printf '%s\n' '{"name":"张三","number":1,"bat":"right","throw":"right","positions":"pitcher"}' | ./{{bin}} --db {{demo_db}} player add --input -
    printf '%s\n' '{"name":"李四","number":2,"bat":"left","throw":"right","positions":"outfield"}' | ./{{bin}} --db {{demo_db}} player add --input -
    ./{{bin}} --db {{demo_db}}  player read --name "张三"

# Report: write a training report, then read it.
demo-report: demo-player
    printf '%s\n' '{"name":"张三","date":"2026-06-25","content":"打击训练 100 球，含变化球应对","reflection":"挥棒节奏有进步，外角球仍需加强"}' | ./{{bin}} --db {{demo_db}} report write --input -
    ./{{bin}} --db {{demo_db}}  report read --name "张三" --date 2026-06-25

# Game (one-shot): write a complete game with lineup + events, then read and list.
demo-game: demo-player
    printf '%s\n' '{"date":"2026-06-24","start_time":"19:30","opponent":"海港队","batting_side":"top","own_score":2,"opponent_score":1,"raw":"参考比赛：6月24日对海港队，先攻，2:1获胜。","lineups":[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"},{"team":"own","player":"李四","batting_order":2,"starting_position":"CF"}],"events":[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"B,X","description":"张三二垒安打"},{"inning":1,"half":"top","play_no":1,"sequence":2,"event_kind":"runner_movement","player":"李四","team":"own","result":"run_scored","base_from":2,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"张三","description":"李四从二垒回本垒得分"},{"inning":1,"half":"top","play_no":2,"sequence":1,"event_kind":"runner_movement","player":"张三","team":"own","result":"advance","base_from":1,"base_to":2,"reason":"stolen_base","description":"张三盗上二垒"},{"inning":1,"half":"bottom","play_no":3,"sequence":1,"event_kind":"plate_result","player":"对手甲","team":"opponent","result":"strikeout","related_player":"张三","pitch_sequence":"S,S,S","outs_on_play":1,"description":"张三三振对手"},{"inning":1,"half":"bottom","play_no":4,"sequence":1,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":3,"base_to":4,"reason":"batted_ball","related_player":"张三","runs_scored":1,"earned":true,"description":"对手乙回本垒得分"},{"inning":1,"half":"bottom","play_no":5,"sequence":1,"event_kind":"fielding_credit","player":"李四","team":"own","result":"putout","description":"李四完成接杀"}]}' | ./{{bin}} --db {{demo_db}} game write --input -
    ./{{bin}} --db {{demo_db}}  game read --id 1
    ./{{bin}} --db {{demo_db}}  game list

# Game (step-by-step): create empty, add lineup, write events, set score, then read.
demo-game-pieces: demo-game
    printf '%s\n' '{"date":"2026-06-23","start_time":"18:00","opponent":"测试队","batting_side":"bottom","raw":"分步写入测试比赛。"}' | ./{{bin}} --db {{demo_db}} game create --input -
    printf '%s\n' '{"game_id":2,"team":"own","player":"张三","batting_order":1,"starting_position":"P"}' | ./{{bin}} --db {{demo_db}} game lineup add --input -
    printf '%s\n' '{"game_id":2,"team":"own","player":"李四","batting_order":2,"starting_position":"CF"}' | ./{{bin}} --db {{demo_db}} game lineup add --input -
    printf '%s\n' '{"game_id":2,"events":[{"inning":1,"half":"bottom","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"对方投手","pitch_sequence":"X","description":"张三一垒安打"}]}' | ./{{bin}} --db {{demo_db}} game event write --input -
    printf '%s\n' '{"game_id":2,"own_score":5,"opponent_score":2}' | ./{{bin}} --db {{demo_db}} game score set --input -
    ./{{bin}} --db {{demo_db}}  game read --id 2

# Game analysis: generate from game 1's events, then read and list.
demo-game-analysis: demo-game
    printf '%s\n' '{"game_id":1}' | ./{{bin}} --db {{demo_db}} game analysis generate --input -
    ./{{bin}} --db {{demo_db}}  game analysis read --game-id 1 --player "张三"
    ./{{bin}} --db {{demo_db}}  game analysis list

# Drill recommendation: write one, then list.
demo-drill: demo-player
    printf '%s\n' '{"name":"张三","url":"https://example.com/drill/1","reason":"变化球握法参考","type":"pitching","summary":"演示变化球握法与释放点"}' | ./{{bin}} --db {{demo_db}} drill recommend write --input -
    ./{{bin}} --db {{demo_db}}  drill recommend list

# Person cross-period analysis: reads across the span covering game 1.
demo-person: demo-game-analysis
    ./{{bin}} --db {{demo_db}}  person analysis read --name "张三" --from 2026-06-01 --to 2026-06-30

# Run every demo in order against /tmp/bastion-demo.db.
demo-all: demo-player demo-report demo-game demo-game-pieces demo-game-analysis demo-drill demo-person
    @echo "所有功能演示完成"

clean:
    rm -rf {{out_dir}}
