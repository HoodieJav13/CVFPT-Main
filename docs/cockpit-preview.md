# Fictional Coaching Cockpit

Off by default. To use it locally, run the normal fictional development mode with `REACT_APP_PT_COCKPIT=true npm run dev:preview -- --host 127.0.0.1` in `frontend`. The flag does not enable fictional mode or alter role protection. A Vercel production build removes the feature even if preview and cockpit flags are supplied.

Coach/admin fixture roles see the desktop replay board, temporary triage actions, device-local fictional notes and template exercises, and a fictional phone view. The client fixture role sees its fictional phone view. Live is an unavailable notice, not a connection to the server. No cockpit API or schema changes are needed.
