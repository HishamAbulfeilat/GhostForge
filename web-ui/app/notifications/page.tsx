import PushNotificationPanel from '@/components/PushNotificationPanel'

export default function NotificationsPage() {
  return (
    <main className="min-h-[100dvh] bg-[#030712] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <PushNotificationPanel />
      </div>
    </main>
  )
}
