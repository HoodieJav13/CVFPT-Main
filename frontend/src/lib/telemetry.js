import { api } from '@/lib/api';

const EVENTS = new Set([
  'workout_started', 'workout_completed', 'workout_abandoned',
  'booking_requested', 'booking_outcome_viewed', 'message_replied',
  'check_in_submitted', 'check_in_reviewed', 'pwa_install_requested',
  'pwa_install_accepted', 'frontend_error', 'training_plan_viewed',
]);

export function trackProductEvent(eventName, properties = {}) {
  if (!EVENTS.has(eventName) || typeof globalThis.crypto?.randomUUID !== 'function') return Promise.resolve(false);
  return api.post('/telemetry/events', {
    event_id: globalThis.crypto.randomUUID(),
    event_name: eventName,
    occurred_at: new Date().toISOString(),
    properties,
  }).then(() => true).catch(() => false);
}
