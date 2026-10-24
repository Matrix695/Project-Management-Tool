from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Comment, Project, ProjectMembership, Task


class Command(BaseCommand):
    help = "Create the TrackIt demo team, project, and sample work."

    def handle(self, *args, **options):
        user_model = get_user_model()
        alex = self.user(user_model, "Alex Morgan", "alex@trackit.test", "admin")
        maya = self.user(user_model, "Maya Chen", "maya@trackit.test", "crew")
        jordan = self.user(user_model, "Jordan Lee", "jordan@trackit.test", "crew")
        project, created = Project.objects.get_or_create(
            name="Website redesign",
            owner=alex,
            defaults={
                "description": "A fresh, more helpful home for our product.",
                "color": "#0F766E",
            },
        )
        for member in (alex, maya, jordan):
            ProjectMembership.objects.get_or_create(project=project, user=member)
        if created:
            today = timezone.localdate()
            samples = [
                ("Gather inspiration from the team", "Collect references for the new visual direction.", "Done", "Low", maya, today - timedelta(days=2)),
                ("Sketch the new homepage", "Explore a few ways to tell our story above the fold.", "In progress", "High", alex, today + timedelta(days=2)),
                ("Write product page copy", "Keep it clear, confident, and human.", "In progress", "Medium", jordan, today + timedelta(days=4)),
                ("Define the component library", "Start with buttons, cards, typography, and color tokens.", "Backlog", "Medium", None, today + timedelta(days=7)),
                ("Review the sitemap", "Make sure the navigation feels effortless.", "Review", "High", maya, today + timedelta(days=1)),
                ("Plan the mobile experience", "", "Backlog", "Low", None, None),
            ]
            tasks = []
            for title, description, status, priority, assignee, due_date in samples:
                tasks.append(
                    Task.objects.create(
                        project=project,
                        title=title,
                        description=description,
                        status=status,
                        priority=priority,
                        assignee=assignee,
                        due_date=due_date,
                    )
                )
            Comment.objects.create(
                task=tasks[1],
                user=maya,
                body="I added a few references to the shared folder — excited to see where this goes!",
            )
        self.stdout.write(self.style.SUCCESS("TrackIt demo data is ready."))

    @staticmethod
    def user(user_model, name, email, role):
        user, created = user_model.objects.get_or_create(
            email=email,
            defaults={"name": name, "role": role},
        )
        if created:
            user.set_password("trackitdemo")
            user.save(update_fields=("password",))
        return user
