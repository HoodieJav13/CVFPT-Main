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

export function chooseClientTodayPlan({ assignments, activeLog, history, unreadMessages, todayCheckIn, complete = true }) {
  if (activeLog) {
    return {
      kind: 'active',
      eyebrow: 'In progress',
      title: activeLog.workout_name || 'Active workout',
      description: 'Your saved sets are ready when you are.',
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

  if (!complete) {
    return {
      kind: 'unavailable',
      eyebrow: 'Today’s plan',
      title: 'Training plan unavailable',
      description: 'Open Programs to retry your assigned training.',
      action: 'Open programs',
      href: '/client/programs',
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
