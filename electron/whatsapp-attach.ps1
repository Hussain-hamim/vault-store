param(
  [Parameter(Mandatory = $true)][string]$PdfPath,
  [Parameter(Mandatory = $true)][string]$CaptionPath
)

$ErrorActionPreference = "Continue"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$log = Join-Path $env:TEMP "radefy-wa-attach.log"
function Write-Log([string]$msg) {
  ("{0} {1}" -f (Get-Date -Format "HH:mm:ss.fff"), $msg) | Out-File -FilePath $log -Append -Encoding utf8
}
Write-Log "start pdf=$PdfPath"

$w = New-Object -ComObject WScript.Shell

function Focus-WhatsApp {
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and (
        $_.ProcessName -match '^(WhatsApp|app)$' -or
        $_.MainWindowTitle -like 'WhatsApp*' -or
        ($_.ProcessName -eq 'ApplicationFrameHost' -and $_.MainWindowTitle -like '*WhatsApp*')
      )
    }
  foreach ($p in $procs) {
    if ($w.AppActivate($p.Id)) {
      Write-Log ("focus pid={0} title={1}" -f $p.Id, $p.MainWindowTitle)
      return $true
    }
  }
  foreach ($t in @("WhatsApp", "WhatsApp Desktop")) {
    if ($w.AppActivate($t)) {
      Write-Log "focus title=$t"
      return $true
    }
  }
  Write-Log "focus failed"
  return $false
}

function Get-WhatsAppElement {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and (
        $_.ProcessName -match '^(WhatsApp|app)$' -or
        $_.MainWindowTitle -like 'WhatsApp*' -or
        ($_.ProcessName -eq 'ApplicationFrameHost' -and $_.MainWindowTitle -like '*WhatsApp*')
      )
    }
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
      $p.Id
    )
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if ($el) { return $el }
  }
  return $null
}

function Invoke-NamedControl(
  [System.Windows.Automation.AutomationElement]$parent,
  [string[]]$names
) {
  if (-not $parent) { return $false }
  foreach ($name in $names) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $el = $parent.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) { continue }
    try {
      $pat = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      if ($pat) {
        $pat.Invoke()
        Write-Log "invoke name=$name"
        return $true
      }
    } catch {}
    try {
      $el.SetFocus()
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
      Write-Log "enter name=$name"
      return $true
    } catch {}
  }
  return $false
}

function Focus-Composer {
  $win = Get-WhatsAppElement
  if (-not $win) { return $false }
  $names = @(
    "Type a message",
    "Type a message...",
    "Message",
    "پیام بنویسید",
    "پیغام ولیکئ"
  )
  foreach ($name in $names) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty,
      $name
    )
    $el = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) { continue }
    try {
      $el.SetFocus()
      Write-Log "composer=$name"
      return $true
    } catch {}
  }
  return $false
}

function Wait-OpenDialog([int]$timeoutMs = 10000) {
  $start = Get-Date
  while (((Get-Date) - $start).TotalMilliseconds -lt $timeoutMs) {
    foreach ($title in @("Open", "Select a file", "Choose file", "Open File")) {
      if ($w.AppActivate($title)) {
        Write-Log "dialog=$title"
        return $true
      }
    }
    $dlg = Get-Process -ErrorAction SilentlyContinue |
      Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and
        $_.MainWindowTitle -match '(Open|Select|Choose)'
      }
    foreach ($d in $dlg) {
      if ($w.AppActivate($d.Id)) {
        Write-Log ("dialog pid={0} title={1}" -f $d.Id, $d.MainWindowTitle)
        return $true
      }
    }
    Start-Sleep -Milliseconds 200
  }
  Write-Log "dialog timeout"
  return $false
}

function Set-FileClipboard([string]$filePath) {
  $files = New-Object System.Collections.Specialized.StringCollection
  [void]$files.Add($filePath)
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetFileDropList($files)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
  Write-Log "clipboard file set"
}

