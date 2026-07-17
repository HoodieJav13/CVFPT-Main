import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight, MessageSquare } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { useNotifications } from '@/context/NotificationsContext';
import { initials, fmtDateTime } from '@/lib/format';
import { PageHeader, LoadingScreen, LoadErrorState, EmptyState } from '@/components/common';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

function relativeTime(value) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return fmtDateTime(value);
}

export default function CoachNotifications() {
  const navigate = useNavigate();
  const { refresh } = useNotifications();
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setRows(data);
      setLoadError(null);
      refresh();
    } catch (error) {
      setLoadError(errMsg(error, 'Failed to load notifications'));
    }
  }, [refresh]);

  useEffect(() => { load(); }, [load]);

  const openNotification = async (notification) => {
    try {
      if (!notification.read_at) await api.patch(`/notifications/${notification.id}/read`);
      refresh();
      navigate(`/coach/workouts/${notification.workout_log_id}`);
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  const readAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      await load();
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  if (!rows && loadError) return <LoadErrorState message={loadError} scope="notifications" onRetry={load} />;
  if (!rows) return <LoadingScreen />;

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Client workout activity"
        action={rows.some((row) => !row.read_at) ? (
          <Button variant="outline" size="sm" onClick={readAll} data-testid="notifications-read-all">
            <CheckCheck className="mr-1.5 h-4 w-4" /> Mark all read
          </Button>
        ) : null}
      />
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet" subtitle="Completed client workouts will appear here." />
      ) : (
        <div className="divide-y divide-border" data-testid="notifications-list">
          {rows.map((notification) => {
            const log = notification.workout_log;
            const client = log?.client;
            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                className="flex min-h-20 w-full items-center gap-3 px-1 py-4 text-left transition-colors hover:bg-card/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="notification-row"
              >
                <Avatar className="h-11 w-11 shrink-0">
                  <AvatarFallback className="bg-primary/20 font-display font-semibold text-primary">{initials(client?.name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">
                    {client?.name} completed {log?.workout_name || 'a workout'}{log?.feedback ? ' and left feedback' : ''}.
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    {relativeTime(notification.created_at)}
                    {log?.feedback && <MessageSquare className="h-3.5 w-3.5 text-primary" aria-label="Feedback included" />}
                  </span>
                </span>
                {!notification.read_at && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
