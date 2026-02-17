# Package the extension for AMO submission.
# Run from the extension folder (where manifest.json lives).
# Output: Private-Bookmarks-1.1.zip in the parent folder, with forward slashes in paths (required by AMO).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not (Test-Path "$root\manifest.json")) {
  Write-Error "Run this script from the extension folder (where manifest.json is)."
  exit 1
}

$outZip = Join-Path (Split-Path $root -Parent) "Private-Bookmarks-1.1.zip"
if (Test-Path $outZip) { Remove-Item $outZip -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($outZip, [System.IO.Compression.ZipArchiveMode]::Create)

$include = @(
  "manifest.json", "background.js", "popup.html", "popup.js", "content.js",
  "import.html", "import.js"
)
foreach ($name in $include) {
  $path = Join-Path $root $name
  if (Test-Path $path) {
    $entry = $zip.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = (Get-Item $path).LastWriteTime
    $stream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($path)
    $fileStream.CopyTo($stream)
    $stream.Close()
    $fileStream.Close()
  }
}

foreach ($dir in @("icons", "helpers")) {
  $dirPath = Join-Path $root $dir
  if (-not (Test-Path $dirPath -PathType Container)) { continue }
  $files = Get-ChildItem -Path $dirPath -Recurse -File
  foreach ($f in $files) {
    $relative = $f.FullName.Substring($root.Length).TrimStart("\")
    $entryName = $relative.Replace("\", "/")
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $f.LastWriteTime
    $stream = $entry.Open()
    $fileStream = [System.IO.File]::OpenRead($f.FullName)
    $fileStream.CopyTo($stream)
    $stream.Close()
    $fileStream.Close()
  }
}

$zip.Dispose()
Write-Host "Created: $outZip"