function Invoke-AttachNearComposer {
  $win = Get-WhatsAppElement
  if (-not $win) { return $false }
  $editType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $edits = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editType)
  $composer = $null
  foreach ($e in $edits) {
    $n = ""
    try { $n = [string]$e.Current.Name } catch {}
    if ($n -match 'message|پیام|پیغام|Message' -or $n -eq "") {
      $composer = $e
    }
  }
  if (-not $composer -and $edits.Count -gt 0) {
    $composer = $edits.Item($edits.Count - 1)
  }
  if (-not $composer) { return $false }

  $btnType = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
  )
  $buttons = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnType)
  $cRect = $composer.Current.BoundingRectangle
  $best = $null
  $bestDist = [double]::MaxValue
  foreach ($b in $buttons) {
    $r = $b.Current.BoundingRectangle
    if ($r.Width -le 0 -or $r.Height -le 0) { continue }
    # Attach (+) sits on the same row, to the left of the message box.
    $sameRow = [Math]::Abs(($r.Y + $r.Height / 2) - ($cRect.Y + $cRect.Height / 2)) -lt 40
    $toLeft = ($r.X + $r.Width) -le ($cRect.X + 8)
    if (-not ($sameRow -and $toLeft)) { continue }
    $dist = $cRect.X - ($r.X + $r.Width)
    if ($dist -ge 0 -and $dist -lt $bestDist) {
      $bestDist = $dist
      $best = $b
    }
  }
  if (-not $best) { return $false }
  try {
    $pat = $best.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($pat) {
      $pat.Invoke()
      Write-Log "attach via near-composer button"
      return $true
    }
  } catch {}
  try {
    $best.SetFocus()
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Log "attach via near-composer focus"
    return $true
  } catch {}
  return $false
}

function Attach-ViaFileDialog {
  [void](Focus-WhatsApp)
  Start-Sleep -Milliseconds 400
  $win = Get-WhatsAppElement

  $openedMenu = Invoke-NamedControl $win @(
    "Attach",
    "Attach file",
    "Open and attach",
    "Attachment",
    "+",
    "پیوست",
    "ضمیمه"
  )
  if (-not $openedMenu) {
    $openedMenu = Invoke-AttachNearComposer
  }
  if (-not $openedMenu) {
    Write-Log "attach button missing — trying keyboard"
    # Walk backwards from composer toward the attach (+) control.
    [void](Focus-Composer)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("+{TAB}")
    Start-Sleep -Milliseconds 180
    [System.Windows.Forms.SendKeys]::SendWait("+{TAB}")
    Start-Sleep -Milliseconds 180
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Start-Sleep -Milliseconds 500
  } else {
    Start-Sleep -Milliseconds 500
  }

  $win = Get-WhatsAppElement
  $pickedDoc = Invoke-NamedControl $win @(
    "Document",
    "Documents",
    "Document file",
    "File",
    "سند",
    "مستند"
  )
  if (-not $pickedDoc) {
    Write-Log "document item missing — arrow+enter"
    [System.Windows.Forms.SendKeys]::SendWait("{DOWN}")
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  }

  if (-not (Wait-OpenDialog)) { return $false }

  Start-Sleep -Milliseconds 450
  [System.Windows.Forms.Clipboard]::SetText($PdfPath)
  Start-Sleep -Milliseconds 150
  # Focus the File name box (Alt+N), replace contents, confirm.
  [System.Windows.Forms.SendKeys]::SendWait("%n")
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait("^a")
  Start-Sleep -Milliseconds 80
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 350
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Write-Log "open dialog submitted"
  return $true
}

function Attach-ViaClipboardPaste {
  Set-FileClipboard $PdfPath
  Start-Sleep -Milliseconds 250
  [void](Focus-WhatsApp)
  Start-Sleep -Milliseconds 250
  [void](Focus-Composer)
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Write-Log "clipboard paste sent"
  Start-Sleep -Milliseconds 1400
}

function Send-CaptionAndSubmit {
  $caption = ""
  if (Test-Path -LiteralPath $CaptionPath) {
    $caption = Get-Content -LiteralPath $CaptionPath -Raw -Encoding UTF8
  }
  if ($null -eq $caption) { $caption = "" }
  [System.Windows.Forms.Clipboard]::SetText($caption)
  Start-Sleep -Milliseconds 200
  [void](Focus-WhatsApp)
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 500
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
  Write-Log "caption sent"
}

if (-not (Test-Path -LiteralPath $PdfPath)) {
  Write-Log "pdf missing"
  throw "PDF not found: $PdfPath"
}

# Chat protocol needs time; window title becomes the contact name.
Start-Sleep -Milliseconds 4500
if (-not (Focus-WhatsApp)) {
  Start-Sleep -Milliseconds 2500
  [void](Focus-WhatsApp)
}
Start-Sleep -Milliseconds 800

$attached = $false
try {
  $attached = Attach-ViaFileDialog
} catch {
  Write-Log ("dialog error: {0}" -f $_.Exception.Message)
  $attached = $false
}

if (-not $attached) {
  Write-Log "falling back to clipboard paste"
  Attach-ViaClipboardPaste
}

Start-Sleep -Milliseconds 1100
Send-CaptionAndSubmit

Remove-Item -LiteralPath $CaptionPath -Force -ErrorAction SilentlyContinue
Write-Log "done"
