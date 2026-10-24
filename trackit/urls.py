from django.contrib import admin
from django.urls import include, path

from core.views import index


urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("core.urls")),
    path("", index, name="home"),
    path("admin", index, name="admin-portal"),
    path("admin/", index),
]
