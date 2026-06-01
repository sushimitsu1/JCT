import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/library'
import { X, RefreshCw } from 'lucide-react'

export default function BarcodeScanner({ onScan, onClose, title = 'Scan Barcode' }) {
  const videoRef = useRef(null)
  const readerRef = useRef(null)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(true)
  const [lastScan, setLastScan] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState('')
  const [cameras, setCameras] = useState([])
  const [selectedCamera, setSelectedCamera] = useState(null)
  const [torch, setTorch] = useState(false)

  useEffect(() => {
    startScanner()
    return () => stopScanner()
  }, [selectedCamera])

  const startScanner = async () => {
    try {
      setError('')
      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader

      const devices = await BrowserMultiFormatReader.listVideoInputDevices()
      setCameras(devices)

      let deviceId = selectedCamera
      if (!deviceId && devices.length > 0) {
        const backCamera = devices.find(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment')
        )
        deviceId = backCamera?.deviceId || devices[devices.length - 1]?.deviceId
        setSelectedCamera(deviceId)
        return
      }

      if (!deviceId) {
        setError('No camera found on this device')
        return
      }

      await reader.decodeFromVideoDevice(deviceId, videoRef.current, (result, err) => {
        if (result) {
          const text = result.getText()
          if (text !== lastScan) {
            setLastScan(text)
            setScanning(false)
            if (navigator.vibrate) navigator.vibrate(100)
            setTimeout(() => { onScan(text) }, 300)
          }
        }
      })
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera access and try again.')
      } else {
        setError(`Camera error: ${err.message}`)
        setManualMode(true)
      }
    }
  }

  const stopScanner = () => {
    if (readerRef.current) {
      try { readerRef.current.reset() } catch (e) {}
    }
  }

  const toggleTorch = async () => {
    try {
      const stream = videoRef.current?.srcObject
      if (!stream) return
      const track = stream.getVideoTracks()[0]
      const capabilities = track.getCapabilities()
      if (capabilities.torch) {
        await track.applyConstraints({ advanced: [{ torch: !torch }] })
        setTorch(!torch)
      }
    } catch (e) {}
  }

  const switchCamera = () => {
    stopScanner()
    const currentIdx = cameras.findIndex(c => c.deviceId === selectedCamera)
    const nextIdx = (currentIdx + 1) % cameras.length
    setSelectedCamera(cameras[nextIdx].deviceId)
  }

  const handleManualSubmit = () => {
    if (!manualInput.trim()) return
    onScan(manualInput.trim().toUpperCase())
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.95)' }}>
      <div className="w-full max-w-sm mx-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h3 className="text-white font-semibold text-lg">{title}</h3>
            <p className="text-gray-400 text-xs mt-0.5">Point camera at barcode or QR code</p>
          </div>
          <button onClick={() => { stopScanner(); onClose() }} className="text-gray-400 hover:text-white p-1">
            <X size={22} />
          </button>
        </div>

        {!manualMode ? (
          <>
            {/* Camera viewfinder */}
            <div className="relative rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: '1/1' }}>
              <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />

              {!error && (
                <>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="relative w-56 h-56">
                      <div className="absolute top-0 left-0 w-10 h-10 border-t-2 border-l-2 border-blue-400 rounded-tl-lg" />
                      <div className="absolute top-0 right-0 w-10 h-10 border-t-2 border-r-2 border-blue-400 rounded-tr-lg" />
                      <div className="absolute bottom-0 left-0 w-10 h-10 border-b-2 border-l-2 border-blue-400 rounded-bl-lg" />
                      <div className="absolute bottom-0 right-0 w-10 h-10 border-b-2 border-r-2 border-blue-400 rounded-br-lg" />
                      <div className="absolute inset-x-0 overflow-hidden" style={{ top: 0, height: '100%' }}>
                        <div style={{
                          position: 'absolute', left: 0, right: 0, height: 2,
                          background: 'linear-gradient(90deg, transparent, #3B82F6, transparent)',
                          animation: 'scanLine 2s linear infinite',
                          boxShadow: '0 0 8px #3B82F6'
                        }} />
                      </div>
                    </div>
                  </div>
                  <div className="absolute bottom-3 inset-x-0 flex justify-center">
                    {scanning ? (
                      <div className="bg-black/60 rounded-full px-4 py-1.5 flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                        <span className="text-white text-xs">Scanning...</span>
                      </div>
                    ) : (
                      <div className="bg-green-600/80 rounded-full px-4 py-1.5">
                        <span className="text-white text-xs font-medium">✓ Found: {lastScan}</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 p-6 text-center">
                  <p className="text-gray-300 text-sm mb-4">{error}</p>
                  <button onClick={startScanner} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
                    <RefreshCw size={14} /> Try Again
                  </button>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-6 mt-4">
              {cameras.length > 1 && (
                <button onClick={switchCamera} className="flex flex-col items-center gap-1 text-gray-400 hover:text-white">
                  <div className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center">
                    <RefreshCw size={18} />
                  </div>
                  <span className="text-xs">Flip</span>
                </button>
              )}
              <button onClick={toggleTorch} className={`flex flex-col items-center gap-1 ${torch ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${torch ? 'bg-yellow-500/20' : 'bg-gray-800'}`}>
                  <span className="text-lg">🔦</span>
                </div>
                <span className="text-xs">Torch</span>
              </button>
              <button onClick={() => setManualMode(true)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-white">
                <div className="w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center">
                  <span className="text-base">⌨️</span>
                </div>
                <span className="text-xs">Manual</span>
              </button>
            </div>
          </>
        ) : (
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4">
            <div className="text-center mb-2">
              <span className="text-4xl">⌨️</span>
              <p className="text-white font-medium mt-2">Manual Entry</p>
              <p className="text-gray-500 text-xs mt-1">Type the barcode or SKU manually</p>
            </div>
            <input
              autoFocus
              value={manualInput}
              onChange={e => setManualInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') handleManualSubmit() }}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3.5 text-lg font-mono tracking-wider focus:outline-none focus:border-blue-500 text-center"
              placeholder="TYPE SKU HERE..."
            />
            <div className="flex gap-3">
              <button onClick={() => setManualMode(false)} className="flex-1 py-3 rounded-xl text-sm text-gray-400 hover:text-white border border-gray-700">
                Use Camera
              </button>
              <button onClick={handleManualSubmit} disabled={!manualInput.trim()}
                className="flex-1 py-3 rounded-xl text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-medium">
                Confirm
              </button>
            </div>
          </div>
        )}

        <p className="text-gray-600 text-xs text-center mt-4">
          Supports QR, Code 128, Code 39, EAN-13, UPC-A
        </p>
      </div>

      <style>{`
        @keyframes scanLine {
          0% { top: 0%; }
          100% { top: 100%; }
        }
      `}</style>
    </div>
  )
}