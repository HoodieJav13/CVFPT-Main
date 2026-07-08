import { format, parseISO, isToday, isTomorrow, isYesterday, differenceInCalendarDays } from 'date-fns';

export function fmtDate(iso) {
  if (!iso) return '';
  try { return format(parseISO(iso), 'MMM d, yyyy'); } catch { return iso; }
}

export function fmtDay(iso) {
  if (!iso) return '';
  try {
    const d = parseISO(iso);
    if (isToday(d)) return 'Today';
    if (isTomorrow(d)) return 'Tomorrow';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'EEE, MMM d');
  } catch { return iso; }
}

export function fmtTime(iso) {
  if (!iso) return '';
  try { return format(parseISO(iso), 'h:mm a'); } catch { return iso; }
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  try { return format(parseISO(iso), 'MMM d, yyyy - h:mm a'); } catch { return iso; }
}

export function fmtMoney(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
}

export function initials(name = '') {
  return name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

/** True if the given ISO timestamp's local calendar day is before today's local calendar day. */
export function isBeforeToday(iso) {
  if (!iso) return false;
  try { return differenceInCalendarDays(parseISO(iso), new Date()) < 0; } catch { return false; }
}

/** Convert a Date-like ISO string to a value for <input type="datetime-local"> in local time. */
export function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
