# macOS Automation permission

meanwhile uses macOS Automation to identify the frontmost app and activate a coding app later. It does not use Accessibility.

## First-run dialog

1. Install meanwhile and submit a prompt that runs longer than `delaySeconds`.
2. The confirmation timer runs in the background.
3. When it fires (about 20 seconds with the default config), macOS may show an Automation dialog.
4. The dialog names a controlling app and target, commonly your terminal/host app and System Events or the app being reactivated.
5. Click **OK**.

Consent is remembered per controlling-app/target-app pair. A different terminal, browser path, or coding host may receive its own one-time dialog.

The delay before the first dialog is expected: no Apple event is sent until the background confirmation timer actually hands you off.

## If you clicked Deny

The configured URL may still open, but meanwhile may be unable to capture or reactivate the previous app.

To re-enable it:

1. Open **System Settings**.
2. Go to **Privacy & Security → Automation**.
3. Find the terminal or host app that ran meanwhile.
4. Enable the relevant target, such as System Events or your coding app.
5. Run `meanwhile status`, then try another prompt longer than the configured delay.

If the host is absent from the list, run a long prompt again so macOS can request consent.

The status probe reports `denied` only when macOS returns a recognizable
Automation authorization error. Missing tools and other failures are reported
as `inconclusive`; on Linux and other non-macOS hosts the probe is `not
applicable`.

## Accessibility is not required

meanwhile never sends keystrokes, clicks UI controls, or reads screen contents. Do not grant Accessibility access for meanwhile. URL opening uses the system `open` command; app detection and reactivation use Apple events.
