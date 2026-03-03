export default function Home() {
  return (
    <main className="min-h-screen p-6 max-w-xl mx-auto">
      <h1 className="text-3xl font-semibold">CT Pickup</h1>
      <p className="mt-2 text-gray-600">
        Tournament availability + official updates.
      </p>

      <div className="mt-8 grid gap-3">
        <a className="rounded-xl border p-4" href="/login">
          <div className="font-medium">Log in</div>
          <div className="text-sm text-gray-600">Email verification code</div>
        </a>

        <a className="rounded-xl border p-4" href="/login">
          <div className="font-medium">New here?</div>
          <div className="text-sm text-gray-600">
            Create your profile (name, IG, phone)
          </div>
        </a>

        <a className="rounded-xl border p-4" href="/status">
          <div className="font-medium">Tournament Status</div>
          <div className="text-sm text-gray-600">Official source of truth</div>
        </a>
      </div>
    </main>
  );
}
