# TrackIt

TrackIt is a project and task management app for teams. It keeps project boards, assignments, team availability, task discussions, notifications, and owner reporting in one workspace.

## Stack

- Django and Django ORM
- SQLite by default (the database is created as `db.sqlite3`)
- Django sessions and password hashing for account authentication
- Django Channels for authenticated live project activity
- HTML, CSS, and JavaScript frontend

## Run locally

Requires Python 3.10 or newer.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

Open <http://127.0.0.1:8000>.

### Demo accounts

- Project admin: `alex@trackit.test` / `trackitdemo`
- Crew members: `maya@trackit.test` / `trackitdemo` and `jordan@trackit.test` / `trackitdemo`

Select the matching role when signing in. Admins create projects, add available crew members, assign tasks, and review team progress. Crew members update tasks in their assigned projects and set their availability.

## Features

- Account registration, role-aware sign-in, and HTTP-only Django session cookies
- Project workspaces with project membership and team availability
- Task boards and list views, search, filtering, priorities, assignees, and due dates
- Personal and project completion tracking
- Owner dashboard with task-status summaries, overdue work, and items needing attention
- Task comments and per-user notifications
- Authenticated live project activity over WebSockets
- Django ORM models and migrations for users, projects, memberships, tasks, comments, and notifications

The default database is SQLite for simple local development. Set `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=0`, and `DJANGO_ALLOWED_HOSTS` for deployment, and use an ASGI server to retain WebSocket support:

```powershell
python manage.py collectstatic --noinput
daphne -b 0.0.0.0 -p 8000 trackit.asgi:application
```

The default in-memory Channels layer is intended for a single application process. Use a shared channel layer such as Redis when running multiple ASGI workers.
