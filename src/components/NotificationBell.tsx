'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck } from 'lucide-react'

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function NotificationBell({ initialNotifications, collapsed = false, up = false, align = 'left' }: { initialNotifications: NotificationItem[]; collapsed?: boolean; /** Open the panel above the bell (sidebar footer). */ up?: boolean; /** Panel edge to pin to the bell (right for a bell at the right edge of the screen). */ align?: 'left' | 'right' }) {
  const router = useRouter()
  const [notifications, setNotifications] = useState(initialNotifications)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.read_at).length

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handleClickOutside); document.removeEventListener('keydown', handleKey) }
  }, [])

  const markRead = async (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    fetch(`/api/notifications/${id}`, { method: 'PATCH' }).catch(() => {})
  }

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'POST' })
      router.refresh()
    } catch {
      // best-effort — local state already updated
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-2 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-[18px] h-[18px] text-ink-3" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute z-50 w-80 max-h-[70vh] overflow-y-auto bg-white border-2 border-line rounded-[14px] shadow-xl ${collapsed ? 'bottom-0 left-full ml-2' : up ? 'bottom-11 right-0' : align === 'right' ? 'top-11 right-0 max-w-[calc(100vw-2rem)]' : 'top-11 left-0'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-line-2 sticky top-0 bg-white">
            <p className="text-[13px] font-bold text-ink font-display">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-deep hover:text-green-deep">
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="text-[13px] text-ink-3 text-center py-10">No notifications yet.</p>
          ) : (
            <div>
              {notifications.map(n => (
                <Link
                  key={n.id}
                  href={n.link || '#'}
                  onClick={() => { markRead(n.id); setOpen(false) }}
                  className="block px-4 py-3 border-b border-ground last:border-0 hover:bg-surface-2 no-underline transition-colors"
                  style={{ background: n.read_at ? 'transparent' : 'rgba(29,185,84,0.05)' }}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-green flex-shrink-0 mt-1.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold text-ink">{n.title}</p>
                      {n.body && <p className="text-[12px] text-ink-3 mt-0.5 leading-snug">{n.body}</p>}
                      <p className="text-[10.5px] text-ink-3 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
