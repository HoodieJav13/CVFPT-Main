function denverDate(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
}

function denverTime(value) {
  return new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' });
}

function setProgress(log) {
  const sets = (log?.exercises || []).flatMap((exercise) => exercise.sets || []);
  return { done: sets.filter((set) => set.status === 'completed').length, total: sets.length };
}

// A planned rest day: the coach laid out dated workouts this week but none
// today. Programs without dated days never produce one, so a program client
// is never told to rest by accident.
function plannedRest(rhythm, today) {
  if (!rhythm?.week_total || !Array.isArray(rhythm.days)) return null;
  const todayRow = rhythm.days.find((day) => day.date === today);
  if (!todayRow || todayRow.state !== 'rest') return null;
  const next = rhythm.days.find((day) => day.date > today && day.assignments?.length && day.state !== 'done');
  return { next };
}

function firstProgramWorkout(programs = [], history = []) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  for (const assignment of programs) {
    const days = [...(assignment.program?.days || [])].sort((a, b) => (a.day_number || 0) - (b.day_number || 0));
    const latest = history.find((log) => log.status === 'completed' && log.program_assignment_id === assignment.id);
    const latestDate = latest?.completed_at
      ? new Date(latest.completed_at).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
      : null;
    // A completed program workout is enough for today; do not immediately
    // prescribe the next day and make a finished client look behind.
    if (latestDate === today) continue;
    const priorIndex = latest ? days.findIndex((day) => day.id === latest.program_day_id) : -1;
    const day = days.length ? days[(priorIndex + 1) % days.length] : null;
    if (day) {
      return {
        kind: 'program',
        eyebrow: 'Up next',
        title: day.workout?.name || assignment.program?.name || 'Program workout',
        description: assignment.program?.name ? `From ${assignment.program.name}` : 'Continue your current program.',
        action: 'Start workout',
        source: { program_assignment_id: assignment.id, program_day_id: day.id },
      };
    }
  }
  return null;
}

export function chooseClientTodayPlan({ assignments, activeLog, history, unreadMessages, todayCheckIn, rhythm = null, complete = true }) {
  if (activeLog) {
    const progress = setProgress(activeLog);
    const started = activeLog.started_at ? `Started ${denverTime(activeLog.started_at)}` : 'Your saved sets are ready when you are.';
    return {
      kind: 'active',
      eyebrow: 'In progress',
      title: activeLog.workout_name || 'Active workout',
      description: progress.total ? `${started} · ${progress.done} of ${progress.total} sets` : started,
      progress,
      action: 'Resume workout',
      href: `/client/workouts/${activeLog.id}/track`,
    };
  }

  const completedDated = new Set((history || [])
    .filter((log) => log.status === 'completed' && log.dated_workout_assignment_id)
    .map((log) => log.dated_workout_assignment_id));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' });
  const due = (assignments?.workouts || [])
    .filter((assignment) => assignment.assignment_mode === 'dated'
      && assignment.assigned_for <= today
      && !completedDated.has(assignment.id))
    .sort((a, b) => String(a.assigned_for).localeCompare(String(b.assigned_for)))[0];
  if (due) {
    return {
      kind: 'dated',
      eyebrow: due.assigned_for < today ? 'Ready now · overdue' : 'Today’s workout',
      title: due.workout?.name || 'Assigned workout',
      description: due.notes || 'Your coach assigned this workout for today.',
      action: 'Start workout',
      source: { workout_assignment_id: due.id },
    };
  }

  // Something was finished today and nothing dated is still due: say so,
  // rather than immediately prescribing the next program day.
  const doneToday = (history || []).find((log) => log.status === 'completed' && log.completed_at && denverDate(log.completed_at) === today);
  if (doneToday) {
    const unreadFeedback = (doneToday.coach_responses || []).some((response) => !response.read_at);
    return {
      kind: 'done_today',
      eyebrow: 'Done today',
      title: doneToday.workout_name || 'Workout',
      description: `Finished ${denverTime(doneToday.completed_at)}${doneToday.quick_completed ? ' · marked done without sets' : ''}${unreadFeedback ? ' · your coach left feedback' : ''}`,
      action: unreadFeedback ? 'Read feedback' : 'View workout',
      href: `/client/workouts/${doneToday.id}`,
    };
  }

  const program = firstProgramWorkout(assignments?.programs || [], history || []);
  if (program) return program;

  const activeAssignment = (assignments?.workouts || []).find((assignment) => assignment.assignment_mode === 'active');
  if (activeAssignment) {
    return {
      kind: 'standalone',
      eyebrow: 'Available workout',
      title: activeAssignment.workout?.name || 'Assigned workout',
      description: activeAssignment.notes || 'A workout from your coach is ready.',
      action: 'Start workout',
      source: { workout_assignment_id: activeAssignment.id },
    };
  }

  // "Nothing to do" has three different causes that need different words:
  // the plan didn't load, no program is assigned yet, or rest was planned.
  if (!complete) {
    return {
      kind: 'unavailable',
      eyebrow: 'Couldn’t load today’s plan',
      title: 'Today’s plan',
      description: 'This isn’t a rest day. The app couldn’t reach your training plan, so today is unknown. Check your connection and try again.',
      action: 'Try again',
    };
  }

  if (assignments && !(assignments.programs || []).length && !(assignments.workouts || []).length) {
    return {
      kind: 'unassigned',
      eyebrow: 'No program assigned yet',
      title: 'Program coming soon',
      description: 'Your coach hasn’t set up your training plan yet. Your sessions still show below.',
      action: 'Message your coach',
      href: '/client/messages',
      secondary: { action: 'Book a session', href: '/client/sessions' },
    };
  }

  const rest = plannedRest(rhythm, today);
  if (rest) {
    const nextName = rest.next?.assignments?.[0]?.workout_name;
    const nextDay = rest.next ? new Date(`${rest.next.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }) : null;
    return {
      kind: 'recovery',
      eyebrow: 'Planned by your coach',
      title: 'Recovery day',
      description: nextDay ? `No workout planned today. Next: ${nextDay}${nextName ? ` · ${nextName}` : ''}` : 'No workout planned today.',
      action: 'See my program',
      href: '/client/programs',
      secondary: { action: 'Book a session', href: '/client/sessions' },
    };
  }

  const feedback = (history || []).find((log) => (log.coach_responses || []).some((response) => !response.read_at));
  if (feedback) {
    return {
      kind: 'feedback',
      eyebrow: 'Coach feedback',
      title: `Review ${feedback.workout_name || 'your workout'}`,
      description: 'Your coach left new feedback.',
      action: 'Read feedback',
      href: `/client/workouts/${feedback.id}`,
    };
  }

  if (!todayCheckIn) {
    return {
      kind: 'check_in',
      eyebrow: 'Today’s plan',
      title: 'Tell your coach how you feel',
      description: 'A quick check-in keeps your training current.',
      action: 'Start check-in',
    };
  }

  if (unreadMessages > 0) {
    return {
      kind: 'message',
      eyebrow: 'New from your coach',
      title: `${unreadMessages} unread ${unreadMessages === 1 ? 'message' : 'messages'}`,
      description: 'Open the conversation to stay in sync.',
      action: 'Read messages',
      href: '/client/messages',
    };
  }

  return {
    kind: 'clear',
    eyebrow: 'Today’s plan',
    title: 'You’re caught up',
    description: 'No assigned action is waiting right now.',
    action: 'View programs',
    href: '/client/programs',
  };
}
