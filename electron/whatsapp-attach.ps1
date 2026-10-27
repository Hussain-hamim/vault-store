param(
  [Parameter(Mandatory = $true)][string]$PdfPath,
  [Parameter(Mandatory = $true)][string]$CaptionPath,
  [Parameter(Mandatory = $true)][string]$RoutePath
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RadefyWA {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr handle, uint command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
}
'@

$w = New-Object -ComObject WScript.Shell

function Focus-WhatsApp {
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and (
        $_.ProcessName -match '^WhatsApp(\.Root)?$' -or
        ($_.ProcessName -in @('ApplicationFrameHost', 'app') -and $_.MainWindowTitle -like '*WhatsApp*')
      )
    }
  foreach ($p in $procs) {
    if ($w.AppActivate($p.Id)) {
      $foreground = [RadefyWA]::GetForegroundWindow()
      if ($foreground -eq $p.MainWindowHandle -or [RadefyWA]::GetAncestor($foreground, 3) -eq $p.MainWindowHandle) {
        return $true
      }
    }
  }
  return $false
}

function Get-WhatsAppElement {
  $procs = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne [IntPtr]::Zero -and (
        $_.ProcessName -match '^WhatsApp(\.Root)?$' -or
        ($_.ProcessName -in @('ApplicationFrameHost', 'app') -and $_.MainWindowTitle -like '*WhatsApp*')
      )
    }
  foreach ($p in $procs) {
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    if ($el) { return $el }
  }
  return $null
}

function Invoke-NamedControl(
  [System.Windows.Automation.AutomationElement]$parent,
  [string[]]$names
) {
  if (-not $parent) { return $false }
  foreach ($el in $parent.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($el.Current.ControlType -notin @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::MenuItem)) { continue }
    $name = ([string]$el.Current.Name -replace '[\u200e\u200f\u202a-\u202e]', '').Trim()
    if ($name -notin $names -or -not $el.Current.IsEnabled -or $el.Current.IsOffscreen) { continue }
    $pat = $null
    try {
      $pat = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    } catch {}
    if ($pat) {
      # Do not retry with Enter if invocation itself fails: it may have sent.
      $pat.Invoke()
    } else {
      $el.SetFocus()
      if (-not $el.Current.HasKeyboardFocus) { return $false }
      [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    }
    return $true
  }
  return $false
}

function Focus-Composer {
  $el = Find-Edit @('Type a message', 'Type a message...', 'Type a message…', 'Message', 'Compose message', 'پیام بنویسید', 'پیغام ولیکئ')
  if (-not $el) { return $false }
  $el.SetFocus()
  return $el.Current.HasKeyboardFocus
}

function Wait-OpenDialog([int]$timeoutMs = 10000) {
  $start = Get-Date
  while (((Get-Date) - $start).TotalMilliseconds -lt $timeoutMs) {
    $win = Get-WhatsAppElement
    if ($win) {
      $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770')
      $dlg = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
      if (-not $dlg) {
        # Win32 Open panels can be owned top-level windows, not UIA children.
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        foreach ($candidate in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)) {
          $owner = [RadefyWA]::GetWindow([IntPtr]$candidate.Current.NativeWindowHandle, 4)
          if ($owner -eq [IntPtr]$win.Current.NativeWindowHandle -or $candidate.Current.ProcessId -eq $win.Current.ProcessId) {
            $dlg = $candidate
            break
          }
        }
      }
      if ($dlg) {
        $dlg.SetFocus()
        return $dlg
      }
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

function Set-FileClipboard([string]$filePath) {
  $files = New-Object System.Collections.Specialized.StringCollection
  [void]$files.Add($filePath)
  $data = New-Object System.Windows.Forms.DataObject
  $data.SetFileDropList($files)
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
}

function Attach-ViaFileDialog {
  if (-not (Focus-WhatsApp)) { throw 'WHATSAPP_CHAT_NOT_READY' }
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
    return $false
  }

  [void](Wait-For { Invoke-NamedControl (Get-WhatsAppElement) @(
    "Document",
    "Documents",
    "Document file",
    "File",
    "سند",
    "مستند"
  ) } 5 'WHATSAPP_ATTACH_FAILED')

  $picker = Wait-OpenDialog
  if (-not $picker) { throw 'WHATSAPP_ATTACH_FAILED' }
  $id = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1148')
  $filename = $picker.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $id)
  if (-not $filename) { throw 'WHATSAPP_ATTACH_FAILED' }
  # Set the actual filename control; Alt+N is locale-dependent and can target
  # the wrong control. ValuePattern also preserves spaces and Afghan names.
  $value = $filename.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $value.SetValue($PdfPath)
  if ($value.Current.Value -cne $PdfPath) { throw 'WHATSAPP_ATTACH_FAILED' }
  $id = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1')
  $open = $picker.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $id)
  if (-not $open) { throw 'WHATSAPP_ATTACH_FAILED' }
  $invoke = $open.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  return $true
}

