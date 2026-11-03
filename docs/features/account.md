# Account (optional sign-in)

## Current state

Signing in is optional and the rest of the app works without it. The panel
says it is not Gen Con, says where the password goes and what happens to it,
and puts that warning above the fields. It never offers to remember the
password and never shows it. The form cannot be submitted empty or twice.
Errors blame the password only when it was the problem; a block is described
as a block; an unreachable server says the rest of the app still works. Once
signed in it greets by name, says when a page was only half read, and does not
claim to have signed the user out of Gen Con.

## User story

Alex only wants a schedule, not an account. They never open this panel and
nothing is lost. Later, Alex tries it, mistypes the password and is told so.
When the server is down the panel says plainly that everything else still
works.

## Planned change

None. Any future change must keep the app fully usable without signing in.

## Desired result

Sign-in is honest about where credentials go and never blocks the app.

## How to test

| ID | Behavior | Test |
|---|---|---|
| ACC-01 | Warning is shown first; says the app works without signing in | `src/components/AccountPanel.test.tsx`: `what it says before anybody types` |
| ACC-02 | Form validation and no double submit; password hidden | `AccountPanel.test.tsx`: `the form itself` |
| ACC-03 | Errors are accurate; server down keeps the app usable | `AccountPanel.test.tsx`: `telling somebody what went wrong` |
| ACC-04 | Signed-in view is honest about partial reads and sign-out | `AccountPanel.test.tsx`: `once signed in` |
