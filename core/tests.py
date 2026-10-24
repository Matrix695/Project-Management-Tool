import json

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.test import Client, TestCase, TransactionTestCase

from .models import Comment, Notification, Project, ProjectMembership, Task, User
from trackit.asgi import application


class TrackItApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="admin@example.test",
            password="a-safe-password",
            name="Project Admin",
            role="admin",
        )
        self.crew = User.objects.create_user(
            email="crew@example.test",
            password="a-safe-password",
            name="Crew Member",
            role="crew",
        )
        self.project = Project.objects.create(name="Launch", owner=self.admin)
        ProjectMembership.objects.create(project=self.project, user=self.admin)
        ProjectMembership.objects.create(project=self.project, user=self.crew)
        self.task = Task.objects.create(
            project=self.project,
            title="Prepare launch",
            assignee=self.crew,
        )
        self.admin_client = Client()
        self.crew_client = Client()

    @staticmethod
    def post(client, path, payload):
        return client.post(path, data=json.dumps(payload), content_type="application/json")

    @staticmethod
    def patch(client, path, payload):
        return client.patch(path, data=json.dumps(payload), content_type="application/json")

    def test_authentication_and_role_checked_workspaces(self):
        response = self.admin_client.get("/api/projects")
        self.assertEqual(response.status_code, 401)

        wrong_role = self.post(
            self.admin_client,
            "/api/auth/login",
            {"email": self.admin.email, "password": "a-safe-password", "role": "crew"},
        )
        self.assertEqual(wrong_role.status_code, 403)

        login_response = self.post(
            self.admin_client,
            "/api/auth/login",
            {"email": self.admin.email, "password": "a-safe-password", "role": "admin"},
        )
        self.assertEqual(login_response.status_code, 200)
        self.assertEqual(login_response.json()["user"]["role"], "admin")
        projects = self.admin_client.get("/api/projects").json()["projects"]
        self.assertEqual(projects[0]["ownerId"], str(self.admin.pk))

        self.post(
            self.crew_client,
            "/api/auth/login",
            {"email": self.crew.email, "password": "a-safe-password", "role": "crew"},
        )
        denied = self.crew_client.get(f"/api/projects/{self.project.pk}/admin")
        self.assertEqual(denied.status_code, 403)

    def test_task_updates_comments_and_notifications_use_relational_data(self):
        self.post(
            self.admin_client,
            "/api/auth/login",
            {"email": self.admin.email, "password": "a-safe-password", "role": "admin"},
        )
        updated = self.patch(
            self.admin_client,
            f"/api/tasks/{self.task.pk}",
            {"status": "In progress", "assigneeId": str(self.crew.pk)},
        )
        self.assertEqual(updated.status_code, 200)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, "In progress")
        self.assertEqual(self.task.assignee_id, self.crew.pk)
        dashboard = self.admin_client.get(f"/api/projects/{self.project.pk}/admin").json()
        self.assertEqual(dashboard["summary"]["taskCount"], 1)
        self.assertEqual(dashboard["summary"]["statusCounts"]["In progress"], 1)

        comment = self.post(
            self.crew_client,
            "/api/auth/login",
            {"email": self.crew.email, "password": "a-safe-password", "role": "crew"},
        )
        self.assertEqual(comment.status_code, 200)
        comment = self.post(
            self.crew_client,
            f"/api/tasks/{self.task.pk}/comments",
            {"body": "Progress update"},
        )
        self.assertEqual(comment.status_code, 201)
        self.assertEqual(Comment.objects.get().body, "Progress update")
        self.assertEqual(Notification.objects.filter(user=self.admin).count(), 1)

    def test_registration_validation_and_session_cookie(self):
        response = self.post(
            Client(),
            "/api/auth/register",
            {
                "name": "New Person",
                "email": "new@example.test",
                "password": "a-strong-password-27",
                "role": "crew",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.cookies["sessionid"]["httponly"])
        self.assertEqual(response.json()["user"]["availability"], "available")

        duplicate = self.post(
            Client(),
            "/api/auth/register",
            {
                "name": "Duplicate",
                "email": "ADMIN@example.test",
                "password": "a-strong-password-27",
                "role": "crew",
            },
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_available_crew_and_assignment_permissions(self):
        self.post(
            self.admin_client,
            "/api/auth/login",
            {"email": self.admin.email, "password": "a-safe-password", "role": "admin"},
        )
        unavailable = User.objects.create_user(
            email="away@example.test",
            password="a-safe-password",
            name="Away Member",
            role="crew",
            availability="unavailable",
        )
        candidate = User.objects.create_user(
            email="candidate@example.test",
            password="a-safe-password",
            name="Available Candidate",
            role="crew",
        )
        available = self.admin_client.get(
            f"/api/projects/{self.project.pk}/available-crew"
        ).json()["crew"]
        self.assertFalse(any(user["id"] == str(self.crew.pk) for user in available))
        self.assertFalse(any(user["id"] == str(unavailable.pk) for user in available))
        self.assertTrue(any(user["id"] == str(candidate.pk) for user in available))
        added = self.post(
            self.admin_client,
            f"/api/projects/{self.project.pk}/members",
            {"userId": str(candidate.pk)},
        )
        self.assertEqual(added.status_code, 201)
        self.assertTrue(
            Notification.objects.filter(user=candidate, type="member").exists()
        )

        self.post(
            self.crew_client,
            "/api/auth/login",
            {"email": self.crew.email, "password": "a-safe-password", "role": "crew"},
        )
        denied = self.patch(
            self.crew_client,
            f"/api/tasks/{self.task.pk}",
            {"assigneeId": None},
        )
        self.assertEqual(denied.status_code, 403)
        self.task.refresh_from_db()
        self.assertEqual(self.task.assignee_id, self.crew.pk)

    def test_admin_can_create_project_tasks_and_view_completion(self):
        self.post(
            self.admin_client,
            "/api/auth/login",
            {"email": self.admin.email, "password": "a-safe-password", "role": "admin"},
        )
        created_project = self.post(
            self.admin_client,
            "/api/projects",
            {"name": "New workspace", "description": "A fresh project", "color": "#F7B267"},
        )
        self.assertEqual(created_project.status_code, 201)
        project = created_project.json()["project"]
        self.assertEqual(project["color"], "#F7B267")
        self.assertIn(str(self.admin.pk), project["memberIds"])

        created_task = self.post(
            self.admin_client,
            f"/api/projects/{project['id']}/tasks",
            {"title": "First task"},
        )
        self.assertEqual(created_task.status_code, 201)
        task = created_task.json()["task"]
        self.assertEqual(task["status"], "Backlog")
        completed = self.patch(
            self.admin_client,
            f"/api/tasks/{task['id']}",
            {"status": "Done", "dueDate": "2026-12-20"},
        )
        self.assertEqual(completed.status_code, 200)
        dashboard = self.admin_client.get(
            f"/api/projects/{project['id']}/admin"
        ).json()
        self.assertEqual(dashboard["summary"]["progress"], 100)
        self.assertEqual(dashboard["summary"]["completedCount"], 1)

    def test_home_page_sets_csrf_cookie_and_serves_trackit_branding(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("TrackIt", response.content.decode())
        self.assertIn("csrftoken", response.cookies)

    def test_api_requires_csrf_token_for_session_mutations(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/")
        payload = {
            "email": self.admin.email,
            "password": "a-safe-password",
            "role": "admin",
        }
        rejected = self.post(client, "/api/auth/login", payload)
        self.assertEqual(rejected.status_code, 403)
        token = client.cookies["csrftoken"].value
        accepted = client.post(
            "/api/auth/login",
            data=json.dumps(payload),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(accepted.status_code, 200)


class TrackItWebSocketTests(TransactionTestCase):
    def test_authenticated_member_receives_project_activity(self):
        admin = User.objects.create_user(
            email="socket-admin@example.test",
            password="a-safe-password",
            name="Socket Admin",
            role="admin",
        )
        project = Project.objects.create(name="Live work", owner=admin)
        ProjectMembership.objects.create(project=project, user=admin)
        client = Client()
        response = client.post(
            "/api/auth/login",
            data=json.dumps(
                {
                    "email": admin.email,
                    "password": "a-safe-password",
                    "role": "admin",
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        session_id = client.cookies["sessionid"].value
        communicator = WebsocketCommunicator(
            application,
            "/ws",
            headers=[
                (b"cookie", f"sessionid={session_id}".encode()),
                (b"origin", b"http://localhost"),
            ],
        )
        event = {
            "projectId": str(project.pk),
            "message": "created “First task”",
            "type": "task",
            "actorName": admin.name,
        }
        expected_message = {
            "type": "activity",
            "eventType": "task",
            "projectId": str(project.pk),
            "message": "created “First task”",
            "actorName": admin.name,
        }

        async def exercise():
            connected, _ = await communicator.connect()
            self.assertTrue(connected)
            await get_channel_layer().group_send(
                f"project_{project.pk}",
                {"type": "activity.message", "event": event},
            )
            message = await communicator.receive_json_from()
            self.assertEqual(message, expected_message)
            await communicator.disconnect()

        async_to_sync(exercise)()
