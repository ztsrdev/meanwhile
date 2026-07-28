# Windows

Windows support is experimental. URL opening works through the system shell. Reading the foreground process and activating it later use Windows APIs through PowerShell.

## Browser opening

meanwhile opens the configured URL with:

```text
cmd /c start "" <url>
```

The configured `browser` preference does not select a specific Windows browser. Windows uses the registered URL handler.

There is no tab lookup on Windows. meanwhile cannot focus an existing matching browser tab, so opening the URL may create a duplicate tab.

## Foreground process

meanwhile uses a PowerShell `Add-Type` call for `GetForegroundWindow` and `GetWindowThreadProcessId`, then stores the foreground process name.

If PowerShell or the API call fails, meanwhile records no previous application. It does not invent a fallback target.

## Application activation

meanwhile asks `WScript.Shell.AppActivate` to activate the stored process name.

Windows restricts which processes may move a window to the foreground. `AppActivate` is best effort and may silently leave the current window in front. meanwhile cannot promise that pull-back will succeed.

## Notifications and sound

The experimental Windows layer does not send notifications or play a sound. Common PowerShell toast approaches require modules that meanwhile does not depend on. These actions are logged as no-ops.

Run `meanwhile status` to confirm that the experimental Windows platform was selected.
