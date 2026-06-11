// 주 단위 신청 사이클 계산
// week_key = 대상 주 월요일 날짜 (YYYY-MM-DD)

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// org: { open_day(0=일~6=토), open_time "HH:MM:SS", override_state, override_week }
// slots: class_slots 배열
export function currentCycle(org, slots, now = new Date()) {
  const [h, m] = String(org.open_time).slice(0, 5).split(":").map(Number);

  // 가장 최근 자동 오픈 시각
  const lastOpen = new Date(now);
  lastOpen.setHours(h, m, 0, 0);
  const diff = (lastOpen.getDay() - org.open_day + 7) % 7;
  lastOpen.setDate(lastOpen.getDate() - diff);
  if (lastOpen > now) lastOpen.setDate(lastOpen.getDate() - 7);

  const nextOpen = new Date(lastOpen);
  nextOpen.setDate(lastOpen.getDate() + 7);

  // 대상 주: 오픈 시각 이후 처음 시작하는 주 (월요일 기준)
  const targetMonday = mondayOf(lastOpen);
  targetMonday.setDate(targetMonday.getDate() + 7);
  const weekKey = ymd(targetMonday);

  // 마감: 대상 주 마지막 수업 요일 자정
  const dows = slots.map((s) => (s.day_of_week + 6) % 7); // 월=0 기준
  const lastDow = dows.length ? Math.max(...dows) : 6;
  const close = new Date(targetMonday);
  close.setDate(targetMonday.getDate() + lastDow);
  close.setHours(23, 59, 59, 999);

  const autoOpen = now >= lastOpen && now <= close;
  const isOverridden = org.override_week === weekKey && (org.override_state === "open" || org.override_state === "closed");
  const open = isOverridden ? org.override_state === "open" : autoOpen;

  return { open, autoOpen, isOverridden, weekKey, targetMonday, lastOpen, nextOpen, close };
}

export function slotDateInWeek(weekKey, dayOfWeek) {
  const monday = new Date(weekKey + "T00:00:00");
  const offset = (dayOfWeek + 6) % 7;
  const d = new Date(monday);
  d.setDate(monday.getDate() + offset);
  return d;
}

export const fmtTime = (t) => String(t).slice(0, 5);
export const fmtMD = (d) => `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
