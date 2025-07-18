import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

interface TestResult {
  id: string
  timestamp: string
  ipAddress: string
  ping: number | null
  downloadSpeed: number | null
  uploadSpeed: number | null
}

interface TestHistoryProps {
  history: TestResult[]
}

export default function TestHistory({ history }: TestHistoryProps) {
  if (history.length === 0) {
    return <p className="text-center text-gray-400 py-8">No test history yet. Run a speed test to see results here!</p>
  }

  return (
    <ScrollArea className="h-[400px] w-full rounded-md border border-gray-700 p-4">
      <div className="space-y-4">
        {history.map((result) => (
          <Card key={result.id} className="bg-gray-900 border-gray-700 text-white shadow-md">
            <CardContent className="p-4">
              <div className="flex justify-between items-center text-sm text-gray-400 mb-2">
                <span>{result.timestamp}</span>
                <span>IP: {result.ipAddress}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-lg font-semibold text-blue-400">Ping</p>
                  <p className="text-xl font-bold">{result.ping !== null ? result.ping.toFixed(0) : "--"} ms</p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-green-400">Download</p>
                  <p className="text-xl font-bold">
                    {result.downloadSpeed !== null ? result.downloadSpeed.toFixed(1) : "--"} Mbps
                  </p>
                </div>
                <div>
                  <p className="text-lg font-semibold text-orange-400">Upload</p>
                  <p className="text-xl font-bold">
                    {result.uploadSpeed !== null ? result.uploadSpeed.toFixed(1) : "--"} Mbps
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </ScrollArea>
  )
}
