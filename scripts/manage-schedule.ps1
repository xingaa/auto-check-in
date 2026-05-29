param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("query", "apply", "delete")]
  [string]$Mode,

  [string]$TaskName = "AutoCheckin",

  [string]$DailyTime,

  [string]$TaskScriptPath,

  [string]$TaskKey
)

$ErrorActionPreference = "Stop"

function Write-JsonResult {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Value
  )

  $Value | ConvertTo-Json -Depth 6 -Compress
}

function Get-TaskPayload {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $task) {
    return @{
      exists = $false
      taskName = $Name
    }
  }

  $taskInfo = Get-ScheduledTaskInfo -TaskName $Name
  $trigger = $task.Triggers | Select-Object -First 1
  $action = $task.Actions | Select-Object -First 1

  $dailyTime = $null
  if ($trigger -and $trigger.StartBoundary) {
    try {
      $dailyTime = ([datetime]$trigger.StartBoundary).ToString("HH:mm")
    } catch {
      $dailyTime = $null
    }
  }

  $lastRunTime = $null
  if ($taskInfo.LastRunTime -and $taskInfo.LastRunTime.Year -gt 1900) {
    $lastRunTime = $taskInfo.LastRunTime.ToString("s")
  }

  $nextRunTime = $null
  if ($taskInfo.NextRunTime -and $taskInfo.NextRunTime.Year -gt 1900) {
    $nextRunTime = $taskInfo.NextRunTime.ToString("s")
  }

  return @{
    exists = $true
    taskName = $task.TaskName
    state = [string]$task.State
    enabled = ([string]$task.State -ne "Disabled")
    dailyTime = $dailyTime
    lastRunTime = $lastRunTime
    nextRunTime = $nextRunTime
    lastTaskResult = $taskInfo.LastTaskResult
    actionExecute = $action.Execute
    actionArguments = $action.Arguments
    taskPath = $task.TaskPath
  }
}

switch ($Mode) {
  "query" {
    Write-Output (Write-JsonResult -Value (Get-TaskPayload -Name $TaskName))
  }

  "apply" {
    if (-not $DailyTime) {
      throw "DailyTime is required for apply mode."
    }

    if (-not $TaskScriptPath) {
      throw "TaskScriptPath is required for apply mode."
    }

    if (-not (Test-Path -LiteralPath $TaskScriptPath)) {
      throw "Task script not found: $TaskScriptPath"
    }

    $parsedTime = [datetime]::ParseExact($DailyTime, "HH:mm", $null)
    $actionArguments = "-ExecutionPolicy Bypass -File ""{0}""" -f $TaskScriptPath
    if ($TaskKey) {
      $actionArguments += " -TaskKey ""{0}""" -f $TaskKey
    }

    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArguments
    $trigger = New-ScheduledTaskTrigger -Daily -At $parsedTime
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
    $description = "Auto check-in task managed by auto-checkin web UI"

    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Description $description `
      -Force | Out-Null

    Write-Output (Write-JsonResult -Value (Get-TaskPayload -Name $TaskName))
  }

  "delete" {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
      Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }

    Write-Output (Write-JsonResult -Value @{
      ok = $true
      deleted = $true
      taskName = $TaskName
    })
  }
}
