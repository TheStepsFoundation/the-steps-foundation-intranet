'use client'

import { useState, useRef, useEffect, MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, getUserDisplayName } from '@/lib/auth-provider'
import { useTheme } from '@/lib/theme-provider'
import { getDiscordWebhookUrl, setDiscordWebhookUrl, notifyTaskAssigned, notifyTaskCompleted } from '@/lib/discord-webhook'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  rectIntersection,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  useDroppable,
  useDraggable,
  defaultDropAnimationSideEffects,
  CollisionDetection,
  closestCenter,
} from '@dnd-kit/core'
import { useData } from '@/lib/data-provider'
import { SubtaskCompletionModal } from '@/components/SubtaskCompletionModal'

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

interface Attachment {
  id: number
  type: 'image' | 'voice' | 'note'
  url: string // data URL or blob URL
  name: string
  duration?: number // for voice notes in seconds
}

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
  createdBy?: string
  workflow: string | null
  subWorkflow: string | null
  attachments?: Attachment[]
  archived?: boolean
  blockedBy?: number[] // Task IDs that must be completed first
  labels?: string[] // Label IDs
  startDate?: string // For Gantt view - when work begins
  comments?: TaskComment[]
  activityLog?: ActivityEntry[]
}

// Comments and Activity Log (Feature #6)
interface TaskComment {
  id: number
  author: string
  content: string
  mentions: string[] // @mentioned names
  createdAt: string
}

interface ActivityEntry {
  id: number
  user: string
  action: 'status_change' | 'assignee_change' | 'priority_change' | 'created' | 'comment'
  oldValue?: string
  newValue?: string
  createdAt: string
}

// Custom Labels
interface Label {
  id: string
  name: string
  color: string
  isDefault?: boolean
}

// Default labels
const DEFAULT_LABELS: Label[] = [
  { id: 'blocked', name: 'Blocked', color: 'bg-red-500', isDefault: true },
  { id: 'waiting', name: 'Waiting on External', color: 'bg-amber-500', isDefault: true },
  { id: 'quick-win', name: 'Quick Win', color: 'bg-green-500', isDefault: true },
  { id: 'urgent', name: 'Urgent', color: 'bg-rose-500', isDefault: true },
  { id: 'review-needed', name: 'Review Needed', color: 'bg-purple-500', isDefault: true },
]

// Workflow Types & Task Templates (Feature #16)
interface WorkflowType {
  id: string
  name: string
  description: string
}

interface SubTemplate {
  id: string
  workflowTypeId: string
  name: string
  description: string
}

interface TaskTemplate {
  id: string
  workflowTypeId: string
  subTemplateId?: string // For sub-templates
  title: string
  description: string
  priority: Priority
}

// Default sub-templates (for Event workflow)
const DEFAULT_SUB_TEMPLATES: SubTemplate[] = [
  { id: 'in-person', workflowTypeId: 'event', name: 'In-Person Event', description: 'Physical venue event with attendees' },
  { id: 'online', workflowTypeId: 'event', name: 'Online Event', description: 'Virtual webinar or online workshop' },
  { id: 'westminster', workflowTypeId: 'event', name: 'Westminster School Event', description: 'Event at Westminster school venue' },
  { id: 'office-visit', workflowTypeId: 'event', name: 'Office Visit', description: 'Corporate office visit or tour' },
]

const DEFAULT_WORKFLOW_TYPES: WorkflowType[] = [
  { id: 'event', name: 'Event', description: 'Conferences, workshops, and gatherings' },
  { id: 'schools', name: 'Schools', description: 'School outreach and partnerships' },
  { id: 'partnerships', name: 'Partnerships', description: 'Sponsor and partner relationships' },
  { id: 'internal', name: 'Internal', description: 'Team operations and admin' },
]

