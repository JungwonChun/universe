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

// 대진을 코트에 골고루 배정 (한 대진 = 한 코트 고정). play_order = 코트 내 진행 순서.
function assignCourts(ties, courts) {
  if (!courts || courts.length === 0) return;
  const perCourt = {};
  ties.forEach((tie, i) => {
    const court = courts[i % courts.length];
    tie.court = court;
    perCourt[court] = (perCourt[court] || 0) + 1;
    tie.play_order = perCourt[court];
  });
}

// 코트 스케줄: 코트마다 "지금 칠 경기 1개"를 배정해서 모든 코트를 가동.
// 기본은 대진의 자기 코트에서 진행하되, 빈 코트는 가장 느린(남은 게임 많은) 대진의 게임을 끌어와 채운다.
// 반환: [{ court, game(match|null), tie|null }] — courts 순서대로.
export function courtSchedule(courts, ties, matches) {
  const slots = (courts || []).map((c) => ({ court: c, game: null, tie: null }));
  if (!slots.length) return slots;
  // 양 팀 확정 + 양 팀 오더 제출 + 미종료 = 칠 수 있는 대진
  const playable = ties.filter((t) => t.team_a_id && t.team_b_id && t.a_submitted && t.b_submitted && t.status !== "done");
  const gamesOf = (id) => matches.filter((m) => m.tie_id === id).sort((a, b) => a.order_index - b.order_index);
  const pending = {};
  for (const t of playable) pending[t.id] = gamesOf(t.id).filter((m) => m.status !== "done");
  const assigned = new Set();
  const busy = new Set(); // 동시에 두 코트에 못 서는 선수
  const playersOf = (m) => [...(m.a_players || []), ...(m.b_players || [])];
  const free = (m) => playersOf(m).every((p) => !busy.has(p));
  const take = (slot, t, g) => { slot.game = g; slot.tie = t; assigned.add(g.id); playersOf(g).forEach((p) => busy.add(p)); };

  // 1) 자기 코트: 그 코트에 배정된 대진의 가장 빠른 미완료 게임
  for (const slot of slots) {
    const home = playable.filter((t) => t.court === slot.court).sort((a, b) => (a.play_order || 0) - (b.play_order || 0));
    for (const t of home) {
      const g = (pending[t.id] || []).find((m) => !assigned.has(m.id) && free(m));
      if (g) { take(slot, t, g); break; }
    }
  }
  // 2) 빈 코트: 남은 게임이 가장 많은(느린) 대진의 게임을 끌어와 채움 (선수 겹치면 건너뜀)
  for (const slot of slots) {
    if (slot.game) continue;
    const cands = playable
      .map((t) => ({ t, avail: (pending[t.id] || []).filter((m) => !assigned.has(m.id)) }))
      .filter((x) => x.avail.length)
      .sort((a, b) => b.avail.length - a.avail.length || (a.t.play_order || 0) - (b.t.play_order || 0));
    let done = false;
    for (const cand of cands) {
      const g = cand.avail.find((m) => free(m));
      if (g) { take(slot, cand.t, g); done = true; break; }
    }
    if (!done) break;
  }
  return slots;
}

// 코트별 상태판: 'playing'(진행중) | 'upcoming'(진행예정) | 'empty'(비어있음)
export function courtBoard(courts, ties, matches) {
  const slots = courtSchedule(courts, ties, matches);
  const playingTieIds = new Set(slots.filter((s) => s.tie).map((s) => s.tie.id));
  return slots.map((s) => {
    if (s.game) return { court: s.court, state: "playing", game: s.game, tie: s.tie };
    const up = ties
      .filter((t) => t.court === s.court && t.status !== "done" && !playingTieIds.has(t.id))
      .sort((a, b) => (a.play_order || 0) - (b.play_order || 0))[0];
    if (up) {
      const ready = up.team_a_id && up.team_b_id;
      const reason = !ready ? "팀 확정 대기" : (!up.a_submitted || !up.b_submitted) ? "오더 대기" : "대기";
      return { court: s.court, state: "upcoming", tie: up, reason };
    }
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
  assignCourts(ties, t.courts);
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
  assignCourts(ties, t.courts);
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
