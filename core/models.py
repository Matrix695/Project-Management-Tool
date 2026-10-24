from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(email=self.normalize_email(email), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("A superuser must have staff and superuser status.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    username = None
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=180)
    role = models.CharField(
        max_length=10,
        choices=(("admin", "Project admin"), ("crew", "Crew member")),
    )
    availability = models.CharField(
        max_length=12,
        choices=(("available", "Available"), ("unavailable", "Unavailable")),
        default="available",
    )

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name", "role"]
    objects = UserManager()

    def __str__(self):
        return self.email


class Project(models.Model):
    name = models.CharField(max_length=180)
    description = models.CharField(max_length=1000, blank=True)
    color = models.CharField(max_length=7, default="#0F766E")
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="owned_projects")
    members = models.ManyToManyField(User, through="ProjectMembership", related_name="projects")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class ProjectMembership(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="project_memberships")
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=("project", "user"), name="unique_project_member")
        ]


class Task(models.Model):
    STATUSES = (
        ("Backlog", "Backlog"),
        ("In progress", "In progress"),
        ("Review", "Review"),
        ("Done", "Done"),
    )
    PRIORITIES = (("Low", "Low"), ("Medium", "Medium"), ("High", "High"))

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=180)
    description = models.CharField(max_length=4000, blank=True)
    status = models.CharField(max_length=20, choices=STATUSES, default="Backlog")
    priority = models.CharField(max_length=10, choices=PRIORITIES, default="Medium")
    assignee = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_tasks"
    )
    due_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class Comment(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="task_comments")
    body = models.CharField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)


class Notification(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="notifications")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="notifications")
    actor = models.ForeignKey(User, on_delete=models.CASCADE, related_name="activity_notifications")
    message = models.CharField(max_length=500)
    type = models.CharField(max_length=20)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
