// =============================================================================
// Strategy API — data access for the Task Tracker "Long-Term Strategic Plans"
// section. Uses the admin (anon) Supabase client; RLS gates writes to admins.
// =============================================================================
import { supabase } from '@/lib/supabase'

export type PlanStatus = 'not_started' | 'on_track' | 'at_risk' | 'off_track' | 'achieved'
export type PlanHorizon = '1_year' | '3_year' | '5_year' | 'ongoing'

export interface StrategicPillar {
  code: string
  label: string
  color: string
  sortOrder: number
}

export interface StrategicMilestone {
  id: string
  planId: string
  title: string
  dueDate: string | null
  completed: boolean
  completedAt: string | null
  sortOrder: number
}

export interface StrategicPlan {
  id: string
  title: string
  description: string
  ownerId: number | null
  pillar: string | null
  horizon: PlanHorizon | null
  startDate: string | null
  targetDate: string | null
  status: PlanStatus
  progress: number
  workflowId: string | null
  sortOrder: number
  archived: boolean
  createdAt: string
  updatedAt: string
  createdBy: string | null
  milestones: StrategicMilestone[]
}

export const STATUS_META: Record<PlanStatus, { label: string; dot: string; badge: string }> = {
  not_started: { label: 'Not started', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  on_track:    { label: 'On track',    dot: 'bg-green-500', badge: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  at_risk:     { label: 'At risk',     dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  off_track:   { label: 'Off track',   dot: 'bg-red-500',   badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  achieved:    { label: 'Achieved',    dot: 'bg-steps-blue-500', badge: 'bg-steps-blue-100 text-steps-blue-700 dark:bg-steps-blue-900/30 dark:text-steps-blue-300' },
}

export const HORIZON_META: Record<PlanHorizon, string> = {
  '1_year': '1 year',
  '3_year': '3 years',
  '5_year': '5 years',
  ongoing: 'Ongoing',
}

export const STATUS_ORDER: PlanStatus[] = ['off_track', 'at_risk', 'on_track', 'not_started', 'achieved']

function mapMilestone(m: any): StrategicMilestone {
  return {
    id: m.id,
    planId: m.plan_id,
    title: m.title,
    dueDate: m.due_date,
    completed: !!m.completed,
    completedAt: m.completed_at,
    sortOrder: m.sort_order ?? 0,
  }
}

function mapPlan(p: any, milestones: any[]): StrategicPlan {
  return {
    id: p.id,
    title: p.title,
    description: p.description || '',
    ownerId: p.owner_id ?? null,
    pillar: p.pillar ?? null,
    horizon: p.horizon ?? null,
    startDate: p.start_date,
    targetDate: p.target_date,
    status: (p.status as PlanStatus) || 'not_started',
    progress: p.progress ?? 0,
    workflowId: p.workflow_id ?? null,
    sortOrder: p.sort_order ?? 0,
    archived: !!p.archived,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    createdBy: p.created_by ?? null,
    milestones: milestones
      .filter((m) => m.plan_id === p.id)
      .map(mapMilestone)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
  }
}

export async function fetchPillars(): Promise<StrategicPillar[]> {
  const { data, error } = await supabase
    .from('strategic_pillars')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data || []).map((r: any) => ({
    code: r.code,
    label: r.label,
    color: r.color || 'bg-steps-blue-500',
    sortOrder: r.sort_order ?? 0,
  }))
}

export async function fetchPlans(): Promise<StrategicPlan[]> {
  const [plansRes, milestonesRes] = await Promise.all([
    supabase.from('strategic_plans').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('strategic_milestones').select('*'),
  ])
  if (plansRes.error) throw plansRes.error
  const milestones = milestonesRes.data || []
  return (plansRes.data || []).map((p: any) => mapPlan(p, milestones))
}

export interface PlanInput {
  title: string
  description: string
  ownerId: number | null
  pillar: string | null
  horizon: PlanHorizon | null
  startDate: string | null
  targetDate: string | null
  status: PlanStatus
  progress: number
  workflowId: string | null
}

function toRow(input: PlanInput) {
  return {
    title: input.title.trim(),
    description: input.description,
    owner_id: input.ownerId,
    pillar: input.pillar,
    horizon: input.horizon,
    start_date: input.startDate || null,
    target_date: input.targetDate || null,
    status: input.status,
    progress: Math.max(0, Math.min(100, Math.round(input.progress))),
    workflow_id: input.workflowId,
  }
}

export async function createPlan(input: PlanInput, createdBy: string | null): Promise<string> {
  const { data, error } = await supabase
    .from('strategic_plans')
    .insert({ ...toRow(input), created_by: createdBy })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function updatePlan(id: string, input: PlanInput): Promise<void> {
  const { error } = await supabase.from('strategic_plans').update(toRow(input)).eq('id', id)
  if (error) throw error
}

export async function setPlanStatus(id: string, status: PlanStatus): Promise<void> {
  const { error } = await supabase.from('strategic_plans').update({ status }).eq('id', id)
  if (error) throw error
}

export async function setPlanArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase.from('strategic_plans').update({ archived }).eq('id', id)
  if (error) throw error
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase.from('strategic_plans').delete().eq('id', id)
  if (error) throw error
}

export async function addMilestone(planId: string, title: string, dueDate: string | null, sortOrder: number): Promise<void> {
  const { error } = await supabase
    .from('strategic_milestones')
    .insert({ plan_id: planId, title: title.trim(), due_date: dueDate || null, sort_order: sortOrder })
  if (error) throw error
}

export async function toggleMilestone(id: string, completed: boolean): Promise<void> {
  const { error } = await supabase
    .from('strategic_milestones')
    .update({ completed, completed_at: completed ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

export async function deleteMilestone(id: string): Promise<void> {
  const { error } = await supabase.from('strategic_milestones').delete().eq('id', id)
  if (error) throw error
}
