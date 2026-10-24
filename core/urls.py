from django.urls import path

from . import views


urlpatterns = [
    path("auth/register", views.register),
    path("auth/login", views.login_user),
    path("auth/logout", views.logout_user),
    path("me", views.me),
    path("me/availability", views.availability),
    path("projects", views.projects),
    path("projects/<int:project_id>/admin", views.project_admin),
    path("projects/<int:project_id>/available-crew", views.available_crew),
    path("projects/<int:project_id>/members", views.add_member),
    path("projects/<int:project_id>/tasks", views.project_tasks),
    path("tasks/<int:task_id>", views.task_detail),
    path("tasks/<int:task_id>/comments", views.task_comments),
    path("notifications", views.notifications),
    path("notifications/read", views.read_notifications),
]
