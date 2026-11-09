"""배포 전·중·후로 서비스에 1초 간격 요청을 보내 무중단 여부를 기록한다.

  run       : phase 파일(before/during/after/stop)을 읽으며 요청을 보내고 CSV로 기록
  summarize : CSV를 단계별 표로 정리해 GitHub Actions Summary(Markdown)로 출력
"""
import argparse
import csv
import datetime as dt
import json
import time
import urllib.request

FIELDS = ["seq", "phase", "start_utc", "end_utc", "ms", "http", "page_ok", "version"]


def utc():
    return dt.datetime.now(dt.timezone.utc)


def probe(url):
    """메인 페이지와 version.json을 받아 (HTTP 코드, 페이지 정상 여부, 버전)을 돌려준다."""
    try:
        with urllib.request.urlopen(url + "/", timeout=5) as r:
            code, page_ok = r.status, b'<div id="root">' in r.read()
        with urllib.request.urlopen(url + "/version.json", timeout=5) as r:
            version = json.loads(r.read()).get("version", "?")
        return code, page_ok, version
    except Exception as e:  # 연결 실패·타임아웃·5xx 모두 실패로 기록
        return getattr(e, "code", 0), False, type(e).__name__


def run(a):
    seq = 0
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, FIELDS)
        w.writeheader()
        while True:
            phase = open(a.phase_file, encoding="utf-8").read().strip() or "before"
            if phase == "stop":
                break
            seq += 1
            t0 = utc()
            code, page_ok, version = probe(a.url)
            t1 = utc()
            w.writerow({"seq": seq, "phase": phase,
                        "start_utc": t0.isoformat(timespec="milliseconds"),
                        "end_utc": t1.isoformat(timespec="milliseconds"),
                        "ms": round((t1 - t0).total_seconds() * 1000),
                        "http": code, "page_ok": page_ok, "version": version})
            f.flush()
            time.sleep(a.interval)  # 응답을 받은 뒤 1초 쉬고 다음 요청


def summarize(a):
    rows = list(csv.DictReader(open(a.csv, encoding="utf-8")))
    ok = lambda r: r["http"] == "200" and r["page_ok"] == "True"
    out = []
    p = out.append
    if not rows:
        p("요청 기록이 없습니다.")
        print("\n".join(out))
        return
    fails = [r for r in rows if not ok(r)]
    starts = [dt.datetime.fromisoformat(r["start_utc"]) for r in rows]
    gaps = [(b - a_).total_seconds() for a_, b in zip(starts, starts[1:])]
    seqs = [int(r["seq"]) for r in rows]
    contiguous = seqs == list(range(seqs[0], seqs[0] + len(seqs)))
    versions = []
    for r in rows:
        if ok(r) and (not versions or versions[-1] != r["version"]):
            versions.append(r["version"])

    p("## 새벽테니스 배포 검증 (Zero-Downtime)")
    p("")
    p(f"**결과: {'SUCCESS' if not fails else 'FAILED'}** · 진입점 {a.url} · 이미지 `{a.image}`")
    p("")
    p(f"- 검증 구간(UTC): {rows[0]['start_utc']} ~ {rows[-1]['end_utc']}")
    p(f"- 전체 요청 {len(rows)}건 · 성공 {len(rows) - len(fails)} · 실패 {len(fails)} · 요청 번호 연속: {contiguous}")
    p(f"- 버전 전환: {' → '.join(versions) or '-'}")
    p(f"- 요청 간격: 평균 {sum(gaps) / max(len(gaps), 1):.2f}s · 최대 {max(gaps, default=0):.2f}s (기록 공백 없음 = 측정되지 않은 구간 없음)")
    p("")
    p("| 단계 | 성공/전체 | 대표 요청 | 시작(UTC) | HTTP | 응답 ms | 버전 |")
    p("|---|---|---|---|---|---|---|")
    for phase, name in [("before", "배포 전"), ("during", "배포 중"), ("after", "배포 후")]:
        rs = [r for r in rows if r["phase"] == phase]
        if not rs:
            continue
        rep = rs[len(rs) // 2]
        p(f"| {name} | {sum(map(ok, rs))}/{len(rs)} | #{rep['seq']} | {rep['start_utc'][11:23]} | "
          f"{rep['http']} | {rep['ms']} | {rep['version']} |")
    before = [r for r in rows if r["phase"] == "before"]
    if before and not any(map(ok, before)):
        p("")
        p("※ 배포 전 요청이 모두 실패: 이전에 실행 중인 서비스가 없던 첫 배포입니다.")
    if fails:
        p("")
        p("실패한 요청: " + ", ".join(f"#{r['seq']}({r['phase']}, {r['version']})" for r in fails[:20]))
    p("")
    p("전체 요청 로그는 Artifacts의 `deploy-verification`에 있습니다.")
    print("\n".join(out))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--url", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--phase-file", required=True)
    r.add_argument("--interval", type=float, default=1.0)
    s = sub.add_parser("summarize")
    s.add_argument("--csv", required=True)
    s.add_argument("--url", required=True)
    s.add_argument("--image", default="")
    a = ap.parse_args()
    run(a) if a.cmd == "run" else summarize(a)
