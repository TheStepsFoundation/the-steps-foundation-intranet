'use client'

import { useState } from 'react'

// Team members from Steps Foundation
const TEAM_MEMBERS = [
  { id: 1, name: "God'sFavour", role: 'Co-founder', avatar: 'GF' },
  { id: 2, name: 'Jim', role: 'Co-founder', avatar: 'JS' },
  { id: 3, name: 'Danielle', role: 'Co-founder', avatar: 'DA' },
  { id: 4, name: 'Sam', role: 'Core Team', avatar: 'SE' },
  { id: 5, name: 'Earl', role: 'Core Team', avatar: 'EX' },
  { id: 6, name: 'Aditya', role: 'Core Team', avatar: 'AL' },
]

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type Status = 'todo' | 'in-progress' | 'review' | 'done'

interface Task {
  id: number
  title: string
  description: string
  assignee: number
  priority: Priority
  status: Status
  dueDate: string
  createdAt: string
}

// Demo tasks
const INITIAL_TASKS: Task[] = [
  {
    id: 1,
    title: 'Finalise TikTok ad video',
    description: 'Edit and post the filmed TikTok ad for Event #4',
    assignee: 1,
    priority: 'high',
    status: 'in-progress',
    dueDate: '2026-03-16',
    createdAt: '2026-03-14',
  },
  {
    id: 2,
    title: 'Email blast to past attendees',
    description: 'Send event #4 invite to all previous event attendees',
    assignee: 2,
    priority: 'high',
    status: 'todo',
    dueDate: '2026-03-17',
    createdAt: '2026-03-14',
  },
  {
    id: 3,
    title: 'Confirm speakers for Lock-In',
    description: 'Follow up with all confirmed speakers and get final confirmations',
    assignee: 3,
    priority: 'urgent',
    status: 'in-progress',
    dueDate: '2026-03-15',
    createdAt: '2026-03-14',
  },
  {
    id: 4,
    title: 'Design event day schedule',
    description: 'Create detailed minute-by-minute schedule for March 21',
    assignee: 4,
    priority: 'medium',
    status: 'todo',
    dueDate: '2026-03-18',
    createdAt: '2026-03-14',
  },
]

const priorityColors: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const statusColors: Record<Status, string> = {
  'todo': 'bg-gray-200',
  'in-progress': 'bg-yellow-200',
  'review': 'bg-purple-200',
  'done': 'bg-green-200',
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS)
  const [view, setView] = useState<'board' | 'list' | 'workload'>('board')

  const getTasksByStatus = (status: Status) => tasks.filter(t => t.status === status)
  const getMember = (id: number) => TEAM_MEMBERS.find(m => m.id === id)
  
  const getWorkload = (memberId: number) => {
    const memberTasks = tasks.filter(t => t.assignee === memberId && t.status !== 'done')
    return {
      total: memberTasks.length,
      urgent: memberTasks.filter(t => t.priority === 'urgent').length,
      high: memberTasks.filter(t => t.priority === 'high').length,
    }
  }

  return (
    <main className="min-h-screen p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Steps Task Tracker</h1>
          <p className="text-gray-500">Event #4: The Great Lock-In — March 21, 2026</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('board')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              view === 'board' ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            Board
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              view === 'list' ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setView('workload')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              view === 'workload' ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200'
            }`}
          >
            Workload
          </button>
        </div>
      </div>

      {/* Workload View */}
      {view === 'workload' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
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

      {/* Board View */}
      {view === 'board' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {(['todo', 'in-progress', 'review', 'done'] as Status[]).map(status => (
            <div key={status} className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-3 h-3 rounded-full ${statusColors[status]}`} />
                <h2 className="font-semibold text-gray-700 capitalize">
                  {status.replace('-', ' ')}
                </h2>
                <span className="ml-auto text-sm text-gray-400">
                  {getTasksByStatus(status).length}
                </span>
              </div>
              
              <div className="space-y-3">
                {getTasksByStatus(status).map(task => {
                  const member = getMember(task.assignee)
                  return (
                    <div
                      key={task.id}
                      className="bg-white rounded-lg p-4 shadow-sm border border-gray-100 hover:shadow-md transition cursor-pointer"
                    >
                      <h3 className="font-medium text-gray-900 mb-2">{task.title}</h3>
                      <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                        {task.description}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className={`text-xs px-2 py-1 rounded-full ${priorityColors[task.priority]}`}>
                          {task.priority}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">
                            {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </span>
                          {member && (
                            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-xs font-medium">
                              {member.avatar.charAt(0)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {view === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left p-4 font-medium text-gray-600">Task</th>
                <th className="text-left p-4 font-medium text-gray-600">Assignee</th>
                <th className="text-left p-4 font-medium text-gray-600">Priority</th>
                <th className="text-left p-4 font-medium text-gray-600">Status</th>
                <th className="text-left p-4 font-medium text-gray-600">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => {
                const member = getMember(task.assignee)
                return (
                  <tr key={task.id} className="border-b hover:bg-gray-50">
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="text-sm text-gray-500">{task.description}</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {member && (
                          <>
                            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 text-sm font-medium">
                              {member.avatar}
                            </div>
                            <span className="text-gray-700">{member.name}</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full ${priorityColors[task.priority]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColors[task.status]} text-gray-700`}>
                        {task.status.replace('-', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-gray-600">
                      {new Date(task.dueDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
