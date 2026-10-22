import { redirect } from 'next/navigation'

/** /app/admin has no page of its own; the sidebar links straight to the first admin section. */
export default function AdminIndex() {
  redirect('/app/admin/negotiations')
}
