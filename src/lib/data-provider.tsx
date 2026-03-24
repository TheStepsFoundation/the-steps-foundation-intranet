'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { Task, Workflow, Subtask, Attachment, Priority, Status, Intensity, TeamMember } from './database.types'

// Check if Supabase is configured
const isSupabaseConfigured = () => {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && 
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://YOUR_PROJECT_REF.supabase.co'
  )
}

// Default team members (fallback for demo mode)
const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  { id: 1, name: "God'sFavour Oluwanusin", role: 'Co-founder', avatar: 'GO' },
  { id: 2, name: 'Jin Samson', role: 'Co-founder', avatar: 'JS' },
  { id: 3, name: 'Daniyaal Anawar', role: 'Co-founder', avatar: 'DA' },
  { id: 4, name: 'Sam Ellis', role: 'Core Team', avatar: 'SE' },
  { id: 5, name: 'Earl Xavier', role: 'Core Team', avatar: 'EX' },
  { id: 6, name: 'Aditya Muthukumar', role: 'Core Team', avatar: 'AM' },
  { id: 7, name: 'Ricardo Serrao', role: 'Core Team', avatar: 'RS' },
]

// Export for backwards compatibility (deprecated - use useData().teamMembers instead)
export const TEAM_MEMBERS = DEFAULT_TEAM_MEMBERS

// Default workflows
const DEFAULT_WORKFLOWS: Workflow[] = [
  { id: 'event-4', name: '#4 The Great Lock-In', short: '#4', color: 'bg-purple-500' },
  { id: 'event-3', name: '#3 Degree Apprenticeship', short: '#3', color: 'bg-blue-500' },
  { id: 'event-2', name: '#2 Oxbridge Workshop', short: '#2', color: 'bg-indigo-500' },
  { id: 'event-1', name: '#1 Starting Point', short: '#1', color: 'bg-violet-500' },
  { id: 'schools', name: 'Schools', short: 'SCH', color: 'bg-green-500' },
  { id: 'partnerships', name: 'Partnerships', short: 'PTN', color: 'bg-amber-500' },
  { id: 'steps-scholars', name: 'Steps Scholars', short: 'SS', color: 'bg-rose-500' },
  { id: 'student-engagement', name: 'Student Engagement', short: 'ENG', color: 'bg-cyan-500' },
]

// Demo tasks (shown when Supabase not configured)
const DEMO_TASKS: Task[] = [
  {
    id: 1,
    title: 'Finalise TikTok ad video',
    description: 'Edit and post the filmed TikTok ad for Event #4',
    assignee: 1,
    collaborators: [3],
    subtasks: [
      { id: 1, personId: 1, description: 'Edit video and add captions', intensity: 'medium' },
      { id: 2, personId: 3, description: 'Review and approve final cut', intensity: 'quick' },
    ],
    priority: 'high',
    status: 'in-progress',
    dueDate: '2026-03-16',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: 'student-engagement',
  },
  {
    id: 2,
    title: 'Email blast to past attendees',
    description: 'Send event #4 invite to all previous event attendees',
    assignee: 2,
    collaborators: [],
    subtasks: [],
    priority: 'high',
    status: 'todo',
    dueDate: '2026-03-17',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: null,
  },
  {
    id: 3,
    title: 'Confirm speakers for Lock-In',
    description: 'Follow up with all confirmed speakers and get final confirmations',
    assignee: 3,
    collaborators: [1, 2],
    subtasks: [
      { id: 3, personId: 3, description: 'Send follow-up emails to all speakers', intensity: 'small' },
      { id: 4, personId: 1, description: 'Coordinate travel arrangements', intensity: 'medium' },
      { id: 5, personId: 2, description: 'Prepare speaker briefing packs', intensity: 'large' },
    ],
    priority: 'urgent',
    status: 'in-progress',
    dueDate: '2026-03-15',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: 'partnerships',
  },
]

interface DataContextType {
  // Data
  tasks: Task[]
  workflows: Workflow[]
  teamMembers: TeamMember[]
  loading: boolean
  isDemo: boolean
  
  // Task operations
  createTask: (task: Omit<Task, 'id' | 'createdAt'>) => Promise<void>
  updateTask: (task: Task) => Promise<void>
  deleteTask: (taskId: number) => Promise<void>
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  
  // Workflow operations
  createWorkflow: (workflow: Workflow) => Promise<void>
  updateWorkflow: (workflow: Workflow) => Promise<void>
  deleteWorkflow: (workflowId: string) => Promise<void>
  setWorkflows: React.Dispatch<React.SetStateAction<Workflow[]>>
  
