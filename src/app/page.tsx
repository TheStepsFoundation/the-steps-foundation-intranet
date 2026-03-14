'use client'

import { useState, MouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'

// Team members from Steps Foundation
const TEAM_MEMBERS = [
  { id: 1, name: "God'sFavour Oluwanusin", role: 'Co-founder', avatar: 'GF' },
  { id: 2, name: 'Jin Samson', role: 'Co-founder', avatar: 'JS' },
  { id: 3, name: 'Daniyaal Anawar', role: 'Co-founder', avatar: 'DA' },
  { id: 4, name: 'Sam Ellis', role: 'Core Team', avatar: 'SE' },
  { id: 5, name: 'Earl Xavier', role: 'Core Team', avatar: 'EX' },
  { id: 6, name: 'Aditya Luthukumar', role: 'Core Team', avatar: 'AL' },
]

// Workflows / Categories
const WORKFLOWS = [
  { id: 'event-4', name: '#4 The Great Lock-In', color: 'bg-purple-500' },
  { id: 'event-3', name: '#3 Degree Apprenticeship', color: 'bg-blue-500' },
  { id: 'event-2', name: '#2 Oxbridge Workshop', color: 'bg-indigo-500' },
  { id: 'event-1', name: '#1 Starting Point', color: 'bg-violet-500' },
  { id: 'schools', name: 'Schools', color: 'bg-green-500' },
  { id: 'partnerships', name: 'Partnerships', color: 'bg-amber-500' },
  { id: 'steps-scholars', name: 'Steps Scholars', color: 'bg-rose-500' },
  { id: 'student-engagement', name: 'Student Engagement', color: 'bg-cyan-500' },
]

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Status = 'todo' | 'in-progress' | 'review' | 'done'

interface Task {
  id: number
  title: string
  description: string
  assignee: number
  collaborators: number[]
  priority: Priority
  status: Status
  dueDate: string
  createdAt: string
  workflow: string | null
  subWorkflow: string | null
}

const INITIAL_TASKS: Task[] = [
  {
    id: 1,
    title: 'Finalise TikTok ad video',
    description: 'Edit and post the filmed TikTok ad for Event #4',
    assignee: 1,
    collaborators: [3],
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
    priority: 'urgent',
    status: 'in-progress',
    dueDate: '2026-03-15',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: 'partnerships',
  },
  {
    id: 4,
    title: 'Design event day schedule',
    description: 'Create detailed minute-by-minute schedule for March 21',
    assignee: 4,
    collaborators: [],
    priority: 'medium',
    status: 'todo',
    dueDate: '2026-03-18',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: null,
  },
  {
    id: 5,
    title: 'Book catering for event',
    description: 'Confirm lunch and refreshments for 250 attendees',
    assignee: 5,
    collaborators: [4],
    priority: 'high',
    status: 'review',
    dueDate: '2026-03-16',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: null,
  },
  {
    id: 6,
    title: 'Print name badges',
    description: 'Design and print name badges for all confirmed attendees',
    assignee: 6,
    collaborators: [],
    priority: 'low',
    status: 'todo',
    dueDate: '2026-03-20',
    createdAt: '2026-03-14',
    workflow: 'event-4',
    subWorkflow: null,
  },
  {
    id: 7,
    title: 'Set up registration desk plan',
    description: 'Prepare check-in system and volunteer briefing',
    assignee: 1,
    collaborators: [5, 6],
    priority: 'medium',
    status: 'done',
    dueDate: '2026-03-20',
    createdAt: '2026-03-10',
    workflow: 'event-4',
    subWorkflow: null,
  },
  {
    id: 8,
    title: 'Reach out to partner schools',
    description: 'Contact 10 new schools for Steps Scholars program',
    assignee: 3,
    collaborators: [],
    priority: 'medium',
    status: 'todo',
    dueDate: '2026-03-25',
    createdAt: '2026-03-14',
    workflow: 'steps-scholars',
    subWorkflow: 'schools',
  },
]

const priorityColors: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-700 border-gray-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
}

const statusColors: Record<Status, string> = {
  'todo': 'bg-gray-200 text-gray-700',
  'in-progress': 'bg-yellow-200 text-yellow-800',
  'review': 'bg-purple-200 text-purple-700',
  'done': 'bg-green-200 text-green-700',
}

const statusLabels: Record<Status, string> = {
  'todo': 'To Do',
  'in-progress': 'In Progress',
  'review': 'Review',
  'done': 'Done',
}

