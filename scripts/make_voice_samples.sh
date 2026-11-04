#!/bin/sh
# Demo voice clips for the studio, spoken by the macOS "Yuna" voice.
# They are generated locally and not committed. Needs macOS `say` and ffmpeg.
set -e
cd "$(dirname "$0")/../public" && mkdir -p voice
make() { say -v Yuna -r 180 -o "/tmp/$1.aiff" "$2"; ffmpeg -loglevel error -y -i "/tmp/$1.aiff" -ar 16000 -ac 1 -c:a pcm_s16le "voice/$1.wav"; echo "voice/$1.wav  $2"; }
make add_mart  "방금 동네마트에서 이만 이천오백 원 썼어. 식비로 넣어줘."
make add_hwaro "고깃집 화로에서 팔만 칠천 원, 외식으로 넣어줘."
make add_taxi  "카카오T 만 이천삼백 원, 교통으로 넣어줘."
make ask_eat   "지난달 외식비 얼마야?"
make look_green "추가 버튼 색을 초록색으로 바꿔줘."
