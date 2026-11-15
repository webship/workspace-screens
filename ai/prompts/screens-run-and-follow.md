Run one command of a workspace folder in a screen session, follow it to the end, and report how it went.

```
claude --permission-mode bypassPermissions """
Run this in a screen session in the folder <folder> and follow it: bash <command> <project> <flags>
# ~/workspace/<folder> · container-based (DDEV by default) · the session goes on if this conversation ends
# stop or remove no session but the one you start here; never attach: that is for me, at a terminal

1. cd ~/workspace/<folder> ; bash cmd-tools-screens.sh --check
   if screen is not installed here, stop and tell me what it says
2. bash cmd-tools-screens.sh --list
   if a session for <project> is already running, stop and tell me its name
3. bash cmd-tools-screens.sh --run "bash <command> <project> <flags>" --project <project>
   tell me the name of the session and the attach line it printed
4. bash cmd-tools-screens.sh <session> --follow
5. bash cmd-tools-screens.sh <session> --log --lines 40

When it has ended: the exit code, what the last lines say, and where the log is.
An exit code other than 0 is a result: tell me what failed, and do not run it again.
"""
```

The text between the triple quotes is plain: it can be given to another AI command-line assistant as it is.