// Droppable Column
function DroppableColumn({ 
  id, 
  children, 
  className = '' 
}: { 
  id: string
  children: React.ReactNode
  className?: string 
}) {
  const { isOver, setNodeRef } = useDroppable({ id })
  
  return (
    <div 
      ref={setNodeRef}
      className={`${className} ${isOver ? 'ring-2 ring-purple-400 ring-inset bg-purple-50' : ''}`}
    >
      {children}
    </div>
  )
}

// Draggable Task Card with separate drag handle
function DraggableTaskCard({ 
  task, 
  onClick,
  showStatus = false 
}: { 
  task: Task
  onClick: () => void
  showStatus?: boolean 
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 1000,
  } : undefined

  const member = TEAM_MEMBERS.find(m => m.id === task.assignee)
  const workflow = WORKFLOWS.find(w => w.id === task.workflow)
  const subWorkflow = WORKFLOWS.find(w => w.id === task.subWorkflow)

  const handleCardClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      return
    }
    onClick()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleCardClick}
      className={`relative bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer ${
        isDragging ? 'opacity-50 shadow-lg' : ''
      }`}
    >
      {/* Drag Handle */}
      <div 
        {...listeners}
        {...attributes}
        className="drag-handle absolute top-2 right-2 p-1.5 rounded hover:bg-gray-100 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
        onClick={(e) => e.stopPropagation()}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
        </svg>
      </div>

      {/* Workflow badges */}
      {workflow && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full text-white ${workflow.color}`}>
            {workflow.name}
          </span>
          {subWorkflow && (
            <>
              <span className="text-gray-400 text-xs">→</span>
              <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full text-white ${subWorkflow.color}`}>
                {subWorkflow.name}
              </span>
            </>
          )}
        </div>
      )}

      <h3 className="font-medium text-gray-900 mb-2 pr-8">{task.title}</h3>
      <p className="text-sm text-gray-500 mb-3 line-clamp-2">{task.description}</p>
      
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${priorityColors[task.priority]}`}>
          {task.priority}
        </span>
        {showStatus && (
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusColors[task.status]}`}>
            {statusLabels[task.status]}
          </span>
        )}
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
        </span>
        <div className="flex -space-x-2 ml-auto">
          {member && (
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-xs font-medium border-2 border-white" title={member.name}>
              {member.avatar.charAt(0)}
            </div>
          )}
          {task.collaborators.slice(0, 2).map(collabId => {
            const collab = TEAM_MEMBERS.find(m => m.id === collabId)
            return collab ? (
              <div key={collabId} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-medium border-2 border-white" title={collab.name}>
                {collab.avatar.charAt(0)}
              </div>
            ) : null
          })}
          {task.collaborators.length > 2 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-xs font-medium border-2 border-white">
              +{task.collaborators.length - 2}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Task Edit Modal
function TaskModal({ 
  task, 
  onClose, 
  onSave 
}: { 
  task: Task
  onClose: () => void
  onSave: (updatedTask: Task) => void 
}) {
  const [editedTask, setEditedTask] = useState<Task>({ ...task })

  const toggleCollaborator = (memberId: number) => {
    if (memberId === editedTask.assignee) return
    setEditedTask(prev => ({
      ...prev,
      collaborators: prev.collaborators.includes(memberId)
        ? prev.collaborators.filter(id => id !== memberId)
        : [...prev.collaborators, memberId]
    }))
  }

  const handleSave = () => {
    onSave(editedTask)
    onClose()
  }

  const currentWorkflow = WORKFLOWS.find(w => w.id === editedTask.workflow)
  const currentSubWorkflow = WORKFLOWS.find(w => w.id === editedTask.subWorkflow)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Edit Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Workflow Selection - At the top */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Main Workflow</label>
              <select
                value={editedTask.workflow || ''}
                onChange={e => setEditedTask({ 
                  ...editedTask, 
                  workflow: e.target.value || null,
                  subWorkflow: e.target.value === editedTask.subWorkflow ? null : editedTask.subWorkflow
                })}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
              >
                <option value="">None</option>
                {WORKFLOWS.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {currentWorkflow && (
                <div className="mt-2">
                  <span className={`inline-flex items-center text-xs px-2 py-1 rounded-full text-white ${currentWorkflow.color}`}>
                    {currentWorkflow.name}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sub-Workflow</label>
              <select
                value={editedTask.subWorkflow || ''}
                onChange={e => setEditedTask({ ...editedTask, subWorkflow: e.target.value || null })}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
              >
                <option value="">None</option>
                {WORKFLOWS.filter(w => w.id !== editedTask.workflow).map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
              {currentSubWorkflow && (
                <div className="mt-2">
                  <span className={`inline-flex items-center text-xs px-2 py-1 rounded-full text-white ${currentSubWorkflow.color}`}>
                    {currentSubWorkflow.name}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input
              type="text"
              value={editedTask.title}
              onChange={e => setEditedTask({ ...editedTask, title: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={editedTask.description}
              onChange={e => setEditedTask({ ...editedTask, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={editedTask.status}
                onChange={e => setEditedTask({ ...editedTask, status: e.target.value as Status })}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
              >
                <option value="todo">To Do</option>
                <option value="in-progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
              <select
                value={editedTask.priority}
                onChange={e => setEditedTask({ ...editedTask, priority: e.target.value as Priority })}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Due Date</label>
            <input
              type="date"
              value={editedTask.dueDate}
              onChange={e => setEditedTask({ ...editedTask, dueDate: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assigned To</label>
            <div className="grid grid-cols-3 gap-2">
              {TEAM_MEMBERS.map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setEditedTask({ 
                    ...editedTask, 
                    assignee: member.id,
                    collaborators: editedTask.collaborators.filter(id => id !== member.id)
                  })}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                    editedTask.assignee === member.id
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-medium">
                    {member.avatar}
                  </div>
                  <span className="text-sm font-medium text-gray-700 truncate">{member.name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Collaborators</label>
            <div className="grid grid-cols-3 gap-2">
              {TEAM_MEMBERS.filter(m => m.id !== editedTask.assignee).map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleCollaborator(member.id)}
                  className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                    editedTask.collaborators.includes(member.id)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    editedTask.collaborators.includes(member.id)
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {member.avatar}
                  </div>
                  <span className="text-sm font-medium text-gray-700 truncate">{member.name.split(' ')[0]}</span>
                  {editedTask.collaborators.includes(member.id) && (
                    <svg className="w-4 h-4 text-blue-500 ml-auto flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [view, setView] = useState<'board' | 'team' | 'list' | 'workload'>('board')
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 100,
        tolerance: 5,
      },
    })
  )

  const getTasksByStatus = (status: Status) => tasks.filter(t => t.status === status)
  const getTasksByMember = (memberId: number) => tasks.filter(t => t.assignee === memberId && t.status !== 'done')
  const getArchivedTasksByMember = (memberId: number) => tasks.filter(t => t.assignee === memberId && t.status === 'done')
  
  const getWorkload = (memberId: number) => {
    const memberTasks = tasks.filter(t => t.assignee === memberId && t.status !== 'done')
    return {
      total: memberTasks.length,
      urgent: memberTasks.filter(t => t.priority === 'urgent').length,
      high: memberTasks.filter(t => t.priority === 'high').length,
    }
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)
    
    if (!over) return

    const taskId = active.id as number
    const overId = over.id as string
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    if (['todo', 'in-progress', 'review', 'done'].includes(overId)) {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: overId as Status } : t
      ))
    }
    
    if (overId.startsWith('member-')) {
      const newAssigneeId = parseInt(overId.replace('member-', ''))
      const oldAssigneeId = task.assignee
      
      if (newAssigneeId !== oldAssigneeId) {
        setTasks(prev => prev.map(t => {
          if (t.id === taskId) {
            const newCollaborators = t.collaborators.filter(id => id !== newAssigneeId)
            if (!newCollaborators.includes(oldAssigneeId)) {
              newCollaborators.push(oldAssigneeId)
            }
            return {
              ...t,
              assignee: newAssigneeId,
              collaborators: newCollaborators,
            }
          }
          return t
        }))
      }
    }
  }

  const handleSaveTask = (updatedTask: Task) => {
    setTasks(prev => prev.map(task =>
      task.id === updatedTask.id ? updatedTask : task
    ))
  }

  return (
    <main className="min-h-screen p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Steps Task Tracker</h1>
          <p className="text-gray-500">Manage all workflows and events</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['board', 'team', 'list', 'workload'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 rounded-lg font-medium transition capitalize ${
                view === v ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Board View */}
        {view === 'board' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(['todo', 'in-progress', 'review', 'done'] as Status[]).map(status => (
              <DroppableColumn
                key={status}
                id={status}
                className="bg-gray-50 rounded-xl p-4 min-h-[400px] transition-colors"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-3 h-3 rounded-full ${statusColors[status].split(' ')[0]}`} />
                  <h2 className="font-semibold text-gray-700">{statusLabels[status]}</h2>
                  <span className="ml-auto text-sm text-gray-400">
                    {getTasksByStatus(status).length}
                  </span>
                </div>
                
                <div className="space-y-3">
                  {getTasksByStatus(status).map(task => (
                    <DraggableTaskCard
                      key={task.id}
                      task={task}
                      onClick={() => setEditingTask(task)}
                    />
                  ))}
                </div>
              </DroppableColumn>
            ))}
          </div>
        )}

        {/* Team View */}
        {view === 'team' && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {TEAM_MEMBERS.map(member => {
              const activeTasks = getTasksByMember(member.id)
              const archivedTasks = getArchivedTasksByMember(member.id)
              
              return (
                <DroppableColumn
                  key={member.id}
                  id={`member-${member.id}`}
                  className="bg-gray-50 rounded-xl p-4 min-h-[400px] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm">
                      {member.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-gray-700 text-sm truncate">{member.name.split(' ')[0]}</h2>
                      <p className="text-xs text-gray-400">{activeTasks.length} active</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3 mb-4">
                    {activeTasks.map(task => (
                      <DraggableTaskCard
                        key={task.id}
                        task={task}
                        onClick={() => setEditingTask(task)}
                        showStatus
                      />
                    ))}
                    {activeTasks.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-4">No active tasks</p>
                    )}
                  </div>

                  {archivedTasks.length > 0 && (
                    <div className="border-t border-gray-200 pt-3">
                      <p className="text-xs text-gray-400 mb-2">Completed ({archivedTasks.length})</p>
                      <div className="space-y-2 opacity-60">
                        {archivedTasks.slice(0, 3).map(task => (
                          <div 
                            key={task.id} 
                            className="bg-white rounded-lg p-3 text-sm cursor-pointer hover:opacity-100 transition"
                            onClick={() => setEditingTask(task)}
                          >
                            <p className="text-gray-600 line-clamp-1">{task.title}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </DroppableColumn>
              )
            })}
          </div>
        )}

        <DragOverlay>
          {activeTask && (
            <div className="bg-white rounded-lg p-4 shadow-2xl border-2 border-purple-300 w-64 rotate-2">
              <h3 className="font-medium text-gray-900 mb-2">{activeTask.title}</h3>
              <p className="text-sm text-gray-500 line-clamp-2">{activeTask.description}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Workload View */}
      {view === 'workload' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TEAM_MEMBERS.map(member => {
            const workload = getWorkload(member.id)
            const maxTasks = 5
            const loadPercent = Math.min((workload.total / maxTasks) * 100, 100)
            
            return (
              <div key={member.id} className="bg-white rounded-xl p-5 shadow-sm border">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold">
                    {member.avatar}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{member.name}</h3>
                    <p className="text-sm text-gray-500">{member.role}</p>
                  </div>
                </div>
                
                <div className="mb-3">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Workload</span>
                    <span className="font-medium">{workload.total} tasks</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${
                        loadPercent > 80 ? 'bg-red-500' : loadPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${loadPercent}%` }}
                    />
                  </div>
                </div>
                
                <div className="flex gap-2 text-xs">
                  {workload.urgent > 0 && (
                    <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
                      {workload.urgent} urgent
                    </span>
                  )}
                  {workload.high > 0 && (
                    <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded">
                      {workload.high} high
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">Task</th>
                <th className="text-left p-4 font-medium text-gray-600">Workflow</th>
                <th className="text-left p-4 font-medium text-gray-600">Assignee</th>
                <th className="text-left p-4 font-medium text-gray-600">Priority</th>
                <th className="text-left p-4 font-medium text-gray-600">Status</th>
                <th className="text-left p-4 font-medium text-gray-600">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => {
                const member = TEAM_MEMBERS.find(m => m.id === task.assignee)
                const workflow = WORKFLOWS.find(w => w.id === task.workflow)
                const subWorkflow = WORKFLOWS.find(w => w.id === task.subWorkflow)
                return (
                  <tr 
                    key={task.id} 
                    className="border-b hover:bg-gray-50 cursor-pointer"
                    onClick={() => setEditingTask(task)}
                  >
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="text-sm text-gray-500 line-clamp-1">{task.description}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        {workflow && (
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full text-white w-fit ${workflow.color}`}>
                            {workflow.name}
                          </span>
                        )}
                        {subWorkflow && (
                          <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full text-white w-fit ${subWorkflow.color}`}>
                            ↳ {subWorkflow.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {member && (
                          <>
                            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-medium">
                              {member.avatar}
                            </div>
                            <span className="text-gray-700">{member.name.split(' ')[0]}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${priorityColors[task.priority]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${statusColors[task.status]}`}>
                        {statusLabels[task.status]}
                      </span>
                    </td>
                    <td className="p-4 text-gray-600 whitespace-nowrap">
                      {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Edit Modal */}
      {editingTask && (
        <TaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleSaveTask}
        />
      )}

      {/* Instructions */}
      <div className="mt-8 text-center text-sm text-gray-400">
        <p>Click card to edit • Drag the ⋮⋮ handle to move</p>
      </div>
    </main>
  )
}
