// 통합 일정(activities) 날짜·오픈 상태 계산
// 회차(occurrence) = 일정의 실제 날짜 하나. 반복 일정은 매주 해당 요일, 단일 일정은 event_date.

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s) => new Date(s + "T00:00:00");

export const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
export const fmtTime = (t) => String(t).slice(0, 5);
export const fmtMD = (d) => `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;

// 해당 날짜에 이 일정의 회차가 있는지 (반복 일정은 생성일 이전 날짜엔 표시 안 함)
export function occursOn(activity, date) {
  const key = ymd(date);
  if (!activity.repeat_weekly) return activity.event_date === key;
  return date.getDay() === activity.day_of_week && key >= activity.created_at.slice(0, 10);
}

// 오늘 이후 가장 가까운 회차 날짜 (없으면 null)
export function nextOccDate(activity, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (!activity.repeat_weekly) {
    const d = parseDate(activity.event_date);
    return d >= today ? d : null;
  }
  const diff = (activity.day_of_week - today.getDay() + 7) % 7;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  return d;
}

// 회차 오픈 상태 — 서버 activity_open_state()와 같은 규칙
// 반환: { state: 'open'|'closed'|'before'|'ended', opensAt?: Date, isOverridden?: boolean }
export function openInfo(activity, occDate, opens, now = new Date()) {
  const key = ymd(occDate);
  const end = new Date(occDate);
  const [eh, em] = activity.end_time
    ? fmtTime(activity.end_time).split(":").map(Number)
    : [23, 59];
  end.setHours(eh, em, 59, 999);
  if (now > end) return { state: "ended" };

  const ov = opens.find((o) => o.activity_id === activity.id && o.occ_date === key);
  if (ov) return { state: ov.state, isOverridden: true };

  if (!activity.repeat_weekly) return { state: "open" };
  if (activity.open_rule_day == null || !activity.open_rule_time) return { state: "closed" };

  // 회차 직전(1~7일 전)의 오픈 규칙 요일·시각에 열림
  const back = ((occDate.getDay() - activity.open_rule_day + 6) % 7) + 1;
  const opensAt = new Date(occDate);
  opensAt.setDate(occDate.getDate() - back);
  const [h, m] = fmtTime(activity.open_rule_time).split(":").map(Number);
  opensAt.setHours(h, m, 0, 0);
  if (now < opensAt) return { state: "before", opensAt };
  return { state: "open", opensAt };
}

export const fmtDateTime = (d) =>
  `${fmtMD(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
