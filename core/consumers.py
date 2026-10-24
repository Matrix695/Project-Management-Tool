from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .models import ProjectMembership


class ActivityConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope["user"]
        if not user.is_authenticated:
            await self.close(code=4401)
            return
        self.user_group = f"user_{user.pk}"
        project_ids = await database_sync_to_async(list)(
            ProjectMembership.objects.filter(user_id=user.pk).values_list(
                "project_id", flat=True
            )
        )
        self.project_groups = [f"project_{project_id}" for project_id in project_ids]
        await self.channel_layer.group_add(self.user_group, self.channel_name)
        for group in self.project_groups:
            await self.channel_layer.group_add(group, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "user_group"):
            await self.channel_layer.group_discard(self.user_group, self.channel_name)
            for group in self.project_groups:
                await self.channel_layer.group_discard(group, self.channel_name)

    async def activity_message(self, event):
        activity = event["event"]
        await self.send_json(
            {
                "type": "activity",
                "eventType": activity.get("type"),
                **{key: value for key, value in activity.items() if key != "type"},
            }
        )

    async def force_close(self, event):
        await self.close(code=1000)
