# Linux

meanwhile supports URL opening, X11 window control, desktop notifications, and a completion sound on Linux. Each feature depends on the corresponding command being available on `PATH`.

## Browser opening

For `browser: "auto"` and `browser: "default"`, meanwhile runs:

```sh
xdg-open <url>
```

For `browser: "chrome"`, it tries `google-chrome`, then `chromium`, then falls back to `xdg-open`.

Linux browser launchers do not expose the Chrome tab lookup used on macOS. meanwhile cannot focus an existing matching tab, so opening the URL may create a duplicate tab.

## X11 window control

Window detection and activation work only when `DISPLAY` is set and `WAYLAND_DISPLAY` is unset.

meanwhile reads the active window with `xdotool` and reads its `WM_CLASS` with `xprop`. It activates the saved class with `wmctrl -x -a`. If `wmctrl` is missing, it falls back to `xdotool search --class` and `xdotool windowactivate`.

Install the relevant packages through your distribution if these commands are missing. Run `meanwhile status` to see what is on `PATH`.

## Wayland

`wmctrl` and `xdotool` do not provide Wayland window control. Under Wayland, meanwhile does not read the foreground window and does not try to reactivate an application. It still opens the configured URL and can use `notify-send`.

This is an explicit no-op, not simulated focus control.

## Notifications and sound

Notifications use:

```sh
notify-send <title> <body>
```

The completion sound uses:

```sh
paplay /usr/share/sounds/freedesktop/stereo/complete.oga
```

If a command is missing or fails, meanwhile logs the limitation and continues. Hook execution does not fail.
