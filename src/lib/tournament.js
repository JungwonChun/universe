// 대회 대진표 생성·순위·점수 헬퍼 (조 배정/매칭은 여기서 계산해 seed_bracket으로 저장)

export const GROUP_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export const FORMAT_LABEL = {
  group: "조별 리그",
  knockout: "토너먼트",
  group_knockout: "조별 예선 + 본선 토너먼트",
};

// 한 대진(타이)의 경기 칸 구성: 단식 먼저, 그다음 복식. order_index = 출전 순서.
export function matchSkeleton(t) {
  const arr = [];
  let order = 1;
  for (let i = 1; i <= (t.num_singles || 0); i++) arr.push({ slot_type: "singles", slot_index: i, order_index: order++ });
  for (let i = 1; i <= (t.num_doubles || 0); i++) arr.push({ slot_type: "doubles", slot_index: i, order_index: order++ });
  return arr;
}

export function slotLabel(m) {
  return (m.slot_type === "singles" ? "단식" : "복식") + " " + m.slot_index;
}

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const log2 = (n) => Math.round(Math.log2(n));

const playersOf = (m) => [...(m.a_players || []), ...(m.b_players || [])];

// 코트를 그룹 수만큼 연속 균등 분할 (예: 4코트·2조 → [[1,2],[3,4]])
export function partitionCourts(courts, n) {
  const res = Array.from({ length: n }, () => []);
  if (!n) return res;
  const base = Math.floor(courts.length / n), extra = courts.length % n;
  let i = 0;
  for (let g = 0; g < n; g++) { const cnt = base + (g < extra ? 1 : 0); res[g] = courts.slice(i, i + cnt); i += cnt; }
  return res;
}

// 코트 스케줄. 반환: [{ court, game, tie, group }]
// 조별: 코트를 조에 분배(1조→앞쪽 코트, 2조→뒤쪽), 조마다 '한 대진'씩만 그 조 코트에 펼침(안 섞임).
// 본선: ko_courts(관리자 지정)에서 준비된 대진들을 병렬로 진행.
export function courtSchedule(tour, ties, matches) {
  const courts = (tour && tour.courts) || [];
  const gamesOf = (id) => matches.filter((m) => m.tie_id === id).sort((a, b) => a.order_index - b.order_index);
  const pendOf = (tie) => gamesOf(tie.id).filter((m) => m.status !== "done");
  const ready = (t) => t.team_a_id && t.team_b_id && t.a_submitted && t.b_submitted && t.status !== "done";
  const koTies = ties.filter((t) => t.stage === "knockout");
  const groupTies = ties.filter((t) => t.stage === "group");

  // 본선 생성 이후 → 본선 코트 스케줄
  if (koTies.length) {
    const koCourts = (tour && tour.ko_courts && tour.ko_courts.length) ? tour.ko_courts : courts;
    const slots = koCourts.map((c) => ({ court: c, game: null, tie: null, group: "ko" }));
    const busy = new Set(), assigned = new Set();
    const take = (slot, t, g) => { slot.game = g; slot.tie = t; assigned.add(g.id); playersOf(g).forEach((p) => busy.add(p)); };
    const rt = koTies.filter(ready).sort((a, b) => (a.round - b.round) || ((a.bracket_index || 0) - (b.bracket_index || 0)));
    let ci = 0;
    for (const t of rt) { // 준비된 대진마다 코트 하나씩 (병렬)
      if (ci >= slots.length) break;
      const g = pendOf(t).find((m) => !assigned.has(m.id) && playersOf(m).every((p) => !busy.has(p)));
      if (g) { take(slots[ci], t, g); ci++; }
    }
    for (let s = ci; s < slots.length; s++) { // 남는 코트는 남은 게임으로 채움
      for (const t of rt) {
        const g = pendOf(t).find((m) => !assigned.has(m.id) && playersOf(m).every((p) => !busy.has(p)));
        if (g) { take(slots[s], t, g); break; }
      }
    }
    return slots;
  }

  // 조별 스케줄
  const labels = [...new Set(groupTies.map((t) => t.group_label).filter(Boolean))].sort();
  if (!labels.length || !courts.length) return [];
  const chunks = partitionCourts(courts, labels.length);
  const out = [];
  labels.forEach((label, gi) => {
    const gc = chunks[gi] || [];
    const gt = groupTies.filter((t) => t.group_label === label && t.status !== "done")
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const current = gt.find(ready) || null; // 한 대진씩
    const busy = new Set(), assigned = new Set();
    const slots = gc.map((c) => ({ court: c, game: null, tie: null, group: label }));
    if (current) {
      const pend = pendOf(current);
      for (const slot of slots) {
        const g = pend.find((m) => !assigned.has(m.id) && playersOf(m).every((p) => !busy.has(p)));
        if (g) { slot.game = g; slot.tie = current; assigned.add(g.id); playersOf(g).forEach((p) => busy.add(p)); }
      }
    }
    out.push(...slots);
  });
  return out;
}

