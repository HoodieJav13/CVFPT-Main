// Time-of-day greeting in Albuquerque time (the studio's clock, not the
// device's): morning before noon, afternoon until 5 pm, evening after.
export function dayPart(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', hourCycle: 'h23' }).format(date));
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function greetingFor(firstName, date = new Date()) {
  const part = dayPart(date);
  return firstName ? `Good ${part}, ${firstName}` : `Good ${part}`;
}
