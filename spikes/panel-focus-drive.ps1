Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class U { 
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,UIntPtr e);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
public static string FG(){var sb=new StringBuilder(256);IntPtr h=GetForegroundWindow();GetWindowText(h,sb,256);return h.ToString()+" '"+sb+"'";}
}
"@
Set-Location (Split-Path $PSScriptRoot -Parent)
$pre = @(Get-Process notepad -ErrorAction SilentlyContinue | % { $_.Id })
$np = Start-Process notepad.exe -PassThru
Start-Sleep 3
$mine = @(Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $pre -notcontains $_.Id })
$npAll = $mine | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($npAll) { [U]::SetForegroundWindow($npAll.MainWindowHandle) | Out-Null }
$out = Join-Path $env:TEMP "pf-out.txt"; Remove-Item $out -ErrorAction SilentlyContinue
$el = Start-Process cmd.exe -ArgumentList "/c npx electron spikes/panel-focus.mjs > `"$out`" 2>&1" -PassThru -WindowStyle Hidden
$center=$null
for($i=0;$i -lt 60 -and -not $center;$i++){ Start-Sleep -Milliseconds 500; if(Test-Path $out){ $m=Select-String -Path $out -Pattern 'centerPhysical=(\d+),(\d+)'; if($m){$center=@([int]$m.Matches[0].Groups[1].Value,[int]$m.Matches[0].Groups[2].Value)} } }
if(-not $center){ "NO READY"; Get-Content $out; exit 1 }
Start-Sleep 1
if ($npAll) { [U]::SetForegroundWindow($npAll.MainWindowHandle) | Out-Null }; Start-Sleep -Milliseconds 500
"BEFORE: " + [U]::FG()
[U]::SetCursorPos($center[0],$center[1]) | Out-Null; Start-Sleep -Milliseconds 300
[U]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [U]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 800
"AFTER:  " + [U]::FG()
Start-Sleep 1
Get-Content $out
Start-Sleep 20
Get-Content $out | Select-String 'CLICKED|FOCUSED' | ForEach-Object { "FINAL: $_" }
$mine | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }  # only Notepad PIDs this script started
