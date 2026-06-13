$ErrorActionPreference = 'Stop'
$em = [char]0x2014  # em-dash

# ── 1. AuthContext.jsx — add manager to ROLE_ACCESS ──────────────────
$p1 = "src\context\AuthContext.jsx"
$c1 = [System.IO.File]::ReadAllText((Resolve-Path $p1))
if ($c1.Contains("manager:")) {
  Write-Host "AuthContext: already has manager role" -ForegroundColor Yellow
} else {
  $old = "  staff:      ['items',"
  $new = "  manager:    ['dashboard', 'items', 'receiving', 'inventory', 'locations', 'orders', 'billing', 'clients', 'accounts', 'staff', 'reports'],`r`n  staff:      ['items',"
  if ($c1.Contains($old)) {
    [System.IO.File]::WriteAllText((Resolve-Path $p1), $c1.Replace($old, $new), [System.Text.UTF8Encoding]::new($false))
    Write-Host "AuthContext: manager role added" -ForegroundColor Green
  } else {
    Write-Host "AuthContext: anchor not found" -ForegroundColor Red
  }
}

# ── 2. StaffManagement.jsx — add manager to ROLES array ──────────────
$p2 = "src\pages\StaffManagement.jsx"
$c2 = [System.IO.File]::ReadAllText((Resolve-Path $p2))
if ($c2.Contains("id: 'manager'")) {
  Write-Host "StaffManagement: already has manager role" -ForegroundColor Yellow
} else {
  $oldRoles = @'
const ROLES = [
  {
    id: 'staff',
'@
  $newRoles = @"
const ROLES = [
  {
    id: 'manager',
    label: 'Manager',
    description: 'Full access $em same as admin',
    color: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    access: ['All pages']
  },
  {
    id: 'staff',
"@
  if ($c2.Contains($oldRoles)) {
    $c2 = $c2.Replace($oldRoles, $newRoles)
    # Also update grid from 3 to 4 columns to fit the new card
    $c2 = $c2.Replace('grid grid-cols-3 gap-4 mb-6', 'grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6')
    [System.IO.File]::WriteAllText((Resolve-Path $p2), $c2, [System.Text.UTF8Encoding]::new($false))
    Write-Host "StaffManagement: manager role added + grid updated" -ForegroundColor Green
  } else {
    Write-Host "StaffManagement: anchor not found" -ForegroundColor Red
  }
}
