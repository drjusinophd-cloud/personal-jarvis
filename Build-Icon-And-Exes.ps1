$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublicDir = Join-Path $Root "public"
$BinDir = Join-Path $Root "bin"
$IconPath = Join-Path $PublicDir "jarvis.ico"
$CscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

Add-Type -AssemblyName System.Drawing

function New-ArcReactorPngBytes([int]$Size) {
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $s = [float]$Size / 256.0

    # Deep Stark-Tech obsidian circular disc
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 5, 14, 30))
    $g.FillEllipse($bgBrush, 8 * $s, 8 * $s, 240 * $s, 240 * $s)

    # Outer glowing cyan bezel ring
    $outerPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 240, 255), [Math]::Max(1.8, 16 * $s))
    $g.DrawEllipse($outerPen, 20 * $s, 20 * $s, 216 * $s, 216 * $s)

    # Segmented Arc Reactor notches (8 radial struts)
    $strutPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 6, 18, 38), [Math]::Max(1.2, 10 * $s))
    $cx = 128.0 * $s
    $cy = 128.0 * $s
    for ($a = 0; $a -lt 360; $a += 45) {
        $rad = $a * [Math]::PI / 180.0
        $x1 = $cx + [Math]::Cos($rad) * (72 * $s)
        $y1 = $cy + [Math]::Sin($rad) * (72 * $s)
        $x2 = $cx + [Math]::Cos($rad) * (120 * $s)
        $y2 = $cy + [Math]::Sin($rad) * (120 * $s)
        $g.DrawLine($strutPen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)
    }

    # Inner electric blue ring
    $midPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 56, 189, 248), [Math]::Max(1.5, 10 * $s))
    $g.DrawEllipse($midPen, 56 * $s, 56 * $s, 144 * $s, 144 * $s)

    # Core halo + bright white-cyan center
    $haloBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 0, 240, 255))
    $g.FillEllipse($haloBrush, 72 * $s, 72 * $s, 112 * $s, 112 * $s)

    $coreBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 240, 255))
    $g.FillEllipse($coreBrush, 88 * $s, 88 * $s, 80 * $s, 80 * $s)

    $hotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 240, 253, 255))
    $g.FillEllipse($hotBrush, 106 * $s, 106 * $s, 44 * $s, 44 * $s)

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
    return ,$bytes
}

# Build multi-resolution ICO with 16, 32, 48, 64, 128, and 256 px frames
$sizes = @(16, 32, 48, 64, 128, 256)
$frames = @()
foreach ($sz in $sizes) {
    $frames += ,(New-ArcReactorPngBytes $sz)
}

$icoMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoMs)
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Count)

$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]
    $data = $frames[$i]
    $wByte = if ($sz -eq 256) { [byte]0 } else { [byte]$sz }
    $bw.Write($wByte)
    $bw.Write($wByte)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$data.Length)
    $bw.Write([uint32]$offset)
    $offset += $data.Length
}

for ($i = 0; $i -lt $frames.Count; $i++) {
    $bw.Write($frames[$i])
}
$bw.Flush()
[System.IO.File]::WriteAllBytes($IconPath, $icoMs.ToArray())
$bw.Close()

# Save 256x256 PNG icon for iOS Home Screen (apple-touch-icon) & PWA manifest
$PngIconPath = Join-Path $PublicDir "jarvis-icon.png"
[System.IO.File]::WriteAllBytes($PngIconPath, $frames[$frames.Count - 1])

# Also copy icon right next to EXEs in bin\
Copy-Item -Force $IconPath (Join-Path $BinDir "jarvis.ico")

$HubOut = Join-Path $BinDir "JarvisHub.exe"
$LaunchOut = Join-Path $BinDir "JarvisLauncher.exe"
$HubSrc = Join-Path $Root "HubServer.cs"
$LaunchSrc = Join-Path $Root "JarvisLauncher.cs"
$SpeechDll = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\System.Speech.dll"

# Compile JarvisHub.exe AND JarvisLauncher.exe with native Win32 embedded icon!
& $CscPath /nologo /target:exe "/win32icon:$IconPath" "/out:$HubOut" /r:System.Web.Extensions.dll /r:System.Security.dll "/r:$SpeechDll" $HubSrc
& $CscPath /nologo /target:winexe "/win32icon:$IconPath" "/out:$LaunchOut" $LaunchSrc

Write-Output "BUILT_OK IconBytes=$((Get-Item $IconPath).Length)"