function Attach-ViaClipboardPaste {
  Set-FileClipboard $PdfPath
  Start-Sleep -Milliseconds 250
  if (-not (Focus-WhatsApp)) { throw 'WHATSAPP_CHAT_NOT_READY' }
  Start-Sleep -Milliseconds 250
  if (-not (Focus-Composer)) { throw 'WHATSAPP_ATTACH_FAILED' }
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 1400
}

function Find-Edit([string[]]$names) {
  $win = Get-WhatsAppElement
  if (-not $win) { return $null }
  foreach ($el in $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($el.Current.ControlType -notin @([System.Windows.Automation.ControlType]::Edit, [System.Windows.Automation.ControlType]::Document)) { continue }
    $name = ([string]$el.Current.Name -replace '[\u200e\u200f\u202a-\u202e]', '').Trim()
    if ($name -in $names -and $el.Current.IsEnabled -and -not $el.Current.IsOffscreen) { return $el }
  }
  return $null
}

function Read-Edit($el) {
  try {
    $pattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    return ([string]$pattern.Current.Value -replace "`r`n", "`n").TrimEnd("`r", "`n")
  } catch {
    try {
      $pattern = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      return ([string]$pattern.DocumentRange.GetText(-1) -replace "`r`n", "`n").TrimEnd("`r", "`n")
    } catch { return $null }
  }
}