  // Team member operations
  createTeamMember: (member: Omit<TeamMember, 'id'>) => Promise<void>
  updateTeamMember: (member: TeamMember) => Promise<void>
  deleteTeamMember: (memberId: number) => Promise<void>
  
  // Week data
  weekCapacities: Record<string, Record<number, number>>
  weekNotes: Record<string, Record<number, string>>
  setWeekCapacity: (memberId: number, weekStart: string, hours: number) => void
  setWeekNote: (memberId: number, weekStart: string, note: string) => void
}

const DataContext = createContext<DataContextType | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>(DEFAULT_WORKFLOWS)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(DEFAULT_TEAM_MEMBERS)
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)
  const [weekCapacities, setWeekCapacities] = useState<Record<string, Record<number, number>>>({})
  const [weekNotes, setWeekNotes] = useState<Record<string, Record<number, string>>>({})
  const [supabase, setSupabase] = useState<any>(null)

  // Initialize
  useEffect(() => {
    async function init() {
      if (isSupabaseConfigured()) {
        try {
          // Dynamic import to avoid errors when not configured
          const { supabase: sb } = await import('./supabase')
          setSupabase(sb)
          
          // Fetch data from Supabase
          const [tasksRes, workflowsRes, membersRes] = await Promise.all([
            fetchTasksFromSupabase(sb),
            fetchWorkflowsFromSupabase(sb),
            fetchTeamMembersFromSupabase(sb),
          ])
          
          setTasks(tasksRes)
          setWorkflows(workflowsRes)
          setTeamMembers(membersRes)
          setIsDemo(false)
        } catch (err) {
          console.error('Supabase error, falling back to demo mode:', err)
          setTasks(DEMO_TASKS)
          setTeamMembers(DEFAULT_TEAM_MEMBERS)
          setIsDemo(true)
        }
      } else {
        // Demo mode
        setTasks(DEMO_TASKS)
        setTeamMembers(DEFAULT_TEAM_MEMBERS)
        setIsDemo(true)
      }
      setLoading(false)
    }
    init()
  }, [])

  // Real-time subscription (when Supabase is connected)
  useEffect(() => {
    if (!supabase) return

    const channel = supabase
      .channel('data-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => {
        const tasks = await fetchTasksFromSupabase(supabase)
        setTasks(tasks)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflows' }, async () => {
        const workflows = await fetchWorkflowsFromSupabase(supabase)
        setWorkflows(workflows)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' }, async () => {
        const members = await fetchTeamMembersFromSupabase(supabase)
        setTeamMembers(members)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // Task operations
  const createTask = useCallback(async (task: Omit<Task, 'id' | 'createdAt'>) => {
    const newTask: Task = {
      ...task,
      id: Date.now(),
      createdAt: new Date().toISOString().split('T')[0],
    }

    if (supabase && !isDemo) {
      await createTaskInSupabase(supabase, newTask)
      const tasks = await fetchTasksFromSupabase(supabase)
      setTasks(tasks)
    } else {
      setTasks(prev => [...prev, newTask])
    }
  }, [supabase, isDemo])

  const updateTask = useCallback(async (task: Task) => {
    if (supabase && !isDemo) {
      await updateTaskInSupabase(supabase, task)
      const tasks = await fetchTasksFromSupabase(supabase)
      setTasks(tasks)
    } else {
      setTasks(prev => prev.map(t => t.id === task.id ? task : t))
    }
  }, [supabase, isDemo])

  const deleteTask = useCallback(async (taskId: number) => {
    if (supabase && !isDemo) {
      await supabase.from('tasks').delete().eq('id', taskId)
      const tasks = await fetchTasksFromSupabase(supabase)
      setTasks(tasks)
    } else {
      setTasks(prev => prev.filter(t => t.id !== taskId))
    }
  }, [supabase, isDemo])

  // Workflow operations
  const createWorkflow = useCallback(async (workflow: Workflow) => {
    if (supabase && !isDemo) {
      await supabase.from('workflows').insert({
        id: workflow.id,
        name: workflow.name,
        short: workflow.short,
        color: workflow.color,
        archived: workflow.archived || false,
      })
      const workflows = await fetchWorkflowsFromSupabase(supabase)
      setWorkflows(workflows)
    } else {
      setWorkflows(prev => [...prev, workflow])
    }
  }, [supabase, isDemo])

  const updateWorkflow = useCallback(async (workflow: Workflow) => {
    if (supabase && !isDemo) {
      await supabase.from('workflows').update({
        name: workflow.name,
        short: workflow.short,
        color: workflow.color,
        archived: workflow.archived || false,
      }).eq('id', workflow.id)
      const workflows = await fetchWorkflowsFromSupabase(supabase)
      setWorkflows(workflows)
    } else {
      setWorkflows(prev => prev.map(w => w.id === workflow.id ? workflow : w))
    }
  }, [supabase, isDemo])

  const deleteWorkflow = useCallback(async (workflowId: string) => {
    if (supabase && !isDemo) {
      await supabase.from('workflows').delete().eq('id', workflowId)
      const workflows = await fetchWorkflowsFromSupabase(supabase)
      setWorkflows(workflows)
    } else {
      setWorkflows(prev => prev.filter(w => w.id !== workflowId))
    }
  }, [supabase, isDemo])

  // Team member operations
  const createTeamMember = useCallback(async (member: Omit<TeamMember, 'id'>) => {
    if (supabase && !isDemo) {
      await supabase.from('team_members').insert({
        name: member.name,
        role: member.role,
        avatar: member.avatar || member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      })
      const members = await fetchTeamMembersFromSupabase(supabase)
      setTeamMembers(members)
    } else {
      const newMember: TeamMember = {
        ...member,
        id: Math.max(...teamMembers.map(m => m.id), 0) + 1,
      }
      setTeamMembers(prev => [...prev, newMember])
    }
  }, [supabase, isDemo, teamMembers])

  const updateTeamMember = useCallback(async (member: TeamMember) => {
    if (supabase && !isDemo) {
      await supabase.from('team_members').update({
        name: member.name,
        role: member.role,
        avatar: member.avatar,
      }).eq('id', member.id)
      const members = await fetchTeamMembersFromSupabase(supabase)
      setTeamMembers(members)
    } else {
      setTeamMembers(prev => prev.map(m => m.id === member.id ? member : m))
    }
  }, [supabase, isDemo])

  const deleteTeamMember = useCallback(async (memberId: number) => {
    if (supabase && !isDemo) {
      await supabase.from('team_members').delete().eq('id', memberId)
      const members = await fetchTeamMembersFromSupabase(supabase)
      setTeamMembers(members)
    } else {
      setTeamMembers(prev => prev.filter(m => m.id !== memberId))
    }
  }, [supabase, isDemo])

  // Week capacity/notes
  const setWeekCapacity = useCallback((memberId: number, weekStart: string, hours: number) => {
    setWeekCapacities(prev => ({
      ...prev,
      [weekStart]: { ...prev[weekStart], [memberId]: hours }
    }))
    
    if (supabase && !isDemo) {
      supabase.from('week_capacities').upsert({
        week_start: weekStart,
        member_id: memberId,
        hours,
      }, { onConflict: 'week_start,member_id' })
    }
  }, [supabase, isDemo])

  const setWeekNote = useCallback((memberId: number, weekStart: string, note: string) => {
    setWeekNotes(prev => ({
      ...prev,
      [weekStart]: { ...prev[weekStart], [memberId]: note }
    }))
    
    if (supabase && !isDemo) {
      supabase.from('week_notes').upsert({
        week_start: weekStart,
        member_id: memberId,
        note,
      }, { onConflict: 'week_start,member_id' })
    }
  }, [supabase, isDemo])

  return (
    <DataContext.Provider value={{
      tasks,
      workflows,
      teamMembers,
      loading,
      isDemo,
      createTask,
      updateTask,
      deleteTask,
      setTasks,
      createWorkflow,
      updateWorkflow,
      deleteWorkflow,
      setWorkflows,
      createTeamMember,
      updateTeamMember,
      deleteTeamMember,
      weekCapacities,
      weekNotes,
      setWeekCapacity,
      setWeekNote,
    }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData() {
  const context = useContext(DataContext)
  if (!context) {
    // Return safe defaults during SSR or before provider mounts
    const noop = async () => {}
    const noopSet = () => {}
    return {
      tasks: [],
      workflows: [],
      teamMembers: DEFAULT_TEAM_MEMBERS,
      loading: true,
      isDemo: false,
      createTask: noop,
      updateTask: noop,
      deleteTask: noop,
      setTasks: noopSet as any,
      createWorkflow: noop,
      updateWorkflow: noop,
      deleteWorkflow: noop,
      setWorkflows: noopSet as any,
      createTeamMember: noop,
      updateTeamMember: noop,
      deleteTeamMember: noop,
      weekCapacities: {} as Record<string, Record<number, number>>,
      weekNotes: {} as Record<string, Record<number, string>>,
      setWeekCapacity: () => {},
      setWeekNote: () => {},
    }
  }
  return context
}

// Supabase helper functions
async function fetchTasksFromSupabase(supabase: any): Promise<Task[]> {
  const [tasksRes, collabRes, subtasksRes, attachRes] = await Promise.all([
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('task_collaborators').select('*'),
    supabase.from('subtasks').select('*'),
    supabase.from('attachments').select('*'),
  ])

  return (tasksRes.data || []).map((t: any) => ({
    id: t.id,
    title: t.title,
    description: t.description || '',
    assignee: t.assignee || 0,
    collaborators: (collabRes.data || [])
      .filter((c: any) => c.task_id === t.id)
      .map((c: any) => c.member_id),
    subtasks: (subtasksRes.data || [])
      .filter((s: any) => s.task_id === t.id)
      .map((s: any) => ({
        id: s.id,
        personId: s.person_id || 0,
        description: s.description || '',
        intensity: s.intensity as Intensity,
      })),
    priority: t.priority as Priority,
    status: t.status as Status,
    dueDate: t.due_date,
    createdAt: t.created_at.split('T')[0],
    createdBy: t.created_by || undefined,
    workflow: t.workflow_id,
    subWorkflow: t.sub_workflow_id,
    attachments: (attachRes.data || [])
      .filter((a: any) => a.task_id === t.id)
      .map((a: any) => ({
        id: a.id,
        type: a.type,
        url: a.url,
        name: a.name,
        duration: a.duration || undefined,
      })),
  }))
}

async function fetchWorkflowsFromSupabase(supabase: any): Promise<Workflow[]> {
  const { data } = await supabase.from('workflows').select('*').order('created_at', { ascending: true })
  return (data || []).map((w: any) => ({
    id: w.id,
    name: w.name,
    short: w.short,
    color: w.color,
    archived: w.archived,
  }))
}

async function fetchTeamMembersFromSupabase(supabase: any): Promise<TeamMember[]> {
  const { data } = await supabase.from('team_members').select('*').order('id', { ascending: true })
  return (data || []).map((m: any) => ({
    id: m.id,
    name: m.name,
    role: m.role || 'Team Member',
    avatar: m.avatar || m.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
  }))
}

async function createTaskInSupabase(supabase: any, task: Task) {
  const { data } = await supabase.from('tasks').insert({
    title: task.title,
    description: task.description,
    assignee: task.assignee || null,
    priority: task.priority,
    status: task.status,
    due_date: task.dueDate,
    workflow_id: task.workflow,
    sub_workflow_id: task.subWorkflow,
    created_by: task.createdBy || null,
  }).select().single()

  if (task.collaborators.length > 0) {
    await supabase.from('task_collaborators').insert(
      task.collaborators.map(mid => ({ task_id: data.id, member_id: mid }))
    )
  }

  if (task.subtasks.length > 0) {
    await supabase.from('subtasks').insert(
      task.subtasks.map(st => ({
        task_id: data.id,
        person_id: st.personId || null,
        description: st.description,
        intensity: st.intensity,
      }))
    )
  }

  if (task.attachments && task.attachments.length > 0) {
    await supabase.from('attachments').insert(
      task.attachments.map(att => ({
        task_id: data.id,
        type: att.type,
        url: att.url,
        name: att.name,
        duration: att.duration || null,
      }))
    )
  }
}

async function updateTaskInSupabase(supabase: any, task: Task) {
  await supabase.from('tasks').update({
    title: task.title,
    description: task.description,
    assignee: task.assignee || null,
    priority: task.priority,
    status: task.status,
    due_date: task.dueDate,
    workflow_id: task.workflow,
    sub_workflow_id: task.subWorkflow,
  }).eq('id', task.id)

  // Update relations
  await supabase.from('task_collaborators').delete().eq('task_id', task.id)
  if (task.collaborators.length > 0) {
    await supabase.from('task_collaborators').insert(
      task.collaborators.map(mid => ({ task_id: task.id, member_id: mid }))
    )
  }

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
}
