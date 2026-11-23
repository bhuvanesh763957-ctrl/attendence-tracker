import { Bell, CheckCheck, Megaphone } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { NotificationItem } from '../types/attendance.ts';
import { Modal } from './Modal.tsx';

interface NotificationsViewProps {
  onCountChanged: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function NotificationsView({ onCountChanged, onNotify }: NotificationsViewProps) {
  const { dbUser } = useAuth();
  const isManagerOrAdmin =
    dbUser?.role === 'ADMIN' || dbUser?.role === 'SUPER_ADMIN' || dbUser?.role === 'MANAGER';

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [loading, setLoading] = useState(true);

  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceForm, setAnnounceForm] = useState({ title: '', message: '' });
  const [submitting, setSubmitting] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setItems(res.notifications);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load notifications.', true);
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const visible = useMemo(() => {
    return filter === 'unread' ? items.filter((n) => !n.isRead) : items;
  }, [items, filter]);

  const handleMarkRead = async (id: number) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      onCountChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to mark read.', true);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      onCountChanged();
      onNotify('All notifications marked as read.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to mark all read.', true);
    }
  };

  const handlePublishAnnouncement = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/notifications/announcement', {
        method: 'POST',
        body: JSON.stringify(announceForm),
      });
      onNotify('Organization announcement published.');
      setAnnounceOpen(false);
      setAnnounceForm({ title: '', message: '' });
      await loadNotifications();
      onCountChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to publish announcement.', true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-white">
            Notification Centre
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Check-in confirmations, late arrival alerts, leave decisions, and organization announcements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            <CheckCheck aria-hidden="true" className="h-4 w-4 text-[#16A34A]" />
            <span>Mark All Read</span>
          </button>

          {isManagerOrAdmin && (
            <button
              type="button"
              onClick={() => setAnnounceOpen(true)}
              className="btn-press inline-flex min-h-[40px] items-center gap-2 rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              <Megaphone aria-hidden="true" className="h-4 w-4" />
              <span>Publish Announcement</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`btn-press rounded-md px-3.5 py-2 text-xs font-medium cursor-pointer ${
            filter === 'all'
              ? 'bg-[#111827] dark:bg-[#2563EB] text-white'
              : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300'
          }`}
        >
          All ({items.length})
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`btn-press rounded-md px-3.5 py-2 text-xs font-medium cursor-pointer ${
            filter === 'unread'
              ? 'bg-[#111827] dark:bg-[#2563EB] text-white'
              : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-300'
          }`}
        >
          Unread ({items.filter((i) => !i.isRead).length})
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] divide-y divide-slate-200 dark:divide-slate-800">
        {loading ? (
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="px-5 py-4 space-y-2">
              <div className="h-4 w-48 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-3.5 w-3/4 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
              <div className="h-3 w-32 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Bell aria-hidden="true" className="h-6 w-6 mx-auto text-slate-400" />
            <p className="text-sm text-slate-500">No notifications in this view.</p>
          </div>
        ) : (
          visible.map((n) => (
            <div
              key={n.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-4 ${
                !n.isRead ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[#111827] dark:text-white">{n.title}</p>
                  {!n.isRead && (
                    <span className="text-[11px] font-semibold text-[#2563EB] dark:text-blue-400">
                      Unread
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
                <p className="text-xs font-mono-tabular text-slate-400">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
              {!n.isRead && (
                <button
                  type="button"
                  onClick={() => handleMarkRead(n.id)}
                  className="btn-press self-start sm:self-center rounded-md border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
                >
                  Mark Read
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <Modal
        open={announceOpen}
        onClose={() => setAnnounceOpen(false)}
        title="Publish Organization Announcement"
        subtitle="Broadcasts an unread alert to every workspace member."
      >
        <form onSubmit={handlePublishAnnouncement} className="space-y-4">
          <div>
            <label htmlFor="announce-title" className="block text-xs font-medium mb-1">
              Announcement Title
            </label>
            <input
              id="announce-title"
              type="text"
              required
              value={announceForm.title}
              onChange={(e) => setAnnounceForm({ ...announceForm, title: e.target.value })}
              placeholder="e.g. Q4 Attendance Audit Window"
              className="w-full min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="announce-message" className="block text-xs font-medium mb-1">
              Message
            </label>
            <textarea
              id="announce-message"
              required
              rows={4}
              value={announceForm.message}
              onChange={(e) => setAnnounceForm({ ...announceForm, message: e.target.value })}
              placeholder="Write announcement details…"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAnnounceOpen(false)}
              className="btn-press min-h-[40px] rounded-md border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-press min-h-[40px] rounded-md bg-[#2563EB] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 cursor-pointer"
            >
              Publish
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
