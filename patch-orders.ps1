$ErrorActionPreference = 'Stop'
$path = "src\pages\Orders.jsx"

if (-not (Test-Path $path)) {
  Write-Host "ERROR: $path not found. Run from project root." -ForegroundColor Red
  exit 1
}

$raw = Get-Content $path -Raw
$wasCrlf = $raw.Contains("`r`n")
$content = if ($wasCrlf) { $raw -replace "`r`n", "`n" } else { $raw }

function Apply-Patch($label, $old, $new) {
  if ($script:content.Contains($old)) {
    $script:content = $script:content.Replace($old, $new)
    Write-Host "  $label : OK" -ForegroundColor Green
    return $true
  } else {
    Write-Host "  $label : NOT FOUND (already applied or edited)" -ForegroundColor Yellow
    return $false
  }
}

Write-Host "Patching Orders.jsx..." -ForegroundColor Cyan

# ─── Patch 1: imports ──────────────────────────────────────────────
$old1 = @'
  Truck, DollarSign, List, ChevronDown, RotateCcw, Filter, X as XIcon
} from 'lucide-react'
'@
$new1 = @'
  Truck, DollarSign, List, ChevronDown, RotateCcw, Filter, X as XIcon, RefreshCw
} from 'lucide-react'
'@
Apply-Patch "Patch 1 (imports)" $old1 $new1 | Out-Null

# ─── Patch 2: refresh handler ──────────────────────────────────────
$old2 = @'
  useEffect(() => { fetchData() }, [])
'@
$new2 = @'
  useEffect(() => { fetchData() }, [])

  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }
'@
Apply-Patch "Patch 2 (handler)" $old2 $new2 | Out-Null

# ─── Patch 3: list view button ─────────────────────────────────────
$old3 = @'
        <div className="flex gap-2">
          <button onClick={() => setShowBulkUpload(true)} className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            Bulk Upload
          </button>
        <button onClick={openNew} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus size={16} /> New Order
        </button>
        </div>
'@
$new3 = @'
        <div className="flex gap-2">
          <button onClick={handleRefresh} disabled={refreshing}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg disabled:opacity-50">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setShowBulkUpload(true)} className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/20 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
            Bulk Upload
          </button>
        <button onClick={openNew} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          <Plus size={16} /> New Order
        </button>
        </div>
'@
Apply-Patch "Patch 3 (button)" $old3 $new3 | Out-Null

$out = if ($wasCrlf) { $content -replace "`n", "`r`n" } else { $content }
[System.IO.File]::WriteAllText((Resolve-Path $path), $out, [System.Text.UTF8Encoding]::new($false))
Write-Host "Saved: $path" -ForegroundColor Cyan
