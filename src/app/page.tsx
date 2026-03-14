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
const INITIAL_WORKFLOWS = [
  { id: 'event-4', name: '#4 The Great Lock-In', short: '#4', color: 'bg-purple-500' },
  { id: 'event-3', name: '#3 Degree Apprenticeship', short: '#3', color: 'bg-blue-500' },
  { id: 'event-2', name: '#2 Oxbridge Workshop', short: '#2', color: 'bg-indigo-500' },
  { id: 'event-1', name: '#1 Starting Point', short: '#1', color: 'bg-violet-500' },
  { id: 'schools', name: 'Schools', short: 'SCH', color: 'bg-green-500' },
  { id: 'partnerships', name: 'Partnerships', short: 'PTN', color: 'bg-amber-500' },
  { id: 'steps-scholars', name: 'Steps Scholars', short: 'SS', color: 'bg-rose-500' },
  { id: 'student-engagement', name: 'Student Engagement', short: 'ENG', color: 'bg-cyan-500' },
]

// Workflow color options
const WORKFLOW_COLORS = [
  'bg-purple-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500',
  'bg-green-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
  'bg-pink-500', 'bg-teal-500', 'bg-orange-500', 'bg-emerald-500',
]

// Template tasks for new events
const EVENT_TEMPLATE_TASKS = [
  { title: 'Create event poster', description: 'Design main promotional poster in Canva', priority: 'high' as Priority },
  { title: 'Create sign-up form', description: 'Set up Google Form for event registration', priority: 'high' as Priority },
  { title: 'Write LinkedIn post copy', description: 'Draft promotional copy for LinkedIn announcement', priority: 'medium' as Priority },
  { title: 'Create TikTok content', description: 'Film and edit TikTok promotional video', priority: 'medium' as Priority },
  { title: 'Write acceptance email', description: 'Draft email template for accepted applicants', priority: 'medium' as Priority },
  { title: 'Write rejection email', description: 'Draft email template for unsuccessful applicants', priority: 'low' as Priority },
  { title: 'Create event schedule', description: 'Plan detailed minute-by-minute schedule for event day', priority: 'high' as Priority },
  { title: 'Confirm venue booking', description: 'Finalise venue reservation and logistics', priority: 'urgent' as Priority },
  { title: 'Recruit volunteers', description: 'Reach out to volunteers and confirm availability', priority: 'medium' as Priority },
  { title: 'Prepare attendee materials', description: 'Print name badges, handouts, and signage', priority: 'medium' as Priority },
  { title: 'Send reminder emails', description: 'Email confirmed attendees 1 week and 1 day before', priority: 'medium' as Priority },
  { title: 'Book catering', description: 'Arrange food and refreshments for attendees', priority: 'high' as Priority },
  { title: 'Create feedback form', description: 'Set up post-event feedback survey', priority: 'low' as Priority },
  { title: 'Reach out to speakers', description: 'Invite and confirm speakers/panelists', priority: 'urgent' as Priority },
  { title: 'Brief speakers', description: 'Send speaker pack with logistics and expectations', priority: 'medium' as Priority },
  { title: 'Sponsor outreach', description: 'Contact potential sponsors for the event', priority: 'medium' as Priority },
  { title: 'School outreach', description: 'Email target schools to promote event', priority: 'high' as Priority },
  { title: 'Social media campaign', description: 'Schedule promotional posts across platforms', priority: 'medium' as Priority },
]

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Status = 'todo' | 'in-progress' | 'review' | 'done'