function Wait-For([scriptblock]$check, [int]$seconds, [string]$failure) {
  $deadline = (Get-Date).AddSeconds($seconds)
  do {
    $result = & $check
    if ($result) { return $result }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw $failure
}

$captionNames = @('Add a caption', 'Add a caption...', 'Add a caption…', 'Add a caption (optional)', 'Caption', 'Caption...', 'شرح', 'توضیح')
$previousClipboard = $null
try {
  $oldData = [System.Windows.Forms.Clipboard]::GetDataObject()
  if ($oldData) {
    $previousClipboard = New-Object System.Windows.Forms.DataObject
    foreach ($format in $oldData.GetFormats($false)) {
      try { $previousClipboard.SetData($format, $false, $oldData.GetData($format, $false)) } catch {}
    }
  }
  if (-not (Test-Path -LiteralPath $PdfPath -PathType Leaf)) { throw 'WHATSAPP_ATTACH_FAILED' }
  $route = [string](Get-Content -LiteralPath $RoutePath -Raw -Encoding UTF8)
  $caption = [string](Get-Content -LiteralPath $CaptionPath -Raw -Encoding UTF8)
  # Open New chat and resolve the full international phone number. Never put
  # a greeting/filename in a normal message draft as a routing marker.
  if (-not (Focus-WhatsApp)) { throw 'WHATSAPP_CHAT_NOT_READY' }
  if (-not (Invoke-NamedControl (Get-WhatsAppElement) @('New chat', 'New Chat'))) { throw 'WHATSAPP_CHAT_NOT_READY' }
  $search = Wait-For { Find-Edit @('Search name or number', 'Search name or number...', 'Search name or number…', 'Search contacts', 'Name or phone number', 'Search') } 5 'WHATSAPP_CHAT_NOT_READY'
  $search.SetFocus()
  if (-not $search.Current.HasKeyboardFocus) { throw 'WHATSAPP_CHAT_NOT_READY' }
  [System.Windows.Forms.Clipboard]::SetText('+' + $route)
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  [void](Wait-For { (Read-Edit $search) -ceq ('+' + $route) } 3 'WHATSAPP_CHAT_NOT_READY')
  # Require a result exposing this phone number; a same-name contact is not
  # enough. Fail safely on WhatsApp versions that hide result phone numbers.
  $result = Wait-For {
    $matches = @()
    foreach ($el in (Get-WhatsAppElement).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      if ($el.Current.IsOffscreen -or -not $el.Current.IsEnabled) { continue }
      if ($el.Current.ControlType -notin @([System.Windows.Automation.ControlType]::ListItem, [System.Windows.Automation.ControlType]::Button)) { continue }
      if (([string]$el.Current.Name -replace '[^0-9]', '') -ceq $route) { $matches += $el }
    }
    if ($matches.Count -eq 1) { $matches[0] }
  } 20 'WHATSAPP_CHAT_NOT_READY'
  try {
    $invoke = $result.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
  } catch {
    $select = $result.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $select.Select()
    $result.SetFocus()
    if (-not $result.Current.HasKeyboardFocus) { throw 'WHATSAPP_CHAT_NOT_READY' }
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  }
  $composer = Wait-For { Find-Edit @('Type a message', 'Type a message...', 'Type a message…', 'Message', 'Compose message', 'پیام بنویسید', 'پیغام ولیکئ') } 10 'WHATSAPP_CHAT_NOT_READY'
  if ((Read-Edit $composer) -cne '') { throw 'WHATSAPP_CHAT_NOT_READY' }

  if (-not (Attach-ViaFileDialog)) { Attach-ViaClipboardPaste }
  $captionField = Wait-For { Find-Edit $captionNames } 20 'WHATSAPP_ATTACH_FAILED'
  # Scope file identity and Send to the caption's attachment container.
  $preview = $null
  $ancestor = $captionField
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  for ($depth = 0; $depth -lt 12; $depth++) {
    $ancestor = $walker.GetParent($ancestor)
    if (-not $ancestor -or $ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window) { break }
    $hasFile = $false
    $hasComposer = $false
    foreach ($el in $ancestor.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
      if ($el.Current.IsOffscreen) { continue }
      if ($el.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and ([string]$el.Current.Name).Contains([System.IO.Path]::GetFileName($PdfPath))) { $hasFile = $true }
      if (([string]$el.Current.Name -replace '[\u200e\u200f\u202a-\u202e]', '').Trim() -in @('Type a message', 'Type a message...', 'Type a message…', 'Message', 'Compose message')) { $hasComposer = $true }
    }
    if ($hasFile -and -not $hasComposer) { $preview = $ancestor; break }
  }
  if (-not $preview) { throw 'WHATSAPP_ATTACH_FAILED' }
  if (-not (Focus-WhatsApp)) { throw 'WHATSAPP_CHAT_NOT_READY' }
  $captionField.SetFocus()
  if (-not $captionField.Current.HasKeyboardFocus) { throw 'WHATSAPP_ATTACH_FAILED' }
  [System.Windows.Forms.SendKeys]::SendWait('^a')
  if ($caption.Length -gt 0) {
    [System.Windows.Forms.Clipboard]::SetText($caption)
    [System.Windows.Forms.SendKeys]::SendWait('^v')
  } else { [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}') }
  [void](Wait-For { (Read-Edit $captionField) -ceq $caption } 3 'WHATSAPP_ATTACH_FAILED')
  # This is the only Send action: no ordinary composer Enter, no blind retry.
  if (-not (Invoke-NamedControl $preview @('Send', 'Send message', 'Send document', 'ارسال', 'لېږل'))) {
    throw 'WHATSAPP_ATTACH_FAILED'
  }
  [void](Wait-For { (Get-WhatsAppElement) -and -not (Find-Edit $captionNames) -and (Find-Edit @('Type a message', 'Type a message...', 'Type a message…', 'Message', 'Compose message', 'پیام بنویسید', 'پیغام ولیکئ')) } 15 'WHATSAPP_SEND_UNCONFIRMED')
  Write-Output 'RADEFY_WHATSAPP_SUBMITTED'
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($previousClipboard) {
    try { [System.Windows.Forms.Clipboard]::SetDataObject($previousClipboard, $true) } catch {}
  }
}
