import json
import re
from datetime import date
from functools import wraps

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import Http404, JsonResponse
from django.shortcuts import get_object_or_404, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods, require_POST

from .models import Comment, Notification, Project, ProjectMembership, Task, User


STATUSES = ("Backlog", "In progress", "Review", "Done")
PRIORITIES = ("Low", "Medium", "High")


def percentage(part, total):
    return int(part * 100 / total + 0.5) if total else 0


class ApiError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def json_body(request):
    content_length = int(request.META.get("CONTENT_LENGTH") or 0)
    if content_length > 1_000_000:
        raise ApiError(413, "Request body is too large.")
    try:
        body = json.loads(request.body or b"{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError(400, "Request body must be valid JSON.") from None
    if not isinstance(body, dict):
        raise ApiError(400, "Request body must be a JSON object.")
    return body


def api_view(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            response = view(request, *args, **kwargs)
        except ApiError as error:
            response = JsonResponse({"error": error.message}, status=error.status)
        except Http404:
            response = JsonResponse({"error": "Not found."}, status=404)
        except IntegrityError:
            response = JsonResponse({"error": "An account with that email already exists."}, status=409)
        response["Cache-Control"] = "no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    return wrapped


def authenticated(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Please sign in to continue."}, status=401)
        return view(request, *args, **kwargs)

    return wrapped


def require_string(value, field, max_length=180):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_length:
        raise ApiError(400, f"{field} is required and must be under {max_length} characters.")
    return value.strip()


def public_user(user):
    return {
        "id": str(user.pk),
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "availability": user.availability,
    }


def serialize_project(project):
    return {
        "id": str(project.pk),
        "name": project.name,
        "description": project.description,
        "color": project.color,
        "ownerId": str(project.owner_id),
        "memberIds": [str(member_id) for member_id in project.members.values_list("pk", flat=True)],
        "members": [public_user(member) for member in project.members.all()],
        "taskCount": project.tasks.count(),
        "createdAt": project.created_at.isoformat(),
    }


def serialize_task(task):
    return {
        "id": str(task.pk),
        "projectId": str(task.project_id),
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "assigneeId": str(task.assignee_id) if task.assignee_id else None,
        "assignee": public_user(task.assignee) if task.assignee_id else None,
        "dueDate": task.due_date.isoformat() if task.due_date else "",
        "createdAt": task.created_at.isoformat(),
        "comments": task.comments.count(),
    }


def project_for_member(project_id, user):
    project = get_object_or_404(Project, pk=project_id)
    if not project.members.filter(pk=user.pk).exists():
        raise ApiError(403, "You are not a member of this project.")
    return project


def task_for_member(task_id, user):
    task = get_object_or_404(Task.objects.select_related("project", "assignee"), pk=task_id)
    project = project_for_member(task.project_id, user)
    return task, project


def broadcast(project_id, event, user_ids=()):
    channel_layer = get_channel_layer()
    message = {"type": "activity.message", "event": event}
    group_send = async_to_sync(channel_layer.group_send)
    group_send(f"project_{project_id}", message)
    for user_id in user_ids:
        group_send(f"user_{user_id}", message)


def notify(project, actor, message, event_type, target_user_ids=None):
    if target_user_ids is None:
        target_user_ids = list(project.members.values_list("pk", flat=True))
    Notification.objects.bulk_create(
        [
            Notification(
                user_id=user_id,
                project=project,
                actor=actor,
                message=message,
                type=event_type,
            )
            for user_id in target_user_ids
            if user_id != actor.pk
        ]
    )
    return {
        "projectId": str(project.pk),
        "message": message,
        "type": event_type,
        "actorName": actor.name,
    }


@ensure_csrf_cookie
def index(request):
    return render(request, "core/index.html")


@api_view
@require_POST
def register(request):
    body = json_body(request)
    name = require_string(body.get("name"), "Name")
    email = require_string(body.get("email"), "Email", 254).lower()
    password = require_string(body.get("password"), "Password", 128)
    role = body.get("role")
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise ApiError(400, "Enter a valid email address.")
    if len(password) < 8:
        raise ApiError(400, "Password must be at least 8 characters.")
    if role not in ("admin", "crew"):
        raise ApiError(400, "Choose Admin or Crew member.")
    try:
        validate_password(password)
    except ValidationError as error:
        raise ApiError(400, " ".join(error.messages)) from None
    if User.objects.filter(email__iexact=email).exists():
        raise ApiError(409, "An account with that email already exists.")
    user = User.objects.create_user(email=email, password=password, name=name, role=role)
    login(request, user)
    return JsonResponse({"user": public_user(user)}, status=201)


@api_view
@require_POST
def login_user(request):
    body = json_body(request)
    email = require_string(body.get("email"), "Email", 254).lower()
    password = require_string(body.get("password"), "Password", 128)
    role = body.get("role")
    if role not in ("admin", "crew"):
        raise ApiError(400, "Choose Admin or Crew member.")
    user = authenticate(request, email=email, password=password)
    if user is None:
        raise ApiError(401, "Email or password is incorrect.")
    if user.role != role:
        user_type = "project admin" if user.role == "admin" else "crew member"
        raise ApiError(
            403,
            f"This account is registered as a {user_type}. Choose the matching sign-in option.",
        )
    login(request, user)
    return JsonResponse({"user": public_user(user)})


@api_view
@require_POST
def logout_user(request):
    if request.user.is_authenticated:
        async_to_sync(get_channel_layer().group_send)(
            f"user_{request.user.pk}", {"type": "force.close"}
        )
    logout(request)
    return JsonResponse({"ok": True})


@api_view
@authenticated
@require_http_methods(["GET"])
def me(request):
    return JsonResponse({"user": public_user(request.user)})


@api_view
@authenticated
@require_http_methods(["PATCH"])
def availability(request):
    user = request.user
    if user.role != "crew":
        raise ApiError(403, "Only crew members can change their availability.")
    availability_value = json_body(request).get("availability")
    if availability_value not in ("available", "unavailable"):
        raise ApiError(400, "Choose available or unavailable.")
    user.availability = availability_value
    user.save(update_fields=("availability",))
    for project_id in user.projects.values_list("pk", flat=True):
        broadcast(
            project_id,
            {
                "projectId": str(project_id),
                "actorName": user.name,
                "message": f"is {user.availability}",
                "type": "availability",
            },
        )
    return JsonResponse({"user": public_user(user)})


@api_view
@authenticated
@require_http_methods(["GET", "POST"])
def projects(request):
    if request.method == "GET":
        visible = (
            Project.objects.filter(members=request.user)
            .prefetch_related("members")
            .order_by("created_at")
        )
        return JsonResponse({"projects": [serialize_project(project) for project in visible]})
    if request.user.role != "admin":
        raise ApiError(403, "Only project admins can create projects.")
    body = json_body(request)
    name = require_string(body.get("name"), "Project name")
    description = body.get("description", "")
    if not isinstance(description, str):
        description = ""
    color = body.get("color")
    if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        color = "#0F766E"
    with transaction.atomic():
        project = Project.objects.create(
            name=name,
            description=description.strip()[:1000],
            color=color,
            owner=request.user,
        )
        ProjectMembership.objects.create(project=project, user=request.user)
    return JsonResponse({"project": serialize_project(project)}, status=201)


@api_view
@authenticated
@require_http_methods(["GET"])
def project_admin(request, project_id):
    project = project_for_member(project_id, request.user)
    if project.owner_id != request.user.pk:
        raise ApiError(403, "Only the project admin can view project oversight.")
    tasks = list(project.tasks.select_related("assignee").order_by("-created_at"))
    today = timezone.localdate()
    status_counts = {status: sum(task.status == status for task in tasks) for status in STATUSES}
    overdue = [
        task for task in tasks if task.due_date and task.due_date < today and task.status != "Done"
    ]
    attention = []
    for task in tasks:
        reasons = []
        if task.status == "Review":
            reasons.append("Awaiting review")
        if task.assignee_id is None and task.status != "Done":
            reasons.append("Unassigned")
        if task.due_date and task.due_date < today and task.status != "Done":
            reasons.append("Overdue")
        if reasons:
            attention.append({**serialize_task(task), "reasons": reasons})
    attention.sort(
        key=lambda task: (
            "Overdue" not in task["reasons"],
            task["dueDate"] or "9999-12-31",
        )
    )
    members = []
    for member in project.members.all():
        assigned = [task for task in tasks if task.assignee_id == member.pk]
        completed = sum(task.status == "Done" for task in assigned)
        members.append(
            {
                **public_user(member),
                "taskCount": len(assigned),
                "completedCount": completed,
                "progress": percentage(completed, len(assigned)),
                "overdueCount": sum(
                    bool(task.due_date and task.due_date < today and task.status != "Done")
                    for task in assigned
                ),
            }
        )
    task_count = len(tasks)
    return JsonResponse(
        {
            "summary": {
                "taskCount": task_count,
                "completedCount": status_counts["Done"],
                "progress": percentage(status_counts["Done"], task_count),
                "statusCounts": status_counts,
                "overdueCount": len(overdue),
                "unassignedCount": sum(
                    task.assignee_id is None and task.status != "Done" for task in tasks
                ),
                "reviewCount": status_counts["Review"],
            },
            "members": members,
            "attentionTasks": attention[:8],
        }
    )


@api_view
@authenticated
@require_http_methods(["GET"])
def notifications(request):
    items = (
        Notification.objects.filter(user=request.user)
        .select_related("actor", "project")
        .order_by("-created_at")[:40]
    )
    return JsonResponse(
        {
            "notifications": [
                {
                    "id": str(item.pk),
                    "userId": str(item.user_id),
                    "projectId": str(item.project_id),
                    "projectName": item.project.name,
                    "actorId": item.actor_id,
                    "actorName": item.actor.name,
                    "message": item.message,
                    "type": item.type,
                    "read": item.read,
                    "createdAt": item.created_at.isoformat(),
                }
                for item in items
            ]
        }
    )


@api_view
@authenticated
@require_http_methods(["PATCH"])
def read_notifications(request):
    Notification.objects.filter(user=request.user).update(read=True)
    return JsonResponse({"ok": True})


@api_view
@authenticated
@require_http_methods(["GET"])
def available_crew(request, project_id):
    project = project_for_member(project_id, request.user)
    if project.owner_id != request.user.pk:
        raise ApiError(403, "Only the project admin can manage crew members.")
    crew = User.objects.filter(role="crew", availability="available").exclude(
        projects=project
    )
    return JsonResponse({"crew": [public_user(user) for user in crew]})


@api_view
@authenticated
@require_POST
def add_member(request, project_id):
    project = project_for_member(project_id, request.user)
    if project.owner_id != request.user.pk:
        raise ApiError(403, "Only the project admin can assign crew members.")
    user_id = json_body(request).get("userId")
    try:
        invitee = User.objects.get(pk=int(user_id), role="crew")
    except (TypeError, ValueError, User.DoesNotExist):
        raise ApiError(404, "Choose an available crew member.") from None
    if invitee.availability != "available":
        raise ApiError(409, "That crew member is currently unavailable.")
    if project.members.filter(pk=invitee.pk).exists():
        raise ApiError(409, "That person is already on this project.")
    ProjectMembership.objects.create(project=project, user=invitee)
    event = notify(
        project,
        request.user,
        f"added {invitee.name} to {project.name}",
        "member",
        [invitee.pk],
    )
    broadcast(project.pk, event, [invitee.pk])
    members = [public_user(member) for member in project.members.all()]
    return JsonResponse({"members": members}, status=201)


@api_view
@authenticated
@require_http_methods(["GET", "POST"])
def project_tasks(request, project_id):
    project = project_for_member(project_id, request.user)
    if request.method == "GET":
        tasks = project.tasks.select_related("assignee").order_by("-created_at")
        return JsonResponse(
            {
                "tasks": [serialize_task(task) for task in tasks],
                "members": [public_user(member) for member in project.members.all()],
            }
        )
    body = json_body(request)
    title = require_string(body.get("title"), "Task title")
    status = body.get("status", "Backlog")
    priority = body.get("priority", "Medium")
    if status not in STATUSES:
        status = "Backlog"
    if priority not in PRIORITIES:
        priority = "Medium"
    description = body.get("description", "")
    if not isinstance(description, str):
        description = ""
    task = Task.objects.create(
        project=project,
        title=title,
        description=description.strip()[:4000],
        status=status,
        priority=priority,
    )
    event = notify(project, request.user, f"created “{task.title}”", "task")
    broadcast(project.pk, event)
    return JsonResponse({"task": serialize_task(task)}, status=201)


@api_view
@authenticated
@require_http_methods(["PATCH"])
def task_detail(request, task_id):
    task, project = task_for_member(task_id, request.user)
    body = json_body(request)
    allowed = {"title", "description", "status", "priority", "assigneeId", "dueDate"}
    extra = set(body) - allowed
    if extra:
        raise ApiError(400, f"Cannot update {sorted(extra)[0]}.")
    if "title" in body:
        task.title = require_string(body["title"], "Task title")
    if "description" in body:
        description = body["description"]
        if not isinstance(description, str) or len(description) > 4000:
            raise ApiError(400, "Description must be under 4000 characters.")
        task.description = description.strip()
    if "status" in body:
        if body["status"] not in STATUSES:
            raise ApiError(400, "Choose a valid task status.")
        task.status = body["status"]
    if "priority" in body:
        if body["priority"] not in PRIORITIES:
            raise ApiError(400, "Choose a valid task priority.")
        task.priority = body["priority"]
    if "assigneeId" in body:
        if project.owner_id != request.user.pk:
            raise ApiError(403, "Only the project admin can assign tasks.")
        assignee_id = body["assigneeId"]
        if assignee_id is None:
            task.assignee = None
        else:
            try:
                assignee = User.objects.get(pk=int(assignee_id))
            except (TypeError, ValueError, User.DoesNotExist):
                raise ApiError(400, "Tasks can only be assigned to crew members.") from None
            if assignee.role != "crew":
                raise ApiError(400, "Tasks can only be assigned to crew members.")
            if assignee.availability != "available" and assignee.pk != task.assignee_id:
                raise ApiError(400, "Choose a crew member who is currently available.")
            if not project.members.filter(pk=assignee.pk).exists():
                raise ApiError(400, "Assignees must be project members.")
            task.assignee = assignee
    if "dueDate" in body:
        due_date = body["dueDate"]
        if not isinstance(due_date, str) or (
            due_date and (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date))
        ):
            raise ApiError(400, "Choose a valid due date.")
        try:
            task.due_date = date.fromisoformat(due_date) if due_date else None
        except ValueError:
            raise ApiError(400, "Choose a valid due date.") from None
    task.save()
    event = None
    if "assigneeId" in body and task.assignee_id and task.assignee_id != request.user.pk:
        event = notify(
            project,
            request.user,
            f"assigned “{task.title}” to {task.assignee.name}",
            "assignment",
            [task.assignee_id],
        )
    elif "status" in body:
        event = notify(project, request.user, f"moved “{task.title}” to {task.status}", "status")
    elif set(body) & {"title", "description", "priority", "dueDate"}:
        event = notify(project, request.user, f"updated “{task.title}”", "task")
    if event:
        broadcast(project.pk, event)
    return JsonResponse({"task": serialize_task(task)})


@api_view
@authenticated
@require_http_methods(["GET", "POST"])
def task_comments(request, task_id):
    task, project = task_for_member(task_id, request.user)
    if request.method == "GET":
        comments = task.comments.select_related("user").order_by("created_at")
        return JsonResponse(
            {
                "comments": [
                    {
                        "id": str(comment.pk),
                        "taskId": str(comment.task_id),
                        "userId": str(comment.user_id),
                        "body": comment.body,
                        "createdAt": comment.created_at.isoformat(),
                        "user": public_user(comment.user),
                    }
                    for comment in comments
                ]
            }
        )
    body = json_body(request)
    comment = Comment.objects.create(
        task=task,
        user=request.user,
        body=require_string(body.get("body"), "Comment", 2000),
    )
    event = notify(project, request.user, f"commented on “{task.title}”", "comment")
    broadcast(project.pk, event)
    return JsonResponse(
        {
            "comment": {
                "id": str(comment.pk),
                "taskId": str(comment.task_id),
                "userId": str(comment.user_id),
                "body": comment.body,
                "createdAt": comment.created_at.isoformat(),
                "user": public_user(request.user),
            }
        },
        status=201,
    )
