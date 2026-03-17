'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'
import type { Task, Workflow, TeamMember } from './database.types'

// Database row types (what Supabase returns)
interface TaskRow {
  id: number
  title: string
  description: string | null
  assignee: number | null
  priority: string
  status: string
  due_date: string | null
  workflow_id: string | null
  sub_workflow_id: string | null
  created_at: string
}

interface CollaboratorRow {
  id: number
  task_id: number
  member_id: number
}

interface SubtaskRow {
  id: number
  task_id: number
  person_id: number | null
  description: string | null
  intensity: string
}

interface AttachmentRow {
  id: number
  task_id: number
  type: string
  url: string
  name: string
  duration: number | null
  created_at: string
}

interface WorkflowRow {
  id: string
  name: string
  short: string
  color: string
  archived: boolean | null
  created_at: string
}

interface TeamMemberRow {
  id: number
  name: string
  role: string
  avatar: string
}

interface WeekCapacityRow {
  id: number
  week_start: string
  member_id: number
  hours: number
}

interface WeekNoteRow {
  id: number
  week_start: string
  member_id: number
  note: string
}

// Fetch all tasks with their collaborators, subtasks, and attachments
export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTasks = useCallback(async () => {
    try {
      // Fetch tasks
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })

      if (tasksError) throw tasksError

      // Fetch collaborators
      const { data: collabData, error: collabError } = await supabase
        .from('task_collaborators')
        .select('*')

      if (collabError) throw collabError

      // Fetch subtasks
      const { data: subtasksData, error: subtasksError } = await supabase
        .from('subtasks')
        .select('*')

      if (subtasksError) throw subtasksError

      // Fetch attachments
      const { data: attachmentsData, error: attachmentsError } = await supabase
        .from('attachments')
        .select('*')

      if (attachmentsError) throw attachmentsError

      // Cast to our row types
      const taskRows = (tasksData || []) as TaskRow[]
      const collabRows = (collabData || []) as CollaboratorRow[]
      const subtaskRows = (subtasksData || []) as SubtaskRow[]
      const attachmentRows = (attachmentsData || []) as AttachmentRow[]

      // Map to frontend Task format
      const mappedTasks: Task[] = taskRows.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description || '',
        assignee: t.assignee || 0,
        collaborators: collabRows
          .filter(c => c.task_id === t.id)
          .map(c => c.member_id),
        subtasks: subtaskRows
          .filter(s => s.task_id === t.id)
          .map(s => ({
            id: s.id,
            personId: s.person_id || 0,
            description: s.description || '',
            intensity: s.intensity as Task['subtasks'][0]['intensity'],
          })),
        priority: t.priority as Task['priority'],
        status: t.status as Task['status'],
        dueDate: t.due_date || '',
        createdAt: t.created_at.split('T')[0],
        workflow: t.workflow_id,
        subWorkflow: t.sub_workflow_id,
        attachments: attachmentRows
          .filter(a => a.task_id === t.id)
          .map(a => ({
            id: a.id,
            type: a.type as 'image' | 'voice' | 'note',
            url: a.url,
            name: a.name,
            duration: a.duration || undefined,
          })),
      }))

      setTasks(mappedTasks)
      setError(null)
    } catch (err) {
      console.error('Error fetching tasks:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('tasks-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        fetchTasks()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subtasks' }, () => {
        fetchTasks()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, () => {
        fetchTasks()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_collaborators' }, () => {
        fetchTasks()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchTasks])

  // CRUD operations
  const createTask = async (task: Omit<Task, 'id' | 'createdAt'>) => {
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: task.title,
        description: task.description,
        assignee: task.assignee || null,
        priority: task.priority,
        status: task.status,
        due_date: task.dueDate || null,
        workflow_id: task.workflow || null,
        sub_workflow_id: task.subWorkflow || null,
      })
      .select()
      .single()

    if (error) throw error

    const taskData = data as TaskRow

    // Insert collaborators
    if (task.collaborators.length > 0) {
      await supabase.from('task_collaborators').insert(
        task.collaborators.map(memberId => ({
          task_id: taskData.id,
          member_id: memberId,
        }))
      )
    }

    // Insert subtasks
    if (task.subtasks.length > 0) {
      await supabase.from('subtasks').insert(
        task.subtasks.map(st => ({
          task_id: taskData.id,
          person_id: st.personId || null,
          description: st.description,
          intensity: st.intensity,
        }))
      )
    }

    // Insert attachments
    if (task.attachments && task.attachments.length > 0) {
      await supabase.from('attachments').insert(
        task.attachments.map(att => ({
          task_id: taskData.id,
          type: att.type,
          url: att.url,
          name: att.name,
          duration: att.duration || null,
        }))
      )
    }

    await fetchTasks()
    return taskData
  }

  const updateTask = async (task: Task) => {
    // Update main task
    const { error } = await supabase
      .from('tasks')
      .update({
        title: task.title,
        description: task.description,
        assignee: task.assignee || null,
        priority: task.priority,
        status: task.status,
        due_date: task.dueDate || null,
        workflow_id: task.workflow || null,
        sub_workflow_id: task.subWorkflow || null,
      })
      .eq('id', task.id)

    if (error) throw error

    // Update collaborators (delete all, re-insert)
    await supabase.from('task_collaborators').delete().eq('task_id', task.id)
    if (task.collaborators.length > 0) {
      await supabase.from('task_collaborators').insert(
        task.collaborators.map(memberId => ({
          task_id: task.id,
          member_id: memberId,
        }))
      )
    }

    // Update subtasks (delete all, re-insert)
    await supabase.from('subtasks').delete().eq('task_id', task.id)
    if (task.subtasks.length > 0) {
      await supabase.from('subtasks').insert(
        task.subtasks.map(st => ({
          task_id: task.id,
          person_id: st.personId || null,
          description: st.description,
          intensity: st.intensity,
        }))
      )
    }

    // Update attachments (delete all, re-insert)
    await supabase.from('attachments').delete().eq('task_id', task.id)
    if (task.attachments && task.attachments.length > 0) {
      await supabase.from('attachments').insert(
        task.attachments.map(att => ({
          task_id: task.id,
          type: att.type,
          url: att.url,
          name: att.name,
          duration: att.duration || null,
        }))
      )
    }

    await fetchTasks()
  }

  const deleteTask = async (taskId: number) => {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) throw error
    await fetchTasks()
  }

  return { tasks, loading, error, createTask, updateTask, deleteTask, refetch: fetchTasks }
}

