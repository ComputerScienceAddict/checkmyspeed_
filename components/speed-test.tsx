"use client"

import React, { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Gauge, Download, Upload, Clock, History, Wifi } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import TestHistory from "./test-history"

type TestState = "idle" | "pinging" | "downloading" | "uploading" | "complete"

interface TestResult {
  id: string
  timestamp: string
  ipAddress: string
  ping: number | null
  downloadSpeed: number | null
  uploadSpeed: number | null
}

export default function SpeedTest() {
  const [testState, setTestState] = useState<TestState>("idle")
  const [ping, setPing] = useState<string>('-')
  const [downloadSpeed, setDownloadSpeed] = useState<string>('-')
  const [uploadSpeed, setUploadSpeed] = useState<string>('-')
  const [currentSpeedDisplay, setCurrentSpeedDisplay] = useState<number>(0)
  const [progress, setProgress] = useState<number>(0)
  const [ipAddress, setIpAddress] = useState<string>('-')
  const [testHistory, setTestHistory] = useState<TestResult[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [testStatus, setTestStatus] = useState<string>('Ready')
  const [isTesting, setIsTesting] = useState<boolean>(false)

  const abortControllerRef = useRef<AbortController | null>(null)

  // Load history from local storage on component mount
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem("speedTestHistory")
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory)
        setTestHistory(parsedHistory)
        console.log('Loaded test history from localStorage:', parsedHistory.length, 'results');
      }
    } catch (error) {
      console.error('Error loading test history from localStorage:', error);
      // Clear corrupted data
      localStorage.removeItem("speedTestHistory");
    }
  }, [])

  // Save history to local storage whenever it changes
  useEffect(() => {
    if (testHistory.length > 0) {
      localStorage.setItem("speedTestHistory", JSON.stringify(testHistory))
      console.log('Saved test history to localStorage:', testHistory.length, 'results');
    }
  }, [testHistory])

  // Helper function to update overall progress based on current stage's progress
  const updateOverallProgress = (stageStart: number, stageEnd: number, stageProgress: number) => {
    const overallRange = stageEnd - stageStart;
    const currentOverallProgress = stageStart + (overallRange * (stageProgress / 100));
    setProgress(Math.round(currentOverallProgress));
  };

  /**
   * Fetches the public IP address.
   * @returns {Promise<string|null>} The IP address string, or null if an error occurred.
   */
  const fetchIpAddress = async (): Promise<string | null> => {
    try {
      // Using a reliable public API to get the IP address
      const response = await fetch('https://api.ipify.org?format=json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.ip;
    } catch (error) {
      console.error("Error fetching IP address:", error);
      return null;
    }
  };

  /**
   * Performs a single ping request and returns the latency.
   * This function is designed to be reusable for multiple ping attempts.
   * @param {string} url - The URL to ping.
   * @param {AbortSignal} signal - The AbortSignal to cancel the fetch request.
   * @returns {Promise<number|null>} The latency in milliseconds, or null if an error occurred (excluding AbortError).
   */
  const performSinglePing = async (url: string, signal: AbortSignal): Promise<number | null> => {
    try {
      const startTime = performance.now(); // Record start time using high-resolution timer
      await fetch(url, { method: 'HEAD', signal }); // Use HEAD request for minimal data transfer
      const endTime = performance.now(); // Record end time
      return endTime - startTime; // Calculate and return latency
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw error; // Re-throw AbortError to be handled by the main test function
      }
      console.warn(`Single ping to ${url} failed:`, error);
      return null; // Return null for other errors
    }
  };

  // --- Enhanced Ping Test Function with WebSocket ---
  const runPingTest = async (overallStart: number, overallEnd: number) => {
    // Use a purpose-built endpoint for ping testing
    // Note: This uses Cloudflare's /cdn-cgi/trace endpoint for a lightweight HTTP request.
    // For true ICMP ping, a backend server is required.
    const pingUrl = 'https://www.cloudflare.com/cdn-cgi/trace';
    const signal = abortControllerRef.current!.signal;
    const numPings = 100; // Increased number of pings for higher accuracy
    const warmUpPings = 10; // Reduced warm-up pings
    const pingTimes: number[] = []; // Array to store individual ping times

    // Attempt to establish a WebSocket connection to reduce initial overhead for subsequent pings.
    // This is an experimental approach to "warm up" the connection.
    let conn: WebSocket | null = null;
    try {
      conn = new WebSocket('wss://echo.cloudflare.com:443');
      await new Promise<void>((resolve, reject) => {
        conn!.onopen = () => resolve();
        conn!.onerror = (event) => {
          console.warn("WebSocket ping warm-up failed. Falling back to HTTP HEAD requests for ping measurement.");
          reject(new Error("WebSocket connection failed for ping warm-up.")); // Reject to trigger outer catch
        };
        setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000); // Timeout for connection
      });
    } catch (error) {
      console.warn("Could not establish WebSocket for ping warm-up, falling back to HTTP ping:", error);
      // If WebSocket fails, proceed with HTTP pings only.
      conn = null;
    }

    for (let i = 0; i < numPings; i++) {
      const start = performance.now();
      let latency: number | null = null;

      if (conn && conn.readyState === WebSocket.OPEN) {
        try {
          conn.send('ping'); // Send a small frame
          await new Promise<void>(r => {
            const timeout = setTimeout(() => {
              r(); // Resolve after timeout if no message
              console.warn("WebSocket ping timeout.");
            }, 2000); // Max wait for WebSocket response
            conn!.onmessage = () => {
              clearTimeout(timeout);
              latency = performance.now() - start;
              r();
            };
          });
        } catch (wsError) {
          console.warn("WebSocket send/receive error, falling back to HTTP ping:", wsError);
          latency = await performSinglePing(pingUrl, signal); // Fallback to HTTP ping
        }
      } else {
        latency = await performSinglePing(pingUrl, signal); // Use HTTP ping if WebSocket not open
      }

      if (latency !== null && i >= warmUpPings) {
        pingTimes.push(latency);
      } else if (i >= warmUpPings) {
        // Penalize if ping failed (even HTTP fallback)
        pingTimes.push(1000);
      }

      updateOverallProgress(overallStart, overallEnd, ((i + 1) / numPings) * 100);
      await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between pings (kept at 50ms for stability)
    }

    if (conn) {
      conn.close(); // Close WebSocket connection after test
    }

    if (pingTimes.length === 0) {
      setPing('N/A');
      return;
    }

    // Sort ping times and use median-based filtering for robust outlier removal
    pingTimes.sort((a, b) => a - b);
    const median = pingTimes[Math.floor(pingTimes.length / 2)];
    // Filter out pings that are excessively high (e.g., > 300ms or > 3x median)
    const cleaned = pingTimes.filter(t => t < Math.min(300, median * 3));

    if (cleaned.length === 0) {
      setPing('N/A'); // If all pings were trimmed or array was too small
      return;
    }

    const averagePing = cleaned.reduce((a, b) => a + b, 0) / cleaned.length;
    setPing(averagePing.toFixed(2));
  };

  // --- Download Test Function ---
  const runDownloadTest = async (overallStart: number, overallEnd: number) => {
    const downloadUrl = 'https://speed.cloudflare.com/__down?bytes=100000000'; // 100MB test file from Cloudflare
    const signal = abortControllerRef.current!.signal;
    const testDuration = 10000; // Test for 10 seconds to get a good average
    let downloadedBytes = 0;
    let lastProgressTime = performance.now();

    try {
      const response = await fetch(downloadUrl, { signal });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const startTime = performance.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        downloadedBytes += value!.length;
        const currentTime = performance.now();
        const elapsed = currentTime - startTime;

        if (currentTime - lastProgressTime > 200) {
          const currentSpeedMbps = (downloadedBytes / (elapsed / 1000) / (1024 * 1024)) * 8;
          setDownloadSpeed(currentSpeedMbps.toFixed(2));
          setCurrentSpeedDisplay(currentSpeedMbps);
          updateOverallProgress(overallStart, overallEnd, Math.min(100, (elapsed / testDuration) * 100));
          lastProgressTime = currentTime;
        }

        if (elapsed >= testDuration) {
          reader.cancel();
          break;
        }
      }

      const finalTime = performance.now() - startTime;
      const finalDownloadSpeedMbps = (downloadedBytes / (finalTime / 1000) / (1024 * 1024)) * 8;
      setDownloadSpeed(finalDownloadSpeedMbps.toFixed(2));
      updateOverallProgress(overallStart, overallEnd, 100);
    } catch (error: any) {
      if (error.name === 'AbortError') throw error;
      console.error('Download test failed:', error);
      throw new Error('Download test failed');
    }
  };

  // --- Upload Test Function ---
  const runUploadTest = async (overallStart: number, overallEnd: number) => {
    const uploadUrl = 'https://httpbin.org/post';
    const signal = abortControllerRef.current!.signal;
    const testDuration = 10000; // Test for 10 seconds
    const chunkSize = 1024 * 1024; // 1MB chunk
    let uploadedBytes = 0;
    let lastProgressTime = performance.now();

    const startTime = performance.now();
    const cryptoMaxChunk = 65536;

    while (true) {
      const currentTime = performance.now();
      const elapsed = currentTime - startTime;

      if (elapsed >= testDuration) {
        break;
      }

      const data = new Uint8Array(chunkSize);
      for (let i = 0; i < chunkSize; i += cryptoMaxChunk) {
        const subArray = data.subarray(i, i + cryptoMaxChunk);
        crypto.getRandomValues(subArray);
      }
      const blob = new Blob([data], { type: 'application/octet-stream' });

      try {
        await fetch(uploadUrl, {
          method: 'POST',
          body: blob,
          signal,
          headers: {
            'Content-Type': 'application/octet-stream'
          }
        });
        uploadedBytes += blob.size;

        if (currentTime - lastProgressTime > 200) {
          const currentSpeedMbps = (uploadedBytes / (elapsed / 1000) / (1024 * 1024)) * 8;
          setUploadSpeed(currentSpeedMbps.toFixed(2));
          setCurrentSpeedDisplay(currentSpeedMbps);
          updateOverallProgress(overallStart, overallEnd, Math.min(100, (elapsed / testDuration) * 100));
          lastProgressTime = currentTime;
        }

      } catch (error: any) {
        if (error.name === 'AbortError') throw error;
        console.warn('Upload test failed:', error);
      }
    }

    const finalTime = performance.now() - startTime;
    const finalUploadSpeedMbps = (uploadedBytes / (finalTime / 1000) / (1024 * 1024)) * 8;
    setUploadSpeed(finalUploadSpeedMbps.toFixed(2));
    updateOverallProgress(overallStart, overallEnd, 100);
  }

  // Function to start the entire speed test process
  const startAllTests = async () => {
    setPing('-');
    setDownloadSpeed('-');
    setUploadSpeed('-');
    setIpAddress('-'); // Reset IP address
    setProgress(0);
    setTestStatus('Starting...');
    setTestState('pinging');
    setIsTesting(true);
    abortControllerRef.current = new AbortController();

    const pingProgressEnd = 10;
    const downloadProgressEnd = 60;
    const uploadProgressEnd = 100;

    try {
      setTestStatus('Fetching IP Address...');
      const ip = await fetchIpAddress();
      setIpAddress(ip || 'N/A');

      setTestStatus('Starting Ping Test...');
      await runPingTest(0, pingProgressEnd);

      setTestStatus('Starting Download Test...');
      setTestState('downloading');
      await runDownloadTest(pingProgressEnd, downloadProgressEnd);

      setTestStatus('Starting Upload Test...');
      setTestState('uploading');
      await runUploadTest(downloadProgressEnd, uploadProgressEnd);

      setTestStatus('Test Complete!');
      setTestState('complete');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setTestStatus('Test Aborted');
        if (ping === '-') setPing('N/A');
        if (downloadSpeed === '-') setDownloadSpeed('N/A');
        if (uploadSpeed === '-') setUploadSpeed('N/A');
        if (ipAddress === '-') setIpAddress('N/A');
      } else {
        setTestStatus(`Error: ${error.message}`);
        console.error('Speed test error:', error);
        if (ping === '-') setPing('Error');
        if (downloadSpeed === '-') setDownloadSpeed('Error');
        if (uploadSpeed === '-') setUploadSpeed('Error');
        if (ipAddress === '-') setIpAddress('Error');
      }
    } finally {
      setIsTesting(false);
      abortControllerRef.current = null;
      setProgress(100);
      setCurrentSpeedDisplay(0);
      
      // Always save test result to history (even with partial results)
      // This ensures we capture any successful measurements even if others failed
      const newResult: TestResult = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleString(),
        ipAddress: ipAddress && ipAddress !== '-' ? ipAddress : "N/A",
        // Convert string values to numbers, handling all possible states
        ping: ping !== '-' && ping !== 'N/A' && ping !== 'Error' ? parseFloat(ping) : null,
        downloadSpeed: downloadSpeed !== '-' && downloadSpeed !== 'N/A' && downloadSpeed !== 'Error' ? parseFloat(downloadSpeed) : null,
        uploadSpeed: uploadSpeed !== '-' && uploadSpeed !== 'N/A' && uploadSpeed !== 'Error' ? parseFloat(uploadSpeed) : null,
      }
      
      // Save to history - we'll save even partial results so users can track test attempts
      console.log('Saving test result to history:', newResult);
      setTestHistory((prevHistory) => [newResult, ...prevHistory])
    }
  };

  const abortTest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const circumference = 2 * Math.PI * 90 // For SVG circle radius 90

  return (
    <Card className="w-full max-w-2xl bg-gray-800 text-white border-gray-700 shadow-lg rounded-xl overflow-hidden">
      <CardHeader className="text-center py-6 border-b border-gray-700">
        <CardTitle className="text-2xl md:text-3xl font-extrabold tracking-tight">Internet Speed Test</CardTitle>
        <div className="text-xs md:text-sm text-gray-400 flex items-center justify-center mt-2 max-w-full">
          <Wifi className="w-4 h-4 mr-1 flex-shrink-0" /> 
          <span className="truncate">Your IP: {ipAddress}</span>
        </div>
      </CardHeader>
      <CardContent className="p-8 flex flex-col items-center justify-center space-y-8">
        <div className="relative w-64 h-64 flex items-center justify-center">
          {/* Outer pulsing circle - remains independent */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 opacity-75 animate-pulse-slow" />

          {/* Inner circle with speed display - now the 'group' for its own hover effect */}
          <div
            onClick={!isTesting ? startAllTests : undefined}
            className={`relative w-56 h-56 rounded-full bg-gray-900 flex flex-col items-center justify-center border-4 border-gray-700 shadow-inner
            ${!isTesting ? "cursor-pointer" : "cursor-not-allowed"} 
            transition-transform duration-300 ease-in-out hover:scale-105 z-10 group
            ${testState === "downloading" || testState === "uploading" ? "animate-scale-breathe" : ""}`}
            aria-label="Start speed test"
          >
            {/* Smooth glowing layer that fades in on hover - now inside the group, behind content */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 blur-xl opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100 -z-10" />

            {/* Animated border overlay for running state - the "sick ass" effect */}
            {(testState === "downloading" || testState === "uploading") && (
              <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
                <div className="absolute inset-[-100%] rounded-full bg-[conic-gradient(from_0deg_at_50%_50%,_transparent_0%,_transparent_25%,_#00FFFF_50%,_transparent_75%,_transparent_100%)] animate-conic-spin-slow blur-md opacity-70" />
              </div>
            )}

            {testState === "idle" && <Gauge className="w-16 md:w-24 h-16 md:h-24 text-gray-400" />}
            {(testState === "downloading" || testState === "uploading") && (
              <>
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                  <circle
                    className="text-gray-700"
                    strokeWidth="10"
                    stroke="currentColor"
                    fill="transparent"
                    r="90"
                    cx="100"
                    cy="100"
                  />
                  <circle
                    className="text-cyan-500 transition-all duration-100 ease-linear"
                    strokeWidth="10"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - (progress / 100) * circumference}
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="transparent"
                    r="90"
                    cx="100"
                    cy="100"
                    transform="rotate(-90 100 100)"
                  />
                </svg>
                <span className="text-4xl md:text-6xl font-bold text-cyan-400 drop-shadow-[0_0_10px_rgba(0,255,255,0.7)] text-center">
                  {currentSpeedDisplay.toFixed(1)}
                </span>
                <span className="text-lg md:text-xl text-gray-400 mt-1">Mbps</span>
                <span className="text-sm md:text-lg text-gray-300 mt-1 animate-bounce-slow text-center px-2">
                  {testState === "downloading" ? "Testing Download..." : "Testing Upload..."}
                </span>
              </>
            )}
            {testState === "pinging" && (
              <>
                <Clock className="w-16 md:w-24 h-16 md:h-24 text-blue-400 animate-spin-slow" />
                <span className="text-lg md:text-2xl text-gray-300 mt-2 md:mt-4 text-center px-4">{testStatus}</span>
              </>
            )}
            {testState === "complete" && (
              <>
                <span className="text-xl md:text-3xl font-bold text-green-400 text-center leading-tight px-4">{testStatus}</span>
                <span className="text-xs md:text-sm text-gray-400 mt-2 text-center">Click to test again</span>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-lg">
          <ResultCard icon={<Clock className="w-5 h-5 text-blue-400" />} title="Ping" value={ping} unit="ms" />
          <ResultCard
            icon={<Download className="w-5 h-5 text-green-400" />}
            title="Download"
            value={downloadSpeed}
            unit="Mbps"
          />
          <ResultCard
            icon={<Upload className="w-5 h-5 text-orange-400" />}
            title="Upload"
            value={uploadSpeed}
            unit="Mbps"
          />
        </div>

        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="mt-8 bg-gray-700 hover:bg-gray-600 text-white border-gray-600 hover:border-gray-500"
            >
              <History className="w-5 h-5 mr-2" /> View History
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] bg-gray-800 text-white border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">Test History</DialogTitle>
            </DialogHeader>
            <TestHistory history={testHistory} />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

interface ResultCardProps {
  icon: React.ReactNode
  title: string
  value: string
  unit: string
}

function ResultCard({ icon, title, value, unit }: ResultCardProps) {
  return (
    <Card className="bg-gray-900 border-gray-700 text-white p-3 flex flex-col items-center justify-center space-y-2 shadow-md rounded-lg min-h-[100px]">
      <div className="flex items-center space-x-1.5 text-center">
        {icon}
        <h3 className="text-sm font-medium text-gray-300 truncate">{title}</h3>
      </div>
      <div className="text-center">
        <span className="text-2xl font-bold block">
          {value === '-' ? '--' : value}
        </span>
        <span className="text-xs text-gray-400 block">{unit}</span>
      </div>
    </Card>
  )
}
