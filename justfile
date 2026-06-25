app := "bastion"
src_dir := "src"
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

clean:
    rm -rf {{out_dir}}