const DEFAULT_TASK_TEMPLATES: TaskTemplate[] = [
  // === IN-PERSON EVENT ===
  { id: 'ip-1', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Confirm venue booking', description: 'Finalise venue reservation and logistics', priority: 'urgent' },
  { id: 'ip-2', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Create event poster', description: 'Design main promotional poster in Canva', priority: 'high' },
  { id: 'ip-3', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Create sign-up form', description: 'Set up Google Form for event registration', priority: 'high' },
  { id: 'ip-4', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Reach out to speakers', description: 'Invite and confirm speakers/panelists', priority: 'urgent' },
  { id: 'ip-5', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Create event schedule', description: 'Plan detailed minute-by-minute schedule', priority: 'high' },
  { id: 'ip-6', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Write promotional copy', description: 'Draft copy for LinkedIn/social media', priority: 'medium' },
  { id: 'ip-7', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Book catering', description: 'Arrange food and refreshments', priority: 'high' },
  { id: 'ip-8', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Arrange AV equipment', description: 'Confirm microphones, projectors, screens', priority: 'high' },
  { id: 'ip-9', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Print materials', description: 'Print name badges, programmes, signage', priority: 'medium' },
  { id: 'ip-10', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Send reminder emails', description: 'Email confirmed attendees before event', priority: 'medium' },
  { id: 'ip-11', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Create feedback form', description: 'Set up post-event feedback survey', priority: 'low' },
  { id: 'ip-12', workflowTypeId: 'event', subTemplateId: 'in-person', title: 'Recruit volunteers', description: 'Confirm volunteer helpers for the day', priority: 'medium' },
  
  // === ONLINE EVENT ===
  { id: 'on-1', workflowTypeId: 'event', subTemplateId: 'online', title: 'Set up Zoom/Teams', description: 'Create meeting link and test settings', priority: 'urgent' },
  { id: 'on-2', workflowTypeId: 'event', subTemplateId: 'online', title: 'Create digital poster', description: 'Design promotional graphic for socials', priority: 'high' },
  { id: 'on-3', workflowTypeId: 'event', subTemplateId: 'online', title: 'Create sign-up form', description: 'Set up registration form with meeting link', priority: 'high' },
  { id: 'on-4', workflowTypeId: 'event', subTemplateId: 'online', title: 'Reach out to speakers', description: 'Invite and confirm online speakers', priority: 'urgent' },
  { id: 'on-5', workflowTypeId: 'event', subTemplateId: 'online', title: 'Create run of show', description: 'Plan session timing and transitions', priority: 'high' },
  { id: 'on-6', workflowTypeId: 'event', subTemplateId: 'online', title: 'Prepare slides/deck', description: 'Create presentation materials', priority: 'high' },
  { id: 'on-7', workflowTypeId: 'event', subTemplateId: 'online', title: 'Write social media posts', description: 'Draft promotional copy for platforms', priority: 'medium' },
  { id: 'on-8', workflowTypeId: 'event', subTemplateId: 'online', title: 'Test tech setup', description: 'Run through with speakers before event', priority: 'high' },
  { id: 'on-9', workflowTypeId: 'event', subTemplateId: 'online', title: 'Send calendar invites', description: 'Email attendees with meeting link', priority: 'medium' },
  { id: 'on-10', workflowTypeId: 'event', subTemplateId: 'online', title: 'Create feedback form', description: 'Set up post-event feedback survey', priority: 'low' },
  
  // === WESTMINSTER SCHOOL EVENT ===
  { id: 'ws-1', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Contact Westminster admin', description: 'Confirm date and room booking with school', priority: 'urgent' },
  { id: 'ws-2', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Complete venue paperwork', description: 'Submit required forms and insurance docs', priority: 'urgent' },
  { id: 'ws-3', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Create event poster', description: 'Design poster (check school branding rules)', priority: 'high' },
  { id: 'ws-4', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Create sign-up form', description: 'Set up registration with school details', priority: 'high' },
  { id: 'ws-5', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Confirm speaker access', description: 'Arrange visitor passes for external speakers', priority: 'high' },
  { id: 'ws-6', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Create event schedule', description: 'Plan schedule within school constraints', priority: 'high' },
  { id: 'ws-7', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Arrange school catering', description: 'Book through school catering if required', priority: 'medium' },
  { id: 'ws-8', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Send attendee instructions', description: 'Email directions and entry procedures', priority: 'medium' },
  { id: 'ws-9', workflowTypeId: 'event', subTemplateId: 'westminster', title: 'Create feedback form', description: 'Set up post-event survey', priority: 'low' },
  
  // === OFFICE VISIT ===
  { id: 'ov-1', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Contact company host', description: 'Confirm date, time and contact person', priority: 'urgent' },
  { id: 'ov-2', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Collect attendee details', description: 'Get names/IDs for building security', priority: 'urgent' },
  { id: 'ov-3', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Create sign-up form', description: 'Registration with required info fields', priority: 'high' },
  { id: 'ov-4', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Confirm visit agenda', description: 'Agree schedule with company host', priority: 'high' },
  { id: 'ov-5', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Brief attendees', description: 'Send dress code and behaviour guidelines', priority: 'medium' },
  { id: 'ov-6', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Arrange transport', description: 'Plan travel logistics for group', priority: 'medium' },
  { id: 'ov-7', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Send reminder with directions', description: 'Final details email day before', priority: 'medium' },
  { id: 'ov-8', workflowTypeId: 'event', subTemplateId: 'office-visit', title: 'Create feedback form', description: 'Post-visit survey for attendees', priority: 'low' },
  
  // Schools templates (unchanged)
  { id: 'sch-1', workflowTypeId: 'schools', title: 'Research target schools', description: 'Identify schools matching our criteria', priority: 'high' },
  { id: 'sch-2', workflowTypeId: 'schools', title: 'Draft outreach email', description: 'Create email template for school contact', priority: 'medium' },
  { id: 'sch-3', workflowTypeId: 'schools', title: 'Send school emails', description: 'Email target schools about opportunity', priority: 'high' },
  { id: 'sch-4', workflowTypeId: 'schools', title: 'Follow up with schools', description: 'Chase responses from contacted schools', priority: 'medium' },
  { id: 'sch-5', workflowTypeId: 'schools', title: 'Schedule school visit', description: 'Arrange date and logistics for visit', priority: 'high' },
  
  // Partnerships templates (unchanged)
  { id: 'prt-1', workflowTypeId: 'partnerships', title: 'Identify potential sponsors', description: 'Research companies for sponsorship', priority: 'high' },
  { id: 'prt-2', workflowTypeId: 'partnerships', title: 'Create sponsorship deck', description: 'Design presentation for sponsors', priority: 'high' },
  { id: 'prt-3', workflowTypeId: 'partnerships', title: 'Send sponsorship proposal', description: 'Email deck to potential sponsors', priority: 'medium' },
  { id: 'prt-4', workflowTypeId: 'partnerships', title: 'Schedule sponsor call', description: 'Arrange meeting with interested sponsor', priority: 'high' },
  { id: 'prt-5', workflowTypeId: 'partnerships', title: 'Draft partnership agreement', description: 'Create contract/MOU for partnership', priority: 'medium' },
  
  // Internal templates (unchanged)
  { id: 'int-1', workflowTypeId: 'internal', title: 'Team meeting agenda', description: 'Prepare agenda for team meeting', priority: 'medium' },
  { id: 'int-2', workflowTypeId: 'internal', title: 'Update documentation', description: 'Update internal docs and processes', priority: 'low' },
  { id: 'int-3', workflowTypeId: 'internal', title: 'Review finances', description: 'Check budget and expenses', priority: 'medium' },
  { id: 'int-4', workflowTypeId: 'internal', title: 'Onboard new volunteer', description: 'Set up access and brief new team member', priority: 'high' },
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

// Due date status helper (Feature #3)
function getDueDateStatus(dueDate: string): 'overdue' | 'today' | 'this-week' | 'future' {
  const due = new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  if (diffDays < 0) return 'overdue'
  if (diffDays === 0) return 'today'
  if (diffDays <= 7) return 'this-week'
  return 'future'
}

const dueDateColors: Record<ReturnType<typeof getDueDateStatus>, string> = {
  'overdue': 'bg-red-500 text-white',
  'today': 'bg-orange-500 text-white',
  'this-week': 'bg-yellow-400 text-yellow-900',
  'future': 'text-gray-400',
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
      className={`${className} transition-all duration-150 ease-out ${isOver ? 'ring-2 ring-purple-400 ring-inset bg-purple-50/70 scale-[1.01]' : ''}`}
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
  teamMembers,
  viewingMemberId,
  onToggleComplete,
  onMoveToStatus,
  labels = [],
}: { 
  task: Task
  onClick: () => void
  showStatus?: boolean
  workflows: Workflow[]
  teamMembers: { id: number; name: string; role: string; avatar: string }[]
  viewingMemberId?: number // The member whose section this card is in (for Team view)
  onToggleComplete?: (task: Task, memberId: number) => void // For subtask completion in Team view
  onMoveToStatus?: (task: Task, status: Status) => void // Mobile move button
  labels?: Label[]
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  })

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 1000,
  } : undefined

  const member = task.assignee ? teamMembers.find(m => m.id === task.assignee) : null
  const workflow = workflows.find(w => w.id === task.workflow)
  const subWorkflow = workflows.find(w => w.id === task.subWorkflow)
  
  // In Team view, highlight tasks where the viewing member is the primary assignee
  const isPrimaryAssignee = viewingMemberId !== undefined && task.assignee === viewingMemberId
  const isCollaborator = viewingMemberId !== undefined && task.assignee !== viewingMemberId
  
  // Find ALL of this member's subtasks and check if all are complete
  const memberSubtasks = viewingMemberId !== undefined 
    ? task.subtasks.filter(st => st.personId === viewingMemberId)
    : []
  const hasSubtasks = memberSubtasks.length > 0
  const allSubtasksCompleted = hasSubtasks && memberSubtasks.every(st => st.completed)

  const handleCardClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drag-handle') || 
        (e.target as HTMLElement).closest('.move-menu')) {
      return
    }
    onClick()
  }

  const handleMoveClick = (e: MouseEvent) => {
    e.stopPropagation()
    setShowMoveMenu(!showMoveMenu)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleCardClick}
      className={`group relative bg-white rounded-lg p-4 shadow-sm border hover:shadow-md transition-all duration-200 ease-out cursor-pointer ${
        isDragging ? 'opacity-60 shadow-lg scale-[1.02]' : ''
      } ${
        isPrimaryAssignee ? 'border-purple-300 ring-2 ring-purple-200' : 'border-gray-100'
      } ${
        allSubtasksCompleted ? 'opacity-60' : ''
      }`}
    >
      {/* Drag Handle - desktop only */}
      <div 
        {...listeners}
        {...attributes}
        className="drag-handle absolute top-2 right-2 p-1.5 rounded hover:bg-gray-100 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none transition-colors hidden sm:block"
        onClick={(e) => e.stopPropagation()}
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
        </svg>
      </div>
      
      {/* Mobile Move Button */}
      {onMoveToStatus && (
        <div className="move-menu absolute top-2 right-2 sm:hidden">
          <button
            onClick={handleMoveClick}
            className="p-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          </button>
          
          {showMoveMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
              {(['todo', 'in-progress', 'review', 'done'] as Status[]).map(status => (
                <button
                  key={status}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowMoveMenu(false)
                    onMoveToStatus(task, status)
                  }}
                  disabled={task.status === status}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 transition ${
                    task.status === status ? 'text-gray-400 bg-gray-50' : 'text-gray-700'
                  }`}
                >
                  {statusLabels[status]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Completion Checkbox - only in Team view, show on hover or when completed */}
      {viewingMemberId !== undefined && onToggleComplete && hasSubtasks && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleComplete(task, viewingMemberId)
          }}
          className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
            allSubtasksCompleted
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-gray-300 hover:border-green-400 bg-white opacity-0 group-hover:opacity-100'
          }`}
        >
          {allSubtasksCompleted && (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
      )}

      {/* Workflow badges + blocked indicator + labels */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {task.blockedBy && task.blockedBy.length > 0 && (
          <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700 whitespace-nowrap" title="Blocked by other tasks">
            🔒 Blocked
          </span>
        )}
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
        {/* Custom Labels */}
        {task.labels?.slice(0, 2).map(labelId => {
          const label = labels.find(l => l.id === labelId)
          return label ? (
            <span key={label.id} className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded text-white whitespace-nowrap ${label.color}`}>
              {label.name}
            </span>
          ) : null
        })}
        {task.labels && task.labels.length > 2 && (
          <span className="text-xs text-gray-400">+{task.labels.length - 2}</span>
        )}
      </div>

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
        {(() => {
          const dueDateStatus = getDueDateStatus(task.dueDate)
          return (
            <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${dueDateColors[dueDateStatus]}`}>
              {dueDateStatus === 'overdue' && '⚠️ '}
              {dueDateStatus === 'today' && '📅 '}
              {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          )
        })()}
        <div className="flex -space-x-2 ml-auto">
          {member ? (
            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-[10px] font-medium border-2 border-white" title={member.name}>
              {member.avatar}
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-[10px] border-2 border-white" title="Unassigned">
              ?
            </div>
          )}
          {task.collaborators.slice(0, 2).map(collabId => {
            const collab = teamMembers.find(m => m.id === collabId)
            return collab ? (
              <div key={collabId} className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-[10px] font-medium border-2 border-white" title={collab.name}>
                {collab.avatar}
              </div>
            ) : null
          })}
          {task.collaborators.length > 2 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[10px] font-medium border-2 border-white">
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
  onDelete,
  onDuplicate,
  workflows,
  teamMembers,
  tasks,
  labels,
  onAddLabel,
}: { 
  task: Task
  onClose: () => void
  onSave: (updatedTask: Task) => void
  onDelete?: (taskId: number) => void
  onDuplicate?: (task: Task) => void
  workflows: Workflow[]
  teamMembers: { id: number; name: string; role: string; avatar: string }[]
  tasks: Task[]
  labels: Label[]
  onAddLabel?: (name: string, color: string) => string
}) {
  const [editedTask, setEditedTask] = useState<Task>({ ...task })
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'attachments' | 'activity'>('basic')
  const [completingSubtaskIndex, setCompletingSubtaskIndex] = useState<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [newComment, setNewComment] = useState('')
  
  // Add a comment
  const addComment = () => {
    if (!newComment.trim()) return
    
    // Parse @mentions
    const mentionRegex = /@(\w+)/g
    const mentions: string[] = []
    let match
    while ((match = mentionRegex.exec(newComment)) !== null) {
      mentions.push(match[1])
    }
    
    const comment: TaskComment = {
      id: Date.now(),
      author: 'You', // Would be user email in real app
      content: newComment.trim(),
      mentions,
      createdAt: new Date().toISOString(),
    }
    
    setEditedTask(prev => ({
      ...prev,
      comments: [...(prev.comments || []), comment],
      activityLog: [...(prev.activityLog || []), {
        id: Date.now() + 1,
        user: 'You',
        action: 'comment' as const,
        newValue: newComment.trim().slice(0, 50) + (newComment.length > 50 ? '...' : ''),
        createdAt: new Date().toISOString(),
      }]
    }))
    setNewComment('')
  }
  
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

    {/* Subtask completion modal - asks for actual hours */}
    {completingSubtaskIndex !== null && (
      <SubtaskCompletionModal
        subtaskDescription={editedTask.subtasks[completingSubtaskIndex]?.description || ''}
        predictedIntensity={editedTask.subtasks[completingSubtaskIndex]?.intensity || 'small'}
        onConfirm={(actualHours, newIntensity) => {
          const newSubtasks = [...editedTask.subtasks]
          newSubtasks[completingSubtaskIndex] = {
            ...newSubtasks[completingSubtaskIndex],
            completed: true,
            completedAt: new Date().toISOString(),
            actualHours,
            intensity: newIntensity,
          }
          
          // Check if all subtasks are now complete → auto-mark task as done
          const allComplete = newSubtasks.length > 0 && newSubtasks.every(st => st.completed)
          
          setEditedTask({
            ...editedTask,
            subtasks: newSubtasks,
            status: allComplete ? 'done' : editedTask.status,
          })
          setCompletingSubtaskIndex(null)
        }}
        onCancel={() => setCompletingSubtaskIndex(null)}
      />
    )}
    
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900">Edit Task</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b flex-shrink-0">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'basic'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Task Details
          </button>
          <button
            onClick={() => setActiveTab('attachments')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'attachments'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Attachments
            {editedTask.attachments && editedTask.attachments.length > 0 && (
              <span className="bg-purple-100 text-purple-600 text-xs px-2 py-0.5 rounded-full">
                {editedTask.attachments.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'activity'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Activity
            {((editedTask.comments?.length || 0) + (editedTask.activityLog?.length || 0)) > 0 && (
              <span className="bg-purple-100 text-purple-600 text-xs px-2 py-0.5 rounded-full">
                {(editedTask.comments?.length || 0) + (editedTask.activityLog?.length || 0)}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' ? (
            <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title *</label>
            <input
              type="text"
              value={editedTask.title}
              onChange={e => setEditedTask({ ...editedTask, title: e.target.value })}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={editedTask.description}
              onChange={e => setEditedTask({ ...editedTask, description: e.target.value })}
              rows={2}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
            />
          </div>

          {/* Workflow Selection */}
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
                {workflows.filter(w => !w.archived).map(w => (
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
                {workflows.filter(w => w.id !== editedTask.workflow && !w.archived).map(w => (
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
              <select
                value={editedTask.status}
                onChange={e => {
                  const newStatus = e.target.value as Status
                  if (newStatus === 'done') {
                    // Auto-complete all subtasks when marking as done
                    setEditedTask({
                      ...editedTask,
                      status: newStatus,
                      subtasks: editedTask.subtasks.map(st => ({ ...st, completed: true }))
                    })
                  } else {
                    setEditedTask({ ...editedTask, status: newStatus })
                  }
                }}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date (optional)</label>
              <input
                type="date"
                value={editedTask.startDate || ''}
                onChange={e => setEditedTask({ ...editedTask, startDate: e.target.value || undefined })}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
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
          </div>

          {/* Blocked By - Task Dependencies */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Blocked By (Dependencies)</label>
            <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto">
              {tasks.filter(t => t.id !== editedTask.id && t.status !== 'done').length === 0 ? (
                <p className="p-3 text-sm text-gray-400">No other active tasks</p>
              ) : (
                tasks
                  .filter(t => t.id !== editedTask.id && t.status !== 'done')
                  .map(t => (
                    <label 
                      key={t.id} 
                      className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={editedTask.blockedBy?.includes(t.id) || false}
                        onChange={(e) => {
                          const currentBlocked = editedTask.blockedBy || []
                          if (e.target.checked) {
                            setEditedTask({ ...editedTask, blockedBy: [...currentBlocked, t.id] })
                          } else {
                            setEditedTask({ ...editedTask, blockedBy: currentBlocked.filter(id => id !== t.id) })
                          }
                        }}
                        className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                      />
                      <span className="text-sm text-gray-700 truncate flex-1">{t.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${statusColors[t.status]}`}>
                        {statusLabels[t.status]}
                      </span>
                    </label>
                  ))
              )}
            </div>
            {editedTask.blockedBy && editedTask.blockedBy.length > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ This task is blocked by {editedTask.blockedBy.length} task(s)
              </p>
            )}
          </div>

          {/* Labels */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Labels</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {labels.map(label => {
                const isSelected = editedTask.labels?.includes(label.id) || false
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => {
                      const currentLabels = editedTask.labels || []
                      if (isSelected) {
                        setEditedTask({ ...editedTask, labels: currentLabels.filter(id => id !== label.id) })
                      } else {
                        setEditedTask({ ...editedTask, labels: [...currentLabels, label.id] })
                      }
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                      isSelected 
                        ? `${label.color} text-white ring-2 ring-offset-1 ring-purple-400` 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label.name}
                  </button>
                )
              })}
            </div>
            {onAddLabel && (
              <button
                type="button"
                onClick={() => {
                  const name = prompt('Enter label name:')
                  if (name) {
                    const colors = ['bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-pink-500', 'bg-cyan-500', 'bg-indigo-500']
                    const color = colors[Math.floor(Math.random() * colors.length)]
                    const newId = onAddLabel(name, color)
                    setEditedTask({ ...editedTask, labels: [...(editedTask.labels || []), newId] })
                  }
                }}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                + Create new label
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assigned To</label>
            <div className="grid grid-cols-3 gap-2">
              {teamMembers.map(member => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    const newAssignee = member.id
                    const filteredCollabs = editedTask.collaborators.filter(id => id !== member.id)
                    
                    // First subtask always follows assignee
                    let newSubtasks = [...editedTask.subtasks]
                    if (editedTask.subtasks.length === 0) {
                      // Create first subtask for assignee
                      newSubtasks = [{
                        id: Date.now(),
                        personId: newAssignee,
                        description: '',
                        intensity: 'small' as Intensity,
                      }]
                    } else {
                      // Update first subtask to match new assignee
                      newSubtasks[0] = { ...newSubtasks[0], personId: newAssignee }
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
              {teamMembers.filter(m => m.id !== editedTask.assignee).map(member => (
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
                  const person = teamMembers.find(m => m.id === subtask.personId)
                  return (
                    <div key={subtask.id} className={`flex gap-3 items-start p-3 rounded-lg ${subtask.completed ? 'bg-green-50' : 'bg-gray-50'}`}>
                      {/* Completion checkbox */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!subtask.completed) {
                            // Show completion modal to ask for actual hours
                            setCompletingSubtaskIndex(index)
                          } else {
                            // Un-completing: just toggle off
                            const newSubtasks = [...editedTask.subtasks]
                            newSubtasks[index] = { 
                              ...subtask, 
                              completed: false,
                              completedAt: undefined,
                              actualHours: undefined
                            }
                            setEditedTask({ ...editedTask, subtasks: newSubtasks })
                          }
                        }}
                        className={`mt-2 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                          subtask.completed
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-300 hover:border-green-400 bg-white'
                        }`}
                      >
                        {subtask.completed && (
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <select
                        value={subtask.personId}
                        onChange={e => {
                          const newSubtasks = [...editedTask.subtasks]
                          newSubtasks[index] = { ...subtask, personId: parseInt(e.target.value) }
                          setEditedTask({ ...editedTask, subtasks: newSubtasks })
                        }}
                        className={`px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none min-w-[120px] ${subtask.completed ? 'opacity-60' : ''}`}
                      >
                        <option value={0}>Unassigned</option>
                        {teamMembers.map(m => (
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
                          className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${subtask.completed ? 'line-through opacity-60' : ''}`}
                        />
                        {/* Show completion info */}
                        {subtask.completed && subtask.completedAt && (
                          <div className="text-xs text-green-600 mt-1 flex items-center gap-2">
                            <span>Done {new Date(subtask.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                            {subtask.actualHours && (
                              <span className="text-gray-500">• took {subtask.actualHours}h</span>
                            )}
                          </div>
                        )}
                      </div>
                      <select
                        value={subtask.intensity}
                        onChange={e => {
                          const newSubtasks = [...editedTask.subtasks]
                          newSubtasks[index] = { ...subtask, intensity: e.target.value as Intensity }
                          setEditedTask({ ...editedTask, subtasks: newSubtasks })
                        }}
                        className={`px-2 py-2 border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${intensityColors[subtask.intensity]} ${subtask.completed ? 'opacity-60' : ''}`}
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
          
          {/* Task Metadata - at bottom of details tab */}
          {(task.createdBy || task.createdAt) && (
            <div className="flex items-center gap-4 text-sm text-gray-400 pt-4 border-t border-gray-100">
              {task.createdBy && (
                <span className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-xs font-medium">
                    {task.createdBy.split('@')[0].slice(0, 2).toUpperCase()}
                  </div>
                  <span>Created by <span className="text-gray-600">{task.createdBy.split('@')[0]}</span></span>
                </span>
              )}
              {task.createdAt && (
                <span className="flex items-center gap-1 text-gray-400">
                  •
                  <span>{new Date(task.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </span>
              )}
            </div>
          )}
            </div>
          ) : (
            /* Attachments Tab */
            <div className="space-y-4">
              {/* Add Attachment Options */}
              <div className="grid grid-cols-3 gap-3">
                {/* Image Upload */}
                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-purple-300 hover:bg-purple-50 transition">
                  <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm text-gray-600">Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          const newAttachment: Attachment = {
                            id: Date.now(),
                            type: 'image',
                            url: event.target?.result as string,
                            name: file.name,
                          }
                          setEditedTask({
                            ...editedTask,
                            attachments: [...(editedTask.attachments || []), newAttachment]
                          })
                        }
                        reader.readAsDataURL(file)
                      }
                    }}
                  />
                </label>

                {/* Voice Recording */}
                <button
                  type="button"
                  onClick={async () => {
                    if (isRecording) {
                      mediaRecorderRef.current?.stop()
                      setIsRecording(false)
                    } else {
                      try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                        const mediaRecorder = new MediaRecorder(stream)
                        mediaRecorderRef.current = mediaRecorder
                        audioChunksRef.current = []
                        
                        mediaRecorder.ondataavailable = (e) => {
                          audioChunksRef.current.push(e.data)
                        }
                        
                        mediaRecorder.onstop = () => {
                          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
                          const url = URL.createObjectURL(audioBlob)
                          const newAttachment: Attachment = {
                            id: Date.now(),
                            type: 'voice',
                            url,
                            name: `Voice note ${new Date().toLocaleTimeString()}`,
                            duration: recordingTime,
                          }
                          setEditedTask({
                            ...editedTask,
                            attachments: [...(editedTask.attachments || []), newAttachment]
                          })
                          setRecordingTime(0)
                          stream.getTracks().forEach(track => track.stop())
                        }
                        
                        mediaRecorder.start()
                        setIsRecording(true)
                        
                        const startTime = Date.now()
                        const timer = setInterval(() => {
                          setRecordingTime(Math.floor((Date.now() - startTime) / 1000))
                        }, 1000)
                        
                        mediaRecorder.addEventListener('stop', () => clearInterval(timer))
                      } catch {
                        alert('Could not access microphone')
                      }
                    }
                  }}
                  className={`flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-lg transition ${
                    isRecording 
                      ? 'border-red-300 bg-red-50' 
                      : 'border-gray-200 hover:border-purple-300 hover:bg-purple-50'
                  }`}
                >
                  <svg className={`w-8 h-8 mb-2 ${isRecording ? 'text-red-500 animate-pulse' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                  <span className={`text-sm ${isRecording ? 'text-red-600' : 'text-gray-600'}`}>
                    {isRecording ? `Recording ${Math.floor(recordingTime / 60)}:${(recordingTime % 60).toString().padStart(2, '0')}` : 'Voice Note'}
                  </span>
                </button>

                {/* Quick Note */}
                <button
                  type="button"
                  onClick={() => {
                    const note = prompt('Enter a quick note:')
                    if (note) {
                      const newAttachment: Attachment = {
                        id: Date.now(),
                        type: 'note',
                        url: note,
                        name: `Note ${new Date().toLocaleTimeString()}`,
                      }
                      setEditedTask({
                        ...editedTask,
                        attachments: [...(editedTask.attachments || []), newAttachment]
                      })
                    }
                  }}
                  className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition"
                >
                  <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-gray-600">Quick Note</span>
                </button>
              </div>

              {/* Existing Attachments List */}
              {editedTask.attachments && editedTask.attachments.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-700">Attached ({editedTask.attachments.length})</h3>
                  {editedTask.attachments.map(attachment => (
                    <div 
                      key={attachment.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        attachment.type === 'image' ? 'bg-blue-100' :
                        attachment.type === 'voice' ? 'bg-green-100' :
                        'bg-amber-100'
                      }`}>
                        {attachment.type === 'image' ? (
                          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        ) : attachment.type === 'voice' ? (
                          <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{attachment.name}</p>
                        {attachment.type === 'voice' && attachment.duration && (
                          <p className="text-xs text-gray-500">
                            {Math.floor(attachment.duration / 60)}:{(attachment.duration % 60).toString().padStart(2, '0')}
                          </p>
                        )}
                        {attachment.type === 'note' && (
                          <p className="text-xs text-gray-500 truncate">{attachment.url.slice(0, 60)}...</p>
                        )}
                      </div>
                      {attachment.type === 'image' && (
                        <img src={attachment.url} alt={attachment.name} className="w-12 h-12 object-cover rounded" />
                      )}
                      {attachment.type === 'voice' && (
                        <audio src={attachment.url} controls className="h-8 w-32" />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditedTask({
                            ...editedTask,
                            attachments: editedTask.attachments?.filter(a => a.id !== attachment.id)
                          })
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <p>No attachments yet</p>
                </div>
              )}
            </div>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <div className="space-y-4">
              {/* Add Comment */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Add Comment
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addComment()}
                    placeholder="Write a comment... Use @name to mention"
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    onClick={addComment}
                    disabled={!newComment.trim()}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Tip: Use @{teamMembers[0]?.name.split(' ')[0] || 'name'} to mention someone
                </p>
              </div>

              {/* Comments & Activity Feed */}
              <div className="space-y-3">
                {[...(editedTask.comments || []), ...(editedTask.activityLog || [])]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map(item => {
                    const isComment = 'content' in item
                    return (
                      <div 
                        key={item.id} 
                        className={`p-3 rounded-lg ${isComment ? 'bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600' : 'bg-gray-50 dark:bg-gray-800'}`}
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                            isComment ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300'
                          }`}>
                            {(isComment ? (item as TaskComment).author : (item as ActivityEntry).user).slice(0, 2).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-sm text-gray-900 dark:text-white">
                                {isComment ? (item as TaskComment).author : (item as ActivityEntry).user}
                              </span>
                              <span className="text-xs text-gray-400">
                                {new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            {isComment ? (
                              <p className="text-sm text-gray-700 dark:text-gray-200">
                                {(item as TaskComment).content.split(/(@\w+)/g).map((part, i) => 
                                  part.startsWith('@') 
                                    ? <span key={i} className="text-purple-600 dark:text-purple-400 font-medium">{part}</span>
                                    : part
                                )}
                              </p>
                            ) : (
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {(item as ActivityEntry).action === 'status_change' && (
                                  <>Changed status from <strong>{(item as ActivityEntry).oldValue}</strong> to <strong>{(item as ActivityEntry).newValue}</strong></>
                                )}
                                {(item as ActivityEntry).action === 'assignee_change' && (
                                  <>Changed assignee to <strong>{(item as ActivityEntry).newValue}</strong></>
                                )}
                                {(item as ActivityEntry).action === 'priority_change' && (
                                  <>Changed priority to <strong>{(item as ActivityEntry).newValue}</strong></>
                                )}
                                {(item as ActivityEntry).action === 'comment' && (
                                  <>Added a comment</>
                                )}
                                {(item as ActivityEntry).action === 'created' && (
                                  <>Created this task</>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                {(!editedTask.comments?.length && !editedTask.activityLog?.length) && (
                  <div className="text-center py-8 text-gray-400 dark:text-gray-500">
                    <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p>No activity yet</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t bg-gray-50">
          {/* Left side buttons */}
          <div className="flex gap-2">
            {/* Delete button */}
            {onDelete && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 text-red-600 font-medium hover:bg-red-50 rounded-lg transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            )}
            
            {/* Duplicate button */}
            {onDuplicate && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => {
                  const duplicatedTask: Task = {
                    ...editedTask,
                    id: Date.now(),
                    title: `${editedTask.title} (copy)`,
                    status: 'todo',
                    createdAt: new Date().toISOString().split('T')[0],
                    subtasks: editedTask.subtasks.map(st => ({
                      ...st,
                      id: Date.now() + Math.random() * 1000,
                      completed: false
                    }))
                  }
                  onDuplicate(duplicatedTask)
                  onClose()
                }}
                className="px-4 py-2 text-blue-600 font-medium hover:bg-blue-50 rounded-lg transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Duplicate
              </button>
            )}
            
            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-600">Delete this task?</span>
                <button
                  type="button"
                  onClick={() => {
                    onDelete?.(task.id)
                    onClose()
                  }}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 text-gray-600 text-sm font-medium hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
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
  teamMembers,
}: {
  onClose: () => void
  onAddTasks: (tasks: Task[]) => void
  workflows: Workflow[]
  teamMembers: { id: number; name: string; role: string; avatar: string }[]
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
    
    // Strip markdown formatting (bold, italic, etc.)
    const stripMarkdown = (text: string): string => {
      return text
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** -> bold
        .replace(/\*([^*]+)\*/g, '$1')       // *italic* -> italic
        .replace(/__([^_]+)__/g, '$1')       // __bold__ -> bold
        .replace(/_([^_]+)_/g, '$1')         // _italic_ -> italic
        .replace(/~~([^~]+)~~/g, '$1')       // ~~strikethrough~~ -> strikethrough
        .replace(/`([^`]+)`/g, '$1')         // `code` -> code
    }
    
    const lines = notes.split('\n').map(l => stripMarkdown(l.trim()))
    const tasks: SuggestedTask[] = []
    
    // Team member names and nicknames (hardcoded aliases for common names)
    const hardcodedAliases: Record<number, string[]> = {
      1: ["god'sfavour", "godsfavour", "favour", "fav", "you (favour)", "you(favour)"],
      2: ["jin", "jim"],
      3: ["daniyaal", "danny", "dani", "dan", "dany"],
      4: ["sam", "samuel"],
      5: ["earl"],
      6: ["aditya", "adi"],
      7: ["ricardo", "ric", "serrao", "rs"],
    }
    
    // Generate aliases from teamMembers prop, combining hardcoded aliases with dynamic names
    const memberAliases: { id: number; names: string[] }[] = teamMembers.map(member => {
      const names: string[] = []
      // Add full name (lowercase)
      names.push(member.name.toLowerCase())
      // Add first name
      const firstName = member.name.split(' ')[0].toLowerCase()
      if (!names.includes(firstName)) names.push(firstName)
      // Add last name if exists
      const nameParts = member.name.split(' ')
      if (nameParts.length > 1) {
        const lastName = nameParts[nameParts.length - 1].toLowerCase()
        if (!names.includes(lastName)) names.push(lastName)
      }
      // Add initials
      const initials = member.name.split(' ').map(n => n[0]).join('').toLowerCase()
      if (initials.length >= 2 && !names.includes(initials)) names.push(initials)
      // Add hardcoded aliases if available
      if (hardcodedAliases[member.id]) {
        for (const alias of hardcodedAliases[member.id]) {
          if (!names.includes(alias)) names.push(alias)
        }
      }
      return { id: member.id, names }
    })
    
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
      const months: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
      }
      
      // Match patterns like "by Thu 12 Mar 2026", "Fri 13 Mar 2026", "~Sun 22 Mar 2026" (with year)
      const dateMatchWithYear = text.match(/(?:by\s+|~\s*)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i)
      if (dateMatchWithYear) {
        const day = dateMatchWithYear[1].padStart(2, '0')
        const month = months[dateMatchWithYear[2].toLowerCase()]
        const year = dateMatchWithYear[3]
        return `${year}-${month}-${day}`
      }
      
      // Match patterns like "by Thu 12 Mar", "Fri 13 Mar" (without year - assume current/next year)
      const dateMatchNoYear = text.match(/(?:by\s+|~\s*)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?!\s*\d)/i)
      if (dateMatchNoYear) {
        const day = dateMatchNoYear[1].padStart(2, '0')
        const month = months[dateMatchNoYear[2].toLowerCase()]
        const now = new Date()
        let year = now.getFullYear()
        
        // If the date has passed this year, assume next year
        const parsedDate = new Date(year, parseInt(month) - 1, parseInt(day))
        if (parsedDate < now) {
          year++
        }
        
        return `${year}-${month}-${day}`
      }
      
      return null
    }
    
    // Estimate intensity based on keywords
    const estimateIntensity = (text: string): Intensity => {
      const lower = text.toLowerCase()
      
      // HUGE: Multi-day efforts, ongoing leadership, full ownership
      if (/co-lead|co‑lead|lead overall|take over and drive|ongoing to|full ownership/.test(lower)) return 'huge'
      if (/entire|comprehensive|launch|complete project/.test(lower)) return 'huge'
      
      // LARGE: Half-day to full-day tasks - creative work, complex coordination
      if (/film|edit video|tiktok|create video|shoot|record/.test(lower)) return 'large'
      if (/design|build|develop|write\s+(full|complete|entire)/.test(lower)) return 'large'
      if (/finali[sz]e|lead on|drive\s+\w+\s+work|set up.*server|website/.test(lower)) return 'large'
      if (/prepare.*slides|prepare.*presentation|pitch/.test(lower)) return 'large'
      
      // MEDIUM: 1-4 hours - coordination, preparation, research
      if (/coordinate|prepare|draft|plan|research|organi[sz]e|arrange/.test(lower)) return 'medium'
      if (/sketch|outline|define|work with.*to progress/.test(lower)) return 'medium'
      if (/join.*selection|help drive|start.*planning/.test(lower)) return 'medium'
      
      // SMALL: 15-60 min - calls, reviews, updates, posts
      if (/call\s+(with|at)|attend\s+(call|meeting)|take\s+call/.test(lower)) return 'small'
      if (/review|update|schedule|contact|post|share.*notes/.test(lower)) return 'small'
      if (/decide|confirm.*role|join.*decisions/.test(lower)) return 'small'
      
      // QUICK: 5-15 min - emails, quick messages, simple confirmations
      if (/email|send|reply|respond|confirm|check|follow.?up|message/.test(lower)) return 'quick'
      if (/quick|simple|minor|brief/.test(lower)) return 'quick'
      
      // Default to small for unmatched tasks
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
    
    // Extract clean, concise title with proper title case
    const extractTitle = (text: string): string => {
      let title = text
        .replace(/^[-•*]\s*/, '') // Remove bullet points
        .replace(/\s*[–-]\s*(?:by\s+|~\s*)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun).*$/i, '') // Remove date suffix
        .replace(/\s*;\s*(?:event day\s+)?~?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun).*$/i, '') // Remove secondary date
        .replace(/\s*[–-]\s*(?:ongoing|from\s+).*$/i, '') // Remove ongoing suffix
        .replace(/\s*[–-]\s*(?:between|per\s+|begin\s+).*$/i, '') // Remove date ranges
        .replace(/\s*\([^)]*\)\s*/g, ' ') // Remove parenthetical asides
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
      
      // Remove trailing purpose clauses and filler
      title = title
        .replace(/\s+so that\s+.*$/i, '')
        .replace(/\s+so\s+\w+\s+(can|are|is|will).*$/i, '')
        .replace(/\s+and be present as.*$/i, '')
        .replace(/\s+ensuring\s+.*$/i, '')
        .replace(/\s+once the\s+.*$/i, '')
        .replace(/\s+about\s+.*partnership.*$/i, '')  // "about Great Lock In partnership"
        .replace(/\s+and\s+pitch\s+.*$/i, '')  // "and pitch office visit"
        .replace(/\s+and\s+reserved\s+.*$/i, '')
        .replace(/\s+and\s+potential\s+.*$/i, '')
        .trim()
      
      // Clean up function - removes trailing incomplete words
      const cleanTrailing = (s: string): string => {
        return s
          .replace(/\s+(to|with|on|for|about|and|or|the|a|an|in|at|by|from|into|as|if|of|up|is|are|will|can|then|that|this|their|our|your)$/i, '')
          .replace(/\s+(follow|pitch|share|send|post|drive|visit)$/i, '')  // verbs that need objects
          .replace(/[,;:\-–/]$/, '')
          .trim()
      }
      
      // If still too long, find a good cut point
      if (title.length > 50) {
        // Try to cut before common preposition phrases
        const cutPatterns = [
          /\s+about\s+/i,
          /\s+to\s+follow/i,
          /\s+and\s+pitch/i,
          /\s+and\s+\w+\s+/i,  // "and [verb]"
          /\s+on\s+\w+\s+/i,   // "on [topic]"
        ]
        
        for (const pattern of cutPatterns) {
          const match = title.match(pattern)
          if (match && match.index && match.index > 20 && match.index < 55) {
            title = title.slice(0, match.index)
            break
          }
        }
      }
      
      // Final truncation if still too long
      if (title.length > 50) {
        title = title.slice(0, 50).replace(/\s+\S*$/, '')  // Cut at word boundary
      }
      
      // Clean trailing words multiple times to catch chains
      for (let i = 0; i < 4; i++) {
        const cleaned = cleanTrailing(title)
        if (cleaned === title) break
        title = cleaned
      }
      
      // Words that should stay lowercase (unless first word)
      const lowercaseWords = new Set([
        'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'yet', 'so',
        'to', 'at', 'by', 'in', 'of', 'on', 'up', 'as', 'if',
        'with', 'from', 'into', 'onto', 'upon', 'about', 'after', 'before',
        'over', 'under', 'between', 'through', 'during', 'without',
      ])
      
      // Apply title case
      const words = title.toLowerCase().split(' ')
      const titleCased = words.map((word, index) => {
        if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1)
        if (lowercaseWords.has(word)) return word
        return word.charAt(0).toUpperCase() + word.slice(1)
      })
      
      return titleCased.join(' ')
    }
    
    // Check if line is a person header (e.g., "Adi", "You (Favour)", "- Jin")
    // Headers are short lines with JUST a name, no verbs or action words
    const isPersonHeader = (line: string): { isHeader: boolean; assignee: number } => {
      // Remove optional leading "- " or bullet
      const content = line.replace(/^[-•*]\s*/, '').trim()
      
      // Headers are short (just a name) - max ~25 chars
      if (content.length > 30) return { isHeader: false, assignee: 0 }
      
      // Headers don't have action verbs, dashes (due dates), or common task words
      if (content.includes('–') || content.includes(' - ')) return { isHeader: false, assignee: 0 }
      if (/\b(follow|email|contact|lead|prepare|work|attend|join|send|create|film|confirm|help|drive|share|start|finish|respond|coordinate|sketch|move|take)\b/i.test(content)) {
        return { isHeader: false, assignee: 0 }
      }
      
      // Check for "You (Favour)" or "You" alone
      if (/^you\s*(\(favour\)|\(fav\))?$/i.test(content)) {
        return { isHeader: true, assignee: 1 } // Favour
      }
      
      // Check for team/group headers
      if (/^(entire\s+)?(core\s+)?team$/i.test(content) || /everyone|all\s+team/i.test(content)) {
        return { isHeader: true, assignee: 0 }
      }
      
      // Check if it's JUST a team member name (nothing else)
      const memberId = findMember(content)
      if (memberId !== 0) {
        // Make sure it's just the name, not a task mentioning the name
        const nameOnly = content.toLowerCase().replace(/[^a-z\s]/g, '').trim()
        for (const member of memberAliases) {
          if (member.id === memberId) {
            for (const name of member.names) {
              if (nameOnly === name || nameOnly === name + ' ' || ' ' + nameOnly === ' ' + name) {
                return { isHeader: true, assignee: memberId }
              }
            }
          }
        }
        // If content is very short and matches a member, it's likely a header
        if (content.length <= 15) {
          return { isHeader: true, assignee: memberId }
        }
      }
      
      return { isHeader: false, assignee: 0 }
    }
    
    // Check if a line is a top-level bullet (no leading whitespace)
    const isTopLevelBullet = (line: string): boolean => {
      return /^[-•]\s+/.test(line)
    }
    
    // Check if a line is an indented bullet (has leading whitespace)
    const isIndentedBullet = (line: string): boolean => {
      return /^\s+[-•]\s+/.test(line)
    }
    
    // Parse priority from text like "Priority: High" or "Urgency: High"
    const parsePriority = (text: string): Priority | null => {
      const lower = text.toLowerCase()
      // Support both "Priority:" and "Urgency:" labels
      if (/(?:priority|urgency)[:\s]+urgent/i.test(lower)) return 'urgent'
      if (/(?:priority|urgency)[:\s]+high/i.test(lower)) return 'high'
      if (/(?:priority|urgency)[:\s]+medium/i.test(lower)) return 'medium'
      if (/(?:priority|urgency)[:\s]+low/i.test(lower)) return 'low'
      return null
    }
    
    // Parse collaborators from text like "Collaborators: Adi – providing room layout"
    const parseCollaborators = (text: string): number[] => {
      const collabs: number[] = []
      // Match "Collaborators: Name" or "Collaborators: Name – description"
      const collabMatch = text.match(/collaborators?[:\s]+(.+)/i)
      if (collabMatch) {
        const content = collabMatch[1].toLowerCase()
        if (content.includes('none')) return []
        
        for (const member of memberAliases) {
          for (const name of member.names) {
            if (content.includes(name) && !collabs.includes(member.id)) {
              collabs.push(member.id)
            }
          }
        }
      }
      return collabs
    }
    
    // Parse deadline from various formats
    const parseDeadlineText = (text: string): string | null => {
      const lower = text.toLowerCase()
      
      // Skip non-deadline lines
      if (!/deadline[:\s]/i.test(lower)) return null
      
      // Handle "ASAP" - set to today
      if (/asap/i.test(lower)) {
        const today = new Date()
        return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      }
      
      // Handle "Ongoing" or "No fixed deadline" - no date
      if (/ongoing|no fixed|no deadline/i.test(lower)) return null
      
      // Handle "Tomorrow (Wed, Mar 19)" - extract the date in parentheses
      const parenMatch = text.match(/\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})(?:,?\s*(\d{4}))?\)/i)
      if (parenMatch) {
        const months: Record<string, string> = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        }
        const month = months[parenMatch[1].toLowerCase()]
        const day = parenMatch[2].padStart(2, '0')
        const year = parenMatch[3] || new Date().getFullYear().toString()
        return `${year}-${month}-${day}`
      }
      
      // Handle "Before Event #4 (Sat, Mar 21)" - date in second parentheses
      const beforeMatch = text.match(/before.*\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})(?:,?\s*(\d{4}))?\)/i)
      if (beforeMatch) {
        const months: Record<string, string> = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        }
        const month = months[beforeMatch[1].toLowerCase()]
        const day = beforeMatch[2].padStart(2, '0')
        const year = beforeMatch[3] || new Date().getFullYear().toString()
        return `${year}-${month}-${day}`
      }
      
      // Handle "By evening before Event #4" - try to extract any date
      const anyDateMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{1,2})(?:,?\s*(\d{4}))?/i)
      if (anyDateMatch) {
        const months: Record<string, string> = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        }
        const month = months[anyDateMatch[1].toLowerCase()]
        const day = anyDateMatch[2].padStart(2, '0')
        const year = anyDateMatch[3] || new Date().getFullYear().toString()
        return `${year}-${month}-${day}`
      }
      
      // Fallback to original parseDate
      return parseDate(text)
    }
    
    // Process notes - check if bullet-based format
    let currentAssignee = 0
    
    // Check if notes contain bullet points (- or •, NOT * which conflicts with markdown)
    const hasBullets = lines.some(l => /^[-•]\s+/.test(l))
    
    // Use original unsplit notes for indentation detection
    const originalLines = notes.split('\n')
    
    if (hasBullets) {
      // HIERARCHICAL BULLET-BASED FORMAT:
      // - Top-level bullet (no indent) = new task title
      // - Indented bullets = description details, priority, or deadline metadata
      // - Person headers set the assignee for subsequent tasks
      
      let i = 0
      while (i < originalLines.length) {
        const rawLine = originalLines[i]
        const line = stripMarkdown(rawLine.trim())
        
        if (!line) {
          i++
          continue
        }
        
        // Check for person header (line without bullet, just a name)
        const headerCheck = isPersonHeader(line)
        if (headerCheck.isHeader) {
          currentAssignee = headerCheck.assignee
          i++
          continue
        }
        
        // Check for section headers like "Favour's tasks", "### Dany's Tasks", "Whole team's tasks"
        // Supports optional markdown heading prefix (###)
        const sectionMatch = line.match(/^(?:#{1,6}\s*)?([A-Za-z']+(?:'s)?)\s+tasks?$/i)
        if (sectionMatch) {
          const name = sectionMatch[1].replace(/'s$/i, '').toLowerCase()
          const memberId = findMember(name)
          if (memberId !== 0) {
            currentAssignee = memberId
          } else if (name === 'whole team' || name === 'team') {
            currentAssignee = 0
          }
          i++
          continue
        }
        
        // Skip horizontal rules / separators
        if (/^[-—]{3,}$/.test(line)) {
          i++
          continue
        }
        
        // Only process top-level bullet points as new tasks
        if (!isTopLevelBullet(rawLine)) {
          i++
          continue
        }
        
        // Found a top-level bullet - this is a new task
        const taskTitle = line.replace(/^[-•]\s*/, '').trim()
        if (taskTitle.length < 5) {
          i++
          continue
        }
        
        // Collect all following indented lines as details
        const detailLines: string[] = []
        let explicitPriority: Priority | null = null
        let explicitDeadline: string | null = null
        let explicitCollaborators: number[] = []
        
        i++ // Move past the title line
        
        while (i < originalLines.length) {
          const nextRaw = originalLines[i]
          const nextLine = stripMarkdown(nextRaw.trim())
          
          // Stop if we hit another top-level bullet, person header, or section header
          if (isTopLevelBullet(nextRaw)) break
          const nextHeaderCheck = isPersonHeader(nextLine)
          if (nextHeaderCheck.isHeader) break
          if (/^(?:#{1,6}\s*)?([A-Za-z']+(?:'s)?)\s+tasks?$/i.test(nextLine)) break
          if (/^[-—]{3,}$/.test(nextLine)) break
          
          // Process indented content (or blank lines)
          if (nextLine) {
            const content = nextLine.replace(/^[-•]\s*/, '').trim()
            
            // Check if it's a Priority/Urgency line
            const priority = parsePriority(content)
            if (priority) {
              explicitPriority = priority
              i++
              continue
            }
            
            // Check if it's a Deadline line
            if (/^deadline[:\s]/i.test(content)) {
              const dateMatch = parseDeadlineText(content)
              if (dateMatch) {
                explicitDeadline = dateMatch
              }
              i++
              continue
            }
            
            // Check if it's a Collaborators line
            if (/^collaborators?[:\s]/i.test(content)) {
              explicitCollaborators = parseCollaborators(content)
              i++
              continue
            }
            
            // Otherwise it's a detail line (but skip urgency/priority lines)
            if (!/^urgency[:\s]/i.test(content)) {
              // Strip "Description:" prefix if present
              const cleanContent = content.replace(/^description[:\s]+/i, '')
              detailLines.push(cleanContent)
            }
          }
          
          i++
        }
        
        // Combine all text for analysis
        const fullTaskText = [taskTitle, ...detailLines].join(' ')
        const description = detailLines.join('\n')
        
        // Use explicit values if provided, otherwise estimate
        const dueDate = explicitDeadline || parseDate(fullTaskText)
        const priority = explicitPriority || estimatePriority(fullTaskText, dueDate)
        const title = extractTitle(taskTitle)
        
        // Use explicit collaborators if found, otherwise detect from text
        let collaborators: number[] = [...explicitCollaborators]
        const lowerText = fullTaskText.toLowerCase()
        
        // Only auto-detect collaborators if none were explicitly listed
        if (collaborators.length === 0) {
          for (const member of memberAliases) {
            if (member.id !== currentAssignee) {
              for (const name of member.names) {
                if (lowerText.includes(name)) {
                  const isCollab = 
                    lowerText.includes(`with ${name}`) ||
                    lowerText.includes(`and ${name}`) ||
                    lowerText.includes(`${name} and `) ||
                    lowerText.includes(`co-lead`) ||
                    lowerText.includes(`co‑lead`) ||
                    lowerText.includes(`coordinate`) ||
                    lowerText.includes(`work with`) ||
                    lowerText.includes(`join`)
                  
                  if (isCollab && !collaborators.includes(member.id)) {
                    collaborators.push(member.id)
                  }
                  break
                }
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
            intensity: estimateIntensity(fullTaskText),
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
          description: description || fullTaskText,
          assignee: currentAssignee,
          collaborators,
          subtasks,
          priority,
          status: 'todo',
          workflow: selectedWorkflow,
          selected: true,
          dueDate: dueDate || undefined,
        })
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
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-gray-600">
                  Found <span className="font-semibold">{suggestedTasks.length}</span> potential tasks.
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSuggestedTasks(prev => prev.map(t => ({ ...t, selected: true })))}
                    className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSuggestedTasks(prev => prev.map(t => ({ ...t, selected: false })))}
                    className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                  >
                    Deselect All
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={() => setSuggestedTasks([])}
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                  >
                    ← Back
                  </button>
                </div>
              </div>
              
              <div className="space-y-3">
                {suggestedTasks.map(task => {
                  const member = teamMembers.find(m => m.id === task.assignee)
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
                            <div className="space-y-4">
                              {/* Title */}
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
                                <input
                                  type="text"
                                  value={task.title}
                                  onChange={e => updateTask(task.id, { title: e.target.value })}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium"
                                />
                              </div>
                              
                              {/* Description */}
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                                <textarea
                                  value={task.description}
                                  onChange={e => updateTask(task.id, { description: e.target.value })}
                                  rows={2}
                                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                                />
                              </div>
                              
                              {/* Assignee, Priority, Due Date row */}
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
                                  <select
                                    value={task.assignee}
                                    onChange={e => {
                                      const newAssignee = parseInt(e.target.value)
                                      // Remove new assignee from collaborators if present
                                      const newCollabs = task.collaborators.filter(c => c !== newAssignee)
                                      updateTask(task.id, { assignee: newAssignee, collaborators: newCollabs })
                                    }}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                                  >
                                    <option value={0}>Unassigned</option>
                                    {teamMembers.map(m => (
                                      <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
                                  <select
                                    value={task.priority}
                                    onChange={e => updateTask(task.id, { priority: e.target.value as Priority })}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                                  >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                    <option value="urgent">Urgent</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
                                  <input
                                    type="date"
                                    value={task.dueDate || ''}
                                    onChange={e => updateTask(task.id, { dueDate: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                                  />
                                </div>
                              </div>
                              
                              {/* Collaborators */}
                              <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Collaborators</label>
                                <div className="flex flex-wrap gap-2">
                                  {teamMembers.filter(m => m.id !== task.assignee).map(m => {
                                    const isCollab = task.collaborators.includes(m.id)
                                    return (
                                      <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => {
                                          if (isCollab) {
                                            // Removing collaborator - also remove their subtask
                                            const newCollabs = task.collaborators.filter(c => c !== m.id)
                                            const newSubtasks = task.subtasks.filter(st => st.personId !== m.id)
                                            updateTask(task.id, { collaborators: newCollabs, subtasks: newSubtasks })
                                          } else {
                                            // Adding collaborator - also add a subtask for them
                                            const newCollabs = [...task.collaborators, m.id]
                                            const newSubtask: Subtask = {
                                              id: Date.now() + m.id,
                                              personId: m.id,
                                              description: '',
                                              intensity: 'small',
                                            }
                                            const newSubtasks = [...task.subtasks, newSubtask]
                                            updateTask(task.id, { collaborators: newCollabs, subtasks: newSubtasks })
                                          }
                                        }}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${
                                          isCollab
                                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                        }`}
                                      >
                                        <span>{m.avatar}</span>
                                        <span>{m.name.split(' ')[0]}</span>
                                        {isCollab && (
                                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                          </svg>
                                        )}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                              
                              {/* Subtasks */}
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="block text-xs font-medium text-gray-500">What each person is doing</label>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newSubtask: Subtask = {
                                        id: Date.now(),
                                        personId: task.assignee || 0,
                                        description: '',
                                        intensity: 'small',
                                      }
                                      updateTask(task.id, { subtasks: [...task.subtasks, newSubtask] })
                                    }}
                                    className="text-xs text-purple-600 hover:text-purple-700 font-medium"
                                  >
                                    + Add
                                  </button>
                                </div>
                                {task.subtasks.length === 0 ? (
                                  <p className="text-xs text-gray-400 py-2 text-center border border-dashed border-gray-200 rounded-lg">
                                    No subtasks
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {task.subtasks.map((st, idx) => (
                                      <div key={st.id} className="flex gap-2 items-center">
                                        <select
                                          value={st.personId}
                                          onChange={e => {
                                            const newSubtasks = [...task.subtasks]
                                            newSubtasks[idx] = { ...st, personId: parseInt(e.target.value) }
                                            updateTask(task.id, { subtasks: newSubtasks })
                                          }}
                                          className="px-2 py-1.5 border border-gray-200 rounded text-xs bg-white min-w-[90px]"
                                        >
                                          <option value={0}>—</option>
                                          {teamMembers.map(m => (
                                            <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
                                          ))}
                                        </select>
                                        <input
                                          type="text"
                                          value={st.description}
                                          onChange={e => {
                                            const newSubtasks = [...task.subtasks]
                                            newSubtasks[idx] = { ...st, description: e.target.value }
                                            updateTask(task.id, { subtasks: newSubtasks })
                                          }}
                                          placeholder="What are they doing?"
                                          className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs"
                                        />
                                        <select
                                          value={st.intensity}
                                          onChange={e => {
                                            const newSubtasks = [...task.subtasks]
                                            newSubtasks[idx] = { ...st, intensity: e.target.value as Intensity }
                                            updateTask(task.id, { subtasks: newSubtasks })
                                          }}
                                          className={`px-2 py-1.5 border border-gray-200 rounded text-xs ${intensityColors[st.intensity]}`}
                                        >
                                          {INTENSITY_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            updateTask(task.id, { subtasks: task.subtasks.filter((_, i) => i !== idx) })
                                          }}
                                          className="p-1 text-gray-400 hover:text-red-500"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
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
                                  <span className="inline-flex items-center text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded font-medium">
                                    {member.avatar}
                                  </span>
                                ) : (
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">—</span>
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
  workflowTypeId?: string // Links to WorkflowType for task templates
}

// Intensity levels for subtasks
type Intensity = 'quick' | 'small' | 'medium' | 'large' | 'huge'

const INTENSITY_OPTIONS: { value: Intensity; label: string; hours: number }[] = [
  { value: 'quick', label: 'Quick Win (~20 min)', hours: 0.33 },
  { value: 'small', label: 'Small (~1 hr)', hours: 1 },
  { value: 'medium', label: 'Medium (~3 hrs)', hours: 3 },
  { value: 'large', label: 'Large (~6 hrs)', hours: 6 },
  { value: 'huge', label: 'Huge (~1 day)', hours: 8 },
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
  completed?: boolean
  completedAt?: string    // ISO timestamp when marked complete
  actualHours?: number    // Actual hours reported by user
}

// New Workflow Modal with Template Tasks
function NewWorkflowModal({
  onClose,
  onSave,
  workflowTypes,
  subTemplates,
  taskTemplates,
}: {
  onClose: () => void
  onSave: (workflow: Workflow, tasks: Task[]) => void
  workflowTypes: WorkflowType[]
  subTemplates: SubTemplate[]
  taskTemplates: TaskTemplate[]
}) {
  const [name, setName] = useState('')
  const [short, setShort] = useState('')
  const [color, setColor] = useState('bg-purple-500')
  const [workflowTypeId, setWorkflowTypeId] = useState<string>(workflowTypes[0]?.id || 'event')
  const eventSubTemplates = subTemplates.filter(st => st.workflowTypeId === workflowTypeId)
  const [eventSubTemplateId, setEventSubTemplateId] = useState<string>(eventSubTemplates[0]?.id || 'in-person')
  const initialTemplates = taskTemplates.filter(t => t.workflowTypeId === workflowTypeId && (eventSubTemplates.length === 0 || t.subTemplateId === eventSubTemplateId))
  const [selectedTasks, setSelectedTasks] = useState<Set<number>>(
    new Set(initialTemplates.map((_, i) => i))
  )
  
  // Get templates for selected workflow type (and sub-template if applicable)
  const currentSubTemplates = subTemplates.filter(st => st.workflowTypeId === workflowTypeId)
  const typeTemplates = taskTemplates.filter(t => {
    if (t.workflowTypeId !== workflowTypeId) return false
    if (currentSubTemplates.length > 0 && t.subTemplateId !== eventSubTemplateId) return false
    return true
  })

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
    setSelectedTasks(new Set(typeTemplates.map((_, i) => i)))
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
      workflowTypeId,
    }

    // Use templates from the selected workflow type
    const selectedTemplates = typeTemplates.filter((_, i) => selectedTasks.has(i))
    const newTasks: Task[] = selectedTemplates.map((template, i) => {
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

          {/* Workflow Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Workflow Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {workflowTypes.map(type => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => {
                    setWorkflowTypeId(type.id)
                    // Reset sub-template and selected tasks
                    const typeSubTemplates = subTemplates.filter(st => st.workflowTypeId === type.id)
                    if (typeSubTemplates.length > 0) {
                      const firstSubTemplate = typeSubTemplates[0].id
                      setEventSubTemplateId(firstSubTemplate)
                      const newTemplates = taskTemplates.filter(t => t.workflowTypeId === type.id && t.subTemplateId === firstSubTemplate)
                      setSelectedTasks(new Set(newTemplates.map((_, i) => i)))
                    } else {
                      const newTemplates = taskTemplates.filter(t => t.workflowTypeId === type.id)
                      setSelectedTasks(new Set(newTemplates.map((_, i) => i)))
                    }
                  }}
                  className={`p-3 rounded-lg border-2 text-left transition ${
                    workflowTypeId === type.id 
                      ? 'border-purple-500 bg-purple-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900">{type.name}</div>
                  <div className="text-xs text-gray-500">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Sub-Template (only show if workflow type has sub-templates) */}
          {currentSubTemplates.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {workflowTypes.find(wt => wt.id === workflowTypeId)?.name || 'Workflow'} Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {currentSubTemplates.map(subTemplate => (
                  <button
                    key={subTemplate.id}
                    type="button"
                    onClick={() => {
                      setEventSubTemplateId(subTemplate.id)
                      const newTemplates = taskTemplates.filter(t => t.workflowTypeId === workflowTypeId && t.subTemplateId === subTemplate.id)
                      setSelectedTasks(new Set(newTemplates.map((_, i) => i)))
                    }}
                    className={`p-3 rounded-lg border-2 text-left transition ${
                      eventSubTemplateId === subTemplate.id 
                        ? 'border-purple-500 bg-purple-50' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-900">{subTemplate.name}</div>
                    <div className="text-xs text-gray-500">{subTemplate.description}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

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
              Select the tasks to include. {selectedTasks.size} of {typeTemplates.length} selected.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg divide-y">
              {typeTemplates.map((task, index) => (
                <label
                  key={task.id}
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
  workflowTasks,
}: {
  workflow: Workflow
  onClose: () => void
  onSave: (updated: Workflow) => void
  onArchive: (taskIdsToArchive: number[]) => void
  onDelete: (taskIdsToDelete: number[]) => void
  workflowTasks: Task[]
}) {
  const [name, setName] = useState(workflow.name)
  const [short, setShort] = useState(workflow.short)
  const [color, setColor] = useState(workflow.color)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [selectedTasksToDelete, setSelectedTasksToDelete] = useState<Set<number>>(
    new Set(workflowTasks.map(t => t.id))
  )
  const [selectedTasksToArchive, setSelectedTasksToArchive] = useState<Set<number>>(
    new Set(workflowTasks.map(t => t.id))
  )

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
          {!showDeleteConfirm && !showArchiveConfirm ? (
            <>
              <div className="flex gap-2">
                {workflow.archived ? (
                  <button
                    type="button"
                    onClick={() => { onArchive([]); onClose(); }}
                    className="px-4 py-2 text-green-600 font-medium hover:bg-green-50 rounded-lg transition"
                  >
                    Unarchive
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (workflowTasks.length > 0) {
                        setShowArchiveConfirm(true)
                      } else {
                        onArchive([])
                        onClose()
                      }
                    }}
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
          ) : showDeleteConfirm ? (
            <div className="w-full space-y-4">
              <p className="text-sm text-gray-600">Delete this workflow? Select which associated tasks to also delete:</p>
              
              {workflowTasks.length > 0 ? (
                <>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedTasksToDelete(new Set(workflowTasks.map(t => t.id)))}
                      className="text-purple-600 hover:text-purple-700 font-medium"
                    >
                      Select All ({workflowTasks.length})
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedTasksToDelete(new Set())}
                      className="text-gray-500 hover:text-gray-700 font-medium"
                    >
                      Deselect All
                    </button>
                  </div>
                  
                  <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                    {workflowTasks.map(task => (
                      <label
                        key={task.id}
                        className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                          selectedTasksToDelete.has(task.id) ? 'bg-red-50' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTasksToDelete.has(task.id)}
                          onChange={() => {
                            const newSet = new Set(selectedTasksToDelete)
                            if (newSet.has(task.id)) {
                              newSet.delete(task.id)
                            } else {
                              newSet.add(task.id)
                            }
                            setSelectedTasksToDelete(newSet)
                          }}
                          className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate block">{task.title}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            task.status === 'done' ? 'bg-green-100 text-green-700' :
                            task.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {task.status}
                          </span>
                        </div>
                      </label>
                    ))}
                  </div>
                  
                  <p className="text-xs text-gray-500">
                    {selectedTasksToDelete.size} task{selectedTasksToDelete.size !== 1 ? 's' : ''} will be deleted
                  </p>
                </>
              ) : (
                <p className="text-sm text-gray-500 italic">No tasks associated with this workflow.</p>
              )}
              
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { onDelete(Array.from(selectedTasksToDelete)); onClose(); }}
                  className="px-4 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition"
                >
                  Delete Workflow{selectedTasksToDelete.size > 0 ? ` + ${selectedTasksToDelete.size} Tasks` : ''}
                </button>
              </div>
            </div>
          ) : showArchiveConfirm ? (
            <div className="w-full space-y-4">
              <p className="text-sm text-gray-600">Archive this workflow? Select which tasks to also archive:</p>
              
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedTasksToArchive(new Set(workflowTasks.map(t => t.id)))}
                  className="text-purple-600 hover:text-purple-700 font-medium"
                >
                  Select All ({workflowTasks.length})
                </button>
                <span className="text-gray-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedTasksToArchive(new Set())}
                  className="text-gray-500 hover:text-gray-700 font-medium"
                >
                  Deselect All
                </button>
              </div>
              
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                {workflowTasks.map(task => (
                  <label
                    key={task.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${
                      selectedTasksToArchive.has(task.id) ? 'bg-amber-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTasksToArchive.has(task.id)}
                      onChange={() => {
                        const newSet = new Set(selectedTasksToArchive)
                        if (newSet.has(task.id)) {
                          newSet.delete(task.id)
                        } else {
                          newSet.add(task.id)
                        }
                        setSelectedTasksToArchive(newSet)
                      }}
                      className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate block">{task.title}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        task.status === 'done' ? 'bg-green-100 text-green-700' :
                        task.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {task.status}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
              
              <p className="text-xs text-gray-500">
                {selectedTasksToArchive.size} task{selectedTasksToArchive.size !== 1 ? 's' : ''} will be archived
              </p>
              
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(false)}
                  className="px-4 py-2 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { onArchive(Array.from(selectedTasksToArchive)); onClose(); }}
                  className="px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 transition"
                >
                  Archive Workflow{selectedTasksToArchive.size > 0 ? ` + ${selectedTasksToArchive.size} Tasks` : ''}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Add Task Modal with integrated input options
function AddTaskModal({
  onClose,
  onSave,
  workflows,
  defaultWorkflow,
  teamMembers,
  currentUserEmail,
  taskTemplates,
}: {
  onClose: () => void
  onSave: (task: Task) => void
  workflows: Workflow[]
  defaultWorkflow: string | null
  teamMembers: { id: number; name: string; role: string; avatar: string }[]
  currentUserEmail?: string
  taskTemplates: TaskTemplate[]
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [workflow, setWorkflow] = useState<string | null>(defaultWorkflow)
  const [subWorkflow, setSubWorkflow] = useState<string | null>(null)
  const [priority, setPriority] = useState<Priority>('medium')
  const [assignee, setAssignee] = useState<number>(0)
  const [collaborators, setCollaborators] = useState<number[]>([])
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [meetingNotes, setMeetingNotes] = useState('')
  const [activeTab, setActiveTab] = useState<'basic' | 'attachments'>('basic')
  
  // Get available templates based on selected workflow's type
  const selectedWorkflow = workflows.find(w => w.id === workflow)
  const availableTemplates = selectedWorkflow?.workflowTypeId 
    ? taskTemplates.filter(t => t.workflowTypeId === selectedWorkflow.workflowTypeId)
    : []
  
  // Apply template
  const applyTemplate = (templateId: string) => {
    const template = taskTemplates.find(t => t.id === templateId)
    if (template) {
      setTitle(template.title)
      setDescription(template.description)
      setPriority(template.priority)
    }
  }
  
  // Toggle collaborator
  const toggleCollaborator = (memberId: number) => {
    if (memberId === assignee) return
    
    const isRemoving = collaborators.includes(memberId)
    
    if (isRemoving) {
      setCollaborators(prev => prev.filter(id => id !== memberId))
      setSubtasks(prev => prev.map(st => 
        st.personId === memberId ? { ...st, personId: 0 } : st
      ))
    } else {
      const unassignedSubtaskIndex = subtasks.findIndex(st => st.personId === 0)
      
      let newSubtasks = [...subtasks]
      if (unassignedSubtaskIndex !== -1) {
        newSubtasks[unassignedSubtaskIndex] = {
          ...newSubtasks[unassignedSubtaskIndex],
          personId: memberId
        }
      } else {
        newSubtasks.push({
          id: Date.now(),
          personId: memberId,
          description: '',
          intensity: 'small'
        })
      }
      
      setCollaborators(prev => [...prev, memberId])
      setSubtasks(newSubtasks)
    }
  }
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  
  // Image upload ref
  const imageInputRef = useRef<HTMLInputElement>(null)
  
  const activeWorkflows = workflows.filter(w => !w.archived)

  // Start voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data)
      }
      
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const audioUrl = URL.createObjectURL(audioBlob)
        const newAttachment: Attachment = {
          id: Date.now(),
          type: 'voice',
          url: audioUrl,
          name: `Voice Note ${attachments.filter(a => a.type === 'voice').length + 1}`,
          duration: recordingTime,
        }
        setAttachments(prev => [...prev, newAttachment])
        setRecordingTime(0)
        stream.getTracks().forEach(track => track.stop())
      }
      
      mediaRecorder.start()
      setIsRecording(true)
      
      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)
    } catch (err) {
      console.error('Could not start recording:', err)
      alert('Could not access microphone. Please check your permissions.')
    }
  }
  
  // Stop voice recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }
  
  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      
      const reader = new FileReader()
      reader.onload = (event) => {
        const newAttachment: Attachment = {
          id: Date.now() + Math.random(),
          type: 'image',
          url: event.target?.result as string,
          name: file.name,
        }
        setAttachments(prev => [...prev, newAttachment])
      }
      reader.readAsDataURL(file)
    })
    
    // Reset input
    if (imageInputRef.current) {
      imageInputRef.current.value = ''
    }
  }
  
  // Remove attachment
  const removeAttachment = (id: number) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }
  
  // Format time for display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Save meeting notes as attachment
  const saveMeetingNotes = () => {
    if (!meetingNotes.trim()) return
    
    const newAttachment: Attachment = {
      id: Date.now(),
      type: 'note',
      url: meetingNotes,
      name: `Meeting Notes ${attachments.filter(a => a.type === 'note').length + 1}`,
    }
    setAttachments(prev => [...prev, newAttachment])
    setMeetingNotes('')
  }
  
  // Handle save
  const handleSave = () => {
    if (!title.trim()) {
      alert('Please enter a task title')
      return
    }
    
    // If there are meeting notes not yet saved, add them
    let finalAttachments = [...attachments]
    if (meetingNotes.trim()) {
      finalAttachments.push({
        id: Date.now(),
        type: 'note',
        url: meetingNotes,
        name: `Meeting Notes ${attachments.filter(a => a.type === 'note').length + 1}`,
      })
    }
    
    const newTask: Task = {
      id: Date.now(),
      title: title.trim(),
      description: description.trim(),
      assignee,
      collaborators,
      subtasks: subtasks.length > 0 ? subtasks : (assignee ? [{
        id: Date.now(),
        personId: assignee,
        description: '',
        intensity: 'small' as Intensity,
      }] : []),
      priority,
      status: 'todo',
      dueDate,
      createdAt: new Date().toISOString().split('T')[0],
      createdBy: currentUserEmail,
      workflow,
      subWorkflow,
      attachments: finalAttachments.length > 0 ? finalAttachments : undefined,
    }
    
    onSave(newTask)
    onClose()
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop()
      }
    }
  }, [isRecording])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Add New Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('basic')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              activeTab === 'basic'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Task Details
          </button>
          <button
            onClick={() => setActiveTab('attachments')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'attachments'
                ? 'text-purple-600 border-b-2 border-purple-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Attachments
            {attachments.length > 0 && (
              <span className="bg-purple-100 text-purple-600 text-xs px-2 py-0.5 rounded-full">
                {attachments.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' ? (
            <div className="space-y-4">
              {/* Task Template Selector */}
              {availableTemplates.length > 0 && (
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                  <label className="block text-sm font-medium text-purple-700 dark:text-purple-300 mb-2">
                    📋 Quick Start from Template
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {availableTemplates.map(template => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applyTemplate(template.id)}
                        className="px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-purple-200 dark:border-purple-700 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-800 transition text-gray-700 dark:text-gray-200"
                      >
                        {template.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Task Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="What needs to be done?"
                  autoFocus
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add more details..."
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none"
                />
              </div>

              {/* Workflow, Sub-Workflow & Priority */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Workflow</label>
                  <select
                    value={workflow || ''}
                    onChange={e => {
                      setWorkflow(e.target.value || null)
                      // Clear sub-workflow if it matches the new workflow
                      if (e.target.value === subWorkflow) setSubWorkflow(null)
                    }}
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="">No workflow</option>
                    {activeWorkflows.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Sub-Workflow</label>
                  <select
                    value={subWorkflow || ''}
                    onChange={e => setSubWorkflow(e.target.value || null)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="">None</option>
                    {activeWorkflows.filter(w => w.id !== workflow).map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as Priority)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                />
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Assign To</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAssignee(0)}
                    className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                      assignee === 0
                        ? 'border-gray-400 bg-gray-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                      ?
                    </div>
                    <span className="text-sm font-medium text-gray-600 truncate">Unassigned</span>
                  </button>
                  {teamMembers.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        const newAssignee = member.id
                        const filteredCollabs = collaborators.filter(id => id !== member.id)
                        
                        // First subtask always follows assignee
                        let newSubtasks = [...subtasks]
                        if (subtasks.length === 0) {
                          // Create first subtask for assignee
                          newSubtasks = [{
                            id: Date.now(),
                            personId: newAssignee,
                            description: '',
                            intensity: 'small' as Intensity,
                          }]
                        } else {
                          // Update first subtask to match new assignee
                          newSubtasks[0] = { ...newSubtasks[0], personId: newAssignee }
                        }
                        
                        setAssignee(newAssignee)
                        setCollaborators(filteredCollabs)
                        setSubtasks(newSubtasks)
                      }}
                      className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                        assignee === member.id
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

              {/* Collaborators */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Collaborators</label>
                <div className="grid grid-cols-3 gap-2">
                  {teamMembers.filter(m => m.id !== assignee).map(member => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleCollaborator(member.id)}
                      className={`flex items-center gap-2 p-3 rounded-lg border-2 transition ${
                        collaborators.includes(member.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                        collaborators.includes(member.id)
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {member.avatar}
                      </div>
                      <span className="text-sm font-medium text-gray-700 truncate">{member.name.split(' ')[0]}</span>
                      {collaborators.includes(member.id) && (
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
                        personId: assignee || 0,
                        description: '',
                        intensity: 'small',
                      }
                      setSubtasks(prev => [...prev, newSubtask])
                    }}
                    className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                  >
                    + Add subtask
                  </button>
                </div>
                
                {subtasks.length === 0 ? (
                  <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                    No subtasks yet. Add one to specify what each person is responsible for.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {subtasks.map((subtask, index) => {
                      const person = teamMembers.find(m => m.id === subtask.personId)
                      return (
                        <div key={subtask.id} className="flex gap-3 items-start p-3 bg-gray-50 rounded-lg">
                          <select
                            value={subtask.personId}
                            onChange={e => {
                              const newSubtasks = [...subtasks]
                              newSubtasks[index] = { ...subtask, personId: parseInt(e.target.value) }
                              setSubtasks(newSubtasks)
                            }}
                            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none min-w-[140px]"
                          >
                            <option value={0}>Unassigned</option>
                            {teamMembers.map(m => (
                              <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
                            ))}
                          </select>
                          <div className="flex-1">
                            <input
                              type="text"
                              value={subtask.description}
                              onChange={e => {
                                const newSubtasks = [...subtasks]
                                newSubtasks[index] = { ...subtask, description: e.target.value }
                                setSubtasks(newSubtasks)
                              }}
                              placeholder="What are they doing?"
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                            />
                          </div>
                          <select
                            value={subtask.intensity}
                            onChange={e => {
                              const newSubtasks = [...subtasks]
                              newSubtasks[index] = { ...subtask, intensity: e.target.value as Intensity }
                              setSubtasks(newSubtasks)
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
                              setSubtasks(subtasks.filter((_, i) => i !== index))
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
          ) : (
            <div className="space-y-6">
              {/* Upload Options */}
              <div className="grid grid-cols-3 gap-3">
                {/* Image Upload */}
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition"
                >
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Upload Image</span>
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />

                {/* Voice Note */}
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`flex flex-col items-center gap-2 p-4 border-2 border-dashed rounded-xl transition ${
                    isRecording 
                      ? 'border-red-400 bg-red-50' 
                      : 'border-gray-300 hover:border-purple-400 hover:bg-purple-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    isRecording ? 'bg-red-100 animate-pulse' : 'bg-green-100'
                  }`}>
                    {isRecording ? (
                      <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 24 24">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    {isRecording ? `Recording ${formatTime(recordingTime)}` : 'Voice Note'}
                  </span>
                </button>

                {/* Meeting Notes Toggle */}
                <button
                  type="button"
                  onClick={() => {
                    const textarea = document.getElementById('meeting-notes-textarea')
                    if (textarea) textarea.focus()
                  }}
                  className="flex flex-col items-center gap-2 p-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition"
                >
                  <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700">Meeting Notes</span>
                </button>
              </div>

              {/* Meeting Notes Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Meeting Notes</label>
                <textarea
                  id="meeting-notes-textarea"
                  value={meetingNotes}
                  onChange={e => setMeetingNotes(e.target.value)}
                  placeholder="Paste or type meeting notes, transcript, or context..."
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none font-mono text-sm"
                />
                {meetingNotes.trim() && (
                  <button
                    type="button"
                    onClick={saveMeetingNotes}
                    className="mt-2 text-sm text-purple-600 hover:text-purple-700 font-medium"
                  >
                    + Save as separate note
                  </button>
                )}
              </div>

              {/* Attachments List */}
              {attachments.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Attached ({attachments.length})
                  </label>
                  <div className="space-y-2">
                    {attachments.map(attachment => (
                      <div 
                        key={attachment.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                      >
                        {/* Icon */}
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          attachment.type === 'image' ? 'bg-blue-100' :
                          attachment.type === 'voice' ? 'bg-green-100' :
                          'bg-amber-100'
                        }`}>
                          {attachment.type === 'image' ? (
                            <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          ) : attachment.type === 'voice' ? (
                            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          )}
                        </div>
                        
                        {/* Preview */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{attachment.name}</p>
                          {attachment.type === 'voice' && attachment.duration && (
                            <p className="text-xs text-gray-500">{formatTime(attachment.duration)}</p>
                          )}
                          {attachment.type === 'note' && (
                            <p className="text-xs text-gray-500 truncate">{attachment.url.slice(0, 50)}...</p>
                          )}
                        </div>
                        
                        {/* Image preview */}
                        {attachment.type === 'image' && (
                          <img 
                            src={attachment.url} 
                            alt={attachment.name}
                            className="w-12 h-12 object-cover rounded"
                          />
                        )}
                        
                        {/* Audio playback */}
                        {attachment.type === 'voice' && (
                          <audio src={attachment.url} controls className="h-8 w-32" />
                        )}
                        
                        {/* Remove button */}
                        <button
                          type="button"
                          onClick={() => removeAttachment(attachment.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 transition"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-6 border-t bg-gray-50">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {attachments.length > 0 && (
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
              </span>
            )}
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
              disabled={!title.trim()}
              className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Task
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Template Manager Modal
function TemplateManagerModal({
  workflowTypes,
  subTemplates,
  taskTemplates,
  onSaveWorkflowTypes,
  onSaveSubTemplates,
  onSaveTaskTemplates,
  onClose,
}: {
  workflowTypes: WorkflowType[]
  subTemplates: SubTemplate[]
  taskTemplates: TaskTemplate[]
  onSaveWorkflowTypes: (types: WorkflowType[]) => void
  onSaveSubTemplates: (templates: SubTemplate[]) => void
  onSaveTaskTemplates: (templates: TaskTemplate[]) => void
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'workflows' | 'subtemplates' | 'tasks'>('workflows')
  const [editingWorkflowType, setEditingWorkflowType] = useState<WorkflowType | null>(null)
  const [editingSubTemplate, setEditingSubTemplate] = useState<SubTemplate | null>(null)
  const [editingTaskTemplate, setEditingTaskTemplate] = useState<TaskTemplate | null>(null)
  const [selectedWorkflowTypeId, setSelectedWorkflowTypeId] = useState<string>(workflowTypes[0]?.id || 'event')
  const [selectedSubTemplateId, setSelectedSubTemplateId] = useState<string>('')
  
  // New item forms
  const [newWorkflowType, setNewWorkflowType] = useState({ name: '', description: '' })
  const [newSubTemplate, setNewSubTemplate] = useState({ name: '', description: '' })
  const [newTaskTemplate, setNewTaskTemplate] = useState({ title: '', description: '', priority: 'medium' as Priority })
  
  // Workflow type CRUD
  const addWorkflowType = () => {
    if (!newWorkflowType.name.trim()) return
    const id = `wf-${Date.now()}`
    onSaveWorkflowTypes([...workflowTypes, { id, ...newWorkflowType }])
    setNewWorkflowType({ name: '', description: '' })
  }
  
  const updateWorkflowType = (updated: WorkflowType) => {
    onSaveWorkflowTypes(workflowTypes.map(wt => wt.id === updated.id ? updated : wt))
    setEditingWorkflowType(null)
  }
  
  const deleteWorkflowType = (id: string) => {
    if (!confirm('Delete this workflow type and all its sub-templates and tasks?')) return
    onSaveWorkflowTypes(workflowTypes.filter(wt => wt.id !== id))
    onSaveSubTemplates(subTemplates.filter(st => st.workflowTypeId !== id))
    onSaveTaskTemplates(taskTemplates.filter(tt => tt.workflowTypeId !== id))
  }
  
  // Sub-template CRUD
  const addSubTemplate = () => {
    if (!newSubTemplate.name.trim()) return
    const id = `st-${Date.now()}`
    onSaveSubTemplates([...subTemplates, { id, workflowTypeId: selectedWorkflowTypeId, ...newSubTemplate }])
    setNewSubTemplate({ name: '', description: '' })
  }
  
  const updateSubTemplate = (updated: SubTemplate) => {
    onSaveSubTemplates(subTemplates.map(st => st.id === updated.id ? updated : st))
    setEditingSubTemplate(null)
  }
  
  const deleteSubTemplate = (id: string) => {
    if (!confirm('Delete this sub-template and all its tasks?')) return
    onSaveSubTemplates(subTemplates.filter(st => st.id !== id))
    onSaveTaskTemplates(taskTemplates.filter(tt => tt.subTemplateId !== id))
  }
  
  // Task template CRUD
  const addTaskTemplate = () => {
    if (!newTaskTemplate.title.trim()) return
    const id = `tt-${Date.now()}`
    const hasSubTemplates = subTemplates.some(st => st.workflowTypeId === selectedWorkflowTypeId)
    onSaveTaskTemplates([...taskTemplates, { 
      id, 
      workflowTypeId: selectedWorkflowTypeId,
      subTemplateId: hasSubTemplates ? selectedSubTemplateId || undefined : undefined,
      ...newTaskTemplate 
    }])
    setNewTaskTemplate({ title: '', description: '', priority: 'medium' })
  }
  
  const updateTaskTemplate = (updated: TaskTemplate) => {
    onSaveTaskTemplates(taskTemplates.map(tt => tt.id === updated.id ? updated : tt))
    setEditingTaskTemplate(null)
  }
  
  const deleteTaskTemplate = (id: string) => {
    onSaveTaskTemplates(taskTemplates.filter(tt => tt.id !== id))
  }
  
  // Filtered lists
  const filteredSubTemplates = subTemplates.filter(st => st.workflowTypeId === selectedWorkflowTypeId)
  const filteredTaskTemplates = taskTemplates.filter(tt => {
    if (tt.workflowTypeId !== selectedWorkflowTypeId) return false
    if (selectedSubTemplateId && tt.subTemplateId !== selectedSubTemplateId) return false
    return true
  })
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div 
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-4xl max-h-[90vh] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Manage Templates</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b dark:border-gray-700">
          {(['workflows', 'subtemplates', 'tasks'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition ${
                activeTab === tab 
                  ? 'text-purple-600 border-b-2 border-purple-600' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'workflows' ? 'Workflow Types' : tab === 'subtemplates' ? 'Sub-Templates' : 'Task Templates'}
            </button>
          ))}
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Workflow Types Tab */}
          {activeTab === 'workflows' && (
            <div className="space-y-4">
              {/* Add new */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <h3 className="font-medium text-gray-900 dark:text-white mb-3">Add Workflow Type</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newWorkflowType.name}
                    onChange={e => setNewWorkflowType(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Name"
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <input
                    type="text"
                    value={newWorkflowType.description}
                    onChange={e => setNewWorkflowType(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description"
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    onClick={addWorkflowType}
                    disabled={!newWorkflowType.name.trim()}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              
              {/* List */}
              <div className="space-y-2">
                {workflowTypes.map(wt => (
                  <div key={wt.id} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                    {editingWorkflowType?.id === wt.id ? (
                      <>
                        <input
                          type="text"
                          value={editingWorkflowType.name}
                          onChange={e => setEditingWorkflowType({ ...editingWorkflowType, name: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        />
                        <input
                          type="text"
                          value={editingWorkflowType.description}
                          onChange={e => setEditingWorkflowType({ ...editingWorkflowType, description: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        />
                        <button onClick={() => updateWorkflowType(editingWorkflowType)} className="text-green-600 hover:text-green-700">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button onClick={() => setEditingWorkflowType(null)} className="text-gray-400 hover:text-gray-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">{wt.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{wt.description}</div>
                        </div>
                        <span className="text-xs text-gray-400">
                          {subTemplates.filter(st => st.workflowTypeId === wt.id).length} sub-templates
                        </span>
                        <button onClick={() => setEditingWorkflowType(wt)} className="text-gray-400 hover:text-purple-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onClick={() => deleteWorkflowType(wt.id)} className="text-gray-400 hover:text-red-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Sub-Templates Tab */}
          {activeTab === 'subtemplates' && (
            <div className="space-y-4">
              {/* Workflow type selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">For Workflow Type</label>
                <select
                  value={selectedWorkflowTypeId}
                  onChange={e => setSelectedWorkflowTypeId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                >
                  {workflowTypes.map(wt => (
                    <option key={wt.id} value={wt.id}>{wt.name}</option>
                  ))}
                </select>
              </div>
              
              {/* Add new */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <h3 className="font-medium text-gray-900 dark:text-white mb-3">Add Sub-Template</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubTemplate.name}
                    onChange={e => setNewSubTemplate(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Name (e.g. In-Person Event)"
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <input
                    type="text"
                    value={newSubTemplate.description}
                    onChange={e => setNewSubTemplate(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description"
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <button
                    onClick={addSubTemplate}
                    disabled={!newSubTemplate.name.trim()}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              
              {/* List */}
              <div className="space-y-2">
                {filteredSubTemplates.length === 0 ? (
                  <p className="text-center text-gray-400 py-4">No sub-templates for this workflow type</p>
                ) : filteredSubTemplates.map(st => (
                  <div key={st.id} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                    {editingSubTemplate?.id === st.id ? (
                      <>
                        <input
                          type="text"
                          value={editingSubTemplate.name}
                          onChange={e => setEditingSubTemplate({ ...editingSubTemplate, name: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        />
                        <input
                          type="text"
                          value={editingSubTemplate.description}
                          onChange={e => setEditingSubTemplate({ ...editingSubTemplate, description: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        />
                        <button onClick={() => updateSubTemplate(editingSubTemplate)} className="text-green-600 hover:text-green-700">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button onClick={() => setEditingSubTemplate(null)} className="text-gray-400 hover:text-gray-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">{st.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{st.description}</div>
                        </div>
                        <span className="text-xs text-gray-400">
                          {taskTemplates.filter(tt => tt.subTemplateId === st.id).length} tasks
                        </span>
                        <button onClick={() => setEditingSubTemplate(st)} className="text-gray-400 hover:text-purple-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onClick={() => deleteSubTemplate(st.id)} className="text-gray-400 hover:text-red-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Task Templates Tab */}
          {activeTab === 'tasks' && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Workflow Type</label>
                  <select
                    value={selectedWorkflowTypeId}
                    onChange={e => { setSelectedWorkflowTypeId(e.target.value); setSelectedSubTemplateId('') }}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                  >
                    {workflowTypes.map(wt => (
                      <option key={wt.id} value={wt.id}>{wt.name}</option>
                    ))}
                  </select>
                </div>
                {filteredSubTemplates.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sub-Template</label>
                    <select
                      value={selectedSubTemplateId}
                      onChange={e => setSelectedSubTemplateId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                    >
                      <option value="">All sub-templates</option>
                      {filteredSubTemplates.map(st => (
                        <option key={st.id} value={st.id}>{st.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              
              {/* Add new */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                <h3 className="font-medium text-gray-900 dark:text-white mb-3">Add Task Template</h3>
                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    value={newTaskTemplate.title}
                    onChange={e => setNewTaskTemplate(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Task title"
                    className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <input
                    type="text"
                    value={newTaskTemplate.description}
                    onChange={e => setNewTaskTemplate(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Description"
                    className="flex-1 min-w-[200px] px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                  <select
                    value={newTaskTemplate.priority}
                    onChange={e => setNewTaskTemplate(prev => ({ ...prev, priority: e.target.value as Priority }))}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                  <button
                    onClick={addTaskTemplate}
                    disabled={!newTaskTemplate.title.trim()}
                    className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
              
              {/* List */}
              <div className="space-y-2">
                {filteredTaskTemplates.length === 0 ? (
                  <p className="text-center text-gray-400 py-4">No task templates</p>
                ) : filteredTaskTemplates.map(tt => (
                  <div key={tt.id} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                    {editingTaskTemplate?.id === tt.id ? (
                      <>
                        <input
                          type="text"
                          value={editingTaskTemplate.title}
                          onChange={e => setEditingTaskTemplate({ ...editingTaskTemplate, title: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        />
                        <input
                          type="text"
                          value={editingTaskTemplate.description}
                          onChange={e => setEditingTaskTemplate({ ...editingTaskTemplate, description: e.target.value })}
                          className="flex-1 px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        />
                        <select
                          value={editingTaskTemplate.priority}
                          onChange={e => setEditingTaskTemplate({ ...editingTaskTemplate, priority: e.target.value as Priority })}
                          className="px-2 py-1 border rounded text-sm dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <button onClick={() => updateTaskTemplate(editingTaskTemplate)} className="text-green-600 hover:text-green-700">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        </button>
                        <button onClick={() => setEditingTaskTemplate(null)} className="text-gray-400 hover:text-gray-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900 dark:text-white">{tt.title}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full border ${
                              tt.priority === 'urgent' ? 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900 dark:text-red-300' :
                              tt.priority === 'high' ? 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900 dark:text-orange-300' :
                              tt.priority === 'medium' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900 dark:text-blue-300' :
                              'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-600 dark:text-gray-300'
                            }`}>
                              {tt.priority}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">{tt.description}</div>
                        </div>
                        <button onClick={() => setEditingTaskTemplate(tt)} className="text-gray-400 hover:text-purple-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onClick={() => deleteTaskTemplate(tt.id)} className="text-gray-400 hover:text-red-600">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            onClick={() => {
              if (confirm('Reset all templates to defaults? This cannot be undone.')) {
                onSaveWorkflowTypes(DEFAULT_WORKFLOW_TYPES)
                onSaveSubTemplates(DEFAULT_SUB_TEMPLATES)
                onSaveTaskTemplates(DEFAULT_TASK_TEMPLATES)
              }
            }}
            className="px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition text-sm"
          >
            Reset to Defaults
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const router = useRouter()
  const { user, loading: authLoading, signOut } = useAuth()
  const { theme, resolvedTheme, setTheme } = useTheme()
  
  // Data from Supabase (or demo mode)
  const {
    tasks,
    workflows,
    teamMembers,
    loading,
    isDemo,
    createTask,
    updateTask: updateTaskInDb,
    deleteTask,
    setTasks,
    createWorkflow,
    updateWorkflow: updateWorkflowInDb,
    deleteWorkflow: deleteWorkflowFromDb,
    setWorkflows,
    weekCapacities,
    weekNotes,
    setWeekCapacity,
    setWeekNote,
  } = useData()

  // Wrapper to create task AND send Discord notification
  const createTaskWithNotification = async (task: Task) => {
    await createTask(task)
    
    // Send Discord notification if assignee is set
    if (task.assignee && getDiscordWebhookUrl()) {
      const assignee = teamMembers.find(m => m.id === task.assignee)
      if (assignee) {
        const collaboratorMembers = task.collaborators
          ?.map(cid => teamMembers.find(m => m.id === cid))
          .filter(Boolean)
          .map(m => ({ name: m!.name, discordId: m!.discordId }))
        
        await notifyTaskAssigned({
          title: task.title,
          assignee: assignee.name,
          assigneeDiscordId: assignee.discordId,
          collaborators: collaboratorMembers,
          dueDate: task.dueDate,
          priority: task.priority,
        }, typeof window !== 'undefined' ? window.location.href : undefined)
      }
    }
  }

  // ALL useState hooks MUST be before any early returns
  const [view, setView] = useState<'board' | 'team' | 'list' | 'workload' | 'calendar' | 'gantt'>('board')
  
  // Calendar view state
  const [calendarPeriod, setCalendarPeriod] = useState<'week' | 'month' | 'quarter'>('month')
  const [calendarMode, setCalendarMode] = useState<'fixed' | 'rolling'>('fixed')
  const [calendarDate, setCalendarDate] = useState(() => new Date().toISOString().split('T')[0])
  
  // Custom labels state
  const [labels, setLabels] = useState<Label[]>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('task-tracker-labels')
      if (stored) {
        return [...DEFAULT_LABELS, ...JSON.parse(stored)]
      }
    }
    return DEFAULT_LABELS
  })
  
  // Save custom labels to localStorage
  const addLabel = (name: string, color: string) => {
    const newLabel: Label = { id: `custom-${Date.now()}`, name, color }
    const customLabels = labels.filter(l => !l.isDefault)
    const updated = [...customLabels, newLabel]
    localStorage.setItem('task-tracker-labels', JSON.stringify(updated))
    setLabels([...DEFAULT_LABELS, ...updated])
    return newLabel.id
  }
  
  // Workflow types state (editable)
  const [workflowTypes, setWorkflowTypes] = useState<WorkflowType[]>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('task-tracker-workflow-types')
      if (stored) return JSON.parse(stored)
    }
    return DEFAULT_WORKFLOW_TYPES
  })
  
  // Sub-templates state (editable)
  const [subTemplates, setSubTemplates] = useState<SubTemplate[]>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('task-tracker-sub-templates')
      if (stored) return JSON.parse(stored)
    }
    return DEFAULT_SUB_TEMPLATES
  })
  
  // Task templates state (editable)
  const [taskTemplates, setTaskTemplates] = useState<TaskTemplate[]>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('task-tracker-task-templates')
      if (stored) return JSON.parse(stored)
    }
    return DEFAULT_TASK_TEMPLATES
  })
  
  // Template management functions
  const saveWorkflowTypes = (types: WorkflowType[]) => {
    localStorage.setItem('task-tracker-workflow-types', JSON.stringify(types))
    setWorkflowTypes(types)
  }
  
  const saveSubTemplates = (templates: SubTemplate[]) => {
    localStorage.setItem('task-tracker-sub-templates', JSON.stringify(templates))
    setSubTemplates(templates)
  }
  
  const saveTaskTemplates = (templates: TaskTemplate[]) => {
    localStorage.setItem('task-tracker-task-templates', JSON.stringify(templates))
    setTaskTemplates(templates)
  }
  
  // Template management modal state
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  
  // Busy days state (for workload view) - stores which days are busy per member per week
  // Format: { "2026-03-24": { 1: [0, 2, 4] } } = member 1 busy on Mon, Wed, Fri of that week
  const [busyDays, setBusyDays] = useState<Record<string, Record<number, number[]>>>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('task-tracker-busy-days')
      if (stored) return JSON.parse(stored)
    }
    return {}
  })
  
  // Toggle busy day for a member
  const toggleBusyDay = (memberId: number, weekStart: string, dayIndex: number) => {
    setBusyDays(prev => {
      const weekData = prev[weekStart] || {}
      const memberDays = weekData[memberId] || []
      const updated = memberDays.includes(dayIndex)
        ? memberDays.filter(d => d !== dayIndex)
        : [...memberDays, dayIndex].sort()
      const newData = {
        ...prev,
        [weekStart]: {
          ...weekData,
          [memberId]: updated
        }
      }
      localStorage.setItem('task-tracker-busy-days', JSON.stringify(newData))
      return newData
    })
  }
  
  // Get busy days for a member
  const getMemberBusyDays = (memberId: number, weekStart: string): number[] => {
    return busyDays[weekStart]?.[memberId] || []
  }
  
  // Get current user's team member ID (for restricting workload edits)
  const getCurrentUserMemberId = (): number | null => {
    if (!user?.email) return null
    const emailLower = user.email.toLowerCase()
    // Try to match by email or name
    const member = teamMembers.find(m => {
      // Check if any part of member name matches email prefix
      const nameParts = m.name.toLowerCase().split(' ')
      const emailPrefix = emailLower.split('@')[0]
      return nameParts.some(part => emailPrefix.includes(part)) || 
             emailPrefix.includes(nameParts[0])
    })
    return member?.id || null
  }
  const currentUserMemberId = getCurrentUserMemberId()
  
  // Settings modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [discordWebhook, setDiscordWebhook] = useState('')
  
  // Load Discord webhook on mount
  useEffect(() => {
    const url = getDiscordWebhookUrl()
    if (url) setDiscordWebhook(url)
  }, [])
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showNewWorkflowModal, setShowNewWorkflowModal] = useState(false)
  const [showMeetingNotesModal, setShowMeetingNotesModal] = useState(false)
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
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
  
  // Workload period view (week, 2weeks, month, quarter)
  const [workloadPeriod, setWorkloadPeriod] = useState<'week' | '2weeks' | 'month' | 'quarter'>('week')
  // Workload mode: fixed (calendar-based) or rolling (from today)
  const [workloadMode, setWorkloadMode] = useState<'fixed' | 'rolling'>('rolling')
  
  // Global workflow filter (applies to all views)
  const [globalWorkflow, setGlobalWorkflow] = useState<string>('all')
  
  // List view filters & sorting
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'status' | 'workflow'>('dueDate')
  
  // Multi-select state
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set())
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  
  // Board view sorting
  const [boardSortBy, setBoardSortBy] = useState<'none' | 'dueDate' | 'priority' | 'assignee'>('none')
  
  // Workload popup state: { memberId, intensity } or null
  const [workloadPopup, setWorkloadPopup] = useState<{ memberId: number; intensity: Intensity | 'unspecified' } | null>(null)
  
  // Team view state
  const [teamViewFilter, setTeamViewFilter] = useState<'all' | 'assigned' | 'collaborating'>('all')
  const [expandedMembers, setExpandedMembers] = useState<Set<number>>(new Set())
  const [teamViewMode, setTeamViewMode] = useState<'compact' | 'comfortable'>('compact')
  
  // Search state (Feature #1)
  const [searchQuery, setSearchQuery] = useState('')
  
  // DnD sensors - must be before early return
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150,
        tolerance: 8,
      },
    })
  )
  
  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login')
    }
  }, [authLoading, user, router])
  
  // Show loading while checking auth (AFTER all hooks)
  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-gray-600">Loading...</span>
        </div>
      </div>
    )
  }
  
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
  
  // Get tasks filtered by global workflow and search query
  const getGlobalFilteredTasks = () => {
    // Always exclude archived tasks from the main view
    let result = tasks.filter(t => !t.archived)
    
    // Apply workflow filter
    if (globalWorkflow !== 'all') {
      result = result.filter(t => t.workflow === globalWorkflow || t.subWorkflow === globalWorkflow)
    }
    
    // Apply search filter (searches title and description)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      result = result.filter(t => 
        t.title.toLowerCase().includes(query) || 
        t.description.toLowerCase().includes(query)
      )
    }
    
    return result
  }

  const filteredTasks = getGlobalFilteredTasks()
  
  // Priority order for sorting
  const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  
  // Sort tasks based on boardSortBy
  const sortBoardTasks = (tasksToSort: Task[]) => {
    if (boardSortBy === 'none') return tasksToSort
    
    return [...tasksToSort].sort((a, b) => {
      switch (boardSortBy) {
        case 'dueDate':
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        case 'priority':
          return priorityOrder[a.priority] - priorityOrder[b.priority]
        case 'assignee':
          return (a.assignee || 999) - (b.assignee || 999)
        default:
          return 0
      }
    })
  }
  
  const getTasksByStatus = (status: Status) => sortBoardTasks(filteredTasks.filter(t => t.status === status))
  // Get tasks where member is assigned OR collaborating (non-done)
  const getTasksByMember = (memberId: number) => filteredTasks.filter(t => 
    (t.assignee === memberId || t.collaborators.includes(memberId)) && t.status !== 'done'
  )
  // Get done tasks where member is assigned OR collaborating
  const getArchivedTasksByMember = (memberId: number) => filteredTasks.filter(t => 
    (t.assignee === memberId || t.collaborators.includes(memberId)) && t.status === 'done'
  )
  const getUnassignedTasks = () => filteredTasks.filter(t => !t.assignee && t.status !== 'done')
  const getUnassignedArchivedTasks = () => filteredTasks.filter(t => !t.assignee && t.status === 'done')
  
  // Helper to get period date range
  const getPeriodRange = (baseDate: string, period: 'week' | '2weeks' | 'month' | 'quarter', mode: 'fixed' | 'rolling' = 'rolling') => {
    const start = new Date(baseDate)
    const end = new Date(baseDate)
    
    if (mode === 'rolling') {
      // Rolling: from baseDate forward by X days
      switch (period) {
        case 'week':
          end.setDate(end.getDate() + 7)
          break
        case '2weeks':
          end.setDate(end.getDate() + 14)
          break
        case 'month':
          end.setDate(end.getDate() + 30)
          break
        case 'quarter':
          end.setDate(end.getDate() + 90)
          break
      }
    } else {
      // Fixed: calendar-based periods
      switch (period) {
        case 'week':
          end.setDate(end.getDate() + 7)
          break
        case '2weeks':
          end.setDate(end.getDate() + 14)
          break
        case 'month':
          end.setMonth(end.getMonth() + 1)
          break
        case 'quarter':
          end.setMonth(end.getMonth() + 3)
          break
      }
    }
    
    return { start, end }
  }
  
  // Helper to get period start date
  const getPeriodStart = (period: 'week' | '2weeks' | 'month' | 'quarter', mode: 'fixed' | 'rolling' = 'rolling') => {
    const today = new Date()
    
    if (mode === 'rolling') {
      // Rolling mode: always start from today
      return today.toISOString().split('T')[0]
    }
    
    // Fixed mode: calendar-based start dates
    switch (period) {
      case 'week':
      case '2weeks': {
        // Start from Monday of current week
        const day = today.getDay()
        const diff = today.getDate() - day + (day === 0 ? -6 : 1)
        const monday = new Date(today)
        monday.setDate(diff)
        return monday.toISOString().split('T')[0]
      }
      case 'month':
        // Start from 1st of current month
        return new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
      case 'quarter': {
        // Start from 1st of current quarter (Jan, Apr, Jul, Oct)
        const quarterMonth = Math.floor(today.getMonth() / 3) * 3
        return new Date(today.getFullYear(), quarterMonth, 1).toISOString().split('T')[0]
      }
    }
  }
  
  const getWorkload = (memberId: number, periodStart?: string, period: 'week' | '2weeks' | 'month' | 'quarter' = 'week', mode: 'fixed' | 'rolling' = 'rolling') => {
    // Calculate workload from subtasks assigned to this person
    // Completed subtasks: attribute to completion week, use actual hours if available
    // Incomplete subtasks: attribute to due date week, use predicted hours
    
    let totalHours = 0
    let subtaskCount = 0
    const intensityCounts: Record<Intensity, number> = { quick: 0, small: 0, medium: 0, large: 0, huge: 0 }
    
    // Get period bounds if filtering
    let periodStart_dt: Date | undefined
    let periodEnd_dt: Date | undefined
    if (periodStart) {
      const range = getPeriodRange(periodStart, period, mode)
      periodStart_dt = range.start
      periodEnd_dt = range.end
    }
    
    filteredTasks.forEach(task => {
      const taskDueDate = new Date(task.dueDate)
      
      task.subtasks
        .filter(st => st.personId === memberId)
        .forEach(st => {
          // Determine which week this subtask's hours should count toward
          // Completed: use completion date; Incomplete: use task due date
          const attributionDate = st.completed && st.completedAt 
            ? new Date(st.completedAt) 
            : taskDueDate
          
          // Check if this subtask falls within the period
          if (periodStart_dt && periodEnd_dt) {
            if (attributionDate < periodStart_dt || attributionDate >= periodEnd_dt) {
              return // Skip - not in this period
            }
          }
          
          // Use actual hours if available (completed), otherwise predicted intensity hours
          const intensity = INTENSITY_OPTIONS.find(o => o.value === st.intensity)
          if (intensity) {
            const hours = (st.completed && st.actualHours != null) ? st.actualHours : intensity.hours
            totalHours += hours
            intensityCounts[st.intensity]++
            subtaskCount++
          }
        })
    })
    
    // Also count tasks where they're the assignee but have no subtask yet
    // These still attribute to due date week
    let assignedWithNoSubtask = 0
    filteredTasks.forEach(t => {
      if (t.assignee === memberId && !t.subtasks.some(st => st.personId === memberId)) {
        const taskDueDate = new Date(t.dueDate)
        if (periodStart_dt && periodEnd_dt) {
          if (taskDueDate >= periodStart_dt && taskDueDate < periodEnd_dt) {
            assignedWithNoSubtask++
          }
        } else {
          assignedWithNoSubtask++
        }
      }
    })
    
    // Assume medium intensity for unspecified work
    totalHours += assignedWithNoSubtask * 3
    
    return {
      hours: totalHours,
      subtasks: subtaskCount,
      unspecified: assignedWithNoSubtask,
      byIntensity: intensityCounts,
    }
  }
  
  // Get tasks for a specific member and intensity level (for popup display)
  const getTasksByIntensity = (memberId: number, intensity: Intensity | 'unspecified', periodStart?: string, period: 'week' | '2weeks' | 'month' | 'quarter' = 'week', mode: 'fixed' | 'rolling' = 'rolling') => {
    let activeTasks = [...filteredTasks]
    
    // Filter by period if provided
    if (periodStart) {
      const { start, end } = getPeriodRange(periodStart, period, mode)
      
      activeTasks = activeTasks.filter(t => {
        const dueDate = new Date(t.dueDate)
        return dueDate >= start && dueDate < end
      })
    }
    
    if (intensity === 'unspecified') {
      // Return tasks where they're assignee but have no subtask assigned to them
      return activeTasks
        .filter(t => t.assignee === memberId && !t.subtasks.some(st => st.personId === memberId))
        .map(t => ({
          task: t,
          subtaskDescription: null,
          isCollaborator: false,
        }))
    }
    
    // Return tasks with subtasks matching the intensity
    const results: { task: Task; subtaskDescription: string | null; isCollaborator: boolean }[] = []
    
    activeTasks.forEach(task => {
      task.subtasks
        .filter(st => st.personId === memberId && st.intensity === intensity)
        .forEach(st => {
          results.push({
            task,
            subtaskDescription: st.description || null,
            isCollaborator: task.assignee !== memberId,
          })
        })
    })
    
    return results
  }
  
  // Get capacity for a member for a specific week
  const getMemberCapacity = (memberId: number, weekStart: string): number => {
    return weekCapacities[weekStart]?.[memberId] ?? 10 // Default 10h
  }
  
  // Set capacity for a member for a specific week
  const handleSetMemberCapacity = (memberId: number, weekStart: string, hours: number) => {
    const clampedHours = Math.max(0, Math.min(25, hours))
    setWeekCapacity(memberId, weekStart, clampedHours)
  }
  
  // Get/set availability note for a member for a specific week
  const getMemberNote = (memberId: number, weekStart: string): string => {
    return weekNotes[weekStart]?.[memberId] ?? ''
  }
  
  const handleSetMemberNote = (memberId: number, weekStart: string, note: string) => {
    setWeekNote(memberId, weekStart, note)
  }
  
  // Get period navigation helpers
  const getPeriodLabel = (periodStart: string, period: 'week' | '2weeks' | 'month' | 'quarter') => {
    const start = new Date(periodStart)
    const { end } = getPeriodRange(periodStart, period)
    end.setDate(end.getDate() - 1) // Show last day of period, not first day of next
    
    const startStr = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    
    if (period === 'month') {
      return start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    } else if (period === 'quarter') {
      const quarterNum = Math.floor(start.getMonth() / 3) + 1
      return `Q${quarterNum} ${start.getFullYear()}`
    }
    
    return `${startStr} - ${endStr}`
  }
  
  const navigatePeriod = (direction: number) => {
    const current = new Date(selectedWeek)
    
    if (workloadMode === 'rolling') {
      // Rolling: always move by the period length in days
      switch (workloadPeriod) {
        case 'week':
          current.setDate(current.getDate() + (direction * 7))
          break
        case '2weeks':
          current.setDate(current.getDate() + (direction * 14))
          break
        case 'month':
          current.setDate(current.getDate() + (direction * 30))
          break
        case 'quarter':
          current.setDate(current.getDate() + (direction * 90))
          break
      }
    } else {
      // Fixed: move by calendar periods
      switch (workloadPeriod) {
        case 'week':
          current.setDate(current.getDate() + (direction * 7))
          break
        case '2weeks':
          current.setDate(current.getDate() + (direction * 14))
          break
        case 'month':
          current.setMonth(current.getMonth() + direction)
          current.setDate(1)
          break
        case 'quarter':
          current.setMonth(current.getMonth() + (direction * 3))
          current.setDate(1)
          break
      }
    }
    
    setSelectedWeek(current.toISOString().split('T')[0])
  }
  
  // Jump to current period
  const jumpToCurrentPeriod = () => {
    setSelectedWeek(getPeriodStart(workloadPeriod, workloadMode))
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

  // Multi-select functions
  const toggleTaskSelection = (taskId: number) => {
    setSelectedTaskIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(taskId)) {
        newSet.delete(taskId)
      } else {
        newSet.add(taskId)
      }
      return newSet
    })
  }

  const selectAllInStatus = (status: Status) => {
    const tasksInStatus = filteredTasks.filter(t => t.status === status)
    setSelectedTaskIds(new Set(tasksInStatus.map(t => t.id)))
    setIsMultiSelectMode(true)
  }

  const clearSelection = () => {
    setSelectedTaskIds(new Set())
    setIsMultiSelectMode(false)
  }

  const moveSelectedToStatus = async (newStatus: Status) => {
    const taskIds = Array.from(selectedTaskIds)
    for (const taskId of taskIds) {
      const task = tasks.find(t => t.id === taskId)
      if (task) {
        let updatedTask = { ...task, status: newStatus }
        // Auto-complete all subtasks when moving to done
        if (newStatus === 'done') {
          updatedTask = {
            ...updatedTask,
            subtasks: updatedTask.subtasks.map(st => ({ ...st, completed: true }))
          }
        }
        await updateTaskInDb(updatedTask)
      }
    }
    clearSelection()
  }

  const deleteSelectedTasks = async () => {
    const taskIds = Array.from(selectedTaskIds)
    for (const taskId of taskIds) {
      await deleteTask(taskId)
    }
    clearSelection()
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)
    
    if (!over) return

    const taskId = active.id as number
    const overId = over.id as string
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Dragged to status column
    if (['todo', 'in-progress', 'review', 'done'].includes(overId)) {
      const newStatus = overId as Status
      let updatedTask = { ...task, status: newStatus }
      
      // Auto-complete all subtasks when moving to done
      if (newStatus === 'done') {
        updatedTask = {
          ...updatedTask,
          subtasks: updatedTask.subtasks.map(st => ({ ...st, completed: true }))
        }
      }
      
      await updateTaskInDb(updatedTask)
    }
    
    // Dragged to team member
    if (overId.startsWith('member-')) {
      const newAssigneeId = parseInt(overId.replace('member-', ''))
      const oldAssigneeId = task.assignee
      
      if (newAssigneeId !== oldAssigneeId) {
        const newCollaborators = task.collaborators.filter(id => id !== newAssigneeId)
        // Only add old assignee as collaborator if they were assigned (not 0/unassigned)
        if (oldAssigneeId && !newCollaborators.includes(oldAssigneeId)) {
          newCollaborators.push(oldAssigneeId)
        }
        const updatedTask = {
          ...task,
          assignee: newAssigneeId,
          collaborators: newAssigneeId === 0 ? [] : newCollaborators,
        }
        await updateTaskInDb(updatedTask)
      }
    }
  }

  const handleSaveTask = async (updatedTask: Task) => {
    const originalTask = tasks.find(t => t.id === updatedTask.id)
    const activityLog: ActivityEntry[] = [...(updatedTask.activityLog || [])]
    const userName = user?.email?.split('@')[0] || 'Someone'
    
    if (originalTask) {
      // Log status change
      if (originalTask.status !== updatedTask.status) {
        activityLog.push({
          id: Date.now(),
          user: userName,
          action: 'status_change',
          oldValue: statusLabels[originalTask.status],
          newValue: statusLabels[updatedTask.status],
          createdAt: new Date().toISOString(),
        })
      }
      
      // Log assignee change
      if (originalTask.assignee !== updatedTask.assignee) {
        const assignee = teamMembers.find(m => m.id === updatedTask.assignee)
        activityLog.push({
          id: Date.now() + 1,
          user: userName,
          action: 'assignee_change',
          oldValue: teamMembers.find(m => m.id === originalTask.assignee)?.name || 'Unassigned',
          newValue: assignee?.name || 'Unassigned',
          createdAt: new Date().toISOString(),
        })
        
        // Discord notification with @mentions
        if (assignee && getDiscordWebhookUrl()) {
          const collaboratorMembers = updatedTask.collaborators
            ?.map(cid => teamMembers.find(m => m.id === cid))
            .filter(Boolean)
            .map(m => ({ name: m!.name, discordId: m!.discordId }))
          
          notifyTaskAssigned({
            title: updatedTask.title,
            assignee: assignee.name,
            assigneeDiscordId: assignee.discordId,
            collaborators: collaboratorMembers,
            dueDate: updatedTask.dueDate,
            priority: updatedTask.priority,
          }, window.location.href)
        }
      }
      
      // Log priority change
      if (originalTask.priority !== updatedTask.priority) {
        activityLog.push({
          id: Date.now() + 2,
          user: userName,
          action: 'priority_change',
          oldValue: originalTask.priority,
          newValue: updatedTask.priority,
          createdAt: new Date().toISOString(),
        })
      }
      
      // Discord notification for completion
      if (originalTask.status !== 'done' && updatedTask.status === 'done') {
        if (getDiscordWebhookUrl()) {
          // Try to find the completing user's Discord ID
          const completingMember = teamMembers.find(m => 
            m.name.toLowerCase().includes(userName.toLowerCase()) ||
            userName.toLowerCase().includes(m.name.split(' ')[0].toLowerCase())
          )
          notifyTaskCompleted({
            title: updatedTask.title,
            completedBy: userName,
            completedByDiscordId: completingMember?.discordId,
          }, window.location.href)
        }
      }
    }
    
    // Note: activityLog stored locally (would need DB migration for persistence)
    const taskToSave = { ...updatedTask, activityLog }
    await updateTaskInDb(taskToSave as Task)
  }

  // Toggle ALL subtask completions for a specific member
  const toggleSubtaskCompletion = async (task: Task, memberId: number) => {
    // Check if ALL of this member's subtasks are currently complete
    const memberSubtasks = task.subtasks.filter(st => st.personId === memberId)
    const allMemberComplete = memberSubtasks.length > 0 && memberSubtasks.every(st => st.completed)
    
    // Toggle all to the opposite state
    const updatedSubtasks = task.subtasks.map(st => 
      st.personId === memberId 
        ? { ...st, completed: !allMemberComplete }
        : st
    )
    
    // Check if ALL subtasks are now complete → auto-mark task as done
    const allSubtasksComplete = updatedSubtasks.length > 0 && updatedSubtasks.every(st => st.completed)
    
    const updatedTask = { 
      ...task, 
      subtasks: updatedSubtasks,
      status: allSubtasksComplete ? 'done' as Status : task.status
    }
    await updateTaskInDb(updatedTask)
  }

  const handleCreateWorkflow = async (newWorkflow: Workflow, newTasks: Task[]) => {
    await createWorkflow(newWorkflow)
    for (const task of newTasks) {
      await createTaskWithNotification(task)
    }
    setGlobalWorkflow(newWorkflow.id)
  }

  const handleAddTasksFromMeeting = async (newTasks: Task[]) => {
    for (const task of newTasks) {
      await createTaskWithNotification(task)
    }
  }

  const handleUpdateWorkflow = async (updated: Workflow) => {
    await updateWorkflowInDb(updated)
  }

  const handleArchiveWorkflow = async (workflowId: string, taskIdsToArchive: number[] = []) => {
    // Archive selected tasks (hide them, keep their status)
    for (const taskId of taskIdsToArchive) {
      const task = tasks.find(t => t.id === taskId)
      if (task) {
        await updateTaskInDb({ ...task, archived: true })
      }
    }
    // Archive the workflow
    const workflow = workflows.find(w => w.id === workflowId)
    if (workflow) {
      await updateWorkflowInDb({ ...workflow, archived: true })
    }
    if (globalWorkflow === workflowId) {
      setGlobalWorkflow('all')
    }
  }

  const handleUnarchiveWorkflow = async (workflowId: string) => {
    const workflow = workflows.find(w => w.id === workflowId)
    if (workflow) {
      await updateWorkflowInDb({ ...workflow, archived: false })
    }
    // Unarchive all tasks associated with this workflow
    const workflowTasks = tasks.filter(t => t.workflow === workflowId && t.archived)
    for (const task of workflowTasks) {
      await updateTaskInDb({ ...task, archived: false })
    }
  }

  const handleDeleteWorkflow = async (workflowId: string, taskIdsToDelete: number[] = []) => {
    // Delete selected tasks first
    for (const taskId of taskIdsToDelete) {
      await deleteTask(taskId)
    }
    // Then delete the workflow
    await deleteWorkflowFromDb(workflowId)
    if (globalWorkflow === workflowId) {
      setGlobalWorkflow('all')
    }
  }

  const activeWorkflows = workflows.filter(w => !w.archived)
  const archivedWorkflows = workflows.filter(w => w.archived)

  // Loading state
  if (loading) {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading tasks...</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-3 sm:p-6 bg-gray-50 dark:bg-gray-900 transition-colors">
      {/* Demo mode banner */}
      {isDemo && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800 text-sm">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span><strong>Demo Mode:</strong> Changes will not persist. Connect Supabase to save your data.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center gap-2 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white truncate">Steps Task Tracker</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm hidden sm:block">Manage all workflows and events</p>
        </div>
        
        {/* Search Bar */}
        <div className="flex-1 max-w-md mx-4 hidden sm:block">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white dark:bg-gray-800 dark:text-white"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        
        {/* User Profile - compact on mobile */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-medium text-sm">
            {getUserDisplayName(user?.email).slice(0, 2).toUpperCase()}
          </div>
          <span className="text-sm text-gray-700 dark:text-gray-300 hidden lg:block">{getUserDisplayName(user?.email)}</span>
          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {resolvedTheme === 'dark' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          {/* Template Manager */}
          <button
            onClick={() => setShowTemplateManager(true)}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            title="Manage Templates"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </button>
          {/* Settings */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={() => signOut()}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Mobile Search Bar */}
      <div className="mb-3 sm:hidden">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      
      {/* View Tabs - single row on mobile */}
      <div className="flex gap-1 sm:gap-2 mb-3 overflow-x-auto pb-1">
        {(['board', 'team', 'list', 'calendar', 'gantt', 'workload'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm font-medium transition capitalize whitespace-nowrap ${
              view === v ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Global Workflow Filter */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {/* Left side - Add Task */}
        <button
          onClick={() => setShowAddTaskModal(true)}
          className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-green-600 text-white text-xs sm:text-sm font-medium rounded-lg hover:bg-green-700 transition flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Task
        </button>
        
        <span className="text-xs sm:text-sm font-medium text-gray-400 hidden sm:inline">|</span>
        <span className="text-xs sm:text-sm font-medium text-gray-600">Showing:</span>
        <select
          value={globalWorkflow}
          onChange={(e) => setGlobalWorkflow(e.target.value)}
          className={`px-2 py-1.5 sm:px-4 sm:py-2 border rounded-lg text-xs sm:text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none ${
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
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="text-xs sm:text-sm text-gray-400 mr-1 sm:mr-2 hidden sm:inline">
            {filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}
          </span>
          <button
            onClick={() => setShowMeetingNotesModal(true)}
            className="px-2 py-1.5 sm:px-3 sm:py-2 bg-amber-500 text-white text-xs sm:text-sm font-medium rounded-lg hover:bg-amber-600 transition flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="hidden sm:inline">Parse</span> Notes
          </button>
          <button
            onClick={() => setShowNewWorkflowModal(true)}
            className="px-2 py-1.5 sm:px-3 sm:py-2 bg-purple-600 text-white text-xs sm:text-sm font-medium rounded-lg hover:bg-purple-700 transition flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">New</span> Workflow
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Multi-select toolbar (Feature #14: Bulk Edit) */}
        {selectedTaskIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3 z-40 max-w-[95vw] overflow-x-auto">
            <span className="font-medium whitespace-nowrap">{selectedTaskIds.size} selected</span>
            <div className="h-5 w-px bg-gray-600 flex-shrink-0" />
            
            {/* Status dropdown */}
            <select
              onChange={(e) => { if (e.target.value) { moveSelectedToStatus(e.target.value as Status); e.target.value = ''; } }}
              className="px-2 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition cursor-pointer appearance-none pr-6"
              defaultValue=""
            >
              <option value="" disabled>Status</option>
              <option value="todo">→ To Do</option>
              <option value="in-progress">→ In Progress</option>
              <option value="review">→ Review</option>
              <option value="done">→ Done</option>
            </select>
            
            {/* Assignee dropdown */}
            <select
              onChange={async (e) => {
                if (e.target.value) {
                  const newAssignee = parseInt(e.target.value)
                  for (const taskId of Array.from(selectedTaskIds)) {
                    const task = tasks.find(t => t.id === taskId)
                    if (task) {
                      await updateTaskInDb({ ...task, assignee: newAssignee })
                    }
                  }
                  clearSelection()
                  e.target.value = ''
                }
              }}
              className="px-2 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition cursor-pointer appearance-none pr-6"
              defaultValue=""
            >
              <option value="" disabled>Assignee</option>
              <option value="0">Unassigned</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name.split(' ')[0]}</option>
              ))}
            </select>
            
            {/* Priority dropdown */}
            <select
              onChange={async (e) => {
                if (e.target.value) {
                  const newPriority = e.target.value as Priority
                  for (const taskId of Array.from(selectedTaskIds)) {
                    const task = tasks.find(t => t.id === taskId)
                    if (task) {
                      await updateTaskInDb({ ...task, priority: newPriority })
                    }
                  }
                  clearSelection()
                  e.target.value = ''
                }
              }}
              className="px-2 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition cursor-pointer appearance-none pr-6"
              defaultValue=""
            >
              <option value="" disabled>Priority</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            
            {/* Workflow dropdown */}
            <select
              onChange={async (e) => {
                if (e.target.value !== '') {
                  const newWorkflow = e.target.value === 'none' ? null : e.target.value
                  for (const taskId of Array.from(selectedTaskIds)) {
                    const task = tasks.find(t => t.id === taskId)
                    if (task) {
                      await updateTaskInDb({ ...task, workflow: newWorkflow })
                    }
                  }
                  clearSelection()
                  e.target.value = ''
                }
              }}
              className="px-2 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition cursor-pointer appearance-none pr-6 hidden sm:block"
              defaultValue=""
            >
              <option value="" disabled>Workflow</option>
              <option value="none">None</option>
              {workflows.filter(w => !w.archived).map(w => (
                <option key={w.id} value={w.id}>{w.short}</option>
              ))}
            </select>
            
            {/* Due date input */}
            <input
              type="date"
              onChange={async (e) => {
                if (e.target.value) {
                  for (const taskId of Array.from(selectedTaskIds)) {
                    const task = tasks.find(t => t.id === taskId)
                    if (task) {
                      await updateTaskInDb({ ...task, dueDate: e.target.value })
                    }
                  }
                  clearSelection()
                  e.target.value = ''
                }
              }}
              className="px-2 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition cursor-pointer hidden sm:block"
              title="Set due date"
            />
            
            <div className="h-5 w-px bg-gray-600 flex-shrink-0" />
            <button
              onClick={deleteSelectedTasks}
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 rounded-lg transition whitespace-nowrap"
            >
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="p-1.5 text-gray-400 hover:text-white transition flex-shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Board View */}
        {view === 'board' && (
          <>
          {/* Board Sort Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 mb-3">
            <span className="text-xs sm:text-sm text-gray-500">Sort:</span>
            <select
              value={boardSortBy}
              onChange={(e) => setBoardSortBy(e.target.value as 'none' | 'dueDate' | 'priority' | 'assignee')}
              className="text-xs sm:text-sm border border-gray-200 rounded-lg px-2 py-1 sm:px-3 sm:py-1.5 bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            >
              <option value="none">Default</option>
              <option value="dueDate">Due Date</option>
              <option value="priority">Priority</option>
              <option value="assignee">Assignee</option>
            </select>
          </div>
          <div className="flex md:grid md:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 snap-x snap-mandatory md:snap-none">
            {(['todo', 'in-progress', 'review', 'done'] as Status[]).map(status => (
              <DroppableColumn
                key={status}
                id={status}
                className="bg-gray-50 rounded-xl p-3 sm:p-4 min-h-[300px] sm:min-h-[400px] transition-colors w-[85vw] sm:w-[280px] md:w-auto md:min-w-0 snap-center flex-shrink-0 md:flex-shrink"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className={`w-3 h-3 rounded-full ${statusColors[status].split(' ')[0]}`} />
                  <h2 className="font-semibold text-gray-700">{statusLabels[status]}</h2>
                  <span className="text-sm text-gray-400">
                    {getTasksByStatus(status).length}
                  </span>
                  {isMultiSelectMode || selectedTaskIds.size > 0 ? (
                    <button
                      onClick={() => selectAllInStatus(status)}
                      className="ml-auto text-xs text-purple-600 hover:text-purple-700 font-medium"
                    >
                      Select All ({getTasksByStatus(status).length})
                    </button>
                  ) : (
                    <button
                      onClick={() => setIsMultiSelectMode(true)}
                      className="ml-auto text-xs text-gray-500 hover:text-purple-600 font-medium"
                    >
                      Select
                    </button>
                  )}
                </div>
                
                <div className="space-y-3">
                  {getTasksByStatus(status).map(task => (
                    <div key={task.id} className="relative">
                      {(isMultiSelectMode || selectedTaskIds.size > 0) && (
                        <div className="absolute -left-1 top-1/2 -translate-y-1/2 z-10">
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.has(task.id)}
                            onChange={() => toggleTaskSelection(task.id)}
                            className="w-4 h-4 text-purple-600 rounded border-gray-300 focus:ring-purple-500"
                          />
                        </div>
                      )}
                      <div className={isMultiSelectMode || selectedTaskIds.size > 0 ? 'ml-5' : ''}>
                        <DraggableTaskCard
                          task={task}
                          onClick={() => isMultiSelectMode ? toggleTaskSelection(task.id) : setEditingTask(task)}
                          workflows={workflows}
                          teamMembers={teamMembers}
                          labels={labels}
                          onMoveToStatus={async (t, newStatus) => {
                            let updatedTask = { ...t, status: newStatus }
                            if (newStatus === 'done') {
                              updatedTask.subtasks = updatedTask.subtasks.map(st => ({ ...st, completed: true }))
                            }
                            await updateTaskInDb(updatedTask)
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </DroppableColumn>
            ))}
          </div>
          </>
        )}

        {/* Team View */}
        {view === 'team' && (
          <div className="space-y-3">
            {/* Filter & View Mode Controls */}
            <div className="flex items-center justify-between bg-white rounded-lg p-2 shadow-sm border">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 px-2">Show:</span>
                {(['all', 'assigned', 'collaborating'] as const).map(filter => (
                  <button
                    key={filter}
                    onClick={() => setTeamViewFilter(filter)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                      teamViewFilter === filter
                        ? 'bg-purple-100 text-purple-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {filter === 'all' ? 'All' : filter === 'assigned' ? 'Assigned' : 'Collaborating'}
                  </button>
                ))}
              </div>
              
              {/* View Mode Toggle */}
              <div className="flex items-center gap-1 border-l pl-3 ml-3">
                <button
                  onClick={() => setTeamViewMode('compact')}
                  className={`p-1.5 rounded transition ${teamViewMode === 'compact' ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-600'}`}
                  title="Compact view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
                <button
                  onClick={() => setTeamViewMode('comfortable')}
                  className={`p-1.5 rounded transition ${teamViewMode === 'comfortable' ? 'bg-purple-100 text-purple-700' : 'text-gray-400 hover:text-gray-600'}`}
                  title="Comfortable view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM4 13h16a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3a1 1 0 011-1z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Compact View */}
            {teamViewMode === 'compact' && (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory -mx-3 px-3 sm:mx-0 sm:px-0">
              {/* Unassigned Column */}
              <DroppableColumn
                id="member-0"
                className="bg-gray-100 rounded-lg p-3 min-h-[200px] transition-colors border border-dashed border-gray-300 w-[160px] sm:w-[180px] flex-shrink-0 snap-center"
              >
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-300">
                  <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 font-bold text-xs">
                    ?
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-gray-700 text-xs">Unassigned</h2>
                    <p className="text-[10px] text-gray-400">{getUnassignedTasks().length} tasks</p>
                  </div>
                </div>
                
                <div className="space-y-1.5">
                  {getUnassignedTasks()
                    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                    .slice(0, expandedMembers.has(0) ? undefined : 7)
                    .map(task => {
                      const workflow = workflows.find(w => w.id === task.workflow)
                      return (
                        <div
                          key={task.id}
                          onClick={() => setEditingTask(task)}
                          className="bg-white rounded p-2 cursor-pointer hover:shadow-sm transition border border-gray-100"
                        >
                          <p className="text-[11px] font-medium text-gray-900 line-clamp-1">{task.title}</p>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {workflow && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded text-white ${workflow.color}`}>
                                {workflow.short}
                              </span>
                            )}
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusColors[task.status]}`}>
                              {statusLabels[task.status]}
                            </span>
                            <span className="text-[9px] text-gray-400 ml-auto">
                              {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  {getUnassignedTasks().length === 0 && (
                    <p className="text-[10px] text-gray-400 text-center py-2">None</p>
                  )}
                  {getUnassignedTasks().length > 7 && (
                    <button
                      onClick={() => setExpandedMembers(prev => {
                        const next = new Set(prev)
                        if (next.has(0)) next.delete(0)
                        else next.add(0)
                        return next
                      })}
                      className="w-full text-[10px] text-purple-600 hover:text-purple-700 py-1"
                    >
                      {expandedMembers.has(0) ? 'Show less' : `+${getUnassignedTasks().length - 7} more`}
                    </button>
                  )}
                </div>
              </DroppableColumn>

              {teamMembers.map(member => {
                // Get tasks and apply filter
                let activeTasks = getTasksByMember(member.id)
                if (teamViewFilter === 'assigned') {
                  activeTasks = activeTasks.filter(t => t.assignee === member.id)
                } else if (teamViewFilter === 'collaborating') {
                  activeTasks = activeTasks.filter(t => t.assignee !== member.id && t.collaborators.includes(member.id))
                }
                // Sort by due date (earliest first)
                activeTasks = [...activeTasks].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                
                const isExpanded = expandedMembers.has(member.id)
                const displayTasks = isExpanded ? activeTasks : activeTasks.slice(0, 7)
                
                return (
                  <DroppableColumn
                    key={member.id}
                    id={`member-${member.id}`}
                    className="bg-gray-50 rounded-lg p-3 min-h-[200px] transition-colors w-[160px] sm:w-[180px] flex-shrink-0 snap-center"
                  >
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200">
                      <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-[10px]">
                        {member.avatar}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="font-semibold text-gray-700 text-xs truncate">{member.name.split(' ')[0]}</h2>
                        <p className="text-[10px] text-gray-400">{activeTasks.length} active</p>
                      </div>
                    </div>
                    
                    <div className="space-y-1.5">
                      {displayTasks.map(task => {
                        const workflow = workflows.find(w => w.id === task.workflow)
                        const isPrimaryAssignee = task.assignee === member.id
                        const memberSubtasks = task.subtasks.filter(st => st.personId === member.id)
                        const hasSubtasks = memberSubtasks.length > 0
                        const allSubtasksCompleted = hasSubtasks && memberSubtasks.every(st => st.completed)
                        return (
                          <div
                            key={task.id}
                            className={`group bg-white rounded p-2 hover:shadow-sm transition ${
                              isPrimaryAssignee ? 'border-2 border-purple-300 ring-1 ring-purple-100' : 'border border-gray-100'
                            } ${allSubtasksCompleted ? 'opacity-60' : ''}`}
                          >
                            <div className="flex items-start gap-1.5">
                              {hasSubtasks && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleSubtaskCompletion(task, member.id)
                                  }}
                                  className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                                    allSubtasksCompleted
                                      ? 'bg-green-500 border-green-500 text-white'
                                      : 'border-gray-300 hover:border-green-400 opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  {allSubtasksCompleted && (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              )}
                              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setEditingTask(task)}>
                                <p className={`text-[11px] font-medium text-gray-900 line-clamp-1 ${allSubtasksCompleted ? 'line-through' : ''}`}>{task.title}</p>
                                <div className="flex items-center gap-1 mt-1 flex-wrap">
                                  {workflow && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded text-white ${workflow.color}`}>
                                      {workflow.short}
                                    </span>
                                  )}
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded ${statusColors[task.status]}`}>
                                    {statusLabels[task.status]}
                                  </span>
                                  {!isPrimaryAssignee && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">collab</span>
                                  )}
                                  <span className="text-[9px] text-gray-400 ml-auto">
                                    {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {activeTasks.length === 0 && (
                        <p className="text-[10px] text-gray-400 text-center py-2">No tasks</p>
                      )}
                      {activeTasks.length > 7 && (
                        <button
                          onClick={() => setExpandedMembers(prev => {
                            const next = new Set(prev)
                            if (next.has(member.id)) next.delete(member.id)
                            else next.add(member.id)
                            return next
                          })}
                          className="w-full text-[10px] text-purple-600 hover:text-purple-700 py-1"
                        >
                          {isExpanded ? 'Show less' : `+${activeTasks.length - 7} more`}
                        </button>
                      )}
                    </div>
                  </DroppableColumn>
                )
              })}
            </div>
            )}

            {/* Comfortable View */}
            {teamViewMode === 'comfortable' && (
            <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory -mx-3 px-3 sm:mx-0 sm:px-0">
              {/* Unassigned Column */}
              <DroppableColumn
                id="member-0"
                className="bg-gray-100 rounded-xl p-4 min-h-[300px] transition-colors border-2 border-dashed border-gray-300 w-[220px] sm:w-[260px] flex-shrink-0 snap-center"
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
                  {getUnassignedTasks()
                    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                    .slice(0, expandedMembers.has(0) ? undefined : 3)
                    .map(task => (
                    <DraggableTaskCard
                      key={task.id}
                      task={task}
                      onClick={() => setEditingTask(task)}
                      showStatus
                      workflows={workflows}
                      teamMembers={teamMembers}
                      labels={labels}
                      onMoveToStatus={async (t, newStatus) => {
                        let updatedTask = { ...t, status: newStatus }
                        if (newStatus === 'done') {
                          updatedTask.subtasks = updatedTask.subtasks.map(st => ({ ...st, completed: true }))
                        }
                        await updateTaskInDb(updatedTask)
                      }}
                    />
                  ))}
                  {getUnassignedTasks().length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-4">No unassigned tasks</p>
                  )}
                  {getUnassignedTasks().length > 3 && (
                    <button
                      onClick={() => setExpandedMembers(prev => {
                        const next = new Set(prev)
                        if (next.has(0)) next.delete(0)
                        else next.add(0)
                        return next
                      })}
                      className="w-full text-xs text-purple-600 hover:text-purple-700 py-2"
                    >
                      {expandedMembers.has(0) ? 'Show less' : `+${getUnassignedTasks().length - 3} more`}
                    </button>
                  )}
                </div>
              </DroppableColumn>

              {teamMembers.map(member => {
                // Get tasks and apply filter
                let activeTasks = getTasksByMember(member.id)
                if (teamViewFilter === 'assigned') {
                  activeTasks = activeTasks.filter(t => t.assignee === member.id)
                } else if (teamViewFilter === 'collaborating') {
                  activeTasks = activeTasks.filter(t => t.assignee !== member.id && t.collaborators.includes(member.id))
                }
                // Sort by due date (earliest first)
                activeTasks = [...activeTasks].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
                const isExpanded = expandedMembers.has(member.id)
                const displayTasks = isExpanded ? activeTasks : activeTasks.slice(0, 3)
                
                return (
                  <DroppableColumn
                    key={member.id}
                    id={`member-${member.id}`}
                    className="bg-gray-50 rounded-xl p-4 min-h-[300px] transition-colors w-[220px] sm:w-[260px] flex-shrink-0 snap-center"
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
                      {displayTasks.map(task => (
                        <DraggableTaskCard
                          key={task.id}
                          task={task}
                          onClick={() => setEditingTask(task)}
                          showStatus
                          workflows={workflows}
                          teamMembers={teamMembers}
                          labels={labels}
                          viewingMemberId={member.id}
                          onToggleComplete={toggleSubtaskCompletion}
                          onMoveToStatus={async (t, newStatus) => {
                            let updatedTask = { ...t, status: newStatus }
                            if (newStatus === 'done') {
                              updatedTask.subtasks = updatedTask.subtasks.map(st => ({ ...st, completed: true }))
                            }
                            await updateTaskInDb(updatedTask)
                          }}
                        />
                      ))}
                      {activeTasks.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">No active tasks</p>
                      )}
                      {activeTasks.length > 3 && (
                        <button
                          onClick={() => setExpandedMembers(prev => {
                            const next = new Set(prev)
                            if (next.has(member.id)) next.delete(member.id)
                            else next.add(member.id)
                            return next
                          })}
                          className="w-full text-xs text-purple-600 hover:text-purple-700 py-2"
                        >
                          {isExpanded ? 'Show less' : `+${activeTasks.length - 3} more`}
                        </button>
                      )}
                    </div>
                  </DroppableColumn>
                )
              })}
            </div>
            )}
          </div>
        )}

        <DragOverlay
          dropAnimation={{
            duration: 200,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
            sideEffects: defaultDropAnimationSideEffects({
              styles: { active: { opacity: '0.5' } },
            }),
          }}
        >
          {activeTask && (
            <div className="bg-white rounded-lg p-4 shadow-2xl border-2 border-purple-400 w-72 rotate-1 scale-105 transition-transform">
              <h3 className="font-medium text-gray-900 mb-1">{activeTask.title}</h3>
              <p className="text-sm text-gray-500 line-clamp-1">{activeTask.description}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Workload View */}
      {view === 'workload' && (
        <div className="space-y-6">
          {/* Period Selector & Navigator */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 bg-white rounded-xl p-4 shadow-sm border">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => {
                  setWorkloadMode('rolling')
                  setSelectedWeek(getPeriodStart(workloadPeriod, 'rolling'))
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  workloadMode === 'rolling'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Rolling
              </button>
              <button
                onClick={() => {
                  setWorkloadMode('fixed')
                  setSelectedWeek(getPeriodStart(workloadPeriod, 'fixed'))
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  workloadMode === 'fixed'
                    ? 'bg-white text-purple-700 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Fixed
              </button>
            </div>
            
            {/* Period Selector */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {(['week', '2weeks', 'month', 'quarter'] as const).map(period => (
                <button
                  key={period}
                  onClick={() => {
                    setWorkloadPeriod(period)
                    setSelectedWeek(getPeriodStart(period, workloadMode))
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                    workloadPeriod === period
                      ? 'bg-white text-purple-700 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {period === 'week' ? 'Week' : period === '2weeks' ? '2 Weeks' : period === 'month' ? 'Month' : 'Quarter'}
                </button>
              ))}
            </div>
            
            {/* Date Navigator */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigatePeriod(-1)}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-center min-w-[180px]">
                <p className="font-semibold text-gray-900">{getPeriodLabel(selectedWeek, workloadPeriod)}</p>
              </div>
              <button
                onClick={() => navigatePeriod(1)}
                className="p-2 hover:bg-gray-100 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            <button
              onClick={jumpToCurrentPeriod}
              className="px-3 py-2 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition"
            >
              Today
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamMembers.map(member => {
              const workload = getWorkload(member.id, selectedWeek, workloadPeriod, workloadMode)
              // Scale capacity based on period
              const weeksInPeriod = workloadPeriod === 'week' ? 1 : workloadPeriod === '2weeks' ? 2 : workloadPeriod === 'month' ? 4 : 13
              const capacity = getMemberCapacity(member.id, selectedWeek) * weeksInPeriod
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
                      {getMemberNote(member.id, selectedWeek) && (
                        <p className="text-xs text-amber-600 mt-0.5 italic">
                          📌 {getMemberNote(member.id, selectedWeek)}
                        </p>
                      )}
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
                  
                  {/* Busy Days */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Busy days</span>
                      {member.id === currentUserMemberId && <span className="text-purple-500">Click to toggle</span>}
                    </div>
                    <div className="flex gap-1">
                      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, idx) => {
                        const isBusy = getMemberBusyDays(member.id, selectedWeek).includes(idx)
                        const canEdit = member.id === currentUserMemberId
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => canEdit && toggleBusyDay(member.id, selectedWeek, idx)}
                            disabled={!canEdit}
                            className={`flex-1 py-1.5 text-xs font-medium rounded transition ${
                              isBusy 
                                ? 'bg-red-500 text-white' 
                                : 'bg-gray-100 text-gray-600'
                            } ${canEdit ? 'hover:ring-2 hover:ring-offset-1 hover:ring-purple-400 cursor-pointer' : 'cursor-default'}`}
                            title={isBusy ? 'Busy' : 'Available'}
                          >
                            {day}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  
                  {/* Capacity slider - only editable by owner */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Weekly capacity</span>
                      <span>{capacity}h</span>
                    </div>
                    {member.id === currentUserMemberId ? (
                      <>
                        <input
                          type="range"
                          min="0"
                          max="25"
                          step="1"
                          value={capacity}
                          onChange={e => handleSetMemberCapacity(member.id, selectedWeek, parseInt(e.target.value))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                        />
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                          <span>0h</span>
                          <span>12h</span>
                          <span>25h</span>
                        </div>
                      </>
                    ) : (
                      <div className="h-2 bg-gray-200 rounded-lg overflow-hidden">
                        <div className="h-full bg-purple-300" style={{ width: `${(capacity / 25) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  
                  {/* Availability note - only editable by owner */}
                  <div className="mb-3">
                    {member.id === currentUserMemberId ? (
                      <input
                        type="text"
                        value={getMemberNote(member.id, selectedWeek)}
                        onChange={e => handleSetMemberNote(member.id, selectedWeek, e.target.value)}
                        placeholder="Note: exams, holiday, busy..."
                        className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-purple-500 focus:border-transparent outline-none"
                      />
                    ) : getMemberNote(member.id, selectedWeek) ? (
                      <p className="text-xs text-gray-500 italic px-2 py-1.5 bg-gray-50 rounded-lg">
                        {getMemberNote(member.id, selectedWeek)}
                      </p>
                    ) : null}
                  </div>
                  
                  {/* Breakdown by intensity with time estimates - clickable to see tasks */}
                  <div className="flex gap-1 text-xs flex-wrap relative">
                    {workload.byIntensity.quick > 0 && (
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(
                          workloadPopup?.memberId === member.id && workloadPopup?.intensity === 'quick' 
                            ? null 
                            : { memberId: member.id, intensity: 'quick' }
                        )}
                        className={`px-2 py-0.5 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-green-400 transition ${intensityColors.quick}`}
                      >
                        {workload.byIntensity.quick} quick (~20min)
                      </button>
                    )}
                    {workload.byIntensity.small > 0 && (
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(
                          workloadPopup?.memberId === member.id && workloadPopup?.intensity === 'small' 
                            ? null 
                            : { memberId: member.id, intensity: 'small' }
                        )}
                        className={`px-2 py-0.5 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-blue-400 transition ${intensityColors.small}`}
                      >
                        {workload.byIntensity.small} small (~1h)
                      </button>
                    )}
                    {workload.byIntensity.medium > 0 && (
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(
                          workloadPopup?.memberId === member.id && workloadPopup?.intensity === 'medium' 
                            ? null 
                            : { memberId: member.id, intensity: 'medium' }
                        )}
                        className={`px-2 py-0.5 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-yellow-400 transition ${intensityColors.medium}`}
                      >
                        {workload.byIntensity.medium} medium (~3h)
                      </button>
                    )}
                    {workload.byIntensity.large > 0 && (
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(
                          workloadPopup?.memberId === member.id && workloadPopup?.intensity === 'large' 
                            ? null 
                            : { memberId: member.id, intensity: 'large' }
                        )}
                        className={`px-2 py-0.5 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-orange-400 transition ${intensityColors.large}`}
                      >
                        {workload.byIntensity.large} large (~6h)
                      </button>
                    )}
                    {workload.byIntensity.huge > 0 && (
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(
                          workloadPopup?.memberId === member.id && workloadPopup?.intensity === 'huge' 
                            ? null 
                            : { memberId: member.id, intensity: 'huge' }
                        )}
                        className={`px-2 py-0.5 rounded cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-red-400 transition ${intensityColors.huge}`}
                      >
                        {workload.byIntensity.huge} huge (~1 day)
                      </button>
                    )}
                    {workload.unspecified > 0 && (
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(
                          workloadPopup?.memberId === member.id && workloadPopup?.intensity === 'unspecified' 
                            ? null 
                            : { memberId: member.id, intensity: 'unspecified' }
                        )}
                        className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 transition"
                      >
                        {workload.unspecified} unspecified
                      </button>
                    )}
                    {workload.hours === 0 && (
                      <span className="text-gray-400 italic">No tasks this week</span>
                    )}
                  </div>
                  
                  {/* Popup showing tasks for selected intensity */}
                  {workloadPopup?.memberId === member.id && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 relative">
                      <button
                        type="button"
                        onClick={() => setWorkloadPopup(null)}
                        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">
                        {workloadPopup.intensity === 'unspecified' ? 'Unspecified' : workloadPopup.intensity.charAt(0).toUpperCase() + workloadPopup.intensity.slice(1)} tasks:
                      </h4>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {getTasksByIntensity(member.id, workloadPopup.intensity, selectedWeek, workloadPeriod, workloadMode).map(({ task, subtaskDescription, isCollaborator }) => (
                          <div 
                            key={`${task.id}-${subtaskDescription}`}
                            className="flex items-start gap-2 p-2 bg-white rounded border border-gray-100 hover:border-purple-200 cursor-pointer transition"
                            onClick={() => { setEditingTask(task); setWorkloadPopup(null); }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-900 truncate">{task.title}</p>
                              {subtaskDescription && (
                                <p className="text-xs text-gray-500 truncate">→ {subtaskDescription}</p>
                              )}
                              <div className="flex items-center gap-1 mt-1">
                                {isCollaborator && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">collaborating</span>
                                )}
                                <span className="text-xs text-gray-400">
                                  Due {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                </span>
                              </div>
                            </div>
                            <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        ))}
                        {getTasksByIntensity(member.id, workloadPopup.intensity, selectedWeek, workloadPeriod, workloadMode).length === 0 && (
                          <p className="text-xs text-gray-400 italic py-2">No tasks found</p>
                        )}
                      </div>
                    </div>
                  )}
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
                        {teamMembers.map(m => (
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
                  const member = teamMembers.find(m => m.id === task.assignee)
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

      {/* Calendar View */}
      {view === 'calendar' && (
        <div className="space-y-4">
          {/* Calendar Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border dark:border-gray-700">
            {/* Mode Toggle */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              <button
                onClick={() => setCalendarMode('fixed')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  calendarMode === 'fixed'
                    ? 'bg-white dark:bg-gray-600 text-purple-700 dark:text-purple-300 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Fixed
              </button>
              <button
                onClick={() => setCalendarMode('rolling')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  calendarMode === 'rolling'
                    ? 'bg-white dark:bg-gray-600 text-purple-700 dark:text-purple-300 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Rolling
              </button>
            </div>
            
            {/* Period Selector */}
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
              {(['week', 'month', 'quarter'] as const).map(period => (
                <button
                  key={period}
                  onClick={() => setCalendarPeriod(period)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${
                    calendarPeriod === period
                      ? 'bg-white dark:bg-gray-600 text-purple-700 dark:text-purple-300 shadow-sm'
                      : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
            
            {/* Date Navigator */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const d = new Date(calendarDate)
                  if (calendarPeriod === 'week') d.setDate(d.getDate() - 7)
                  else if (calendarPeriod === 'month') d.setMonth(d.getMonth() - 1)
                  else d.setMonth(d.getMonth() - 3)
                  setCalendarDate(d.toISOString().split('T')[0])
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="text-center min-w-[150px]">
                <p className="font-semibold text-gray-900 dark:text-white">
                  {(() => {
                    const d = new Date(calendarDate)
                    if (calendarPeriod === 'week') {
                      const weekEnd = new Date(d)
                      weekEnd.setDate(weekEnd.getDate() + 6)
                      return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    } else if (calendarPeriod === 'month') {
                      return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
                    } else {
                      const quarterNum = Math.floor(d.getMonth() / 3) + 1
                      return `Q${quarterNum} ${d.getFullYear()}`
                    }
                  })()}
                </p>
              </div>
              <button
                onClick={() => {
                  const d = new Date(calendarDate)
                  if (calendarPeriod === 'week') d.setDate(d.getDate() + 7)
                  else if (calendarPeriod === 'month') d.setMonth(d.getMonth() + 1)
                  else d.setMonth(d.getMonth() + 3)
                  setCalendarDate(d.toISOString().split('T')[0])
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            
            <button
              onClick={() => setCalendarDate(new Date().toISOString().split('T')[0])}
              className="px-3 py-2 text-sm font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition"
            >
              Today
            </button>
          </div>

          {/* Calendar Grid */}
          {calendarPeriod === 'month' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
              {/* Day headers */}
              <div className="grid grid-cols-7 border-b dark:border-gray-700">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="p-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900">
                    {day}
                  </div>
                ))}
              </div>
              {/* Calendar cells */}
              <div className="grid grid-cols-7">
                {(() => {
                  const d = new Date(calendarDate)
                  const year = d.getFullYear()
                  const month = d.getMonth()
                  const firstDay = new Date(year, month, 1)
                  const lastDay = new Date(year, month + 1, 0)
                  const startOffset = (firstDay.getDay() + 6) % 7 // Monday start
                  const totalDays = lastDay.getDate()
                  const cells = []
                  
                  // Empty cells before first day
                  for (let i = 0; i < startOffset; i++) {
                    cells.push(<div key={`empty-${i}`} className="min-h-[100px] border-r border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50" />)
                  }
                  
                  // Day cells
                  for (let day = 1; day <= totalDays; day++) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const dayTasks = filteredTasks.filter(t => t.dueDate === dateStr)
                    const isToday = dateStr === new Date().toISOString().split('T')[0]
                    
                    cells.push(
                      <div 
                        key={day} 
                        className={`min-h-[100px] border-r border-b dark:border-gray-700 p-1 ${
                          isToday ? 'bg-purple-50 dark:bg-purple-900/20' : ''
                        }`}
                      >
                        <div className={`text-xs font-medium mb-1 ${
                          isToday ? 'text-purple-600 dark:text-purple-400' : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {day}
                        </div>
                        <div className="space-y-1">
                          {dayTasks.slice(0, 3).map(task => {
                            const workflow = workflows.find(w => w.id === task.workflow)
                            return (
                              <div
                                key={task.id}
                                onClick={() => setEditingTask(task)}
                                className={`text-xs p-1 rounded cursor-pointer truncate ${
                                  workflow ? workflow.color + ' text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                                }`}
                                title={task.title}
                              >
                                {task.title}
                              </div>
                            )
                          })}
                          {dayTasks.length > 3 && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 pl-1">
                              +{dayTasks.length - 3} more
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  }
                  
                  // Fill remaining cells to complete the grid
                  const totalCells = startOffset + totalDays
                  const remainingCells = (7 - (totalCells % 7)) % 7
                  for (let i = 0; i < remainingCells; i++) {
                    cells.push(<div key={`end-${i}`} className="min-h-[100px] border-r border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50" />)
                  }
                  
                  return cells
                })()}
              </div>
            </div>
          )}

          {/* Week View */}
          {calendarPeriod === 'week' && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
              <div className="grid grid-cols-7">
                {(() => {
                  const startDate = new Date(calendarDate)
                  const dayOfWeek = startDate.getDay()
                  startDate.setDate(startDate.getDate() - ((dayOfWeek + 6) % 7)) // Monday
                  
                  return Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(startDate)
                    d.setDate(d.getDate() + i)
                    const dateStr = d.toISOString().split('T')[0]
                    const dayTasks = filteredTasks.filter(t => t.dueDate === dateStr)
                    const isToday = dateStr === new Date().toISOString().split('T')[0]
                    
                    return (
                      <div key={i} className={`border-r dark:border-gray-700 last:border-r-0 ${isToday ? 'bg-purple-50 dark:bg-purple-900/20' : ''}`}>
                        <div className={`p-2 text-center border-b dark:border-gray-700 ${isToday ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-gray-50 dark:bg-gray-900'}`}>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {d.toLocaleDateString('en-GB', { weekday: 'short' })}
                          </div>
                          <div className={`text-lg font-semibold ${isToday ? 'text-purple-600 dark:text-purple-400' : 'text-gray-900 dark:text-white'}`}>
                            {d.getDate()}
                          </div>
                        </div>
                        <div className="p-2 space-y-2 min-h-[300px]">
                          {dayTasks.map(task => {
                            const workflow = workflows.find(w => w.id === task.workflow)
                            return (
                              <div
                                key={task.id}
                                onClick={() => setEditingTask(task)}
                                className={`text-xs p-2 rounded cursor-pointer ${
                                  workflow ? workflow.color + ' text-white' : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200'
                                }`}
                              >
                                <div className="font-medium truncate">{task.title}</div>
                                <div className="opacity-75 truncate">{task.description}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          )}

          {/* Quarter View */}
          {calendarPeriod === 'quarter' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(() => {
                const d = new Date(calendarDate)
                const quarterStart = Math.floor(d.getMonth() / 3) * 3
                
                return [0, 1, 2].map(offset => {
                  const monthDate = new Date(d.getFullYear(), quarterStart + offset, 1)
                  const monthName = monthDate.toLocaleDateString('en-GB', { month: 'long' })
                  const year = monthDate.getFullYear()
                  const month = monthDate.getMonth()
                  const lastDay = new Date(year, month + 1, 0).getDate()
                  
                  const monthTasks = filteredTasks.filter(t => {
                    const td = new Date(t.dueDate)
                    return td.getMonth() === month && td.getFullYear() === year
                  })
                  
                  return (
                    <div key={offset} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
                      <div className="p-3 bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
                        <h3 className="font-semibold text-gray-900 dark:text-white">{monthName}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{monthTasks.length} tasks</p>
                      </div>
                      <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto">
                        {monthTasks.length === 0 ? (
                          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No tasks</p>
                        ) : (
                          monthTasks.map(task => {
                            const workflow = workflows.find(w => w.id === task.workflow)
                            return (
                              <div
                                key={task.id}
                                onClick={() => setEditingTask(task)}
                                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                              >
                                {workflow && (
                                  <div className={`w-2 h-2 rounded-full ${workflow.color}`} />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{task.title}</div>
                                  <div className="text-xs text-gray-500 dark:text-gray-400">
                                    {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                  </div>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      )}

      {/* Gantt View */}
      {view === 'gantt' && (
        <div className="space-y-4">
          {/* Gantt Header */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border dark:border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Timeline View</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">Drag task bars to adjust dates</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">{filteredTasks.length} tasks</span>
              </div>
            </div>
          </div>

          {/* Gantt Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border dark:border-gray-700 overflow-hidden">
            {/* Timeline header */}
            <div className="flex border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-900 sticky top-0 z-10">
              <div className="w-64 flex-shrink-0 p-3 font-medium text-gray-700 dark:text-gray-300 border-r dark:border-gray-700">
                Task
              </div>
              <div className="flex-1 overflow-x-auto">
                <div className="flex min-w-max">
                  {(() => {
                    // Generate 8 weeks of timeline
                    const today = new Date()
                    const weeks: { start: Date; label: string }[] = []
                    for (let i = -2; i < 6; i++) {
                      const weekStart = new Date(today)
                      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1 + (i * 7))
                      weeks.push({
                        start: weekStart,
                        label: weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                      })
                    }
                    return weeks.map((week, i) => (
                      <div 
                        key={i} 
                        className={`w-32 flex-shrink-0 p-2 text-center text-xs font-medium border-r dark:border-gray-700 ${
                          i === 2 ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300' : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {week.label}
                      </div>
                    ))
                  })()}
                </div>
              </div>
            </div>

            {/* Task rows */}
            <div className="divide-y dark:divide-gray-700">
              {filteredTasks
                .sort((a, b) => new Date(a.startDate || a.dueDate).getTime() - new Date(b.startDate || b.dueDate).getTime())
                .map(task => {
                  const workflow = workflows.find(w => w.id === task.workflow)
                  const startDate = new Date(task.startDate || task.createdAt || task.dueDate)
                  const endDate = new Date(task.dueDate)
                  const today = new Date()
                  const timelineStart = new Date(today)
                  timelineStart.setDate(timelineStart.getDate() - timelineStart.getDay() + 1 - 14) // 2 weeks back
                  
                  // Calculate bar position
                  const dayWidth = 32 / 7 // 32px per day (w-32 = 7 days)
                  const startOffset = Math.max(0, (startDate.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth
                  const duration = Math.max(1, (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24) + 1) * dayWidth
                  
                  return (
                    <div key={task.id} className="flex hover:bg-gray-50 dark:hover:bg-gray-700/50 group">
                      <div 
                        className="w-64 flex-shrink-0 p-3 border-r dark:border-gray-700 cursor-pointer"
                        onClick={() => setEditingTask(task)}
                      >
                        <div className="flex items-center gap-2">
                          {workflow && (
                            <div className={`w-2 h-2 rounded-full ${workflow.color}`} />
                          )}
                          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{task.title}</span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} - {endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </div>
                      </div>
                      <div className="flex-1 p-2 relative overflow-x-auto">
                        <div className="min-w-max h-8 relative">
                          {/* Background grid */}
                          <div className="absolute inset-0 flex">
                            {Array.from({ length: 8 }).map((_, i) => (
                              <div key={i} className={`w-32 flex-shrink-0 border-r dark:border-gray-700 ${i === 2 ? 'bg-purple-50/50 dark:bg-purple-900/10' : ''}`} />
                            ))}
                          </div>
                          {/* Task bar */}
                          <div
                            className={`absolute top-1 h-6 rounded cursor-move group-hover:ring-2 group-hover:ring-purple-400 transition ${
                              workflow ? workflow.color : 'bg-gray-400'
                            }`}
                            style={{
                              left: `${startOffset}px`,
                              width: `${Math.max(20, duration)}px`,
                            }}
                            title={`${task.title}\n${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`}
                            onClick={() => setEditingTask(task)}
                          >
                            <span className="px-2 text-xs text-white truncate block leading-6">
                              {task.title}
                            </span>
                          </div>
                          {/* Dependency arrows */}
                          {task.blockedBy?.map(blockerId => {
                            const blocker = filteredTasks.find(t => t.id === blockerId)
                            if (!blocker) return null
                            const blockerEnd = new Date(blocker.dueDate)
                            const blockerOffset = Math.max(0, (blockerEnd.getTime() - timelineStart.getTime()) / (1000 * 60 * 60 * 24)) * dayWidth
                            return (
                              <div
                                key={blockerId}
                                className="absolute top-3 h-0.5 bg-red-400"
                                style={{
                                  left: `${blockerOffset}px`,
                                  width: `${Math.max(0, startOffset - blockerOffset)}px`,
                                }}
                                title={`Blocked by: ${blocker.title}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>

            {filteredTasks.length === 0 && (
              <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                No tasks to display
              </div>
            )}
          </div>
        </div>
      )}

      {/* Task Edit Modal */}
      {editingTask && (
        <TaskModal
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSave={handleSaveTask}
          onDelete={deleteTask}
          onDuplicate={async (duplicatedTask) => {
            await createTaskWithNotification(duplicatedTask)
          }}
          workflows={workflows}
          teamMembers={teamMembers}
          tasks={tasks}
          labels={labels}
          onAddLabel={addLabel}
        />
      )}

      {/* New Workflow Modal */}
      {showNewWorkflowModal && (
        <NewWorkflowModal
          onClose={() => setShowNewWorkflowModal(false)}
          onSave={handleCreateWorkflow}
          workflowTypes={workflowTypes}
          subTemplates={subTemplates}
          taskTemplates={taskTemplates}
        />
      )}

      {/* Meeting Notes Parser Modal */}
      {showMeetingNotesModal && (
        <MeetingNotesModal
          onClose={() => setShowMeetingNotesModal(false)}
          onAddTasks={handleAddTasksFromMeeting}
          workflows={workflows}
          teamMembers={teamMembers}
        />
      )}

      {/* Edit Workflow Modal */}
      {editingWorkflow && (
        <EditWorkflowModal
          workflow={editingWorkflow}
          onClose={() => setEditingWorkflow(null)}
          onSave={handleUpdateWorkflow}
          onArchive={(taskIdsToArchive) => editingWorkflow.archived 
            ? handleUnarchiveWorkflow(editingWorkflow.id) 
            : handleArchiveWorkflow(editingWorkflow.id, taskIdsToArchive)
          }
          onDelete={(taskIdsToDelete) => handleDeleteWorkflow(editingWorkflow.id, taskIdsToDelete)}
          workflowTasks={tasks.filter(t => t.workflow === editingWorkflow.id)}
        />
      )}

      {/* Add Task Modal */}
      {showAddTaskModal && (
        <AddTaskModal
          onClose={() => setShowAddTaskModal(false)}
          onSave={async (newTask) => await createTaskWithNotification(newTask)}
          workflows={workflows}
          defaultWorkflow={globalWorkflow !== 'all' ? globalWorkflow : null}
          teamMembers={teamMembers}
          currentUserEmail={user?.email}
          taskTemplates={taskTemplates}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowSettingsModal(false)}>
          <div 
            className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Settings</h2>
              <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600 p-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Discord Webhook */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Discord Webhook URL
                </label>
                <input
                  type="url"
                  value={discordWebhook}
                  onChange={e => setDiscordWebhook(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none bg-white dark:bg-gray-700 dark:text-white"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Get notified when tasks are assigned or due. Create a webhook in Discord Server Settings → Integrations.
                </p>
              </div>
              
              {/* Test Button */}
              <button
                onClick={async () => {
                  if (discordWebhook) {
                    setDiscordWebhookUrl(discordWebhook)
                    const success = await notifyTaskAssigned({
                      title: 'Test Task',
                      assignee: 'Test User',
                      dueDate: new Date().toISOString(),
                      priority: 'medium',
                    }, window.location.href)
                    alert(success ? '✅ Notification sent!' : '❌ Failed to send. Check webhook URL.')
                  }
                }}
                disabled={!discordWebhook}
                className="w-full px-4 py-2 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Test Discord Notification
              </button>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2.5 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setDiscordWebhookUrl(discordWebhook)
                  setShowSettingsModal(false)
                }}
                className="px-5 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Manager Modal */}
      {showTemplateManager && (
        <TemplateManagerModal
          workflowTypes={workflowTypes}
          subTemplates={subTemplates}
          taskTemplates={taskTemplates}
          onSaveWorkflowTypes={saveWorkflowTypes}
          onSaveSubTemplates={saveSubTemplates}
          onSaveTaskTemplates={saveTaskTemplates}
          onClose={() => setShowTemplateManager(false)}
        />
      )}

      {/* Instructions */}
      <div className="mt-8 text-center text-sm text-gray-400 dark:text-gray-500">
        <p>Click card to edit • Drag the ⋮⋮ handle to move</p>
      </div>
    </main>
  )
}