interface Task {
  id: number
  title: string
  description: string
  assignee: number
  collaborators: number[]
  subtasks: Subtask[]
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
    subtasks: [
      { id: 1, personId: 1, description: 'Edit video and add captions' },
      { id: 2, personId: 3, description: 'Review and approve final cut' },
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
      { id: 3, personId: 3, description: 'Send follow-up emails to all speakers' },
      { id: 4, personId: 1, description: 'Coordinate travel arrangements' },
      { id: 5, personId: 2, description: 'Prepare speaker briefing packs' },
    ],
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
    subtasks: [],
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
    subtasks: [],
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
    subtasks: [],
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
    subtasks: [],
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
    subtasks: [],
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
  showStatus = false,
  workflows,
}: { 
  task: Task
  onClick: () => void
  showStatus?: boolean
  workflows: Workflow[]
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 1000,
  } : undefined

  const member = task.assignee ? TEAM_MEMBERS.find(m => m.id === task.assignee) : null
  const workflow = workflows.find(w => w.id === task.workflow)
  const subWorkflow = workflows.find(w => w.id === task.subWorkflow)

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
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${workflow.color}`}>
            {workflow.short}
          </span>
          {subWorkflow && (
            <>
              <span className="text-gray-400 text-xs">›</span>
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${subWorkflow.color}`}>
                {subWorkflow.short}
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
          {member ? (
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-xs font-medium border-2 border-white" title={member.name}>
              {member.avatar.charAt(0)}
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs border-2 border-white" title="Unassigned">
              ?
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
  onSave,
  workflows,
}: { 
  task: Task
  onClose: () => void
  onSave: (updatedTask: Task) => void
  workflows: Workflow[]
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

  const currentWorkflow = workflows.find(w => w.id === editedTask.workflow)
  const currentSubWorkflow = workflows.find(w => w.id === editedTask.subWorkflow)

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
                {workflows.map(w => (
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
                {workflows.filter(w => w.id !== editedTask.workflow).map(w => (
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

          {/* Subtasks - what each person is doing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">What each person is doing</label>
              <button
                type="button"
                onClick={() => {
                  const newSubtask: Subtask = {
                    id: Date.now(),
                    personId: editedTask.assignee || 0,
                    description: '',
                  }
                  setEditedTask({
                    ...editedTask,
                    subtasks: [...editedTask.subtasks, newSubtask],
                  })
                }}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                + Add subtask
              </button>
            </div>
            
            {editedTask.subtasks.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                No subtasks yet. Add one to specify what each person is responsible for.
              </p>
            ) : (
              <div className="space-y-3">
                {editedTask.subtasks.map((subtask, index) => {
                  const person = TEAM_MEMBERS.find(m => m.id === subtask.personId)
                  return (
                    <div key={subtask.id} className="flex gap-3 items-start p-3 bg-gray-50 rounded-lg">
                      <select
                        value={subtask.personId}
                        onChange={e => {
                          const newSubtasks = [...editedTask.subtasks]
                          newSubtasks[index] = { ...subtask, personId: parseInt(e.target.value) }
                          setEditedTask({ ...editedTask, subtasks: newSubtasks })
                        }}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none min-w-[140px]"
                      >
                        <option value={0}>Unassigned</option>
                        {TEAM_MEMBERS.map(m => (
                          <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
                        ))}
                      </select>
                      <div className="flex-1">
                        <input
                          type="text"
                          value={subtask.description}
                          onChange={e => {
                            const newSubtasks = [...editedTask.subtasks]
                            newSubtasks[index] = { ...subtask, description: e.target.value }
                            setEditedTask({ ...editedTask, subtasks: newSubtasks })
                          }}
                          placeholder="What are they doing?"
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setEditedTask({
                            ...editedTask,
                            subtasks: editedTask.subtasks.filter((_, i) => i !== index),
                          })
                        }}
                        className="p-2 text-gray-400 hover:text-red-500 transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
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

// Workflow type
interface Workflow {
  id: string
  name: string
  short: string
  color: string
  archived?: boolean
}

// Subtask type - each person's specific work on a task
interface Subtask {
  id: number
  personId: number
  description: string
}

// New Workflow Modal with Template Tasks
function NewWorkflowModal({
  onClose,
  onSave,
}: {
  onClose: () => void
  onSave: (workflow: Workflow, tasks: Task[]) => void
}) {
  const [name, setName] = useState('')
  const [short, setShort] = useState('')
  const [color, setColor] = useState('bg-purple-500')
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(
    new Set(EVENT_TEMPLATE_TASKS.map((_, i) => i))
  )

  const toggleTask = (index: number) => {
    setSelectedTasks(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedTasks(new Set(EVENT_TEMPLATE_TASKS.map((_, i) => i)))
  }

  const selectNone = () => {
    setSelectedTasks(new Set())
  }

  const handleCreate = () => {
    if (!name.trim() || !short.trim()) return

    const workflowId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const newWorkflow: Workflow = {
      id: workflowId,
      name: name.trim(),
      short: short.trim().toUpperCase(),
      color,
    }

    const newTasks: Task[] = Array.from(selectedTasks).map((index, i) => {
      const template = EVENT_TEMPLATE_TASKS[index]
      return {
        id: Date.now() + i,
        title: template.title,
        description: template.description,
        assignee: 0, // Unassigned
        collaborators: [],
        subtasks: [],
        priority: template.priority,
        status: 'todo' as Status,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        createdAt: new Date().toISOString().split('T')[0],
        workflow: workflowId,
        subWorkflow: null,
      }
    })

    onSave(newWorkflow, newTasks)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Create New Workflow</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Workflow Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Workflow Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. #5 Summer Conference"
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Short Name (for badges)</label>
              <input
                type="text"
                value={short}
                onChange={e => setShort(e.target.value)}
                placeholder="e.g. #5"
                maxLength={5}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {WORKFLOW_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full ${c} ${color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                />
              ))}
            </div>
            {name && short && (
              <div className="mt-3">
                <span className={`inline-flex items-center text-xs font-medium px-3 py-1 rounded text-white ${color}`}>
                  {short.toUpperCase() || 'TAG'}
                </span>
                <span className="ml-2 text-sm text-gray-500">{name || 'Workflow Name'}</span>
              </div>
            )}
          </div>

          {/* Template Tasks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-700">Template Tasks</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-purple-600 hover:text-purple-700"
                >
                  Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={selectNone}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Select None
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              Select the tasks to include. {selectedTasks.size} of {EVENT_TEMPLATE_TASKS.length} selected.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y">
              {EVENT_TEMPLATE_TASKS.map((task, index) => (
                <label
                  key={index}
                  className={`flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                    selectedTasks.has(index) ? 'bg-purple-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedTasks.has(index)}
                    onChange={() => toggleTask(index)}
                    className="mt-1 w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{task.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        task.priority === 'urgent' ? 'bg-red-100 text-red-700 border-red-200' :
                        task.priority === 'high' ? 'bg-orange-100 text-orange-700 border-orange-200' :
                        task.priority === 'medium' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                        'bg-gray-100 text-gray-700 border-gray-200'
                      }`}>
                        {task.priority}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{task.description}</p>
                  </div>
                </label>
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
            onClick={handleCreate}
            disabled={!name.trim() || !short.trim()}
            className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Workflow ({selectedTasks.size} tasks)
          </button>
        </div>
      </div>
    </div>
  )
}

// Edit Workflow Modal
function EditWorkflowModal({
  workflow,
  onClose,
  onSave,
  onArchive,
  onDelete,
}: {
  workflow: Workflow
  onClose: () => void
  onSave: (updated: Workflow) => void
  onArchive: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(workflow.name)
  const [short, setShort] = useState(workflow.short)
  const [color, setColor] = useState(workflow.color)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleSave = () => {
    if (!name.trim() || !short.trim()) return
    onSave({
      ...workflow,
      name: name.trim(),
      short: short.trim().toUpperCase(),
      color,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Edit Workflow</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Workflow Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Short Name</label>
            <input
              type="text"
              value={short}
              onChange={e => setShort(e.target.value)}
              maxLength={5}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {WORKFLOW_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full ${c} ${color === c ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
                />
              ))}
            </div>
          </div>
          <div className="pt-2">
            <span className={`inline-flex items-center text-xs font-medium px-3 py-1 rounded text-white ${color}`}>
              {short.toUpperCase()}
            </span>
            <span className="ml-2 text-sm text-gray-500">{name}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t bg-gray-50">
          {!showDeleteConfirm ? (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { onArchive(); onClose(); }}
                  className="px-4 py-2 text-amber-600 font-medium hover:bg-amber-50 rounded-lg transition"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded-lg transition"
                >
                  Delete
                </button>
              </div>
              <div className="flex gap-3">
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
                  disabled={!name.trim() || !short.trim()}
                  className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <div className="w-full">
              <p className="text-sm text-gray-600 mb-3">Delete this workflow permanently? Consider archiving instead.</p>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { onDelete(); onClose(); }}
                  className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition"
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [workflows, setWorkflows] = useState<Workflow[]>(INITIAL_WORKFLOWS)
  const [view, setView] = useState<'board' | 'team' | 'list' | 'workload'>('board')
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showNewWorkflowModal, setShowNewWorkflowModal] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  
  // Global workflow filter (applies to all views)
  const [globalWorkflow, setGlobalWorkflow] = useState<string>('all')
  
  // List view filters & sorting
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'status' | 'workflow'>('dueDate')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  
  // Get tasks filtered by global workflow
  const getGlobalFilteredTasks = () => {
    if (globalWorkflow === 'all') return tasks
    return tasks.filter(t => t.workflow === globalWorkflow || t.subWorkflow === globalWorkflow)
  }

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

  const filteredTasks = getGlobalFilteredTasks()
  const getTasksByStatus = (status: Status) => filteredTasks.filter(t => t.status === status)
  const getTasksByMember = (memberId: number) => filteredTasks.filter(t => t.assignee === memberId && t.status !== 'done')
  const getArchivedTasksByMember = (memberId: number) => filteredTasks.filter(t => t.assignee === memberId && t.status === 'done')
  const getUnassignedTasks = () => filteredTasks.filter(t => !t.assignee && t.status !== 'done')
  const getUnassignedArchivedTasks = () => filteredTasks.filter(t => !t.assignee && t.status === 'done')
  
  const getWorkload = (memberId: number) => {
    const memberTasks = filteredTasks.filter(t => t.assignee === memberId && t.status !== 'done')
    return {
      total: memberTasks.length,
      urgent: memberTasks.filter(t => t.priority === 'urgent').length,
      high: memberTasks.filter(t => t.priority === 'high').length,
    }
  }

  // Filtered and sorted tasks for list view
  const getFilteredSortedTasks = () => {
    let filtered = [...filteredTasks]
    if (filterStatus !== 'all') {
      filtered = filtered.filter(t => t.status === filterStatus)
    }
    if (filterAssignee !== 'all') {
      filtered = filtered.filter(t => t.assignee === parseInt(filterAssignee))
    }
    
    const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    const statusOrder: Record<Status, number> = { 'todo': 0, 'in-progress': 1, 'review': 2, 'done': 3 }
    
    filtered.sort((a, b) => {
      let comparison = 0
      switch (sortBy) {
        case 'dueDate':
          comparison = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
          break
        case 'priority':
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority]
          break
        case 'status':
          comparison = statusOrder[a.status] - statusOrder[b.status]
          break
        case 'workflow':
          comparison = (a.workflow || '').localeCompare(b.workflow || '')
          break
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })
    
    return filtered
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
            // Only add old assignee as collaborator if they were assigned (not 0/unassigned)
            if (oldAssigneeId && !newCollaborators.includes(oldAssigneeId)) {
              newCollaborators.push(oldAssigneeId)
            }
            return {
              ...t,
              assignee: newAssigneeId,
              collaborators: newAssigneeId === 0 ? [] : newCollaborators,
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

  const handleCreateWorkflow = (newWorkflow: Workflow, newTasks: Task[]) => {
    setWorkflows(prev => [...prev, newWorkflow])
    setTasks(prev => [...prev, ...newTasks])
    setGlobalWorkflow(newWorkflow.id)
  }

  const handleUpdateWorkflow = (updated: Workflow) => {
    setWorkflows(prev => prev.map(w => w.id === updated.id ? updated : w))
  }

  const handleArchiveWorkflow = (workflowId: string) => {
    setWorkflows(prev => prev.map(w => 
      w.id === workflowId ? { ...w, archived: true } : w
    ))
    if (globalWorkflow === workflowId) {
      setGlobalWorkflow('all')
    }
  }

  const handleUnarchiveWorkflow = (workflowId: string) => {
    setWorkflows(prev => prev.map(w => 
      w.id === workflowId ? { ...w, archived: false } : w
    ))
  }

  const handleDeleteWorkflow = (workflowId: string) => {
    setWorkflows(prev => prev.filter(w => w.id !== workflowId))
    if (globalWorkflow === workflowId) {
      setGlobalWorkflow('all')
    }
  }

  const activeWorkflows = workflows.filter(w => !w.archived)
  const archivedWorkflows = workflows.filter(w => w.archived)

  return (
    <main className="min-h-screen p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
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

      {/* Global Workflow Filter */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-600">Showing:</span>
        <button
          onClick={() => setShowNewWorkflowModal(true)}
          className="px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Workflow
        </button>
        <select
          value={globalWorkflow}
          onChange={(e) => setGlobalWorkflow(e.target.value)}
          className={`px-4 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
            globalWorkflow !== 'all' ? 'border-purple-500 text-purple-700 font-medium' : 'border-gray-200'
          }`}
        >
          <option value="all">All Workflows</option>
          <optgroup label="Active">
            {activeWorkflows.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </optgroup>
          {archivedWorkflows.length > 0 && (
            <optgroup label="Archived">
              {archivedWorkflows.map(w => (
                <option key={w.id} value={w.id}>{w.name} (archived)</option>
              ))}
            </optgroup>
          )}
        </select>
        {globalWorkflow !== 'all' && (
          <>
            {(() => {
              const wf = workflows.find(w => w.id === globalWorkflow)
              return wf ? (
                <>
                  <span className={`inline-flex items-center text-xs font-medium px-3 py-1 rounded-full text-white ${wf.color}`}>
                    {wf.name}
                  </span>
                  <button
                    onClick={() => setEditingWorkflow(wf)}
                    className="text-sm text-purple-600 hover:text-purple-700"
                  >
                    Edit
                  </button>
                </>
              ) : null
            })()}
            <button
              onClick={() => setGlobalWorkflow('all')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ✕ Clear
            </button>
          </>
        )}
        <span className="ml-auto text-sm text-gray-400">
          {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
        </span>
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
                      workflows={workflows}
                    />
                  ))}
                </div>
              </DroppableColumn>
            ))}
          </div>
        )}

        {/* Team View */}
        {view === 'team' && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-4">
            {/* Unassigned Column */}
            <DroppableColumn
              id="member-0"
              className="bg-gray-100 rounded-xl p-4 min-h-[400px] transition-colors border-2 border-dashed border-gray-300"
            >
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-300">
                <div className="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-bold text-sm">
                  ?
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-700 text-sm">Unassigned</h2>
                  <p className="text-xs text-gray-400">{getUnassignedTasks().length} tasks</p>
                </div>
              </div>
              
              <div className="space-y-3 mb-4">
                {getUnassignedTasks().map(task => (
                  <DraggableTaskCard
                    key={task.id}
                    task={task}
                    onClick={() => setEditingTask(task)}
                    showStatus
                    workflows={workflows}
                  />
                ))}
                {getUnassignedTasks().length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">No unassigned tasks</p>
                )}
              </div>

              {getUnassignedArchivedTasks().length > 0 && (
                <div className="border-t border-gray-300 pt-3">
                  <p className="text-xs text-gray-400 mb-2">Completed ({getUnassignedArchivedTasks().length})</p>
                  <div className="space-y-2 opacity-60">
                    {getUnassignedArchivedTasks().slice(0, 3).map(task => (
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
                        workflows={workflows}
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
        <div className="space-y-4">
          {/* Sort Order Toggle + Count */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm hover:bg-gray-50 transition"
            >
              <span className="text-gray-600">Sort:</span>
              <span className="font-medium">{sortOrder === 'asc' ? 'Ascending ↑' : 'Descending ↓'}</span>
            </button>
            <div className="flex items-center gap-4">
              {(filterStatus !== 'all' || filterAssignee !== 'all') && (
                <button
                  onClick={() => {
                    setFilterStatus('all')
                    setFilterAssignee('all')
                  }}
                  className="text-sm text-purple-600 hover:text-purple-700"
                >
                  Clear filters
                </button>
              )}
              <span className="text-sm text-gray-500">
                {getFilteredSortedTasks().length} of {tasks.length} tasks
              </span>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-4 font-medium text-gray-600">Task</th>
                  <th className="text-left p-4 font-medium text-gray-600">
                    <button
                      onClick={() => setSortBy('workflow')}
                      className={`hover:text-purple-600 ${sortBy === 'workflow' ? 'text-purple-600 font-semibold' : ''}`}
                    >
                      Workflow {sortBy === 'workflow' ? (sortOrder === 'asc' ? '↑' : '↓') : '▾'}
                    </button>
                  </th>
                  <th className="text-left p-4 font-medium text-gray-600">
                    <div className="relative inline-block">
                      <select
                        value={filterAssignee}
                        onChange={(e) => setFilterAssignee(e.target.value)}
                        className={`appearance-none bg-transparent pr-6 cursor-pointer hover:text-purple-600 outline-none ${filterAssignee !== 'all' ? 'text-purple-600 font-semibold' : ''}`}
                      >
                        <option value="all">Assignee ▾</option>
                        {TEAM_MEMBERS.map(m => (
                          <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
                        ))}
                      </select>
                    </div>
                  </th>
                  <th className="text-left p-4 font-medium text-gray-600">
                    <button
                      onClick={() => setSortBy('priority')}
                      className={`hover:text-purple-600 ${sortBy === 'priority' ? 'text-purple-600 font-semibold' : ''}`}
                    >
                      Priority {sortBy === 'priority' ? (sortOrder === 'asc' ? '↑' : '↓') : '▾'}
                    </button>
                  </th>
                  <th className="text-left p-4 font-medium text-gray-600">
                    <div className="relative inline-block">
                      <select
                        value={filterStatus}
                        onChange={(e) => {
                          setFilterStatus(e.target.value)
                          setSortBy('status')
                        }}
                        className={`appearance-none bg-transparent pr-6 cursor-pointer hover:text-purple-600 outline-none ${filterStatus !== 'all' ? 'text-purple-600 font-semibold' : ''}`}
                      >
                        <option value="all">Status ▾</option>
                        <option value="todo">To Do</option>
                        <option value="in-progress">In Progress</option>
                        <option value="review">Review</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                  </th>
                  <th className="text-left p-4 font-medium text-gray-600">
                    <button
                      onClick={() => setSortBy('dueDate')}
                      className={`hover:text-purple-600 ${sortBy === 'dueDate' ? 'text-purple-600 font-semibold' : ''}`}
                    >
                      Due {sortBy === 'dueDate' ? (sortOrder === 'asc' ? '↑' : '↓') : '▾'}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {getFilteredSortedTasks().map(task => {
                  const member = TEAM_MEMBERS.find(m => m.id === task.assignee)
                  const workflow = workflows.find(w => w.id === task.workflow)
                  const subWorkflow = workflows.find(w => w.id === task.subWorkflow)
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
                        <div className="flex items-center gap-1">
                          {workflow && (
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${workflow.color}`}>
                              {workflow.short}
                            </span>
                          )}
                          {subWorkflow && (
                            <>
                              <span className="text-gray-400 text-xs">›</span>
                              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${subWorkflow.color}`}>
                                {subWorkflow.short}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {member ? (
                            <>
                              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-medium">
                                {member.avatar}
                              </div>
                              <span className="text-gray-700">{member.name.split(' ')[0]}</span>
                            </>
                          ) : (
                            <>
                              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium">
                                ?
                              </div>
                              <span className="text-gray-400">Unassigned</span>
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
        </div>
      )}

      {/* Task Edit Modal */}
      {editingTask && (
        <TaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleSaveTask}
          workflows={workflows}
        />
      )}

      {/* New Workflow Modal */}
      {showNewWorkflowModal && (
        <NewWorkflowModal
          onClose={() => setShowNewWorkflowModal(false)}
          onSave={handleCreateWorkflow}
        />
      )}

      {/* Edit Workflow Modal */}
      {editingWorkflow && (
        <EditWorkflowModal
          workflow={editingWorkflow}
          onClose={() => setEditingWorkflow(null)}
          onSave={handleUpdateWorkflow}
          onArchive={() => handleArchiveWorkflow(editingWorkflow.id)}
          onDelete={() => handleDeleteWorkflow(editingWorkflow.id)}
        />
      )}

      {/* Instructions */}
      <div className="mt-8 text-center text-sm text-gray-400">
        <p>Click card to edit • Drag the ⋮⋮ handle to move</p>
      </div>
    </main>
  )
}
