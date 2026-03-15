-- Steps Task Tracker Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
CREATE TYPE priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE status AS ENUM ('todo', 'in-progress', 'review', 'done');
CREATE TYPE intensity AS ENUM ('quick', 'small', 'medium', 'large', 'huge');
CREATE TYPE attachment_type AS ENUM ('image', 'voice', 'note');

-- Team Members
CREATE TABLE team_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar TEXT NOT NULL
);

-- Insert default team members
INSERT INTO team_members (id, name, role, avatar) VALUES
  (1, 'God''sFavour Oluwanusin', 'Co-founder', 'GO'),
  (2, 'Jin Samson', 'Co-founder', 'JS'),
  (3, 'Daniyaal Anawar', 'Co-founder', 'DA'),
  (4, 'Sam Ellis', 'Core Team', 'SE'),
  (5, 'Earl Xavier', 'Core Team', 'EX'),
  (6, 'Aditya Muthukumar', 'Core Team', 'AM');

-- Workflows
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  color TEXT NOT NULL,
  archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default workflows
INSERT INTO workflows (id, name, short, color) VALUES
  ('event-4', '#4 The Great Lock-In', '#4', 'bg-purple-500'),
  ('event-3', '#3 Degree Apprenticeship', '#3', 'bg-blue-500'),
  ('event-2', '#2 Oxbridge Workshop', '#2', 'bg-indigo-500'),
  ('event-1', '#1 Starting Point', '#1', 'bg-violet-500'),
  ('schools', 'Schools', 'SCH', 'bg-green-500'),
  ('partnerships', 'Partnerships', 'PTN', 'bg-amber-500'),
  ('steps-scholars', 'Steps Scholars', 'SS', 'bg-rose-500'),
  ('student-engagement', 'Student Engagement', 'ENG', 'bg-cyan-500');

-- Tasks
CREATE TABLE tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assignee INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  priority priority DEFAULT 'medium',
  status status DEFAULT 'todo',
  due_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  sub_workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL
);

-- Task Collaborators (many-to-many)
CREATE TABLE task_collaborators (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
  UNIQUE(task_id, member_id)
);

-- Subtasks
CREATE TABLE subtasks (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  person_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL,
  description TEXT DEFAULT '',
  intensity intensity DEFAULT 'small'
);

-- Attachments
CREATE TABLE attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  type attachment_type NOT NULL,
  url TEXT NOT NULL,
  name TEXT NOT NULL,
  duration INTEGER, -- for voice notes, in seconds
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Week Capacities (per member per week)
CREATE TABLE week_capacities (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
  hours INTEGER DEFAULT 16,
  UNIQUE(week_start, member_id)
);

-- Week Notes (availability notes per member per week)
CREATE TABLE week_notes (
  id SERIAL PRIMARY KEY,
  week_start DATE NOT NULL,
  member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
  note TEXT DEFAULT '',
  UNIQUE(week_start, member_id)
);

-- Indexes for performance
CREATE INDEX idx_tasks_assignee ON tasks(assignee);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_workflow ON tasks(workflow_id);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_subtasks_task ON subtasks(task_id);
CREATE INDEX idx_attachments_task ON attachments(task_id);
CREATE INDEX idx_collaborators_task ON task_collaborators(task_id);

-- Row Level Security (RLS) - Enable later when adding auth
-- For now, we'll allow public access

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_capacities ENABLE ROW LEVEL SECURITY;
ALTER TABLE week_notes ENABLE ROW LEVEL SECURITY;

-- Public read/write policies (open access - secure later with auth)
CREATE POLICY "Public read team_members" ON team_members FOR SELECT USING (true);
CREATE POLICY "Public read workflows" ON workflows FOR SELECT USING (true);
CREATE POLICY "Public all workflows" ON workflows FOR ALL USING (true);
CREATE POLICY "Public all tasks" ON tasks FOR ALL USING (true);
CREATE POLICY "Public all task_collaborators" ON task_collaborators FOR ALL USING (true);
CREATE POLICY "Public all subtasks" ON subtasks FOR ALL USING (true);
CREATE POLICY "Public all attachments" ON attachments FOR ALL USING (true);
CREATE POLICY "Public all week_capacities" ON week_capacities FOR ALL USING (true);
CREATE POLICY "Public all week_notes" ON week_notes FOR ALL USING (true);

-- Enable realtime for key tables
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE workflows;
ALTER PUBLICATION supabase_realtime ADD TABLE subtasks;
ALTER PUBLICATION supabase_realtime ADD TABLE attachments;