// Fetch all workflows
export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkflows = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('workflows')
        .select('*')
        .order('created_at', { ascending: true })

      if (error) throw error

      const workflowRows = (data || []) as WorkflowRow[]

      const mappedWorkflows: Workflow[] = workflowRows.map(w => ({
        id: w.id,
        name: w.name,
        short: w.short,
        color: w.color,
        archived: w.archived || false,
      }))

      setWorkflows(mappedWorkflows)
      setError(null)
    } catch (err) {
      console.error('Error fetching workflows:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch workflows')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkflows()
  }, [fetchWorkflows])

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('workflows-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflows' }, () => {
        fetchWorkflows()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchWorkflows])

  const createWorkflow = async (workflow: Workflow) => {
    const { error } = await supabase.from('workflows').insert({
      id: workflow.id,
      name: workflow.name,
      short: workflow.short,
      color: workflow.color,
      archived: workflow.archived || false,
    })
    if (error) throw error
    await fetchWorkflows()
  }

  const updateWorkflow = async (workflow: Workflow) => {
    const { error } = await supabase
      .from('workflows')
      .update({
        name: workflow.name,
        short: workflow.short,
        color: workflow.color,
        archived: workflow.archived || false,
      })
      .eq('id', workflow.id)
    if (error) throw error
    await fetchWorkflows()
  }

  const deleteWorkflow = async (workflowId: string) => {
    const { error } = await supabase.from('workflows').delete().eq('id', workflowId)
    if (error) throw error
    await fetchWorkflows()
  }

  return { workflows, loading, error, createWorkflow, updateWorkflow, deleteWorkflow, refetch: fetchWorkflows }
}

// Fetch team members
export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('id', { ascending: true })

      if (!error && data) {
        setMembers(data as TeamMemberRow[])
      }
      setLoading(false)
    }
    fetch()
  }, [])

  return { members, loading }
}

// Week capacities and notes
export function useWeekData(weekStart: string) {
  const [capacities, setCapacities] = useState<Record<number, number>>({})
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const [capResult, notesResult] = await Promise.all([
        supabase.from('week_capacities').select('*').eq('week_start', weekStart),
        supabase.from('week_notes').select('*').eq('week_start', weekStart),
      ])

      if (capResult.data) {
        const capRows = capResult.data as WeekCapacityRow[]
        const capMap: Record<number, number> = {}
        capRows.forEach(c => { capMap[c.member_id] = c.hours })
        setCapacities(capMap)
      }

      if (notesResult.data) {
        const noteRows = notesResult.data as WeekNoteRow[]
        const notesMap: Record<number, string> = {}
        noteRows.forEach(n => { notesMap[n.member_id] = n.note })
        setNotes(notesMap)
      }

      setLoading(false)
    }
    fetch()
  }, [weekStart])

  const setCapacity = async (memberId: number, hours: number) => {
    await supabase.from('week_capacities').upsert({
      week_start: weekStart,
      member_id: memberId,
      hours,
    }, { onConflict: 'week_start,member_id' })
    setCapacities(prev => ({ ...prev, [memberId]: hours }))
  }

  const setNote = async (memberId: number, note: string) => {
    await supabase.from('week_notes').upsert({
      week_start: weekStart,
      member_id: memberId,
      note,
    }, { onConflict: 'week_start,member_id' })
    setNotes(prev => ({ ...prev, [memberId]: note }))
  }

  return { capacities, notes, loading, setCapacity, setNote }
}
