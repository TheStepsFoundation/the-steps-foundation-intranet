export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type Status = 'todo' | 'in-progress' | 'review' | 'done'
export type Intensity = 'quick' | 'small' | 'medium' | 'large' | 'huge'
export type AttachmentType = 'image' | 'voice' | 'note'

export interface Database {
  public: {
    Tables: {
      tasks: {
        Row: {
          id: number
          title: string
          description: string
          assignee: number | null
          priority: Priority
          status: Status
          due_date: string
          created_at: string
          workflow_id: string | null
          sub_workflow_id: string | null
          archived: boolean | null
        }
        Insert: Omit<Database['public']['Tables']['tasks']['Row'], 'id' | 'created_at' | 'archived'> & {
          id?: number
          created_at?: string
          archived?: boolean
        }
        Update: Partial<Database['public']['Tables']['tasks']['Insert']>
      }
      task_collaborators: {
        Row: {
          id: number
          task_id: number
          member_id: number
        }
        Insert: Omit<Database['public']['Tables']['task_collaborators']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['task_collaborators']['Insert']>
      }
      subtasks: {
        Row: {
          id: number
          task_id: number
          person_id: number
          description: string
          intensity: Intensity
          completed: boolean
          completed_at: string | null
          actual_hours: number | null
        }
        Insert: Omit<Database['public']['Tables']['subtasks']['Row'], 'id' | 'completed' | 'completed_at' | 'actual_hours'> & { 
          completed?: boolean
          completed_at?: string | null
          actual_hours?: number | null
        }
        Update: Partial<Database['public']['Tables']['subtasks']['Insert']>
      }
      attachments: {
        Row: {
          id: number
          task_id: number
          type: AttachmentType
          url: string
          name: string
          duration: number | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['attachments']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['attachments']['Insert']>
      }
      workflows: {
        Row: {
          id: string
          name: string
          short: string
          color: string
          archived: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['workflows']['Row'], 'created_at' | 'archived'> & {
          archived?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['workflows']['Insert']>
      }
      team_members: {
        Row: {
          id: number
          name: string
          role: string
          avatar: string
        }
        Insert: Database['public']['Tables']['team_members']['Row']
        Update: Partial<Database['public']['Tables']['team_members']['Insert']>
      }
      week_capacities: {
        Row: {
          id: number
          week_start: string
          member_id: number
          hours: number
        }
        Insert: Omit<Database['public']['Tables']['week_capacities']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['week_capacities']['Insert']>
      }
      week_notes: {
        Row: {
          id: number
          week_start: string
          member_id: number
          note: string
        }
        Insert: Omit<Database['public']['Tables']['week_notes']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['week_notes']['Insert']>
      }
    }
    Views: {}
    Functions: {}
    Enums: {
      priority: Priority
      status: Status
      intensity: Intensity
      attachment_type: AttachmentType
    }
  }
}

// Frontend types (matches current app structure)
export interface Attachment {
  id: number
  type: AttachmentType
  url: string
  name: string
  duration?: number
}

export interface Subtask {
  id: number
  personId: number
  description: string
  intensity: Intensity
  completed?: boolean
  completedAt?: string    // ISO timestamp when marked complete
  actualHours?: number    // Actual hours reported by user
}

export interface Task {
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
  createdBy?: string // Email of user who created the task
  workflow: string | null
  subWorkflow: string | null
  attachments?: Attachment[]
  archived?: boolean
  blockedBy?: number[] // Task IDs that must be completed first
  labels?: string[] // Label IDs
  startDate?: string // For Gantt view
}

export interface Workflow {
  id: string
  name: string
  short: string
  color: string
  archived?: boolean
}

export interface TeamMember {
  id: number
  name: string
  role: string
  avatar: string
}

// Custom Labels
export interface Label {
  id: string
  name: string
  color: string
  isDefault?: boolean
}
