-- 013_user_delete_fks.sql
--
-- Deleting a user from the Supabase Dashboard fails with a 500, because two foreign keys into
-- `auth.users` were declared with no delete action at all:
--
--     documents.updated_by          uuid references auth.users(id)
--     document_versions.created_by  uuid references auth.users(id)
--
-- No `on delete` clause means NO ACTION, so Postgres refuses to remove any user who has ever saved a
-- document. `audit_log.user_id` in the same file got `on delete set null`; these two were missed.
--
-- WHY THE APP NEVER HIT THIS. `delete_account` removes the user's sole-owner COMPANIES first, and
-- documents cascade from companies — so by the time it touches `auth.users` there is nothing left
-- pointing at them. The Dashboard deletes the user directly, with no such preamble, and hits the
-- constraint head-on. The app path was not more correct; it was avoiding the problem by accident.
--
-- SET NULL, NOT CASCADE, and the distinction matters. These columns record WHO LAST TOUCHED a
-- document. The document belongs to the COMPANY, not to the person — cascading would delete a
-- company's live financial model because an employee closed their account, which would be a
-- catastrophic reading of "delete my data". Null means exactly what is true afterwards: we no longer
-- know who made that edit.

alter table documents
  drop constraint if exists documents_updated_by_fkey,
  add  constraint documents_updated_by_fkey
       foreign key (updated_by) references auth.users(id) on delete set null;

alter table document_versions
  drop constraint if exists document_versions_created_by_fkey,
  add  constraint document_versions_created_by_fkey
       foreign key (created_by) references auth.users(id) on delete set null;
