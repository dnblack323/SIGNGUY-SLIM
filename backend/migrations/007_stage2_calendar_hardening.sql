-- migrate:up
PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX ux_schedule_views_shared_name
  ON schedule_views(tenant_id, name)
  WHERE visibility = 'shared';

CREATE UNIQUE INDEX ux_schedule_views_personal_owner_name
  ON schedule_views(tenant_id, owner_user_id, name)
  WHERE visibility = 'personal';

CREATE UNIQUE INDEX ux_calendar_event_assignees_one_primary
  ON calendar_event_assignees(tenant_id, calendar_event_id)
  WHERE primary_assignee = 1;

CREATE UNIQUE INDEX ux_department_memberships_one_active_primary
  ON department_memberships(tenant_id, user_id)
  WHERE active = 1 AND primary_department = 1;

-- migrate:down
DROP INDEX IF EXISTS ux_department_memberships_one_active_primary;
DROP INDEX IF EXISTS ux_calendar_event_assignees_one_primary;
DROP INDEX IF EXISTS ux_schedule_views_personal_owner_name;
DROP INDEX IF EXISTS ux_schedule_views_shared_name;