// 코트별 상태판: 'playing' | 'upcoming' | 'empty'
export function courtBoard(tour, ties, matches) {
  const slots = courtSchedule(tour, ties, matches);
  const groupTies = ties.filter((t) => t.stage === "group");
  const koTies = ties.filter((t) => t.stage === "knockout");
  const inKo = koTies.length > 0;
  const reasonFor = (t) => (!t.team_a_id || !t.team_b_id) ? "팀 확정 대기" : (!t.a_submitted || !t.b_submitted) ? "오더 대기" : "대기";
  const playingTieIds = new Set(slots.filter((s) => s.tie).map((s) => s.tie.id));
  return slots.map((s) => {
    if (s.game) return { court: s.court, state: "playing", game: s.game, tie: s.tie };
    const pool = (inKo
      ? koTies.filter((t) => t.status !== "done" && !playingTieIds.has(t.id))
      : groupTies.filter((t) => t.group_label === s.group && t.status !== "done" && !playingTieIds.has(t.id))
    ).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const up = pool[0];
    if (up) return { court: s.court, state: "upcoming", tie: up, reason: reasonFor(up) };
    return { court: s.court, state: "empty" };
  });
}

// 전체 진행률
export function progress(matches) {
  const total = matches.length;
  const done = matches.filter((m) => m.status === "done").length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// 토너먼트 표준 시드 배치 순서 (size = 2^k)
function seedOrder(size) {
  let seeds = [1, 2];
  for (let r = 1; r < log2(size); r++) {
    const sum = seeds.length * 2 + 1;
    const next = [];
    for (const s of seeds) { next.push(s); next.push(sum - s); }
    seeds = next;
  }
  return seeds;
}

const roundLabelBySlots = (slots) =>
  slots === 2 ? "결승" : slots === 4 ? "준결승" : `${slots}강`;

// teamIds: 시드 순서대로의 팀 id 배열. 부전승(BYE)은 자동 처리.
export function buildBracket(t, teamIds, stage = "knockout") {
  const n = teamIds.length;
  if (n < 2) return { groups: null, ties: [] };
  const size = nextPow2(n);
  const order = seedOrder(size);
  // 슬롯에 팀 배치 (시드 번호가 팀 수보다 크면 BYE=null)
  let prev = order.map((seed) => (seed <= n ? teamIds[seed - 1] : null));

  const ties = [];
  let tmp = 0;
  const mk = () => stage[0] + tmp++;
  const setNext = (prevTmp, nextTmp, slot) => {
    const ti = ties.find((x) => x.tmp_id === prevTmp);
    if (ti) { ti.next_tmp_id = nextTmp; ti.next_slot = slot; }
  };

  let round = 1;
  while (prev.length > 1) {
    const next = [];
    for (let j = 0; j < prev.length / 2; j++) {
      const a = prev[2 * j], b = prev[2 * j + 1];
      const aOn = a !== null && a !== undefined;
      const bOn = b !== null && b !== undefined;
      if (aOn && bOn) {
        const id = mk();
        ties.push({
          tmp_id: id, stage, group_label: null, round, bracket_index: j,
          label: roundLabelBySlots(prev.length),
          team_a_id: typeof a === "string" ? a : null,
          team_b_id: typeof b === "string" ? b : null,
          next_tmp_id: null, next_slot: null,
          matches: matchSkeleton(t),
        });
        if (typeof a === "object") setNext(a.winnerOf, id, "a");
        if (typeof b === "object") setNext(b.winnerOf, id, "b");
        next.push({ winnerOf: id });
      } else if (aOn || bOn) {
        next.push(aOn ? a : b); // 부전승: 그대로 다음 라운드로
      } else {
        next.push(null);
      }
    }
    prev = next;
    round++;
  }
  return { groups: null, ties };
}

// 조별 리그: 팀을 조에 스네이크 배정 후 조 안에서 풀리그
export function buildGroups(t, teams) {
  const G = Math.max(1, t.num_groups || 2);
  const buckets = Array.from({ length: G }, () => []);
  teams.forEach((tm, i) => {
    const row = Math.floor(i / G), col = i % G;
    const g = row % 2 === 0 ? col : G - 1 - col; // 스네이크
    buckets[g].push(tm);
  });

  const groups = [];
  buckets.forEach((arr, gi) => arr.forEach((tm) => groups.push({ team_id: tm.id, group_label: GROUP_LABELS[gi] })));

  const ties = [];
  let tmp = 0;
  buckets.forEach((arr, gi) => {
    for (let a = 0; a < arr.length; a++)
      for (let b = a + 1; b < arr.length; b++)
        ties.push({
          tmp_id: "g" + tmp++, stage: "group", group_label: GROUP_LABELS[gi],
          label: `${GROUP_LABELS[gi]}조`, team_a_id: arr[a].id, team_b_id: arr[b].id,
          next_tmp_id: null, next_slot: null, matches: matchSkeleton(t),
        });
  });
  return { groups, ties };
}

// 대진별 매치 승수/게임 집계
export function tieAgg(tie, matches) {
  const ms = matches.filter((m) => m.tie_id === tie.id);
  let aw = 0, bw = 0, ag = 0, bg = 0, done = 0;
  for (const m of ms) {
    if (m.status === "done") {
      done++;
      if (m.winner === "a") aw++; else if (m.winner === "b") bw++;
    }
    ag += m.games_a || 0; bg += m.games_b || 0;
  }
  return { total: ms.length, done, aw, bw, ag, bg };
}

// 조 순위: 승점(대진승) → 게임 득실 → 매치 승수
export function standings(teams, ties, matches, groupLabel) {
  const inGroup = teams.filter((t) => t.group_label === groupLabel);
  const stat = {};
  for (const t of inGroup) stat[t.id] = { team: t, tieW: 0, tieL: 0, mW: 0, mL: 0, gf: 0, ga: 0 };
  const gTies = ties.filter((t) => t.stage === "group" && t.group_label === groupLabel && t.status === "done");
  for (const tie of gTies) {
    const ag = tieAgg(tie, matches);
    const A = stat[tie.team_a_id], B = stat[tie.team_b_id];
    if (!A || !B) continue;
    A.mW += ag.aw; A.mL += ag.bw; B.mW += ag.bw; B.mL += ag.aw;
    A.gf += ag.ag; A.ga += ag.bg; B.gf += ag.bg; B.ga += ag.ag;
    if (tie.winner_team_id === A.team.id) { A.tieW++; B.tieL++; }
    else if (tie.winner_team_id === B.team.id) { B.tieW++; A.tieL++; }
  }
  return Object.values(stat).sort((x, y) =>
    y.tieW - x.tieW || (y.gf - y.ga) - (x.gf - x.ga) || y.mW - x.mW || x.team.seed - y.team.seed
  );
}

// 현재 진행 중인(아직 안 끝난) 가장 빠른 순서의 경기
export function currentMatch(tie, matches) {
  return matches
    .filter((m) => m.tie_id === tie.id && m.status !== "done")
    .sort((a, b) => a.order_index - b.order_index)[0] || null;
}

export const matchPlayers = (m, side) => (side === "a" ? m.a_players : m.b_players) || [];

export function matchScoreText(m) {
  if (m.status !== "done" || m.games_a == null) return "";
  let s = `${m.games_a}-${m.games_b}`;
  if (m.tb_a != null) s += ` (${m.tb_a}-${m.tb_b})`;
  return s;
}
