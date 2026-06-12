'use client'

import { useState, useRef, useEffect } from 'react'
import { 
  Task, Workflow, TeamMember, Status, Priority, Intensity,
  priorityColors, statusColors, statusLabels, intensityColors, INTENSITY_OPTIONS
} from './types'

interface Attachment {
  id: number
  type: 'image' | 'voice' | 'note'
  url: string
  name: string
  duration?: number
}

interface Subtask {
  id: number
  personId: number
  description: string
  intensity: Intensity
  completed?: boolean
}

interface TaskModalProps {
  task: Task
  onClose: () => void
  onSave: (updatedTask: Task) => void
  onDelete?: (taskId: number) => void
  onDuplicate?: (task: Task) => void
  workflows: Workflow[]
  teamMembers: TeamMember[]
}

export function TaskModal({ 
  task, 
  onClose, 
  onSave,
  onDelete,
  onDuplicate,
  workflows,
  teamMembers,
}: TaskModalProps) {
  const [editedTask, setEditedTask] = useState<Task>({ ...task })
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<'basic' | 'attachments'>('basic')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  
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
      setEditedTask(prev => ({
        ...prev,
        collaborators: prev.collaborators.filter(id => id !== memberId),
        subtasks: prev.subtasks.map(st => 
          st.personId === memberId ? { ...st, personId: 0 } : st
        )
      }))
    } else {
      const unassignedSubtaskIndex = editedTask.subtasks.findIndex(st => st.personId === 0)
      
      let newSubtasks = [...editedTask.subtasks]
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

  const handleDuplicate = () => {
    if (onDuplicate) {
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
    }
  }

  const currentWorkflow = workflows.find(w => w.id === editedTask.workflow)
  const currentSubWorkflow = workflows.find(w => w.id === editedTask.subWorkflow)

  return (
    <>
    {/* Unsaved changes prompt */}
    {showUnsavedPrompt && (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl p-6 max-w-sm shadow-2xl">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Unsaved Changes</h3>
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
              className="px-4 py-2 bg-steps-blue-600 text-white font-medium rounded-lg hover:bg-steps-blue-700 transition"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )}
    
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div 
        className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Edit Task</h2>
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
                ? 'text-steps-blue-600 border-b-2 border-steps-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Task Details
          </button>
          <button
            onClick={() => setActiveTab('attachments')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition flex items-center justify-center gap-2 ${
              activeTab === 'attachments'
                ? 'text-steps-blue-600 border-b-2 border-steps-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Attachments
            {editedTask.attachments && editedTask.attachments.length > 0 && (
              <span className="bg-steps-blue-100 text-steps-blue-600 text-xs px-2 py-0.5 rounded-full">
                {editedTask.attachments.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'basic' ? (
            <div className="space-y-6">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Title *</label>
                <input
                  type="text"
                  value={editedTask.title}
                  onChange={e => setEditedTask({ ...editedTask, title: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Description</label>
                <textarea
                  value={editedTask.description}
                  onChange={e => setEditedTask({ ...editedTask, description: e.target.value })}
                  rows={2}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none resize-none"
                />
              </div>

              {/* Workflow Selection */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Main Workflow</label>
                  <select
                    value={editedTask.workflow || ''}
                    onChange={e => setEditedTask({ 
                      ...editedTask, 
                      workflow: e.target.value || null,
                      subWorkflow: e.target.value === editedTask.subWorkflow ? null : editedTask.subWorkflow
                    })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="">None</option>
                    {workflows.filter(w => !w.archived).map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sub-Workflow</label>
                  <select
                    value={editedTask.subWorkflow || ''}
                    onChange={e => setEditedTask({ ...editedTask, subWorkflow: e.target.value || null })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="">None</option>
                    {workflows.filter(w => w.id !== editedTask.workflow && !w.archived).map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
                  <select
                    value={editedTask.status}
                    onChange={e => {
                      const newStatus = e.target.value as Status
                      if (newStatus === 'done') {
                        setEditedTask({
                          ...editedTask,
                          status: newStatus,
                          subtasks: editedTask.subtasks.map(st => ({ ...st, completed: true }))
                        })
                      } else {
                        setEditedTask({ ...editedTask, status: newStatus })
                      }
                    }}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="todo">To Do</option>
                    <option value="in-progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Priority</label>
                  <select
                    value={editedTask.priority}
                    onChange={e => setEditedTask({ ...editedTask, priority: e.target.value as Priority })}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none bg-white"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Due Date</label>
                <input
                  type="date"
                  value={editedTask.dueDate}
                  onChange={e => setEditedTask({ ...editedTask, dueDate: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Assigned To</label>
                <div className="grid grid-cols-3 gap-2">
                  {teamMembers.map(member => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        const newAssignee = member.id
                        const filteredCollabs = editedTask.collaborators.filter(id => id !== member.id)
                        
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
                          ? 'border-steps-blue-500 bg-steps-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-full bg-steps-blue-100 flex items-center justify-center text-steps-blue-700 text-sm font-medium">
                        {member.avatar}
                      </div>
                      <span className="text-sm font-medium text-gray-700 truncate">{member.name.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Collaborators</label>
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

              {/* Subtasks */}
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
                    className="text-sm text-steps-blue-600 hover:text-steps-blue-700 font-medium"
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
                    {editedTask.subtasks.map((subtask, index) => (
                      <div key={subtask.id} className={`flex gap-3 items-start p-3 rounded-lg ${subtask.completed ? 'bg-green-50 dark:bg-green-900/20' : 'bg-gray-50 dark:bg-gray-800/60'}`}>
                        <button
                          type="button"
                          onClick={() => {
                            const newSubtasks = [...editedTask.subtasks]
                            newSubtasks[index] = { ...subtask, completed: !subtask.completed }
                            const allComplete = newSubtasks.length > 0 && newSubtasks.every(st => st.completed)
                            setEditedTask({ 
                              ...editedTask, 
                              subtasks: newSubtasks,
                              status: allComplete ? 'done' : editedTask.status
                            })
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
                          className={`px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none min-w-[120px] ${subtask.completed ? 'opacity-60' : ''}`}
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
                            className={`w-full px-3 py-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none ${subtask.completed ? 'line-through opacity-60' : ''}`}
                          />
                        </div>
                        <select
                          value={subtask.intensity}
                          onChange={e => {
                            const newSubtasks = [...editedTask.subtasks]
                            newSubtasks[index] = { ...subtask, intensity: e.target.value as Intensity }
                            setEditedTask({ ...editedTask, subtasks: newSubtasks })
                          }}
                          className={`px-2 py-2 border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none ${intensityColors[subtask.intensity]} ${subtask.completed ? 'opacity-60' : ''}`}
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
                    ))}
                  </div>
                )}
              </div>
              
              {/* Task Metadata */}
              {(task.createdBy || task.createdAt) && (
                <div className="flex items-center gap-4 text-sm text-gray-400 pt-4 border-t border-gray-100">
                  {task.createdBy && (
                    <span className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-steps-blue-100 flex items-center justify-center text-steps-blue-700 text-xs font-medium">
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
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-steps-blue-300 hover:bg-steps-blue-50 transition">
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
                  className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-200 rounded-lg hover:border-steps-blue-300 hover:bg-steps-blue-50 transition"
                >
                  <svg className="w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-gray-600">Quick Note</span>
                </button>
              </div>

              {editedTask.attachments && editedTask.attachments.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium text-gray-700">Attached ({editedTask.attachments.length})</h3>
                  {editedTask.attachments.map(attachment => (
                    <div 
                      key={attachment.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg"
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
                        ) : (
                          <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{attachment.name}</p>
                        {attachment.type === 'note' && (
                          <p className="text-xs text-gray-500 truncate">{attachment.url.slice(0, 60)}...</p>
                        )}
                      </div>
                      {attachment.type === 'image' && (
                        <img src={attachment.url} alt={attachment.name} className="w-12 h-12 object-cover rounded" />
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
        </div>

        <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/60">
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
                onClick={handleDuplicate}
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
          
          {!showDeleteConfirm && (
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
                className="px-5 py-2.5 bg-steps-blue-600 text-white font-medium rounded-lg hover:bg-steps-blue-700 transition"
              >
                Save Changes
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  )
}
