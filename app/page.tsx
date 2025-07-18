import SpeedTest from "@/components/speed-test"

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-900 to-gray-700 text-white p-4">
      <SpeedTest />
    </div>
  )
}
