export {};

const { execFile } = require("child_process");
const path = require("path");

function toSingleQuotedPs(value: string) {
  return String(value || "").replace(/'/g, "''");
}

function runPowerShell(script: string, timeoutMs = 20000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const wrappedScript = `
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
${script}
`;
    const encoded = Buffer.from(wrappedScript, "utf16le").toString("base64");
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

async function parseJsonStdout(script: string, timeoutMs = 20000) {
  const { stdout } = await runPowerShell(script, timeoutMs);
  const raw = String(stdout || "")
    .replace(/^#<\s*CLIXML[\s\S]*?<\/Objs>\s*/i, "")
    .trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (_error) {
    const sanitized = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
    return JSON.parse(sanitized);
  }
}

function createDesktopAutomation() {
  async function launchApp(payload: { command?: string; args?: string[]; workingDirectory?: string }) {
    const command = String(payload?.command || "").trim();
    if (!command) {
      throw new Error("command is required.");
    }
    const args = Array.isArray(payload?.args) ? payload.args.map((item) => String(item || "")) : [];
    const workingDirectory = String(payload?.workingDirectory || "").trim();
    const argList = args.length ? `-ArgumentList @('${args.map(toSingleQuotedPs).join("','")}')` : "";
    const workDir = workingDirectory ? `-WorkingDirectory '${toSingleQuotedPs(workingDirectory)}'` : "";
    const script = `
$ErrorActionPreference = 'Stop'
[string]$appCommand = '${toSingleQuotedPs(command)}'
[string]$resolved = ''
if (Test-Path $appCommand) {
  $resolved = (Resolve-Path $appCommand).Path
}
if ([string]::IsNullOrWhiteSpace($resolved)) {
  try {
    $cmd = Get-Command $appCommand -ErrorAction Stop | Select-Object -First 1
    if ($cmd -and $cmd.Source) { $resolved = [string]$cmd.Source }
  } catch {}
}
if ([string]::IsNullOrWhiteSpace($resolved)) {
  $appPathKeys = @(
    'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  )
  foreach ($base in $appPathKeys) {
    try {
      $direct = Join-Path $base $appCommand
      if (Test-Path $direct) {
        $defaultValue = (Get-Item $direct).GetValue('')
        if ($defaultValue) { $resolved = [string]$defaultValue; break }
      }
      if (-not $appCommand.ToLower().EndsWith('.exe')) {
        $exeKey = Join-Path $base ($appCommand + '.exe')
        if (Test-Path $exeKey) {
          $defaultValue = (Get-Item $exeKey).GetValue('')
          if ($defaultValue) { $resolved = [string]$defaultValue; break }
        }
      }
    } catch {}
  }
}
if (-not [string]::IsNullOrWhiteSpace($resolved)) {
  $proc = Start-Process -FilePath $resolved ${argList} ${workDir} -PassThru
  [PSCustomObject]@{
    ok = $true
    processId = $proc.Id
    command = $appCommand
    resolvedCommand = $resolved
    launchMode = 'process'
  } | ConvertTo-Json -Compress -Depth 4
  exit 0
}

$shell = New-Object -ComObject Shell.Application
$apps = $shell.Namespace('shell:AppsFolder')
if ($null -ne $apps) {
  $normalizedCommand = ($appCommand.ToLower() -replace '[^a-z0-9]+', ' ').Trim()
  $matched = $null
  foreach ($item in $apps.Items()) {
    $name = [string]$item.Name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    $normalizedName = ($name.ToLower() -replace '[^a-z0-9]+', ' ').Trim()
    if ($normalizedName -eq $normalizedCommand -or $normalizedName -like ('*' + $normalizedCommand + '*')) {
      $matched = $item
      break
    }
  }
  if ($null -ne $matched) {
    $matched.InvokeVerb('open')
    Start-Sleep -Milliseconds 700
    [PSCustomObject]@{
      ok = $true
      processId = 0
      command = $appCommand
      resolvedCommand = [string]$matched.Path
      launchMode = 'appsfolder'
      appName = [string]$matched.Name
    } | ConvertTo-Json -Compress -Depth 4
    exit 0
  }
}

throw ("Unable to launch app: " + $appCommand + ". No executable or installed app matched this name.")
`;
    return parseJsonStdout(script, 20000);
  }

  async function openPath(payload: { path?: string }) {
    const targetPath = String(payload?.path || "").trim();
    if (!targetPath) {
      throw new Error("path is required.");
    }
    const script = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath '${toSingleQuotedPs(targetPath)}'
[PSCustomObject]@{ ok = $true; path = '${toSingleQuotedPs(targetPath)}' } | ConvertTo-Json -Compress
`;
    return parseJsonStdout(script, 15000);
  }

  async function listWindows() {
    const script = `
$ErrorActionPreference = 'Stop'
$items = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) } |
  Select-Object ProcessName, Id, MainWindowTitle
@($items) | ConvertTo-Json -Compress -Depth 4
`;
    const parsed = await parseJsonStdout(script, 15000);
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  }

  async function focusWindow(payload: { title?: string }) {
    const title = String(payload?.title || "").trim();
    if (!title) {
      throw new Error("title is required.");
    }
    const script = `
$ErrorActionPreference = 'Stop'
$wshell = New-Object -ComObject WScript.Shell
$ok = $wshell.AppActivate('${toSingleQuotedPs(title)}')
[PSCustomObject]@{ ok = [bool]$ok; title = '${toSingleQuotedPs(title)}' } | ConvertTo-Json -Compress
`;
    return parseJsonStdout(script, 10000);
  }

  async function getForegroundWindow() {
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  [PSCustomObject]@{ ok = $false; title = ''; processId = 0 } | ConvertTo-Json -Compress
  exit 0
}
[uint32]$processIdOut = 0
[Win32]::GetWindowThreadProcessId($hwnd, [ref]$processIdOut) | Out-Null
$proc = $null
try { $proc = Get-Process -Id $processIdOut -ErrorAction Stop } catch {}
[PSCustomObject]@{
  ok = $true
  title = if ($proc) { $proc.MainWindowTitle } else { '' }
  processName = if ($proc) { $proc.ProcessName } else { '' }
  processId = $processIdOut
} | ConvertTo-Json -Compress -Depth 4
`;
    return parseJsonStdout(script, 10000);
  }

  async function getForegroundUiTree() {
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
}
"@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$fg = [Win32]::GetForegroundWindow()
if ($fg -eq [IntPtr]::Zero) {
  @{ elements = @() } | ConvertTo-Json -Compress -Depth 8
  exit 0
}
$condition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty,
  [int]$fg
)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
if ($null -eq $win) {
  @{ elements = @() } | ConvertTo-Json -Compress -Depth 8
  exit 0
}
$desc = $null
try {
  $desc = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
} catch {
  @{ elements = @() } | ConvertTo-Json -Compress -Depth 8
  exit 0
}
$max = [Math]::Min(250, $desc.Count)
$items = @()
for ($i = 0; $i -lt $max; $i++) {
  $el = $null
  try { $el = $desc.Item($i) } catch { continue }
  if ($null -eq $el) { continue }
  $name = [string]$el.Current.Name
  $typeName = ""
  try { $typeName = [string]$el.Current.LocalizedControlType } catch {}
  $r = $null
  try { $r = $el.Current.BoundingRectangle } catch { continue }
  if ($null -eq $r) { continue }
  if (($name -eq $null -or $name.Trim().Length -eq 0) -and ($typeName -eq $null -or $typeName.Trim().Length -eq 0)) { continue }
  if ($r.Width -le 1 -or $r.Height -le 1) { continue }
  $items += [PSCustomObject]@{
    name = ($name -replace '\\s+', ' ').Trim()
    controlType = ($typeName -replace '\\s+', ' ').Trim()
    rect = [PSCustomObject]@{
      x = [double]$r.X
      y = [double]$r.Y
      w = [double]$r.Width
      h = [double]$r.Height
    }
  }
}
@{ elements = $items } | ConvertTo-Json -Compress -Depth 8
`;
    return parseJsonStdout(script, 20000);
  }

  async function excelOpenWorkbook(payload: { path?: string; visible?: boolean }) {
    const workbookPath = String(payload?.path || "").trim();
    const resolvedPath = workbookPath ? path.resolve(workbookPath) : "";
    const visible = payload?.visible !== false;
    const script = `
$ErrorActionPreference = 'Stop'
$target = '${toSingleQuotedPs(resolvedPath)}'
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($null -eq $excel) { $excel = New-Object -ComObject Excel.Application }
$excel.Visible = ${visible ? "$true" : "$false"}
$workbook = $null
if ($target.Length -gt 0) {
  foreach ($wb in @($excel.Workbooks)) {
    if ($wb.FullName -eq $target) { $workbook = $wb; break }
  }
}
if ($null -eq $workbook -and $target.Length -gt 0) { $workbook = $excel.Workbooks.Open($target) }
if ($null -eq $workbook) { $workbook = $excel.Workbooks.Add() }
[PSCustomObject]@{
  ok = $true
  workbook = $workbook.Name
  path = $workbook.FullName
  visible = [bool]$excel.Visible
} | ConvertTo-Json -Compress -Depth 4
`;
    return parseJsonStdout(script, 30000);
  }

  async function excelReadRange(payload: { path?: string; sheet?: string; range?: string }) {
    const workbookPath = String(payload?.path || "").trim();
    const sheet = String(payload?.sheet || "").trim();
    const range = String(payload?.range || "").trim();
    if (!sheet || !range) {
      throw new Error("sheet and range are required.");
    }
    const resolvedPath = workbookPath ? path.resolve(workbookPath) : "";
    const script = `
$ErrorActionPreference = 'Stop'
$target = '${toSingleQuotedPs(resolvedPath)}'
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($null -eq $excel) { throw 'Excel is not running.' }
$workbook = $null
if ($target.Length -gt 0) {
  foreach ($wb in @($excel.Workbooks)) {
    if ($wb.FullName -eq $target) { $workbook = $wb; break }
  }
}
if ($null -eq $workbook) {
  try { $workbook = $excel.ActiveWorkbook } catch {}
}
if ($null -eq $workbook) { throw 'Workbook is not open.' }
$sheet = $workbook.Worksheets.Item('${toSingleQuotedPs(sheet)}')
$values = $sheet.Range('${toSingleQuotedPs(range)}').Value2
@{ ok = $true; values = $values } | ConvertTo-Json -Compress -Depth 8
`;
    return parseJsonStdout(script, 20000);
  }

  async function excelSetCell(payload: { path?: string; sheet?: string; cell?: string; value?: string | number }) {
    const workbookPath = String(payload?.path || "").trim();
    const sheet = String(payload?.sheet || "").trim();
    const cell = String(payload?.cell || "").trim();
    if (!sheet || !cell) {
      throw new Error("sheet and cell are required.");
    }
    const resolvedPath = workbookPath ? path.resolve(workbookPath) : "";
    const value = String(payload?.value ?? "");
    const script = `
$ErrorActionPreference = 'Stop'
$target = '${toSingleQuotedPs(resolvedPath)}'
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($null -eq $excel) { throw 'Excel is not running.' }
$workbook = $null
if ($target.Length -gt 0) {
  foreach ($wb in @($excel.Workbooks)) {
    if ($wb.FullName -eq $target) { $workbook = $wb; break }
  }
}
if ($null -eq $workbook) {
  try { $workbook = $excel.ActiveWorkbook } catch {}
}
if ($null -eq $workbook) { throw 'Workbook is not open.' }
$sheet = $workbook.Worksheets.Item('${toSingleQuotedPs(sheet)}')
$sheet.Range('${toSingleQuotedPs(cell)}').Value2 = '${toSingleQuotedPs(value)}'
[PSCustomObject]@{ ok = $true; cell = '${toSingleQuotedPs(cell)}'; value = '${toSingleQuotedPs(value)}' } | ConvertTo-Json -Compress
`;
    return parseJsonStdout(script, 20000);
  }

  async function excelWriteRange(payload: { path?: string; sheet?: string; startCell?: string; values?: any[][] }) {
    const workbookPath = String(payload?.path || "").trim();
    const sheet = String(payload?.sheet || "").trim();
    const startCell = String(payload?.startCell || "").trim();
    const values = Array.isArray(payload?.values) ? payload.values : [];
    if (!sheet || !startCell || !values.length) {
      throw new Error("sheet, startCell, and values are required.");
    }
    const resolvedPath = workbookPath ? path.resolve(workbookPath) : "";
    const jsonValues = JSON.stringify(values);
    const script = `
$ErrorActionPreference = 'Stop'
$target = '${toSingleQuotedPs(resolvedPath)}'
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($null -eq $excel) { throw 'Excel is not running.' }
$workbook = $null
if ($target.Length -gt 0) {
  foreach ($wb in @($excel.Workbooks)) {
    if ($wb.FullName -eq $target) { $workbook = $wb; break }
  }
}
if ($null -eq $workbook) {
  try { $workbook = $excel.ActiveWorkbook } catch {}
}
if ($null -eq $workbook) { throw 'Workbook is not open.' }
$sheet = $workbook.Worksheets.Item('${toSingleQuotedPs(sheet)}')
$start = $sheet.Range('${toSingleQuotedPs(startCell)}')
$rows = ConvertFrom-Json @'
${jsonValues}
'@
for ($r = 0; $r -lt $rows.Count; $r++) {
  $row = @($rows[$r])
  for ($c = 0; $c -lt $row.Count; $c++) {
    $start.Offset($r, $c).Value2 = [string]$row[$c]
  }
}
[PSCustomObject]@{ ok = $true; rows = $rows.Count; startCell = '${toSingleQuotedPs(startCell)}' } | ConvertTo-Json -Compress
`;
    return parseJsonStdout(script, 30000);
  }

  async function excelSaveWorkbook(payload: { path?: string; saveAsPath?: string }) {
    const workbookPath = String(payload?.path || "").trim();
    const resolvedPath = workbookPath ? path.resolve(workbookPath) : "";
    const saveAsPath = String(payload?.saveAsPath || "").trim();
    const resolvedSaveAs = saveAsPath ? path.resolve(saveAsPath) : "";
    const script = `
$ErrorActionPreference = 'Stop'
$target = '${toSingleQuotedPs(resolvedPath)}'
$saveAs = '${toSingleQuotedPs(resolvedSaveAs)}'
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($null -eq $excel) { throw 'Excel is not running.' }
$workbook = $null
if ($target.Length -gt 0) {
  foreach ($wb in @($excel.Workbooks)) {
    if ($wb.FullName -eq $target) { $workbook = $wb; break }
  }
}
if ($null -eq $workbook) {
  try { $workbook = $excel.ActiveWorkbook } catch {}
}
if ($null -eq $workbook) { throw 'Workbook is not open.' }
if ($saveAs.Length -gt 0) { $workbook.SaveAs($saveAs) } else { $workbook.Save() }
[PSCustomObject]@{ ok = $true; path = if ($saveAs.Length -gt 0) { $saveAs } else { $workbook.FullName } } | ConvertTo-Json -Compress
`;
    return parseJsonStdout(script, 30000);
  }

  async function excelCloseWorkbook(payload: { path?: string; saveChanges?: boolean }) {
    const workbookPath = String(payload?.path || "").trim();
    const resolvedPath = workbookPath ? path.resolve(workbookPath) : "";
    const saveChanges = payload?.saveChanges !== false;
    const script = `
$ErrorActionPreference = 'Stop'
$target = '${toSingleQuotedPs(resolvedPath)}'
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($null -eq $excel) { throw 'Excel is not running.' }
$workbook = $null
if ($target.Length -gt 0) {
  foreach ($wb in @($excel.Workbooks)) {
    if ($wb.FullName -eq $target) { $workbook = $wb; break }
  }
}
if ($null -eq $workbook) {
  try { $workbook = $excel.ActiveWorkbook } catch {}
}
if ($null -eq $workbook) { throw 'Workbook is not open.' }
$workbook.Close(${saveChanges ? "$true" : "$false"})
[PSCustomObject]@{ ok = $true; path = $target } | ConvertTo-Json -Compress
`;
    return parseJsonStdout(script, 20000);
  }

  return {
    launchApp,
    openPath,
    listWindows,
    focusWindow,
    getForegroundWindow,
    getForegroundUiTree,
    excelOpenWorkbook,
    excelReadRange,
    excelSetCell,
    excelWriteRange,
    excelSaveWorkbook,
    excelCloseWorkbook
  };
}

module.exports = {
  createDesktopAutomation
};
