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
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false)
  
  // Check if there are unsaved changes
  const hasChanges = JSON.stringify(editedTask) !== JSON.stringify(task)
  
  const handleClose = () => {
    if (hasChanges) {
      setShowUnsavedPrompt(true)
    } else {
      onClose()
    }
  }

  const toggleCollaborator = (memberId: number) => {
    if (memberId === editedTask.assignee) return
    
    const isRemoving = editedTask.collaborators.includes(memberId)
    
    if (isRemoving) {
      // Removing collaborator: set their subtasks to unassigned (don't delete)
      setEditedTask(prev => ({
        ...prev,
        collaborators: prev.collaborators.filter(id => id !== memberId),
        subtasks: prev.subtasks.map(st => 
          st.personId === memberId ? { ...st, personId: 0 } : st
        )
      }))
    } else {
      // Adding collaborator: assign to unassigned subtask or create new one
      const unassignedSubtaskIndex = editedTask.subtasks.findIndex(st => st.personId === 0)
      
      let newSubtasks = [...editedTask.subtasks]
      if (unassignedSubtaskIndex !== -1) {
        // Assign to existing unassigned subtask
        newSubtasks[unassignedSubtaskIndex] = {
          ...newSubtasks[unassignedSubtaskIndex],
          personId: memberId
        }
      } else {
        // Create new subtask for them
        newSubtasks.push({
          id: Date.now(),
          personId: memberId,
          description: '',
          intensity: 'small'
        })
      }
      
      setEditedTask(prev => ({
        ...prev,
        collaborators: [...prev.collaborators, memberId],
        subtasks: newSubtasks
      }))
    }
  }

  const handleSave = () => {
    onSave(editedTask)
    onClose()
  }

  const currentWorkflow = workflows.find(w => w.id === editedTask.workflow)
  const currentSubWorkflow = workflows.find(w => w.id === editedTask.subWorkflow)

  return (
    <>
    {/* Unsaved changes prompt */}
    {showUnsavedPrompt && (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
        <div className="bg-white rounded-xl p-6 max-w-sm shadow-2xl">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Unsaved Changes</h3>
          <p className="text-gray-600 mb-4">You have unsaved changes. Would you like to save them?</p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => { setShowUnsavedPrompt(false); onClose(); }}
              className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
            >
              Discard
            </button>
            <button
              onClick={() => { handleSave(); }}
              className="px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )}
    
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Edit Task</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-2">
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
                  onClick={() => {
                    const newAssignee = member.id
                    const filteredCollabs = editedTask.collaborators.filter(id => id !== member.id)
                    
                    // Auto-create subtask for assignee if no subtasks exist
                    let newSubtasks = editedTask.subtasks
                    if (editedTask.subtasks.length === 0) {
                      newSubtasks = [{
                        id: Date.now(),
                        personId: newAssignee,
                        description: '',
                        intensity: 'small' as Intensity,
                      }]
                    }
                    
                    setEditedTask({ 
                      ...editedTask, 
                      assignee: newAssignee,
                      collaborators: filteredCollabs,
                      subtasks: newSubtasks,
                    })
                  }}
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
                    intensity: 'small',
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
                      <select
                        value={subtask.intensity}
                        onChange={e => {
                          const newSubtasks = [...editedTask.subtasks]
                          newSubtasks[index] = { ...subtask, intensity: e.target.value as Intensity }
                          setEditedTask({ ...editedTask, subtasks: newSubtasks })
                        }}
                        className={`px-2 py-2 border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${intensityColors[subtask.intensity]}`}
                      >
                        {INTENSITY_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
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
            onClick={handleClose}
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
    </>
  )
}

// Suggested task from meeting notes parser
interface SuggestedTask {
  id: number
  title: string
  description: string
  assignee: number
  collaborators: number[]
  subtasks: Subtask[]
  priority: Priority
  status: Status
  workflow: string | null
  selected: boolean
  dueDate?: string // Parsed from notes, e.g., "2026-03-14"
}

// Meeting Notes Parser Modal
function MeetingNotesModal({
  onClose,
  onAddTasks,
  workflows,
}: {
  onClose: () => void
  onAddTasks: (tasks: Task[]) => void
  workflows: Workflow[]
}) {
  const [notes, setNotes] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [suggestedTasks, setSuggestedTasks] = useState<SuggestedTask[]>([])
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<number | null>(null)

  const analyzeNotes = async () => {
    if (!notes.trim()) return
    setIsAnalyzing(true)
    
    // Parse meeting notes to extract tasks
    // Supports both structured lists (- Person: - task) and free-form notes
    const lines = notes.split('\n').map(l => l.trim())
    const tasks: SuggestedTask[] = []
    
    // Team member names and nicknames
    const memberAliases: { id: number; names: string[] }[] = [
      { id: 1, names: ["god'sfavour", "godsfavour", "favour", "fav", "you (favour)", "you(favour)"] },
      { id: 2, names: ["jin", "jim"] },
      { id: 3, names: ["daniyaal", "danny", "dani", "dan", "dany"] },
      { id: 4, names: ["sam", "samuel"] },
      { id: 5, names: ["earl"] },
      { id: 6, names: ["aditya", "adi"] },
    ]
    
    // Find team member by name/nickname
    const findMember = (text: string): number => {
      const lower = text.toLowerCase()
      for (const member of memberAliases) {
        for (const name of member.names) {
          if (lower.includes(name)) {
            return member.id
          }
        }
      }
      return 0 // Unassigned
    }
    
    // Parse date from text like "by Thu 12 Mar 2026" or "Fri 13 Mar 2026" or "~Sun 22 Mar 2026"
    const parseDate = (text: string): string | null => {
      // Match patterns like "by Thu 12 Mar 2026", "Fri 13 Mar 2026", "~Sun 22 Mar 2026"
      const dateMatch = text.match(/(?:by\s+|~\s*)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i)
      if (dateMatch) {
        const months: Record<string, string> = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        }
        const day = dateMatch[1].padStart(2, '0')
        const month = months[dateMatch[2].toLowerCase()]
        const year = dateMatch[3]
        return `${year}-${month}-${day}`
      }
      return null
    }
    
    // Estimate intensity based on keywords
    const estimateIntensity = (text: string): Intensity => {
      const lower = text.toLowerCase()
      if (/quick|simple|small|minor|brief|short|call|email|message|respond|reply/.test(lower)) return 'quick'
      if (/lead overall|co-lead|take over|drive|ongoing|full|complete|entire|comprehensive/.test(lower)) return 'huge'
      if (/lead on|significant|substantial|large|coordinate|finalise|finalize/.test(lower)) return 'large'
      if (/prepare|create|set up|setup|design|write|draft|plan/.test(lower)) return 'medium'
      return 'small'
    }
    
    // Estimate priority based on date proximity and keywords
    const estimatePriority = (text: string, dueDate: string | null): Priority => {
      const lower = text.toLowerCase()
      
      // Check keywords first
      if (/urgent|asap|immediately|critical|emergency/.test(lower)) return 'urgent'
      
      // Check date proximity
      if (dueDate) {
        const due = new Date(dueDate)
        const now = new Date()
        const daysUntil = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        if (daysUntil <= 2) return 'urgent'
        if (daysUntil <= 5) return 'high'
        if (daysUntil <= 14) return 'medium'
        return 'low'
      }
      
      if (/important|priority|soon|this week/.test(lower)) return 'high'
      if (/eventually|low priority|when possible|no rush/.test(lower)) return 'low'
      return 'medium'
    }
    
    // Extract clean title (remove date part)
    const extractTitle = (text: string): string => {
      let title = text
        .replace(/^[-•*]\s*/, '') // Remove bullet points
        .replace(/\s*[–-]\s*(?:by\s+|~\s*)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun).*$/i, '') // Remove date suffix
        .replace(/\s*;\s*(?:event day\s+)?~?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun).*$/i, '') // Remove secondary date
        .replace(/\s*[–-]\s*(?:ongoing|from\s+).*$/i, '') // Remove ongoing suffix
        .replace(/\s*[–-]\s*(?:between|per\s+).*$/i, '') // Remove date ranges
        .trim()
      
      title = title.charAt(0).toUpperCase() + title.slice(1)
      
      if (title.length > 80) {
        title = title.slice(0, 77) + '...'
      }
      
      return title
    }
    
    // Check if line is a person header (e.g., "- Adi" or "- You (Favour)")
    const isPersonHeader = (line: string): number => {
      // Match "- Name" or "- You (Name)" at start of line
      const headerMatch = line.match(/^-\s*(.+?)(?:\s*$|\s*\n)/)
      if (headerMatch) {
        const headerText = headerMatch[1].trim()
        // Check if this is a person name (not a task)
        if (headerText.length < 30 && !headerText.includes('–')) {
          return findMember(headerText)
        }
      }
      return -1 // Not a header
    }
    
    // Check if line is a task bullet
    const isTaskBullet = (line: string): boolean => {
      return /^\s*-\s+[A-Z]/.test(line) && line.length > 15
    }
    
    // Process structured format
    let currentAssignee = 0
    let isStructuredFormat = false
    
    // First pass: detect if this is structured format
    for (const line of lines) {
      if (isPersonHeader(line) !== -1 && line.match(/^-\s*\w+/)) {
        isStructuredFormat = true
        break
      }
    }
    
    if (isStructuredFormat) {
      // Structured format: parse by sections
      for (const line of lines) {
        if (!line) continue
        
        // Check for person header
        const headerAssignee = isPersonHeader(line)
        if (headerAssignee !== -1 && line.match(/^-\s*[A-Z]/) && !line.includes('–')) {
          // This looks like a header (short, no dash-date pattern)
          const possibleHeader = line.replace(/^-\s*/, '').trim()
          if (possibleHeader.length < 40 && findMember(possibleHeader) !== 0) {
            currentAssignee = findMember(possibleHeader)
            continue
          }
          // "You" or "You (Favour)" special case
          if (/^you\s*(\(|$)/i.test(possibleHeader)) {
            currentAssignee = 1 // Favour
            continue
          }
          // Team headers - unassigned
          if (/team|entire|everyone|all/i.test(possibleHeader)) {
            currentAssignee = 0
            continue
          }
        }
        
        // Check for task bullet (indented or starts with -)
        if (isTaskBullet(line) || (line.startsWith('-') && line.length > 20)) {
          const taskText = line.replace(/^[-•*]\s*/, '').trim()
          if (taskText.length < 15) continue
          
          const dueDate = parseDate(taskText)
          const title = extractTitle(taskText)
          
          // Find collaborators mentioned in the task
          const collaborators: number[] = []
          for (const member of memberAliases) {
            if (member.id !== currentAssignee) {
              for (const name of member.names) {
                if (taskText.toLowerCase().includes(name)) {
                  collaborators.push(member.id)
                  break
                }
              }
            }
          }
          
          // Build subtasks
          const subtasks: Subtask[] = []
          if (currentAssignee) {
            subtasks.push({
              id: Date.now() + tasks.length * 100,
              personId: currentAssignee,
              description: '',
              intensity: estimateIntensity(taskText),
            })
          }
          collaborators.forEach((collabId, j) => {
            subtasks.push({
              id: Date.now() + tasks.length * 100 + j + 1,
              personId: collabId,
              description: '',
              intensity: 'small',
            })
          })
          
          tasks.push({
            id: Date.now() + tasks.length,
            title,
            description: taskText,
            assignee: currentAssignee,
            collaborators,
            subtasks,
            priority: estimatePriority(taskText, dueDate),
            status: 'todo',
            workflow: selectedWorkflow,
            selected: true,
            dueDate: dueDate || undefined,
          })
        }
      }
    } else {
      // Free-form format: look for action verbs
      const actionVerbs = [
        'set up', 'setup', 'create', 'build', 'design', 'write', 'draft', 'prepare',
        'send', 'email', 'contact', 'reach out', 'follow up', 'call', 'message',
        'schedule', 'book', 'arrange', 'organize', 'coordinate', 'plan',
        'review', 'check', 'confirm', 'finalize', 'complete', 'finish',
        'interview', 'meet', 'discuss', 'present', 'pitch', 'attend',
        'update', 'edit', 'fix', 'resolve', 'handle', 'manage', 'lead',
        'research', 'find', 'look into', 'investigate',
        'post', 'publish', 'share', 'announce', 'film', 'work with',
      ]
      
      const noisePatterns = [
        /catch up later/i, /call you later/i, /talk soon/i, /sounds good/i,
        /thanks|thank you/i, /no problem/i, /let me know/i,
        /yeah|yep|okay|ok|sure/i, /anyway|by the way/i,
      ]
      
      const sentences = notes.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15)
      const processed = new Set<string>()
      
      for (const sentence of sentences) {
        if (noisePatterns.some(p => p.test(sentence))) continue
        if (!actionVerbs.some(v => sentence.toLowerCase().includes(v))) continue
        
        const key = sentence.slice(0, 40).toLowerCase()
        if (processed.has(key)) continue
        processed.add(key)
        
        const assigneeId = findMember(sentence)
        const dueDate = parseDate(sentence)
        
        const collaborators: number[] = []
        for (const member of memberAliases) {
          if (member.id !== assigneeId && member.names.some(n => sentence.toLowerCase().includes(n))) {
            collaborators.push(member.id)
          }
        }
        
        const subtasks: Subtask[] = []
        if (assigneeId) {
          subtasks.push({
            id: Date.now() + tasks.length * 100,
            personId: assigneeId,
            description: '',
            intensity: estimateIntensity(sentence),
          })
        }
        
        tasks.push({
          id: Date.now() + tasks.length,
          title: extractTitle(sentence),
          description: sentence,
          assignee: assigneeId,
          collaborators,
          subtasks,
          priority: estimatePriority(sentence, dueDate),
          status: 'todo',
          workflow: selectedWorkflow,
          selected: true,
          dueDate: dueDate || undefined,
        })
        
        if (tasks.length >= 30) break
      }
    }
    
    // Simulate brief analysis time
    await new Promise(r => setTimeout(r, 500))
    
    setSuggestedTasks(tasks)
    setIsAnalyzing(false)
  }

  const toggleTaskSelection = (taskId: number) => {
    setSuggestedTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, selected: !t.selected } : t
    ))
  }

  const updateTask = (taskId: number, updates: Partial<SuggestedTask>) => {
    setSuggestedTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, ...updates } : t
    ))
  }

  const addSelectedTasks = () => {
    const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const tasksToAdd: Task[] = suggestedTasks
      .filter(t => t.selected)
      .map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        assignee: t.assignee,
        collaborators: t.collaborators,
        subtasks: t.subtasks,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate || defaultDueDate,
        createdAt: new Date().toISOString().split('T')[0],
        workflow: selectedWorkflow,
        subWorkflow: null,
      }))
    
    onAddTasks(tasksToAdd)
    onClose()
  }

  const activeWorkflows = workflows.filter(w => !w.archived)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Parse Meeting Notes</h2>
            <p className="text-sm text-gray-500 mt-1">Paste your meeting notes to auto-generate tasks</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {suggestedTasks.length === 0 ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Workflow (optional)</label>
                <select
                  value={selectedWorkflow || ''}
                  onChange={e => setSelectedWorkflow(e.target.value || null)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                >
                  <option value="">No workflow</option>
                  {activeWorkflows.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Meeting Notes / Transcript</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={12}
                  placeholder="Paste your meeting notes here...

Example:
- Favour will create the event poster by Friday
- Jin needs to confirm speakers ASAP
- Daniyaal should coordinate with the venue
- Sam to send email invites to schools"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none font-mono text-sm"
                />
              </div>
              
              <button
                onClick={analyzeNotes}
                disabled={!notes.trim() || isAnalyzing}
                className="w-full py-3 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Analyzing...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Analyze & Generate Tasks
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Found <span className="font-semibold">{suggestedTasks.length}</span> potential tasks. 
                  Select and edit before adding.
                </p>
                <button
                  onClick={() => setSuggestedTasks([])}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                >
                  ← Back to notes
                </button>
              </div>
              
              <div className="space-y-3">
                {suggestedTasks.map(task => {
                  const member = TEAM_MEMBERS.find(m => m.id === task.assignee)
                  const isEditing = editingTask === task.id
                  
                  return (
                    <div 
                      key={task.id} 
                      className={`border rounded-lg p-4 transition ${
                        task.selected ? 'border-purple-300 bg-purple-50/50' : 'border-gray-200 bg-gray-50 opacity-60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={task.selected}
                          onChange={() => toggleTaskSelection(task.id)}
                          className="mt-1 w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        
                        <div className="flex-1 min-w-0">
                          {isEditing ? (
                            <div className="space-y-3">
                              <input
                                type="text"
                                value={task.title}
                                onChange={e => updateTask(task.id, { title: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium"
                              />
                              <textarea
                                value={task.description}
                                onChange={e => updateTask(task.id, { description: e.target.value })}
                                rows={2}
                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                              />
                              <div className="flex gap-2 flex-wrap">
                                <select
                                  value={task.assignee}
                                  onChange={e => updateTask(task.id, { assignee: parseInt(e.target.value) })}
                                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                                >
                                  <option value={0}>Unassigned</option>
                                  {TEAM_MEMBERS.map(m => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                  ))}
                                </select>
                                <select
                                  value={task.priority}
                                  onChange={e => updateTask(task.id, { priority: e.target.value as Priority })}
                                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                                >
                                  <option value="low">Low</option>
                                  <option value="medium">Medium</option>
                                  <option value="high">High</option>
                                  <option value="urgent">Urgent</option>
                                </select>
                                <input
                                  type="date"
                                  value={task.dueDate || ''}
                                  onChange={e => updateTask(task.id, { dueDate: e.target.value })}
                                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                                />
                              </div>
                              <button
                                onClick={() => setEditingTask(null)}
                                className="text-sm text-purple-600 font-medium"
                              >
                                Done editing
                              </button>
                            </div>
                          ) : (
                            <>
                              <h4 className="font-medium text-gray-900 text-sm">{task.title}</h4>
                              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                {member ? (
                                  <span className="inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                    {member.avatar} {member.name.split(' ')[0]}
                                  </span>
                                ) : (
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Unassigned</span>
                                )}
                                <span className={`text-xs px-2 py-0.5 rounded ${priorityColors[task.priority]}`}>
                                  {task.priority}
                                </span>
                                {task.dueDate && (
                                  <span className="text-xs text-gray-500">
                                    📅 {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                                {task.collaborators.length > 0 && (
                                  <span className="text-xs text-gray-500">
                                    +{task.collaborators.length} collaborator{task.collaborators.length > 1 ? 's' : ''}
                                  </span>
                                )}
                                <button
                                  onClick={() => setEditingTask(task.id)}
                                  className="text-xs text-purple-600 hover:text-purple-700 ml-auto"
                                >
                                  Edit
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {suggestedTasks.length > 0 && (
          <div className="flex items-center justify-between gap-3 p-6 border-t bg-gray-50">
            <p className="text-sm text-gray-600">
              {suggestedTasks.filter(t => t.selected).length} of {suggestedTasks.length} tasks selected
            </p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={addSelectedTasks}
                disabled={suggestedTasks.filter(t => t.selected).length === 0}
                className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                Add {suggestedTasks.filter(t => t.selected).length} Tasks
              </button>
            </div>
          </div>
        )}
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

// Intensity levels for subtasks
type Intensity = 'quick' | 'small' | 'medium' | 'large' | 'huge'

const INTENSITY_OPTIONS: { value: Intensity; label: string; hours: number }[] = [
  { value: 'quick', label: 'Quick Win', hours: 0.33 },  // ~20 mins
  { value: 'small', label: 'Small', hours: 1 },
  { value: 'medium', label: 'Medium', hours: 3 },
  { value: 'large', label: 'Large', hours: 6 },
  { value: 'huge', label: 'Huge', hours: 8 },  // ~1 day
]

const intensityColors: Record<Intensity, string> = {
  quick: 'bg-green-100 text-green-700',
  small: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  large: 'bg-orange-100 text-orange-700',
  huge: 'bg-red-100 text-red-700',
}

// Subtask type - each person's specific work on a task
interface Subtask {
  id: number
  personId: number
  description: string
  intensity: Intensity
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
                {workflow.archived ? (
                  <button
                    type="button"
                    onClick={() => { onArchive(); onClose(); }}
                    className="px-4 py-2 text-green-600 font-medium hover:bg-green-50 rounded-lg transition"
                  >
                    Unarchive
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { onArchive(); onClose(); }}
                    className="px-4 py-2 text-amber-600 font-medium hover:bg-amber-50 rounded-lg transition"
                  >
                    Archive
                  </button>
                )}
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
  const [showMeetingNotesModal, setShowMeetingNotesModal] = useState(false)
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null)
  
  // Workload week view state
  const [selectedWeek, setSelectedWeek] = useState(() => {
    // Default to current week (Monday start)
    const today = new Date()
    const day = today.getDay()
    const diff = today.getDate() - day + (day === 0 ? -6 : 1) // Monday
    const monday = new Date(today.setDate(diff))
    return monday.toISOString().split('T')[0]
  })
  const [weekCapacities, setWeekCapacities] = useState<Record<string, Record<number, number>>>({})
  // weekCapacities format: { "2026-03-16": { 1: 8, 2: 6, 3: 10 } } (weekStart -> memberId -> hours)
  
  // Global workflow filter (applies to all views)
  const [globalWorkflow, setGlobalWorkflow] = useState<string>('all')
  
  // List view filters & sorting
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'status' | 'workflow'>('dueDate')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  
  // Helper to toggle sort
  const handleSortClick = (column: 'dueDate' | 'priority' | 'status' | 'workflow') => {
    if (sortBy === column) {
      // Same column - toggle order
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // Different column - set new column, reset to asc
      setSortBy(column)
      setSortOrder('asc')
    }
  }
  
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
  
  const getWorkload = (memberId: number, weekStart?: string) => {
    // Calculate workload from subtasks assigned to this person (in non-done tasks)
    let activeTasks = filteredTasks.filter(t => t.status !== 'done')
    
    // Filter by week if provided
    if (weekStart) {
      const weekStartDate = new Date(weekStart)
      const weekEndDate = new Date(weekStart)
      weekEndDate.setDate(weekEndDate.getDate() + 7)
      
      activeTasks = activeTasks.filter(t => {
        const dueDate = new Date(t.dueDate)
        return dueDate >= weekStartDate && dueDate < weekEndDate
      })
    }
    
    let totalHours = 0
    let subtaskCount = 0
    const intensityCounts: Record<Intensity, number> = { quick: 0, small: 0, medium: 0, large: 0, huge: 0 }
    
    activeTasks.forEach(task => {
      task.subtasks
        .filter(st => st.personId === memberId)
        .forEach(st => {
          const intensity = INTENSITY_OPTIONS.find(o => o.value === st.intensity)
          if (intensity) {
            totalHours += intensity.hours
            intensityCounts[st.intensity]++
            subtaskCount++
          }
        })
    })
    
    // Also count tasks where they're the assignee but have no subtask yet
    const assignedWithNoSubtask = activeTasks.filter(t => 
      t.assignee === memberId && !t.subtasks.some(st => st.personId === memberId)
    ).length
    
    // Assume medium intensity for unspecified work
    totalHours += assignedWithNoSubtask * 3
    
    return {
      hours: totalHours,
      subtasks: subtaskCount,
      unspecified: assignedWithNoSubtask,
      byIntensity: intensityCounts,
    }
  }
  
  // Get capacity for a member for a specific week
  const getMemberCapacity = (memberId: number, weekStart: string): number => {
    return weekCapacities[weekStart]?.[memberId] ?? 16 // Default 16h (2 days)
  }
  
  // Set capacity for a member for a specific week
  const setMemberCapacity = (memberId: number, weekStart: string, hours: number) => {
    setWeekCapacities(prev => ({
      ...prev,
      [weekStart]: {
        ...prev[weekStart],
        [memberId]: Math.max(0, Math.min(40, hours)) // Clamp 0-40h
      }
    }))
  }
  
  // Get week navigation helpers
  const getWeekLabel = (weekStart: string) => {
    const start = new Date(weekStart)
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
  }
  
  const navigateWeek = (direction: number) => {
    const current = new Date(selectedWeek)
    current.setDate(current.getDate() + (direction * 7))
    setSelectedWeek(current.toISOString().split('T')[0])
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

  const handleAddTasksFromMeeting = (newTasks: Task[]) => {
    setTasks(prev => [...prev, ...newTasks])
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
        {/* Left side - Add Task */}
        <button
          onClick={() => {
            const newTask: Task = {
              id: Date.now(),
              title: '',
              description: '',
              assignee: 0,
              collaborators: [],
              subtasks: [],
              priority: 'medium',
              status: 'todo',
              dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              createdAt: new Date().toISOString().split('T')[0],
              workflow: globalWorkflow !== 'all' ? globalWorkflow : null,
              subWorkflow: null,
            }
            setTasks(prev => [...prev, newTask])
            setEditingTask(newTask)
          }}
          className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Task
        </button>
        
        <span className="text-sm font-medium text-gray-600">|</span>
        <span className="text-sm font-medium text-gray-600">Showing:</span>
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
        
        {/* Right side - New Workflow & Parse Notes */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-gray-400 mr-2">
            {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
          </span>
          <button
            onClick={() => setShowMeetingNotesModal(true)}
            className="px-3 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Parse Notes
          </button>
          <button
            onClick={() => setShowNewWorkflowModal(true)}
            className="px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Workflow
          </button>
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
        <div className="space-y-6">
          {/* Week Navigator */}
          <div className="flex items-center justify-center gap-4 bg-white rounded-xl p-4 shadow-sm border">
            <button
              onClick={() => navigateWeek(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="text-center">
              <p className="text-sm text-gray-500">Week of</p>
              <p className="font-semibold text-gray-900">{getWeekLabel(selectedWeek)}</p>
            </div>
            <button
              onClick={() => navigateWeek(1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <input
              type="date"
              value={selectedWeek}
              onChange={e => setSelectedWeek(e.target.value)}
              className="ml-4 px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEAM_MEMBERS.map(member => {
              const workload = getWorkload(member.id, selectedWeek)
              const capacity = getMemberCapacity(member.id, selectedWeek)
              const loadPercent = capacity > 0 ? Math.min((workload.hours / capacity) * 100, 100) : 0
              const isOverCapacity = workload.hours > capacity
              
              return (
                <div key={member.id} className={`bg-white rounded-xl p-5 shadow-sm border-2 transition ${
                  isOverCapacity ? 'border-red-300 bg-red-50/30' : 'border-gray-100'
                }`}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold">
                      {member.avatar}
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">{member.name}</h3>
                      <p className="text-sm text-gray-500">{member.role}</p>
                    </div>
                    {isOverCapacity && (
                      <div className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-medium flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        Over capacity
                      </div>
                    )}
                  </div>
                  
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Workload</span>
                      <span className={`font-medium ${isOverCapacity ? 'text-red-600' : ''}`}>
                        {workload.hours.toFixed(1)}h / {capacity}h
                      </span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden relative">
                      <div 
                        className={`h-full transition-all ${
                          isOverCapacity ? 'bg-red-500' : loadPercent > 80 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${loadPercent}%` }}
                      />
                    </div>
                  </div>
                  
                  {/* Capacity slider */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Set weekly capacity</span>
                      <span>{capacity}h</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="40"
                      step="1"
                      value={capacity}
                      onChange={e => setMemberCapacity(member.id, selectedWeek, parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>0h</span>
                      <span>20h</span>
                      <span>40h</span>
                    </div>
                  </div>
                  
                  {/* Breakdown by intensity with time estimates */}
                  <div className="flex gap-1 text-xs flex-wrap">
                    {workload.byIntensity.quick > 0 && (
                      <span className={`px-2 py-0.5 rounded ${intensityColors.quick}`}>
                        {workload.byIntensity.quick} quick (~20min)
                      </span>
                    )}
                    {workload.byIntensity.small > 0 && (
                      <span className={`px-2 py-0.5 rounded ${intensityColors.small}`}>
                        {workload.byIntensity.small} small (~1h)
                      </span>
                    )}
                    {workload.byIntensity.medium > 0 && (
                      <span className={`px-2 py-0.5 rounded ${intensityColors.medium}`}>
                        {workload.byIntensity.medium} medium (~3h)
                      </span>
                    )}
                    {workload.byIntensity.large > 0 && (
                      <span className={`px-2 py-0.5 rounded ${intensityColors.large}`}>
                        {workload.byIntensity.large} large (~6h)
                      </span>
                    )}
                    {workload.byIntensity.huge > 0 && (
                      <span className={`px-2 py-0.5 rounded ${intensityColors.huge}`}>
                        {workload.byIntensity.huge} huge (~1 day)
                      </span>
                    )}
                    {workload.unspecified > 0 && (
                      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                        {workload.unspecified} unspecified
                      </span>
                    )}
                    {workload.hours === 0 && (
                      <span className="text-gray-400 italic">No tasks this week</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
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
                      onClick={() => handleSortClick('workflow')}
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
                      onClick={() => handleSortClick('priority')}
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
                      onClick={() => handleSortClick('dueDate')}
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

      {/* Meeting Notes Parser Modal */}
      {showMeetingNotesModal && (
        <MeetingNotesModal
          onClose={() => setShowMeetingNotesModal(false)}
          onAddTasks={handleAddTasksFromMeeting}
          workflows={workflows}
        />
      )}

      {/* Edit Workflow Modal */}
      {editingWorkflow && (
        <EditWorkflowModal
          workflow={editingWorkflow}
          onClose={() => setEditingWorkflow(null)}
          onSave={handleUpdateWorkflow}
          onArchive={() => editingWorkflow.archived 
            ? handleUnarchiveWorkflow(editingWorkflow.id) 
            : handleArchiveWorkflow(editingWorkflow.id)
          }
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
